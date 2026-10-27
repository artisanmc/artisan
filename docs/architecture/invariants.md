# Critical invariants

Rules that cannot be broken without breaking editing across editor ↔ hub ↔ server.
Each entry says **what**, **why**, and **what locks it** (test / conformance vector).

Executable summary in `CLAUDE.md` § Costly pitfalls — this file is the detail.

---

## Everything lives on the server's disk

Since phase F (2026-10), there is no backend and no central copy. A Project's published content
**and** private drafts live in its folder, on the server that loads it
(ADR `editor-web-server`, 2026-10-12 revision of `server-disk-only-storage`):

- **Read**: `project_read` returns the snapshot the server loaded, not the current disk.
- **Write**: `project_write` or draft publication, on **explicit action**. The
  **plugin is the only writer**; the hub relays and never arbitrates.
- **Drafts**: in the suite database (`artisan_drafts`), one set per player UUID,
  saved automatically, served by the hub even with the server off. Publication is a
  server write (compare-and-swap, `.artisan/transactions/` journal); the hub only marks the
  draft published after its reply, replayable under the same `operation_id`.
- **Server off**: the editor it hosts is off too; a leaf that is off is listed as
  offline (503 `server_offline`). Nothing can be opened without the server.
- **Hand editing**: picked up on `/artisan reload` only (the `SyncScanner` was
  removed). The editor learns of it through `projects_reloaded`.

## One server id = one live server

On `/ws/plugin`, the hub identifies a leaf by its `server_uuid` (`plugins/Artisan/server-id`),
never by its name. A new connection under the same id **replaces** the old one
(`RemoteServer.attach`), which is notified by `session_replaced`; a `hello` without an id, or carrying the
hub's own id, is refused (1008). Two servers under one id each have their own disk: letting them
coexist would have one read and the other write. **Last one in wins**: a server that crashes
leaves a dead connection, and "first wins" would lock the real server out. Two
copied folders fighting over an id become visible (disconnection loops, `CopiedId` refusal
from `ServerRegistry`) instead of silently diverging. A renamed server keeps its id,
its Projects and its Versions; two servers with the same name are told apart at registration
(`NameTaken`), the hub distinguishes them by id.

## One release, one protocol version

The `hello` carries `ProtocolVersion.CURRENT`. A major different from the hub's: the leaf
stays listed as "update required" and **nothing is sent to it** (`RemoteServer.send` refuses,
`Relay` answers 503 `plugin_update_required`) — we never write to a server that might
misread. A different minor: additive fields, ignored by the other side. All the jars of a
release carry the same number. **Locked by** `PluginChannelTest` ("another major protocol version").

## Session and same origin

Every `/api/` route requires a session (cookie `HttpOnly`, `SameSite=Strict`) carrying the
route's permission; every request that modifies something, and the opening of
`/ws/editor`, requires an `Origin` of the same host. Only `/login/<token>`, `/resource-pack/<sha1>.zip`,
the editor files and `/ws/plugin` (shared secret) are public. The hub never reads a
permission itself: it reuses those the server read for the player when the link was issued.

## Per-file compare-and-swap, all or nothing

Each entry of a `project_write` carries the `base_hash` of the content the editor had loaded
(`null` = "I expect there to be no file here", which covers both the new file and the vanished file
with a single mechanism).

- A single stale file **cancels the entire write**. A half-applied write would leave
  an inconsistent Project *online*, and the editor would no longer know which state to restart from.
- Conflicts come back **with the disk content attached**: the editor shows the diff without a second
  round trip.
- A file that is truly contested **requires an explicit choice**, on both sides (plugin and editor).
  A silent default on contested data is data loss disguised as ergonomics.

**Locked by** `ProjectWriteChannelTest` (plugin) and `diskSave` / `resolveConflicts` (editor).

## History: `.artisan/history/` is no longer fed

`ProjectPublisher.withHistory` has been the identity since 2026-09-26 (history moved to the
backend, since removed). Existing archives remain readable by `project_history` and
follow a rename; nothing creates new ones. No Version of a Project exists.

## Universal `.artisan*` exclusion (2026-07-23)

Any relPath whose **first segment** starts with `.artisan`, **case ignored**, is
metadata: outside the hash, invisible to the content scan. Case is ignored because the disk may
ignore it (macOS, Docker bind mount from Windows): `.ARTISAN/project-id` is the identity file
there. A deeper `.artisan` (`data/.artisan/x`) is ordinary content. The rule is coded
once, `project/ProjectMetadataPaths` (core); all callers delegate to it, except
`EditorScreenRegistry` (`api` module, without access to core) which applies the same rule.

The editor **owns** `.artisan/editor.yaml` (board layout) and must be able to
write it. The `project_read` / `project_write` rule (`EditorPaths`) is therefore finer than
the hash exclusion — and symmetric: **what the editor cannot see when reading, it cannot
write**. Still invisible and forbidden: `.artisan/history/`, `.artisan/drafts/`,
`.artisan/transactions/`, `.artisan/bases/` (merge bases of system elements, `SystemFiles`) (`ProjectPathPolicy.isPrivate`), `.artisan/origins.yaml` (provenance of template copies, written only by `template_copy`), `.artisan-trash/`, `.artisan-sync.yaml`.
Only the canonical spelling `.artisan/editor.yaml` belongs to the editor.

## The hash is not a cross-language invariant

The tree hash (`ContentHash.snapshotHash`) is only computed by the plugin: the editor
keeps it and returns it as `if_hash`, without recomputing it. `testdata/project-snapshot-hash-conformance.json`
freezes it plugin-side (`ProjectSnapshotHashConformanceTest`).

Only `hashContent` / `hashBytes` (SHA-256 of a file's content, lowercase hex), the compare-and-swap
token, is reproduced editor-side by `lib/contentHash.ts`, with a pure JS fallback
(`lib/sha256.ts`) when `crypto.subtle` is missing (HTTP outside `localhost`).

## No blocking I/O in the WS callback

On a leaf, `SyncedMenuProvider.handleMessage` runs on OkHttp's callback thread;
on the hub side, `PluginChannel` on Jetty's. They only type the message
(`EditorRequest.parse`) and route it. Every reply goes out through `Replies`; every disk read or write
of a Project through `ProjectWorkspace.io`, one at a time. A leaf's reply to a
hub request completes a future on that same reader thread: whatever follows it and writes to the database
(the commit of a draft publication) goes back through Jetty's pool (`Call.offload`).

## Threads — Folia, Leaf, Paper

The plugin declares `folia-supported: true`. On Folia and with Leaf's parallel world ticking,
there is no main thread any more: each player belongs to their region's thread, server
state (command map, console commands, config) to the global thread. All scheduling goes through
the `Scheduler` port (`core`, `scheduling` package):

| Method | For |
|---|---|
| `player` / `onPlayer` | Inventory, menu, teleport, sound: anything that touches a player. |
| `global` / `onGlobal` | Command map, console `dispatchCommand`, config reinit, bundle reload. |
| `async` | What does not touch the world (I/O, notifications to the editor). |

`on*` runs immediately if the current thread is right, otherwise schedules. `schedulerFor(plugin)`
picks `RegionizedScheduler` (Paper, Folia, Leaf) or `BukkitTaskScheduler` (Spigot, MockBukkit).
`SchedulerBoundaryTest` refuses any `Bukkit.getScheduler()`, `server.scheduler` or
`isPrimaryThread` outside `PaperSchedulers.kt`. Teleporting: `ServerPlatform.teleport`
(`teleportAsync` on Paper), never `teleport` directly.

**Paper and Spigot.** A Paper-only method (`getCommandMap`, `teleportAsync`,
`getVirtualHost`, `getOfflinePlayerIfCached`, `getMinecraftVersion`, `com.destroystokyo` …) is
only called behind `ServerPlatform.paper` (`runtime`, `platform` package); on Spigot the JVM never
links it. A Paper-only class (head profiles) lives in a separate object, loaded on Paper
only (`PaperSkins`): the JVM verifier can load the types of a method that is
not executed.

**Adventure.** Artisan bundles Adventure under its own names (`paper/build.gradle.kts`): on
Paper the server's copy wins (a plugin's class loader asks its parent first), on
Spigot ours does. A `Component` therefore exists everywhere, but only Paper's Bukkit methods
accept it: sending it (chat, title, broadcast) or putting it on an object (name, lore) goes through
`Chat` and `ItemTexts` (`runtime`, `platform` package), never through `sendMessage(Component)`,
`displayName(Component)` or `lore(List<Component>)` directly. An object's default style goes through `LenientText.itemName` (name without italics) and `LenientText.loreLine` (white lore without italics), everywhere: menus, `give_item`, item specs. The editor previews reuse these defaults (`ITEM_NAME` and `LORE` profiles of `editor/src/lib/mm/profiles.ts`): changing one means changing the other. On Spigot, chat goes as JSON
through the BungeeCord chat API, titles and item texts as `§` (fonts lost). A menu's
composed title goes in the open packet on Spigot (`MenuWindows`, fonts kept); a
dialog goes through the BungeeCord dialog API that Spigot bundles (`SpigotDialogRenderer`, called
by reflection because absent from paper-api; no "item" body there).

The hub adds its own threads: Jetty (`artisan-web`, 32 max) answers HTTP and
WebSocket requests, and never touches the game directly. The hub's server goes through `LocalServerLink`
to the same handlers as the WebSocket: disk reads and writes on
`ProjectWorkspace.io`, player and inventory access through the `Scheduler`.

Nothing blocking in `onEnable` nor on the global thread after it (issue #42):

- The suite database (pool, migrations and their `GET_LOCK`, registration in
  `artisan_servers`, H2 → MySQL import) opens on the `Artisan-versions` thread
  (`SuiteDatabase.open`, `paper`), at the head of the queue: the first Version, queued by
  the first load, finds it open. While it is not, the hub says so rather than
  serving empty data (`LateSuiteData`): Versions and loaded states absent (routes relay
  to the server, as without a database), drafts refused `storage_error` 503 (the editor retries),
  editor sessions in memory only, leaves refused on `/ws/plugin` with "not open yet"
  (they reconnect). A leaf itself waits for its database before sending `hello`
  (`WsClient.connect`, `HubLink.databaseId`).
- A reload requested after startup (`api.project.reload()`, `projectRoots.register`)
  reads the disk and parses the YAML on the `Artisan-reload` thread
  (`SyncedMenuProvider.refreshFromDisk`); only `applyReload` (command map, modules'
  `onReload()`) goes back through the global thread, after the snapshot swap. Grouped requests
  merge into one reload, on both sides. A registered folder only rereads that folder and
  only calls its module's `onReload()`; the files Artisan writes at startup
  call no module. `ProjectRoots.all()` only replays interrupted publications
  on the first view of a folder. At startup, ten full rereads, each followed by
  all modules' `onReload()` on the global thread (which waited for the reread's
  lock), made the watchdog fire on a slow disk. The first load and
  `/artisan reload` stay synchronous: menus and commands exist when the server
  opens, and the admin's reply tells the truth.
- An editor write (`project_write`, `config_write`, `template_copy`, draft publication,
  folder creation, rename or deletion) only rereads the Project(s) it touched
  (`ProjectWorkspace.reload(projectIds)`), then calls the
  `onReload()` of **all** modules: a module's contract is to reread the Documents
  it wants, in any folder, and it does not say which. Captured items are
  read on the thread that reread the Projects; the global thread only swaps the map
  and rebuilds the command map (`applyReload`).
- An interrupted publication (`ProjectPublisher.recover`) is only replayed by
  `ProjectRoots.all()`, on the first view of the folder: no editor read or write
  replays it on each request any more.
- **The Project registry never locks for long.** `ProjectRoots.all()` serves a
  listing taken once (a `listFiles` of the root, a small `.artisan/project-id` file
  per folder, the replay of interrupted publications) and kept until `invalidate()`: a
  reload invalidates it before reading, so does a `register`. A folder created by hand therefore appears
  at the next reload, like its content. Keys are read in the same scan and
  served from there (`descriptors()` no longer touches the disk). The reload and the editor's disk
  writes hold a lock of the provider's own (`SyncedMenuProvider.diskLock`),
  never the `ProjectRoots` monitor: a module's `onEnable` (`moduleFolder`,
  `register`) and `api.project` do not wait for it. `api.project.list/read` answer from
  the loaded snapshot, without lock or disk walk; a Project the snapshot does not have
  yet (folder just registered, read at the next tick) and a file it does not have
  (written by the module before its `reload()`) are read from disk. Before, `all()`,
  `api.project.list/read` and `register` took the monitor that the reload and each
  write held for seconds, from the main thread.
- **A tick's signals are grouped.** Each command declaration and each module
  registration used to rebuild the command map and rerun a full seed (all
  templates of all modules, all overrides). The changes of one tick make one
  rebuild (`commandsRefreshQueued`) and one presence report followed by one seed
  (`notifyModulesChanged`, `modulesChangedQueued`): at startup, modules and their
  commands all announce themselves before the first tick. `/artisan reload` does one reread:
  `reinit()` recreates the provider and loads it, the command no longer chains `unload()/load()`.
  Known remaining: a server config save from the editor does this full
  `reinit()`, synchronous on the global thread (A13 of the audit).
- **One reread = one walk per Project.** `ProjectFilesReader.scan` produces texts and
  binaries from a single `walkTopDown`; a binary's hash is kept by (path, size,
  mtime) between rereads (`BinaryHashCache`, pruned on each full reread): a png
  that has not changed is not reread. The snapshot hash is computed once per Project and
  per snapshot (`ProjectSnapshot.hash`), reused for Projects a partial reread did not
  reread (`inheritHashes`). `VersionRecorder` only records Projects whose hash
  differs from the last recorded one, or that a publication just wrote; the loaded state is
  rewritten each time. The resource inventory (`resource_inventory`) is computed from the
  snapshot (`ResourceInventory.of`), no more disk walk by `project_list` nor by
  reread. `ProjectReader` keeps its own shallow walk for Documents: two
  walks per reread, against four, and each file read once.
- No JDBC or disk I/O in the join, tick or click path.
- **No JDBC on the main thread from a command.** `/artisan editor` creates the link
  in memory and its row follows on the Versions thread (`Sessions.writer`, reads on
  the caller); `/artisan editor logout` deletes and counts its rows in `async` and replies
  in `global`. The database id (`ArtisanMeta.databaseId`) is read once at opening, on
  `Artisan-versions`, then served from cache at each hub connection. A `hello_ack` announcing
  the pack already applied in this process does not redownload it (`ResourcePackManager.appliedHash`);
  the download and the catalog update go through `scheduler.async`.

## Atomic reload

`reloadFromDisk()` builds a new **whole** `ConcurrentHashMap`, then assigns it to
`@Volatile var menus`. Never modify the map in place.

## `.artisan-trash/` is reserved

Name reserved at the top of a Projects root, excluded from the hash and from the editor. `project_delete`
(`ProjectFolders`) moves a deleted Project's folder there, under `<id>-<timestamp>`: nothing
is ever erased. Never use it for anything else.

## Menu content only exists client-side

A menu opens a real `createInventory(ArtisanMenuHolder…)` — **the anchor** — but **empty**. It provides
the window id, the Bukkit events (click, close, drag) and the player's presence in a menu for
other plugins. All the content lives in `MenuSlots` (session) and is rewritten in the
outgoing packets by `MenuPacketRewriter` (`OPEN_WINDOW` captures the id, `WINDOW_ITEMS` / `SET_SLOT`
rewritten, `SET_PLAYER_INVENTORY` too when the bottom is `hidden`). No library: `MenuPacketInterceptor`
puts one Netty handler in each player's connection, right after `encoder` (it sees the server's packet
objects, unbundled, before ViaVersion translates the bytes), and `NmsMenuPackets` reads and builds the four
packets by their **Mojang names**, by reflection, looked up once at enable. Paper (Folia, Leaf) runs with
those names since 1.20.5, Spigot since 26.1; Spigot 1.21.x is obfuscated and Artisan refuses to start there
(`ServerPlatform.obfuscated`). The jar declares `paperweight-mappings-namespace: mojang` so Paper 1.21.x does
not remap it. Each Minecraft major version still requires the manual checklist of `testing.md`: a renamed
packet or accessor fails `NmsMenuPackets.resolve` with its name, at enable.

- **Single addressing by protocol rawSlot**: `0..size-1` the menu, `size..size+26` the main
  inventory, `size+27..size+35` the hotbar. A position `≥ size` only makes sense with
  `player_inventory: hidden`; with `visible` (default) it is ignored.
- **Nothing exists server-side**: neither the anchor nor the player's inventory is modified. Crash, death,
  disconnect with the menu open: nothing to lose or duplicate. `/data get entity @s Inventory` with the menu
  open = the real inventory.
- **Writing content = `MenuSlots.set`**, never `anchor.setItem`. With the menu open, the write goes to the
  client via the `ClientSlotSink`.
- **Closing**: the window is only released if it is the right anchor (opening B from A sets B then
  closes A), then `updateInventory()` on the next tick so the client redisplays the real inventory.
- **Deposit slots (`SlotKind.INPUT`)**: provided in the contract, not implemented. An `INPUT` slot
  is never rewritten — its real object would live in the anchor. The listener already tests the slot type.
- Without the menu packets (`NmsMenuPackets.resolve` failure, logged at SEVERE; the MockBukkit case in
  tests), menus open **empty**: clicks and sessions stay active. A packet that fails to rewrite goes
  out as the server sent it (logged once): a wrong menu, never a dropped connection.
- **Threads**: the handler runs on the player's Netty event loop (Folia and Leaf included), never on a game
  thread. Our own sends (`PacketSlotSink`) are written from the handler's context, on that event loop, so
  they skip the rewrite and keep their order with the server's packets.

## Transparent containers: global on the pack side, reinjected via the title

`vanilla_texture: false` cannot be local to one menu: the client draws the same texture for
**all** windows of a type — `generic_54.png` (chests, barrels, ender chests, 9×N menus),
`hopper.png` (hoppers), `dispenser.png` (dispensers **and** droppers). The pack (built by the editor,
`editor/src/lib/pack/vanillaGui.ts`) therefore replaces with a transparent texture that of each type that **one** menu
of a server project uses (chest / hopper / dropper, independently), and flags it
in `asset-index.json`: `vanilla_gui.transparent_chests|hoppers|dispensers`.

- **Every pack** bundles the `artisan:vanilla_gui` font: 6 glyphs `generic_9x1..6` cut
  like `ChestScreen` (top `0..17+18N`, bottom from y=126 over 96 px), `hopper` (176×133) and
  `dispenser` (176×166) = the full box; `ascent 13` (top at y=0), plus the realignment spaces
  (−8 towards x=0, then back to the title origin, computed on the real width). Codepoints: 1..6
  chest, 7 hopper, 8 dispenser.
- **The plugin reinjects** (`VanillaGuiTitle`, in `MenuPacketRewriter.onOpenWindow`): glyph
  prefix + original title intact. Chests are recognized by their protocol type `generic_9x1..6`
  (ids 0..5, stable); hoppers and dispensers/droppers by the Bukkit type of the inventory that
  just opened (`OpenedContainers`, `InventoryOpenEvent` right before the packet), their protocol ids
  moving from one version to the next. For a player only if `PackLoadTracker` saw them
  load the Artisan pack (delegated, it is merged into a host plugin's: any
  `SUCCESSFULLY_LOADED` counts; sent directly, only the id Artisan sent) **and** if the current catalog
  makes this type transparent. Otherwise the glyph would show as a missing character. An Artisan menu
  with `vanilla_texture: false` is not decorated.
- **Accepted transients**: between a publication and the reload of the new pack, a player may
  see the texture doubled (invisible: it is the same image) or, if transparency has just been
  removed, a transparent container until they receive the next pack.
- **Glyph source**: the vanilla texture (editor copy), or the `project:image` image that the server's
  `config.yml` names in `resource-pack.container-textures.{chest,hopper,dispenser}`
  (vanilla format, 256×256 or an HD multiple: cut at its scale, drawn at vanilla size;
  ADR `server-config-from-editor`). A missing image or one of the wrong format is ignored. This is how a **server** pack that restyles these
  containers keeps its look.
- Another server pack that also replaces these textures (Nexo, Oraxen, ItemsAdder): the last one loaded
  wins. A player-side **custom** pack is overridden (server packs sit on top) and its
  containers go back to those of the source above — a limit of the global approach, only a targeted
  shader would avoid it.

## Custom items — inline hash

`CustomItemsManager.buildBundle()` computes the hash **inline** from the items / textures already
collected (does not call `computeHash()` separately) to guarantee hash ↔ data consistency.
