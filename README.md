# SFNe

Service de lecture des **factures normalisees electroniques** (FNE, Direction
generale des impots de Cote d'Ivoire). On depose la facture — le PDF recu du
fournisseur, ou sa version texte — et il en sort un **fichier Markdown** propre :
un entete de donnees en tete, la facture lisible en dessous, et le detail des
controles de coherence.

Les montants sont en francs CFA, entiers : la monnaie n'a pas de subdivision.

## Ce que le service sait faire

| Chemin | Ce qu'on y fait |
| --- | --- |
| **Interface** | Deposer un PDF, voir la facture lue, ses controles, et telecharger le `.md` |
| **API** | Poster une facture ou un lot entier, recuperer les Markdown, relire l'historique |
| **Ligne de commande** | Convertir un ou plusieurs fichiers, en Markdown et en JSON |

Trois choses sont tirees de chaque facture : **ce qu'elle dit** (emetteur,
client, lignes, taxes, totaux), **ce qui la rend opposable** (numero FNE,
facture initiale d'un avoir, NCC, RCCM, regime d'imposition, mode de paiement,
sticker electronique), et **ce qui ne colle pas** (un total qui ne suit pas ses
lignes, une mention obligatoire absente).

## Le sticker electronique

Sur une facture normalisee, l'adresse de verification de la DGI et le jeton du
sticker ne sont ecrits nulle part en clair : **seul le QR les porte**. Le
service lit donc les QR du PDF, en tire le lien et le jeton, les fait figurer
dans l'entete YAML (`sticker`) et dans le document, et signale un PDF qui n'en
porte pas.

```
sticker: 019ff01b-b312-7006-a00d-c122f4a3a4c2
```

Le QR ne survit pas a une conversion du PDF en texte : une facture recue en
Markdown n'a plus de sticker, et le service ne le lui reproche pas.

### Verifier le sticker aupres de la DGI

L'API FNE s'obtient sur demande et agrement prealable, avec des cles par
entreprise : son adresse et la forme de ses reponses ne sont pas publiques.
Rien n'est donc code en dur. Trois variables suffisent a brancher la
verification, sans toucher au code :

```sh
export SFNE_DGI_URL='https://…/factures/{jeton}'   # {jeton} = le sticker
export SFNE_DGI_CLE='…'                            # la cle remise par la DGI
export SFNE_DGI_CHAMPS='{"numero":"invoiceNumber","totalTTC":"amountInclTax","ncc":"sellerTin"}'
```

`SFNE_DGI_CHAMPS` dit ou lire, dans la reponse, le numero de facture, le NCC du
vendeur, le total et le statut — un chemin pointe (`data.invoiceNumber`) est
accepte. Au besoin : `SFNE_DGI_ENTETE` et `SFNE_DGI_SCHEMA` (par defaut
`Authorization: Bearer …`) et `SFNE_DGI_DELAI` (8 s).

Le service confronte alors ce que la DGI repond a ce que la facture porte :

| Ce que la DGI dit | Verdict |
| --- | --- |
| Elle connait le sticker, et ses valeurs concordent | ✅ verifiee |
| Elle connait le sticker, mais son numero, son NCC ou son total different | ❌ discordante |
| Elle donne la facture pour annulee ou rejetee | ❌ discordante |
| Elle ne connait pas ce sticker | ❌ inconnue |
| Elle ne repond pas, ou pas d'une facon exploitable | ⚠️ indisponible |

Trois regles tiennent ce branchement : **la DGI ne fait jamais echouer une
conversion** (son indisponibilite est une reserve, pas un refus) ; **un sticker
n'est demande qu'une fois**, meme sur un lot de doublons ; et **sans
configuration, le verificateur se tait** — il ne rend jamais un verdict qu'il
n'a pas obtenu.

**Ce sur quoi il ne faut pas brancher :** la page publique de verification. Elle
rend son verdict cote navigateur, apres coup : un jeton invente y renvoie
exactement la meme reponse qu'un jeton valide, a l'octet pres. Un controle bati
dessus repondrait toujours « conforme », y compris sur une facture fabriquee —
plus dangereux que pas de verification, puisque c'est precisement la fraude
qu'il est cense attraper.

## Demarrer

```sh
npm install
npm start
```

Le service ecoute sur `http://localhost:3000`. Au premier lancement, une
organisation est creee et **sa cle d'API s'affiche une seule fois** : notez-la,
seule son empreinte est conservee. Pour en creer d'autres :

```sh
npm run cle -- "Demo Negoce" pro     # nouvelle organisation + cle
npm run cle -- --organisation org_x "cle de production"
npm run cle -- --lister
```

## Convertir sans serveur

```sh
node src/cli.js facture.pdf                        # le Markdown sur la sortie standard
node src/cli.js facture.pdf --sortie facture.md    # dans un fichier
node src/cli.js *.pdf --sortie ./converties --json # en lot, avec le JSON a cote
```

Un fichier illisible n'arrete pas les suivants. Le code de sortie vaut `0` si
tout est lu et coherent, `2` si une facture porte des anomalies, `1` si un
fichier au moins n'a pas pu etre lu : de quoi enchainer dans un script de
comptabilite.

## L'API

Toutes les routes `/api/v1` demandent l'entete `Authorization: Bearer <cle>`.

| Verbe | Route | Effet |
| --- | --- | --- |
| `POST` | `/api/v1/conversions` | Depose une facture, rend la facture lue, ses controles et son Markdown |
| `POST` | `/api/v1/lots` | Depose un lot de factures en un envoi |
| `GET` | `/api/v1/lots/:id` | Les conversions d'un lot |
| `GET` | `/api/v1/lots/:id/markdown` | Les Markdown d'un lot, bout a bout |
| `GET` | `/api/v1/conversions` | L'historique de l'organisation |
| `GET` | `/api/v1/conversions/:id` | Le detail d'une conversion |
| `GET` | `/api/v1/conversions/:id/markdown` | Le fichier Markdown seul |
| `DELETE` | `/api/v1/conversions/:id` | Efface une conversion |
| `GET` | `/api/v1/moi` | L'organisation, son plan, son quota du mois |
| `GET` | `/sante` | Etat du service, sans cle |

```sh
# Depot d'un PDF, reponse complete en JSON
curl -H "Authorization: Bearer $SFNE_CLE" \
     -F fichier=@facture.pdf \
     http://localhost:3000/api/v1/conversions

# Le Markdown directement, pour un pipeline
curl -H "Authorization: Bearer $SFNE_CLE" \
     -F fichier=@facture.pdf \
     "http://localhost:3000/api/v1/conversions?format=markdown" -o facture.md
```

### En masse

Un cabinet ne depose pas ses factures une par une. `POST /api/v1/lots` prend
jusqu'a **200 fichiers par envoi** (60 Mo au total), en Markdown comme en PDF :

```sh
curl -H "Authorization: Bearer $SFNE_CLE" \
     -F fichier=@aout-001.md -F fichier=@aout-002.md -F fichier=@aout-003.md \
     http://localhost:3000/api/v1/lots

# Tous les Markdown du lot en un seul fichier
curl -H "Authorization: Bearer $SFNE_CLE" \
     "http://localhost:3000/api/v1/lots/$LOT/markdown" -o aout.md
```

La reponse porte le compte du lot (`total`, `lues`, `illisibles`, `conformes`,
`avecAnomalies`) et **une entree par fichier**, avec sa conversion ou sa raison
d'echec. Une facture illisible n'arrete pas les autres : sur un lot de fin de
mois, il en manquerait une et tout serait a refaire. Ce qui depasse le quota du
mois est refuse fichier par fichier, le reste passe.

Dans l'interface, la zone de depot accepte plusieurs fichiers d'un coup et
rend un tableau : une ligne par facture, son numero, son client, son net a
payer, son etat, et le lot entier a telecharger.

Options du rendu : `?controles=non` et `?provenance=non` retirent ces sections.
Un envoi sans formulaire marche aussi : le corps brut, avec l'entete
`X-Nom-Fichier`.

Les erreurs sont explicites : `401 non_authentifie`, `400 entree_invalide`
(fichier illisible, PDF scanne sans couche de texte), `402 quota_depasse`,
`429 trop_de_requetes`.

## Le Markdown produit

```markdown
---
type: facture-avoir
numero: A1234567U2600000038
facture_initiale: 1234567U26000000524
emise_le: "2026-08-10T10:01:12"
client_ncc: 1234567X
total_ht: 21546
total_tva: 3878
net_a_payer: 25424
sens_comptable: -1
conforme: true
---

# Facture d'avoir Nº A1234567U2600000038

Emise le **10/08/2026 a 10:01:12** par **SOCIETE DEMO NEGOCE** pour
**SUPERMARCHES DEMO CI**.

> **Facture d'avoir.** Les montants ci-dessous se **deduisent** de la facture
> initiale Nº **1234567U26000000524**.
```

Puis, dans l'ordre : l'emetteur, le client, l'identite de la facture, le detail
ligne a ligne, les totaux, le recapitulatif des taxes, les controles, les
mentions du document et la provenance. Le fichier complet est dans
[`exemples/facture-avoir.attendu.md`](exemples/facture-avoir.attendu.md), lu
depuis [`exemples/facture-avoir.md`](exemples/facture-avoir.md). **Cet exemple
est fictif** : la mise en page et les montants sont ceux d'une vraie facture
d'avoir, les identites sont inventees.

L'entete YAML est la pour les programmes : un import comptable lit `total_ht`,
`net_a_payer` et `sens_comptable` sans avoir a comprendre le corps du document.
**`sens_comptable` vaut `-1` pour un avoir** : ses montants se retranchent.

## Les controles

Chaque conversion repasse le calcul de la facture :

- le montant de chaque ligne suit son prix unitaire, sa quantite et sa remise ;
- le total HT fait la somme des lignes, remise globale deduite ;
- la TVA se retrouve taux par taux, et colle au recapitulatif de la facture ;
- le TTC fait le HT augmente des taxes, le total a payer fait le TTC moins les
  avances ;
- les mentions obligatoires sont la : numero, date, identites, NCC, RCCM,
  regime d'imposition, mode de paiement, designation et taux de chaque ligne, et
  pour un avoir, la facture initiale.

Un prix unitaire affiche arrondi au franc n'est pas compte comme une erreur :
le service reconstitue le prix reel et le note. Les lignes du document qu'aucun
champ ne reconnait ne sont jamais jetees : elles sont reportees telles quelles
dans la section de provenance.

**Le document fait foi.** Rien n'est corrige en silence : ce qui ne colle pas
est signale, et la valeur lue reste celle de la facture.

## Comment c'est bati

```
src/
  metier/       lecture pure, sans reseau ni disque : texte, etiquettes,
                analyse de la facture, controles de coherence
  extraction/   PDF vers texte (pdf.js), reconnaissance du fichier depose
  rendu/        facture vers Markdown
  donnees/      depot : organisations, cles d'API, conversions
  verification/ confrontation du sticker au registre de la DGI
  serveur/      service HTTP, sans cadre web
  web/          l'interface, une page
outils/         creation des organisations et des cles
scripts/        verification du service de bout en bout
tests/          node:test, sans dependance
```

Trois regles tiennent l'ensemble :

**La lecture est separee de tout le reste.** `src/metier/` ne connait ni HTTP ni
fichier. C'est ce qui rend l'analyse verifiable : on lui donne du texte, elle
rend une facture et un verdict, les tests le prouvent champ par champ.

**Une facture appartient a son organisation.** Le depot filtre sur
l'organisation a chaque lecture ; une cle qui n'est pas la bonne ne donne pas
`403`, elle donne `404`. Les cles ne sont pas conservees en clair, seulement
leur empreinte SHA-256.

**Un PDF n'est pas un formulaire.** Les editeurs de facturation ecrivent tous
`N° Tel` ou `Nº Telephone`, `Designation` ou `Libelle`. Les etiquettes vivent
donc dans un dictionnaire (`src/metier/dictionnaires.js`), avec leurs variantes,
plutot que dans le code qui les cherche.

## Verifier

```sh
npm test       # 86 tests : texte, analyse, controles, rendu, PDF, depot, API, lots, CLI
npm run verifier # demarre le service, depose une facture puis un lot, relit les Markdown
```

Les deux tournent a chaque poussee et sur chaque demande de fusion
(`.github/workflows/verification.yml`).

## Ce que le service ne fait pas

- **Aucun texte hors facture.** Un fichier sans numero, sans ligne et sans
  total est refuse : ce n'est pas une facture, et il n'a rien a faire dans
  l'historique.
- **Un PDF scanne** (une image, sans couche de texte) est refuse avec une raison
  claire. Il faudrait une reconnaissance optique, qui n'est pas ici.
- **Aucun appel a la DGI tant qu'elle n'est pas configuree.** Le service lit
  toujours le sticker ; il ne le confronte au registre de l'administration que
  si `SFNE_DGI_URL` est renseignee.
- **Pas de comptabilite.** Il produit un fichier, pas une ecriture.
