'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { analyser, lireCodeVerification } = require('../src/metier/analyse');

const EXEMPLE = fs.readFileSync(path.join(__dirname, '..', 'exemples', 'facture-avoir.md'), 'utf8');

test('la facture d\'avoir de l\'exemple est lue de bout en bout', () => {
  const facture = analyser(EXEMPLE, { source: 'facture-avoir.md', format: 'markdown' });

  assert.equal(facture.document.type, 'avoir');
  assert.equal(facture.document.numero, 'A1234567U2600000038');
  assert.equal(facture.document.numeroFactureInitiale, '1234567U26000000524');
  assert.equal(facture.document.date.iso, '2026-08-10T10:01:12');
  assert.equal(facture.document.modePaiement, 'A terme');
  assert.equal(facture.document.devise, 'XOF');

  assert.equal(facture.vendeur.raisonSociale, 'SOCIETE DEMO NEGOCE');
  assert.equal(facture.vendeur.telephone, '0700000000');
  assert.equal(facture.vendeur.mail, 'comptabilite@demo-negoce.ci');
  assert.equal(facture.vendeur.rccm, 'CI-ABJ-01-2020-B12-00000');
  assert.equal(facture.vendeur.nomVendeur, 'VENDEUR DEMO');
  assert.equal(facture.vendeur.pointDeVente, 'SIEGE');

  assert.equal(facture.client.nom, "SUPERMARCHES DEMO CI");
  assert.equal(facture.client.ncc, '1234567X');
  assert.equal(facture.client.regimeImposition, 'RNI');

  assert.equal(facture.lignes.length, 1);
  assert.deepEqual(facture.lignes[0], {
    reference: '6FF001',
    designation: 'FRITES 7MM-PK (4*2.5kg)',
    prixUnitaireHT: 1077,
    quantite: 20,
    unite: 'SAC',
    taxes: [{ code: 'TVA', taux: 18 }],
    remise: 0,
    montantHT: 21546,
    montantTTC: null
  });

  assert.equal(facture.totaux.totalHT, 21546);
  assert.equal(facture.totaux.totalTVA, 3878);
  assert.equal(facture.totaux.totalTTC, 25424);
  assert.equal(facture.totaux.autresTaxes, 0);
  assert.equal(facture.totaux.netAPayer, 25424);

  assert.equal(facture.taxes.length, 1);
  assert.equal(facture.taxes[0].base, 21546);
  assert.equal(facture.taxes[0].taux, 18);
  assert.equal(facture.taxes[0].montant, 3878);
});

test('le vendeur et le client ne se melangent pas', () => {
  const facture = analyser([
    'Facture de vente Nº 1234567U26000000524',
    'Etablissement : SOCIETE DEMO NEGOCE Adresse : Zone 4 Marcory',
    'Client',
    'Nom : CLIENT DEMO CI Adresse : Plateau Abidjan'
  ].join('\n'));
  assert.equal(facture.vendeur.raisonSociale, 'SOCIETE DEMO NEGOCE');
  assert.equal(facture.vendeur.adresse, 'Zone 4 Marcory');
  assert.equal(facture.client.nom, 'CLIENT DEMO CI');
  assert.equal(facture.client.adresse, 'Plateau Abidjan');
});

test('une facture de vente ordinaire n\'est pas prise pour un avoir', () => {
  const facture = analyser('Facture de vente Nº 1234567U26000000524');
  assert.equal(facture.document.type, 'vente');
  assert.equal(facture.document.numeroFactureInitiale, null);
});

test('les taxes d\'une ligne se lisent code par code', () => {
  const facture = analyser([
    '| Réf | Désignation | P.U HT | Qté | Unité | Taxes (%) | Rem. (%) | Montant HT |',
    '| A1 | RIZ | 1 000 | 2 | SAC | TVA (18) | 0 | 2 000 |',
    '| A2 | EAU | 500 | 4 | PACK | EXO | 0 | 2 000 |'
  ].join('\n'));
  assert.deepEqual(facture.lignes[0].taxes, [{ code: 'TVA', taux: 18 }]);
  assert.deepEqual(facture.lignes[1].taxes, [{ code: 'EXO', taux: 0 }]);
});

test('le resume des taxes se lit en tableau comme en colonnes espacees', () => {
  const enTableau = analyser([
    'Facture de vente Nº 123456',
    'RESUME DE LA FACTURE',
    '| TVA normal - TVA sur HT 18,00% - A | 21 546 | 18% | 3 878 |'
  ].join('\n'));
  const enColonnes = analyser([
    'Facture de vente Nº 123456',
    'RESUME DE LA FACTURE',
    'CATEGORIE  SOUS-TOTAL  TAUX (%)  TOTAL TAXES',
    'TVA normal - TVA sur HT 18,00% - A  21 546  18%  3 878'
  ].join('\n'));
  const attendu = [{ libelle: 'TVA normal - TVA sur HT 18,00% - A', base: 21546, taux: 18, montant: 3878 }];
  assert.deepEqual(enTableau.taxes, attendu);
  assert.deepEqual(enColonnes.taxes, attendu);
});

test('les lignes que rien ne reconnait sont signalees, jamais perdues', () => {
  const facture = analyser('Facture de vente Nº 123456789\nUne mention libre de l\'editeur');
  assert.ok(facture.nonLues.includes("Une mention libre de l'editeur"));
});

test('le jeton se lit dans le dernier segment de l\'adresse de verification', () => {
  assert.deepEqual(lireCodeVerification('https://www.services.fne.dgi.gouv.ci/fr/verification/019ff01b-b312-7006-a00d-c122f4a3a4c2'),
    { url: 'https://www.services.fne.dgi.gouv.ci/fr/verification/019ff01b-b312-7006-a00d-c122f4a3a4c2',
      sticker: '019ff01b-b312-7006-a00d-c122f4a3a4c2' });
  assert.deepEqual(lireCodeVerification('FNE-2026-000889'), { url: null, sticker: 'FNE-2026-000889' });
  assert.deepEqual(lireCodeVerification('https://exemple.test/verification'),
    { url: 'https://exemple.test/verification', sticker: null });
  assert.equal(lireCodeVerification('  '), null);
});
