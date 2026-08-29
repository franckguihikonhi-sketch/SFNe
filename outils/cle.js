#!/usr/bin/env node
'use strict';

// Cree une organisation et sa premiere cle d'API, ou ajoute une cle a une
// organisation existante.
//
//   npm run cle -- "Ma societe" [plan]
//   npm run cle -- --organisation org_xxx "cle de production"

const { ouvrir, PLANS } = require('../src/donnees/depot');

function principal(arguments_) {
  const depot = ouvrir(process.env.SFNE_DONNEES);
  if (arguments_[0] === '--organisation') {
    const [, id, nom] = arguments_;
    const { cle } = depot.creerCle(id, nom || 'cle');
    process.stdout.write(`Cle creee pour ${id} :\n${cle}\n`);
    return;
  }
  if (arguments_[0] === '--lister') {
    for (const organisation of depot.organisations) {
      const quota = depot.quota(organisation.id);
      process.stdout.write(`${organisation.id}  ${organisation.nom}  plan ${organisation.plan}  ${quota.consomme}/${quota.limite} ce mois\n`);
    }
    return;
  }
  const [nom, plan = 'essai'] = arguments_;
  if (!nom) {
    process.stdout.write([
      'Usage :',
      '  npm run cle -- "Nom de l\'organisation" [' + Object.keys(PLANS).join('|') + ']',
      '  npm run cle -- --organisation <org_id> "nom de la cle"',
      '  npm run cle -- --lister',
      ''
    ].join('\n'));
    process.exitCode = 1;
    return;
  }
  const { organisation, cle } = depot.creerOrganisation({ nom, plan });
  process.stdout.write(`Organisation ${organisation.nom} (${organisation.id}), plan ${organisation.plan}.\nCle d'API : ${cle}\n`);
}

if (require.main === module) principal(process.argv.slice(2));

module.exports = { principal };
