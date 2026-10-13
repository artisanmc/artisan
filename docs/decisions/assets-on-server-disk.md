# Les assets vivent sur le disque du serveur, le backend n'en garde qu'un cache

**Statut : remplacé (phase F, 2026-10)** — le backend et son cache sont supprimés ; les assets vivent sous `assets/` du Project et le pack se construit dans le navigateur. Voir [editor-web-server](editor-web-server.md).

**Status :** accepted (2026-08-17) — **implémenté sauf la suppression de la
table** (P0→P5 + polices dépliées ; P6 attend que la descente ait tourné en
prod). Achève `server-disk-only-storage` en lui retirant son exception n°1
(« le backend continue de stocker les assets binaires »), et retire à la ligne
`projects` la dernière chose qui lui pende vraiment.

## Contexte

`server-disk-only-storage` a mis tout le **contenu de config** sur le disque du
serveur, et s'est arrêté à la frontière des binaires :

> le backend « continue de stocker les assets binaires et les artefacts dérivés
> (resource pack, icônes 3D) : ce ne sont pas la vérité de config, et le RP doit
> être hébergé quelque part pour être servi aux joueurs. Constat qui l'autorise :
> `filesJson` est un `Record<string, string>`, les binaires n'y ont jamais été. »

L'argument tenait pour le **resource pack** (un artefact dérivé, à héberger sur
une URL publique que le client Minecraft télécharge). Il ne tient pas pour les
**sources** : une texture de fond, un glyphe, une police importée ne sont pas
plus dérivés qu'un `menus/shop.yaml`. Ce sont des fichiers que l'admin a
fabriqués, et sans lesquels sa config ne rend rien.

Trois constats ont débloqué la décision (2026-08-17) :

- **Les octets ne sont déjà pas en base.** Ils sont sur un volume backend
  (`data/assets/<projectId>/<assetId>.png`). Ce que Postgres porte, c'est la
  métadonnée : `type`, `name`, `width/height`, `ascent`, `codepoint`,
  `contentWidth`, `fontMeta`, `contentHash`. Déplacer le stockage, c'est donc
  déplacer *un dossier et une table*, pas réécrire un modèle.
- **L'anti-lock-in est incomplet sans eux.** La promesse de
  `files-first-source-of-truth` — *« ta config marche sans nous »* — est fausse
  aujourd'hui pour tout menu qui a un fond ou un glyphe : les fichiers partent,
  les images restent chez nous.
- **Le propriétaire l'a demandé** (2026-08-17) : *« tout ce qui est glyph/assets
  faudrait que ça soit aussi stocké niveau serveur, mais avec un cache
  backend »*. La deuxième moitié de la phrase est ce qui rend la première
  tenable : sans cache, chaque aperçu de glyphe serait un aller-retour WS.

Et un bug latent que la question a fait remonter : les assets pendent à
`projects.id` par une FK en cascade, alors que l'identité d'un Project est
désormais son **nom de dossier**. Renommer le dossier sur le serveur crée une
nouvelle ancre : les glyphes de l'ancienne deviennent orphelins, silencieusement.
Personne ne s'en aperçoit tant qu'il ne renomme pas.

## Décisions

1. **Les assets sont des fichiers du Project.** Ils vivent sous
   `assets/` dans le dossier du Project, aux côtés de `menus/`, `commands/` et
   `lang/` :

   ```
   assets/
     textures/fond_boutique.png
     glyphs/icone_diamant.png
     glyphs/icone_diamant.yaml     # ascent, codepoint, hauteur, largeur de contenu
     fonts/pixelmix/…              # police importée : le zip déplié
   ```

   Le PNG **est** la source ; le `.yaml` frère porte ce que le PNG ne sait pas
   dire. Un asset sans `.yaml` reste utilisable avec des défauts (c'est la règle
   des fichiers data nus, ADR `bare-data-files`) — on ne rend pas une texture
   inutilisable parce qu'il lui manque un descripteur.

   *Rejeté :* un seul `assets/index.yaml` listant tout. C'est le bloc `files:` du
   manifest qu'on vient de supprimer, sous un autre nom : une liste à maintenir à
   la main, qui se périme au premier fichier déposé.

2. **L'identité d'un asset est son nom de fichier**, comme pour les Documents
   (ADR `server-disk-only-storage` décision 8). `asset:<id>` devient
   `asset:<nom>` — `icone_diamant`, pas `ast_9f3c1a`.

   C'est un **changement de format cassant** : les menus existants référencent
   des ids opaques générés par le backend, et le plugin les résout par id dans
   `asset-index.json`. La migration réécrit les deux côtés (§ Migration).

   *Pourquoi ne pas garder l'id opaque :* il n'a de sens que dans la base qui l'a
   émis. Sur un disque qu'un humain doit pouvoir lire et éditer, `asset:ast_9f3c1a`
   est une énigme ; c'est exactement ce qu'on a retiré aux Documents.

3. **Le backend ne garde qu'un cache, clé par contenu.** Cache par
   `(serverKeyId, projectDiskId, chemin, contentHash)`, alimenté à la lecture,
   invalidé par le `contentHash`. Il est **jetable** : le perdre ne perd rien,
   il se re-remplit au prochain accès. Aucune route ne le traite comme une
   vérité — s'il est vide et le serveur injoignable, on répond « indisponible »,
   jamais une version d'avant.

   *Ce que le cache achète :* l'aperçu dans l'éditeur (canvas, bibliothèque
   d'assets) sans un aller-retour WS par image, et la construction du resource
   pack sans relire tout le disque du serveur à chaque fois.

4. **Les binaires ne voyagent pas dans l'arbre de Project.** `project_read`
   renvoie l'arbre entier à l'ouverture, en UTF-8 : y verser des PNG en base64
   (+33 %) rendrait chaque ouverture énorme pour un contenu dont l'éditeur n'a
   besoin qu'à l'affichage. Deux messages dédiés, **par chemin** :
   `asset_read` (un fichier, base64) et `asset_write` (compare-and-swap sur
   `base_hash`, comme `project_write`).

   L'arbre continue d'annoncer leur **existence** (chemin + hash), pour que
   l'éditeur sache quoi proposer sans avoir à tout télécharger.

   *Rejeté :* un canal binaire WS séparé (frames binaires) — la complexité de
   protocole n'est pas payée par le gain, les assets sont petits (2 Mo max par
   PNG, 5 Mo par police) et rarement écrits.

   *Rejeté :* un upload HTTP direct navigateur → plugin. Le plugin n'est pas
   exposé publiquement et n'a pas de certificat ; c'est le backend qui relaie,
   comme pour tout le reste.

5. **Le resource pack reste construit et hébergé par le backend.** C'est un
   artefact dérivé, servi par URL au client Minecraft du joueur : il lui faut un
   hôte public. Il se construit désormais depuis le **cache** (donc, in fine,
   depuis le disque du serveur), et se reconstruit quand un `asset_write` ou un
   reload change un hash.

   *Note de direction, hors périmètre :* le jour où c'est le **plugin** qui
   construit et sert le pack, la config marche entièrement sans nous, RP compris.
   C'est la suite logique de cet ADR, pas cet ADR.

6. **Les codepoints sont dans les fichiers.** Aujourd'hui un index unique
   `(projectId, codepoint)` en base garantit l'unicité, et `allocateCodepoint`
   attribue. Demain chaque glyphe déclare le sien dans son `.yaml` ; l'éditeur
   propose le premier libre à la création, et la **fusion inter-projects
   existante** (`mergeCodepoints`, projet le plus ancien gagne) reste le seul
   arbitre au moment du build.

   Conséquence assumée : deux glyphes du même Project peuvent porter le même
   codepoint si quelqu'un édite les fichiers à la main. Le build tranche et
   **journalise** ; il ne refuse pas de construire. C'est la même philosophie que
   pour les refs qui pendent dans le vide (ADR `hermetic-invariant-philosophy`).

7. **La table `assets` disparaît.** Sa métadonnée part dans les `.yaml` frères,
   ses octets dans le dossier du Project. Ce qui reste au backend :
   `serverKeys.resourcePackHash` (l'artefact) et le cache.

   Effet de bord recherché : plus rien de substantiel ne pend à `projects.id`
   — il ne reste que l'historique de l'assistant IA (`assistant_conversations`,
   sans FK). Le débat « faut-il encore une table `projects` ? » (soulevé le
   2026-08-17) devient tranchable ensuite, sans que des binaires ne le bloquent.

## Migration

Il y a des assets en production. Rien de tout ceci ne peut être « simplement
déployé ».

1. **Descente.** Pour chaque Project ayant des assets : le backend envoie les
   octets au plugin (`asset_write`), qui les pose sous `assets/`. Le nom de
   fichier vient du `name` de la ligne, dé-collisionné si besoin.
2. **Réécriture des refs.** Les `asset_id: ast_…` des menus deviennent
   `asset: <nom>`. Lecteur tolérant côté plugin **et** éditeur : un `asset_id`
   opaque encore présent continue d'être résolu par l'ancien index tant que la
   descente n'a pas eu lieu.
3. **Bascule du build de pack** sur le cache, puis suppression de la table.

La descente est **idempotente** et se rejoue : elle est pilotée par le hash, pas
par un drapeau « déjà migré ».

## Ce qu'on accepte de perdre

- **L'édition d'assets serveur éteint.** On ne peut ni téléverser ni supprimer un
  glyphe sans le serveur — même règle que pour les menus depuis
  `server-disk-only-storage`. L'aperçu, lui, survit par le cache.
- **La garantie SQL d'unicité des codepoints**, remplacée par une fusion qui
  tranche et journalise (décision 6).
- **Un aller-retour de plus** au premier affichage d'un asset non caché.

## Questions ouvertes

- ~~**Les polices importées**~~ — **tranché le 2026-08-17 : dépliées.** Mesure
  qui a décidé : l'ASCII vanilla fait 95 PNG plus son descripteur, **26 Ko en
  tout**. Garder le zip aurait posé une boîte noire au milieu d'un dossier dont
  tout le reste s'édite à la main, et il aurait fallu dézipper / corriger /
  rezipper pour toucher un seul glyphe — pour économiser 96 entrées.

      assets/fonts/<nom>/font.yaml      ← quel caractère, quelle image, ascent
      assets/fonts/<nom>/<texture>.png  ← un fichier par glyphe

  Conséquences actées : une police est un **dossier**, donc l'asset c'est elle,
  pas chacun de ses PNG (sinon la bibliothèque afficherait 95 « glyphes »
  nommés a, b, c…) ; son empreinte est celle de son **descripteur**, qui change
  dès qu'un glyphe est ajouté, retiré ou déplacé ; la supprimer emporte tous ses
  fichiers ; et `asset_write` devient **groupé et tout-ou-rien**, une police à
  moitié posée afficherait des carrés à la place des lettres manquantes.
- **Les icônes 3D d'items** (`backend/assets-seed/icons-<version>.zip`) ne sont
  pas des assets de Project — elles sont dérivées de la version du jeu et
  partagées par tous. Elles restent au backend. À confirmer qu'aucune n'a été
  traitée comme un asset de Project.
