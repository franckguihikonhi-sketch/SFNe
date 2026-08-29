'use strict';

// Reconnaissance du fichier depose : PDF, Markdown ou texte.

const path = require('node:path');
const { lirePdf, estPdf } = require('./pdf');

const FORMATS = {
  '.pdf': 'pdf',
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.txt': 'texte',
  '.text': 'texte'
};

const TAILLE_MAXI = 15 * 1024 * 1024;

class EntreeInvalide extends Error {
  constructor(message) {
    super(message);
    this.name = 'EntreeInvalide';
    this.code = 'ENTREE_INVALIDE';
  }
}

function formatDe(nomFichier, donnees) {
  if (estPdf(donnees)) return 'pdf';
  const extension = path.extname(String(nomFichier || '')).toLowerCase();
  if (FORMATS[extension]) return FORMATS[extension] === 'pdf' ? 'texte' : FORMATS[extension];
  return 'texte';
}

// Rend { texte, format, codes }. Un PDF sans couche de texte (une simple image
// scannee) ne donne rien : on le dit plutot que de rendre un fichier vide.
async function extraireTexte(donnees, nomFichier) {
  const tampon = Buffer.isBuffer(donnees) ? donnees : Buffer.from(donnees);
  if (!tampon.length) throw new EntreeInvalide('Fichier vide.');
  if (tampon.length > TAILLE_MAXI) {
    throw new EntreeInvalide(`Fichier trop volumineux (maximum ${Math.round(TAILLE_MAXI / 1024 / 1024)} Mo).`);
  }
  const format = formatDe(nomFichier, tampon);
  if (format === 'pdf') {
    let lu;
    try {
      lu = await lirePdf(tampon);
    } catch (erreur) {
      throw new EntreeInvalide(`PDF illisible : ${erreur.message}`);
    }
    if (!lu.texte || !lu.texte.trim()) {
      throw new EntreeInvalide('Ce PDF ne porte aucun texte : il est probablement scanne. Fournissez le PDF d\'origine.');
    }
    return { texte: lu.texte, format, codes: lu.codes };
  }
  const texte = tampon.toString('utf8');
  if (!texte.trim()) throw new EntreeInvalide('Fichier sans contenu lisible.');
  return { texte, format, codes: [] };
}

module.exports = { extraireTexte, formatDe, EntreeInvalide, TAILLE_MAXI };
