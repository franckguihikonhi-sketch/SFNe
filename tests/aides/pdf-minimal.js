'use strict';

const zlib = require('node:zlib');
const qrcode = require('qrcode-generator');

// Fabrique un PDF minimal a partir de blocs de texte places en x/y.
// Sert de piece a conviction aux tests : pas de binaire dans le depot, le
// fichier est reconstruit a chaque execution.

function echapper(texte) {
  return String(texte).replace(/[\\()]/g, '\\$&');
}

// Une image RVB, un octet par composante, prete a devenir un XObject.
// images : [{ rvb, largeur, hauteur, x, y, cote }]
function imageQr(texte, { module: cote = 4, marge = 4 } = {}) {
  const qr = qrcode(0, 'M');
  qr.addData(texte);
  qr.make();
  const modules = qr.getModuleCount();
  const cotes = (modules + marge * 2) * cote;
  const rvb = Buffer.alloc(cotes * cotes * 3, 255);
  for (let ligne = 0; ligne < modules; ligne += 1) {
    for (let colonne = 0; colonne < modules; colonne += 1) {
      if (!qr.isDark(ligne, colonne)) continue;
      for (let y = 0; y < cote; y += 1) {
        for (let x = 0; x < cote; x += 1) {
          const px = (colonne + marge) * cote + x;
          const py = (ligne + marge) * cote + y;
          rvb.fill(0, (py * cotes + px) * 3, (py * cotes + px) * 3 + 3);
        }
      }
    }
  }
  return { rvb, largeur: cotes, hauteur: cotes };
}

// blocs : [{ texte, x, y, taille }]
function pdfDepuisBlocs(blocs, options = {}) {
  const largeur = options.largeur || 595;
  const hauteur = options.hauteur || 842;
  const images = options.images || [];

  const dessins = images
    .map((image, rang) => {
      const cote = image.cote || 100;
      return `q ${cote} 0 0 ${cote} ${image.x} ${image.y} cm /Im${rang} Do Q`;
    })
    .join('\n');
  const textes = blocs
    .map((bloc) => `BT /F1 ${bloc.taille || 9} Tf 1 0 0 1 ${bloc.x} ${bloc.y} Tm (${echapper(bloc.texte)}) Tj ET`)
    .join('\n');
  const contenu = [dessins, textes].filter(Boolean).join('\n');

  const xobjets = images.map((image, rang) => `/Im${rang} ${6 + rang} 0 R`).join(' ');
  const objets = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${largeur} ${hauteur}] ` +
      `/Resources << /Font << /F1 5 0 R >>${xobjets ? ` /XObject << ${xobjets} >>` : ''} >> /Contents 4 0 R >>`,
    `<< /Length ${Buffer.byteLength(contenu, 'latin1')} >>\nstream\n${contenu}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    ...images.map((image) => {
      const comprime = zlib.deflateSync(image.rvb).toString('latin1');
      return `<< /Type /XObject /Subtype /Image /Width ${image.largeur} /Height ${image.hauteur} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${comprime.length} >>\n` +
        `stream\n${comprime}\nendstream`;
    })
  ];

  let pdf = '%PDF-1.4\n';
  const positions = [];
  objets.forEach((corps, rang) => {
    positions.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${rang + 1} 0 obj\n${corps}\nendobj\n`;
  });
  const debutXref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objets.length + 1}\n0000000000 65535 f \n`;
  for (const position of positions) pdf += `${String(position).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objets.length + 1} /Root 1 0 R >>\nstartxref\n${debutXref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

// Largeur approchee d'un texte en Helvetica, en points. Suffisant pour poser
// des colonnes qui ne se chevauchent pas.
function largeurApprochee(texte, taille) {
  return texte.length * taille * 0.55;
}

// Convertit des lignes « colonne | colonne » en blocs positionnes. Une colonne
// dont le voisin de gauche deborde est repoussee : deux colonnes collees ne
// seraient plus deux colonnes.
function pdfDepuisLignes(lignes, options = {}) {
  const hautDePage = options.hautDePage || 800;
  const interligne = options.interligne || 14;
  const colonnes = options.colonnes || [30, 130, 230, 290, 330, 380, 430, 480, 530];
  const taille = options.taille || 9;
  const ecart = options.ecart || 12;
  const blocs = [];
  lignes.forEach((ligne, rang) => {
    const y = hautDePage - rang * interligne;
    let finPrecedente = null;
    String(ligne).split('|').forEach((morceau, colonne) => {
      const texte = morceau.trim();
      if (!texte) return;
      const demandee = colonnes[Math.min(colonne, colonnes.length - 1)];
      const x = finPrecedente == null ? demandee : Math.max(demandee, finPrecedente + ecart);
      blocs.push({ texte, x, y, taille });
      finPrecedente = x + largeurApprochee(texte, taille);
    });
  });
  return pdfDepuisBlocs(blocs, options);
}

module.exports = { pdfDepuisBlocs, pdfDepuisLignes, imageQr };
