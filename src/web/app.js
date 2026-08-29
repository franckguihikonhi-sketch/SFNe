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

  // Un lot depose : une ligne par facture, son sort a cote.
  function montrerLot(reponse) {
    const lot = reponse.lot;
    const etat = element('lot-etat');
    const sansSouci = lot.illisibles === 0 && lot.avecAnomalies === 0 && !lot.refusesQuota;
    etat.textContent = sansSouci ? 'Tout est passé' : 'À regarder';
    etat.className = `etat ${sansSouci ? 'ok' : 'anomalies'}`;
    const morceaux = [`${lot.lues} facture(s) lue(s) sur ${lot.total}`];
    if (lot.avecAnomalies) morceaux.push(`${lot.avecAnomalies} avec anomalies`);
    if (lot.illisibles) morceaux.push(`${lot.illisibles} illisible(s)`);
    if (lot.refusesQuota) morceaux.push(`${lot.refusesQuota} refusée(s) faute de quota`);
    element('lot-resume').textContent = morceaux.join(' · ');

    const corps = element('lot-corps');
    corps.innerHTML = '';
    for (const entree of reponse.conversions) {
      const fiche = entree.conversion;
      const ligne = document.createElement('tr');
      const cellules = [
        entree.fichier,
        fiche ? (fiche.numero || '—') : '—',
        fiche ? (fiche.client || '—') : '—',
        fiche ? formaterMontant(fiche.netAPayer, fiche.devise) : '—',
        entree.erreur ? entree.erreur.message : (entree.conforme ? 'cohérent' : 'anomalies')
      ];
      cellules.forEach((valeur, rang) => {
        const cellule = document.createElement('td');
        if (rang === 3) cellule.className = 'droite';
        if (rang === 4 && entree.erreur) cellule.className = 'echec';
        cellule.textContent = valeur;
        ligne.append(cellule);
      });
      const action = document.createElement('td');
      if (fiche) {
        const bouton = document.createElement('button');
        bouton.type = 'button';
        bouton.className = 'lien';
        bouton.textContent = 'Markdown';
        bouton.addEventListener('click', async () => {
          telecharger(await appeler(`/api/v1/conversions/${fiche.id}/markdown`), entree.nomSortie || `${fiche.id}.md`);
        });
        action.append(bouton);
      }
      ligne.append(action);
      corps.append(ligne);
    }

    element('lot-telecharger').onclick = async () => {
      telecharger(await appeler(`/api/v1/lots/${lot.id}/markdown`), `${lot.id}.md`);
    };
    afficher(element('lot'), true);
    afficher(element('resultat'), false);
    element('lot').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function envoyer(fichiers) {
    const liste = [...fichiers];
    if (!liste.length) return;
    texteErreur(element('erreur-depot'), '');
    element('attente').textContent = liste.length > 1
      ? `Lecture de ${liste.length} factures…`
      : 'Lecture de la facture…';
    afficher(element('attente'), true);
    try {
      const formulaire = new FormData();
      for (const fichier of liste) formulaire.append('fichier', fichier, fichier.name);
      const route = liste.length > 1 ? '/api/v1/lots' : '/api/v1/conversions';
      const reponse = await appeler(route, { method: 'POST', body: formulaire });
      if (liste.length > 1) montrerLot(reponse);
      else {
        afficher(element('lot'), false);
        montrerResultat(reponse);
      }
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
    envoyer(champFichier.files);
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
  zone.addEventListener('drop', (evenement) => envoyer(evenement.dataTransfer.files));

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
