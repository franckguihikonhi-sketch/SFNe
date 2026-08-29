'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  enLignes, normaliserLigne, versNombre, versDate, formaterMontant, formaterTaux,
  estNumerique, cellulesDe, libelleDevise
} = require('../src/metier/texte');

test('les nombres des factures se lisent quel que soit le separateur', () => {
  assert.equal(versNombre('21 546'), 21546);
  assert.equal(versNombre('21 546'), 21546);
  assert.equal(versNombre('1 077,30'), 1077.3);
  assert.equal(versNombre('18,00%'), 18);
  assert.equal(versNombre('25.424'), 25424);
  assert.equal(versNombre('1.234,56'), 1234.56);
  assert.equal(versNombre('(1 200)'), -1200);
  assert.equal(versNombre('néant'), null);
  assert.equal(versNombre(''), null);
});

test('une cellule de texte ne passe pas pour un nombre', () => {
  assert.equal(estNumerique('21 546'), true);
  assert.equal(estNumerique('18%'), true);
  assert.equal(estNumerique('25 424 F CFA'), true);
  assert.equal(estNumerique('TVA normal - TVA sur HT 18,00% - A'), false);
});

test('les dates de facturation sont ramenees a la forme ISO', () => {
  assert.equal(versDate('10/08/2026 10:01:12').iso, '2026-08-10T10:01:12');
  assert.equal(versDate('2026-08-10').iso, '2026-08-10T00:00:00');
  assert.equal(versDate('10 aout 2026').iso, '2026-08-10T00:00:00');
  assert.equal(versDate('sans date'), null);
});

test('les montants se relisent en francs CFA', () => {
  assert.equal(formaterMontant(21546, 'XOF'), '21 546 F CFA');
  assert.equal(formaterMontant(1234567), '1 234 567');
  assert.equal(formaterMontant(1077.3), '1 077,30');
  assert.equal(formaterTaux(18), '18 %');
  assert.equal(libelleDevise('XOF'), 'F CFA');
});

test('le bruit des convertisseurs PDF vers Markdown est ecarte', () => {
  const lignes = enLignes([
    '![][image1]',
    '**Facture d\'avoir** Nº A1234567U2600000038',
    '| :---- | ----: |',
    '[image1]: <data:image/png;base64,iVBORw0KGgo=>'
  ].join('\n'));
  assert.deepEqual(lignes, ["Facture d'avoir Nº A1234567U2600000038"]);
});

test('les colonnes tabulees survivent a la normalisation', () => {
  assert.equal(normaliserLigne('TOTAL HT\t21 546'), 'TOTAL HT  21 546');
  assert.equal(normaliserLigne('a     b'), 'a  b');
  assert.deepEqual(cellulesDe('| 6FF001 | FRITES | 21 546 |'), ['6FF001', 'FRITES', '21 546']);
});

test('un lien Markdown rend son texte, un lien de courriel son adresse', () => {
  const lignes = enLignes('Mail : [comptabilite@demo-negoce.ci](mailto:comptabilite@demo-negoce.ci)');
  assert.equal(lignes[0], 'Mail : comptabilite@demo-negoce.ci');
});
