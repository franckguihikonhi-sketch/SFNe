'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { principal, lireArguments } = require('../src/cli');

const EXEMPLE = path.join(__dirname, '..', 'exemples', 'facture-avoir.md');

function dossierJetable() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfne-cli-'));
}

function sansSortie(action) {
  const ecrireSortie = process.stdout.write.bind(process.stdout);
  const ecrireErreur = process.stderr.write.bind(process.stderr);
  const recueilli = { sortie: '', erreur: '' };
  process.stdout.write = (texte) => { recueilli.sortie += texte; return true; };
  process.stderr.write = (texte) => { recueilli.erreur += texte; return true; };
  return Promise.resolve(action()).finally(() => {
    process.stdout.write = ecrireSortie;
    process.stderr.write = ecrireErreur;
  }).then((code) => ({ code, ...recueilli }));
}

test('les arguments sont lus comme annonce', () => {
  const options = lireArguments(['a.pdf', '--sortie', 'dossier', '-j', '--sans-controles']);
  assert.deepEqual(options.fichiers, ['a.pdf']);
  assert.equal(options.sortie, 'dossier');
  assert.equal(options.json, true);
  assert.deepEqual(options.rendu, { controles: false });
  assert.throws(() => lireArguments(['--inconnue']), /Option inconnue/);
});

test('sans destination, le Markdown part sur la sortie standard', async () => {
  const resultat = await sansSortie(() => principal([EXEMPLE]));
  assert.equal(resultat.code, 0);
  assert.match(resultat.sortie, /# Facture d'avoir Nº A1234567U2600000038/);
});

test('avec une destination, le fichier est ecrit et le JSON peut suivre', async () => {
  const dossier = dossierJetable();
  const cible = path.join(dossier, 'avoir.md');
  const resultat = await sansSortie(() => principal([EXEMPLE, '--sortie', cible, '--json']));
  assert.equal(resultat.code, 0);
  assert.match(fs.readFileSync(cible, 'utf8'), /## Récapitulatif des taxes/);
  const facture = JSON.parse(fs.readFileSync(path.join(dossier, 'avoir.json'), 'utf8'));
  assert.equal(facture.document.numero, 'A1234567U2600000038');
  assert.match(resultat.erreur, /controles/);
});

test('plusieurs fichiers vont dans un dossier de destination', async () => {
  const dossier = dossierJetable();
  const copie = path.join(dossier, 'copie.md');
  fs.copyFileSync(EXEMPLE, copie);
  await sansSortie(() => principal([EXEMPLE, copie, '--sortie', dossier]));
  assert.ok(fs.existsSync(path.join(dossier, 'facture-avoir.md')));
  assert.ok(fs.existsSync(copie));
});

test('une facture incoherente sort avec un code d\'erreur', async () => {
  const dossier = dossierJetable();
  const fichier = path.join(dossier, 'fausse.md');
  fs.writeFileSync(fichier, [
    'Facture de vente Nº 123456',
    '| Réf | Désignation | P.U HT | Qté | Unité | Taxes (%) | Rem. (%) | Montant HT |',
    '| A1 | RIZ | 1 000 | 2 | SAC | TVA (18) | 0 | 2 000 |',
    '| | | TOTAL HT | | | | | 9 000 |'
  ].join('\n'));
  const resultat = await sansSortie(() => principal([fichier]));
  assert.equal(resultat.code, 2);
});

test('un fichier qui n\'est pas une facture est refuse', async () => {
  const dossier = dossierJetable();
  const fichier = path.join(dossier, 'brouillon.txt');
  fs.writeFileSync(fichier, 'Note de service : penser a commander des sacs.');
  const resultat = await sansSortie(() => principal([fichier]));
  assert.equal(resultat.code, 1);
  assert.match(resultat.erreur, /pas une facture/);
});

test('sans argument, l\'aide s\'affiche', async () => {
  const resultat = await sansSortie(() => principal([]));
  assert.equal(resultat.code, 1);
  assert.match(resultat.sortie, /Usage :/);
});
