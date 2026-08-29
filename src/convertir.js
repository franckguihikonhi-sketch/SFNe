'use strict';

// Le chemin complet : un fichier depose, un Markdown en sortie.
//
//   fichier -> texte -> facture lue -> controles -> Markdown
//
// Tout le reste du logiciel (ligne de commande, API, interface) passe par ici.

const path = require('node:path');
const { extraireTexte } = require('./extraction/entree');
const { analyser } = require('./metier/analyse');
const { controler } = require('./metier/controles');
const { versMarkdown } = require('./rendu/markdown');

function nomDeSortie(nomFichier) {
  const base = path.basename(String(nomFichier || 'facture'), path.extname(String(nomFichier || '')));
  return `${base || 'facture'}.md`;
}

async function convertir(donnees, options = {}) {
  const nom = options.nom || null;
  const { texte, format } = await extraireTexte(donnees, nom);
  const facture = analyser(texte, {
    source: nom,
    format,
    extraitLe: options.extraitLe || new Date().toISOString()
  });
  const verdict = controler(facture);
  const markdown = versMarkdown(facture, verdict, options.rendu || {});
  return { facture, verdict, markdown, texte, format, nomSortie: nomDeSortie(nom) };
}

module.exports = { convertir, nomDeSortie };
