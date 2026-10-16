# Invariants critiques

Règles qu'on ne peut pas casser sans casser l'édition éditeur ↔ hub ↔ serveur.
Chaque entrée dit **quoi**, **pourquoi**, et **ce qui la verrouille** (test / vecteur de conformance).

Résumé exécutable dans `CLAUDE.md` § Pièges — ce fichier est le détail.

---

## Tout vit sur le disque du serveur

Depuis la phase F (2026-10), il n'y a plus de backend ni de copie centrale. Contenu publié
**et** brouillons privés d'un Project vivent dans son dossier, sur le serveur qui le charge
(ADR `editor-web-server`, révision du 2026-10-12 de `server-disk-only-storage`) :

- **Lecture** : `project_read` rend l'instantané chargé par le serveur, pas le disque courant.
- **Écriture** : `project_write` ou la publication d'un brouillon, sur **geste explicite**. Le
  **plugin est le seul écrivain** ; le hub relaie et n'arbitre jamais.
- **Brouillons** : dans la base de la suite (`artisan_drafts`), un jeu par UUID de joueur,
  sauvegardés automatiquement, servis par le hub même serveur éteint. La publication est une
  écriture du serveur (compare-and-swap, journal `.artisan/transactions/`) ; le hub ne marque le
  brouillon publié qu'après sa réponse, rejouable sous le même `operation_id`.
- **Serveur éteint** : l'éditeur qu'il héberge l'est aussi ; une feuille éteinte est listée hors
  ligne (503 `server_offline`). Rien n'est ouvrable sans le serveur.
- **Édition à la main** : prise en compte à `/artisan reload` seulement (le `SyncScanner` a été
  retiré). L'éditeur l'apprend par `projects_reloaded`.

## Un server id = un serveur vivant

Sur `/ws/plugin`, le hub identifie une feuille par son `server_uuid` (`plugins/Artisan/server-id`),
jamais par son nom. Une nouvelle connexion sous le même id **remplace** l'ancienne
(`RemoteServer.attach`), prévenue par `session_replaced` ; un `hello` sans id, ou portant l'id du
hub lui-même, est refusé (1008). Deux serveurs sous un même id ont chacun leur disque : les laisser
coexister ferait lire l'un et écrire l'autre. **Dernier arrivé gagne** : un serveur qui crashe
laisse une connexion morte, et « premier gagne » verrouillerait le vrai serveur dehors. Deux
dossiers copiés qui se disputent un id deviennent visibles (déconnexions en boucle, refus
`CopiedId` de `ServerRegistry`) au lieu de diverger en silence. Un serveur renommé garde son id,
ses Projects et ses Versions ; deux serveurs de même nom sont départagés à l'enregistrement
(`NameTaken`), le hub les distingue par id.

## Une release, une version de protocole

Le `hello` porte `ProtocolVersion.CURRENT`. Majeure différente de celle du hub : la feuille
reste listée « mise à jour requise » et **rien ne lui est envoyé** (`RemoteServer.send` refuse,
`Relay` répond 503 `plugin_update_required`) — on n'écrit jamais chez un serveur qui pourrait
mal lire. Mineure différente : champs additifs, ignorés par l'autre côté. Tous les jars d'une
release portent le même numéro. **Verrouillé par** `PluginChannelTest` (« another major protocol version »).

## Session et même origine

Toute route `/api/` exige une session (cookie `HttpOnly`, `SameSite=Strict`) portant la
permission de la route ; toute requête qui modifie quelque chose, et l'ouverture de
`/ws/editor`, exige un `Origin` du même hôte. Seuls `/login/<jeton>`, `/resource-pack/<sha1>.zip`,
les fichiers de l'éditeur et `/ws/plugin` (secret partagé) sont publics. Le hub ne lit jamais une
permission lui-même : il reprend celles que le serveur a lues pour le joueur au moment du lien.

## Compare-and-swap par fichier, tout ou rien

Chaque entrée d'un `project_write` porte le `base_hash` du contenu que l'éditeur avait chargé
(`null` = « je m'attends à ce qu'il n'y ait pas de fichier ici », ce qui couvre d'un seul mécanisme
le fichier neuf et le fichier disparu).

- Un seul fichier périmé **annule l'écriture entière**. Une écriture à moitié appliquée laisserait
  un Project incohérent *en ligne*, et l'éditeur ne saurait plus de quel état repartir.
- Les conflits remontent **avec le contenu disque attaché** : l'éditeur affiche le diff sans second
  aller-retour.
- Un fichier réellement contesté **exige un choix explicite**, des deux côtés (plugin et éditeur).
  Un défaut silencieux sur une donnée contestée, c'est de la perte de données déguisée en ergonomie.

**Verrouillé par** `ProjectWriteChannelTest` (plugin) et `diskSave` / `resolveConflicts` (éditeur).

## Historique : `.artisan/history/` n'est plus alimenté

`ProjectPublisher.withHistory` est l'identité depuis le 2026-09-26 (l'historique était passé au
backend, supprimé depuis). Les archives existantes restent lisibles par `project_history` et
suivent un renommage ; aucune écriture n'en crée. Il n'existe aucune Version d'un Project.

## Exclusion `.artisan*` universelle (2026-07-23)

Tout relPath dont le **premier segment** commence par `.artisan` est une métadonnée : hors hash,
invisible au scan de contenu.

L'éditeur **possède** `.artisan/editor.yaml` (layout du board, `i18n_mode`) et doit pouvoir
l'écrire. La règle de `project_read` / `project_write` (`EditorPaths`) est donc plus fine que
l'exclusion hash — et symétrique : **ce que l'éditeur ne voit pas en lecture, il ne peut pas
l'écrire**. Restent invisibles et interdits : `.artisan/history/`, `.artisan/drafts/`,
`.artisan/transactions/` (`ProjectPathPolicy.isPrivate`), `.artisan-trash/`, `.artisan-sync.yaml`.

## Le hash n'est pas un invariant inter-langage

Le hash d'arbre (`BundleHasher.snapshotHash`) n'est calculé que par le plugin : l'éditeur le
garde et le rend en `if_hash`, sans le recalculer. `testdata/project-snapshot-hash-conformance.json`
le fige côté plugin (`ProjectSnapshotHashConformanceTest`).

Seul `hashContent` / `hashBytes` (SHA-256 d'un contenu de fichier, hex minuscule), jeton du
compare-and-swap, est reproduit côté éditeur par `lib/contentHash.ts`, avec un repli en JS pur
(`lib/sha256.ts`) quand `crypto.subtle` manque (HTTP hors `localhost`).

## Pas d'I/O bloquant dans le callback WS

Sur une feuille, `SyncedMenuProvider.handleMessage` tourne sur le thread de callback d'OkHttp ;
côté hub, `PluginChannel` sur celui de Jetty. Ils ne font que typer le message
(`EditorRequest.parse`) et le router. Toute réponse part par `Replies` ; toute lecture ou écriture
disque d'un Project par `ProjectWorkspace.io`, une à la fois.

## Threads — Folia, Leaf, Paper

Le plugin déclare `folia-supported: true`. Sur Folia et avec le parallel world ticking de Leaf,
il n'y a plus de thread principal : chaque joueur appartient au thread de sa région, l'état
serveur (command map, commandes console, config) au thread global. Toute planification passe par
le port `Scheduler` (`core`, package `scheduling`) :

| Méthode | Pour |
|---|---|
| `player` / `onPlayer` | Inventaire, menu, téléportation, son : tout ce qui touche un joueur. |
| `global` / `onGlobal` | Command map, `dispatchCommand` console, reinit de config, reload des bundles. |
| `async` | Ce qui ne touche pas au monde (I/O, notifications à l'éditeur). |

`on*` exécute tout de suite si le thread courant convient, sinon planifie. `schedulerFor(plugin)`
choisit `RegionizedScheduler` (Paper, Folia, Leaf) ou `BukkitTaskScheduler` (MockBukkit).
`SchedulerBoundaryTest` refuse tout `Bukkit.getScheduler()`, `server.scheduler` ou
`isPrimaryThread` hors de `PaperSchedulers.kt`. Téléporter : `teleportAsync`, jamais `teleport`.

Le hub ajoute ses propres threads : Jetty (`artisan-web`, 32 max) répond aux requêtes HTTP et
WebSocket, et ne touche jamais le jeu directement. Le serveur du hub passe par `LocalServerLink`
vers les mêmes gestionnaires que le WebSocket : lectures et écritures disque sur
`ProjectWorkspace.io`, accès joueurs et inventaires par le `Scheduler`.

Rien de bloquant dans `onEnable` ni sur le thread global après lui (issue #42) :

- La base de la suite (pool, migrations et leur `GET_LOCK`, enregistrement dans
  `artisan_servers`, import H2 → MySQL) s'ouvre sur le thread `Artisan-versions`
  (`SuiteDatabase.open`, `paper`), en tête de file : la première Version, mise en file par
  le premier chargement, la trouve ouverte. Tant qu'elle ne l'est pas, le hub le dit plutôt que
  de servir du vide (`LateSuiteData`) : Versions et états chargés absents (les routes relaient
  au serveur, comme sans base), brouillons refusés `storage_error` 503 (l'éditeur réessaie),
  sessions éditeur en mémoire seule, feuilles refusées sur `/ws/plugin` avec « not open yet »
  (elles se reconnectent). Une feuille attend elle-même sa base avant d'envoyer `hello`
  (`WsClient.connect`, `HubLink.databaseId`).
- Un rechargement demandé après le démarrage (`api.project.reload()`, `projectRoots.register`)
  lit le disque et parse le YAML sur le thread `Artisan-reload`
  (`SyncedMenuProvider.refreshFromDisk`) ; seul `applyReload` (command map, `onReload()` des
  modules) repasse par le thread global, après la bascule du snapshot. Le premier chargement et
  `/artisan reload` restent synchrones : les menus et commandes existent quand le serveur
  s'ouvre, et la réponse de l'admin dit vrai.
- Aucun JDBC ni I/O disque dans le chemin join, tick ou clic.

## Reload atomique

`reloadFromDisk()` construit un nouveau `ConcurrentHashMap` **entier**, puis l'assigne à
`@Volatile var menus`. Ne jamais modifier le map en place.

## `.artisan-trash/` est réservé

Nom réservé au top d'une racine de Projects, exclu du hash et de l'éditeur. `project_delete`
(`ProjectFolders`) y déplace le dossier d'un Project supprimé, sous `<id>-<horodatage>` : rien
n'est jamais effacé. Ne jamais l'utiliser pour autre chose.

## Le contenu des menus n'existe que côté client

Un menu ouvre un vrai `createInventory(ArtisanMenuHolder…)` — **l'ancre** — mais **vide**. Elle fournit
l'id de fenêtre, les événements Bukkit (click, close, drag) et la présence du joueur dans un menu pour
les autres plugins. Tout le contenu vit dans `MenuSlots` (session) et est réécrit dans les paquets
sortants par `PacketEventsMenuPackets` (`OPEN_WINDOW` capture l'id, `WINDOW_ITEMS` / `SET_SLOT`
réécrits, `SET_PLAYER_INVENTORY` aussi quand le bas est `hidden`). PacketEvents est **intégré au jar**
(relocalisé sous `net.artisanmc.shaded.packetevents`) : chaque version majeure de Minecraft impose de
le mettre à jour, puis de passer la checklist manuelle de `testing.md`.

- **Adressage unique par rawSlot du protocole** : `0..size-1` le menu, `size..size+26` l'inventaire
  principal, `size+27..size+35` la barre rapide. Une position `≥ size` n'a de sens qu'avec
  `player_inventory: hidden` ; en `visible` (défaut) elle est ignorée.
- **Rien n'existe côté serveur** : ni l'ancre ni l'inventaire du joueur ne sont modifiés. Crash, mort,
  déconnexion menu ouvert : rien à perdre ni à dupliquer. `/data get entity @s Inventory` menu
  ouvert = le vrai inventaire.
- **Écrire le contenu = `MenuSlots.set`**, jamais `anchor.setItem`. Menu ouvert, l'écriture part au
  client via le `ClientSlotSink`.
- **Fermeture** : la fenêtre n'est libérée que si c'est la bonne ancre (ouvrir B depuis A pose B puis
  ferme A), puis `updateInventory()` au tick suivant pour que le client réaffiche le vrai inventaire.
- **Slots de dépôt (`SlotKind.INPUT`)** : prévus dans le contrat, pas implémentés. Un slot `INPUT`
  n'est jamais réécrit — son objet réel vivrait dans l'ancre. Le listener teste déjà le type de slot.
- Sans PacketEvents opérationnel (échec de `load`/`init`, loggé en SEVERE ; cas de MockBukkit en
  test), les menus s'ouvrent **vides** : clics et sessions restent actifs.

## Conteneurs transparents : globaux côté pack, réinjectés par le titre

`vanilla_texture: false` ne peut pas être local à un menu : le client dessine la même texture pour
**toutes** les fenêtres d'un type — `generic_54.png` (coffres, tonneaux, ender chests, menus 9×N),
`hopper.png` (entonnoirs), `dispenser.png` (distributeurs **et** droppers). Le pack (construit par l'éditeur,
`editor/src/lib/pack/vanillaGui.ts`) remplace donc par une texture transparente celle de chaque type dont **un** menu
d'un projet du serveur l'utilise (coffre / entonnoir / dropper, indépendamment), et le signale
dans `asset-index.json` : `vanilla_gui.transparent_chests|hoppers|dispensers`.

- **Chaque pack** embarque la police `artisan:vanilla_gui` : 6 glyphs `generic_9x1..6` découpées
  comme `ChestScreen` (haut `0..17+18N`, bas depuis y=126 sur 96 px), `hopper` (176×133) et
  `dispenser` (176×166) = la boîte complète ; `ascent 13` (haut à y=0), plus les espaces de recalage
  (−8 vers x=0, puis retour à l'origine du titre, calculé sur la largeur réelle). Codepoints : 1..6
  coffre, 7 entonnoir, 8 distributeur.
- **Le plugin réinjecte** (`VanillaGuiTitle`, dans `PacketEventsMenuPackets.onOpenWindow`) : préfixe
  glyph + titre d'origine intact. Les coffres sont reconnus par leur type protocole `generic_9x1..6`
  (ids 0..5, stables) ; entonnoirs et distributeurs/droppers par le type Bukkit de l'inventaire qui
  vient de s'ouvrir (`OpenedContainers`, `InventoryOpenEvent` juste avant le paquet), leurs ids
  protocole bougeant d'une version à l'autre. Pour un joueur seulement si `PackLoadTracker` l'a vu
  charger un pack (le pack Artisan est toujours fusionné dans celui d'un plugin hôte : n'importe
  quel `SUCCESSFULLY_LOADED` compte) **et** si le catalogue
  courant rend ce type transparent. Sinon la glyph s'afficherait en caractère manquant. Un menu
  Artisan en `vanilla_texture: false` n'est pas décoré.
- **Transitoires acceptés** : entre une publication et le rechargement du nouveau pack, un joueur peut
  voir la texture en double (invisible : c'est la même image) ou, si la transparence vient d'être
  retirée, un conteneur transparent jusqu'à ce qu'il reçoive le pack suivant.
- **Source des glyphs** : la texture vanilla (copie de l'éditeur), ou l'image `projet:image` que le
  `config.yml` du serveur nomme dans `resource-pack.container-textures.{chest,hopper,dispenser}`
  (format vanilla, 256×256 ou multiple HD : découpée à son échelle, dessinée à la taille vanilla ;
  ADR `server-config-from-editor`). Une image absente ou au mauvais format est ignorée. C'est ainsi qu'un pack **serveur** qui restyle ces
  conteneurs garde son aspect.
- Un autre pack serveur qui remplace aussi ces textures (Nexo, Oraxen, ItemsAdder) : le dernier chargé
  gagne. Un pack **perso** côté joueur est écrasé (les packs serveur passent au-dessus) et ses
  conteneurs redeviennent ceux de la source ci-dessus — limite de l'approche globale, seul un shader
  ciblé l'éviterait.

## Custom items — hash inline

`CustomItemsManager.buildBundle()` calcule le hash **en inline** à partir des items / textures déjà
collectés (ne rappelle pas `computeHash()` séparément) pour garantir la cohérence hash ↔ data.
