'use strict';

// Demarre le service sur un depot jetable, depose la facture d'exemple par
// l'API et verifie que le Markdown revient complet. C'est le meme chemin que
// celui d'un client : cle d'API, envoi multipart, relecture du fichier.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ouvrir } = require('../src/donnees/depot');
const { creerServeur } = require('../src/serveur/serveur');

const EXEMPLE = path.join(__dirname, '..', 'exemples', 'facture-avoir.md');

function verifier(condition, libelle) {
  process.stdout.write(`${condition ? 'ok    ' : 'ECHEC '} ${libelle}\n`);
  if (!condition) process.exitCode = 1;
}

async function principal() {
  const depot = ouvrir(fs.mkdtempSync(path.join(os.tmpdir(), 'sfne-verification-')));
  const { organisation, cle } = depot.creerOrganisation({ nom: 'Verification', plan: 'pro' });
  const serveur = creerServeur({ depot, journal: false });
  await new Promise((resoudre) => serveur.listen(0, '127.0.0.1', resoudre));
  const base = `http://127.0.0.1:${serveur.address().port}`;

  try {
    const sante = await fetch(`${base}/sante`);
    verifier(sante.ok, 'le service repond sur /sante');

    const page = await fetch(`${base}/`);
    verifier(page.ok && (await page.text()).includes('SFNe'), "l'interface est servie");

    const formulaire = new FormData();
    formulaire.append('fichier', new Blob([fs.readFileSync(EXEMPLE)]), 'facture-avoir.md');
    const depose = await fetch(`${base}/api/v1/conversions`, {
      method: 'POST', body: formulaire, headers: { authorization: `Bearer ${cle}` }
    });
    verifier(depose.status === 201, 'une facture deposee est acceptee');
    const corps = await depose.json();
    verifier(corps.facture.document.numero === 'A1234567U2600000038', 'le numero de facture est lu');
    verifier(corps.facture.totaux.netAPayer === 25424, 'le total a payer est lu');
    verifier(corps.conforme === true, 'les controles passent');

    const markdown = await fetch(`${base}/api/v1/conversions/${corps.conversion.id}/markdown`, {
      headers: { authorization: `Bearer ${cle}` }
    });
    const texte = await markdown.text();
    verifier(texte.startsWith('---'), 'le Markdown porte son entete YAML');
    verifier(texte.includes('## Contrôles'), 'le Markdown porte ses controles');

    const sortie = path.join(depot.dossier, 'verification-facture.md');
    fs.writeFileSync(sortie, texte);
    process.stdout.write(`\nMarkdown ecrit dans ${sortie}\n`);

    const refus = await fetch(`${base}/api/v1/conversions`, { method: 'POST', body: 'x' });
    verifier(refus.status === 401, 'un depot sans cle est refuse');
    verifier(depot.listerConversions(organisation.id).total === 1, "l'historique tient a jour");
  } finally {
    serveur.close();
  }
}

principal().catch((erreur) => {
  process.stderr.write(`${erreur.stack}\n`);
  process.exitCode = 1;
});
