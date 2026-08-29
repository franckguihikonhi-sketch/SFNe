'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { analyser } = require('../src/metier/analyse');
const { controler } = require('../src/metier/controles');
const { versMarkdown, scalaireYaml } = require('../src/rendu/markdown');

const EXEMPLE = fs.readFileSync(path.join(__dirname, '..', 'exemples', 'facture-avoir.md'), 'utf8');

function rendre(options) {
  const facture = analyser(EXEMPLE, {
    source: 'facture-avoir.md',
    format: 'markdown',
    extraitLe: '2026-08-10T12:00:00.000Z'
  });
  return versMarkdown(facture, controler(facture), options);
}

test('le document produit porte un entete YAML exploitable par un programme', () => {
  const markdown = rendre();
  const entete = markdown.split('---')[1];
  assert.match(entete, /type: facture-avoir/);
  assert.match(entete, /numero: A1234567U2600000038/);
  assert.match(entete, /facture_initiale: 1234567U26000000524/);
  assert.match(entete, /emise_le: "2026-08-10T10:01:12"/);
  assert.match(entete, /total_ht: 21546/);
  assert.match(entete, /total_tva: 3878/);
  assert.match(entete, /net_a_payer: 25424/);
  // Un avoir se retranche : le signe doit etre porte par le document.
  assert.match(entete, /sens_comptable: -1/);
  assert.match(entete, /conforme: true/);
});

test('toutes les sections attendues sont presentes', () => {
  const markdown = rendre();
  for (const titre of ['# Facture d\'avoir', '## Émetteur', '## Client', '## Facture', '## Détail',
    '## Totaux', '## Récapitulatif des taxes', '## Contrôles', '## Provenance']) {
    assert.ok(markdown.includes(titre), `section absente : ${titre}`);
  }
});

test('le detail rend la ligne de facture avec ses colonnes', () => {
  const markdown = rendre();
  assert.match(markdown, /\| 1 \| 6FF001 \| FRITES 7MM-PK \(4\*2\.5kg\) \| 1 077 \| 20 \| SAC \| TVA 18 % \| 0 % \| 21 546 \|/);
  assert.match(markdown, /\| \*\*Total à payer\*\* \| \*\*25 424\*\* \|/);
});

test('un avoir est annonce comme tel, avec sa facture initiale', () => {
  assert.match(rendre(), /Facture d'avoir.*déduisent.*1234567U26000000524/s);
});

test('les sections facultatives peuvent etre retirees', () => {
  const markdown = rendre({ controles: false, provenance: false });
  assert.ok(!markdown.includes('## Contrôles'));
  assert.ok(!markdown.includes('## Provenance'));
  assert.ok(markdown.includes('## Totaux'));
});

test('une valeur YAML risquee est mise entre guillemets', () => {
  assert.equal(scalaireYaml('CLIENT DEMO CI'), 'CLIENT DEMO CI');
  assert.equal(scalaireYaml("COTE D'IVOIRE"), '"COTE D\'IVOIRE"');
  assert.equal(scalaireYaml('a: b'), '"a: b"');
  assert.equal(scalaireYaml(null), 'null');
  assert.equal(scalaireYaml(21546), '21546');
});

test('une barre verticale dans une designation ne casse pas le tableau', () => {
  const facture = analyser([
    'Facture de vente Nº 123456',
    '| Réf | Désignation | P.U HT | Qté | Unité | Taxes (%) | Rem. (%) | Montant HT |',
    '| A1 | RIZ 5\\|10 | 1 000 | 1 | SAC | TVA (18) | 0 | 1 000 |'
  ].join('\n'));
  assert.match(versMarkdown(facture, controler(facture)), /RIZ 5\\\|10/);
});
