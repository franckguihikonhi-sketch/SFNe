'use strict';

// Le depot : les organisations, leurs cles d'API et leurs conversions.
//
// Tout tient dans des fichiers JSON et des fichiers Markdown, sous un seul
// dossier. Une facture est un document comptable : elle reste chez son
// proprietaire, et une organisation ne voit jamais les conversions d'une autre.
//
// Les cles d'API ne sont pas conservees en clair. Seule leur empreinte est
// ecrite : une cle perdue se remplace, elle ne se retrouve pas.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PLANS = {
  essai: { libelle: 'Essai', conversionsParMois: 30 },
  pro: { libelle: 'Pro', conversionsParMois: 2000 },
  illimite: { libelle: 'Illimite', conversionsParMois: Infinity }
};

const PREFIXE_CLE = 'sfne_';

function empreinte(cle) {
  return crypto.createHash('sha256').update(String(cle), 'utf8').digest('hex');
}

function identifiant(prefixe) {
  return `${prefixe}_${crypto.randomBytes(9).toString('hex')}`;
}

function ecrireAtomique(fichier, contenu) {
  const provisoire = `${fichier}.${process.pid}.tmp`;
  fs.writeFileSync(provisoire, contenu);
  fs.renameSync(provisoire, fichier);
}

function lireJson(fichier, defaut) {
  try {
    return JSON.parse(fs.readFileSync(fichier, 'utf8'));
  } catch (erreur) {
    if (erreur.code === 'ENOENT') return defaut;
    throw erreur;
  }
}

function moisDe(horodatage) {
  return String(horodatage).slice(0, 7);
}

class Depot {
  constructor(dossier) {
    this.dossier = path.resolve(dossier);
    this.dossierConversions = path.join(this.dossier, 'conversions');
    fs.mkdirSync(this.dossierConversions, { recursive: true });
    this.fichierOrganisations = path.join(this.dossier, 'organisations.json');
    this.fichierIndex = path.join(this.dossier, 'conversions.json');
    this.organisations = lireJson(this.fichierOrganisations, []);
    this.index = lireJson(this.fichierIndex, []);
  }

  enregistrerOrganisations() {
    ecrireAtomique(this.fichierOrganisations, JSON.stringify(this.organisations, null, 2));
  }

  enregistrerIndex() {
    ecrireAtomique(this.fichierIndex, JSON.stringify(this.index, null, 2));
  }

  // ------------------------------------------------------------- comptes

  creerOrganisation({ nom, plan = 'essai', courriel = null } = {}) {
    if (!nom || !String(nom).trim()) throw new Error('Une organisation a besoin d\'un nom.');
    if (!PLANS[plan]) throw new Error(`Plan inconnu : ${plan}`);
    const organisation = {
      id: identifiant('org'),
      nom: String(nom).trim(),
      courriel,
      plan,
      creeLe: new Date().toISOString(),
      cles: []
    };
    this.organisations.push(organisation);
    const cle = this.creerCle(organisation.id, 'cle initiale');
    return { organisation, cle: cle.cle };
  }

  organisationParId(id) {
    return this.organisations.find((organisation) => organisation.id === id) || null;
  }

  creerCle(idOrganisation, nom = 'cle') {
    const organisation = this.organisationParId(idOrganisation);
    if (!organisation) throw new Error('Organisation inconnue.');
    const secret = `${PREFIXE_CLE}${crypto.randomBytes(24).toString('base64url')}`;
    const fiche = {
      id: identifiant('cle'),
      nom,
      prefixe: secret.slice(0, PREFIXE_CLE.length + 6),
      empreinte: empreinte(secret),
      creeLe: new Date().toISOString(),
      revoqueeLe: null,
      derniereUtilisation: null
    };
    organisation.cles.push(fiche);
    this.enregistrerOrganisations();
    return { fiche, cle: secret };
  }

  revoquerCle(idOrganisation, idCle) {
    const organisation = this.organisationParId(idOrganisation);
    if (!organisation) return false;
    const fiche = organisation.cles.find((cle) => cle.id === idCle);
    if (!fiche || fiche.revoqueeLe) return false;
    fiche.revoqueeLe = new Date().toISOString();
    this.enregistrerOrganisations();
    return true;
  }

  // La date de derniere utilisation sert a reperer une cle oubliee, pas a
  // compter les appels : elle n'est ecrite qu'une fois par minute au plus.
  noterUtilisation(fiche) {
    const maintenant = new Date();
    const precedente = fiche.derniereUtilisation ? Date.parse(fiche.derniereUtilisation) : 0;
    fiche.derniereUtilisation = maintenant.toISOString();
    if (maintenant.getTime() - precedente >= 60000) this.enregistrerOrganisations();
  }

  // La comparaison passe par l'empreinte, en temps constant.
  organisationParCle(cle) {
    if (!cle || typeof cle !== 'string') return null;
    const attendue = Buffer.from(empreinte(cle), 'hex');
    for (const organisation of this.organisations) {
      for (const fiche of organisation.cles) {
        if (fiche.revoqueeLe) continue;
        const connue = Buffer.from(fiche.empreinte, 'hex');
        if (connue.length === attendue.length && crypto.timingSafeEqual(connue, attendue)) {
          this.noterUtilisation(fiche);
          return { organisation, cle: fiche };
        }
      }
    }
    return null;
  }

  // --------------------------------------------------------------- quota

  usage(idOrganisation, mois = moisDe(new Date().toISOString())) {
    return this.index.filter((fiche) => fiche.organisation === idOrganisation && moisDe(fiche.creeLe) === mois).length;
  }

  quota(idOrganisation) {
    const organisation = this.organisationParId(idOrganisation);
    const plan = PLANS[organisation ? organisation.plan : 'essai'];
    const consomme = this.usage(idOrganisation);
    return {
      plan: organisation ? organisation.plan : 'essai',
      libellePlan: plan.libelle,
      limite: plan.conversionsParMois,
      consomme,
      restant: plan.conversionsParMois === Infinity ? Infinity : Math.max(0, plan.conversionsParMois - consomme),
      depasse: consomme >= plan.conversionsParMois
    };
  }

  // ---------------------------------------------------------- conversions

  nouveauLot() {
    return identifiant('lot');
  }

  enregistrerConversion(idOrganisation, resultat, options = {}) {
    const { facture, verdict, markdown } = resultat;
    const fiche = {
      id: identifiant('cnv'),
      organisation: idOrganisation,
      lot: options.lot || null,
      creeLe: new Date().toISOString(),
      fichier: facture.meta.source,
      format: facture.meta.format,
      type: facture.document.type,
      numero: facture.document.numero,
      numeroFactureInitiale: facture.document.numeroFactureInitiale,
      date: facture.document.date ? facture.document.date.iso : null,
      vendeur: facture.vendeur.raisonSociale,
      client: facture.client.nom,
      devise: facture.document.devise,
      totalHT: facture.totaux.totalHT,
      totalTVA: facture.totaux.totalTVA,
      netAPayer: facture.totaux.netAPayer,
      sticker: facture.verification ? facture.verification.sticker : null,
      verification: facture.verification ? facture.verification.etat : null,
      conforme: verdict.conforme,
      compte: verdict.compte,
      octets: Buffer.byteLength(markdown, 'utf8')
    };
    ecrireAtomique(path.join(this.dossierConversions, `${fiche.id}.md`), markdown);
    ecrireAtomique(path.join(this.dossierConversions, `${fiche.id}.json`),
      JSON.stringify({ fiche, facture, controles: verdict.controles }, null, 2));
    this.index.unshift(fiche);
    this.enregistrerIndex();
    return fiche;
  }

  listerConversions(idOrganisation, { limite = 25, depart = 0, lot = null } = {}) {
    const toutes = this.index.filter((fiche) => fiche.organisation === idOrganisation
      && (lot == null || fiche.lot === lot));
    return { total: toutes.length, fiches: toutes.slice(depart, depart + limite) };
  }

  // Les Markdown d'un lot, dans l'ordre ou les factures ont ete deposees.
  markdownDuLot(idOrganisation, lot) {
    const fiches = this.index
      .filter((fiche) => fiche.organisation === idOrganisation && fiche.lot === lot)
      .reverse();
    if (!fiches.length) return null;
    return fiches.map((fiche) => this.markdown(idOrganisation, fiche.id)).filter((texte) => texte != null);
  }

  conversion(idOrganisation, id) {
    const fiche = this.index.find((candidate) => candidate.id === id && candidate.organisation === idOrganisation);
    if (!fiche) return null;
    const detail = lireJson(path.join(this.dossierConversions, `${id}.json`), null);
    return detail ? { ...detail, fiche } : { fiche, facture: null, controles: [] };
  }

  markdown(idOrganisation, id) {
    const fiche = this.index.find((candidate) => candidate.id === id && candidate.organisation === idOrganisation);
    if (!fiche) return null;
    try {
      return fs.readFileSync(path.join(this.dossierConversions, `${id}.md`), 'utf8');
    } catch (erreur) {
      if (erreur.code === 'ENOENT') return null;
      throw erreur;
    }
  }

  supprimerConversion(idOrganisation, id) {
    const rang = this.index.findIndex((fiche) => fiche.id === id && fiche.organisation === idOrganisation);
    if (rang < 0) return false;
    this.index.splice(rang, 1);
    this.enregistrerIndex();
    for (const extension of ['.md', '.json']) {
      try {
        fs.unlinkSync(path.join(this.dossierConversions, `${id}${extension}`));
      } catch (erreur) {
        if (erreur.code !== 'ENOENT') throw erreur;
      }
    }
    return true;
  }
}

function ouvrir(dossier) {
  return new Depot(dossier || process.env.SFNE_DONNEES || path.join(process.cwd(), 'donnees'));
}

module.exports = { ouvrir, Depot, PLANS, empreinte };
