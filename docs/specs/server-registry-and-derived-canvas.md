# Registre serveur et canvas dérivé

**Status :** draft — révisé le 2026-09-25. Tranches 1 à 3 implémentées sur la branche
`feat/server-canvas` (non commitée), plus l'arrangement automatique appliqué aux planches de
project (cf. « État d'avancement »). Rien sur `main`.

## Historique

- **2026-09-22** — spec initiale.
- **2026-09-23 → 24** — plan confié à Codex. Il a élargi le périmètre à un socle « serveur logique
  + autorité backend », puis tout implémenté en un seul lot (P0A → P10, 341 fichiers, routes
  existantes remplacées). Résultat jugé médiocre : **abandonné**. Le travail est conservé pour
  référence sur la branche `codex/server-registry-derived-canvas` (commit `011fd3fa`).
  ⚠️ Ce commit embarque aussi du WIP sans rapport (billing, auth, docs-site, CI…).
- **Leçon retenue** : pas de big-bang. La cible reste la même, mais on la construit **à côté**
  de l'existant et on ne bascule qu'une fois validé (cf. Stratégie de livraison).

## En bref

**La cible** : une planche unique par serveur, arrangée automatiquement ; un registre serveur qui
groupe tous les Documents par project, avec son onglet plein écran ; recherche, traductions,
données et ressources globales au serveur. La vue par project ne disparaît pas : elle survit comme
**filtre**.

> **La portée de la vue est le serveur. La portée du stockage reste le project.**

`Project` n'est supprimé nulle part : il reste le dossier, l'unité de hash, de publication, d'i18n
et de transport. Il cesse seulement d'être un **lieu où l'on entre**.

**La livraison** : on construit la cible sur une **URL séparée**, sans modifier les vues actuelles.
Première tranche visible = la planche générale **en lecture seule**. La bascule (nouvelle vue par
défaut, anciennes vues retirées) est la toute dernière tranche.

## Hors périmètre : serveur logique et autorité backend

Piste **séparée, reportée à plus tard**. Elle recouvre :

- un **serveur logique** qui existe sans serveur Minecraft, qui porte les projects et qui unifie les
  cas personnel / partagé / démo ;
- l'**autorité backend** sur les contenus, brouillons et révisions, Minecraft n'exécutant qu'une
  copie déployée ;
- le **déploiement explicite** et l'import explicite des modifications locales.

**Pourquoi la séparer** : c'est le morceau le plus gros et le plus risqué, et il renverse
`server-disk-only-storage`. Surtout, la planche générale n'en a pas besoin : elle ne fait que
*lire* les projects d'un serveur, ce que les endpoints actuels savent déjà faire.

Référence pour plus tard : `docs/superpowers/plans/2026-09-23-backend-authority-and-logical-servers.md`
(rédigé pendant la tentative Codex, **non validé**). Le moment venu, il faudra le reprendre sous
forme de spec propre.

**Conséquence pour cette spec** : le stockage reste celui d'aujourd'hui. Les projects serveur vivent
sur le disque Minecraft, les projects hébergés et de démo dans le backend. Tout ce qui supposerait
une autorité unique est soit conçu contre ce stockage-là, soit reporté.

## Vocabulaire

⚠️ **Aucun de ces termes n'est dans `CONTEXT.md`.** Ils viennent d'une session de design du
2026-09-05, qui n'a laissé qu'une note de mémoire et aucun ADR dans le dépôt. Dette à lever au
passage en ADR.

| Terme | Ce que c'est |
|---|---|
| **Registre** | Le panneau qui liste les Documents. Aujourd'hui c'est le rail de droite, avec ses sections `MENUS` et `COMMANDES`, scopé au project. Dans la cible, il devient **serveur-scopé et groupé par project**. |
| **Focus** | La vue d'un seul Document (`…/document/$documentId`). C'est sa **maison obligatoire** : la vue complète, où tout est éditable. |
| **Planche** (canvas) | La vue graphe, avec les inventaires rendus et les flèches de navigation. Dans la cible, elle devient **dérivée** et serveur-scopée. |
| **Gouttière** | La zone de la planche où atterrissent les Documents qui n'ont aucune arête. C'est une zone de première classe, pas un bac à rebut. |

## Le problème

Aujourd'hui, ouvrir un project place la planche au centre de l'écran. Elle est **créée vide avec le
project**, et l'utilisateur est libre d'y poser ou non ses Documents. Deux conséquences :

- Une planche vide qui attend, c'est une pièce à meubler : elle raconte que le project est inachevé
  tant qu'on n'a rien posé dessus. La pression à utiliser la planche vient de sa structure, pas d'un
  choix de l'utilisateur.
- La curation manuelle est **toujours incomplète**. La preuve est déjà dans le code :
  `offBoardLinks.ts` et `GhostChips.tsx` existent uniquement pour afficher « ceci pointe vers un
  Document que tu n'as pas posé ».

Et le constat qui tranche : personne ne va délibérément construire une planche à la main pour
visualiser des menus qu'il connaît déjà par cœur.

## Décisions

### 1. `Project` reste l'unité, mais cesse d'être un lieu

`Project` reste le dossier, l'unité de hash et de publication, le namespace i18n, le périmètre des
assets, templates, models et items capturés, et l'unité de transport (`projectCopies.ts`,
`networkTransfers.ts`, export zip). Rien de tout ça ne bouge. Il devient un badge de provenance et un
axe de groupement du registre.

**Pourquoi le garder** : un Add-on bootstrappe son propre project (par exemple `boutique_shop`), cf.
le commentaire de `diskId` dans `editor/src/domain/types.ts`. Sans project, l'Add-on déverserait ses
fichiers dans le pot commun de l'utilisateur.

### 2. Le registre est serveur-scopé, le focus est la maison

Le registre liste tous les Documents du serveur, groupés et filtrables par project. Le focus reste
la maison obligatoire de chaque Document. Dans la cible, le landing n'est plus la planche.

### 3. La planche est une vue dérivée, pas une composition

Le graphe est **déjà** dérivé : `deriveEdges(project)`
(`editor/src/features/canvas/deriveEdges.ts`) parcourt le project entier. Aujourd'hui, seules
l'appartenance et la position sont manuelles. On supprime l'appartenance : la planche montre
**tout ce qui existe** et l'arrange automatiquement. Elle ne peut donc plus être vide, ni mentir.

`canvasLayout` cesse d'être la liste des membres et devient une **carte creuse de positions
fixées** : seuls les nœuds que l'utilisateur a délibérément placés y figurent.

`offBoardLinks` et `GhostChips` retrouvent un vrai rôle : ils ne se déclenchent plus que lorsqu'un
**filtre** masque une cible, donc après un choix délibéré.

**Édition directe conservée sur la planche** (confirmé le 2026-09-23). Le focus reste la vue
complète. La v0 en lecture seule n'est qu'une étape de livraison, pas la cible.

### 4. Une planche par serveur, filtrable

Pas une planche par project, et pas de boards à construire à la main.

- **Pas une par project** : ça casse le graphe exactement là où il devient intéressant. Un menu du
  core qui ouvre un menu de la Boutique serait une pastille fantôme d'un côté, un orphelin de l'autre.
- **Pas de boards à créer** : personne ne le fera.
- **« Une par project » survit sous forme de filtre**, dérivé, sans rien stocker.

Axes de filtre : project, type, texte. Leur état vit dans l'URL, pour qu'une vue filtrée se
partage. Les vues sauvegardées (des filtres nommés) sont une v2 bon marché, hors de ce chantier.

### 5. Arrangement automatique de la planche

Un layout force-directed (d3-force, ressorts) disperse les nœuds dans tous les sens. Il les fait se
chevaucher, parce qu'il raisonne sur des points alors qu'un inventaire rendu fait jusqu'à
352×444 px. Et il change à chaque ouverture. On utilise donc un layout **par couches**
(Sugiyama) : il est déterministe, il tient compte de la taille réelle de chaque nœud, et il lit
naturellement dans le sens de la navigation (commande → menu → sous-menu).

#### Ce qui existe déjà et qu'on réutilise

- **Tailles des nœuds** : `editor/src/features/canvas/menuLayout.ts`. Un menu fait `TEX_W` =
  **352 px** de large, et `34 + rangées × 36 + 194` px de haut, soit 336 px pour un coffre de 3
  rangées et 444 px pour 6 rangées. Les types à hauteur fixe (entonnoir, distributeur) passent par
  `INVENTORY_TYPES[type].boxHeight`. `COMMAND_BOX` mesure 140×48, `DIALOG_BOX` 140×60. `nodeBox`
  y est déjà partagé par `Edges.tsx` et `GhostChips.tsx`. **L'arrangement doit lire ces mêmes
  fonctions.** Une seconde source de tailles garantirait des chevauchements dès qu'elle
  divergerait du rendu.
- **Format de sortie** : `Record<id, { x, y }>`, avec `x, y` = **coin haut-gauche** du nœud. C'est
  ce que `Stage` consomme aujourd'hui via `autoLayout(project)`, et ce que lit `nodeBox`. dagre
  renvoie des **centres** : il faut donc convertir (`x = cx − w/2`, `y = cy − h/2`), sinon tout
  est décalé d'une demi-boîte.
- **Tracé des flèches** : `routeEdges` (`edgeRouting.ts`) trace une courbe de Bézier d'une boîte à
  l'autre. Il gère aussi les ancres forcées par l'utilisateur (`canvasEdges`) et l'espacement des
  ancres sur un même côté. **On le garde tel quel** et on n'utilise pas les points de passage
  calculés par dagre. Limite assumée : une flèche longue peut traverser un inventaire. L'ordre
  anti-croisements limite ce cas. On pourra plus tard faire passer les courbes par les points de
  dagre.
- **Ce qui disparaît** : `autoLayout` (qui ne fait aujourd'hui que renvoyer `canvasLayout`) et
  `gridArrange` (le bouton « Tout arranger », une grille de 4 colonnes).

#### Ce que dagre fait, et ce qu'il ne fait pas

`@dagrejs/dagre` calcule les **couches** (network-simplex par défaut), l'**ordre** dans chaque
couche pour limiter les croisements, et les **coordonnées** en respectant les tailles réelles.

Il ne sait **pas** :

- tenir compte de **positions fixées** : il n'accepte aucune coordonnée imposée ;
- ~~partir d'un ordre imposé~~ — **faux** : dagre 3 accepte des contraintes d'ordre dans une
  couche (`layout(g, { constraints: [{ left, right }] })`, vérifié le 2026-09-25). Reprendre
  l'ordre de l'arrangement précédent est donc possible, si la stabilité l'exige ;
- casser les cycles comme on le souhaite : il le fait, mais de façon arbitraire ;
- ranger proprement des composantes déconnectées.

Tout ça est à notre charge, dans le pipeline ci-dessous.

#### Le pipeline

Une fonction pure, testable sans rendu :

```ts
arrangeBoard(input: {
  nodes: { id: string; kind: "menu" | "command" | "dialog"; width: number; height: number }[];
  edges: { source: string; target: string }[];
  pinned: Record<string, { x: number; y: number }>;
}): Record<string, { x: number; y: number }>
```

**Étape 1 — Nœuds.** Les Documents du périmètre, triés par id qualifié, avec leurs tailles tirées
de `menuLayout.ts`. Les arêtes vers un Document inexistant sont exclues : elles restent des
pastilles accrochées à leur source.

**Étape 2 — Partition.** On calcule les composantes connexes sans tenir compte du sens des arêtes.
Les nœuds sans aucune arête partent en gouttière (étape 6). Chaque autre composante passe
**séparément** dans dagre.

**Étape 3 — Arêtes retour.** On fait un DFS depuis les racines de la composante, c'est-à-dire les
nœuds que rien ne cible, triés par id. Une commande n'est jamais ciblée, donc c'est toujours une
racine. Dans une composante sans racine (un cycle pur), on part du plus petit id. Une arête dont
la cible est déjà sur la pile du DFS est une arête retour : **on ne la donne pas à dagre**.
`routeEdges` la dessine quand même. Ainsi, un bouton « retour au menu principal » ne repousse
jamais le menu principal d'une couche.

**Étape 4 — dagre, composante par composante.**

```ts
const g = new dagre.graphlib.Graph();
g.setGraph({ rankdir: "LR", ranker: "network-simplex", ranksep: 160, nodesep: 48 });
g.setDefaultEdgeLabel(() => ({}));
for (const n of sortedNodes) g.setNode(n.id, { width: n.width, height: n.height });
for (const e of dagEdges) g.setEdge(e.source, e.target);
dagre.layout(g);
// dagre donne des centres → coin haut-gauche
const pos = (id) => { const n = g.node(id); return { x: n.x - n.width / 2, y: n.y - n.height / 2 }; };
```

Couches en colonnes de gauche à droite : les commandes forment la première colonne, et chaque
niveau de navigation en ajoute une. `ranksep: 160` laisse aux courbes la place de passer entre
deux colonnes de 352 px de large. Les deux valeurs seront réglées sur de vraies données à la
tranche 3.

**Étape 5 — Une composante par ligne** (décidé le 2026-09-25). Composantes triées par nombre de
nœuds décroissant, puis par plus petit id, et empilées verticalement à partir de (40, 40) avec
120 px d'écart. Chaque ligne est un parcours qui se lit de gauche à droite depuis son point
d'entrée (`/menu`, `/dailyq`…). Remplace un rangement en étagères sur 2 400 px, qui posait
des parcours sans rapport côte à côte.

**Étape 6 — Gouttière.** 160 px sous tout le reste, sans intitulé. Les
Documents y sont posés en rangées, triés par type (menus, dialogs, commandes) puis par id, avec
un retour à la ligne à 2 400 px.

**Étape 7 — Positions fixées.** Un nœud fixé **reste dans le calcul de dagre** : ses arêtes
continuent de structurer les couches de ses voisins. Il est ensuite posé à sa coordonnée fixée,
et **fixer un nœud là où il était déjà ne déplace rien** (testé). Dernière passe : dans l'ordre
de leur position (haut vers bas), les nœuds automatiques qui chevauchent un nœud fixé ou un nœud
déjà traité descendent jusqu'à trouver de la place. Implémenté sans rebouchage : la place que
dagre donnait au nœud fixé reste vide. Un nœud fixé ne bouge jamais. Deux
nœuds fixés peuvent se chevaucher (décision confirmée, cf. décision 6).

#### Stabilité : la planche ne bouge pas toute seule

**Le problème.** dagre optimise *globalement*. Ajouter un seul nœud puis relancer le calcul peut
réordonner des colonnes entières. Si on insère localement pendant la session (décision 9) mais
qu'on recalcule tout au rechargement, la planche **saute à chaque actualisation**. C'est
exactement la perte de repères qu'on cherche à éviter.

**La règle.** Le calcul complet ne tourne que dans deux cas : **quand aucun arrangement précédent
n'existe**, ou quand l'utilisateur clique sur **« Réarranger »**. Le reste du temps, la planche
affiche l'arrangement précédent, corrigé localement :

| Changement | Effet sur la planche |
|---|---|
| Nouveau Document relié | Insertion locale à côté de sa source (décision 9) |
| Nouveau Document non relié | Ajouté à la fin de la gouttière |
| Document qui gagne sa première arête | Il quitte la gouttière pour une insertion locale |
| Document supprimé | Il laisse un trou, rebouché seulement par « Réarranger » |
| Nouvelle arête entre deux Documents déjà placés | Rien ne bouge, la flèche est simplement tracée |
| Changement de taille (nombre de rangées) | Les nœuds situés en dessous, dans la même colonne, sont poussés si besoin |

**Où vit l'arrangement précédent.** Dans un **cache par utilisateur** (`localStorage`, indexé par
serveur), et jamais dans les fichiers du project. Ce cache est jetable : s'il est perdu, un calcul
complet refait une planche correcte. Il ne décide pas de *ce qui existe*, seulement de *l'endroit
où c'est affiché*. Il ne peut donc pas mentir comme le faisait la liste des membres.

Contrepartie : deux collaborateurs peuvent voir des arrangements différents, jusqu'à ce que l'un
d'eux clique sur « Réarranger ». Pour un arrangement qui doit être partagé, l'outil est la
position fixée, qui vit dans les fichiers. *À valider, cf. Questions ouvertes.*

#### Garanties, et comment les tester

| Garantie | Test |
|---|---|
| Déterminisme sans cache : même entrée → mêmes coordonnées | calculer deux fois, en mélangeant l'ordre d'entrée |
| Aucun chevauchement entre nœuds automatiques, ni avec un nœud fixé | intersection de rectangles deux à deux, sur des fixtures jusqu'à 500 nœuds |
| Une arête retour ne modifie pas l'arrangement | ajouter une arête « retour » laisse les positions identiques |
| Les orphelins sont en gouttière, sous tout le reste | fixture avec des nœuds isolés |
| Un nœud fixé n'est jamais déplacé | fixture avec des nœuds fixés au milieu d'une colonne |
| Les coordonnées sont des coins haut-gauche | `nodeBox(pos)` recouvre bien le rectangle attendu |

**Coût** : la tentative Codex a mesuré 9 ms pour 50 Documents, 11 ms pour 200 et 22 ms pour 500,
à froid. Ici, le calcul complet ne tourne qu'à la première ouverture ou sur « Réarranger ».

**Bibliothèque** : `@dagrejs/dagre` (~100 Ko). `elkjs` (~1,5 Mo, avec web worker) ne sert de
porte de sortie que si la qualité ne suffit pas. Il accepte, lui, un ordre imposé et le routage
des flèches.

### 6. On ne persiste que les positions fixées

Les fichiers du project ne reçoivent **que les positions fixées**. Les positions calculées ne sont
jamais écrites dans les fichiers : au mieux, elles vivent dans le cache jetable de l'utilisateur,
qui sert à la stabilité de l'affichage (cf. décision 5, « Stabilité »).

- **Emplacement** : dans le `.artisan/editor.yaml` du project **propriétaire du Document**, indexé
  par Document. Désinstaller un Add-on emporte donc aussi ses positions.
- **Reprise de l'existant** (confirmé) : les anciennes positions de `canvasLayout` sont conservées
  **à l'identique** et deviennent des positions fixées, que l'utilisateur peut libérer. Deux
  anciennes planches peuvent apporter des positions qui se chevauchent : on ne les déplace pas en
  silence, on propose de les libérer. L'absence de chevauchement est garantie pour les nœuds
  automatiques, pas entre deux positions imposées par l'utilisateur.

### 7. Brouillon et déploiement : regroupés à l'écran, séparés par project à l'enregistrement

L'indicateur de brouillon et le bouton « Déployer » deviennent **serveur-scopés à l'écran**. Le
diff est découpé par project, et on peut ne déployer qu'un seul project. Côté stockage, chaque
project garde son brouillon et son compare-and-swap. L'indicateur du serveur est une **somme**, pas
une transaction : un conflit dans un project ne bloque pas les autres.

### 8. Création : deux points d'entrée équivalents, aucun ordre imposé

« Créer à cet endroit » **perd son sens** dès que le layout est dérivé. Et « créer depuis une
arête » ne peut pas le remplacer : une arête est la *conséquence* d'un bouton qui pointe déjà
quelque part, et un menu a N boutons qui pourraient tous ouvrir le futur menu. On a donc deux
points d'entrée, sans hiérarchie :

- **Le registre** : on crée un menu, une commande ou un dialog sans le relier à rien. Chaque groupe
  de project a son « + », donc le propriétaire est toujours explicite.
- **Le sélecteur de cible d'une action** : « + Créer un nouveau menu » dans le choix de cible d'un
  `open_menu` ou d'un `open_dialog`. `ActionEditor.tsx` connaît déjà `projectId`, `menuId`,
  `elementId` et `clickType`, donc le propriétaire et le lien sont établis dans le même geste.

À cela s'ajoute la **réparation** : quand un `open_menu` vise un id inexistant, la pastille fantôme
propose de créer la cible.

**Pourquoi aucun ordre n'est imposé** : les données autorisent déjà les deux demi-états (une
référence qui pointe vers rien, un menu que rien n'ouvre). Une UI qui imposerait un sens de
construction contredirait sa propre couche de données. Conséquence : quelqu'un qui commence par
créer ses menus aura, pendant un moment, *tous* ses menus en gouttière. C'est un état normal.

**Le rattachement n'est pas un champ.** Le project d'un Document **est** son emplacement sur disque
(`projects/<diskId>/menus/<id>.yaml`). Changer un Document de project revient donc à déplacer des
fichiers, avec toutes leurs dépendances. C'est hors périmètre, comme l'export sélectif.

**Ids** (confirmé le 2026-09-23) :

- les ids de Documents sont **uniques dans le serveur** ;
- les nouveaux Documents reçoivent un **préfixe automatique** `menu_`, `cmd_` ou `dialog_`. Le
  dialogue affiche le préfixe fixe et on saisit le suffixe. Le préfixe porte sur l'id du fichier,
  pas sur le libellé ni sur le texte de la commande : `commands/cmd_boutique.yaml` peut déclarer
  `/boutique` ;
- les ids existants sont conservés, et une collision est signalée sans renommage implicite ;
- les boutons restent identifiés dans leur menu, avec un préfixe `btn_` facultatif.

**Après la création** : ouverture du **focus** sur le nouveau Document (confirmé).

### 9. En direct : insertion locale, jamais de recalcul complet

Une édition déclenche une correction locale de l'arrangement (cf. le tableau « Stabilité » de la
décision 5), animée sur ~250 ms. Pour un nouveau Document relié, on calcule `rang(source) + 1` et on
le pose dans le premier espace libre de cette colonne, ou à la fin de celle-ci. Seuls les nœuds
situés en dessous sont poussés. La vue se déplace
doucement en gardant la source visible, sans recentrage ni zoom. Un bouton **« Réarranger »**
**libère toutes les positions fixées** et relance le calcul complet (décision d'Iban le
2026-09-25 : réarranger doit vraiment tout réarranger ; Ctrl+Z restaure les positions).

### 10. Onglet Registre plein écran, un seul hôte

Le rail de ~250 px ne peut pas porter le groupement, les filtres, l'état et les actions groupées.
Il faut donc un **onglet « Registre »**, qui deviendra le landing après la bascule. Mais surtout pas
deux implémentations : le dépôt s'est fait avoir deux fois, avec le premier mode focus annulé, puis
`SoloMenuStage` le 2026-09-05. La règle qui en est sortie est **« un rendu par type de Document, et
autant d'hôtes que de sémantiques distinctes, pas un de plus »**. Le rail et l'onglet font la même
chose, donc c'est **un seul hôte** avec une prop de densité. Le rail sera replié par défaut, et
Cmd+K couvre la navigation rapide. La liste « MES PROJECTS » de la sidebar gauche devient alors un
filtre du registre ; la création, le renommage, l'import/export et la suppression de projects
restent disponibles dans le registre.

### 11. Tous les onglets passent au niveau du serveur, le stockage reste par project

| Onglet | Vue serveur | Stockage (inchangé) |
|---|---|---|
| Recherche (Cmd+K) | index sur tous les projects | `searchIndex.ts` : `Project` → `Project[]` |
| Traductions | toutes les clés, groupées par project | `lang/<lang>.yaml` par project |
| Données | Project sources + sources des modules | `data/<id>.yaml` par project |
| Ressources | tous les assets, groupés par project | sous le project propriétaire |
| Assistant IA | reste sur un **project cible explicite** ; l'écriture dans plusieurs projects fera l'objet d'une autre spec | — |

Chaque ligne affiche **sa provenance**, et chaque écriture est rattachée à un project propriétaire.

### 12. Un project par défaut

Un nouveau serveur reçoit un project `default` **une seule fois**. Tous les projects sont
supprimables, même le dernier, et `default` n'est jamais recréé. Un serveur vide propose « Créer
un projet » (confirmé le 2026-09-23). Tant qu'il n'y a qu'un project, le registre n'affiche aucun
en-tête de groupe.

Où a lieu ce bootstrap ? Plugin, backend, ou selon le type de project ? La réponse dépend de la
piste stockage : **reporté** avec elle.

## État d'avancement (2026-09-25, branche `feat/server-canvas`, non commitée)

- **Tranche 1** — `features/canvas/serverGraph.ts` : graphe de tout le serveur, cibles résolues
  sur tout le serveur comme la table unique du plugin (`menus[menuId]`), id introuvable ou porté
  par deux projects signalé comme lien non résolu.
- **Tranche 2** — `features/canvas/arrangeBoard.ts` : étapes 1 à 7 (positions fixées comprises).
- **Tranche 3** — planche générale en lecture seule, `…/servers/$serverId/canvas`
  (`features/serverCanvas/`), filtres dans l'URL, lien sur la page du serveur. Pas de pastilles
  fantômes : les liens non résolus sont comptés dans la barre d'état.
- **Hors plan « à côté »**, à la demande d'Iban : l'arrangement automatique remplace la curation
  sur **les planches de project** existantes (`projectBoard` dans `autoLayout.ts`), avec le bouton
  « Réarranger ». Les anciennes positions sont conservées comme positions fixées.
- Pas encore fait : insertion locale et cache de stabilité (la planche recalcule à chaque
  changement de graphe), rebouchage des trous laissés par les positions fixées, libération d'une
  seule position.

## Stratégie de livraison

**Principe : à côté, pas à la place.** Chaque tranche est livrée séparément, et les vues
existantes ne changent pas jusqu'à la bascule finale. Les tranches 1 et 2 sont pures : elles ne
touchent à aucune UI.

1. **Graphe multi-projects.** Identité qualifiée des Documents, et `deriveEdges` sur `Project[]` en
   gardant la signature actuelle. Tests : dédoublonnage des arêtes, cibles inexistantes non
   converties en nœuds, pas de collision entre projects.
2. **Module d'arrangement.** `arrangeBoard`, une fonction pure qui porte les étapes 1 à 7 de la
   décision 5, avec les tailles tirées de `menuLayout.ts`. Tests : le tableau « Garanties » de la
   décision 5. Les corrections locales de la section « Stabilité » viennent à la tranche 5.
3. **Planche générale en lecture seule, sur une nouvelle URL** (par exemple
   `…/servers/$serverId/canvas`). Elle charge tous les projects du serveur via les endpoints
   existants. Elle réutilise `Stage` avec une prop de lecture seule : pas de second hôte. Un clic
   sur un nœud ouvre le focus existant dans son project. Filtres par project, type et texte.
   Point dur : `Stage`, `nodeBox` et `Edges` sont **mono-project** aujourd'hui (ils cherchent un id
   dans un seul `project`). Ils doivent accepter un ensemble de projects et des ids qualifiés, sans
   changer de comportement pour les vues existantes.
   **Aucune vue existante n'est modifiée. C'est le premier livrable visible, à valider sur de vraies
   données.**
4. **Positions fixées.** Déplacer un nœud écrit dans le `.artisan/editor.yaml` du project
   propriétaire. Reprise des anciennes positions. C'est la première écriture de la nouvelle vue.
5. **Édition sur la planche générale.** Édition directe, création par le registre et par
   `ActionEditor`, insertion locale, bouton « Réarranger ».
6. **Registre serveur et onglet Registre** : un seul hôte, avec une prop de densité, monté sur la
   nouvelle vue.
7. **Onglets globaux** avec provenance, puis **brouillon et déploiement regroupés**.
8. **Bascule.** La nouvelle vue devient le landing et les anciennes vues par project sont retirées.
   Seulement après une validation **en jeu**.

## Ce qui ne change pas

- `lang/` et les assets restent **par project** : les adresses i18n sont dérivées par project et
  verrouillées par `I18nAddresses.kt` et `testdata/i18n-address-conformance.json`.
- L'export et l'import restent de project à project.
- Le stockage actuel (cf. Hors périmètre).

## Questions ouvertes

- **Cache d'arrangement par utilisateur** (décision 5, « Stabilité »). La planche ne bouge pas
  toute seule, mais deux collaborateurs peuvent voir des arrangements différents tant que personne
  n'a cliqué sur « Réarranger ». Alternative : recalculer à chaque chargement, au prix d'une
  planche qui peut sauter à chaque actualisation.
- **Création dans le project d'un Add-on.** Proposition issue de la tentative Codex : masquer le
  « + » tant qu'aucune garantie de conservation n'existe. L'Add-on réécrit ses propres fichiers,
  puis appelle `api.project.reload()`.
- **Nom de la nouvelle URL**, et comment on y accède tant que la bascule n'est pas faite.
- **Création globale** quand plusieurs projects sont candidats : le project du filtre ? le dernier
  utilisé ? `default` ?
- **Export sélectif / déplacement de Documents** : c'est un calcul de fermeture transitive.
  Reporté.
- **Vues sauvegardées** et **vue écran** (HUD, bossbar, scoreboard) : hors de ce chantier.

## Points de code touchés

| Fichier | Nature du changement | Tranche |
|---|---|---|
| `editor/src/features/canvas/deriveEdges.ts` | variante `Project[]` avec ids qualifiés, signature actuelle conservée | 1 |
| nouveau module `arrangeBoard` (`features/canvas/`) | étapes 1 à 7, fonction pure + ajout de la dépendance `@dagrejs/dagre` | 2 |
| `editor/src/features/canvas/menuLayout.ts` | seule source des tailles de nœuds, réutilisée telle quelle | 2 |
| `editor/src/features/canvas/edgeRouting.ts` | inchangé : les courbes restent calculées de boîte à boîte | — |
| `editor/src/features/canvas/autoLayout.ts` | `autoLayout` et `gridArrange` remplacés par `arrangeBoard` à la bascule | 8 |
| `editor/src/features/canvas/Stage.tsx` | prop de lecture seule ; pas de second hôte | 3 |
| nouvelle route `…/servers/$serverId/canvas` | planche générale | 3 |
| `editor/src/features/canvas/offBoardLinks.ts`, `GhostChips.tsx` | ne se déclenchent que sur filtre | 3 |
| `editor/src/domain/types.ts` (`canvasLayout`) | liste des membres → positions fixées | 4 |
| `editor/src/features/canvas/properties/ActionEditor.tsx` | « + Créer » dans le sélecteur de cible | 5 |
| `editor/src/features/search/searchIndex.ts` | `Project` → `Project[]` | 7 |
