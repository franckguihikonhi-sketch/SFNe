'use strict';

// Restitution d'une facture lue en un fichier Markdown.
//
// Le fichier vise deux lecteurs : une personne, qui doit retrouver d'un coup
// d'oeil ce que la facture dit, et un programme, qui lit l'entete YAML sans
// avoir a comprendre le corps du document.

const { formaterMontant, formaterTaux, libelleDevise, normaliserEspaces } = require('../metier/texte');

const SIGNES = { ok: '✅', attention: '⚠️', erreur: '❌' };

function echapperCellule(valeur) {
  if (valeur == null || valeur === '') return '—';
  return String(valeur).replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ').trim() || '—';
}

function scalaireYaml(valeur) {
  if (valeur == null) return 'null';
  if (typeof valeur === 'number' || typeof valeur === 'boolean') return String(valeur);
  const texte = String(valeur);
  if (/^[A-Za-z0-9][A-Za-z0-9 _.@/+-]*$/.test(texte) && !/^\s|\s$/.test(texte)) return texte;
  return `"${texte.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function tableau(entetes, lignes, alignements) {
  const separateur = entetes.map((entete, rang) => {
    const alignement = alignements && alignements[rang];
    if (alignement === 'droite') return '---:';
    if (alignement === 'centre') return ':---:';
    return '---';
  });
  return [
    `| ${entetes.join(' | ')} |`,
    `| ${separateur.join(' | ')} |`,
    ...lignes.map((ligne) => `| ${ligne.map(echapperCellule).join(' | ')} |`)
  ].join('\n');
}

function tableauChamps(couples) {
  const retenus = couples.filter(([, valeur]) => valeur != null && valeur !== '');
  if (!retenus.length) return '_Aucune information lisible sur le document._';
  return tableau(['Champ', 'Valeur'], retenus.map(([champ, valeur]) => [champ, valeur]));
}

function dateLisible(date) {
  if (!date) return null;
  const deux = (n) => String(n).padStart(2, '0');
  const heure = date.iso.slice(11);
  const jour = `${deux(date.jour)}/${deux(date.mois)}/${date.annee}`;
  return heure === '00:00:00' ? jour : `${jour} à ${heure}`;
}

function libelleTaxes(taxes) {
  if (!taxes || !taxes.length) return null;
  return taxes.map((taxe) => `${taxe.code} ${formaterTaux(taxe.taux)}`).join(' + ');
}

function enTeteYaml(facture, verdict) {
  const { document: doc, vendeur, client, totaux, meta } = facture;
  const champs = [
    ['type', doc.type === 'avoir' ? 'facture-avoir' : 'facture-vente'],
    ['numero', doc.numero],
    ['facture_initiale', doc.numeroFactureInitiale],
    ['emise_le', doc.date ? doc.date.iso : null],
    ['mode_paiement', doc.modePaiement],
    ['devise', doc.devise],
    ['vendeur', vendeur.raisonSociale],
    ['vendeur_ncc', vendeur.ncc],
    ['vendeur_rccm', vendeur.rccm],
    ['point_de_vente', vendeur.pointDeVente],
    ['client', client.nom],
    ['client_ncc', client.ncc],
    ['client_regime', client.regimeImposition],
    ['total_ht', totaux.totalHT],
    ['total_tva', totaux.totalTVA],
    ['autres_taxes', totaux.autresTaxes],
    ['total_ttc', totaux.totalTTC],
    ['net_a_payer', totaux.netAPayer],
    // Un avoir se retranche : le sens porte le signe a donner en comptabilite.
    ['sens_comptable', doc.type === 'avoir' ? -1 : 1],
    ['nombre_de_lignes', (facture.lignes || []).length],
    ['conforme', verdict ? verdict.conforme : null],
    ['source', meta.source],
    ['extrait_le', meta.extraitLe],
    ['extrait_par', `${meta.outil}`]
  ];
  const corps = champs
    .filter(([, valeur]) => valeur != null && valeur !== '')
    .map(([nom, valeur]) => `${nom}: ${scalaireYaml(valeur)}`);
  return ['---', ...corps, '---'].join('\n');
}

function sectionLignes(facture) {
  const devise = libelleDevise(facture.document.devise);
  const lignes = (facture.lignes || []).map((ligne, rang) => [
    rang + 1,
    ligne.reference,
    ligne.designation,
    formaterMontant(ligne.prixUnitaireHT),
    ligne.quantite == null ? null : formaterMontant(ligne.quantite),
    ligne.unite,
    libelleTaxes(ligne.taxes),
    ligne.remise ? formaterTaux(ligne.remise) : '0 %',
    formaterMontant(ligne.montantHT)
  ]);
  if (!lignes.length) return '_Aucune ligne de facturation lue._';
  return tableau(
    ['#', 'Réf.', 'Désignation', `P.U. HT (${devise})`, 'Qté', 'Unité', 'Taxes', 'Rem.', `Montant HT (${devise})`],
    lignes,
    ['centre', 'gauche', 'gauche', 'droite', 'droite', 'centre', 'gauche', 'droite', 'droite']
  );
}

function sectionTotaux(facture) {
  const devise = libelleDevise(facture.document.devise);
  const { totaux } = facture;
  const couples = [
    ['Total HT', totaux.totalHT],
    ['Remise globale', totaux.remiseGlobale],
    ['TVA', totaux.totalTVA],
    ['Autres taxes', totaux.autresTaxes],
    ['Total TTC', totaux.totalTTC],
    ['Avance / acompte', totaux.avance],
    ['**Total à payer**', totaux.netAPayer]
  ].filter(([, valeur]) => valeur != null);
  if (!couples.length) return '_Aucun total lu sur le document._';
  return tableau(['Libellé', `Montant (${devise})`],
    couples.map(([nom, valeur]) => [nom, nom.startsWith('**') ? `**${formaterMontant(valeur)}**` : formaterMontant(valeur)]),
    ['gauche', 'droite']);
}

function sectionTaxes(facture, verdict) {
  const devise = libelleDevise(facture.document.devise);
  const declarees = facture.taxes || [];
  const source = declarees.length
    ? declarees.map((taxe) => [taxe.libelle, formaterMontant(taxe.base), formaterTaux(taxe.taux), formaterMontant(taxe.montant)])
    : (verdict ? verdict.ventilation : []).map((entree) => [
      `TVA ${formaterTaux(entree.taux)} (reconstituée depuis les lignes)`,
      formaterMontant(entree.base), formaterTaux(entree.taux), formaterMontant(entree.montant)
    ]);
  if (!source.length) return '_Aucune ventilation de taxes lisible._';
  return tableau(['Catégorie', `Base HT (${devise})`, 'Taux', `Taxe (${devise})`], source,
    ['gauche', 'droite', 'centre', 'droite']);
}

function sectionControles(verdict) {
  const lignes = verdict.controles.map((item) => {
    const details = [];
    if (item.attendu != null) details.push(`attendu ${item.attendu}`);
    if (item.constate != null) details.push(`lu ${item.constate}`);
    if (item.note) details.push(item.note);
    return `- ${SIGNES[item.niveau]} ${item.libelle}${details.length ? ` (${details.join(', ')})` : ''}`;
  });
  const compte = verdict.compte;
  const verdictLigne = verdict.conforme
    ? `**Document cohérent** — ${compte.ok} contrôle(s) passé(s), ${compte.attention} réserve(s).`
    : `**Anomalies détectées** — ${compte.erreur} erreur(s), ${compte.attention} réserve(s), ${compte.ok} contrôle(s) passé(s).`;
  return [verdictLigne, '', ...lignes].join('\n');
}

function versMarkdown(facture, verdict, options = {}) {
  const avecControles = options.controles !== false;
  const avecProvenance = options.provenance !== false;
  const doc = facture.document;
  const titre = `${doc.libelleType || 'Facture'} Nº ${doc.numero || '(numéro non lu)'}`;
  const morceaux = [];

  morceaux.push(enTeteYaml(facture, avecControles ? verdict : null));
  morceaux.push(`# ${titre}`);

  const chapeau = [];
  const date = dateLisible(doc.date);
  if (date) chapeau.push(`Émise le **${date}**`);
  if (facture.vendeur.raisonSociale) chapeau.push(`par **${facture.vendeur.raisonSociale}**`);
  if (facture.client.nom) chapeau.push(`pour **${facture.client.nom}**`);
  if (chapeau.length) morceaux.push(`${chapeau.join(' ')}.`);
  if (doc.type === 'avoir') {
    const reference = doc.numeroFactureInitiale ? ` de la facture initiale Nº **${doc.numeroFactureInitiale}**` : '';
    morceaux.push(`> **Facture d'avoir.** Les montants ci-dessous se **déduisent**${reference}.`);
  }

  morceaux.push('## Émetteur');
  morceaux.push(tableauChamps([
    ['Raison sociale', facture.vendeur.raisonSociale],
    ['NCC', facture.vendeur.ncc],
    ['RCCM', facture.vendeur.rccm],
    ["Régime d'imposition", facture.vendeur.regimeImposition],
    ['Centre des impôts', facture.vendeur.centreImpots],
    ['Adresse', facture.vendeur.adresse],
    ['Siège social', facture.vendeur.siegeSocial],
    ['Téléphone', facture.vendeur.telephone],
    ['Courriel', facture.vendeur.mail],
    ['Point de vente', facture.vendeur.pointDeVente],
    ['Vendeur', facture.vendeur.nomVendeur],
    ['Références bancaires', facture.vendeur.referencesBancaires]
  ]));

  morceaux.push('## Client');
  morceaux.push(tableauChamps([
    ['Nom', facture.client.nom],
    ['NCC', facture.client.ncc],
    ["Régime d'imposition", facture.client.regimeImposition],
    ['Adresse', facture.client.adresse],
    ['Téléphone', facture.client.telephone],
    ['Courriel', facture.client.mail],
    ['Code client', facture.client.code]
  ]));

  morceaux.push('## Facture');
  morceaux.push(tableauChamps([
    ['Type', doc.libelleType],
    ['Numéro', doc.numero],
    ['Facture initiale', doc.numeroFactureInitiale],
    ['Date et heure', date],
    ['Échéance', dateLisible(doc.echeance)],
    ['Mode de paiement', doc.modePaiement],
    ['Devise', `${doc.devise} (${libelleDevise(doc.devise)})`],
    ['Bon de commande', doc.bonCommande],
    ["Nature de l'opération", doc.natureOperation]
  ]));

  morceaux.push('## Détail');
  morceaux.push(sectionLignes(facture));

  morceaux.push('## Totaux');
  morceaux.push(sectionTotaux(facture));

  morceaux.push('## Récapitulatif des taxes');
  morceaux.push(sectionTaxes(facture, verdict));

  const verification = facture.verification || {};
  if (verification.codeVerification || verification.sticker || verification.url) {
    morceaux.push('## Vérification');
    morceaux.push(tableauChamps([
      ['Code de vérification', verification.codeVerification],
      ['Sticker électronique', verification.sticker],
      ['Lien de vérification', verification.url]
    ]));
  }

  if (avecControles && verdict) {
    morceaux.push('## Contrôles');
    morceaux.push(sectionControles(verdict));
  }

  if ((facture.pied || []).length) {
    morceaux.push('## Mentions du document');
    morceaux.push((facture.pied || []).map((ligne) => `- ${normaliserEspaces(ligne)}`).join('\n'));
  }

  if (avecProvenance) {
    morceaux.push('## Provenance');
    const provenance = [
      ['Fichier source', facture.meta.source],
      ['Format lu', facture.meta.format],
      ['Extrait le', facture.meta.extraitLe],
      ['Extrait par', facture.meta.outil]
    ];
    morceaux.push(tableauChamps(provenance));
    if ((facture.nonLues || []).length) {
      morceaux.push('**Lignes du document non rattachées à un champ connu** — reproduites telles quelles :');
      morceaux.push((facture.nonLues || []).map((ligne) => `- ${normaliserEspaces(ligne)}`).join('\n'));
    }
  }

  return morceaux.join('\n\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

module.exports = { versMarkdown, tableau, scalaireYaml };
