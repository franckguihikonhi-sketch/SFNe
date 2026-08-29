#!/usr/bin/env node
'use strict';

// sfne : convertir une facture normalisee en Markdown, depuis un terminal.

const fs = require('node:fs');
const path = require('node:path');
const { convertir } = require('./convertir');

const AIDE = `sfne - lit une facture normalisee electronique (FNE) et en fait un Markdown.

Usage :
  sfne <fichier.pdf|fichier.md> [autres fichiers...] [options]

Options :
  -s, --sortie <chemin>   Fichier (un seul document) ou dossier de destination.
  -j, --json              Ecrit aussi la facture en JSON a cote du Markdown.
      --sans-controles    N'ajoute pas la section des controles au document.
      --sans-provenance   N'ajoute pas la section de provenance.
  -h, --aide              Affiche cette aide.

Sans --sortie, le Markdown est ecrit sur la sortie standard.

Code de sortie : 0 tout est lu et coherent, 2 une facture porte des anomalies,
1 un fichier au moins n'a pas pu etre lu.`;

function lireArguments(arguments_) {
  const options = { fichiers: [], sortie: null, json: false, rendu: {}, aide: false };
  for (let rang = 0; rang < arguments_.length; rang += 1) {
    const argument = arguments_[rang];
    if (argument === '-h' || argument === '--aide' || argument === '--help') options.aide = true;
    else if (argument === '-s' || argument === '--sortie') options.sortie = arguments_[++rang];
    else if (argument === '-j' || argument === '--json') options.json = true;
    else if (argument === '--sans-controles') options.rendu.controles = false;
    else if (argument === '--sans-provenance') options.rendu.provenance = false;
    else if (argument.startsWith('-')) throw new Error(`Option inconnue : ${argument}`);
    else options.fichiers.push(argument);
  }
  return options;
}

function destination(options, nomSortie) {
  if (!options.sortie) return null;
  const versDossier = options.fichiers.length > 1
    || (fs.existsSync(options.sortie) && fs.statSync(options.sortie).isDirectory());
  return versDossier ? path.join(options.sortie, nomSortie) : options.sortie;
}

async function principal(arguments_) {
  const options = lireArguments(arguments_);
  if (options.aide || !options.fichiers.length) {
    process.stdout.write(`${AIDE}\n`);
    return options.aide ? 0 : 1;
  }

  let anomalies = 0;
  let echecs = 0;
  for (const fichier of options.fichiers) {
    // Un fichier illisible n'arrete pas les suivants : sur un lot, il en
    // manquerait un et tout serait a refaire.
    let resultat;
    try {
      resultat = await convertir(fs.readFileSync(fichier), { nom: path.basename(fichier), rendu: options.rendu });
    } catch (erreur) {
      process.stderr.write(`${fichier} : ${erreur.message}\n`);
      echecs += 1;
      continue;
    }
    const cible = destination(options, resultat.nomSortie);
    if (cible) {
      fs.mkdirSync(path.dirname(path.resolve(cible)), { recursive: true });
      fs.writeFileSync(cible, resultat.markdown);
      if (options.json) {
        fs.writeFileSync(cible.replace(/\.md$/, '') + '.json', JSON.stringify(resultat.facture, null, 2) + '\n');
      }
      const compte = resultat.verdict.compte;
      process.stderr.write(`${fichier} -> ${cible} (${compte.ok} controles, ${compte.attention} reserves, ${compte.erreur} erreurs)\n`);
    } else {
      process.stdout.write(resultat.markdown);
    }
    if (!resultat.verdict.conforme) anomalies += 1;
  }
  if (echecs) return 1;
  return anomalies ? 2 : 0;
}

if (require.main === module) {
  principal(process.argv.slice(2))
    .then((code) => { process.exitCode = code; })
    .catch((erreur) => {
      process.stderr.write(`Erreur : ${erreur.message}\n`);
      process.exitCode = 1;
    });
}

module.exports = { principal, lireArguments };
