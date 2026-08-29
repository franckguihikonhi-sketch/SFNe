'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { creerVerificateur, lireConfiguration } = require('../src/verification/dgi');
const { convertir } = require('../src/convertir');
const { pdfDepuisBlocs, imageQr } = require('./aides/pdf-minimal');

const JETON = '0199aaaa-bbbb-7000-8000-ccccdddd0001';

function facturePdf() {
  const blocs = [
    { texte: 'Facture de vente Nº 1234567U26000000889', x: 40, y: 790 },
    { texte: 'Etablissement : SOCIETE DEMO NEGOCE NCC : 1234567U', x: 40, y: 770 },
    { texte: 'Client', x: 40, y: 750 },
    { texte: 'Nom : CLIENT DEMO CI', x: 40, y: 730 },
    { texte: 'Date et heure : 11/08/2026 09:16:14', x: 40, y: 716 },
    { texte: 'Mode de paiement : Especes', x: 250, y: 716 }
  ];
  const colonnes = [40, 95, 265, 320, 360, 400, 460, 505];
  ['Réf', 'Désignation', 'P.U HT', 'Qté', 'Unité', 'Taxes (%)', 'Rem. (%)', 'Montant HT']
    .forEach((texte, rang) => blocs.push({ texte, x: colonnes[rang], y: 700, taille: 8 }));
  ['A1', 'RIZ', '1 000', '2', 'SAC', 'TVA (18)', '0', '2 000']
    .forEach((texte, rang) => blocs.push({ texte, x: colonnes[rang], y: 686, taille: 8 }));
  blocs.push({ texte: 'TOTAL A PAYER', x: 380, y: 660, taille: 8 });
  blocs.push({ texte: '2 360', x: 505, y: 660, taille: 8 });
  return pdfDepuisBlocs(blocs, { images: [{ ...imageQr(`https://exemple.test/fr/verification/${JETON}`), x: 430, y: 740, cote: 110 }] });
}

// Une fausse DGI : elle repond ce que le test lui dit de repondre, et compte
// les appels recus.
async function fausseDgi(reponses) {
  const recus = [];
  const serveur = http.createServer((requete, reponse) => {
    recus.push({ url: requete.url, autorisation: requete.headers.authorization });
    const jeton = decodeURIComponent(requete.url.split('/').pop());
    const prevue = reponses[jeton] || { statut: 404, corps: { erreur: 'inconnu' } };
    if (prevue.silence) return; // ne repond jamais : delai depasse
    reponse.writeHead(prevue.statut, { 'content-type': 'application/json' });
    reponse.end(JSON.stringify(prevue.corps || {}));
  });
  await new Promise((resoudre) => serveur.listen(0, '127.0.0.1', resoudre));
  return {
    recus,
    base: `http://127.0.0.1:${serveur.address().port}/v1/factures/{jeton}`,
    fermer: () => serveur.close()
  };
}

function verificateurVers(base, extra = {}) {
  return creerVerificateur({
    env: { SFNE_DGI_URL: base, SFNE_DGI_CLE: 'cle-de-test', ...extra }
  });
}

test('sans configuration, le verificateur se tait', async () => {
  const verificateur = creerVerificateur({ env: {} });
  assert.equal(verificateur.configure, false);
  const { facture, verdict } = await convertir(facturePdf(), { nom: 'f.pdf', verificateur });
  assert.equal(facture.verification.etat, null);
  assert.equal(verdict.controles.find((c) => c.code === 'verification-dgi'), undefined);
});

test('un sticker que la DGI confirme passe le controle', async (t) => {
  const dgi = await fausseDgi({ [JETON]: { statut: 200, corps: { numero: '1234567U26000000889', ncc: '1234567U', totalTTC: 2360, statut: 'CERTIFIEE' } } });
  t.after(dgi.fermer);
  const { facture, verdict, markdown } = await convertir(facturePdf(), { nom: 'f.pdf', verificateur: verificateurVers(dgi.base) });

  assert.equal(facture.verification.etat, 'verifiee');
  assert.ok(facture.verification.verifieLe);
  const controle = verdict.controles.find((c) => c.code === 'verification-dgi');
  assert.equal(controle.niveau, 'ok');
  assert.match(markdown, /Vérifié auprès de la DGI \| ✅ vérifié auprès de la DGI/);
  assert.equal(dgi.recus[0].autorisation, 'Bearer cle-de-test');
  assert.match(dgi.recus[0].url, new RegExp(`/v1/factures/${JETON}$`));
});

test('un sticker que la DGI ne connait pas est une erreur', async (t) => {
  const dgi = await fausseDgi({});
  t.after(dgi.fermer);
  const { facture, verdict } = await convertir(facturePdf(), { nom: 'f.pdf', verificateur: verificateurVers(dgi.base) });
  assert.equal(facture.verification.etat, 'inconnue');
  assert.equal(verdict.conforme, false);
  assert.equal(verdict.controles.find((c) => c.code === 'verification-dgi').niveau, 'erreur');
});

test('une facture dont les montants ne collent pas a la DGI est refusee', async (t) => {
  const dgi = await fausseDgi({ [JETON]: { statut: 200, corps: { numero: '1234567U26000000889', ncc: '1234567U', totalTTC: 999999 } } });
  t.after(dgi.fermer);
  const { facture, verdict } = await convertir(facturePdf(), { nom: 'f.pdf', verificateur: verificateurVers(dgi.base) });
  assert.equal(facture.verification.etat, 'discordante');
  assert.match(facture.verification.details, /total a payer : 2360 sur la facture, 999999 a la DGI/);
  assert.equal(verdict.controles.find((c) => c.code === 'verification-dgi').niveau, 'erreur');
});

test('une facture annulee par la DGI est refusee, quels que soient ses montants', async (t) => {
  const dgi = await fausseDgi({ [JETON]: { statut: 200, corps: { numero: '1234567U26000000889', totalTTC: 2360, statut: 'ANNULEE' } } });
  t.after(dgi.fermer);
  const { facture } = await convertir(facturePdf(), { nom: 'f.pdf', verificateur: verificateurVers(dgi.base) });
  assert.equal(facture.verification.etat, 'discordante');
  assert.match(facture.verification.details, /ANNULEE/);
});

test('une DGI muette ou en panne ne fait qu\'une reserve, jamais un refus', async (t) => {
  const enPanne = await fausseDgi({ [JETON]: { statut: 500 } });
  t.after(enPanne.fermer);
  const { facture, verdict } = await convertir(facturePdf(), { nom: 'f.pdf', verificateur: verificateurVers(enPanne.base) });
  assert.equal(facture.verification.etat, 'indisponible');
  assert.equal(verdict.controles.find((c) => c.code === 'verification-dgi').niveau, 'attention');
  // Une facture par ailleurs saine reste conforme : le service de la DGI n'est
  // pas le juge de sa coherence interne.
  assert.equal(verdict.conforme, true);
});

test('un delai depasse ne bloque pas la conversion', async (t) => {
  const muette = await fausseDgi({ [JETON]: { silence: true } });
  t.after(muette.fermer);
  const verificateur = verificateurVers(muette.base, { SFNE_DGI_DELAI: '300' });
  const { facture } = await convertir(facturePdf(), { nom: 'f.pdf', verificateur });
  assert.equal(facture.verification.etat, 'indisponible');
  assert.match(facture.verification.details, /n'a pas repondu/);
});

test('le meme sticker n\'est demande qu\'une fois a la DGI', async (t) => {
  const dgi = await fausseDgi({ [JETON]: { statut: 200, corps: { numero: '1234567U26000000889', totalTTC: 2360 } } });
  t.after(dgi.fermer);
  const verificateur = verificateurVers(dgi.base);
  const pdf = facturePdf();
  await convertir(pdf, { nom: 'a.pdf', verificateur });
  await convertir(pdf, { nom: 'b.pdf', verificateur });
  await convertir(pdf, { nom: 'c.pdf', verificateur });
  assert.equal(dgi.recus.length, 1, 'un lot de doublons ne doit pas marteler la DGI');
  assert.equal(verificateur.appels, 1);
});

test('une facture sans sticker ne provoque aucun appel', async (t) => {
  const dgi = await fausseDgi({});
  t.after(dgi.fermer);
  const verificateur = verificateurVers(dgi.base);
  const { facture } = await convertir(Buffer.from([
    'Facture de vente Nº 1234567U26000000889',
    '| Réf | Désignation | P.U HT | Qté | Unité | Taxes (%) | Rem. (%) | Montant HT |',
    '| A1 | RIZ | 1 000 | 2 | SAC | TVA (18) | 0 | 2 000 |'
  ].join('\n')), { nom: 'f.md', verificateur });
  assert.equal(facture.verification.etat, 'sans_sticker');
  assert.equal(dgi.recus.length, 0);
});

test('la correspondance des champs se regle sans toucher au code', async (t) => {
  // Une DGI qui nommerait ses champs autrement.
  const dgi = await fausseDgi({ [JETON]: { statut: 200, corps: { data: { invoiceNumber: '1234567U26000000889', amountInclTax: 2360 } } } });
  t.after(dgi.fermer);
  const verificateur = verificateurVers(dgi.base, {
    SFNE_DGI_CHAMPS: JSON.stringify({ numero: 'data.invoiceNumber', totalTTC: 'data.amountInclTax', ncc: 'data.sellerTin' })
  });
  const { facture } = await convertir(facturePdf(), { nom: 'f.pdf', verificateur });
  assert.equal(facture.verification.etat, 'verifiee');
});

test('une configuration incomprehensible est signalee tot', () => {
  assert.throws(() => lireConfiguration({ SFNE_DGI_URL: 'https://x', SFNE_DGI_CHAMPS: '{oups' }), /SFNE_DGI_CHAMPS/);
});

test('l\'adresse accepte un modele ou un prefixe', () => {
  const modele = creerVerificateur({ env: { SFNE_DGI_URL: 'https://api.test/v1/{jeton}/etat' } });
  assert.equal(modele.adresse('abc'), 'https://api.test/v1/abc/etat');
  const prefixe = creerVerificateur({ env: { SFNE_DGI_URL: 'https://api.test/v1/factures/' } });
  assert.equal(prefixe.adresse('abc'), 'https://api.test/v1/factures/abc');
});
