'use strict';

// Fabrique un PDF minimal a partir de blocs de texte places en x/y.
// Sert de piece a conviction aux tests : pas de binaire dans le depot, le
// fichier est reconstruit a chaque execution.

function echapper(texte) {
  return String(texte).replace(/[\\()]/g, '\\$&');
}

// blocs : [{ texte, x, y, taille }]
function pdfDepuisBlocs(blocs, options = {}) {
  const largeur = options.largeur || 595;
  const hauteur = options.hauteur || 842;
  const contenu = blocs
    .map((bloc) => `BT /F1 ${bloc.taille || 9} Tf 1 0 0 1 ${bloc.x} ${bloc.y} Tm (${echapper(bloc.texte)}) Tj ET`)
    .join('\n');

  const objets = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${largeur} ${hauteur}] ` +
      '/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(contenu, 'latin1')} >>\nstream\n${contenu}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'
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

module.exports = { pdfDepuisBlocs, pdfDepuisLignes };
