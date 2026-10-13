---
title: API reference
description: Stability contract and the public surface of net.artisanmc.modules.api.
---

Everything in `net.artisanmc.modules.api.*` is API. Everything under
`net.artisanmc.plugin.*` is core internals — do not import it, it changes
without notice.

## Stability annotations

| Annotation | Meaning |
|---|---|
| `@Stable` | Covered by SemVer. No breaking change within a major version. |
| `@Beta` | Experimental. May change in a minor version. |
| `@Internal` | Do not call from a module. |
| `@Sunset(reason, removeInVersion, replacement)` | Scheduled for removal, with the replacement named. |

`@Sunset` exists instead of `@Deprecated` to avoid clashing with
`kotlin.Deprecated` and to carry the removal schedule.

## `ArtisanModule`

| Member | Since |
|---|---|
| `id: String` | 1.0.0 |
| `schemaVersion: String` | 1.0.0 |
| `onEnable(api: ArtisanAPI)` | 1.0.0 |
| `onDisable()` | 1.0.0 |
| `onReload()` (default empty) | 1.0.0 |

## `ArtisanAPI`

| Member | Type | Since |
|---|---|---|
| `plugin` | `JavaPlugin` | 1.0.0 |
| `dataSources` | `DataSourceRegistry` | 1.0.0 |
| `commands` | `CommandRegistry` | 1.0.0 |
| `events` | `ModuleEventBus` | 1.0.0 |
| `schemas` | `SchemaRegistry<MutableMap<String, Any?>>` | 1.0.0 |
| `modules` | `ModuleRegistry` | 1.1.0 |
| `coreVersion` | `String` | 1.1.0 |
| `isCompatibleWith(minVersion)` | `Boolean` | 1.1.0 |
| `project` | `ProjectContentApi` | 1.2.0 |
| `projectRoots` | `ProjectRootRegistry` | 1.5.0 |
| `items` `@Beta` | `ItemStackApi` | 1.4.0 |
| `messages` `@Beta` | `ModuleMessagesApi` | 1.4.0 |
| `actions` `@Beta` | `ModuleActionsApi` | 1.4.0 |
| `models` `@Beta` | `ModelRegistry` | 1.5.0 |
| `screens` `@Beta` | `EditorScreenRegistry` | 1.6.0 |

## `ModuleRegistry`

`register(module)` (throws `DuplicateModuleException`), `active()`, `has(id)`.
Since 1.1.0. `bind(...)` is `@Internal`.

## `DataSourceRegistry`

`register(decl)`, `fetch(ref, player, params)`, `has(ref)`, `refs()`,
`declarations()` (1.2.0), `registered()` (1.3.0).

Exceptions: `UnknownDataSourceException`, `DuplicateDataSourceException`,
`PlayerRequiredException`.

> **Breaking change in 1.3.0** — `fetch`/`fetcher` took `player: Player`, now
> `player: Player?`. Preview mode passes `null`.

### `DataSourceDeclaration`

| Member | Type | Since |
|---|---|---|
| `ref` | `String` | 1.0.0 |
| `fetcher` | `(Player?, Map<String, Any?>) -> List<Map<String, Any?>>` | 1.3.0 |
| `schema` | `List<DataSourceField>` | 1.3.0 |
| `stability` | `Stability` | 1.4.0 |
| `keyField` | `String?` | 1.4.0 |
| `schemaHint` | `String?` — `@Sunset`, removed in 2.0.0, use `schema` | 1.0.0 |

`DataSourceField(name, type: FieldKind, description?)`;
`FieldKind` ∈ `STRING`, `NUMBER`, `INTEGER`, `BOOLEAN`, `LIST`, `OBJECT`;
`Stability` ∈ `STATIC`, `DYNAMIC`;
`RegisteredDataSource(declaration, moduleId?)` — `moduleId` is null for sources
registered outside a module's `onEnable`.

## `CommandRegistry`

`register(decl)`, `dispatch(name, player, args)`, `has(name)`, `names()`.
Since 1.0.0. Exceptions: `UnknownCommandException`, `DuplicateCommandException`.

Since 1.2.0, `run_command` menu actions matching a registered `namespace:name`
are dispatched here with `args = {argv: List<String>, raw: String}`; unknown
refs fall back to Bukkit.

## `ModuleEventBus`

`subscribe<T : ModuleEvent>(handler)`, `subscribeRaw(type, handler)`,
`publish(event)`. Since 1.0.0. Built-in events: `DataReloadEvent(dataSourceRef)`,
`ConfigReloadEvent(moduleId)`. Modules may define their own `ModuleEvent`
subtypes.

## `ProjectContentApi`

`projectIds()`, `list(projectId, dir)`, `read(projectId, relPath)`,
`hasContent(dir)`. Since 1.2.0. Read-only; the `.artisan*` namespace is never
exposed.

## `ProjectRootRegistry`

`register(projectId, dir)`. Since 1.5.0. Pass a dedicated directory — sync
deletes anything under a project root that is not in the bundle.

## `ModelRegistry` `@Beta`

`declare(document)`, `has(id)`, `declared()`. Since 1.5.0. The document is a
verbatim `model/v1` map with a namespaced `id`; a duplicate or non-namespaced id
throws. Pure passthrough — nothing is interpreted plugin-side.

## `EditorScreenRegistry` `@Beta`

`declare(id, label, table, projectId)`, `declared()`. Since 1.6.0. `id` must be
namespaced; `table` must be a safe project-relative path.

## `ItemStackApi` `@Beta`

`serialize(stack): String` — canonical wrapped YAML, what the editor saves
under `items/<id>.yml`. `describe(stack): Map<String, Any>` — display descriptor
(material, enriched to a recognized custom ref when possible; head texture;
enchanted; count; name). Since 1.4.0.

## `ModuleMessagesApi` `@Beta`

`send(type, payload)` — fire-and-forget message. Since the backend was removed,
no module layer receives it: it is effectively a no-op, kept for compatibility.
Since 1.4.0.

## `ModuleActionsApi` `@Beta`

`execute(player, actions, args = {}, projectId = null)` — runs an Action DSL
string on the main thread. `args` become `{name}` placeholders (`player` is
implicit); `projectId` puts that project's `lang/` in scope so `@key` resolves.
Malformed input is skipped with a warning. Since 1.4.0.

## `SchemaRegistry<T>` / `SchemaMigration<T>`

`register(migration)`, `loadToCurrent(data, currentVersion, versionOf)`,
`has(from)`. A migration carries `from`, `to`, `migrate(data)`. Migrations must
be pure, idempotent, and write-once. Exceptions:
`UnsupportedSchemaVersionException`, `CircularMigrationException`. Since 1.0.0.

## Protocol surfaces

- **WebSocket** — between a leaf server and its hub, `hello` carries
  `protocol_version: "1.0"`. A different major version means the hub serves
  nothing to that server until both run the same release. Unknown message types
  are logged and ignored.
- **REST** — versioned under `/api/v1/*`. A breaking change ships as `/api/v2/`
  alongside, with v1 kept for 6–12 months.
- **YAML schemas** — `manifest/v1`, `menu/v1`, `command/v1`, `dialog/v1`,
  `data/v1`, `model/v1`, `template/v1`. Unsupported versions are rejected by the
  plugin reader; migrations bring legacy data forward.
