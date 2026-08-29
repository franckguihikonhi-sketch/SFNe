'use strict';

// Verification du sticker electronique aupres de la DGI.
//
// L'API FNE s'obtient sur demande et agrement prealable, avec des cles par
// entreprise : son adresse et sa forme ne sont pas publiques. Rien n'est donc
// code en dur ici. Le verificateur se configure, et sans configuration il se
// tait — il ne rend jamais un verdict qu'il n'a pas obtenu.
//
// Configuration (variables d'environnement ou objet passe au constructeur) :
//   SFNE_DGI_URL      modele d'adresse, ou {jeton} est remplace par le sticker
//                     ex. https://api.fne.dgi.gouv.ci/v1/factures/{jeton}
//   SFNE_DGI_CLE      la cle d'API remise par la DGI
//   SFNE_DGI_ENTETE   entete qui la porte      (defaut : Authorization)
//   SFNE_DGI_SCHEMA   prefixe de la valeur     (defaut : Bearer)
//   SFNE_DGI_DELAI    delai d'attente en ms    (defaut : 8000)
//   SFNE_DGI_CHAMPS   correspondance des champs de la reponse, en JSON
//                     ex. {"numero":"invoiceNumber","totalTTC":"amountInclTax"}

const DELAI_PAR_DEFAUT = 8000;
const DUREE_CACHE = 10 * 60 * 1000;
const ECART_TOLERE = 1;

// Ce que la reponse de la DGI est censee porter, et le nom que ce logiciel
// donne a chaque champ. La correspondance se regle sans toucher au code.
const CHAMPS_PAR_DEFAUT = {
  numero: 'numero',
  ncc: 'ncc',
  totalTTC: 'totalTTC',
  statut: 'statut',
  date: 'date'
};

// Un statut annule ou rejete vaut refus, quel que soit le reste.
const STATUTS_REFUSES = /annul|rejet|invalid|cancel/i;

function valeurProfonde(objet, chemin) {
  if (!objet || !chemin) return undefined;
  return String(chemin).split('.').reduce((courant, cle) => (courant == null ? undefined : courant[cle]), objet);
}

function nombreDe(valeur) {
  if (valeur == null) return null;
  const nombre = Number(String(valeur).replace(/[^\d.,-]/g, '').replace(',', '.'));
  return Number.isFinite(nombre) ? nombre : null;
}

function lireConfiguration(source = process.env) {
  let champs = CHAMPS_PAR_DEFAUT;
  if (source.SFNE_DGI_CHAMPS) {
    try {
      champs = { ...CHAMPS_PAR_DEFAUT, ...JSON.parse(source.SFNE_DGI_CHAMPS) };
    } catch (erreur) {
      throw new Error(`SFNE_DGI_CHAMPS n'est pas un JSON valide : ${erreur.message}`);
    }
  }
  return {
    url: source.SFNE_DGI_URL || null,
    cle: source.SFNE_DGI_CLE || null,
    entete: source.SFNE_DGI_ENTETE || 'Authorization',
    schema: source.SFNE_DGI_SCHEMA === '' ? '' : (source.SFNE_DGI_SCHEMA || 'Bearer'),
    delai: Number(source.SFNE_DGI_DELAI) || DELAI_PAR_DEFAUT,
    champs
  };
}

// Confronte ce que la DGI renvoie a ce que la facture porte. Ce qui manque
// d'un cote ou de l'autre n'est pas une discordance : c'est un silence.
function comparer(facture, corps, champs) {
  const ecarts = [];
  const attendu = {
    numero: facture.document.numero,
    ncc: facture.vendeur.ncc,
    totalTTC: facture.totaux.netAPayer ?? facture.totaux.totalTTC
  };

  const numero = valeurProfonde(corps, champs.numero);
  if (numero != null && attendu.numero && String(numero).trim() !== String(attendu.numero).trim()) {
    ecarts.push({ champ: 'numero', facture: attendu.numero, dgi: String(numero) });
  }

  const ncc = valeurProfonde(corps, champs.ncc);
  if (ncc != null && attendu.ncc && String(ncc).trim() !== String(attendu.ncc).trim()) {
    ecarts.push({ champ: 'ncc du vendeur', facture: attendu.ncc, dgi: String(ncc) });
  }

  const totalTTC = nombreDe(valeurProfonde(corps, champs.totalTTC));
  if (totalTTC != null && attendu.totalTTC != null && Math.abs(totalTTC - attendu.totalTTC) > ECART_TOLERE) {
    ecarts.push({ champ: 'total a payer', facture: attendu.totalTTC, dgi: totalTTC });
  }

  const statut = valeurProfonde(corps, champs.statut);
  return { ecarts, statut: statut == null ? null : String(statut) };
}

class Verificateur {
  constructor(options = {}) {
    this.config = options.config || lireConfiguration(options.env || process.env);
    this.chercher = options.chercher || globalThis.fetch;
    this.cache = new Map();
    this.dureeCache = options.dureeCache == null ? DUREE_CACHE : options.dureeCache;
    this.appels = 0;
  }

  get configure() {
    return Boolean(this.config.url);
  }

  adresse(jeton) {
    return this.config.url.includes('{jeton}')
      ? this.config.url.replace('{jeton}', encodeURIComponent(jeton))
      : `${this.config.url.replace(/\/$/, '')}/${encodeURIComponent(jeton)}`;
  }

  // Rend { etat, details, verifieLe }. Les etats possibles :
  //   verifiee      la DGI connait ce sticker et ce qu'elle en dit concorde
  //   discordante   elle le connait, mais ses valeurs different de la facture
  //   inconnue      elle ne connait pas ce sticker
  //   indisponible  elle n'a pas repondu, ou pas d'une facon exploitable
  //   sans_sticker  la facture n'en porte pas (un Markdown, par exemple)
  //   non_configuree  aucune API n'est renseignee
  async verifier(facture) {
    const maintenant = new Date().toISOString();
    if (!this.configure) return { etat: 'non_configuree', details: null, verifieLe: null };

    const jeton = facture.verification && facture.verification.sticker;
    if (!jeton) return { etat: 'sans_sticker', details: null, verifieLe: maintenant };

    const enCache = this.cache.get(jeton);
    if (enCache && Date.now() - enCache.instant < this.dureeCache) {
      return { ...enCache.resultat, verifieLe: maintenant, ducache: true };
    }

    const resultat = await this.interroger(facture, jeton);
    this.cache.set(jeton, { instant: Date.now(), resultat });
    return { ...resultat, verifieLe: maintenant };
  }

  async interroger(facture, jeton) {
    const entetes = { accept: 'application/json' };
    if (this.config.cle) {
      entetes[this.config.entete] = this.config.schema ? `${this.config.schema} ${this.config.cle}` : this.config.cle;
    }
    const arret = AbortSignal.timeout(this.config.delai);

    let reponse;
    try {
      this.appels += 1;
      reponse = await this.chercher(this.adresse(jeton), { headers: entetes, signal: arret });
    } catch (erreur) {
      return { etat: 'indisponible', details: `la DGI n'a pas repondu : ${erreur.message}` };
    }

    if (reponse.status === 404) return { etat: 'inconnue', details: 'sticker absent du registre de la DGI' };
    if (!reponse.ok) return { etat: 'indisponible', details: `la DGI a repondu ${reponse.status}` };

    let corps;
    try {
      corps = await reponse.json();
    } catch (erreur) {
      return { etat: 'indisponible', details: 'reponse de la DGI illisible' };
    }

    const { ecarts, statut } = comparer(facture, corps, this.config.champs);
    if (statut && STATUTS_REFUSES.test(statut)) {
      return { etat: 'discordante', details: `la DGI donne cette facture pour « ${statut} »`, ecarts };
    }
    if (ecarts.length) {
      const dit = ecarts.map((ecart) => `${ecart.champ} : ${ecart.facture} sur la facture, ${ecart.dgi} a la DGI`);
      return { etat: 'discordante', details: dit.join(' ; '), ecarts };
    }
    return { etat: 'verifiee', details: statut ? `statut ${statut}` : null, ecarts: [] };
  }
}

function creerVerificateur(options) {
  return new Verificateur(options);
}

module.exports = { creerVerificateur, Verificateur, lireConfiguration, comparer, CHAMPS_PAR_DEFAUT };
