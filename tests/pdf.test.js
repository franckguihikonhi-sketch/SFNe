'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { pdfDepuisLignes, pdfDepuisBlocs, imageQr } = require('./aides/pdf-minimal');
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
  'TOTAL A PAYER | 31789',
  'RESUME DE LA FACTURE',
  'CATEGORIE | SOUS-TOTAL | TAUX (%) | TOTAL TAXES',
  'TVA normal - TVA sur HT 18,00% - A | 26940 | 18% | 4849',
  'Siege Social: Abidjan Marcory Zone 4 Rue Exemple'
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

// La mise en page reelle d'une facture FNE : deux colonnes dans l'entete, dont
// pdf.js rend les lignes entremelees, et une designation qui passe a la ligne.
function factureDeuxColonnes() {
  const gauche = 40;
  const droite = 300;
  const blocs = [];
  const poser = (y, x, texte, taille) => blocs.push({ texte, x, y, taille: taille || 9 });

  poser(800, gauche, 'DEMO-NEGOCE', 12);
  poser(788, gauche, 'NCC : 1234567U');
  poser(776, gauche, 'Facture de vente Nº 1234567U26000000889');
  poser(764, gauche, "Régime d'imposition : RSI");
  poser(752, gauche, 'Centre des impôts : 834 Impôts de Zone 4');
  poser(740, gauche, 'RCCM : CI-ABJ-01-2020-B12-00000 du');
  poser(728, gauche, 'Références bancaires :');
  poser(716, gauche, 'Établissement : SOCIETE DEMO NEGOCE');
  poser(704, droite, 'Client', 11);
  poser(692, gauche, 'Adresse :');
  poser(680, droite, 'Nom : CLIENT DEMO CI');
  poser(668, gauche, 'Nº Tel : 0700000000');
  poser(656, droite, 'Adresse : achats@demo-supermarches.ci');
  poser(644, gauche, 'Mail : comptabilite@demo-negoce.ci');
  poser(632, droite, 'NCC : 7654321N');
  poser(620, gauche, 'Nom du vendeur : VENDEUR DEMO');
  poser(608, droite, "Régime d'imposition : RNI");
  poser(596, gauche, 'Nom de PDV : SIEGE');
  poser(584, gauche, 'Date et heure : 11/08/2026 09:16:14');
  poser(572, gauche, 'Mode de paiement : A terme');

  const colonnes = [40, 95, 265, 320, 360, 400, 460, 505];
  ['Réf', 'Désignation', 'P.U HT', 'Qté', 'Unité', 'Taxes (%)', 'Rem. (%)', 'Montant HT']
    .forEach((texte, rang) => poser(548, colonnes[rang], texte, 8));
  ['6FF001', 'FRITES 7MM-PK', '1 077', '20', 'SAC', 'TVA (18)', '0', '21 546']
    .forEach((texte, rang) => poser(534, colonnes[rang], texte, 8));
  poser(524, colonnes[1], '(4*2.5kg)', 8);

  [['TOTAL HT', '21 546'], ['TVA', '3 878'], ['TOTAL TTC', '25 424'],
    ['AUTRES TAXES', '0'], ['TOTAL A PAYER', '25 424']].forEach(([libelle, montant], rang) => {
    poser(500 - rang * 14, 380, libelle, 8);
    poser(500 - rang * 14, 505, montant, 8);
  });

  poser(410, gauche, 'RESUME DE LA FACTURE', 10);
  ['CATEGORIE', 'SOUS-TOTAL', 'TAUX (%)', 'TOTAL TAXES']
    .forEach((texte, rang) => poser(394, [40, 300, 390, 470][rang], texte, 8));
  ['TVA normal - TVA sur HT 18,00% - A', '21 546', '18%', '3 878']
    .forEach((texte, rang) => poser(380, [40, 300, 390, 470][rang], texte, 8));

  poser(60, gauche, 'Siège Social: Abidjan Marcory Zone 4 Rue Exemple - 00 BP 0000 ABIDJAN 00', 7);
  return pdfDepuisBlocs(blocs);
}

test('un entete PDF sur deux colonnes rend a chacun ce qui est a lui', async () => {
  const { facture } = await convertir(factureDeuxColonnes(), { nom: 'facture.pdf' });

  // Le telephone, le courriel, le vendeur et le point de vente sont imprimes
  // sous le titre « Client », dans la colonne du vendeur : ils sont a lui.
  assert.equal(facture.vendeur.raisonSociale, 'SOCIETE DEMO NEGOCE');
  assert.equal(facture.vendeur.telephone, '0700000000');
  assert.equal(facture.vendeur.mail, 'comptabilite@demo-negoce.ci');
  assert.equal(facture.vendeur.nomVendeur, 'VENDEUR DEMO');
  assert.equal(facture.vendeur.pointDeVente, 'SIEGE');
  assert.equal(facture.vendeur.ncc, '1234567U');
  assert.equal(facture.vendeur.regimeImposition, 'RSI');
  assert.equal(facture.vendeur.centreImpots, '834 Impôts de Zone 4');

  assert.equal(facture.client.nom, 'CLIENT DEMO CI');
  assert.equal(facture.client.ncc, '7654321N');
  assert.equal(facture.client.regimeImposition, 'RNI');
  assert.equal(facture.client.adresse, 'achats@demo-supermarches.ci');
});

test('une designation coupee en deux est recollee, et les totaux suivent', async () => {
  const { facture, verdict } = await convertir(factureDeuxColonnes(), { nom: 'facture.pdf' });

  assert.equal(facture.lignes.length, 1);
  assert.equal(facture.lignes[0].designation, 'FRITES 7MM-PK (4*2.5kg)');
  // La suite de designation ne doit pas fermer le tableau : les totaux sont
  // imprimes apres elle.
  assert.equal(facture.totaux.totalHT, 21546);
  assert.equal(facture.totaux.totalTVA, 3878);
  assert.equal(facture.totaux.totalTTC, 25424);
  assert.equal(facture.totaux.netAPayer, 25424);
  assert.equal(verdict.conforme, true);
});

test("l'entete du tableau n'est pas prise pour une ligne de totaux", async () => {
  // La colonne « Montant HT » porte le meme libelle qu'un total ; seule une
  // ligne qui porte aussi un montant en est un.
  const { facture } = await convertir(factureDeuxColonnes(), { nom: 'facture.pdf' });
  assert.equal(facture.document.date.iso, '2026-08-11T09:16:14');
  assert.deepEqual(facture.taxes, [
    { libelle: 'TVA normal - TVA sur HT 18,00% - A', base: 21546, taux: 18, montant: 3878 }
  ]);
});

const JETON = '0199aaaa-bbbb-7000-8000-ccccdddd0001';
const ADRESSE_DGI = `https://exemple.test/fr/verification/${JETON}`;

function factureAvecQr(charge) {
  const blocs = [
    { texte: 'Facture de vente Nº 1234567U26000000889', x: 40, y: 790 },
    { texte: 'Etablissement : SOCIETE DEMO NEGOCE', x: 40, y: 770 },
    { texte: 'Client', x: 40, y: 750 },
    { texte: 'Nom : CLIENT DEMO CI', x: 40, y: 730 },
  ];
  const colonnes = [40, 95, 265, 320, 360, 400, 460, 505];
  ['Réf', 'Désignation', 'P.U HT', 'Qté', 'Unité', 'Taxes (%)', 'Rem. (%)', 'Montant HT']
    .forEach((texte, rang) => blocs.push({ texte, x: colonnes[rang], y: 700, taille: 8 }));
  ['A1', 'RIZ', '1 000', '2', 'SAC', 'TVA (18)', '0', '2 000']
    .forEach((texte, rang) => blocs.push({ texte, x: colonnes[rang], y: 686, taille: 8 }));
  blocs.push({ texte: 'TOTAL A PAYER', x: 380, y: 660, taille: 8 });
  blocs.push({ texte: '2 360', x: 505, y: 660, taille: 8 });
  const images = charge ? [{ ...imageQr(charge), x: 430, y: 740, cote: 110 }] : [];
  return pdfDepuisBlocs(blocs, { images });
}

test('le QR du PDF donne le sticker et le lien de verification de la DGI', async () => {
  // Ni l'un ni l'autre ne figurent dans le texte de la facture : sans le QR,
  // ils sont perdus.
  const { facture } = await convertir(factureAvecQr(ADRESSE_DGI), { nom: 'facture.pdf' });
  assert.equal(facture.verification.url, ADRESSE_DGI);
  assert.equal(facture.verification.sticker, JETON);
  assert.equal(facture.verification.etat, null);
});

test('le sticker figure dans l\'entete YAML et dans le document', async () => {
  const { markdown } = await convertir(factureAvecQr(ADRESSE_DGI), { nom: 'facture.pdf' });
  assert.match(markdown, new RegExp(`^sticker: ${JETON}$`, 'm'));
  assert.match(markdown, /## Vérification/);
  assert.match(markdown, new RegExp(`\\| Lien de vérification \\| ${ADRESSE_DGI.replace(/\//g, '\\/')} \\|`));
});

test('un QR present passe le controle, son absence est une reserve', async () => {
  const avec = await convertir(factureAvecQr(ADRESSE_DGI), { nom: 'avec-qr.pdf' });
  const sans = await convertir(factureAvecQr(null), { nom: 'sans-qr.pdf' });
  assert.equal(avec.verdict.controles.find((c) => c.code === 'mention-sticker').niveau, 'ok');
  assert.equal(sans.verdict.controles.find((c) => c.code === 'mention-sticker').niveau, 'attention');
});

test('un Markdown ne se voit pas reprocher un QR qu\'il ne peut pas porter', async () => {
  // Le QR ne survit pas a la conversion du PDF en texte : le reclamer la
  // n'aurait aucun sens.
  const markdown = await convertir(Buffer.from([
    'Facture de vente Nº 1234567U26000000889',
    '| Réf | Désignation | P.U HT | Qté | Unité | Taxes (%) | Rem. (%) | Montant HT |',
    '| A1 | RIZ | 1 000 | 2 | SAC | TVA (18) | 0 | 2 000 |'
  ].join('\n')), { nom: 'facture.md' });
  assert.equal(markdown.verdict.controles.find((c) => c.code === 'mention-sticker'), undefined);
});

test('un QR qui ne porte pas d\'adresse est garde tel quel', async () => {
  const { facture } = await convertir(factureAvecQr('FNE-2026-000889-CI'), { nom: 'facture.pdf' });
  assert.equal(facture.verification.codeVerification, 'FNE-2026-000889-CI');
  assert.equal(facture.verification.url, null);
});
