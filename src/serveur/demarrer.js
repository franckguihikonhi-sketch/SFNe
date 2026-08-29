'use strict';

// Demarrage du service. Au premier lancement, une organisation est creee et sa
// cle d'API est affichee une seule fois : elle n'est conservee qu'en empreinte.

const { ouvrir } = require('../donnees/depot');
const { creerServeur } = require('./serveur');
const { creerVerificateur } = require('../verification/dgi');

function demarrer(options = {}) {
  const depot = options.depot || ouvrir(options.dossier);
  if (!depot.organisations.length && options.amorcer !== false) {
    const { organisation, cle } = depot.creerOrganisation({
      nom: process.env.SFNE_ORGANISATION || 'Organisation de demarrage',
      plan: process.env.SFNE_PLAN || 'pro'
    });
    process.stdout.write([
      '',
      `Organisation creee : ${organisation.nom} (${organisation.id}).`,
      `Cle d'API : ${cle}`,
      'Notez-la : elle ne sera plus affichee.',
      ''
    ].join('\n') + '\n');
  }
  const verificateur = options.verificateur || creerVerificateur();
  process.stdout.write(verificateur.configure
    ? 'Verification des stickers aupres de la DGI : activee.\n'
    : 'Verification des stickers aupres de la DGI : non configuree (SFNE_DGI_URL absent).\n');
  const serveur = creerServeur({ depot, verificateur, ...options });
  const port = Number(options.port || process.env.PORT || 3000);
  serveur.listen(port, () => {
    process.stdout.write(`SFNe ecoute sur http://localhost:${serveur.address().port}\n`);
  });
  return { serveur, depot };
}

if (require.main === module) demarrer();

module.exports = { demarrer };
