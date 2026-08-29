'use strict';

// L'interface : une cle d'API, un fichier depose, un Markdown en retour.
// Aucune dependance : le navigateur suffit.

(function () {
  const CLE_STOCKAGE = 'sfne.cle';
  const element = (id) => document.getElementById(id);
  let cle = null;
  let dernierMarkdown = null;
  let dernierNom = 'facture.md';

  function afficher(noeud, visible) {
    noeud.hidden = !visible;
  }

  function texteErreur(noeud, message) {
    noeud.textContent = message || '';
    afficher(noeud, Boolean(message));
  }

  async function appeler(chemin, options = {}) {
    const reponse = await fetch(chemin, {
      ...options,
      headers: { authorization: `Bearer ${cle}`, ...(options.headers || {}) }
    });
    if (reponse.status === 204) return null;
    const type = reponse.headers.get('content-type') || '';
    const corps = type.includes('json') ? await reponse.json() : await reponse.text();
    if (!reponse.ok) {
      const message = corps && corps.erreur ? corps.erreur.message : `Erreur ${reponse.status}`;
      throw new Error(message);
    }
    return corps;
  }

  const formaterMontant = (valeur, devise) => (valeur == null
    ? '—'
    : `${new Intl.NumberFormat('fr-FR').format(valeur)} ${devise === 'XOF' ? 'F CFA' : devise || ''}`.trim());

  function fiche(couples) {
    const liste = element('resultat-fiche');
    liste.innerHTML = '';
    for (const [nom, valeur] of couples) {
      if (valeur == null || valeur === '') continue;
      const bloc = document.createElement('div');
      const terme = document.createElement('dt');
      terme.textContent = nom;
      const definition = document.createElement('dd');
      definition.textContent = valeur;
      bloc.append(terme, definition);
      liste.append(bloc);
    }
  }

  function montrerResultat(reponse) {
    const facture = reponse.facture;
    const doc = facture.document;
    element('resultat-titre').textContent = `${doc.libelleType || 'Facture'} Nº ${doc.numero || '(numéro non lu)'}`;
    const etat = element('resultat-etat');
    etat.textContent = reponse.conforme ? 'Document cohérent' : 'Anomalies détectées';
    etat.className = `etat ${reponse.conforme ? 'ok' : 'anomalies'}`;

    fiche([
      ['Date', doc.date ? doc.date.brut : null],
      ['Vendeur', facture.vendeur.raisonSociale],
      ['Point de vente', facture.vendeur.pointDeVente],
      ['Client', facture.client.nom],
      ['NCC client', facture.client.ncc],
      ['Mode de paiement', doc.modePaiement],
      ['Total HT', formaterMontant(facture.totaux.totalHT, doc.devise)],
      ['TVA', formaterMontant(facture.totaux.totalTVA, doc.devise)],
      ['Net à payer', formaterMontant(facture.totaux.netAPayer, doc.devise)],
      ['Lignes', String(facture.lignes.length)],
      ['Facture initiale', doc.numeroFactureInitiale]
    ]);

    const controles = element('resultat-controles');
    controles.innerHTML = '';
    for (const controle of reponse.controles) {
      const ligne = document.createElement('li');
      ligne.className = controle.niveau;
      ligne.textContent = controle.libelle;
      const details = [controle.attendu && `attendu ${controle.attendu}`, controle.constate && `lu ${controle.constate}`, controle.note]
        .filter(Boolean).join(', ');
      if (details) {
        const precision = document.createElement('span');
        precision.className = 'detail';
        precision.textContent = ` (${details})`;
        ligne.append(precision);
      }
      controles.append(ligne);
    }

    dernierMarkdown = reponse.markdown;
    dernierNom = reponse.nomSortie || 'facture.md';
    element('resultat-markdown').textContent = reponse.markdown;
    afficher(element('resultat'), true);
    element('resultat').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function chargerHistorique() {
    const historique = await appeler('/api/v1/conversions?limite=15');
    const corps = element('historique-corps');
    corps.innerHTML = '';
    for (const conversion of historique.fiches) {
      const ligne = document.createElement('tr');
      const cellules = [
        new Date(conversion.creeLe).toLocaleString('fr-FR'),
        conversion.numero || '—',
        conversion.client || '—',
        formaterMontant(conversion.netAPayer, conversion.devise),
        conversion.conforme ? 'cohérent' : 'anomalies'
      ];
      for (const [rang, valeur] of cellules.entries()) {
        const cellule = document.createElement('td');
        if (rang === 3) cellule.className = 'droite';
        cellule.textContent = valeur;
        ligne.append(cellule);
      }
      const action = document.createElement('td');
      const bouton = document.createElement('button');
      bouton.type = 'button';
      bouton.className = 'lien';
      bouton.textContent = 'Markdown';
      bouton.addEventListener('click', async () => {
        const markdown = await appeler(`/api/v1/conversions/${conversion.id}/markdown`);
        telecharger(markdown, `${conversion.numero || conversion.id}.md`);
      });
      action.append(bouton);
      ligne.append(action);
      corps.append(ligne);
    }
    afficher(element('historique-vide'), historique.fiches.length === 0);
    afficher(element('historique'), true);
  }

  function telecharger(contenu, nom) {
    const lien = document.createElement('a');
    const url = URL.createObjectURL(new Blob([contenu], { type: 'text/markdown;charset=utf-8' }));
    lien.href = url;
    lien.download = nom;
    lien.click();
    URL.revokeObjectURL(url);
  }

  async function envoyer(fichier) {
    texteErreur(element('erreur-depot'), '');
    afficher(element('attente'), true);
    try {
      const formulaire = new FormData();
      formulaire.append('fichier', fichier, fichier.name);
      const reponse = await appeler('/api/v1/conversions', { method: 'POST', body: formulaire });
      montrerResultat(reponse);
      majQuota(reponse.quota);
      await chargerHistorique();
    } catch (erreur) {
      texteErreur(element('erreur-depot'), erreur.message);
    } finally {
      afficher(element('attente'), false);
    }
  }

  function majQuota(quota) {
    if (!quota) return;
    const limite = quota.limite === null || quota.limite === 'Infinity' || !isFinite(quota.limite) ? '∞' : quota.limite;
    element('compte-quota').textContent = `${quota.libellePlan} · ${quota.consomme}/${limite} ce mois`;
  }

  async function ouvrirSession(valeur) {
    cle = valeur;
    const moi = await appeler('/api/v1/moi');
    localStorage.setItem(CLE_STOCKAGE, valeur);
    element('compte-nom').textContent = moi.organisation.nom;
    majQuota(moi.quota);
    afficher(element('compte'), true);
    afficher(element('connexion'), false);
    afficher(element('depot'), true);
    await chargerHistorique();
  }

  element('formulaire-cle').addEventListener('submit', async (evenement) => {
    evenement.preventDefault();
    texteErreur(element('erreur-cle'), '');
    try {
      await ouvrirSession(element('champ-cle').value.trim());
    } catch (erreur) {
      cle = null;
      texteErreur(element('erreur-cle'), erreur.message);
    }
  });

  element('deconnexion').addEventListener('click', () => {
    localStorage.removeItem(CLE_STOCKAGE);
    location.reload();
  });

  const zone = element('zone');
  const champFichier = element('champ-fichier');
  zone.addEventListener('click', () => champFichier.click());
  zone.addEventListener('keydown', (evenement) => {
    if (evenement.key === 'Enter' || evenement.key === ' ') champFichier.click();
  });
  champFichier.addEventListener('change', () => {
    if (champFichier.files[0]) envoyer(champFichier.files[0]);
    champFichier.value = '';
  });
  ['dragenter', 'dragover'].forEach((nom) => zone.addEventListener(nom, (evenement) => {
    evenement.preventDefault();
    zone.classList.add('survol');
  }));
  ['dragleave', 'drop'].forEach((nom) => zone.addEventListener(nom, (evenement) => {
    evenement.preventDefault();
    zone.classList.remove('survol');
  }));
  zone.addEventListener('drop', (evenement) => {
    const fichier = evenement.dataTransfer.files[0];
    if (fichier) envoyer(fichier);
  });

  element('copier').addEventListener('click', async () => {
    if (dernierMarkdown) await navigator.clipboard.writeText(dernierMarkdown);
  });
  element('telecharger').addEventListener('click', () => {
    if (dernierMarkdown) telecharger(dernierMarkdown, dernierNom);
  });

  const memorisee = localStorage.getItem(CLE_STOCKAGE);
  if (memorisee) {
    element('champ-cle').value = memorisee;
    ouvrirSession(memorisee).catch(() => {
      localStorage.removeItem(CLE_STOCKAGE);
      cle = null;
    });
  }
})();
