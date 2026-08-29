'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ouvrir } = require('../src/donnees/depot');
const { convertir } = require('../src/convertir');

function depotJetable() {
  return ouvrir(fs.mkdtempSync(path.join(os.tmpdir(), 'sfne-depot-')));
}

const FACTURE = [
  "Facture d'avoir Nº A1234567U2600000038 Facture initiale Nº 1234567U26000000524",
  'Etablissement : DEMO NEGOCE',
  'Date et heure : 10/08/2026 10:01:12',
  'Client',
  'Nom : CLIENT DEMO CI NCC : 1234567X',
  '| Réf | Désignation | P.U HT | Qté | Unité | Taxes (%) | Rem. (%) | Montant HT |',
  '| A1 | RIZ | 1 000 | 2 | SAC | TVA (18) | 0 | 2 000 |',
  '| | | TOTAL A PAYER | | | | | 2 360 |'
].join('\n');

test('une cle d\'API n\'est jamais conservee en clair', () => {
  const depot = depotJetable();
  const { organisation, cle } = depot.creerOrganisation({ nom: 'Demo Negoce' });
  const surDisque = fs.readFileSync(path.join(depot.dossier, 'organisations.json'), 'utf8');
  assert.ok(!surDisque.includes(cle));
  assert.equal(depot.organisationParCle(cle).organisation.id, organisation.id);
  assert.equal(depot.organisationParCle('sfne_inconnue'), null);
  assert.equal(depot.organisationParCle(''), null);
});

test('une cle revoquee n\'ouvre plus rien', () => {
  const depot = depotJetable();
  const { organisation, cle } = depot.creerOrganisation({ nom: 'Demo Negoce' });
  const identite = depot.organisationParCle(cle);
  assert.equal(depot.revoquerCle(organisation.id, identite.cle.id), true);
  assert.equal(depot.organisationParCle(cle), null);
});

test('le quota compte les conversions du mois selon le plan', async () => {
  const depot = depotJetable();
  const { organisation } = depot.creerOrganisation({ nom: 'Petite boutique', plan: 'essai' });
  assert.equal(depot.quota(organisation.id).limite, 30);
  const resultat = await convertir(Buffer.from(FACTURE), { nom: 'avoir.md' });
  depot.enregistrerConversion(organisation.id, resultat);
  assert.equal(depot.quota(organisation.id).consomme, 1);
  assert.equal(depot.quota(organisation.id).restant, 29);
  assert.equal(depot.quota(organisation.id).depasse, false);
});

test('une organisation ne voit que ses propres conversions', async () => {
  const depot = depotJetable();
  const premiere = depot.creerOrganisation({ nom: 'Demo Negoce' }).organisation;
  const seconde = depot.creerOrganisation({ nom: 'Autre organisation' }).organisation;
  const resultat = await convertir(Buffer.from(FACTURE), { nom: 'avoir.md' });
  const fiche = depot.enregistrerConversion(premiere.id, resultat);

  assert.equal(depot.listerConversions(premiere.id).total, 1);
  assert.equal(depot.listerConversions(seconde.id).total, 0);
  assert.equal(depot.conversion(seconde.id, fiche.id), null);
  assert.equal(depot.markdown(seconde.id, fiche.id), null);
  assert.equal(depot.supprimerConversion(seconde.id, fiche.id), false);
  assert.match(depot.markdown(premiere.id, fiche.id), /Facture d'avoir/);
});

test('la fiche d\'une conversion resume la facture', async () => {
  const depot = depotJetable();
  const { organisation } = depot.creerOrganisation({ nom: 'Demo Negoce' });
  const fiche = depot.enregistrerConversion(organisation.id, await convertir(Buffer.from(FACTURE), { nom: 'avoir.md' }));
  assert.equal(fiche.type, 'avoir');
  assert.equal(fiche.numero, 'A1234567U2600000038');
  assert.equal(fiche.client, 'CLIENT DEMO CI');
  assert.equal(fiche.netAPayer, 2360);
});

test('une conversion supprimee disparait du disque', async () => {
  const depot = depotJetable();
  const { organisation } = depot.creerOrganisation({ nom: 'Demo Negoce' });
  const fiche = depot.enregistrerConversion(organisation.id, await convertir(Buffer.from(FACTURE), { nom: 'avoir.md' }));
  assert.equal(depot.supprimerConversion(organisation.id, fiche.id), true);
  assert.equal(fs.existsSync(path.join(depot.dossierConversions, `${fiche.id}.md`)), false);
  assert.equal(depot.listerConversions(organisation.id).total, 0);
});

test('le depot se relit tel qu\'il a ete ecrit', async () => {
  const depot = depotJetable();
  const { organisation, cle } = depot.creerOrganisation({ nom: 'Demo Negoce' });
  depot.enregistrerConversion(organisation.id, await convertir(Buffer.from(FACTURE), { nom: 'avoir.md' }));
  const relu = ouvrir(depot.dossier);
  assert.equal(relu.organisationParCle(cle).organisation.nom, 'Demo Negoce');
  assert.equal(relu.listerConversions(organisation.id).total, 1);
});
