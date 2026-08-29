'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ouvrir } = require('../src/donnees/depot');
const { creerServeur } = require('../src/serveur/serveur');

const EXEMPLE = fs.readFileSync(path.join(__dirname, '..', 'exemples', 'facture-avoir.md'), 'utf8');

async function service() {
  const depot = ouvrir(fs.mkdtempSync(path.join(os.tmpdir(), 'sfne-serveur-')));
  const { organisation, cle } = depot.creerOrganisation({ nom: 'Demo Negoce', plan: 'pro' });
  const serveur = creerServeur({ depot, journal: false });
  await new Promise((resoudre) => serveur.listen(0, '127.0.0.1', resoudre));
  const base = `http://127.0.0.1:${serveur.address().port}`;
  const appeler = (chemin, options = {}) => fetch(`${base}${chemin}`, {
    ...options,
    headers: { authorization: `Bearer ${cle}`, ...(options.headers || {}) }
  });
  const deposer = (contenu = EXEMPLE, nom = 'facture-avoir.md', chemin = '/api/v1/conversions') => {
    const formulaire = new FormData();
    formulaire.append('fichier', new Blob([contenu], { type: 'text/markdown' }), nom);
    return appeler(chemin, { method: 'POST', body: formulaire });
  };
  const deposerLot = (fichiers, chemin = '/api/v1/lots') => {
    const formulaire = new FormData();
    for (const [nom, contenu] of fichiers) {
      formulaire.append('fichier', new Blob([contenu], { type: 'text/markdown' }), nom);
    }
    return appeler(chemin, { method: 'POST', body: formulaire });
  };
  return { depot, organisation, cle, serveur, base, appeler, deposer, deposerLot, fermer: () => serveur.close() };
}

test('le service repond sur /sante sans cle', async (t) => {
  const s = await service();
  t.after(s.fermer);
  const reponse = await fetch(`${s.base}/sante`);
  assert.equal(reponse.status, 200);
  assert.equal((await reponse.json()).etat, 'ok');
});

test('l\'API refuse une requete sans cle valide', async (t) => {
  const s = await service();
  t.after(s.fermer);
  const sansCle = await fetch(`${s.base}/api/v1/moi`);
  assert.equal(sansCle.status, 401);
  assert.equal((await sansCle.json()).erreur.code, 'non_authentifie');

  const mauvaiseCle = await fetch(`${s.base}/api/v1/moi`, { headers: { authorization: 'Bearer sfne_faux' } });
  assert.equal(mauvaiseCle.status, 401);
});

test('un depot de facture rend la facture lue, ses controles et son Markdown', async (t) => {
  const s = await service();
  t.after(s.fermer);
  const reponse = await s.deposer();
  assert.equal(reponse.status, 201);
  const corps = await reponse.json();
  assert.equal(corps.facture.document.numero, 'A1234567U2600000038');
  assert.equal(corps.conforme, true);
  assert.equal(corps.nomSortie, 'facture-avoir.md');
  assert.match(corps.markdown, /^---\ntype: facture-avoir/);
  assert.ok(corps.controles.length > 5);
  assert.equal(corps.quota.consomme, 1);
  assert.equal(reponse.headers.get('location'), `/api/v1/conversions/${corps.conversion.id}`);
});

test('le Markdown peut etre demande directement', async (t) => {
  const s = await service();
  t.after(s.fermer);
  const reponse = await s.deposer(EXEMPLE, 'facture.md', '/api/v1/conversions?format=markdown');
  assert.equal(reponse.status, 201);
  assert.match(reponse.headers.get('content-type'), /text\/markdown/);
  assert.match(await reponse.text(), /# Facture d'avoir/);
});

test('un envoi sans formulaire passe aussi, avec le nom en entete', async (t) => {
  const s = await service();
  t.after(s.fermer);
  const reponse = await s.appeler('/api/v1/conversions', {
    method: 'POST',
    headers: { 'content-type': 'text/markdown', 'x-nom-fichier': 'avoir-aout.md' },
    body: EXEMPLE
  });
  assert.equal(reponse.status, 201);
  assert.equal((await reponse.json()).conversion.fichier, 'avoir-aout.md');
});

test('l\'historique, le detail et le fichier se relisent', async (t) => {
  const s = await service();
  t.after(s.fermer);
  const { conversion } = await (await s.deposer()).json();

  const historique = await (await s.appeler('/api/v1/conversions')).json();
  assert.equal(historique.total, 1);
  assert.equal(historique.fiches[0].id, conversion.id);

  const detail = await (await s.appeler(`/api/v1/conversions/${conversion.id}`)).json();
  assert.equal(detail.facture.client.nom, "SUPERMARCHES DEMO CI");

  const markdown = await s.appeler(`/api/v1/conversions/${conversion.id}/markdown?telecharger=oui`);
  assert.match(markdown.headers.get('content-disposition'), /attachment/);
  assert.match(await markdown.text(), /## Récapitulatif des taxes/);
});

test('une conversion se supprime, et n\'est plus lisible ensuite', async (t) => {
  const s = await service();
  t.after(s.fermer);
  const { conversion } = await (await s.deposer()).json();
  assert.equal((await s.appeler(`/api/v1/conversions/${conversion.id}`, { method: 'DELETE' })).status, 204);
  assert.equal((await s.appeler(`/api/v1/conversions/${conversion.id}`)).status, 404);
});

test('une organisation ne peut pas lire la conversion d\'une autre', async (t) => {
  const s = await service();
  t.after(s.fermer);
  const { conversion } = await (await s.deposer()).json();
  const autre = s.depot.creerOrganisation({ nom: 'Autre organisation' }).cle;
  const reponse = await fetch(`${s.base}/api/v1/conversions/${conversion.id}`, {
    headers: { authorization: `Bearer ${autre}` }
  });
  assert.equal(reponse.status, 404);
});

test('un fichier illisible est refuse avec une raison', async (t) => {
  const s = await service();
  t.after(s.fermer);
  const reponse = await s.deposer('   ', 'vide.md');
  assert.equal(reponse.status, 400);
  assert.equal((await reponse.json()).erreur.code, 'entree_invalide');
});

test('le quota du plan arrete les depots', async (t) => {
  const s = await service();
  t.after(s.fermer);
  const petite = s.depot.creerOrganisation({ nom: 'Petite', plan: 'essai' });
  s.depot.organisationParId(petite.organisation.id).plan = 'essai';
  for (let compte = 0; compte < 30; compte += 1) {
    s.depot.index.unshift({ id: `cnv_${compte}`, organisation: petite.organisation.id, creeLe: new Date().toISOString() });
  }
  const formulaire = new FormData();
  formulaire.append('fichier', new Blob([EXEMPLE]), 'facture.md');
  const reponse = await fetch(`${s.base}/api/v1/conversions`, {
    method: 'POST', body: formulaire, headers: { authorization: `Bearer ${petite.cle}` }
  });
  assert.equal(reponse.status, 402);
  assert.equal((await reponse.json()).erreur.code, 'quota_depasse');
});

test('l\'interface web est servie a la racine', async (t) => {
  const s = await service();
  t.after(s.fermer);
  const page = await fetch(`${s.base}/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /SFNe/);
  const style = await fetch(`${s.base}/style.css`);
  assert.match(style.headers.get('content-type'), /text\/css/);
});

test('les requetes trop nombreuses sont freinees', async (t) => {
  const depot = ouvrir(fs.mkdtempSync(path.join(os.tmpdir(), 'sfne-limite-')));
  const { cle } = depot.creerOrganisation({ nom: 'Demo Negoce' });
  const serveur = creerServeur({ depot, journal: false, limites: { requetes: 2, fenetreMs: 60000 } });
  await new Promise((resoudre) => serveur.listen(0, '127.0.0.1', resoudre));
  t.after(() => serveur.close());
  const base = `http://127.0.0.1:${serveur.address().port}`;
  const appeler = () => fetch(`${base}/api/v1/moi`, { headers: { authorization: `Bearer ${cle}` } });
  assert.equal((await appeler()).status, 200);
  assert.equal((await appeler()).status, 200);
  const troisieme = await appeler();
  assert.equal(troisieme.status, 429);
  assert.ok(Number(troisieme.headers.get('retry-after')) > 0);
});

test('un lot depose plusieurs factures en un envoi', async (t) => {
  const s = await service();
  t.after(s.fermer);
  const reponse = await s.deposerLot([
    ['aout-01.md', EXEMPLE],
    ['aout-02.md', EXEMPLE],
    ['aout-03.md', EXEMPLE]
  ]);
  assert.equal(reponse.status, 201);
  const corps = await reponse.json();
  assert.equal(corps.lot.total, 3);
  assert.equal(corps.lot.lues, 3);
  assert.equal(corps.lot.conformes, 3);
  assert.equal(corps.lot.illisibles, 0);
  assert.equal(corps.conversions.length, 3);
  assert.deepEqual(corps.conversions.map((entree) => entree.fichier), ['aout-01.md', 'aout-02.md', 'aout-03.md']);
  assert.equal(corps.quota.consomme, 3);
  assert.match(reponse.headers.get('location'), /^\/api\/v1\/lots\/lot_/);
});

test('une facture illisible n\'arrete pas le reste du lot', async (t) => {
  const s = await service();
  t.after(s.fermer);
  const corps = await (await s.deposerLot([
    ['bonne.md', EXEMPLE],
    ['vide.md', '   '],
    ['autre.md', EXEMPLE]
  ])).json();
  assert.equal(corps.lot.lues, 2);
  assert.equal(corps.lot.illisibles, 1);
  assert.equal(corps.conversions[1].erreur.code, 'entree_invalide');
  assert.ok(corps.conversions[0].conversion.id);
  assert.ok(corps.conversions[2].conversion.id);
});

test('un lot se relit, et ses Markdown se recuperent bout a bout', async (t) => {
  const s = await service();
  t.after(s.fermer);
  const { lot } = await (await s.deposerLot([['a.md', EXEMPLE], ['b.md', EXEMPLE]])).json();

  const detail = await (await s.appeler(`/api/v1/lots/${lot.id}`)).json();
  assert.equal(detail.total, 2);
  assert.deepEqual(detail.fiches.map((fiche) => fiche.lot), [lot.id, lot.id]);

  const markdown = await s.appeler(`/api/v1/lots/${lot.id}/markdown?telecharger=oui`);
  const texte = await markdown.text();
  assert.match(markdown.headers.get('content-disposition'), /attachment/);
  assert.equal(texte.split(/^# Facture/m).length - 1, 2);
  assert.equal((await s.appeler('/api/v1/lots/lot_inconnu')).status, 404);
});

test('le Markdown d\'un lot peut revenir directement', async (t) => {
  const s = await service();
  t.after(s.fermer);
  const reponse = await s.deposerLot([['a.md', EXEMPLE], ['b.md', EXEMPLE]], '/api/v1/lots?format=markdown');
  assert.equal(reponse.status, 201);
  assert.match(reponse.headers.get('content-type'), /text\/markdown/);
  assert.ok(reponse.headers.get('x-lot-id').startsWith('lot_'));
  assert.equal((await reponse.text()).split(/^# Facture/m).length - 1, 2);
});

test('ce qui depasse le quota est refuse fichier par fichier, le reste passe', async (t) => {
  const s = await service();
  t.after(s.fermer);
  const petite = s.depot.creerOrganisation({ nom: 'Petite', plan: 'essai' });
  for (let compte = 0; compte < 28; compte += 1) {
    s.depot.index.unshift({ id: `cnv_${compte}`, organisation: petite.organisation.id, creeLe: new Date().toISOString() });
  }
  const formulaire = new FormData();
  for (const nom of ['a.md', 'b.md', 'c.md', 'd.md']) {
    formulaire.append('fichier', new Blob([EXEMPLE]), nom);
  }
  const corps = await (await fetch(`${s.base}/api/v1/lots`, {
    method: 'POST', body: formulaire, headers: { authorization: `Bearer ${petite.cle}` }
  })).json();
  assert.equal(corps.lot.lues, 2);
  assert.equal(corps.lot.refusesQuota, 2);
  assert.equal(corps.conversions[2].erreur.code, 'quota_depasse');
  assert.equal(corps.quota.consomme, 30);
});

test('un lot sans fichier ou hors formulaire est refuse', async (t) => {
  const s = await service();
  t.after(s.fermer);
  const brut = await s.appeler('/api/v1/lots', { method: 'POST', headers: { 'content-type': 'text/markdown' }, body: EXEMPLE });
  assert.equal(brut.status, 400);
  assert.match((await brut.json()).erreur.message, /multipart/);

  const vide = new FormData();
  vide.append('note', 'sans fichier');
  const sansFichier = await s.appeler('/api/v1/lots', { method: 'POST', body: vide });
  assert.equal(sansFichier.status, 400);
});
