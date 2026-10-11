# Artisan Public API Surface (v1.x)

This document lists the **stable** API surface of Artisan Core that modules can safely depend on.
Anything not listed here is internal and may change without notice.

> Source of truth : the `@Stable` annotations in `plugin/src/main/kotlin/net/artisanmc/modules/api/`.
> This doc is hand-maintained; future versions will auto-generate it (see `versioning.md` §9.2).

## Annotations

| Annotation | Package | Meaning |
|---|---|---|
| `@Stable` | `net.artisanmc.modules.api.annotations.Stable` | Covered by SemVer. No breaking change within a major version. |
| `@Beta` | `net.artisanmc.modules.api.annotations.Beta` | Experimental. May change in minor versions. |
| `@Internal` | `net.artisanmc.modules.api.annotations.Internal` | DO NOT USE from modules. |
| `@Sunset(reason, removeInVersion, replacement)` | `net.artisanmc.modules.api.annotations.Sunset` | Scheduled for removal. Replacement is provided. |

Note : we use `@Sunset` (not `@Deprecated`) to avoid clashing with `kotlin.Deprecated`. The schedule-aware annotation carries removal version + replacement.

## Stable APIs (v1.x)

### `net.artisanmc.modules.api.ArtisanModule`

Contract implemented by every module.

| Member | Type | Since |
|---|---|---|
| `id` | `String` | 1.0.0 |
| `schemaVersion` | `String` | 1.0.0 |
| `onEnable(api: ArtisanAPI)` | `Unit` | 1.0.0 |
| `onDisable()` | `Unit` | 1.0.0 |
| `onReload()` | `Unit` (default empty) | 1.0.0 |

### `net.artisanmc.modules.api.ArtisanAPI`

The facade passed to every module at `onEnable(api)`. Also available to external plugins via Bukkit `ServicesManager`:

```kotlin
val api = server.servicesManager.getRegistration(ArtisanAPI::class.java)?.provider
    ?: error("Artisan not loaded")
```

| Member | Type | Since |
|---|---|---|
| `plugin` | `JavaPlugin` | 1.0.0 (widened from `ArtisanPlugin` in P1a) |
| `dataSources` | `DataSourceRegistry` | 1.0.0 |
| `commands` | `CommandRegistry` | 1.0.0 |
| `events` | `ModuleEventBus` | 1.0.0 |
| `schemas` | `SchemaRegistry<MutableMap<String, Any?>>` | 1.0.0 |
| `modules` | `ModuleRegistry` | 1.1.0 |
| `coreVersion` | `String` | 1.1.0 |
| `isCompatibleWith(minVersion: String)` | `Boolean` | 1.1.0 |
| `project` | `ProjectContentApi` | 1.2.0 |
| `projectRoots` | `ProjectRootRegistry` | 1.5.0 |

### `net.artisanmc.modules.api.ModuleRegistry`

Manages the set of active modules for a running Artisan instance.

| Member | Stability | Type | Description |
|---|---|---|---|
| `register(module: ArtisanModule)` | `@Stable` | `Unit` | Register a module. Throws `DuplicateModuleException` if the id is already registered. Triggers `modules_changed` WS message if the plugin is connected. |
| `active()` | `@Stable` | `List<ArtisanModule>` | Returns all currently registered modules. |
| `has(id: String)` | `@Stable` | `Boolean` | Returns true if a module with that id is registered. |
| `bind(api: ArtisanAPI, onChange: Runnable)` | `@Internal` | `Unit` | Used internally by the plugin to be notified on registry changes (triggers `modules_changed`). DO NOT USE from modules. |

Exceptions: `DuplicateModuleException`.

### `net.artisanmc.modules.api.DataSourceRegistry`

| Member | Type | Since |
|---|---|---|
| `register(decl: DataSourceDeclaration)` | `Unit` | 1.0.0 |
| `fetch(ref: String, player: Player?, params: Map<String, Any?>)` | `List<Map<String, Any?>>` | 1.0.0 |
| `has(ref: String)` | `Boolean` | 1.0.0 |
| `refs()` | `Set<String>` | 1.0.0 |
| `declarations()` | `List<DataSourceDeclaration>` | 1.2.0 |
| `registered()` | `List<RegisteredDataSource>` | 1.3.0 |

Exceptions: `UnknownDataSourceException`, `DuplicateDataSourceException`, `PlayerRequiredException`.

**Breaking change (1.3.0)**: `fetch` signature changed from `(player: Player, …)` to `(player: Player?, …)`. Preview mode (editor) calls fetchers with `player = null`; modules that require a real player must either return generic data or throw `PlayerRequiredException`.

### `net.artisanmc.modules.api.DataSourceDeclaration`

| Member | Type | Stability | Since |
|---|---|---|---|
| `ref` | `String` | `@Stable` | 1.0.0 |
| `fetcher` | `DataFetcher` | `@Stable` | 1.3.0 (type 1.5.0) |
| `schema` | `List<DataSourceField>` | `@Stable` | 1.3.0 |
| `stability` | `Stability` | `@Stable` | 1.4.0 |
| `keyField` | `String?` | `@Stable` | 1.4.0 |
| `schemaHint` | `String?` | `@Sunset` | 1.0.0 → 2.0.0 |

Constructing a `Stability.STATIC` declaration without a non-blank `keyField` throws (`require`) — a static source must declare its Row key.

### Aucun type Kotlin ne traverse la frontière (1.5.0)

Une lambda Kotlin se compile en `kotlin.jvm.functions.FunctionN`, et une fonction
Kotlin sans valeur de retour en `kotlin.Unit`. Tant que ces types apparaissaient
dans les signatures publiques, un add-on devait résoudre `kotlin.*` — et comme il
ne l'embarque pas, son classloader allait le chercher chez **les autres plugins**
du serveur. Le 2026-08-08, ça a donné un `LinkageError` fatal : le loader de
Boutique récupérait le `Function2` d'un autre plugin Kotlin, celui d'Artisan
définissait le sien, contrainte de loader violée au premier appel inter-plugins.

La surface n'expose donc plus que des types Java :

| Rappel | Type | Remplace |
|---|---|---|
| `DataFetcher` | `fetch(Player?, Map): List<Map>` | `(Player?, Map) -> List<Map>` |
| `CommandHandler` | `handle(Player, Map)` | `(Player, Map) -> Unit` |
| `ModuleEventHandler` | `onEvent(ModuleEvent)` | `(ModuleEvent) -> Unit` |
| `SchemaVersionReader<T>` | `versionOf(T): String` | `(T) -> String` |
| `ModuleRegistry.bind` | `Runnable` | `() -> Unit` |

Ce sont des `fun interface` : côté Kotlin comme côté Java, on passe toujours une
lambda. `FieldKind` et `Stability` sont déclarés **en Java** — un enum Kotlin
expose un `getEntries()` typé `kotlin.enums.EnumEntries`.

L'implémentation, elle, reste en Kotlin : seule la frontière est contrainte, et
`ApiSurfaceIsJavaFriendlyTest` échoue si un type `kotlin.*` y réapparaît.

**Ce que ça ne fait pas** : le JAR du plugin embarque toujours la kotlin-stdlib
sous ses noms d'origine. Elle ne peut pas être relocalisée — `kotlin-reflect`
(tiré par `jackson-module-kotlin`, qui lit les data classes YAML) résout ses
built-ins par nom de chaîne et ne survit pas au renommage. Artisan reste donc un
fournisseur possible de `kotlin.*` pour un plugin tiers qui en chercherait ; ce
qui est corrigé, c'est qu'aucun add-on Artisan n'a plus de raison d'en chercher.

### `net.artisanmc.modules.api.ItemStackApi` (`@Beta`)

Captured-item helpers for modules (`api.items`): `serialize(stack)` — canonical wrapped YAML (what the backend stores under `items/<id>.yml`) — and `describe(stack)` — the generic display descriptor (material enriched to a recognized custom ref, head_texture, enchanted, count, name). Since 1.4.0.

### `net.artisanmc.modules.api.ModuleMessagesApi` (`@Beta`)

Fire-and-forget module messages over the plugin ↔ backend WS (`api.messages.send(type, payload)`) — routed backend-side by `type` to the module's backend layer. No-op while disconnected. Since 1.4.0. ⚠️ **Ne pas s'en servir pour muter un project** : le contenu vit sur le disque et le module y écrit lui-même (ADR `server-disk-only-storage`). `boutique_additem` en fut l'exemple, et ne l'est plus.

### `net.artisanmc.modules.api.ModuleActionsApi` (`@Beta`)

`api.actions.execute(player, steps, args, projectId?)` — runs a canonical step tree (the wire shape of the editor's `actions` field kit widget: `[{kind: "action", action: {...}}, {kind: "if", ...}]`, literal text) through the core `StepParser`/`ActionExecutor`. Main-thread (dispatched if needed); `args` become `{name}` placeholder bindings (`player` is implicit); malformed steps are skipped with a WARN. Used by the boutique to run an item's purchase actions after payment. `projectId` (since 1.6.0, optional) puts that Project's `lang/` in scope so an action may carry `@key` (ADR `yaml-assisted-editing` ④); without it, action text stays literal. Since 1.4.0.

### `net.artisanmc.modules.api.ModelRegistry` (`@Beta`)

`api.models.declare(document)` — declares a Data model as a `model/v1` document (a plain `Map`, verbatim: `schema`, namespaced `id` (`ns:model`), `name`, `key_field`, `fields`, optional monotonic `version` + declarative `migrations`). Pure passthrough: nothing is interpreted plugin-side — the documents are reported at Presence (`hello.declared_models` / `modules_changed`) and consumed by the editor, which renders the schema-driven form and treats the shape as read-only for the admin (ADR `composable-data-models` §4/§5). Duplicate id or non-namespaced id throws at declare time. `has(id)`, `declared()` (sorted). Since 1.5.0.

### `net.artisanmc.modules.api.EditorScreenRegistry` (`@Beta`)

`api.screens.declare(id, label, table, projectId)` — declares a **Config screen**: a named entry in the editor's sidebar under the module, whose core-generated form edits one declared-model Table/Config of the module's owned Project, live over the WS relay (ADR `module-config-screens` §2/§3). `id` must be namespaced (`boutique:catalog`); `table` is a Project-relative path (`data/categories`) — absolute paths, `..` and a first segment starting with `.artisan` are rejected at declare time, as is a duplicate id. Pure passthrough: nothing is interpreted plugin-side — the declarations are reported at Presence (`hello.editor_screens` / `modules_changed`) and the editor mounts the entries. A module that declares models + owns a Project but no screen gets a fallback "Données" screen synthesized by the editor. `declared()` (sorted by id). Since 1.6.0.

### `net.artisanmc.modules.api.DatabaseApi` (`@Beta`)

`api.database.dataSource(plugin)` — the database lent to the plugins of the suite (ADR `suite-foundation-database`): one HikariCP pool **per plugin**, opened on the first call (it checks a connection, so call it from `onEnable`), returned as is afterwards, closed when that plugin is disabled. Credentials are set once by the admin in `plugins/Artisan/environment.yml`; only `javax.sql.DataSource` crosses the boundary, the plugin brings its own access layer and migrations. `dialect` (`DatabaseDialect`: `H2`, `MYSQL`, `MARIADB`, Java enum) lets a plugin branch on the few statements that differ. H2 keeps one file per plugin; MySQL/MariaDB share the configured database, so prefix your tables. Misconfiguration or an unreachable server throws `IllegalStateException` naming the plugin and the file to fix. Default `DatabaseApi.NONE` throws on every call. Since 1.7.0.

| Member | Type | Since |
|---|---|---|
| `ArtisanAPI.database` | `DatabaseApi` | 1.7.0 |
| `dialect` | `DatabaseDialect` | 1.7.0 |
| `dataSource(owner: Plugin)` | `javax.sql.DataSource` | 1.7.0 |

### `net.artisanmc.modules.api.Stability`

Declared (not inferred) axis of a data source. `STATIC` = a stable, enumerable key-set (`fetcher(null)` returns the authoritative rows, each identified by `keyField`) — placeable in a menu's placement mode. `DYNAMIC` (default) = runtime/player-dependent, unbounded — pagination only.

Values: `STATIC`, `DYNAMIC`.

### `net.artisanmc.modules.api.FieldKind`

Enum describing the type of a declared data-source row field. Drives editor schema table and filter autocomplete.
`ITEM` declares a complete item value (reference or structured material/quantity/metadata), exposed as `item` in source schemas. The editor offers these fields in **Displayed item → Use an item from data**. Text fields remain `STRING`.

Values: `STRING`, `NUMBER`, `INTEGER`, `BOOLEAN`, `LIST`, `OBJECT`, `ITEM`.

### `net.artisanmc.modules.api.DataSourceField`

One declared row field in a data source's schema.

| Member | Type | Since |
|---|---|---|
| `name` | `String` | 1.3.0 |
| `type` | `FieldKind` | 1.3.0 |
| `description` | `String?` | 1.3.0 |

### `net.artisanmc.modules.api.RegisteredDataSource`

A `DataSourceDeclaration` paired with its owning module id. Returned by `DataSourceRegistry.registered()`.

| Member | Type | Since |
|---|---|---|
| `declaration` | `DataSourceDeclaration` | 1.3.0 |
| `moduleId` | `String?` | 1.3.0 |

`moduleId` is non-null when the data source was registered from a module's `onEnable`, null for third-party registrations via ServicesManager.

### `net.artisanmc.modules.api.PlayerRequiredException`

Exception thrown by a `DataSourceDeclaration.fetcher` when it cannot produce meaningful rows without a real player (e.g., inventory-dependent data). The editor catches this on preview mode and surfaces a typed `player_required` error instead of crashing.

Since 1.3.0.

### `net.artisanmc.modules.api.CommandRegistry`

| Member | Type | Since |
|---|---|---|
| `register(decl: CommandDeclaration)` | `Unit` | 1.0.0 |
| `dispatch(name: String, player: Player, args: Map<String, Any?>)` | `Unit` | 1.0.0 |
| `has(name: String)` | `Boolean` | 1.0.0 |
| `names()` | `Set<String>` | 1.0.0 |

Exceptions: `UnknownCommandException`, `DuplicateCommandException`.

Runtime consumer (since 1.2.0): `run_command` actions whose command matches `namespace:name` and is registered here are dispatched to the module handler with `args = {argv: List<String>, raw: String}`. Unknown refs fall back to Bukkit.

### `net.artisanmc.modules.api.ModuleEventBus`

| Member | Type | Since |
|---|---|---|
| `subscribe(type: Class<out ModuleEvent>, handler: ModuleEventHandler)` | `Unit` | 1.0.0 (signature 1.5.0) |
| `publish(event: ModuleEvent)` | `Unit` | 1.0.0 |

Event types: `DataReloadEvent`, `ConfigReloadEvent`. Modules may add their own subclasses of `ModuleEvent`.

### `net.artisanmc.modules.api.schemas.SchemaRegistry<T>`

| Member | Type | Since |
|---|---|---|
| `register(migration: SchemaMigration<T>)` | `Unit` | 1.0.0 |
| `loadToCurrent(data: T, currentVersion: String, versionOf: (T) -> String)` | `T` | 1.0.0 |
| `has(from: String)` | `Boolean` | 1.0.0 |

Exceptions: `UnsupportedSchemaVersionException`, `CircularMigrationException`.

### `net.artisanmc.modules.api.schemas.SchemaMigration<T>`

| Member | Type | Since |
|---|---|---|
| `from` | `String` | 1.0.0 |
| `to` | `String` | 1.0.0 |
| `migrate(data: T)` | `T` | 1.0.0 |

Migrations MUST be pure, idempotent, and write-once. See `versioning.md` §2.5.

### `net.artisanmc.modules.api.ProjectContentApi`

Read-only project content on disk (`plugins/Artisan/projects/`). The `.artisan*` namespace is never exposed. Re-read in `onReload()` after a sync.

| Member | Type | Since |
|---|---|---|
| `projectIds()` | `List<String>` | 1.2.0 |
| `list(projectId: String, dir: String)` | `List<String>` | 1.2.0 |
| `read(projectId: String, relPath: String)` | `String?` | 1.2.0 |
| `hasContent(dir: String)` | `Boolean` | 1.2.0 |

### `net.artisanmc.modules.api.ProjectRootRegistry`

Lets an Add-on host its Project in its **own plugin dir** instead of the core `plugins/Artisan/projects/` (ADR `addon-owned-project-roots`). Call once from `onEnable(api)`.

The explicit `projectId` is a permanent immutable add-on identity, independent of
the directory name. Registered roots cannot be renamed in the editor;
`register(projectId, dir)` remains stable without deprecation.

Prefer `register(projectId, dir, moduleId)`: it names the module (`ArtisanModule.getId()`)
that owns the project, so the editor lists it under that module in "Installed modules"
even when the module declares no config screen. Without it, the editor falls back to the
module's declared screens to find the owner.

| Member | Type | Since |
|---|---|---|
| `register(projectId: String, dir: File)` | `Unit` | 1.5.0 |
| `register(projectId: String, dir: File, moduleId: String)` | `Unit` | 1.6.0 |

## Beta APIs (may change)

None at this time.

## Deprecated APIs

None at this time.

## Internal — DO NOT USE

Everything under `net.artisanmc.plugin.*` is implicitly internal. Use the API surface above instead.

## Published artifact

The API surface above is packaged as a standalone Gradle artifact:

```
net.artisanmc:artisan-core-api:<version>
```

Served by Artisan's Maven repository `https://repo.artisanmc.net` (Reposilite, `deploy/reposilite/`), published by `.github/workflows/publish-api.yml`:

The version is **this document**: the highest `Since` version above (last table cell or "Since X.Y.Z" in prose, read by `deploy/api-version.mjs`) — the API's own SemVer, independent of the plugin build number `1.0.<run>`. On a push to `main` touching the API sources, `plugin/build.gradle.kts` or this file:

- highest `Since` above the latest `api-vX.Y.Z` tag → **release** `X.Y.Z` to `/releases`, then the workflow creates the tag and a GitHub Release. Nobody tags by hand;
- otherwise → **snapshot** `X.(Y+1).0-SNAPSHOT` (next minor after the latest release, so it sorts above it) to `/snapshots`.

Releasing a new member = marking it with the next version here, in the same PR. The `API version` check (`.github/workflows/api-version-check.yml`) fails a PR that changes `net/artisanmc/modules/api/**` without raising the highest `Since` above the latest release; label `api:no-release` exempts a change with no published effect (KDoc, formatting). A patch release (1.6.1) is the same mechanism: mark the fixed member with the patch version (`Since` 1.6.1).

The publication carries a sources jar (KDoc) and a POM declaring `kotlin-stdlib`. License: GPL-3.0, like the repo. External module plugins declare it as `compileOnly` (the jar is provided by the running Artisan plugin at runtime):

```kotlin
// build.gradle.kts
repositories { maven("https://repo.artisanmc.net/releases") }
dependencies { compileOnly("net.artisanmc:artisan-core-api:<version>") }
```

`./gradlew publishToMavenLocal` still works for testing an unreleased API change against an add-on; CI runs `publishCoreApiPublicationToMavenLocal` so a broken publication fails the PR.

The artifact contains only the `net.artisanmc.modules.api.*` packages filtered through `apiJar`. Nothing under `net.artisanmc.plugin.*` is included.

## Protocol surfaces

- **WebSocket** : the WS protocol carries `protocol_version: "1"` in the hello message. Backend tolerates unknown message types (logs + ignores). See `versioning.md` §4.
- **REST API** : versioned under `/api/v1/*` (since 1.0). See `versioning.md` §5.
- **YAML schemas** : `manifest/v1`, `menu/v1`, `command/v1`, `dialog/v1`. Plugin `PackReader` rejects unsupported versions; the schema migration framework brings legacy data forward when newer versions ship.
- **Database** : Drizzle migrations under `backend/drizzle/` are append-only. See `versioning.md` §6.
