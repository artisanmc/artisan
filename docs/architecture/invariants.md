# Invariants critiques

Règles qu'on ne peut pas casser sans casser l'édition plugin ↔ backend ↔ éditeur.
Chaque entrée dit **quoi**, **pourquoi**, et **ce qui la verrouille** (test / vecteur de conformance).

Résumé exécutable dans `CLAUDE.md` § Invariants — ce fichier est le détail.

---

## Le contenu d'un Project vit sur le disque du serveur, et nulle part ailleurs

ADR `server-disk-only-storage` (2026-08-13). Le backend ne stocke **aucun** contenu de Project :
ni `filesJson`, ni commits, ni branches. Ce qu'il garde d'un Project, c'est son **identité** (nom,
slug, serveur propriétaire, network) — de quoi le lister et le router dans l'éditeur.

- **Lecture** : `project_read` → l'arbre complet, relPath-keyed, lu à la demande sur le disque.
- **Écriture** : `project_write`, sur **geste explicite** de l'admin. Le **plugin est le seul
  écrivain** — le backend relaie, il n'arbitre jamais (il n'a aucune copie avec quoi arbitrer).
- **Serveur hors ligne** = Project inouvrable. Pas de repli sur une copie périmée : il n'y en a
  pas, et en inventer une ferait éditer un état qui n'existe nulle part.
- **Exception en cours de résorption** : les assets binaires (textures, glyphes, polices) vivent
  encore sur un volume backend. ADR `assets-on-server-disk` (2026-08-17) les ramène sous
  `assets/` dans le Project, le backend n'en gardant qu'un **cache jetable** clé par contenu.
  **Rien n'est implémenté** — tant que ça dure, un dossier de Project renommé sur le disque
  orpheline silencieusement ses glyphes (ils pendent à l'ancienne ligne d'ancrage).

> **Révision 2026-09-26** (ADR `snapshot-mirror-and-backend-history`) : le backend garde un
> **miroir jetable** du Snapshot, servi seulement si son hash égale le dernier hash annoncé par
> le plugin. Il n'est jamais une autorité ni une base de compare-and-swap : la publication
> reste un CAS contre le disque, et vider `project_snapshots` ne perd rien.

Corollaire : il n'existe plus de divergence disque↔backend, donc plus de `detectSyncAction`, plus
de `sync_divergence`, plus de `bundle_available`. Le `SyncScanner` subsiste, mais **uniquement**
pour recharger à chaud une édition faite à la main ou par un agent : il ne décide plus de rien.

## Une clé serveur = un serveur vivant

Au `hello`, le backend **évince** toute connexion déjà liée à la même clé (dernier arrivé gagne) et
prévient l'évincé par `session_replaced`.

Ce n'était pas nécessaire tant que le backend détenait le contenu : les N instances téléchargeaient
le même bundle, donc parler à l'une ou l'autre revenait au même. Depuis `server-disk-only-storage`,
chacune a **son** disque et rien ne les synchronise — le relais (`firstPluginSender`) ferait lire un
disque et écrire l'autre, puis basculerait **en silence** quand la première tombe, produisant des
conflits fantômes sur des fichiers que personne n'a touchés.

**Dernier arrivé gagne, et pas l'inverse** : un serveur qui crashe laisse une connexion morte ;
« premier gagne » verrouillerait le vrai serveur dehors jusqu'à expiration du keepalive, au pire
moment. Deux serveurs qui se disputent réellement une clé deviennent visibles (déconnexions en
boucle) au lieu de diverger en silence.

**Verrouillé par** `hub.test.ts` § « une clé serveur = un serveur vivant ».

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

## Versions en base — la corbeille disque n'est plus alimentée (2026-09-26)

ADR `snapshot-mirror-and-backend-history`, décision 6. Chaque Snapshot reçu par le miroir qui
diffère du précédent devient une **Version** (`project_versions`, contenus dans `snapshot_blobs`) :
date, auteur (l'utilisateur dont l'écriture a précédé ce Snapshot, sinon le serveur) et manifeste.
L'historique d'un fichier et celui du Project se lisent en base ; **restaurer ne publie jamais** :
le contenu va dans le brouillon, puis la publication normale (CAS) s'applique.

Le plugin n'écrit plus `.artisan/history/` (`withHistory` est l'identité) ; les archives existantes
restent lisibles par `project_history`, qui sert de repli tant qu'un Project n'a aucune Version.
Limites assumées : plusieurs éditions à la main entre deux reloads forment une seule Version ;
les images d'une Version ne sont que des hashes (leurs octets ne sont pas conservés) ; perdre la
base perd les Versions, jamais le contenu publié.

## Exclusion `.artisan*` universelle (2026-07-23)

Tout relPath dont le **premier segment** commence par `.artisan` est une métadonnée : hors hash,
invisible au scan de contenu.

Une nuance est apparue avec la bascule disque-seul : l'éditeur **possède**
`.artisan/editor.yaml` (layout du board, `i18n_mode`) et doit pouvoir l'écrire. La règle de
`project_read` / `project_write` est donc plus fine que l'exclusion hash — et symétrique : **ce que
l'éditeur ne voit pas en lecture, il ne peut pas l'écrire**. Restent invisibles et interdits :
`.artisan/history/` (corbeille), `.artisan-trash/`, `.artisan-sync.yaml`.

## Le hash n'est plus un invariant inter-langage

Il l'a été : `BundleHasher` (plugin) et `hashUtils.computeBundleHash` (backend) devaient produire
le même hash d'arbre au byte près, sous peine d'inventer des divergences, et un vecteur partagé
(`testdata/project-hash-conformance.json`) le verrouillait. Le backend ne calcule plus rien : le
vecteur et son implémentation backend ont disparu.

Restent deux usages, tous deux locaux : le hash d'arbre (`BundleHasher.hash`) pour la détection de
changement du scanner, et `hashContent` — un **contenu de fichier**, jeton du compare-and-swap,
reproduit côté éditeur par `lib/contentHash.ts` (SHA-256 UTF-8, hex minuscule).

## OkHttp — pas d'I/O bloquant dans le callback WS

`SyncedMenuProvider.handleMessage` est appelé sur le thread WS callback d'OkHttp. Les lectures et
écritures de `project_read` / `project_write` sont dispatchées sur
`httpClient.dispatcher.executorService`. Ne jamais faire d'I/O bloquant dans le callback WS
directement.

## Reload atomique

`reloadFromDisk()` construit un nouveau `ConcurrentHashMap` **entier**, puis l'assigne à
`@Volatile var menus`. Ne jamais modifier le map en place.

## Détection = contenu, jamais événement

Spec `2026-07-30-poll-first-disk-sync-design`. `SyncScanner` remplace l'ancien `ProjectWatcher`
inotify, dont la correction dépendait d'événements OS jamais délivrés sur bind mount Docker / NFS /
SMB. Il ne sert plus qu'au hot-reload, mais la règle tient toujours : **aucun chemin de correction
ne dépend d'un événement de système de fichiers.**

Le tick fait : court-circuit `stat` (signature chemins/tailles/mtimes), quiescence sur 2 ticks
consécutifs avant dispatch (un upload FTP en cours n'est jamais rechargé à moitié), et un deep tick
tous les 10 ticks = vrai hash de contenu, filet pour les FS à granularité mtime grossière.

Le comportement est **identique en dev Docker et en prod Linux** — c'est le gain principal.

## DELETE project = soft-delete

`DELETE /api/v1/user/projects/:projectId` (cookie auth + membership) marque `deletedAt`
(`softDeleteProject`, la ligne reste en DB) et broadcast `project_deleted` au plugin (qui
move-to-trash) et aux autres connexions éditeur.

## `.artisan-trash/` is sacred

Répertoire au top de `projectsDir`, créé par `ProjectDeleter`. Ne jamais utiliser ce nom pour autre
chose.

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
`hopper.png` (entonnoirs), `dispenser.png` (distributeurs **et** droppers). Le pack (backend
`vanillaGui.ts`) remplace donc par une texture transparente celle de chaque type dont **un** menu
d'un projet lié au serveur l'utilise (coffre / entonnoir / dropper, indépendamment), et le signale
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
  charger le pack Artisan (id poussé, ou n'importe quel pack en délégation) **et** si le catalogue
  courant rend ce type transparent. Sinon la glyph s'afficherait en caractère manquant. Un menu
  Artisan en `vanilla_texture: false` n'est pas décoré.
- **Transitoires acceptés** : entre une publication et le rechargement du nouveau pack, un joueur peut
  voir la texture en double (invisible : c'est la même image) ou, si la transparence vient d'être
  retirée, un conteneur transparent jusqu'à ce qu'il reçoive le pack suivant.
- **Source des glyphs** : la texture vanilla (copie de l'éditeur), ou la première image d'un projet
  lié portant l'usage `chest_texture` / `hopper_texture` / `dispenser_texture` (format vanilla,
  256×256 ou multiple HD : découpée à son échelle, dessinée à la taille vanilla). Une image marquée au
  mauvais format est ignorée avec un WARN backend. C'est ainsi qu'un pack **serveur** qui restyle ces
  conteneurs garde son aspect.
- Un autre pack serveur qui remplace aussi ces textures (Nexo, Oraxen, ItemsAdder) : le dernier chargé
  gagne. Un pack **perso** côté joueur est écrasé (les packs serveur passent au-dessus) et ses
  conteneurs redeviennent ceux de la source ci-dessus — limite de l'approche globale, seul un shader
  ciblé l'éviterait.

## Custom items — hash inline

`CustomItemsManager.buildBundle()` calcule le hash **en inline** à partir des items / textures déjà
collectés (ne rappelle pas `computeHash()` séparément) pour garantir la cohérence hash ↔ data.
