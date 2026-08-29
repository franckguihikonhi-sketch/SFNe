'use strict';

// Les quelques outils HTTP dont le service a besoin : lire un corps de
// requete, lire un envoi de formulaire, repondre en JSON. Pas de cadre web :
// il n'y a ici que ce que le service utilise vraiment.

const { TAILLE_MAXI } = require('../extraction/entree');

class RequeteInvalide extends Error {
  constructor(message, statut = 400, code = 'requete_invalide') {
    super(message);
    this.statut = statut;
    this.code = code;
  }
}

function lireCorps(requete, tailleMaxi = TAILLE_MAXI) {
  return new Promise((resoudre, rejeter) => {
    const morceaux = [];
    let taille = 0;
    requete.on('data', (morceau) => {
      taille += morceau.length;
      if (taille > tailleMaxi) {
        rejeter(new RequeteInvalide(`Corps de requete trop volumineux (maximum ${Math.round(tailleMaxi / 1024 / 1024)} Mo).`, 413, 'trop_volumineux'));
        requete.destroy();
        return;
      }
      morceaux.push(morceau);
    });
    requete.on('end', () => resoudre(Buffer.concat(morceaux)));
    requete.on('error', rejeter);
  });
}

function limiteMultipart(typeContenu) {
  const trouve = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(String(typeContenu || ''));
  return trouve ? (trouve[1] || trouve[2]).trim() : null;
}

// Rend [{ nom, nomFichier, contenu }].
function analyserMultipart(corps, typeContenu) {
  const limite = limiteMultipart(typeContenu);
  if (!limite) throw new RequeteInvalide('Envoi multipart sans delimiteur.');
  const separateur = Buffer.from(`--${limite}`, 'latin1');
  const parties = [];
  let position = corps.indexOf(separateur);
  while (position >= 0) {
    const suivant = corps.indexOf(separateur, position + separateur.length);
    if (suivant < 0) break;
    let bloc = corps.subarray(position + separateur.length, suivant);
    if (bloc.subarray(0, 2).toString('latin1') === '--') break;
    if (bloc.subarray(0, 2).toString('latin1') === '\r\n') bloc = bloc.subarray(2);
    if (bloc.subarray(bloc.length - 2).toString('latin1') === '\r\n') bloc = bloc.subarray(0, bloc.length - 2);
    const finEntetes = bloc.indexOf('\r\n\r\n');
    if (finEntetes < 0) {
      position = suivant;
      continue;
    }
    const entetes = bloc.subarray(0, finEntetes).toString('utf8');
    const contenu = bloc.subarray(finEntetes + 4);
    const disposition = /content-disposition:[^\n]*/i.exec(entetes);
    const nom = disposition ? /name="([^"]*)"/i.exec(disposition[0]) : null;
    const nomFichier = disposition ? /filename="([^"]*)"/i.exec(disposition[0]) : null;
    parties.push({
      nom: nom ? nom[1] : null,
      nomFichier: nomFichier ? nomFichier[1] : null,
      contenu
    });
    position = suivant;
  }
  return parties;
}

function repondreJson(reponse, statut, corps, entetes = {}) {
  const donnees = Buffer.from(JSON.stringify(corps, null, 2) + '\n', 'utf8');
  reponse.writeHead(statut, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': donnees.length,
    'cache-control': 'no-store',
    ...entetes
  });
  reponse.end(donnees);
}

function repondreTexte(reponse, statut, texte, type = 'text/plain; charset=utf-8', entetes = {}) {
  const donnees = Buffer.from(texte, 'utf8');
  reponse.writeHead(statut, {
    'content-type': type,
    'content-length': donnees.length,
    ...entetes
  });
  reponse.end(donnees);
}

function repondreErreur(reponse, statut, code, message) {
  repondreJson(reponse, statut, { erreur: { code, message } });
}

// Une fenetre glissante par cle : de quoi arreter une boucle emballee, pas de
// quoi remplacer une passerelle.
function creerLimiteur({ requetes = 60, fenetreMs = 60000 } = {}) {
  const passages = new Map();
  return function autoriser(cle) {
    const maintenant = Date.now();
    const recentes = (passages.get(cle) || []).filter((instant) => maintenant - instant < fenetreMs);
    if (recentes.length >= requetes) {
      passages.set(cle, recentes);
      return { autorise: false, attendreMs: fenetreMs - (maintenant - recentes[0]) };
    }
    recentes.push(maintenant);
    passages.set(cle, recentes);
    return { autorise: true, restantes: requetes - recentes.length };
  };
}

module.exports = {
  lireCorps,
  analyserMultipart,
  limiteMultipart,
  repondreJson,
  repondreTexte,
  repondreErreur,
  creerLimiteur,
  RequeteInvalide
};
