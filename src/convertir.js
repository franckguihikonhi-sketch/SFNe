'use strict';

// Le chemin complet : un fichier depose, un Markdown en sortie.
//
//   fichier -> texte -> facture lue -> controles -> Markdown
//
// Tout le reste du logiciel (ligne de commande, API, interface) passe par ici.

const path = require('node:path');
const { extraireTexte, EntreeInvalide } = require('./extraction/entree');
const { analyser } = require('./metier/analyse');
const { controler } = require('./metier/controles');
const { versMarkdown } = require('./rendu/markdown');

function nomDeSortie(nomFichier) {
  const base = path.basename(String(nomFichier || 'facture'), path.extname(String(nomFichier || '')));
  return `${base || 'facture'}.md`;
}

// Ni numero, ni ligne, ni total : le fichier n'est pas une facture. Le dire
// vaut mieux que de rendre un document vide, surtout dans un lot ou il
// viendrait s'ajouter a l'historique sans rien apporter.
function ressembleAUneFacture(facture) {
  if (facture.document.numero) return true;
  if ((facture.lignes || []).length) return true;
  return Object.values(facture.totaux).some((valeur) => valeur != null);
}

async function convertir(donnees, options = {}) {
  const nom = options.nom || null;
  const { texte, format, codes } = await extraireTexte(donnees, nom);
  const facture = analyser(texte, {
    source: nom,
    format,
    codes,
    extraitLe: options.extraitLe || new Date().toISOString()
  });
  // La verification aupres de la DGI passe avant les controles : c'est l'un
  // d'eux. Elle ne peut jamais faire echouer une conversion.
  if (options.verificateur && options.verificateur.configure) {
    try {
      const verdict = await options.verificateur.verifier(facture);
      facture.verification.etat = verdict.etat;
      facture.verification.verifieLe = verdict.verifieLe;
      facture.verification.details = verdict.details || null;
    } catch (erreur) {
      facture.verification.etat = 'indisponible';
      facture.verification.details = erreur.message;
    }
  }

  if (!ressembleAUneFacture(facture)) {
    throw new EntreeInvalide('Ce fichier ne porte ni numero de facture, ni ligne, ni total : ce n\'est pas une facture normalisee.');
  }
  const verdict = controler(facture);
  const markdown = versMarkdown(facture, verdict, options.rendu || {});
  return { facture, verdict, markdown, texte, format, nomSortie: nomDeSortie(nom) };
}

// Un lot : plusieurs factures dans un seul envoi. Une facture illisible
// n'arrete pas les autres — sur un lot de fin de mois, il en manquerait une et
// tout serait a refaire. Chaque entree porte donc son sort.
async function convertirLot(fichiers, options = {}) {
  const resultats = [];
  for (const fichier of fichiers) {
    const nom = fichier.nom || null;
    try {
      const resultat = await convertir(fichier.donnees, { ...options, nom });
      resultats.push({ nom, resultat, erreur: null });
    } catch (erreur) {
      resultats.push({
        nom,
        resultat: null,
        erreur: { code: erreur.code === 'ENTREE_INVALIDE' ? 'entree_invalide' : 'erreur_lecture', message: erreur.message }
      });
    }
  }
  const lus = resultats.filter((entree) => entree.resultat);
  return {
    resultats,
    resume: {
      total: resultats.length,
      lues: lus.length,
      illisibles: resultats.length - lus.length,
      conformes: lus.filter((entree) => entree.resultat.verdict.conforme).length,
      avecAnomalies: lus.filter((entree) => !entree.resultat.verdict.conforme).length
    }
  };
}

// Les Markdown d'un lot, bout a bout, separes par une regle : un seul fichier
// a archiver ou a relire.
function assemblerMarkdown(documents) {
  return documents.join('\n\n---\n\n');
}

module.exports = { convertir, convertirLot, assemblerMarkdown, nomDeSortie };
