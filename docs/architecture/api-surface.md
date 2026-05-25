# Interfaze Public API Surface (v1.x)

This document lists the **stable** API surface of Interfaze Core that modules can safely depend on.
Anything not listed here is internal and may change without notice.

> Source of truth : the `@Stable` annotations in `plugin/src/main/kotlin/gg/interfaze/modules/api/`.
> This doc is hand-maintained; future versions will auto-generate it (see `versioning.md` §9.2).

## Annotations

| Annotation | Package | Meaning |
|---|---|---|
| `@Stable` | `gg.interfaze.modules.api.annotations.Stable` | Covered by SemVer. No breaking change within a major version. |
| `@Beta` | `gg.interfaze.modules.api.annotations.Beta` | Experimental. May change in minor versions. |
| `@Internal` | `gg.interfaze.modules.api.annotations.Internal` | DO NOT USE from modules. |
| `@Sunset(reason, removeInVersion, replacement)` | `gg.interfaze.modules.api.annotations.Sunset` | Scheduled for removal. Replacement is provided. |

Note : we use `@Sunset` (not `@Deprecated`) to avoid clashing with `kotlin.Deprecated`. The schedule-aware annotation carries removal version + replacement.

## Stable APIs (v1.x)

### `gg.interfaze.modules.api.InterfazeModule`

Contract implemented by every module.

| Member | Type | Since |
|---|---|---|
| `id` | `String` | 1.0.0 |
| `schemaVersion` | `String` | 1.0.0 |
| `onEnable(api: InterfazeAPI)` | `Unit` | 1.0.0 |
| `onDisable()` | `Unit` | 1.0.0 |
| `onReload()` | `Unit` (default empty) | 1.0.0 |

### `gg.interfaze.modules.api.InterfazeAPI`

The facade passed to every module at `onEnable(api)`.

| Member | Type | Since |
|---|---|---|
| `plugin` | `InterfazePlugin` | 1.0.0 |
| `dataSources` | `DataSourceRegistry` | 1.0.0 |
| `commands` | `CommandRegistry` | 1.0.0 |
| `events` | `ModuleEventBus` | 1.0.0 |
| `schemas` | `SchemaRegistry<MutableMap<String, Any?>>` | 1.0.0 |

### `gg.interfaze.modules.api.DataSourceRegistry`

| Member | Type | Since |
|---|---|---|
| `register(decl: DataSourceDeclaration)` | `Unit` | 1.0.0 |
| `fetch(ref: String, player: Player, params: Map<String, Any?>)` | `List<Map<String, Any?>>` | 1.0.0 |
| `has(ref: String)` | `Boolean` | 1.0.0 |
| `refs()` | `Set<String>` | 1.0.0 |

Exceptions: `UnknownDataSourceException`, `DuplicateDataSourceException`.

### `gg.interfaze.modules.api.CommandRegistry`

| Member | Type | Since |
|---|---|---|
| `register(decl: CommandDeclaration)` | `Unit` | 1.0.0 |
| `dispatch(name: String, player: Player, args: Map<String, Any?>)` | `Unit` | 1.0.0 |
| `has(name: String)` | `Boolean` | 1.0.0 |
| `names()` | `Set<String>` | 1.0.0 |

Exceptions: `UnknownCommandException`, `DuplicateCommandException`.

### `gg.interfaze.modules.api.ModuleEventBus`

| Member | Type | Since |
|---|---|---|
| `subscribe<T : ModuleEvent>(handler: (T) -> Unit)` | `Unit` | 1.0.0 |
| `subscribeRaw(type: Class<out ModuleEvent>, handler: (ModuleEvent) -> Unit)` | `Unit` | 1.0.0 |
| `publish(event: ModuleEvent)` | `Unit` | 1.0.0 |

Event types: `DataReloadEvent`, `ConfigReloadEvent`. Modules may add their own subclasses of `ModuleEvent`.

### `gg.interfaze.modules.api.schemas.SchemaRegistry<T>`

| Member | Type | Since |
|---|---|---|
| `register(migration: SchemaMigration<T>)` | `Unit` | 1.0.0 |
| `loadToCurrent(data: T, currentVersion: String, versionOf: (T) -> String)` | `T` | 1.0.0 |
| `has(from: String)` | `Boolean` | 1.0.0 |

Exceptions: `UnsupportedSchemaVersionException`, `CircularMigrationException`.

### `gg.interfaze.modules.api.schemas.SchemaMigration<T>`

| Member | Type | Since |
|---|---|---|
| `from` | `String` | 1.0.0 |
| `to` | `String` | 1.0.0 |
| `migrate(data: T)` | `T` | 1.0.0 |

Migrations MUST be pure, idempotent, and write-once. See `versioning.md` §2.5.

## Beta APIs (may change)

None at this time.

## Deprecated APIs

None at this time.

## Internal — DO NOT USE

Everything under `gg.interfaze.plugin.*` is implicitly internal. Use the API surface above instead.

## Protocol surfaces

- **WebSocket** : the WS protocol carries `protocol_version: "1"` in the hello message. Backend tolerates unknown message types (logs + ignores). See `versioning.md` §4.
- **REST API** : versioned under `/api/v1/*` (since 1.0). See `versioning.md` §5.
- **YAML schemas** : `manifest/v1`, `menu/v1`, `command/v1`, `dialog/v1`. Plugin `PackReader` rejects unsupported versions; the schema migration framework brings legacy data forward when newer versions ship.
- **Database** : Drizzle migrations under `backend/drizzle/` are append-only. See `versioning.md` §6.
