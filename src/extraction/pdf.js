'use strict';

// Extraction du texte d'un PDF, ligne par ligne.
//
// pdf.js rend des fragments places en x/y. Une facture est faite de colonnes :
// on regroupe donc les fragments par ordonnee, on les remet dans l'ordre de
// lecture, et on marque les sauts de colonne par deux espaces. L'analyse s'en
// sert pour retrouver les colonnes d'un tableau qui n'a plus de bordures.

const ECART_LIGNE = 2.5;   // points : deux fragments plus proches sont sur la meme ligne
const ECART_COLONNE = 6;   // points : au-dela, c'est une autre colonne

let chargement = null;

function chargerPdfJs() {
  if (!chargement) {
    chargement = import('pdfjs-dist/legacy/build/pdf.mjs');
  }
  return chargement;
}

function regrouperEnLignes(elements) {
  const lignes = [];
  for (const element of elements) {
    const ligne = lignes.find((candidate) => Math.abs(candidate.y - element.y) <= ECART_LIGNE);
    if (ligne) ligne.elements.push(element);
    else lignes.push({ y: element.y, elements: [element] });
  }
  lignes.sort((a, b) => b.y - a.y);
  return lignes.map(({ elements: fragments }) => {
    fragments.sort((a, b) => a.x - b.x);
    let texte = '';
    let finPrecedente = null;
    for (const fragment of fragments) {
      if (finPrecedente != null) {
        texte += fragment.x - finPrecedente > ECART_COLONNE ? '  ' : (/\s$/.test(texte) ? '' : ' ');
      }
      texte += fragment.texte;
      finPrecedente = fragment.x + fragment.largeur;
    }
    return texte.replace(/\s+$/, '');
  });
}

async function texteDuPdf(donnees) {
  const pdfjs = await chargerPdfJs();
  const tache = pdfjs.getDocument({
    data: new Uint8Array(donnees),
    isEvalSupported: false,
    useSystemFonts: false,
    disableFontFace: true,
    verbosity: 0
  });
  const document = await tache.promise;
  const pages = [];
  try {
    for (let numero = 1; numero <= document.numPages; numero += 1) {
      const page = await document.getPage(numero);
      const contenu = await page.getTextContent();
      const elements = contenu.items
        .filter((item) => typeof item.str === 'string' && item.str.trim() !== '')
        .map((item) => ({
          texte: item.str,
          x: item.transform[4],
          y: item.transform[5],
          largeur: item.width || 0
        }));
      pages.push(regrouperEnLignes(elements).join('\n'));
      page.cleanup();
    }
  } finally {
    await tache.destroy();
  }
  return pages.join('\n\n');
}

function estPdf(donnees) {
  const tampon = Buffer.isBuffer(donnees) ? donnees : Buffer.from(donnees);
  return tampon.subarray(0, 5).toString('latin1') === '%PDF-';
}

module.exports = { texteDuPdf, estPdf, regrouperEnLignes };
