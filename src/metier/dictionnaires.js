'use strict';

// Les etiquettes rencontrees sur les factures normalisees electroniques.
// Chaque cle porte ses variantes : les editeurs de facturation n'ecrivent pas
// tous la meme chose, et l'accentuation ne compte pas.

const VENDEUR = {
  raisonSociale: ['Etablissement', 'Établissement', 'Raison sociale', 'Entreprise', 'Fournisseur', 'Emetteur', 'Émetteur'],
  adresse: ['Adresse'],
  telephone: ['Nº Tel', 'N° Tel', 'No Tel', 'N Tel', 'Nº Telephone', 'Tel', 'Tél', 'Telephone', 'Téléphone', 'Contact'],
  mail: ['Mail', 'Email', 'E-mail', 'Courriel'],
  ncc: ['NCC', 'Numero de compte contribuable', 'Numéro de compte contribuable', 'N° CC'],
  rccm: ['RCCM', 'Registre du commerce'],
  regimeImposition: ["Regime d'imposition", "Régime d'imposition", 'Regime', 'Régime'],
  nomVendeur: ['Nom du vendeur', 'Vendeur', 'Caissier', 'Agent'],
  pointDeVente: ['Nom de PDV', 'Point de vente', 'PDV', 'Etablissement de vente'],
  referencesBancaires: ['References bancaires', 'Références bancaires', 'Banque', 'Compte bancaire'],
  siegeSocial: ['Siege Social', 'Siège Social', 'Siege social', 'Siège social']
};

const CLIENT = {
  nom: ['Nom', 'Raison sociale', 'Client', 'Nom du client', 'Denomination', 'Dénomination'],
  adresse: ['Adresse', 'Adresse du client'],
  telephone: ['Nº Tel', 'N° Tel', 'No Tel', 'N Tel', 'Tel', 'Tél', 'Telephone', 'Téléphone'],
  mail: ['Mail', 'Email', 'E-mail', 'Courriel'],
  ncc: ['NCC', 'Numero de compte contribuable', 'Numéro de compte contribuable', 'N° CC'],
  regimeImposition: ["Regime d'imposition", "Régime d'imposition", 'Regime', 'Régime'],
  code: ['Code client', 'Reference client', 'Référence client']
};

const DOCUMENT = {
  date: ['Date et heure', 'Date', 'Date de facturation', 'Date d\'emission', 'Date d\'émission'],
  modePaiement: ['Mode de paiement', 'Mode de reglement', 'Mode de règlement', 'Paiement', 'Reglement', 'Règlement'],
  devise: ['Devise', 'Monnaie'],
  echeance: ['Echeance', 'Échéance', 'Date d\'echeance', 'Date d\'échéance'],
  bonCommande: ['Bon de commande', 'BC', 'Commande', 'Reference commande', 'Référence commande'],
  natureOperation: ['Nature de l\'operation', 'Nature de l\'opération', 'Objet', 'Motif'],
  codeVerification: ['Code de verification', 'Code de vérification', 'Code securite', 'Code sécurité', 'Signature electronique', 'Signature électronique'],
  sticker: ['Sticker', 'Numero de sticker', 'Numéro de sticker', 'Sticker electronique', 'Sticker électronique', 'Jeton', 'Token'],
  urlVerification: ['Lien de verification', 'Lien de vérification', 'Verification', 'Vérification', 'URL']
};

// Les libelles de la colonne des totaux, ramenes a une cle unique.
const TOTAUX = [
  { cle: 'totalHT', motifs: [/^total\s*h\.?t\.?$/, /^montant\s*h\.?t\.?$/, /^total\s*brut\s*h\.?t\.?$/, /^base\s*h\.?t\.?$/] },
  { cle: 'remiseGlobale', motifs: [/^remise/, /^rabais/] },
  { cle: 'totalTVA', motifs: [/^t\.?v\.?a\.?$/, /^total\s*t\.?v\.?a\.?$/, /^montant\s*t\.?v\.?a\.?$/] },
  { cle: 'totalTTC', motifs: [/^total\s*t\.?t\.?c\.?$/, /^montant\s*t\.?t\.?c\.?$/] },
  { cle: 'autresTaxes', motifs: [/^autres\s*taxes$/, /^autres\s*taxes\s*et\s*droits$/] },
  { cle: 'netAPayer', motifs: [/^total\s*a\s*payer$/, /^net\s*a\s*payer$/, /^a\s*payer$/, /^total\s*du$/] },
  { cle: 'avance', motifs: [/^avance/, /^acompte/, /^deja\s*regle/] }
];

// Les entetes de la table des lignes, ramenes a une cle de colonne.
const COLONNES = [
  { cle: 'reference', motifs: [/^ref/, /^code$/, /^article$/] },
  { cle: 'designation', motifs: [/designation/, /libelle/, /description/, /^produit/] },
  { cle: 'prixUnitaireHT', motifs: [/^p\.?\s*u\.?\s*h\.?t/, /prix\s*unitaire/, /^p\.?\s*u\.?$/] },
  { cle: 'quantite', motifs: [/^qte/, /quantite/, /^qty$/] },
  { cle: 'unite', motifs: [/^unite/, /^u$/] },
  { cle: 'taxes', motifs: [/taxe/, /^tva/] },
  { cle: 'remise', motifs: [/^rem/, /remise/] },
  { cle: 'montantHT', motifs: [/montant\s*h\.?t/, /^total\s*h\.?t/, /^montant$/] },
  { cle: 'montantTTC', motifs: [/montant\s*t\.?t\.?c/, /^total\s*t\.?t\.?c/] }
];

module.exports = { VENDEUR, CLIENT, DOCUMENT, TOTAUX, COLONNES };
