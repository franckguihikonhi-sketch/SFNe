'use strict';

// Controle d'une facture lue : l'arithmetique d'abord, les mentions ensuite.
//
// Une facture normalisee electronique doit se tenir toute seule : la somme des
// lignes fait le total hors taxes, la TVA se retrouve taux par taux, et le
// total a payer decoule des deux. Quand une valeur lue ne colle pas, on le dit
// plutot que de la corriger en silence : c'est le document qui fait foi.

const { formaterMontant } = require('./texte');

const TOLERANCE = 1; // un franc CFA, l'arrondi de la ligne

function arrondi(valeur) {
  return Math.round((valeur + Number.EPSILON) * 100) / 100;
}

function auFranc(valeur) {
  return Math.round(valeur + Number.EPSILON);
}

function ecartAcceptable(attendu, constate, tolerance = TOLERANCE) {
  if (attendu == null || constate == null) return true;
  return Math.abs(attendu - constate) <= tolerance;
}

function tauxPrincipal(ligne) {
  const tva = (ligne.taxes || []).find((taxe) => /tva/i.test(taxe.code));
  if (tva) return tva.taux;
  const premiere = (ligne.taxes || [])[0];
  return premiere ? premiere.taux : null;
}

// Montant hors taxes recalcule depuis le prix unitaire, la quantite et la remise.
function montantAttendu(ligne) {
  if (ligne.prixUnitaireHT == null || ligne.quantite == null) return null;
  const remise = ligne.remise == null ? 0 : ligne.remise;
  return auFranc(ligne.prixUnitaireHT * ligne.quantite * (1 - remise / 100));
}

// Bases et taxes par taux, calculees depuis les lignes.
function ventilation(facture) {
  const parTaux = new Map();
  for (const ligne of facture.lignes || []) {
    const taux = tauxPrincipal(ligne);
    if (taux == null || ligne.montantHT == null) continue;
    const courant = parTaux.get(taux) || { taux, base: 0, montant: 0 };
    courant.base += ligne.montantHT;
    parTaux.set(taux, courant);
  }
  for (const entree of parTaux.values()) {
    entree.base = auFranc(entree.base);
    entree.montant = auFranc((entree.base * entree.taux) / 100);
  }
  return [...parTaux.values()].sort((a, b) => a.taux - b.taux);
}

function controle(code, niveau, libelle, details = {}) {
  return { code, niveau, libelle, ...details };
}

function controlerArithmetique(facture) {
  const resultats = [];
  const devise = facture.document.devise;
  const montant = (valeur) => formaterMontant(valeur, devise);

  (facture.lignes || []).forEach((ligne, rang) => {
    const attendu = montantAttendu(ligne);
    if (attendu == null || ligne.montantHT == null) return;
    const numero = rang + 1;
    if (ecartAcceptable(attendu, ligne.montantHT)) {
      resultats.push(controle(`ligne-${numero}`, 'ok', `Ligne ${numero} : montant HT conforme au prix unitaire, à la quantité et à la remise`));
      return;
    }
    // Beaucoup de factures affichent un prix unitaire arrondi au franc alors
    // que le montant de la ligne est calcule sur le prix exact. L'ecart tient
    // alors dans la moitie d'un franc par unite : la ligne reste juste.
    const marge = Math.abs(ligne.quantite || 0) / 2 + TOLERANCE;
    if (Math.abs(attendu - ligne.montantHT) <= marge && ligne.quantite) {
      const reel = arrondi(ligne.montantHT / ligne.quantite / (1 - (ligne.remise || 0) / 100));
      resultats.push(controle(`ligne-${numero}`, 'ok', `Ligne ${numero} : montant HT conforme, prix unitaire affiché arrondi`, {
        note: `prix unitaire réel ${formaterMontant(reel, facture.document.devise)}, affiché ${montant(ligne.prixUnitaireHT)}`
      }));
      return;
    }
    resultats.push(controle(`ligne-${numero}`, 'erreur', `Ligne ${numero} : le montant HT ne suit pas le calcul`, {
      attendu: montant(attendu), constate: montant(ligne.montantHT)
    }));
  });

  const lignesChiffrees = (facture.lignes || []).filter((ligne) => ligne.montantHT != null);
  if (lignesChiffrees.length && facture.totaux.totalHT != null) {
    const somme = auFranc(lignesChiffrees.reduce((total, ligne) => total + ligne.montantHT, 0));
    const remise = facture.totaux.remiseGlobale || 0;
    const attendu = auFranc(somme - remise);
    resultats.push(ecartAcceptable(attendu, facture.totaux.totalHT, lignesChiffrees.length)
      ? controle('total-ht', 'ok', 'Total HT égal à la somme des lignes')
      : controle('total-ht', 'erreur', 'Total HT différent de la somme des lignes', {
        attendu: montant(attendu), constate: montant(facture.totaux.totalHT)
      }));
  }

  const parTaux = ventilation(facture);
  if (parTaux.length && facture.totaux.totalTVA != null) {
    const attendu = auFranc(parTaux.reduce((total, entree) => total + entree.montant, 0));
    resultats.push(ecartAcceptable(attendu, facture.totaux.totalTVA, parTaux.length)
      ? controle('total-tva', 'ok', 'TVA égale au calcul taux par taux')
      : controle('total-tva', 'attention', 'TVA différente du calcul taux par taux', {
        attendu: montant(attendu), constate: montant(facture.totaux.totalTVA)
      }));
  }

  for (const entree of parTaux) {
    const declare = (facture.taxes || []).find((taxe) => taxe.taux === entree.taux);
    if (!declare) continue;
    if (declare.base != null && !ecartAcceptable(entree.base, declare.base)) {
      resultats.push(controle(`base-${entree.taux}`, 'attention', `Base à ${entree.taux} % différente du résumé`, {
        attendu: montant(entree.base), constate: montant(declare.base)
      }));
    }
    if (declare.montant != null && !ecartAcceptable(entree.montant, declare.montant)) {
      resultats.push(controle(`taxe-${entree.taux}`, 'attention', `Taxe à ${entree.taux} % différente du résumé`, {
        attendu: montant(entree.montant), constate: montant(declare.montant)
      }));
    }
  }

  const { totalHT, totalTVA, autresTaxes, totalTTC, netAPayer, avance } = facture.totaux;
  if (totalHT != null && totalTVA != null && totalTTC != null) {
    const attendu = auFranc(totalHT + totalTVA + (autresTaxes || 0));
    resultats.push(ecartAcceptable(attendu, totalTTC)
      ? controle('total-ttc', 'ok', 'Total TTC égal au HT augmenté des taxes')
      : controle('total-ttc', 'erreur', 'Total TTC différent du HT augmenté des taxes', {
        attendu: montant(attendu), constate: montant(totalTTC)
      }));
  }
  if (totalTTC != null && netAPayer != null) {
    const attendu = auFranc(totalTTC - (avance || 0));
    resultats.push(ecartAcceptable(attendu, netAPayer)
      ? controle('net-a-payer', 'ok', 'Total à payer égal au TTC diminué des avances')
      : controle('net-a-payer', 'erreur', 'Total à payer différent du TTC diminué des avances', {
        attendu: montant(attendu), constate: montant(netAPayer)
      }));
  }

  return resultats;
}

// Les mentions que la facture normalisee doit porter. Absente, la mention est
// signalee : le fichier Markdown produit ne peut pas l'inventer.
const MENTIONS = [
  { code: 'numero', libelle: 'Numéro de facture', valeur: (f) => f.document.numero, niveau: 'erreur' },
  { code: 'date', libelle: 'Date et heure de facturation', valeur: (f) => f.document.date && f.document.date.brut, niveau: 'erreur' },
  { code: 'vendeur', libelle: 'Identité du vendeur', valeur: (f) => f.vendeur.raisonSociale, niveau: 'erreur' },
  { code: 'vendeur-ncc', libelle: 'NCC du vendeur', valeur: (f) => f.vendeur.ncc, niveau: 'attention' },
  { code: 'vendeur-rccm', libelle: 'RCCM du vendeur', valeur: (f) => f.vendeur.rccm, niveau: 'attention' },
  { code: 'vendeur-contact', libelle: 'Contact du vendeur (téléphone ou courriel)', valeur: (f) => f.vendeur.telephone || f.vendeur.mail, niveau: 'attention' },
  { code: 'point-de-vente', libelle: 'Point de vente', valeur: (f) => f.vendeur.pointDeVente, niveau: 'attention' },
  { code: 'client', libelle: 'Identité du client', valeur: (f) => f.client.nom, niveau: 'erreur' },
  { code: 'client-ncc', libelle: 'NCC du client', valeur: (f) => f.client.ncc, niveau: 'attention' },
  { code: 'client-regime', libelle: "Régime d'imposition du client", valeur: (f) => f.client.regimeImposition, niveau: 'attention' },
  { code: 'mode-paiement', libelle: 'Mode de paiement', valeur: (f) => f.document.modePaiement, niveau: 'attention' },
  { code: 'lignes', libelle: 'Au moins une ligne de facturation', valeur: (f) => (f.lignes || []).length || null, niveau: 'erreur' },
  { code: 'total-a-payer', libelle: 'Total à payer', valeur: (f) => f.totaux.netAPayer ?? f.totaux.totalTTC, niveau: 'erreur' }
];

function controlerMentions(facture) {
  const resultats = MENTIONS.map(({ code, libelle, valeur, niveau }) => {
    const present = valeur(facture) != null && valeur(facture) !== '';
    return controle(`mention-${code}`, present ? 'ok' : niveau, `${libelle}${present ? '' : ' : absent du document'}`);
  });

  (facture.lignes || []).forEach((ligne, rang) => {
    const numero = rang + 1;
    if (!ligne.designation) {
      resultats.push(controle(`ligne-${numero}-designation`, 'erreur', `Ligne ${numero} : désignation absente`));
    }
    if (tauxPrincipal(ligne) == null) {
      resultats.push(controle(`ligne-${numero}-taxe`, 'attention', `Ligne ${numero} : aucun taux de taxe lisible`));
    }
  });

  // Le QR de verification ne survit pas a une conversion du PDF en texte :
  // on ne le reclame que la ou il devrait se trouver.
  if (facture.meta.format === 'pdf') {
    const verification = facture.verification || {};
    const present = Boolean(verification.sticker || verification.url);
    resultats.push(controle('mention-sticker', present ? 'ok' : 'attention',
      present ? 'Sticker électronique : QR de vérification présent'
        : 'QR de vérification absent du PDF : le sticker électronique ne peut pas être relu'));
  }

  // Ce que la DGI a repondu, quand la verification est branchee.
  const VERDICTS = {
    verifiee: ['ok', 'Sticker vérifié auprès de la DGI'],
    discordante: ['erreur', 'La DGI ne dit pas la même chose que la facture'],
    inconnue: ['erreur', 'Sticker inconnu du registre de la DGI'],
    indisponible: ['attention', 'Vérification auprès de la DGI indisponible']
  };
  const verdict = VERDICTS[(facture.verification || {}).etat];
  if (verdict) {
    const [niveau, libelle] = verdict;
    resultats.push(controle('verification-dgi', niveau, libelle,
      facture.verification.details ? { note: facture.verification.details } : {}));
  }

  if (facture.document.type === 'avoir' && !facture.document.numeroFactureInitiale) {
    resultats.push(controle('avoir-facture-initiale', 'erreur', "Facture d'avoir sans référence à la facture initiale"));
  }

  if ((facture.nonLues || []).length) {
    resultats.push(controle('lignes-non-lues', 'attention',
      `${facture.nonLues.length} ligne(s) du document n'ont pas été rattachées à un champ connu`));
  }

  return resultats;
}

function controler(facture) {
  const controles = [...controlerArithmetique(facture), ...controlerMentions(facture)];
  const compte = { ok: 0, attention: 0, erreur: 0 };
  for (const item of controles) compte[item.niveau] += 1;
  return {
    controles,
    compte,
    conforme: compte.erreur === 0,
    ventilation: ventilation(facture)
  };
}

module.exports = { controler, ventilation, montantAttendu, tauxPrincipal, arrondi, auFranc };
