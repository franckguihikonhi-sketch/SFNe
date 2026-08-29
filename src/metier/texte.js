'use strict';

// Nettoyage et lecture du texte brut d'une facture FNE.
//
// Le texte peut venir de trois endroits : le contenu d'un PDF, un fichier
// Markdown produit par un convertisseur, ou du texte simple. On ramene tout a
// une liste de lignes propres avant de chercher quoi que ce soit.

const ESPACES = /[\u00a0\u202f\u2009\u2007\u2008\u2000-\u200b\ufeff\t]/g;
const ESPACES_SANS_TABULATION = /[\u00a0\u202f\u2009\u2007\u2008\u2000-\u200b\ufeff]/g;

function normaliserEspaces(texte) {
  return String(texte == null ? '' : texte)
    .replace(ESPACES, ' ')
    .replace(/ {2,}/g, ' ')
    .trim();
}

// Les convertisseurs PDF vers Markdown echappent la ponctuation et posent du
// gras un peu partout. Rien de tout cela ne porte de sens ici.
function retirerMarkdown(ligne) {
  return String(ligne == null ? '' : ligne)
    .replace(/!\[[^\]]*\]\[[^\]]*\]/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\(mailto:([^)]*)\)/gi, (tout, texte, adresse) => texte || adresse)
    .replace(/\[([^\]]*)\]\(tel:([^)]*)\)/gi, (tout, texte, numero) => texte || numero)
    .replace(/\[([^\]]*)\]\(([^)]*)\)/g, (tout, texte, cible) => (texte.trim() ? texte : cible))
    .replace(/\\([\\`*_{}[\]()#+\-.!|~<>])/g, '$1')
    .replace(/\*\*/g, '')
    .replace(/(^|\s)[*_]([^*_]+)[*_](?=\s|$)/g, '$1$2')
    .replace(/^\s{0,3}#{1,6}\s*/, '')
    .replace(/^\s*>\s?/, '');
}

// Une ligne de facture garde la trace de ses colonnes : dans un PDF mis a plat
// comme dans un tableau tabule, deux espaces separent deux colonnes. On ramene
// donc tout ecart a exactement deux espaces au lieu de tout ecraser.
function normaliserLigne(texte) {
  return String(texte == null ? '' : texte)
    .replace(/\t/g, '  ')
    .replace(ESPACES_SANS_TABULATION, ' ')
    .replace(/ {3,}/g, '  ')
    .trim();
}

// Les references d'image et les donnees encodees en base64 que laissent les
// convertisseurs PDF vers Markdown ne portent aucune information de facture.
function estBruitMarkdown(ligne) {
  if (/^\[[^\]]+\]:\s*[<(]?(data:|https?:)/i.test(ligne)) return true;
  if (/data:image\/[a-z]+;base64/i.test(ligne)) return true;
  if (/^[A-Za-z0-9+/=]{200,}$/.test(ligne)) return true;
  return false;
}

// Vrai si la cellule ne contient qu'un nombre, eventuellement suivi d'une
// unite monetaire ou d'un pourcentage. « 21 546 » oui, « TVA 18,00% - A » non.
function estNumerique(valeur) {
  const texte = normaliserEspaces(valeur);
  if (!texte) return false;
  return /^-?\(?\d[\d\s.,]*\)?\s*(%|F\s?CFA|FCFA|XOF|EUR|USD|€|\$)?$/i.test(texte) && versNombre(texte) != null;
}

// Un separateur de tableau Markdown : | :---- | ----: |
function estSeparateurTableau(ligne) {
  return /^\|?[\s:|-]*\|[\s:|-]*$/.test(ligne) && /-{2,}/.test(ligne);
}

function estLigneTableau(ligne) {
  return ligne.startsWith('|') && ligne.includes('|', 1);
}

// Une barre verticale echappee appartient au texte de la cellule, pas au
// tableau : « RIZ 5\|10 » est une seule colonne.
function cellulesDe(ligne) {
  let brut = ligne.trim();
  if (brut.startsWith('|')) brut = brut.slice(1);
  if (/(?<!\\)\|$/.test(brut)) brut = brut.slice(0, -1);
  return brut.split(/(?<!\\)\|/).map((cellule) => normaliserEspaces(retirerMarkdown(cellule)));
}

// Decoupe le document en lignes exploitables. On garde la forme des lignes de
// tableau (les barres verticales) : l'analyse s'en sert pour lire les colonnes.
function enLignes(texte) {
  const lignes = [];
  for (const brute of String(texte == null ? '' : texte).split(/\r\n|\r|\n/)) {
    const sansEspaces = normaliserLigne(brute);
    if (!sansEspaces) continue;
    if (estSeparateurTableau(sansEspaces)) continue;
    if (estBruitMarkdown(sansEspaces)) continue;
    const propre = estLigneTableau(sansEspaces)
      ? '| ' + cellulesDe(sansEspaces).map((cellule) => cellule.replace(/\|/g, '\\|')).join(' | ') + ' |'
      : normaliserLigne(retirerMarkdown(sansEspaces));
    if (propre) lignes.push(propre);
  }
  return lignes;
}

// « 21 546 » -> 21546, « 1 077,50 » -> 1077.5, « 18,00% » -> 18.
// Le franc CFA n'a pas de subdivision, mais un prix unitaire peut en porter.
function versNombre(valeur) {
  if (typeof valeur === 'number') return Number.isFinite(valeur) ? valeur : null;
  if (valeur == null) return null;
  let texte = normaliserEspaces(valeur).replace(/%/g, '').replace(/\s/g, '');
  if (!texte) return null;
  const negatif = /^\(.*\)$/.test(texte) || texte.startsWith('-');
  texte = texte.replace(/^[-(]/, '').replace(/\)$/, '');
  texte = texte.replace(/[^\d.,]/g, '');
  if (!texte) return null;
  const virgule = texte.lastIndexOf(',');
  const point = texte.lastIndexOf('.');
  if (virgule >= 0 && point >= 0) {
    // Le dernier separateur rencontre est celui des decimales.
    if (virgule > point) texte = texte.replace(/\./g, '').replace(',', '.');
    else texte = texte.replace(/,/g, '');
  } else if (virgule >= 0) {
    texte = /^\d{1,3}(,\d{3})+$/.test(texte) ? texte.replace(/,/g, '') : texte.replace(',', '.');
  } else if (point >= 0) {
    if (/^\d{1,3}(\.\d{3})+$/.test(texte)) texte = texte.replace(/\./g, '');
  }
  const nombre = Number(texte);
  if (!Number.isFinite(nombre)) return null;
  return negatif ? -nombre : nombre;
}

const MOIS = {
  janvier: 1, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6,
  juillet: 7, aout: 8, septembre: 9, octobre: 10, novembre: 11, decembre: 12
};

function sansAccent(texte) {
  return String(texte).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// Rend { brut, iso } ou null. Les factures FNE portent « jj/mm/aaaa hh:mm:ss ».
function versDate(valeur) {
  const brut = normaliserEspaces(valeur);
  if (!brut) return null;
  const heure = brut.match(/(\d{1,2})\s*[:hH]\s*(\d{2})(?:\s*[:m]?\s*(\d{2}))?/);
  const hh = heure ? Number(heure[1]) : 0;
  const mm = heure ? Number(heure[2]) : 0;
  const ss = heure && heure[3] ? Number(heure[3]) : 0;

  let annee = null;
  let mois = null;
  let jour = null;

  const iso = brut.match(/(\d{4})-(\d{2})-(\d{2})/);
  const francais = brut.match(/(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})/);
  const litteral = sansAccent(brut.toLowerCase()).match(/(\d{1,2})\s+([a-z]+)\s+(\d{4})/);

  if (iso) {
    [, annee, mois, jour] = iso.map(Number);
  } else if (francais) {
    jour = Number(francais[1]);
    mois = Number(francais[2]);
    annee = Number(francais[3]);
    if (annee < 100) annee += annee > 70 ? 1900 : 2000;
  } else if (litteral && MOIS[litteral[2]]) {
    jour = Number(litteral[1]);
    mois = MOIS[litteral[2]];
    annee = Number(litteral[3]);
  } else {
    return null;
  }

  if (!(mois >= 1 && mois <= 12) || !(jour >= 1 && jour <= 31)) return null;
  const deux = (n) => String(n).padStart(2, '0');
  return {
    brut,
    iso: `${annee}-${deux(mois)}-${deux(jour)}T${deux(hh)}:${deux(mm)}:${deux(ss)}`,
    jour, mois, annee
  };
}

// Le code ISO d'une devise et ce qu'on ecrit sur une facture.
const DEVISES = { XOF: 'F CFA', XAF: 'F CFA', EUR: 'EUR', USD: 'USD' };

function libelleDevise(code) {
  if (!code) return '';
  return DEVISES[String(code).toUpperCase()] || String(code).toUpperCase();
}

// Montant en francs CFA, groupe par milliers avec une espace insecable fine.
function formaterMontant(nombre, devise) {
  if (nombre == null || !Number.isFinite(nombre)) return '';
  const decimales = Number.isInteger(nombre) ? 0 : 2;
  const texte = Math.abs(nombre)
    .toFixed(decimales)
    .replace('.', ',')
    .replace(/(\d)(?=(\d{3})+(?:,|$))/g, '$1 ');
  const signe = nombre < 0 ? '-' : '';
  const unite = libelleDevise(devise);
  return unite ? `${signe}${texte} ${unite}` : `${signe}${texte}`;
}

function formaterTaux(taux) {
  if (taux == null || !Number.isFinite(taux)) return '';
  return `${Number.isInteger(taux) ? taux : taux.toFixed(2).replace('.', ',')} %`;
}

module.exports = {
  normaliserEspaces,
  normaliserLigne,
  estBruitMarkdown,
  estNumerique,
  retirerMarkdown,
  estSeparateurTableau,
  estLigneTableau,
  cellulesDe,
  enLignes,
  versNombre,
  versDate,
  sansAccent,
  libelleDevise,
  formaterMontant,
  formaterTaux
};
