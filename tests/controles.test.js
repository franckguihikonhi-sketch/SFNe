'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { analyser } = require('../src/metier/analyse');
const { controler, ventilation } = require('../src/metier/controles');

function factureDeTest(lignes) {
  return analyser(lignes.join('\n'));
}

const ENTETE = '| Réf | Désignation | P.U HT | Qté | Unité | Taxes (%) | Rem. (%) | Montant HT |';

test('une facture qui se tient passe tous les controles de calcul', () => {
  const facture = factureDeTest([
    'Facture de vente Nº 1234567U26000000524',
    'Etablissement : DEMO NEGOCE NCC : 1234567 A RCCM : CI-ABJ-01 Nº Tel : 0700000000',
    'Nom de PDV : SIEGE Date et heure : 10/08/2026 10:01:12 Mode de paiement : Especes',
    'Client',
    "Nom : CLIENT DEMO CI NCC : 1234567X Régime d'imposition : RNI",
    ENTETE,
    '| A1 | RIZ | 1 000 | 2 | SAC | TVA (18) | 0 | 2 000 |',
    '| | | TOTAL HT | | | | | 2 000 |',
    '| | | TVA | | | | | 360 |',
    '| | | TOTAL TTC | | | | | 2 360 |',
    '| | | TOTAL A PAYER | | | | | 2 360 |'
  ]);
  const verdict = controler(facture);
  assert.equal(verdict.conforme, true);
  assert.equal(verdict.compte.erreur, 0);
  assert.deepEqual(verdict.ventilation, [{ taux: 18, base: 2000, montant: 360 }]);
});

test('un total HT qui ne suit pas les lignes est refuse', () => {
  const facture = factureDeTest([
    'Facture de vente Nº 1234567U26000000524',
    ENTETE,
    '| A1 | RIZ | 1 000 | 2 | SAC | TVA (18) | 0 | 2 000 |',
    '| | | TOTAL HT | | | | | 9 000 |'
  ]);
  const verdict = controler(facture);
  assert.equal(verdict.conforme, false);
  const controle = verdict.controles.find((item) => item.code === 'total-ht');
  assert.equal(controle.niveau, 'erreur');
  assert.match(controle.constate, /9 000/);
});

test('un TTC qui ne fait pas HT plus taxes est refuse', () => {
  const facture = factureDeTest([
    'Facture de vente Nº 123456',
    ENTETE,
    '| A1 | RIZ | 1 000 | 2 | SAC | TVA (18) | 0 | 2 000 |',
    '| | | TOTAL HT | | | | | 2 000 |',
    '| | | TVA | | | | | 360 |',
    '| | | TOTAL TTC | | | | | 2 500 |'
  ]);
  const verdict = controler(facture);
  const controle = verdict.controles.find((item) => item.code === 'total-ttc');
  assert.equal(controle.niveau, 'erreur');
});

test('un prix unitaire affiche arrondi ne compte pas pour une erreur', () => {
  const facture = factureDeTest([
    'Facture de vente Nº 123456',
    ENTETE,
    '| 6FF001 | FRITES | 1 077 | 20 | SAC | TVA (18) | 0 | 21 546 |'
  ]);
  const controle = controler(facture).controles.find((item) => item.code === 'ligne-1');
  assert.equal(controle.niveau, 'ok');
  assert.match(controle.note, /1 077,30/);
});

test('une remise de ligne entre dans le calcul', () => {
  const facture = factureDeTest([
    'Facture de vente Nº 123456',
    ENTETE,
    '| A1 | POISSON | 2 000 | 3 | CARTON | TVA (18) | 10 | 5 400 |'
  ]);
  const controle = controler(facture).controles.find((item) => item.code === 'ligne-1');
  assert.equal(controle.niveau, 'ok');
});

test('les mentions obligatoires absentes sont enumerees', () => {
  const verdict = controler(factureDeTest(['Une facture sans rien du tout']));
  const manquantes = verdict.controles.filter((item) => item.niveau !== 'ok').map((item) => item.code);
  assert.ok(manquantes.includes('mention-numero'));
  assert.ok(manquantes.includes('mention-client'));
  assert.ok(manquantes.includes('mention-lignes'));
  assert.equal(verdict.conforme, false);
});

test('un avoir sans facture initiale est signale', () => {
  const verdict = controler(factureDeTest(["Facture d'avoir Nº A1234567U2600000038"]));
  const controle = verdict.controles.find((item) => item.code === 'avoir-facture-initiale');
  assert.equal(controle.niveau, 'erreur');
});

test('la ventilation par taux additionne les lignes de meme taux', () => {
  const facture = factureDeTest([
    'Facture de vente Nº 123456',
    ENTETE,
    '| A1 | RIZ | 1 000 | 2 | SAC | TVA (18) | 0 | 2 000 |',
    '| A2 | LAIT | 500 | 2 | PACK | TVA (18) | 0 | 1 000 |',
    '| A3 | PAIN | 100 | 5 | UNITE | TVA (9) | 0 | 500 |'
  ]);
  assert.deepEqual(ventilation(facture), [
    { taux: 9, base: 500, montant: 45 },
    { taux: 18, base: 3000, montant: 540 }
  ]);
});
