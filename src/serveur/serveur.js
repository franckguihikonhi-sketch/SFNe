'use strict';

// Le service HTTP : deposer une facture, recuperer son Markdown.
//
//   POST   /api/v1/conversions            depose une facture, rend le Markdown
//   POST   /api/v1/lots                  depose un lot de factures d'un coup
//   GET    /api/v1/lots/:id              les conversions d'un lot
//   GET    /api/v1/lots/:id/markdown     les Markdown d'un lot, bout a bout
//   GET    /api/v1/conversions            l'historique de l'organisation
//   GET    /api/v1/conversions/:id        le detail d'une conversion
//   GET    /api/v1/conversions/:id/markdown   le fichier Markdown seul
//   DELETE /api/v1/conversions/:id        efface une conversion
//   GET    /api/v1/moi                    l'organisation, son plan, son quota
//   GET    /sante                         etat du service
//
// L'authentification tient en une cle d'API portee par l'entete Authorization.
// Sans cle valide, rien n'est lisible : une facture appartient a son emetteur.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { convertir, convertirLot, assemblerMarkdown } = require('../convertir');
const { creerVerificateur } = require('../verification/dgi');
const { EntreeInvalide } = require('../extraction/entree');
const {
  lireCorps, analyserMultipart, repondreJson, repondreTexte, repondreErreur,
  creerLimiteur, RequeteInvalide
} = require('./http');

const DOSSIER_WEB = path.join(__dirname, '..', 'web');
// Un lot de fin de mois pese plus qu'une facture : on lui laisse de la place,
// sans permettre d'y noyer le service.
const TAILLE_LOT = 60 * 1024 * 1024;
const LOT_MAXI = 200;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function cleDeLaRequete(requete) {
  const autorisation = requete.headers.authorization;
  if (autorisation && /^bearer\s+/i.test(autorisation)) return autorisation.replace(/^bearer\s+/i, '').trim();
  const entete = requete.headers['x-cle-api'];
  return entete ? String(entete).trim() : null;
}

function nomDeFichier(requete, partie) {
  if (partie && partie.nomFichier) return path.basename(partie.nomFichier);
  const entete = requete.headers['x-nom-fichier'];
  if (entete) return path.basename(String(entete));
  const type = String(requete.headers['content-type'] || '');
  if (type.includes('pdf')) return 'facture.pdf';
  if (type.includes('markdown')) return 'facture.md';
  return 'facture.txt';
}

function servirFichierStatique(reponse, cheminDemande) {
  const relatif = cheminDemande === '/' ? 'index.html' : cheminDemande.replace(/^\/+/, '');
  const fichier = path.join(DOSSIER_WEB, relatif);
  if (!fichier.startsWith(DOSSIER_WEB)) {
    repondreErreur(reponse, 403, 'interdit', 'Chemin refuse.');
    return true;
  }
  if (!fs.existsSync(fichier) || !fs.statSync(fichier).isFile()) return false;
  const contenu = fs.readFileSync(fichier);
  reponse.writeHead(200, {
    'content-type': TYPES[path.extname(fichier).toLowerCase()] || 'application/octet-stream',
    'content-length': contenu.length,
    'cache-control': 'no-cache'
  });
  reponse.end(contenu);
  return true;
}

function creerServeur(options = {}) {
  const depot = options.depot;
  if (!depot) throw new Error('Le serveur a besoin d\'un depot.');
  const limiteur = options.limiteur || creerLimiteur(options.limites);
  // Un seul verificateur pour tout le service : son cache evite de redemander
  // a la DGI un sticker qu'elle vient de qualifier.
  const verificateur = options.verificateur || creerVerificateur();
  const journaliser = options.journal === false ? () => {} : (options.journal || ((ligne) => process.stdout.write(`${ligne}\n`)));

  async function traiter(requete, reponse) {
    const url = new URL(requete.url, 'http://sfne.local');
    const chemin = url.pathname.replace(/\/+$/, '') || '/';

    if (requete.method === 'OPTIONS') {
      reponse.writeHead(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
        'access-control-allow-headers': 'authorization, content-type, x-cle-api, x-nom-fichier'
      });
      reponse.end();
      return;
    }

    if (chemin === '/sante') {
      repondreJson(reponse, 200, { service: 'sfne', etat: 'ok', version: 'v1' });
      return;
    }

    if (!chemin.startsWith('/api/')) {
      if (requete.method === 'GET' && servirFichierStatique(reponse, chemin)) return;
      repondreErreur(reponse, 404, 'introuvable', 'Page inconnue.');
      return;
    }

    const cle = cleDeLaRequete(requete);
    const identite = cle ? depot.organisationParCle(cle) : null;
    if (!identite) {
      repondreErreur(reponse, 401, 'non_authentifie',
        'Cle d\'API absente ou revoquee. Envoyez l\'entete Authorization: Bearer <cle>.');
      return;
    }
    const organisation = identite.organisation;

    const passage = limiteur(identite.cle.id);
    if (!passage.autorise) {
      repondreJson(reponse, 429, {
        erreur: { code: 'trop_de_requetes', message: 'Trop de requetes. Reessayez dans un instant.' }
      }, { 'retry-after': String(Math.ceil(passage.attendreMs / 1000)) });
      return;
    }

    const conversion = chemin.match(/^\/api\/v1\/conversions\/([A-Za-z0-9_-]+)(\/markdown)?$/);

    if (chemin === '/api/v1/moi' && requete.method === 'GET') {
      repondreJson(reponse, 200, {
        organisation: { id: organisation.id, nom: organisation.nom, plan: organisation.plan, creeLe: organisation.creeLe },
        cle: { id: identite.cle.id, nom: identite.cle.nom, prefixe: identite.cle.prefixe },
        quota: depot.quota(organisation.id),
        verificationDgi: verificateur.configure
      });
      return;
    }

    const lotDemande = chemin.match(/^\/api\/v1\/lots\/([A-Za-z0-9_-]+)(\/markdown)?$/);

    if (chemin === '/api/v1/lots' && requete.method === 'POST') {
      const type = String(requete.headers['content-type'] || '');
      if (!type.startsWith('multipart/form-data')) {
        throw new RequeteInvalide('Un lot se depose en multipart/form-data, un champ « fichier » par facture.');
      }
      const corps = await lireCorps(requete, TAILLE_LOT);
      const parties = analyserMultipart(corps, type).filter((partie) => partie.nomFichier);
      if (!parties.length) throw new RequeteInvalide('Aucun fichier dans le lot.');
      if (parties.length > LOT_MAXI) {
        throw new RequeteInvalide(`Lot de ${parties.length} fichiers : ${LOT_MAXI} au maximum par envoi.`);
      }

      // Ce qui depasse le quota est refuse fichier par fichier : le reste du
      // lot passe quand meme.
      const quota = depot.quota(organisation.id);
      const place = Number.isFinite(quota.restant) ? quota.restant : parties.length;
      const retenues = parties.slice(0, place);
      const refusees = parties.slice(place);

      const lot = depot.nouveauLot();
      const rendu = {
        controles: url.searchParams.get('controles') !== 'non',
        provenance: url.searchParams.get('provenance') !== 'non'
      };
      const { resultats, resume } = await convertirLot(
        retenues.map((partie) => ({ nom: path.basename(partie.nomFichier), donnees: partie.contenu })),
        { rendu, verificateur }
      );

      const conversions = resultats.map((entree) => {
        if (!entree.resultat) return { fichier: entree.nom, erreur: entree.erreur };
        const fiche = depot.enregistrerConversion(organisation.id, entree.resultat, { lot });
        return {
          fichier: entree.nom,
          conversion: fiche,
          conforme: entree.resultat.verdict.conforme,
          nomSortie: entree.resultat.nomSortie
        };
      });
      for (const refusee of refusees) {
        conversions.push({
          fichier: path.basename(refusee.nomFichier),
          erreur: { code: 'quota_depasse', message: `Quota mensuel atteint (${quota.consomme}/${quota.limite}).` }
        });
      }

      journaliser(`${organisation.nom} ${lot} ${resume.lues}/${resume.total} lues, ${resume.avecAnomalies} avec anomalies`);

      if (url.searchParams.get('format') === 'markdown') {
        const documents = resultats.filter((entree) => entree.resultat).map((entree) => entree.resultat.markdown);
        repondreTexte(reponse, 201, assemblerMarkdown(documents), 'text/markdown; charset=utf-8', {
          location: `/api/v1/lots/${lot}`,
          'x-lot-id': lot
        });
        return;
      }
      repondreJson(reponse, 201, {
        lot: { id: lot, ...resume, refusesQuota: refusees.length },
        conversions,
        quota: depot.quota(organisation.id)
      }, { location: `/api/v1/lots/${lot}` });
      return;
    }

    if (lotDemande && requete.method === 'GET') {
      const { fiches, total } = depot.listerConversions(organisation.id, { lot: lotDemande[1], limite: LOT_MAXI });
      if (!total) {
        repondreErreur(reponse, 404, 'introuvable', 'Lot inconnu.');
        return;
      }
      if (lotDemande[2]) {
        const documents = depot.markdownDuLot(organisation.id, lotDemande[1]) || [];
        const entetes = url.searchParams.get('telecharger') === 'oui'
          ? { 'content-disposition': `attachment; filename="${lotDemande[1]}.md"` }
          : {};
        repondreTexte(reponse, 200, assemblerMarkdown(documents), 'text/markdown; charset=utf-8', entetes);
        return;
      }
      repondreJson(reponse, 200, { lot: lotDemande[1], total, fiches });
      return;
    }

    if (chemin === '/api/v1/conversions' && requete.method === 'POST') {
      const quota = depot.quota(organisation.id);
      if (quota.depasse) {
        repondreErreur(reponse, 402, 'quota_depasse',
          `Quota mensuel atteint (${quota.consomme}/${quota.limite}) pour le plan ${quota.libellePlan}.`);
        return;
      }
      const corps = await lireCorps(requete);
      if (!corps.length) throw new RequeteInvalide('Aucun fichier recu.');
      const type = String(requete.headers['content-type'] || '');
      let donnees = corps;
      let partie = null;
      if (type.startsWith('multipart/form-data')) {
        const parties = analyserMultipart(corps, type);
        partie = parties.find((candidate) => candidate.nom === 'fichier' && candidate.nomFichier)
          || parties.find((candidate) => candidate.nomFichier);
        if (!partie) throw new RequeteInvalide('Envoi sans fichier : attendu un champ « fichier ».');
        donnees = partie.contenu;
      }
      const resultat = await convertir(donnees, {
        nom: nomDeFichier(requete, partie),
        verificateur,
        rendu: {
          controles: url.searchParams.get('controles') !== 'non',
          provenance: url.searchParams.get('provenance') !== 'non'
        }
      });
      const fiche = depot.enregistrerConversion(organisation.id, resultat);
      journaliser(`${organisation.nom} ${fiche.id} ${fiche.fichier} ${fiche.conforme ? 'conforme' : 'anomalies'}`);
      if (url.searchParams.get('format') === 'markdown') {
        repondreTexte(reponse, 201, resultat.markdown, 'text/markdown; charset=utf-8', {
          location: `/api/v1/conversions/${fiche.id}`,
          'x-conversion-id': fiche.id
        });
        return;
      }
      repondreJson(reponse, 201, {
        conversion: fiche,
        facture: resultat.facture,
        controles: resultat.verdict.controles,
        conforme: resultat.verdict.conforme,
        markdown: resultat.markdown,
        nomSortie: resultat.nomSortie,
        quota: depot.quota(organisation.id)
      }, { location: `/api/v1/conversions/${fiche.id}` });
      return;
    }

    if (chemin === '/api/v1/conversions' && requete.method === 'GET') {
      const limite = Math.min(Number(url.searchParams.get('limite')) || 25, 200);
      const depart = Math.max(Number(url.searchParams.get('depart')) || 0, 0);
      repondreJson(reponse, 200, { ...depot.listerConversions(organisation.id, { limite, depart }), limite, depart });
      return;
    }

    if (conversion && requete.method === 'GET') {
      const id = conversion[1];
      if (conversion[2]) {
        const markdown = depot.markdown(organisation.id, id);
        if (markdown == null) {
          repondreErreur(reponse, 404, 'introuvable', 'Conversion inconnue.');
          return;
        }
        const entetes = url.searchParams.get('telecharger') === 'oui'
          ? { 'content-disposition': `attachment; filename="${id}.md"` }
          : {};
        repondreTexte(reponse, 200, markdown, 'text/markdown; charset=utf-8', entetes);
        return;
      }
      const detail = depot.conversion(organisation.id, id);
      if (!detail) {
        repondreErreur(reponse, 404, 'introuvable', 'Conversion inconnue.');
        return;
      }
      repondreJson(reponse, 200, detail);
      return;
    }

    if (conversion && !conversion[2] && requete.method === 'DELETE') {
      if (!depot.supprimerConversion(organisation.id, conversion[1])) {
        repondreErreur(reponse, 404, 'introuvable', 'Conversion inconnue.');
        return;
      }
      reponse.writeHead(204, { 'access-control-allow-origin': '*' });
      reponse.end();
      return;
    }

    repondreErreur(reponse, 404, 'introuvable', 'Route inconnue.');
  }

  return http.createServer((requete, reponse) => {
    reponse.setHeader('access-control-allow-origin', '*');
    reponse.setHeader('x-content-type-options', 'nosniff');
    traiter(requete, reponse).catch((erreur) => {
      if (erreur instanceof EntreeInvalide) {
        repondreErreur(reponse, 400, 'entree_invalide', erreur.message);
        return;
      }
      if (erreur instanceof RequeteInvalide) {
        repondreErreur(reponse, erreur.statut, erreur.code, erreur.message);
        return;
      }
      journaliser(`erreur ${requete.method} ${requete.url} : ${erreur.stack || erreur.message}`);
      repondreErreur(reponse, 500, 'erreur_interne', 'Le service n\'a pas pu traiter la demande.');
    });
  });
}

module.exports = { creerServeur };
