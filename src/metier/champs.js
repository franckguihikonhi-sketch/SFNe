'use strict';

// Lecture des champs etiquetes d'une facture.
//
// Sur une facture FNE, plusieurs champs se suivent sur la meme ligne :
//
//   Mail : x@y.ci Nom du vendeur : VENDEUR DEMO Nom de PDV : SIEGE
//
// Le PDF met ces champs cote a cote, le texte les recolle. On repere donc
// toutes les etiquettes connues d'une ligne, puis la valeur de chacune est ce
// qui la separe de l'etiquette suivante.

const { normaliserEspaces, sansAccent } = require('./texte');

function echapper(texte) {
  return texte.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Le « o » ordinal des factures (Nº) et le degre (N°) valent la meme chose.
function pourComparaison(texte) {
  return sansAccent(String(texte))
    .toLowerCase()
    .replace(/[º°⁰]/g, '°');
}

function motifDe(variante) {
  return echapper(pourComparaison(variante)).replace(/\s+/g, '\\s*');
}

function compiler(dictionnaire) {
  const variantes = [];
  for (const [cle, formes] of Object.entries(dictionnaire)) {
    for (const forme of formes) variantes.push({ cle, motif: motifDe(forme), taille: forme.length });
  }
  // Les etiquettes longues passent avant les courtes : « Nom du vendeur »
  // doit gagner contre « Nom ».
  variantes.sort((a, b) => b.taille - a.taille);
  const alternance = variantes.map((v) => `(?:${v.motif})`).join('|');
  return {
    variantes,
    motif: new RegExp(`(?:^|[\\s|(])(${alternance})\\s*[:=]`, 'g')
  };
}

function cleDe(compile, etiquette) {
  const cible = pourComparaison(etiquette);
  for (const variante of compile.variantes) {
    if (new RegExp(`^(?:${variante.motif})$`).test(cible)) return variante.cle;
  }
  return null;
}

function nettoyerValeur(valeur) {
  return normaliserEspaces(valeur)
    .replace(/^[|:;,.\-–]+/, '')
    .replace(/[|;,\-–]+$/, '')
    .trim();
}

// Rend [{ cle, valeur, debut }] dans l'ordre de la ligne.
function champsDeLigne(ligne, compile) {
  const cible = pourComparaison(ligne);
  const trouves = [];
  compile.motif.lastIndex = 0;
  let occurrence;
  while ((occurrence = compile.motif.exec(cible)) !== null) {
    const cle = cleDe(compile, occurrence[1]);
    if (!cle) continue;
    trouves.push({ cle, debut: occurrence.index, fin: occurrence.index + occurrence[0].length });
    compile.motif.lastIndex = occurrence.index + occurrence[0].length;
  }
  return trouves.map((champ, rang) => {
    const suivant = trouves[rang + 1];
    const valeur = ligne.slice(champ.fin, suivant ? suivant.debut : ligne.length);
    return { cle: champ.cle, valeur: nettoyerValeur(valeur), debut: champ.debut };
  });
}

// Applique un dictionnaire a un jeu de lignes. La premiere valeur non vide
// gagne : une facture repete parfois une etiquette dans son pied de page.
function extraireChamps(lignes, dictionnaire) {
  const compile = compiler(dictionnaire);
  const resultat = {};
  for (const ligne of lignes) {
    for (const champ of champsDeLigne(ligne, compile)) {
      if (champ.valeur && resultat[champ.cle] == null) resultat[champ.cle] = champ.valeur;
    }
  }
  return resultat;
}

// Vrai si la ligne ne porte que des etiquettes connues et leurs valeurs :
// elle est alors entierement consommee, et ne sera pas signalee comme non lue.
function ligneEntierementLue(ligne, dictionnaire) {
  const compile = compiler(dictionnaire);
  const champs = champsDeLigne(ligne, compile);
  if (!champs.length) return false;
  return normaliserEspaces(ligne.slice(0, champs[0].debut)) === '';
}

module.exports = { compiler, champsDeLigne, extraireChamps, ligneEntierementLue, pourComparaison };
