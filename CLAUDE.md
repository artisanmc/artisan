# Artisan — Instructions Claude

## Règles de mise à jour des docs

Quand tu modifies du code, tu dois aussi mettre à jour les docs correspondants :

| Tu touches | Tu mets à jour |
|---|---|
| Protocole WS (`hub.ts`, `protocol.ts`, `WsClient.kt`) | `docs/architecture/ws-protocol.md` |
| Endpoints REST (`backend/src/routes/*.ts`) | `docs/architecture/rest-endpoints.md` (index — pointe vers le fichier de route) |
| Schéma DB (`backend/src/db/schema.ts`) | migration dans `backend/drizzle/` (`db:generate`) + `docs/architecture/entities.md` |
| Schéma (`docs/schema/*/v1/schema.json`) | aligner les types à la main (éditeur `types.ts` + plugin) + exemples/fixtures verts (`editor/src/schema/validateMenuV1`) + `docs/architecture/schemas-codegen.md` |
| Internals éditeur / rendu titre (title composer, canvas, édition de Document, SchemaForm) | `docs/architecture/editor-internals.md` |
| Stack / dépendances | `docs/decisions/stack.md` + tableau "Pivots" si c'est un changement de choix |
| Termes du domaine (Project, Menu, Document…) | `CONTEXT.md` |
| Commandes plugin (`ArtisanCommand.kt`) | Ce fichier, section Commandes + `docs-site/src/content/docs/getting-started/install-admin.md` (table commandes) |
| Variables d'environnement | `.env.example` + ce fichier |
| Config plugin (`config.yml`, defaults) | `docs-site/src/content/docs/getting-started/install-admin.md` (sections Config / Reference) |
| Resource pack distribution modes (`ResourcePackDelegator.kt`) | `docs-site/src/content/docs/getting-started/install-admin.md` (section Resource pack) + ce fichier |
| API publique modules (`net.artisanmc.modules.api.*`) | `docs/architecture/api-surface.md` + `CHANGELOG.md` `[Unreleased]` |
| UI éditeur visible user (nouveau bouton/flow user-facing) | `docs-site/src/content/docs/editor/<feature>.md` (créer si nécessaire) |
| Design system éditeur (`components/ui/*`, tokens/classes `globals.css`) | spécimen dans `/admin/design` (`features/design-system/DesignSystemPage.tsx`) + `docs/architecture/editor-internals.md` (section Design system) |

Ne pas mettre à jour = la prochaine session ne saura pas que le code a changé.

**Discipline same-commit vs `/sync-docs`** — Quand un commit touche du code marqué dans le tableau, la doc correspondante doit être mise à jour dans le même commit si l'update reste petit (changement ciblé d'une ou deux sections existantes, typiquement ≤30 lignes diff de doc). Si l'update doc dépasse ce volume ou nécessite des screenshots / refonte, invoquer le skill `/sync-docs` à la fin de la feature pour traiter la dette doc en un commit séparé. Ne jamais merger une PR avec dette doc non-listée. La source de vérité fine du mapping est `.claude/skills/sync-docs/doc-impact-map.yaml` ; la table ci-dessus en est un résumé humain.

## Docs de référence

Ce fichier garde l'**opérationnel** (commandes, invariants, env vars) + l'**orientation**. Le détail vit dans `docs/architecture/` — à lire quand la tâche y touche :

| Doc | Contenu |
|---|---|
| `docs/architecture/rest-endpoints.md` | Index des routes REST (quel fichier ouvrir) + conventions + flux non-évidents. La source de vérité = `backend/src/routes/*.ts`. |
| `docs/architecture/ws-protocol.md` | Table des messages WS plugin ↔ backend + flux de données. |
| `docs/architecture/entities.md` | Modèle de données (Project/Network/ServerKey/commits/branches/merge), auth, transferts, historique des phases. |
| `docs/architecture/editor-internals.md` | Title composer (YAML, pixel offsets, fonts), édition d'élément (onglet Edit / FlowCanvas), canvas layout, `<SchemaForm>`, UI shell. |
| `docs/architecture/modules.md` | Modular monolith — comment ajouter un module. |
| `docs/architecture/versioning.md` / `api-surface.md` | Disciplines de versioning + surface API publique stable. |
| `CONTEXT.md` | Glossaire domaine (source de vérité des termes). |

---

## Commandes

### Plugin (Kotlin 2.0 / Paper 1.21.4)

```bash
cd plugin
./gradlew test          # suite plugin (unit + intégration MockWebServer), ~45 fichiers
./gradlew shadowJar     # → build/libs/artisan-plugin-1.0.0-SNAPSHOT-all.jar
./gradlew deploy        # compile + redémarre le container (JAR monté depuis build/libs/)
```

**Commandes plugin** — `/artisan` subcommands:
- `/artisan menu <projectId> <menuId>` — open menu editor session
- `/artisan reload` — reload all projects from disk
- `/artisan pushLocal <projectId>` — **fallback manuel** : depuis P3b (files-first), les éditions disque sont détectées et auto-pushées automatiquement (scan disque périodique + check au `hello_ack`). Utile seulement pour forcer le côté disque lors d'une vraie divergence (les deux côtés ont bougé — le plugin ne pushe pas seul dans ce cas).
- `/artisan editor` — **purement informatif**, accounts-only (aucune session/trust en jeu). Linké + connecté → imprime le deep-link `server_url` + le nom du network (`hello_ack`). Linké mais pas encore connecté → « connecting, retry shortly ». Pas linké → imprime l'URL home de l'éditeur (dérivée de `ws_url`) pour aller créer le serveur.
- `/artisan link <code>` — **editor-first linking** (cf. ADR `editor-first-server-linking`). Le code est minté par l'éditeur quand on ajoute un serveur ; la commande le redeem via `POST /api/v1/link/:code/redeem` (dérive la base HTTP de `ws_url`), écrit le `server_key` dans `config.yml` (`ConfigWriter.writeServerKey`), reinit + connecte. Sur un serveur **déjà lié** → **écrase** la clé (rotation / bascule), WARN log, pas de refus. `/artisan setup` (+ `SetupClient` WS pairing) a été supprimé le 2026-07-15.

### Backend (Bun + Hono + PostgreSQL)

```bash
cd backend
bun install
bun run db:push         # Applique le schéma Drizzle sur PostgreSQL (DATABASE_URL requis) — dev/test only
bun run db:generate     # Génère un fichier de migration dans drizzle/ depuis schema.ts (à committer)
bun run db:migrate      # Applique les fichiers drizzle/ en ordre — utilisé en prod et dans Docker compose
bun run dev             # Dev avec --watch sur port 3001
bun run test            # suite backend (~47 fichiers), isolés dans la DB `artisan_test` via `scripts/test.ts` (auto-create + migrate) — ne touche jamais ta DB dev `artisan`. Override admin URL via ADMIN_DATABASE_URL si Postgres n'est pas sur postgres/postgres@localhost:5432.
```

> ⚠️ **TOUJOURS** `bun run test` — **JAMAIS** `bun test` direct. Le wrapper `scripts/test.ts` redirige `DATABASE_URL` vers `artisan_test` avant de spawner vitest. `bun test` direct bypasse le wrapper, et les `beforeEach(clearAll)` des tests vident alors la DB dev `artisan` (incident réel le 2026-06-01 — toutes les données dev wipées). Si tu vois `bun test src/...` dans un terminal d'agent, c'est un bug.

**Workflow migrations** :
- `bun run db:push` — dev/test uniquement. Auto-sync `schema.ts` → DB. Pas de fichier migration produit.
- `bun run db:generate` — quand un changement de schéma est prêt à shipper. Génère `backend/drizzle/NNNN_<name>.sql`. **Commit le fichier**.
- `bun run db:migrate` — applique les fichiers de migrations en ordre (idempotent). Utilisé en prod et dans Docker compose (le backend tourne `db:migrate` au boot, plus `db:push`).

Règle : tout merge dans `main` qui modifie `schema.ts` DOIT inclure la migration générée. Pas de push live de schema en prod.

```bash
# Générer les données items (à faire avant gen-icons.ts)
bun backend/scripts/gen-items.ts [version]    # télécharge assets MC + génère items.json avec champs model

# Pre-render les icônes 3D server-side (Playwright + Three.js, nécessite gen-items.ts d'abord)
bun backend/scripts/gen-icons.ts [version]    # rend 750 PNGs → data/mc-assets/{version}/textures/icons/
                                               # puis met à jour items.json (remplace model par texture icons/{id})
# Note : utilise Node.js en sous-processus pour Playwright (workaround Bun+Windows pipe IPC)

# Empaqueter les artefacts non-régénérables côté serveur (icônes + items.json post-rendu)
bun backend/scripts/pack-icons.ts [version...]  # → backend/assets-seed/icons-<version>.zip (À COMMITTER)
```

**Assets et prod** — `backend/data/` est un **volume** en prod, exclu de l'image. Les textures vanilla se retéléchargent seules depuis Mojang (`ensureAssets`), mais les icônes 3D ne se régénèrent **jamais** côté serveur : `gen-icons.ts` consomme le champ `model` d'`items/<version>.json` et le remplace par la texture rendue, donc un run en prod ne verrait plus rien à faire. Elles voyagent dans l'image via `backend/assets-seed/*.zip`, déposées dans le volume au boot par `lib/assetSeed.ts` (jamais d'écrasement : le volume est la vérité). Nouvelle version MC = `gen-items` → `gen-icons` → `pack-icons` → committer l'archive.

### Editor (React 19 + Vite 6)

```bash
cd editor
npm install
npm run dev             # Vite dev server sur port 5173
npm test                # suite éditeur (≥126 fichiers)
npm run build           # Build production
```

### Stack complète (Docker)

```bash
cp .env.example .env    # puis renseigner ARTISAN_SERVER_KEY
docker compose up       # backend:3001 + editor:5173 + minecraft:25565
```

---

## Architecture

```
editor/          React 19 + Vite + Konva
backend/         Bun + Hono + PostgreSQL (Drizzle)
plugin/          Kotlin 2.0 + Paper 1.21.4 + OkHttp
docker/          Config serveur Minecraft (itzg/minecraft-server, Paper géré par l'image)
docker-compose.yml
docs-site/       Astro Starlight — public user docs (EN)
docs/
  architecture/          ← modules, versioning, api-surface, ws-protocol, rest-endpoints, entities, editor-internals
  decisions/             ← ADRs (stack, state model)
  specs/                 ← specs produit et éditeur (web-editor.md, main-spec.md)
  schema/                ← JSON schemas menu/pack/command/dialog/translations
  superpowers/specs/     ← design docs data-sources, expression DSL
  superpowers/plans/     ← plans actifs (archive/ = plans complétés)
CONTEXT.md               ← glossaire domaine (source de vérité pour les termes)
```

### Pattern modulaire (depuis 2026-05-25)

Artisan suit le pattern **modular monolith** spécifié dans `docs/architecture/modules.md`. Chaque module vit en 3 layers symétriques :

- Plugin : `plugin/src/main/kotlin/net/artisanmc/modules/{id}/` — implements `ArtisanModule`
- Backend : `backend/src/modules/{id}/` — exports `BackendModule`
- Éditeur : `editor/src/modules/{id}/` — exports `FrontendModule`

Communication cross-module via deux registries plugin-side : `DataSourceRegistry` (`namespace:source_id`) et `CommandRegistry` (`namespace:command`). Aucune dépendance directe entre modules. Hot-reload propagé via `ModuleEventBus` (plugin) + WS `module_event` → `editor/src/modules/api/eventBus.ts`.

V1 modules : `menus`, `commands`. V1.5+ : `shop`. Le code menus/commands existant reste dans `net.artisanmc.plugin.engine` / `command` ; les classes `MenusModule` / `CommandsModule` sont des wrappers fins. Move physique différé jusqu'au 3ᵉ module (voir `docs/architecture/modules.md` §13).

**Règle d'import modules** : un `ArtisanModule` n'importe **que** depuis `net.artisanmc.modules.api.*` (annoté `@Stable`/`@Beta`/`@Internal`/`@Sunset` — cf. `api-surface.md`). Jamais depuis `net.artisanmc.plugin.*` (implicitement `@Internal`).

**Quand ajouter un module** (détail dans `docs/architecture/modules.md`) :
1. Spec dans `modules.md` (section "Module {id}")
2. Plugin : classe sous `net.artisanmc.modules.{id}/` impl `ArtisanModule`, register dans `ArtisanPlugin.defaultModules()`
3. Backend : `modules/{id}/index.ts` exporte un `BackendModule`, register dans `app.ts` (`mountModules`)
4. Éditeur : `editor/src/modules/{id}/index.ts` exporte `FrontendModule`, `registerModule(...)` dans `main.tsx`
5. Schema JSON dans `modules/{id}/schemas/` si form-based — utiliser `<SchemaForm>` (cf. `editor-internals.md`)

### Versioning — les 4 disciplines (depuis 2026-05-25)

Cible : `docs/architecture/versioning.md`. Surface stable : `docs/architecture/api-surface.md`.

1. **CHANGELOG** : tout commit qui touche `net.artisanmc.modules.api.*` ou un endpoint REST ajoute une entrée dans `[Unreleased]` de `CHANGELOG.md`.
2. **Nouveau schema version = nouveau dossier** : on ne modifie jamais un `menu/v1` après ship. On crée `menu/v2` séparé + `MenuV1ToV2 : SchemaMigration` register via `api.schemas.register(...)`.
3. **DB forward-only** : tout changement de `schema.ts` génère via `bun run db:generate` un fichier `backend/drizzle/` committé. Pas de `db:push` en prod (Docker tourne `db:migrate`).
4. **REST URL versionné** : tout endpoint sous `/api/v1/`. Breaking change inévitable → `/api/v2/<name>` à côté, garder v1 6-12 mois.

### Flux de données

```
[Editor browser]
   │ WS ws://backend:3001/ws/plugin  (pluginBridge.ts)
   │ POST /api/v1/bundles/:projectId (bundlePublisher.ts)
   ▼
[Backend Bun/Hono]
   │ WS /ws/plugin                   (hub.ts)
   │ REST /api/v1/bundles, /api/v1/server-keys, ...
   ▼
[Plugin Kotlin]
   │ hello → hello_ack + bundle_available
   │ GET /api/v1/bundles/:projectId  (BundleDownloader.kt)
   └ écrit sur disque → hot-reload menus
```

Détail des messages WS : `docs/architecture/ws-protocol.md`. `hello` porte `protocol_version: "1"` + `core_version` ; les types inconnus sont loggés + ignorés (forward-compat).

---

## Design system éditeur — règle de dev

Tout nouveau développement UI dans `editor/` passe **en priorité** par le design system (visualisable sur `/admin/design`, admin requis) :

1. Composants `editor/src/components/ui/` (Button, Input, FormField, Badge, EmptyState, Card, Dialog, Sheet, Tabs, DropdownMenu) ou classes utilitaires de `globals.css` (`.btn*`, `.input`, `.card`, `.chip`, `.badge*`, `.tab`, `.eyebrow`, `.field-label`…) d'abord.
2. Composant manquant → le créer dans `components/ui/` + ajouter son spécimen à `/admin/design` dans le même commit. Pas de styling ad-hoc dupliqué.
3. Couleurs uniquement via `var(--token)` (couche sémantique de `globals.css`) — jamais de hex/rgba en dur. Exception : canvas Konva (non thémable CSS).

Détail des couches de tokens : `docs/architecture/editor-internals.md` (section Design system).

## Invariants critiques

**Hash byte-order sort + maison unique** — le hash de project a **une seule implémentation par langage** : `BundleHasher` (plugin) et `hashUtils.computeBundleHash` (backend). Tous deux hashent une map **relPath-keyed** triée par ordre byte natif (`<`/`>` Kotlin/JS — jamais `localeCompare`/`compareToIgnoreCase`, sinon divergence plugin↔backend). **Exclusion `.artisan*` universelle (2026-07-23)** : tout relPath dont le **premier segment** commence par `.artisan` (`.artisan-sync.yaml`, `.artisan/editor.yaml`) est une métadonnée **hors hash des deux côtés** et **jamais uploadée** par le plugin (`ProjectFilesReader`) ; le backend **préserve** ses copies `.artisan/*` aux deux points d'ingestion (`local_push` hub.ts + `POST /bundles`). Verrouillé par le vecteur de conformance (entrées `.artisan*` présentes, expectedHash inchangé). Côté plugin, disque (`hash`), `local_push` (`hashCanonical`) et upload passent **tous** par `BundleHasher` — pas de second SHA-256 ad-hoc (un hash dupliqué dans `LocalPushSender` avait silencieusement divergé en keyant sur le chemin complet ; corrigé 2026-06-17). L'égalité cross-langage est verrouillée par le vecteur partagé `testdata/project-hash-conformance.json`, asservi par `BundleHashConformanceTest` (plugin) **et** `hashUtils.test.ts` (backend) — changer l'algo = mettre à jour les deux + régénérer le vecteur.

**Sentinel `""`** — chaîne vide = "jamais synchronisé / pas de contenu" dans tous les contextes hash. `BundleHasher.hash()` (plugin), `hashUtils.computeBundleHash` **et** `commitStorage.computeContentHash` (backend) renvoient `""` pour un contenu vide. **`computeContentHash` = même hash canonique (2026-07-26)** : le contentHash d'un commit strippe le préfixe `plugins/Artisan/projects/<id>/` et exclut `.artisan*` — il keyait avant sur les chemins complets avec `.artisan*` inclus, donc `hello_ack.project_hashes` ne matchait JAMAIS le hash disque du plugin (`detectSyncAction` ne voyait jamais IN_SYNC/LOCAL_ONLY → l'auto-push P3b était mort en prod ; le `hello_ack` recalcule canoniquement depuis le filesJson du head pour self-heal les commits legacy) — un commit initial vide hashe donc `""`, ce qui rend la branche auto-push du plugin (`backendHash.isEmpty()` → `local_push`) atteignable pour un stub fraîchement créé au lieu de la traiter comme un conflit. `SyncMetadata.syncedHash` est `""` par défaut.

**`BUNDLE_BASE_URL` vs `API_BASE_URL`** — en Docker, le plugin (container `minecraft`) accède au backend via `http://backend:3001`, mais le browser accède via `http://localhost:3001`. Les deux env vars sont distinctes. Par défaut `BUNDLE_BASE_URL` = `API_BASE_URL` (hors Docker, c'est identique).

**OkHttp thread** — `SyncedMenuProvider.handleMessage` est appelé sur le thread WS callback d'OkHttp. Le download de bundle est dispatché sur `httpClient.dispatcher.executorService`. Ne jamais faire de I/O bloquant dans le callback WS directement.

**Reload atomique** — `reloadFromDisk()` construit un nouveau `ConcurrentHashMap` entier, puis l'assigne à `@Volatile var menus`. Ne jamais modifier le map en place.

**Scan disque + auto-push (P3b 2026-07-24, poll-first depuis 2026-07-30)** — `SyncScanner` (tick périodique par project root, `scanIntervalMs` = 3 s, toujours actif y compris offline) : une édition disque hot-reload localement puis auto-pushe (`local_push`) si `detectSyncAction` = LOCAL_ONLY ; CONFLICT (les deux côtés ont bougé) = hot-reload SANS push, un WARN (résolution = P3c). Même logique au `hello_ack` (plus d'écrasement backend silencieux — le WARN « backend will overwrite » est mort), et même gate dans le handler `bundle_available` lui-même (2026-07-26 : un download annoncé ne s'applique que si `detectSyncAction` = IN_SYNC/AUTO_SYNC ; LOCAL_ONLY → push, CONFLICT → `sync_divergence` ; seul `force: true` — émis par `resolve-divergence` — bypasse). **Divergence vraie (P3c)** : CONFLICT → le plugin émet `sync_divergence` (arbre disque complet, ré-émis à chaque `hello_ack` tant que non résolu) ; le backend le garde **en mémoire** (`pendingDivergences` dans hub.ts — perdu au restart = self-healing au prochain reconnect) ; l'éditeur affiche `DivergenceBanner` (choix disk/web par fichier, défaut disk) → `POST …/resolve-divergence` → merge (`lib/divergence.ts`) + commit + `bundle_available` + clear. Un `pushLocal` manuel clear aussi (force-disk).

**Détection = contenu, jamais événement** (spec `2026-07-30-poll-first-disk-sync-design`) — `SyncScanner` remplace l'ancien `ProjectWatcher` inotify, dont la correction dépendait d'événements OS jamais délivrés sur bind mount Docker / NFS / SMB, et dont la fenêtre de suppression perdait silencieusement une édition qui atterrissait pendant une écriture du plugin. Le tick fait : ① court-circuit `stat` (chemins/tailles/mtimes — signature inchangée depuis le dernier dispatch ⇒ rien n'est lu) ; ② quiescence sur 2 ticks consécutifs avant dispatch, donc un upload FTP en cours n'est jamais poussé à moitié (borné, contrairement à un debounce qui se replanifie indéfiniment) ; ③ deep tick tous les 10 ticks = vrai hash de contenu, filet pour les FS à granularité mtime grossière. **Plus de fenêtre de suppression** : une auto-écriture (download de bundle, move-to-trash) n'a rien à supprimer puisque `BundleDownloader` enregistre le hash qu'il vient d'écrire (`SyncMetadata.recordSync`) — le tick suivant résout IN_SYNC. « Est-ce moi qui ai écrit ça ? » est une question de contenu, pas de timing. La fenêtre d'écho entre un `local_push` et le `bundle_available` qui l'acquitte est fermée par `lastPushedHash` (en mémoire seulement, vidé au `hello_ack` et après download : un push perdu en vol est reposté, jamais oublié). `BundleDownloader` écrit toujours en atomique (`.artisan-tmp` + rename) et skippe les fichiers au contenu identique. Les chemins premier segment `.artisan*` sont invisibles au scan (miroir de l'exclusion hash). Le comportement est **identique en dev Docker et en prod Linux** — c'est le gain principal ; l'incident du 2026-07-25 (`module: boutique` ajouté à la main → aucun auto-push) ne peut plus se produire.

**Verrou optimiste (plus de freeze de conflit)** — la table `project_conflicts` n'existe plus (accounts-only cutover) : `pushBundleAvailable` (hub.ts) broadcast `bundle_available` sans condition dès qu'un commit est publié. La protection contre l'écrasement concurrent est le verrou optimiste sur `PUT /api/v1/user/projects/:projectId` (`baseVersion` requis, `409 version_conflict` + `currentVersion` sinon) — cf. `entities.md` § Concurrence optimiste.

**DELETE project = soft-delete** — `DELETE /api/v1/user/projects/:projectId` (cookie auth + membership) marque `deletedAt` (`softDeleteProject`, la ligne reste en DB) et broadcast `project_deleted` au plugin (qui move-to-trash) et aux autres connexions éditeur.

**`.artisan-trash/` is sacred** — répertoire au top de `projectsDir` créé par `ProjectDeleter`. Exclu du hash (filtre `.` au top-level dans `BundleHasher.hashAll`) et du sweep de `BundleDownloader` (filtre `.artisan*` sur les filenames). Ne jamais utiliser ce nom pour autre chose.

**Suppressions propagées** — `BundleDownloader.download` walk le projectDir après écriture et supprime les fichiers locaux absents du bundle (filtre `.artisan*` préservé). Le sweep résout le bug historique où supprimer un menu dans l'éditeur ne le retirait pas du disque serveur.

**Custom items hash inline** — `CustomItemsManager.buildBundle()` calcule le hash en inline à partir des items/textures déjà collectés (ne rappelle pas `computeHash()` séparément) pour garantir la cohérence hash ↔ data.

---

## Structure des projects sur disque

```
plugins/Artisan/projects/
  <project_id>/
    manifest.yaml
    menus/<menu_id>.yaml
    dialogs/<dialog_id>.yaml
    lang/<lang>.yaml               ← arborescence YAML : chaque `.` de la clé = un niveau (`menus:` → `<menu_id>:` → `elements:` → …)
    items/<captured_item_id>.yml   ← ItemStacks capturés (refs material `item:<id>`), YAML Bukkit verbatim
    data/<source_id>.yaml          ← Project sources (schema data/v1, refs `pack:<id>`) — Data models inlinés, valeurs ltext = clés i18n résolues au bind, valeurs item = refs material
    .artisan-sync.yaml   ← SyncMetadata (syncedHash, backendHash, syncedAt)
```

`.artisan-sync.yaml` est exclu du hash (préfixe `.artisan` filtré dans `BundleHasher`).

Les fichiers `lang/` sont des **arborescences**, le runtime adresse par clé pointée : le codec est `editor/src/lib/langTree.ts` (`nestLangTree` à l'écriture, seul writer) et son miroir de lecture `plugin/…/yaml/LangFlattener.kt`, verrouillés par le vecteur partagé `testdata/lang-tree-conformance.json`. Les trois readers (plugin, import éditeur, mutation module) acceptent arbre / plat legacy / mélange — rien à migrer. Une clé bloquée par une feuille (`a.b` et `a.b.c`) reste pointée à la racine plutôt que perdue.

Le champ `title` d'un menu est un `MenuTitleLayer[]` (background / glyph / text / textarea / external_glyph) — format YAML + pipeline de rendu pixel-perfect (pixel offsets, fonts custom) documentés dans `docs/architecture/editor-internals.md`.

---

## Variables d'environnement (backend)

| Variable | Défaut | Usage |
|---|---|---|
| `PORT` | `3001` | Port HTTP/WS du backend |
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5432/artisan` | URL de connexion PostgreSQL |
| `API_BASE_URL` | `http://localhost:3001` | URL publique du backend (envoyée dans `hello_ack.api_url`) |
| `BUNDLE_BASE_URL` | `= API_BASE_URL` | URL utilisée dans `bundle_available.url` (**plugin → download du bundle menus**, donc côté réseau Docker = `http://backend:3001`) |
| `RESOURCE_PACK_BASE_URL` | `= API_BASE_URL` | URL utilisée dans les URLs de resource pack envoyées au joueur via `setResourcePack` (**doit être joignable depuis la machine du joueur**, pas le réseau Docker). Override en prod avec l'URL publique. |
| `EDITOR_URL` | `http://localhost:5173` | Origin browser-facing de l'éditeur — utilisée pour `cors({ origin })` sur `/api/v1/*` **et** pour construire `hello_ack.server_url`/`editor_url`. Override en prod avec l'URL publique de l'éditeur (ex. `https://artisanmc.net`). |
| `DISCORD_CLIENT_ID` | (vide) | OAuth Discord — laisser vide désactive le bouton "Continue with Discord" |
| `DISCORD_CLIENT_SECRET` | (vide) | OAuth Discord |
| `DISCORD_REDIRECT_URI` | `http://localhost:3001/api/auth/discord/callback` | URI de callback configurée dans la Discord Developer Portal |
| `ADMIN_BOOTSTRAP_EMAILS` | (vide) | CSV d'emails promus super-admin (`users.is_admin=true`) à leur prochaine requête authentifiée. Écriture une seule fois (guard `!isAdmin`), couvre login/signup/Discord. |
| `CONFIG_ENC_KEY` | (vide) | Clé hex 32 bytes (64 chars) pour `secretBox` (AES-256-GCM) — chiffre les secrets stockés en DB (`app_settings`). Vide = stockage DB des secrets désactivé (fallback env). Générer : `openssl rand -hex 32`. |
| `STRIPE_SECRET_KEY` | (vide) | Clé secrète Stripe (sub-projet B). Lue par la gateway réelle ; les tests injectent une fake. Vide en dev/test. |
| `STRIPE_WEBHOOK_SECRET` | (vide) | Secret de vérification signature webhook Stripe (sub-projet B2). |
| `BILLING_GRACE_DAYS` | `7` | Jours de grâce après un échec de paiement d'abonnement (`invoice.payment_failed`) avant suspension (`status=past_due` + `grace_until`). Lu au moment du webhook. |
| `SMTP_HOST` | (vide) | Hôte SMTP pour l'envoi d'emails transactionnels (Scaleway TEM : `smtp.tem.scw.cloud`). Vide = `getMailer()` renvoie un mailer no-op (log WARN une seule fois). |
| `SMTP_PORT` | `587` | Port SMTP (Scaleway TEM : `587`). |
| `SMTP_USER` | (vide) | Identifiant SMTP. |
| `SMTP_PASS` | (vide) | Mot de passe / clé SMTP. |
| `MAIL_FROM` | (vide) | Adresse expéditeur (`From:`) des emails transactionnels. |

### Resource pack distribution modes

Switched by the plugin config `resource-pack.delegate-to-dir` — empty = legacy, suffix decides output shape:

| Mode | When | Behavior |
|---|---|---|
| Legacy (default) | `delegate-to-dir` empty | Plugin pushes its own RP via `addResourcePack` on join + on every update. Coexists with other RP plugins via the multi-pack stack (each pack has its own UUID). Two prompts at login when a host plugin also pushes. |
| Delegation (directory) | `delegate-to-dir: <path>` (no `.zip`) | Plugin extracts `assets/artisan/*` into `<path>/assets/artisan/` on every update. Skips player push. |
| Delegation (zip) | `delegate-to-dir: <path>.zip` | Plugin writes a single `<path>.zip` containing `assets/artisan/*` + minimal `pack.mcmeta` (atomic via `.tmp` + rename). Use this with **Nexo's `pack/external_packs/`** — Nexo's directory scanner skips PNG files for non-vanilla namespaces, but its zip-merger pulls every entry. |

Both delegation modes own the `assets/artisan/` subtree only — entries outside that namespace (and the source pack.mcmeta) are skipped. Set `resource-pack.delegate-reload-command` (e.g. `n reload`, `oraxen reload pack`) to auto-dispatch the host's reload after each rebuild; otherwise admin reloads manually.

**Nexo recipe:** `delegate-to-dir: "plugins/Nexo/pack/external_packs/artisan.zip"` + `delegate-reload-command: "n reload"`.

---

## Tests — ce qui est couvert

Couverture par couche (zones, pas liste de fichiers — `glob **/*.test.*` donne la liste exacte et à jour) :

| Couche | Lancer | Zones couvertes |
|---|---|---|
| Backend (~47 fichiers) | `bun run test` | hub WS, bundles, server-keys, ws-ticket, auth (signup/login/Discord/session), networks + branches + commits + merge engine, custom items, resource pack (builder / font json / asset index / space offsets / storage), assets (PATCH height, duplicate), version-conflict guard, project import. |
| Plugin (~45 fichiers) | `./gradlew test` | bundle hash/download, conflict detection, full-sync intégration (MockWebServer), action parse/exec (incl. `show_title`), title parser/compiler + offset encoder, asset catalog, resource pack manager/delegator, config, project deleter, local push. |
| Éditeur (≥120 fichiers) | `npm test` | expr DSL (lexer/parser/eval/template), canvas + édition de Document, export (transform/validate/zip), i18n, custom items & assets Library, title composer v3, merge/conflits, auth UI, networks/setup/account routes. |
| E2E éditeur | `npx playwright test` | `smoke.spec.ts` — canvas charge, sidebar visible (1 test). |

> ⚠️ **`bun run test` — JAMAIS `bun test` direct** (le wrapper redirige vers `artisan_test` ; le direct wipe la DB dev — cf. section Commandes Backend).

E2E cross-stack (editor → backend → plugin en bout en bout) : **non automatisé**, test manuel via Docker.
