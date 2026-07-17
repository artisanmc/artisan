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

### `net.artisanmc.modules.api.ModuleRegistry`

Manages the set of active modules for a running Artisan instance.

| Member | Stability | Type | Description |
|---|---|---|---|
| `register(module: ArtisanModule)` | `@Stable` | `Unit` | Register a module. Throws `DuplicateModuleException` if the id is already registered. Triggers `modules_changed` WS message if the plugin is connected. |
| `active()` | `@Stable` | `List<ArtisanModule>` | Returns all currently registered modules. |
| `has(id: String)` | `@Stable` | `Boolean` | Returns true if a module with that id is registered. |
| `bind(api: ArtisanAPI, onChange: () -> Unit)` | `@Internal` | `Unit` | Used internally by the plugin to be notified on registry changes (triggers `modules_changed`). DO NOT USE from modules. |

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
| `fetcher` | `(player: Player?, params: Map<String, Any?>) -> List<Map<String, Any?>>` | `@Stable` | 1.3.0 |
| `schema` | `List<DataSourceField>` | `@Stable` | 1.3.0 |
| `stability` | `Stability` | `@Stable` | 1.4.0 |
| `keyField` | `String?` | `@Stable` | 1.4.0 |
| `schemaHint` | `String?` | `@Sunset` | 1.0.0 → 2.0.0 |

Constructing a `Stability.STATIC` declaration without a non-blank `keyField` throws (`require`) — a static source must declare its Row key.

### `net.artisanmc.modules.api.Stability`

Declared (not inferred) axis of a data source. `STATIC` = a stable, enumerable key-set (`fetcher(null)` returns the authoritative rows, each identified by `keyField`) — placeable in a menu's placement mode. `DYNAMIC` (default) = runtime/player-dependent, unbounded — pagination only.

Values: `STATIC`, `DYNAMIC`.

### `net.artisanmc.modules.api.FieldKind`

Enum describing the type of a declared data-source row field. Drives editor schema table and filter autocomplete.

Values: `STRING`, `NUMBER`, `INTEGER`, `BOOLEAN`, `LIST`, `OBJECT`.

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
| `subscribe<T : ModuleEvent>(handler: (T) -> Unit)` | `Unit` | 1.0.0 |
| `subscribeRaw(type: Class<out ModuleEvent>, handler: (ModuleEvent) -> Unit)` | `Unit` | 1.0.0 |
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

Published to `mavenLocal` via `./gradlew publishToMavenLocal`. External module plugins declare it as `compileOnly` (the jar is provided by the running Artisan plugin at runtime):

```kotlin
// build.gradle.kts
repositories { mavenLocal() }
dependencies { compileOnly("net.artisanmc:artisan-core-api:<version>") }
```

The artifact contains only the `net.artisanmc.modules.api.*` packages filtered through `apiJar`. Nothing under `net.artisanmc.plugin.*` is included.

## Protocol surfaces

- **WebSocket** : the WS protocol carries `protocol_version: "1"` in the hello message. Backend tolerates unknown message types (logs + ignores). See `versioning.md` §4.
- **REST API** : versioned under `/api/v1/*` (since 1.0). See `versioning.md` §5.
- **YAML schemas** : `manifest/v1`, `menu/v1`, `command/v1`, `dialog/v1`. Plugin `PackReader` rejects unsupported versions; the schema migration framework brings legacy data forward when newer versions ship.
- **Database** : Drizzle migrations under `backend/drizzle/` are append-only. See `versioning.md` §6.
