'use strict';

// Analyse d'une facture normalisee electronique : du texte vers un objet.
//
// Le document est lu en cinq zones successives, dans l'ordre ou la DGI les
// impose : l'entete du vendeur, le bloc client, les lignes de la facture, le
// resume des taxes, puis le pied de page. Chaque zone a ses etiquettes.

const { enLignes, estLigneTableau, cellulesDe, normaliserEspaces, estNumerique, versNombre, versDate, sansAccent } = require('./texte');
const { extraireChamps, ligneEntierementLue } = require('./champs');
const { VENDEUR, VENDEUR_SEUL, CLIENT, DOCUMENT, TOUTES, TOTAUX, COLONNES } = require('./dictionnaires');

const DEVISE_PAR_DEFAUT = 'XOF';

function cle(texte) {
  return sansAccent(normaliserEspaces(texte)).toLowerCase().replace(/[.:]+$/, '').trim();
}

function estEnteteClient(ligne) {
  return /^client(\s*:)?$/i.test(cle(ligne)) || /^informations?\s+client$/i.test(cle(ligne));
}

function estEnteteResume(ligne) {
  const c = cle(ligne).replace(/\|/g, ' ').trim();
  return /^resume de la facture$/.test(c) || /^recapitulatif( des taxes)?$/.test(c) || /^resume des taxes$/.test(c);
}

// Les mentions legales du bas de page, qu'aucune colonne ne structure.
function estPiedDePage(ligne) {
  return /siege social|siège social|compte bancaire|tel\.?\s*:|rccm/i.test(ligne) || ligne.length > 90;
}

// ---------------------------------------------------------------- decoupage

function decouper(lignes) {
  const zones = { entete: [], client: [], lignes: [], resume: [], pied: [] };
  const origine = { entete: [], client: [], lignes: [], resume: [], pied: [] };
  let zone = 'entete';
  let tableauVu = false;
  let totauxVus = false;

  lignes.forEach((ligne, rang) => {
    if (estEnteteResume(ligne)) {
      zone = 'resume';
      return;
    }
    if (zone === 'entete' && estEnteteClient(ligne)) {
      zone = 'client';
      return;
    }
    if ((zone === 'entete' || zone === 'client') && (estLigneTableau(ligne) || estEnteteDetail(ligne))) {
      zone = 'lignes';
    }
    if (zone === 'lignes') {
      const cellules = cellulesLigne(ligne);
      if (estLigneTableau(ligne) || cellules.length >= 2) {
        tableauVu = true;
        // « Montant HT » est aussi le nom d'une colonne : une ligne de totaux
        // porte, elle, un montant.
        if (cellules.some((cellule) => cleTotal(cellule)) && cellules.some(estNumerique)) totauxVus = true;
      } else if (tableauVu && (totauxVus || estPiedDePage(ligne))) {
        // Avant les totaux, une ligne sans colonne est la suite d'une
        // designation trop longue pour tenir : « (4*2.5kg) » sous son article.
        zone = 'pied';
      }
    }
    // Le resume des taxes se donne en tableau dans un Markdown, en colonnes
    // espacees dans un PDF. Il se termine a la premiere ligne qui n'a plus de
    // colonnes du tout : le pied de page.
    if (zone === 'resume' && zones.resume.length
      && !estLigneTableau(ligne) && cellulesLigne(ligne).length < 2) zone = 'pied';
    zones[zone].push(ligne);
    origine[zone].push(rang);
  });

  return { zones, origine };
}

// ------------------------------------------------------------- identite FNE

const RE_INITIALE = /facture\s*(?:d['’]origine|initiale|de\s*reference|rectifiee)\s*(?:n[º°o]?\s*)?[:.]?\s*([A-Za-z0-9][A-Za-z0-9/_-]{5,})/i;
const RE_NUMERO = /(facture\s*d['’]\s*avoir|note\s*de\s*credit|avoir|facture\s*de\s*vente|facture\s*normalis\w*|facture|recu|reçu)\s*(?:n[º°o]?\s*)?[:.]?\s*([A-Za-z0-9][A-Za-z0-9/_-]{5,})/i;

function lireIdentite(lignes) {
  const identite = { type: null, libelleType: null, numero: null, numeroFactureInitiale: null };
  for (const ligne of lignes) {
    let reste = ligne;
    const initiale = reste.match(RE_INITIALE);
    if (initiale && !identite.numeroFactureInitiale) {
      identite.numeroFactureInitiale = initiale[1];
      reste = reste.slice(0, initiale.index) + ' ' + reste.slice(initiale.index + initiale[0].length);
    }
    const numero = reste.match(RE_NUMERO);
    if (numero && !identite.numero) {
      identite.libelleType = normaliserEspaces(numero[1]);
      identite.numero = numero[2];
    }
    if (identite.numero && identite.numeroFactureInitiale) break;
  }
  if (identite.libelleType) {
    const c = cle(identite.libelleType);
    identite.type = /avoir|credit/.test(c) ? 'avoir' : 'vente';
  } else if (identite.numeroFactureInitiale) {
    identite.type = 'avoir';
  }
  return identite;
}

// --------------------------------------------------------- lignes d'article

function trouverColonnes(cellules) {
  const colonnes = {};
  cellules.forEach((cellule, rang) => {
    const c = cle(cellule);
    if (!c) return;
    for (const { cle: nom, motifs } of COLONNES) {
      if (colonnes[nom] != null) continue;
      if (motifs.some((motif) => motif.test(c))) {
        colonnes[nom] = rang;
        return;
      }
    }
  });
  return colonnes;
}

// Les colonnes d'une ligne, qu'elle vienne d'un tableau Markdown (des barres
// verticales) ou d'un PDF mis a plat (deux espaces entre deux colonnes).
function cellulesLigne(ligne) {
  if (estLigneTableau(ligne)) return cellulesDe(ligne);
  const morceaux = ligne.split(/ {2,}/).map(normaliserEspaces);
  return morceaux.length >= 2 ? morceaux : [];
}

// La ligne d'entete du detail : « Ref Designation P.U HT Qte ... Montant HT ».
function estEnteteDetail(ligne) {
  const cellules = cellulesLigne(ligne);
  if (cellules.length < 3) return false;
  const colonnes = trouverColonnes(cellules);
  return colonnes.designation != null
    && (colonnes.montantHT != null || colonnes.prixUnitaireHT != null || colonnes.quantite != null);
}

function lireTaxes(texte) {
  const taxes = [];
  const brut = normaliserEspaces(texte);
  if (!brut) return taxes;
  if (/^(exo|exonere|exon\u00e9r\u00e9|nt|non taxable)/i.test(brut)) return [{ code: 'EXO', taux: 0 }];
  const motif = /([A-Za-z\u00c9\u00c8\u00c0]{2,8})\s*\(?\s*([\d.,]+)\s*%?\s*\)?/g;
  let occurrence;
  while ((occurrence = motif.exec(brut)) !== null) {
    const taux = versNombre(occurrence[2]);
    if (taux == null) continue;
    taxes.push({ code: normaliserEspaces(occurrence[1]).toUpperCase(), taux });
  }
  if (!taxes.length) {
    const taux = versNombre(brut);
    if (taux != null) taxes.push({ code: 'TVA', taux });
  }
  return taxes;
}

function cleTotal(libelle) {
  const c = cle(libelle);
  if (!c) return null;
  for (const { cle: nom, motifs } of TOTAUX) {
    if (motifs.some((motif) => motif.test(c))) return nom;
  }
  return null;
}

// Repli pour un PDF dont les colonnes arrivent collees en une seule chaine :
// REF DESIGNATION P.U QTE UNITE TVA (18) REM MONTANT
const RE_LIGNE_TEXTE = new RegExp(
  '^([A-Za-z0-9][A-Za-z0-9._/-]{1,24})\\s+' +
  '(.{3,80}?)\\s+' +
  '(\\d[\\d ]*(?:[.,]\\d+)?)\\s+' +
  '(\\d+(?:[.,]\\d+)?)\\s+' +
  '([A-Za-z\\u00c0-\\u017f]{1,12})\\s+' +
  '((?:[A-Za-z]{2,8}\\s*\\(\\s*[\\d.,]+\\s*\\)\\s*)+|EXO|EXONERE)\\s+' +
  '(\\d+(?:[.,]\\d+)?)\\s+' +
  '(\\d[\\d ]*(?:[.,]\\d+)?)$'
);

// Une suite de designation : courte, sans etiquette, sans allure de total.
function estSuiteDeDesignation(ligne) {
  const texte = normaliserEspaces(ligne);
  if (!texte || texte.length > 60) return false;
  if (/[:=]/.test(texte)) return false;
  if (estPiedDePage(texte)) return false;
  return cleTotal(texte) == null && !estNumerique(texte);
}

// Le detail de la facture : les lignes d'article puis les totaux.
function lireDetail(lignesZone) {
  const articles = [];
  const totaux = {};
  let colonnes = null;

  const noterTotal = (nom, valeur) => {
    if (nom && valeur != null && totaux[nom] == null) totaux[nom] = valeur;
  };

  for (const ligne of lignesZone) {
    const cellules = cellulesLigne(ligne);

    if (cellules.length < 2) {
      // Une designation trop longue passe a la ligne, sans colonnes ni
      // etiquette. Elle appartient a l'article qui precede.
      const dernier = articles[articles.length - 1];
      if (dernier && !Object.keys(totaux).length && estSuiteDeDesignation(ligne)) {
        dernier.designation = `${dernier.designation || ''} ${normaliserEspaces(ligne)}`.trim();
        continue;
      }
      const trouve = ligne.match(RE_LIGNE_TEXTE);
      if (trouve) {
        articles.push({
          reference: trouve[1],
          designation: normaliserEspaces(trouve[2]),
          prixUnitaireHT: versNombre(trouve[3]),
          quantite: versNombre(trouve[4]),
          unite: trouve[5],
          taxes: lireTaxes(trouve[6]),
          remise: versNombre(trouve[7]) ?? 0,
          montantHT: versNombre(trouve[8]),
          montantTTC: null
        });
        continue;
      }
      const total = ligne.match(/^(.{2,40}?)\s+(-?\d[\d ]*(?:[.,]\d+)?)$/);
      if (total) noterTotal(cleTotal(total[1]), versNombre(total[2]));
      continue;
    }

    if (!colonnes) {
      const candidat = trouverColonnes(cellules);
      if (candidat.designation != null || (candidat.montantHT != null && candidat.quantite != null)) {
        colonnes = candidat;
        continue;
      }
    }

    // Une ligne de totaux : un libelle reconnu, un montant a droite. Sans
    // montant, c'est l'entete du tableau, pas un total.
    const libelle = cellules.some(estNumerique) ? cellules.find((cellule) => cleTotal(cellule)) : null;
    if (libelle) {
      const montants = cellules.map(versNombre).filter((n) => n != null);
      if (montants.length) noterTotal(cleTotal(libelle), montants[montants.length - 1]);
      continue;
    }

    if (!colonnes) continue;
    const cellule = (nom) => (colonnes[nom] != null ? cellules[colonnes[nom]] || '' : '');
    const designation = normaliserEspaces(cellule('designation'));
    const montantHT = versNombre(cellule('montantHT'));
    const quantite = versNombre(cellule('quantite'));
    if (!designation && montantHT == null) continue;
    if (!designation && quantite == null) continue;
    articles.push({
      reference: normaliserEspaces(cellule('reference')) || null,
      designation: designation || null,
      prixUnitaireHT: versNombre(cellule('prixUnitaireHT')),
      quantite,
      unite: normaliserEspaces(cellule('unite')) || null,
      taxes: lireTaxes(cellule('taxes')),
      remise: versNombre(cellule('remise')) ?? 0,
      montantHT,
      montantTTC: versNombre(cellule('montantTTC'))
    });
  }

  return { articles, totaux };
}

// ------------------------------------------------------------ resume taxes

function lireResume(lignesZone) {
  const resume = [];
  for (const ligne of lignesZone) {
    // Les memes colonnes que partout ailleurs : normaliserEspaces ecraserait
    // les deux espaces qui separent justement les colonnes d'un PDF.
    const cellules = cellulesLigne(ligne);
    if (cellules.length < 3) continue;
    const libelle = normaliserEspaces(cellules[0]);
    if (!libelle || estNumerique(libelle)) continue;
    if (/categorie|sous-total|taux|total taxes/i.test(cle(libelle)) && cellules.slice(1).every((c) => versNombre(c) == null)) continue;
    const nombres = cellules.slice(1).map(versNombre);
    const montant = [...nombres].reverse().find((n) => n != null);
    if (montant == null) continue;
    const base = nombres.find((n) => n != null);
    let taux = null;
    const tauxEcrit = cellules.slice(1).find((c) => /%/.test(c));
    if (tauxEcrit) taux = versNombre(tauxEcrit);
    else {
      const tauxDuLibelle = libelle.match(/(\d+(?:[.,]\d+)?)\s*%/);
      if (tauxDuLibelle) taux = versNombre(tauxDuLibelle[1]);
    }
    resume.push({ libelle, base, taux, montant });
  }
  return resume;
}

// -------------------------------------------------------------- assemblage

function nonVide(valeur) {
  const texte = normaliserEspaces(valeur);
  return texte ? texte : null;
}

function nettoyerRccm(valeur) {
  return nonVide(String(valeur == null ? '' : valeur).replace(/\s+du\s*$/i, ''));
}

// L'adresse de verification de la DGI et le jeton qu'elle porte. Sur une
// facture normalisee, ils ne sont ecrits nulle part en clair : seul le QR les
// donne. Le dernier segment de l'adresse est le jeton du sticker electronique.
// Un jeton porte des chiffres : sans cela, « verification » ou « facture »,
// simples mots du chemin, passeraient pour des stickers.
const RE_JETON = /^(?=.*\d)[A-Za-z0-9][A-Za-z0-9._-]{7,}$/;

function lireCodeVerification(charge) {
  const texte = normaliserEspaces(charge);
  if (!texte) return null;
  if (!/^https?:\/\//i.test(texte)) return { url: null, sticker: texte };
  const url = texte.replace(/[).,;]+$/, '');
  let sticker = null;
  try {
    const segments = new URL(url).pathname.split('/').filter(Boolean);
    const dernier = segments[segments.length - 1];
    if (dernier && RE_JETON.test(dernier)) sticker = dernier;
  } catch (erreur) {
    return { url, sticker: null };
  }
  return { url, sticker };
}

function chercherVerification(lignes, codes) {
  const verification = { codeVerification: null, sticker: null, url: null };
  // Le QR fait foi : c'est la piece que la DGI a apposee.
  for (const charge of codes || []) {
    const lu = lireCodeVerification(charge);
    if (!lu) continue;
    if (lu.url && !verification.url) verification.url = lu.url;
    if (lu.sticker && !verification.sticker) verification.sticker = lu.sticker;
    if (!lu.url && !verification.codeVerification) verification.codeVerification = lu.sticker;
  }
  if (!verification.url) {
    for (const ligne of lignes) {
      const url = ligne.match(/https?:\/\/\S+/i);
      if (url) {
        verification.url = url[0].replace(/[).,;]+$/, '');
        break;
      }
    }
  }
  return verification;
}

function analyser(texte, options = {}) {
  const lignes = enLignes(texte);
  const { zones, origine } = decouper(lignes);
  const consommees = new Set();
  const marquer = (zone) => origine[zone].forEach((rang) => consommees.add(rang));

  const identite = lireIdentite([...zones.entete, ...zones.client, ...zones.pied]);
  // Sur un PDF, les colonnes du vendeur et du client s'entremelent : les
  // etiquettes qui ne peuvent etre que celles du vendeur lui reviennent, meme
  // lues sous le titre « Client ». L'entete garde le dernier mot.
  const vendeur = { ...extraireChamps(zones.client, VENDEUR_SEUL), ...extraireChamps(zones.entete, VENDEUR) };
  const client = extraireChamps(zones.client, CLIENT);
  const documentEntete = extraireChamps([...zones.entete, ...zones.client, ...zones.pied], DOCUMENT);
  const piedVendeur = extraireChamps(zones.pied, VENDEUR);

  const detail = lireDetail(zones.lignes);
  const articles = detail.articles;
  const totauxLus = detail.totaux;
  const resume = lireResume(zones.resume);
  marquer('lignes');
  marquer('resume');

  // Les lignes d'entete entierement faites d'etiquettes connues sont lues.
  ['entete', 'client', 'pied'].forEach((zone) => {
    zones[zone].forEach((ligne, rang) => {
      if (ligneEntierementLue(ligne, TOUTES) || RE_NUMERO.test(ligne)) {
        consommees.add(origine[zone][rang]);
      }
    });
  });

  const date = versDate(documentEntete.date);
  const facture = {
    meta: {
      source: options.source || null,
      format: options.format || null,
      extraitLe: options.extraitLe || new Date().toISOString(),
      outil: 'SFNe'
    },
    document: {
      type: identite.type || 'vente',
      libelleType: identite.libelleType || (identite.type === 'avoir' ? "Facture d'avoir" : 'Facture'),
      numero: identite.numero,
      numeroFactureInitiale: identite.numeroFactureInitiale,
      date,
      echeance: versDate(documentEntete.echeance),
      modePaiement: nonVide(documentEntete.modePaiement),
      devise: nonVide(documentEntete.devise) || DEVISE_PAR_DEFAUT,
      bonCommande: nonVide(documentEntete.bonCommande),
      natureOperation: nonVide(documentEntete.natureOperation)
    },
    vendeur: {
      raisonSociale: nonVide(vendeur.raisonSociale),
      adresse: nonVide(vendeur.adresse),
      telephone: nonVide(vendeur.telephone),
      mail: nonVide(vendeur.mail),
      ncc: nonVide(vendeur.ncc),
      rccm: nettoyerRccm(vendeur.rccm || piedVendeur.rccm),
      regimeImposition: nonVide(vendeur.regimeImposition),
      nomVendeur: nonVide(vendeur.nomVendeur),
      pointDeVente: nonVide(vendeur.pointDeVente),
      centreImpots: nonVide(vendeur.centreImpots),
      siegeSocial: nonVide(vendeur.siegeSocial || piedVendeur.siegeSocial),
      referencesBancaires: nonVide(vendeur.referencesBancaires || piedVendeur.referencesBancaires)
    },
    client: {
      nom: nonVide(client.nom),
      adresse: nonVide(client.adresse),
      telephone: nonVide(client.telephone),
      mail: nonVide(client.mail),
      ncc: nonVide(client.ncc),
      regimeImposition: nonVide(client.regimeImposition),
      code: nonVide(client.code)
    },
    lignes: articles,
    totaux: {
      totalHT: totauxLus.totalHT ?? null,
      remiseGlobale: totauxLus.remiseGlobale ?? null,
      totalTVA: totauxLus.totalTVA ?? null,
      autresTaxes: totauxLus.autresTaxes ?? null,
      totalTTC: totauxLus.totalTTC ?? null,
      avance: totauxLus.avance ?? null,
      netAPayer: totauxLus.netAPayer ?? null
    },
    taxes: resume,
    verification: (() => {
      const lu = chercherVerification(lignes, options.codes);
      return {
        codeVerification: nonVide(documentEntete.codeVerification) || lu.codeVerification,
        sticker: nonVide(documentEntete.sticker) || lu.sticker,
        url: nonVide(documentEntete.urlVerification) || lu.url,
        // Ce que la DGI a repondu, quand la verification est branchee.
        etat: null,
        verifieLe: null
      };
    })(),
    pied: zones.pied.filter((ligne) => !estLigneTableau(ligne)),
    nonLues: lignes.filter((ligne, rang) =>
      !consommees.has(rang) && !estLigneTableau(ligne) && !estEnteteClient(ligne) && !estEnteteResume(ligne))
  };

  return facture;
}

module.exports = { analyser, decouper, lireDetail, lireCodeVerification, lireTaxes, lireResume, cleTotal, cellulesLigne };
