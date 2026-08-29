'use strict';

// Lecture des codes QR d'un PDF.
//
// Une facture normalisee porte un QR : c'est lui, et non le texte, qui donne
// l'adresse de verification de la DGI et le jeton du sticker electronique.
// Le texte de la facture ne les nomme nulle part — sans le QR, ils sont perdus.

const jsQR = require('jsqr');

// pdf.js rend les images en niveaux de gris 1 bit, en RVB ou en RVBA selon la
// facon dont elles sont encodees. jsQR veut du RVBA.
const GRIS_1_BIT = 1;
const RVB_24_BITS = 2;

function versRvba(image) {
  const { width, height, kind, data } = image;
  const rvba = new Uint8ClampedArray(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    let rouge;
    let vert;
    let bleu;
    if (kind === RVB_24_BITS) {
      rouge = data[pixel * 3];
      vert = data[pixel * 3 + 1];
      bleu = data[pixel * 3 + 2];
    } else if (kind === GRIS_1_BIT) {
      const octet = data[pixel >> 3];
      const bit = (octet >> (7 - (pixel & 7))) & 1;
      rouge = vert = bleu = bit ? 255 : 0;
    } else {
      rouge = data[pixel * 4];
      vert = data[pixel * 4 + 1];
      bleu = data[pixel * 4 + 2];
    }
    rvba[pixel * 4] = rouge;
    rvba[pixel * 4 + 1] = vert;
    rvba[pixel * 4 + 2] = bleu;
    rvba[pixel * 4 + 3] = 255;
  }
  return rvba;
}

// Un logo n'est pas un QR : les images manifestement trop grandes ou trop
// allongees sont ecartees avant meme d'essayer de les decoder.
const COTE_MAXI = 1200;
const RAPPORT_MAXI = 1.6;

function peutEtreUnQr(image) {
  if (!image || !image.data || !image.width || !image.height) return false;
  if (image.width > COTE_MAXI || image.height > COTE_MAXI) return false;
  const rapport = Math.max(image.width, image.height) / Math.min(image.width, image.height);
  return rapport <= RAPPORT_MAXI;
}

function decoder(image) {
  if (!peutEtreUnQr(image)) return null;
  try {
    const trouve = jsQR(versRvba(image), image.width, image.height);
    return trouve && trouve.data ? trouve.data : null;
  } catch (erreur) {
    return null;
  }
}

// Rend les charges utiles des QR d'une page, dans l'ordre ou ils sont dessines.
async function codesDeLaPage(pdfjs, page) {
  const operations = await page.getOperatorList();
  const noms = [];
  operations.fnArray.forEach((operation, rang) => {
    if (operation === pdfjs.OPS.paintImageXObject) noms.push(operations.argsArray[rang][0]);
  });

  const charges = [];
  for (const nom of noms) {
    if (typeof nom !== 'string') continue;
    const image = await new Promise((resoudre) => {
      try {
        page.objs.get(nom, resoudre);
      } catch (erreur) {
        resoudre(null);
      }
    });
    const charge = decoder(image);
    if (charge && !charges.includes(charge)) charges.push(charge);
  }
  return charges;
}

module.exports = { codesDeLaPage, decoder, versRvba, peutEtreUnQr };
