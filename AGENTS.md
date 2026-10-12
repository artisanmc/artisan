# Artisan — Instructions Codex

## Règles de mise à jour des docs

Quand tu modifies du code, tu dois aussi mettre à jour les docs correspondants :

| Tu touches | Tu mets à jour |
|---|---|
| Protocole WS (`hub.ts`, `protocol.ts`, `WsClient.kt`) | `docs/architecture/ws-protocol.md` |
| Endpoints REST (`backend/src/routes/*.ts`) | `docs/architecture/rest-endpoints.md` (index — pointe vers le fichier de route) |
| Schéma DB (`backend/src/db/schema.ts`) | migration dans `backend/drizzle/` (`db:generate`) + `docs/architecture/entities.md` |
| Schéma (`docs/schema/*/v1/schema.json`) | aligner les types à la main (éditeur `types.ts` + plugin) + exemples/fixtures verts (`editor/src/schema/validateMenuV1`) + `docs/architecture/schemas-codegen.md` |
| Internals éditeur / rendu titre (title composer, canvas, édition d'élément, SchemaForm) | `docs/architecture/editor-internals.md` |
| Stack / dépendances | `docs/decisions/stack.md` + tableau "Pivots" si c'est un changement de choix |
| Termes du domaine (Pack, Menu, Element…) | `CONTEXT.md` |
| Commandes plugin (`ArtisanCommand.kt`) | Ce fichier, section Commandes + `docs-site/src/content/docs/getting-started/install-admin.md` (table commandes) |
| Variables d'environnement | `.env.example` + ce fichier |
| Config plugin (`config.yml`, defaults) | `docs-site/src/content/docs/getting-started/install-admin.md` (sections Config / Reference) |
| Resource pack distribution modes (`ResourcePackDelegator.kt`) | `docs-site/src/content/docs/getting-started/install-admin.md` (section Resource pack) + ce fichier |
| API publique modules (`net.artisanmc.modules.api.*`) | `docs/architecture/api-surface.md` + `CHANGELOG.md` `[Unreleased]` |
| UI éditeur visible user (nouveau bouton/flow user-facing) | `docs-site/src/content/docs/editor/<feature>.md` (créer si nécessaire) |
| Design system éditeur (`components/ui/*`, tokens/classes `globals.css`) | spécimen dans `/admin/design` (`features/design-system/DesignSystemPage.tsx`) + `docs/architecture/editor-internals.md` (section Design system) |

Ne pas mettre à jour = la prochaine session ne saura pas que le code a changé.

**Discipline same-commit vs `/sync-docs`** — Quand un commit touche du code marqué dans le tableau, la doc correspondante doit être mise à jour dans le même commit si l'update reste petit (changement ciblé d'une ou deux sections existantes, typiquement ≤30 lignes diff de doc). Si l'update doc dépasse ce volume ou nécessite des screenshots / refonte, invoquer le skill `/sync-docs` à la fin de la feature pour traiter la dette doc en un commit séparé. Ne jamais merger une PR avec dette doc non-listée. La source de vérité fine du mapping est `.Codex/skills/sync-docs/doc-impact-map.yaml` ; la table ci-dessus en est un résumé humain.

## Docs de référence

Ce fichier garde l'**opérationnel** (commandes, invariants, env vars) + l'**orientation**. Le détail vit dans `docs/architecture/` — à lire quand la tâche y touche :

| Doc | Contenu |
|---|---|
| `docs/architecture/rest-endpoints.md` | Index des routes REST (quel fichier ouvrir) + conventions + flux non-évidents. La source de vérité = `backend/src/routes/*.ts`. |
| `docs/architecture/ws-protocol.md` | Table des messages WS plugin ↔ backend + flux de données. |
| `docs/architecture/entities.md` | Modèle de données (Pack/Network/ServerKey/commits/branches/merge), auth, transferts, historique des phases. |
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
./gradlew shadowJar     # → paper/build/libs/artisan-plugin-1.0.0-SNAPSHOT-all.jar
./gradlew deploy        # compile + redémarre le container (JAR monté depuis build/libs/)
```

**Commandes plugin** — `/artisan` subcommands:
- `artisan member add <email>` — console/RCON only, requires `editor.access_mode: console`; grants an existing account member access to the server's entire Network, preserving existing roles. Default `invitation`; apply config changes with `/artisan reload`. Any console-enabled server selects the console access page for its Network; manual invitations remain available.
- `/artisan menu <packId> <menuId>` — open menu editor session
- `/artisan reload` — reload all packs from disk
- `/artisan pushLocal <packId>` — push local pack changes to backend (for FTP scenario: admin edits YAML on disk → push before reconnecting, else backend overwrites on next sync)

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

> ⚠️ **TOUJOURS** `bun run test` — **JAMAIS** `bun test` direct. Le wrapper `scripts/test.ts` redirige `DATABASE_URL` vers `artisan_test` avant de lancer Bun. `bun test` direct bypasse le wrapper, et les `beforeEach(clearAll)` des tests vident alors la DB dev `artisan` (incident réel le 2026-06-01 — toutes les données dev wipées). Si tu vois `bun test src/...` dans un terminal d'agent, c'est un bug.

Sans arguments, le wrapper migre une fois puis lance chaque fichier dans un processus Bun neuf et vide les tables publiques de la base de test entre fichiers : les mocks de modules ne contaminent pas les fichiers suivants. Les arguments ciblés restent transmis ensemble tels quels. `TEST_DATABASE_NAME` accepte uniquement `artisan_test` ou `artisan_test_<suffixe>` (lettres minuscules, chiffres, underscores). Le runtime enfant est celui du wrapper ; le résumé affiche sa version, les résultats cumulés et les logs complets par processus.

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
```

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

- Plugin : `plugin/paper/src/main/kotlin/net/artisanmc/modules/{id}/` — implements `ArtisanModule`
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
   │ POST /api/v1/bundles/:packId    (bundlePublisher.ts)
   ▼
[Backend Bun/Hono]
   │ WS /ws/plugin                   (hub.ts)
   │ REST /api/v1/bundles, /api/v1/server-keys, ...
   ▼
[Plugin Kotlin]
   │ hello → hello_ack + bundle_available
   │ GET /api/v1/bundles/:packId     (BundleDownloader.kt)
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

**Hash byte-order sort + maison unique** — le hash de pack a **une seule implémentation par langage** : `BundleHasher` (plugin) et `hashUtils.computeBundleHash` (backend). Tous deux hashent une map **relPath-keyed** triée par ordre byte natif (`<`/`>` Kotlin/JS — jamais `localeCompare`/`compareToIgnoreCase`, sinon divergence plugin↔backend). Côté plugin, disque (`hash`), `local_push` (`hashCanonical`) et upload passent **tous** par `BundleHasher` — pas de second SHA-256 ad-hoc (un hash dupliqué dans `LocalPushSender` avait silencieusement divergé en keyant sur le chemin complet ; corrigé 2026-06-17). L'égalité cross-langage est verrouillée par le vecteur partagé `testdata/pack-hash-conformance.json`, asservi par `BundleHashConformanceTest` (plugin) **et** `hashUtils.test.ts` (backend) — changer l'algo = mettre à jour les deux + régénérer le vecteur.

**Sentinel `""`** — chaîne vide = "jamais synchronisé / pas de contenu" dans tous les contextes hash. `BundleHasher.hash()` renvoie `""` pour un répertoire vide. `SyncMetadata.syncedHash` est `""` par défaut.

**`BUNDLE_BASE_URL` vs `API_BASE_URL`** — en Docker, le plugin (container `minecraft`) accède au backend via `http://backend:3001`, mais le browser accède via `http://localhost:3001`. Les deux env vars sont distinctes. Par défaut `BUNDLE_BASE_URL` = `API_BASE_URL` (hors Docker, c'est identique).

**OkHttp thread** — `SyncedMenuProvider.handleMessage` est appelé sur le thread WS callback d'OkHttp. Le download de bundle est dispatché sur `httpClient.dispatcher.executorService`. Ne jamais faire de I/O bloquant dans le callback WS directement.

**Reload atomique** — `reloadFromDisk()` construit un nouveau `ConcurrentHashMap` entier, puis l'assigne à `@Volatile var menus`. Ne jamais modifier le map en place.

**Conflit = freeze** — tant que `pack_conflicts.resolved_at IS NULL` côté backend, aucun `bundle_available` n'est broadcast pour ce `(server_id, pack_id)`. Implémenté dans `pushBundleAvailable` (hub.ts) qui consulte la table en début de fonction. Empêche tout écrasement silencieux pendant qu'une décision est en attente.

**Auto-resolution sur DELETE pack** — `DELETE /api/editor-session/:token/packs/:packId` marque tout conflit ouvert pour ce pack comme `resolution: "editor"` et envoie `pack_deleted` au plugin (qui move-to-trash). L'éditeur devient implicitement autoritaire.

**`.artisan-trash/` is sacred** — répertoire au top de `packsDir` créé par `PackDeleter`. Exclu du hash (filtre `.` au top-level dans `BundleHasher.hashAll`) et du sweep de `BundleDownloader` (filtre `.artisan*` sur les filenames). Ne jamais utiliser ce nom pour autre chose.

**Suppressions propagées** — `BundleDownloader.download` walk le packDir après écriture et supprime les fichiers locaux absents du bundle (filtre `.artisan*` préservé). Le sweep résout le bug historique où supprimer un menu dans l'éditeur ne le retirait pas du disque serveur.

**Custom items hash inline** — `CustomItemsManager.buildBundle()` calcule le hash en inline à partir des items/textures déjà collectés (ne rappelle pas `computeHash()` séparément) pour garantir la cohérence hash ↔ data.

---

## Structure des packs sur disque

```
plugins/Artisan/packs/
  <pack_id>/
    manifest.yaml
    menus/<menu_id>.yaml
    dialogs/<dialog_id>.yaml
    lang/<lang>.yaml
    .artisan-sync.yaml   ← SyncMetadata (syncedHash, backendHash, syncedAt)
```

`.artisan-sync.yaml` est exclu du hash (préfixe `.artisan` filtré dans `BundleHasher`).

Le champ `title` d'un menu est un `MenuTitleLayer[]` (background / glyph / text / textarea / external_glyph) — format YAML + pipeline de rendu pixel-perfect (pixel offsets, fonts custom) documentés dans `docs/architecture/editor-internals.md`.

---

## Variables d'environnement (backend)

| Variable | Défaut | Usage |
|---|---|---|
| `PORT` | `3001` | Port HTTP/WS du backend |
| `DEMO_TTL_HOURS` | `24` | Inactivité effective invitée ; lectures/retries ne prolongent pas le délai. |
| `DEMO_MINECRAFT_VERSION` | `1.21.4` | Version des nouvelles démos ; catalogue exact installé requis, validé avant création. Les sessions existantes conservent leur version. |
| `DEMO_MAX_BYTES` / `DEMO_MAX_FILES` | `20971520` / `1000` | Quota physique par démo, staging/métadonnées/brouillons/historique compris. |
| `DEMO_GLOBAL_MAX_BYTES` / `DEMO_MAX_SESSIONS` | `536870912` / `1000` | Budget partagé et nombre maximal de sessions actives/protégées. |
| `DEMO_CREATIONS_PER_HOUR` / `DEMO_MUTATIONS_PER_MINUTE` | `5` / `60` | Créations par client haché et modifications effectives par session, partagées entre workers. |
| `PG_DUMP_BIN` | `pg_dump` | Exécutable PostgreSQL utilisé uniquement par `backend/scripts/backup-hosted.ts` ; alternative locale `--docker <container>`. |
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5432/artisan` | URL de connexion PostgreSQL |
| `API_BASE_URL` | `http://localhost:3001` | URL publique du backend (envoyée dans `hello_ack.api_url`) |
| `EDITOR_URL` | `http://localhost:5173` | Origine éditeur : retours OAuth, invitations et CORS API. Production : `https://editor.artisanmc.net`. |
| `MARKETING_URL` | (vide) | Seconde origine CORS pour la vitrine publique. Production : `https://artisanmc.net`. |
| `BUNDLE_BASE_URL` | `= API_BASE_URL` | URL utilisée dans `bundle_available.url` (**plugin → download du bundle menus**, donc côté réseau Docker = `http://backend:3001`) |
| `RESOURCE_PACK_BASE_URL` | `= API_BASE_URL` | URL utilisée dans les URLs de resource pack envoyées au joueur via `setResourcePack` (**doit être joignable depuis la machine du joueur**, pas le réseau Docker). Override en prod avec l'URL publique. |
| `DISCORD_CLIENT_ID` | (vide) | OAuth Discord — laisser vide désactive le bouton "Continue with Discord" |
| `GOOGLE_CLIENT_ID` | (vide) | Client OAuth Google de type Web application ; bouton affiché seulement si les trois valeurs Google sont renseignées |
| `GOOGLE_CLIENT_SECRET` | (vide) | Secret OAuth Google, utilisé côté backend uniquement |
| `GOOGLE_REDIRECT_URI` | (requis ; défaut Compose : `http://localhost:3001/api/v1/auth/google/callback`) | Callback exact enregistré dans Google Cloud Console |
| `DISCORD_CLIENT_SECRET` | (vide) | OAuth Discord |
| `DISCORD_REDIRECT_URI` | (requis ; défaut Compose : `http://localhost:3001/api/v1/auth/discord/callback`) | URI de callback configurée dans le Discord Developer Portal |
| `ADMIN_BOOTSTRAP_EMAILS` | (vide) | CSV d'emails promus super-admin (`users.is_admin=true`) à leur prochaine requête authentifiée. Écriture une seule fois (guard `!isAdmin`), couvre login/signup/Discord. |
| `CONFIG_ENC_KEY` | (vide) | Clé hex 32 bytes (64 chars) pour `secretBox` (AES-256-GCM) — chiffre les secrets stockés en DB (`app_settings`). Vide = stockage DB des secrets désactivé (fallback env). Générer : `openssl rand -hex 32`. |

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
| Backend (~47 fichiers) | `bun run test` | hub WS, bundles, server-keys, editor-session, auth (signup/login/Discord/session), networks + branches + commits + merge engine, custom items, resource pack (builder / font json / asset index / space offsets / storage), assets (PATCH height, duplicate), conflicts, pack import. |
| Plugin (~45 fichiers) | `./gradlew test` | bundle hash/download, conflict detection, full-sync intégration (MockWebServer), action parse/exec (incl. `show_title`), title parser/compiler + offset encoder, asset catalog, resource pack manager/delegator, config, pack deleter, local push. |
| Éditeur (≥120 fichiers) | `npm test` | expr DSL (lexer/parser/eval/template), canvas + édition d'élément, export (transform/validate/zip), i18n, custom items & assets Library, title composer v3, merge/conflits, auth UI, networks/setup/account routes. |
| E2E éditeur | `npx playwright test` | `smoke.spec.ts` — canvas charge, sidebar visible (1 test). |

> ⚠️ **`bun run test` — JAMAIS `bun test` direct** (le wrapper redirige vers `artisan_test` ; le direct wipe la DB dev — cf. section Commandes Backend).

E2E cross-stack (editor → backend → plugin en bout en bout) : **non automatisé**, test manuel via Docker.
