---
title: API reference
description: Every public type of net.artisanmc.modules.api, grouped, with its stability, the API version it appeared in, and a link to its source.
sidebar:
  order: 12
---

Everything in `net.artisanmc.modules.api` (artifact
`net.artisanmc:artisan-core-api`) is API. Everything under
`net.artisanmc.plugin.*` is internal — do not import it.

**Since** is the API version a member appeared in; compile against the lowest
version that has everything you use ([Versions](/wiki/developers/setup/#versions-and-compatibility)).
Sources (with KDoc) are
published next to the jar; the links below go to the repository.

## Stability annotations

| Annotation | Meaning |
|---|---|
| `@Stable` | Covered by SemVer: no breaking change within a major version |
| `@Beta` | Experimental: may change in a minor version |
| `@Internal` | Do not call from an add-on |
| `@Sunset(reason, removeInVersion, replacement)` | Works until `removeInVersion`; move to `replacement` |

`@Stable`, `@Beta` and `@Internal` have source retention (visible in the
sources jar and your IDE, not at runtime); `@Sunset` is kept at runtime.

## Entry points

| Type | Stability | Since | Members |
|---|---|---|---|
| [`ArtisanAPI`][ArtisanAPI] | `@Stable` | 1.0.0 | The facade, obtained from Bukkit's `ServicesManager` or passed to `onEnable(api)`. Properties below |
| [`ArtisanModule`][ArtisanModule] | `@Stable` | 1.0.0 | `id`, `schemaVersion`, `onEnable(api)`, `onDisable()` (called when your plugin disables since 1.8.0), `onReload()` (default method, Java included since 1.8.0) |
| [`ModuleRegistry`][ModuleRegistry] | `@Stable` | 1.1.0 | `register(module)`, `unregister(id)` (1.8.0), `active()`, `has(id)`; `bind(…)` and `unregisterLoadedBy(…)` are `@Internal` |
| [`SemVer`][SemVer] | `@Stable` | 1.1.0 | `satisfies(core, min)`: same major and `core ≥ min` |

### `ArtisanAPI` properties

| Property | Type | Stability | Since |
|---|---|---|---|
| `plugin` | `JavaPlugin` (Artisan's) | `@Stable` | 1.0.0 |
| `dataSources` | `DataSourceRegistry` | `@Stable` | 1.0.0 |
| `commands` | `CommandRegistry` | `@Stable` | 1.0.0 |
| `events` | `ModuleEventBus` | `@Stable` | 1.0.0 |
| `schemas` | `SchemaRegistry<MutableMap<String, Any?>>` | `@Stable` | 1.0.0 |
| `modules` | `ModuleRegistry` | `@Stable` | 1.1.0 |
| `coreVersion` | `String` — the Artisan **plugin** version | `@Stable` | 1.1.0 |
| `apiVersion` | `String` — the API version | `@Stable` | 1.8.0 |
| `isCompatibleWith(minVersion)` | `Boolean` — against `apiVersion` (against `coreVersion` before 1.8.0) | `@Stable` | 1.1.0 |
| `project` | `ProjectContentApi` | `@Stable` | 1.2.0 |
| `projectRoots` | `ProjectRootRegistry` | `@Stable` | 1.5.0 |
| `items` | `ItemStackApi` | `@Beta` | 1.4.0 |
| `messages` | `ModuleMessagesApi` | `@Beta`, `@Sunset` (1.8.0) | 1.4.0 |
| `actions` | `ModuleActionsApi` | `@Beta` | 1.4.0 |
| `models` | `ModelRegistry` | `@Beta` | 1.5.0 |
| `screens` | `EditorScreenRegistry` | `@Beta` | 1.6.0 |
| `database` | `DatabaseApi` | `@Beta` | 1.7.0 |

## Data sources

Guide: [Data sources](/wiki/developers/data-sources/).

| Type | Stability | Since | Members |
|---|---|---|---|
| [`DataSourceRegistry`][DataSourceRegistry] | `@Stable` | 1.0.0 | `register(decl)`, `unregister(ref)` (1.8.0), `fetch(ref, player?, params)`, `has(ref)`, `refs()`, `declarations()` (1.2.0), `registered()` (1.3.0) |
| [`DataSourceDeclaration`][DataSourceDeclaration] | `@Stable` | 1.0.0 | `ref`, `fetcher` (1.3.0, type 1.5.0), `schema` (1.3.0), `stability` (1.4.0), `keyField` (1.4.0), `schemaHint` (`@Sunset`, removed in 2.0.0); Java overloads (1.8.0) |
| [`DataFetcher`][Callbacks] | `@Stable` | 1.5.0 | `fetch(player: Player?, params): List<Map<String, Any?>>` |
| [`DataSourceField`][DataSourceDeclaration] | `@Stable` | 1.3.0 | `name`, `type: FieldKind`, `description?` |
| [`FieldKind`][FieldKind] | `@Stable` | 1.3.0 | `STRING`, `NUMBER`, `INTEGER`, `BOOLEAN`, `LIST`, `OBJECT`, `ITEM` (Java enum) |
| [`Stability`][Stability] | `@Stable` | 1.4.0 | `STATIC`, `DYNAMIC` (Java enum) |
| [`RegisteredDataSource`][DataSourceRegistry] | `@Stable` | 1.3.0 | `declaration`, `moduleId?` (null outside a module's `onEnable`) |
| [`PlayerRequiredException`][DataSourceDeclaration] | `@Stable` | 1.3.0 | Thrown by a fetcher that needs a real player |
| `UnknownDataSourceException`, `DuplicateDataSourceException` | `@Stable` | 1.0.0 | Unknown ref on `fetch`; ref registered twice |

> **Breaking change in 1.3.0** — the fetcher's `player` became nullable
> (`Player?`): the editor preview passes `null`.
> **1.5.0** — `fetcher` became the `DataFetcher` functional interface instead
> of a Kotlin function type (source compatible for lambdas).

## Commands

Guide: [Commands](/wiki/developers/commands/).

| Type | Stability | Since | Members |
|---|---|---|---|
| [`CommandRegistry`][CommandRegistry] | `@Stable` | 1.0.0 | `register(decl)`, `unregister(name)` (1.8.0), `dispatch(name, player, args)`, `has(name)`, `names()` |
| [`CommandDeclaration`][CommandDeclaration] | `@Stable` | 1.0.0 | `name`, `handler: CommandHandler` |
| [`CommandHandler`][Callbacks] | `@Stable` | 1.5.0 | `handle(player: Player, args: Map<String, Any?>)` — `args = {argv: List<String>, raw: String}` from menus |
| `UnknownCommandException`, `DuplicateCommandException` | `@Stable` | 1.0.0 | Unknown name on `dispatch`; name registered twice |

Since 1.2.0, `run_command "<ns:name> …" as player` actions dispatch to this
registry when the ref is registered; anything else runs as a Bukkit command.

## Menus and actions

Guide: [Menus](/wiki/developers/menus/).

| Type | Stability | Since | Members |
|---|---|---|---|
| [`ModuleActionsApi`][ModuleActionsApi] | `@Beta` | 1.4.0 | `execute(player, actions, args = {}, projectId = null)` — runs Action DSL on the player's thread; `projectId` since 1.6.0 |
| [`ItemStackApi`][ItemStackApi] | `@Beta` | 1.4.0 | `serialize(stack): String`, `describe(stack): Map<String, Any>` |
| [`ModuleMessagesApi`][ModuleMessagesApi] | `@Beta`, `@Sunset` (1.8.0, removed in 2.0.0) | 1.4.0 | `send(type, payload)` — has had no receiver since the editor moved into the plugin; do not use |

## Modules, projects and content

Guide: [Modules](/wiki/developers/modules/).

| Type | Stability | Since | Members |
|---|---|---|---|
| [`ProjectContentApi`][ProjectContentApi] | `@Stable` | 1.2.0 | `projectIds()`, `list(projectId, dir)`, `read(projectId, relPath)`, `hasContent(dir)`, `reload()` (1.6.0) |
| [`ProjectRootRegistry`][ProjectRootRegistry] | `@Stable` | 1.5.0 | `register(projectId, dir)`, `register(projectId, dir, moduleId)` (1.6.0), `NOOP`; the reload it triggers runs on the next tick since 1.8.0 |
| [`SchemaRegistry<T>`][SchemaRegistry] | `@Stable` | 1.0.0 | `register(migration)`, `loadToCurrent(data, currentVersion, versionOf)`, `has(from)` |
| [`SchemaMigration<T>`][SchemaMigration] | `@Stable` | 1.0.0 | `from`, `to`, `migrate(data)` — pure, idempotent, write-once |
| [`SchemaVersionReader<T>`][Callbacks] | `@Stable` | 1.5.0 | `versionOf(document): String` |
| `UnsupportedSchemaVersionException`, `CircularMigrationException` | `@Stable` | 1.0.0 | No migration from a version; migration loop |
| `DuplicateModuleException` | `@Stable` | 1.1.0 | Module id registered twice |

`SchemaRegistry`, `SchemaMigration` and their exceptions live in
`net.artisanmc.modules.api.schemas`.

## Data models and config screens

Guide: [Data models & config screens](/wiki/developers/data-models/).

| Type | Stability | Since | Members |
|---|---|---|---|
| [`ModelRegistry`][ModelRegistry] | `@Beta` | 1.5.0 | `declare(document)`, `has(id)`, `declared()` |
| [`DeclaredModel`][ModelRegistry] | `@Beta` | 1.5.0 | `id`, `document`, `moduleId?` |
| [`EditorScreenRegistry`][EditorScreenRegistry] | `@Beta` | 1.6.0 | `declare(id, label, table, projectId)`, `declared()` |
| [`EditorScreenDeclaration`][EditorScreenRegistry] | `@Beta` | 1.6.0 | `id`, `label`, `table`, `projectId`, `moduleId?`, `toWire()` |
| `DuplicateModelException`, `DuplicateEditorScreenException` | `@Beta` | 1.5.0 / 1.6.0 | Id declared twice |

## Database

Guide: [Database](/wiki/developers/database/).

| Type | Stability | Since | Members |
|---|---|---|---|
| [`DatabaseApi`][DatabaseApi] | `@Beta` | 1.7.0 | `dialect`, `dataSource(owner: Plugin): javax.sql.DataSource`, `NONE` |
| [`DatabaseDialect`][DatabaseDialect] | `@Beta` | 1.7.0 | `H2`, `MYSQL`, `MARIADB` (Java enum) |

Since 1.7.1 every plugin shares a single H2 file (1.7.0 kept one per plugin).

## Events

Guide: [Events & reloads](/wiki/developers/events/).

| Type | Stability | Since | Members |
|---|---|---|---|
| [`ModuleEventBus`][ModuleEventBus] | `@Stable` | 1.0.0 | `subscribe(type, handler)` (signature 1.5.0), `publish(event)` |
| [`ModuleEvent`][ModuleEventBus] | `@Stable` | 1.0.0 | Marker interface; open to add-on events since 1.8.0 (sealed before) |
| [`ConfigReloadEvent`][ModuleEventBus] | `@Stable` | 1.0.0 | `moduleId` — published by Artisan (`"menus"`) after every content reload |
| [`DataReloadEvent`][ModuleEventBus] | `@Stable` | 1.0.0 | `dataSourceRef` — between add-ons only: Artisan neither publishes nor reads it |
| [`ModuleEventHandler`][Callbacks] | `@Stable` | 1.5.0 | `onEvent(event: ModuleEvent)` |

## File formats

Add-ons that ship or read project files meet these YAML schemas: `manifest/v1`,
`menu/v1`, `command/v1`, `dialog/v1`, `model/v1`, `template/v1`, plus bare data
files under `data/`. Artisan rejects unsupported versions when it reads a
project. The JSON Schemas live in the repository under
[`docs/schema/`](https://github.com/artisanmc/artisan/tree/main/docs/schema).

[ArtisanAPI]: https://github.com/artisanmc/artisan/blob/main/plugin/api/src/main/kotlin/net/artisanmc/modules/api/ArtisanAPI.kt
[ArtisanModule]: https://github.com/artisanmc/artisan/blob/main/plugin/api/src/main/kotlin/net/artisanmc/modules/api/ArtisanModule.kt
[ModuleRegistry]: https://github.com/artisanmc/artisan/blob/main/plugin/api/src/main/kotlin/net/artisanmc/modules/api/ModuleRegistry.kt
[SemVer]: https://github.com/artisanmc/artisan/blob/main/plugin/api/src/main/kotlin/net/artisanmc/modules/api/SemVer.kt
[Callbacks]: https://github.com/artisanmc/artisan/blob/main/plugin/api/src/main/kotlin/net/artisanmc/modules/api/Callbacks.kt
[DataSourceRegistry]: https://github.com/artisanmc/artisan/blob/main/plugin/api/src/main/kotlin/net/artisanmc/modules/api/DataSourceRegistry.kt
[DataSourceDeclaration]: https://github.com/artisanmc/artisan/blob/main/plugin/api/src/main/kotlin/net/artisanmc/modules/api/DataSourceDeclaration.kt
[FieldKind]: https://github.com/artisanmc/artisan/blob/main/plugin/api/src/main/java/net/artisanmc/modules/api/FieldKind.java
[Stability]: https://github.com/artisanmc/artisan/blob/main/plugin/api/src/main/java/net/artisanmc/modules/api/Stability.java
[CommandRegistry]: https://github.com/artisanmc/artisan/blob/main/plugin/api/src/main/kotlin/net/artisanmc/modules/api/CommandRegistry.kt
[CommandDeclaration]: https://github.com/artisanmc/artisan/blob/main/plugin/api/src/main/kotlin/net/artisanmc/modules/api/CommandDeclaration.kt
[ModuleActionsApi]: https://github.com/artisanmc/artisan/blob/main/plugin/api/src/main/kotlin/net/artisanmc/modules/api/ModuleActionsApi.kt
[ItemStackApi]: https://github.com/artisanmc/artisan/blob/main/plugin/api/src/main/kotlin/net/artisanmc/modules/api/ItemStackApi.kt
[ModuleMessagesApi]: https://github.com/artisanmc/artisan/blob/main/plugin/api/src/main/kotlin/net/artisanmc/modules/api/ModuleMessagesApi.kt
[ProjectContentApi]: https://github.com/artisanmc/artisan/blob/main/plugin/api/src/main/kotlin/net/artisanmc/modules/api/ProjectContentApi.kt
[ProjectRootRegistry]: https://github.com/artisanmc/artisan/blob/main/plugin/api/src/main/kotlin/net/artisanmc/modules/api/ProjectRootRegistry.kt
[SchemaRegistry]: https://github.com/artisanmc/artisan/blob/main/plugin/api/src/main/kotlin/net/artisanmc/modules/api/schemas/SchemaRegistry.kt
[SchemaMigration]: https://github.com/artisanmc/artisan/blob/main/plugin/api/src/main/kotlin/net/artisanmc/modules/api/schemas/SchemaMigration.kt
[ModelRegistry]: https://github.com/artisanmc/artisan/blob/main/plugin/api/src/main/kotlin/net/artisanmc/modules/api/ModelRegistry.kt
[EditorScreenRegistry]: https://github.com/artisanmc/artisan/blob/main/plugin/api/src/main/kotlin/net/artisanmc/modules/api/EditorScreenRegistry.kt
[DatabaseApi]: https://github.com/artisanmc/artisan/blob/main/plugin/api/src/main/kotlin/net/artisanmc/modules/api/DatabaseApi.kt
[DatabaseDialect]: https://github.com/artisanmc/artisan/blob/main/plugin/api/src/main/java/net/artisanmc/modules/api/DatabaseDialect.java
[ModuleEventBus]: https://github.com/artisanmc/artisan/blob/main/plugin/api/src/main/kotlin/net/artisanmc/modules/api/ModuleEventBus.kt
