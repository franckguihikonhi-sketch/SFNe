'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { pdfDepuisLignes } = require('./aides/pdf-minimal');
const { estPdf, regrouperEnLignes } = require('../src/extraction/pdf');
const { extraireTexte } = require('../src/extraction/entree');
const { convertir } = require('../src/convertir');

const FACTURE = [
  'Facture de vente No 1234567U26000000524',
  'RCCM : CI-ABJ-01-2020-B12-00000',
  'Etablissement : SOCIETE DEMO NEGOCE | NCC : 1234567 A',
  'No Tel : 0700000000 | Mail : compta@demo-negoce.ci',
  'Nom du vendeur : VENDEUR DEMO | Nom de PDV : SIEGE',
  'Date et heure : 10/08/2026 10:01:12 | Mode de paiement : Especes',
  'Client',
  'Nom : CLIENT DEMO CI | NCC : 1234567X',
  "Regime d'imposition : RNI",
  'Ref | Designation | P.U HT | Qte | Unite | Taxes (%) | Rem. (%) | Montant HT',
  '6FF001 | FRITES 7MM | 1077 | 20 | SAC | TVA (18) | 0 | 21540',
  '6FF002 | POISSON | 2000 | 3 | CARTON | TVA (18) | 10 | 5400',
  'TOTAL HT | 26940',
  'TVA | 4849',
  'TOTAL TTC | 31789',
  'TOTAL A PAYER | 31789'
];

test('un PDF se reconnait a ses premiers octets', () => {
  assert.equal(estPdf(pdfDepuisLignes(['Facture'])), true);
  assert.equal(estPdf(Buffer.from('# Facture')), false);
});

test('les fragments d\'une meme ligne sont recolles, les colonnes conservees', () => {
  const lignes = regrouperEnLignes([
    { texte: 'TOTAL HT', x: 40, y: 700, largeur: 45 },
    { texte: '21 546', x: 500, y: 700, largeur: 30 },
    { texte: 'Facture', x: 40, y: 760, largeur: 40 },
    { texte: 'de vente', x: 82, y: 760, largeur: 40 }
  ]);
  assert.deepEqual(lignes, ['Facture de vente', 'TOTAL HT  21 546']);
});

test('une facture au format PDF traverse toute la chaine', async () => {
  const resultat = await convertir(pdfDepuisLignes(FACTURE), { nom: 'facture.pdf' });

  assert.equal(resultat.format, 'pdf');
  assert.equal(resultat.nomSortie, 'facture.md');
  assert.equal(resultat.facture.document.numero, '1234567U26000000524');
  assert.equal(resultat.facture.vendeur.raisonSociale, 'SOCIETE DEMO NEGOCE');
  assert.equal(resultat.facture.vendeur.ncc, '1234567 A');
  assert.equal(resultat.facture.client.nom, 'CLIENT DEMO CI');
  assert.equal(resultat.facture.lignes.length, 2);
  assert.equal(resultat.facture.lignes[1].remise, 10);
  assert.equal(resultat.facture.totaux.netAPayer, 31789);
  assert.equal(resultat.verdict.conforme, true);
  assert.match(resultat.markdown, /# Facture de vente Nº 1234567U26000000524/);
});

test('un PDF sans texte est refuse avec une raison lisible', async () => {
  await assert.rejects(
    () => extraireTexte(pdfDepuisLignes([]), 'scan.pdf'),
    (erreur) => erreur.code === 'ENTREE_INVALIDE' && /scanne/.test(erreur.message)
  );
});

test('un fichier vide est refuse', async () => {
  await assert.rejects(() => extraireTexte(Buffer.alloc(0), 'vide.pdf'), /vide/i);
});
