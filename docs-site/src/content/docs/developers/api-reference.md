---
title: API reference
description: Every public type of net.artisanmc.modules.api, grouped, with its stability, the API version it appeared in, and a link to its source.
sidebar:
  order: 12
---

Everything in `net.artisanmc.modules.api` (artifact
`net.artisanmc:artisan-core-api`) is API. Everything under
`net.artisanmc.plugin.*` is internal — do not import it.

Since 2.0.0 the types live in one package per domain. The entry points
(`ArtisanAPI`, `ArtisanModule`, `ModuleRegistry`, `SemVer`) stay in
`net.artisanmc.modules.api`; everything else is under it:

| Package | Holds |
|---|---|
| `action` | Action vocabulary, handlers, `ModuleActionsApi` |
| `command` | Command declarations and registry |
| `datasource` | Data sources, their fields, `DataReloadEvent`, `PlayerRequiredException` |
| `model` | Data models and their field kit |
| `document` | Document kinds |
| `screen` | Config screens |
| `menu` | `MenuApi`, `MenuRef`, menu events and listeners |
| `event` | Module event bus, `ConfigReloadEvent` |
| `placeholder`, `project`, `scheduler`, `database`, `item` | One surface each (`api.placeholders`, `api.project`/`api.projectRoots`, `api.scheduler`, `api.database`, `api.items`) |
| `schemas` | Schema versions and migrations |
| `annotations` | `@Stable`, `@Beta`, `@Internal`, `@Sunset` |

Each exception sits with its domain (`DuplicateCommandException` in `command`).

**Since** is the API version a member appeared in; compile against the lowest
version that has everything you use ([Versions](/wiki/developers/setup/#versions-and-compatibility)).
Sources (with Javadoc) are
published next to the jar; the links below go to the repository.

The API is Java since **2.0.0**: a property listed below is the getter `getX()`
(`getId()`, `getDataSources()`, `getRef()`; a Kotlin caller reads it as `x`), a
Kotlin implementor overrides the getter, and declarations are built with the
constructors named here. Removed in 2.0.0: `ArtisanAPI.messages` /
`ModuleMessagesApi`, `DataSourceDeclaration.schemaHint`.

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
| `schemas` | `SchemaRegistry<Map<String, Object>>` | `@Stable` | 1.0.0 |
| `modules` | `ModuleRegistry` | `@Stable` | 1.1.0 |
| `coreVersion` | `String` — the Artisan **plugin** version | `@Stable` | 1.1.0 |
| `apiVersion` | `String` — the API version | `@Stable` | 1.8.0 |
| `isCompatibleWith(minVersion)` | `Boolean` — against `apiVersion` (against `coreVersion` before 1.8.0) | `@Stable` | 1.1.0 |
| `project` | `ProjectContentApi` | `@Stable` | 1.2.0 |
| `projectRoots` | `ProjectRootRegistry` | `@Stable` | 1.5.0 |
| `items` | `ItemStackApi` | `@Beta` | 1.4.0 |
| `actions` | `ModuleActionsApi` | `@Beta` | 1.4.0 |
| `models` | `ModelRegistry` | `@Beta` | 1.5.0 |
| `screens` | `EditorScreenRegistry` | `@Beta` | 1.6.0 |
| `actionRegistry` | `ActionRegistry` | `@Beta` | 2.0.0 |
| `database` | `DatabaseApi` | `@Beta` | 1.7.0 |
| `menus` | `MenuApi` | `@Beta` | 1.8.0 |
| `scheduler` | `SchedulerApi` | `@Beta` | 1.8.0 |
| `placeholders` | `PlaceholderRegistry` | `@Beta` | 1.8.0 |

## Data sources

Guide: [Data sources](/wiki/developers/data-sources/).

| Type | Stability | Since | Members |
|---|---|---|---|
| [`DataSourceRegistry`][DataSourceRegistry] | `@Stable` | 1.0.0 | `register(decl)`, `unregister(ref)` (1.8.0), `fetch(ref, player?, params)`, `has(ref)`, `refs()`, `declarations()` (1.2.0), `registered()` (1.3.0) |
| [`DataSourceDeclaration`][DataSourceDeclaration] | `@Stable` | 1.0.0 | `ref`, `fetcher` (1.3.0, type 1.5.0), `schema` (1.3.0), `stability` (1.4.0), `keyField` (1.4.0), `schemaHint` (`@Sunset`, removed in 2.0.0); Java overloads (1.8.0) |
| [`DataFetcher`][DataFetcher] | `@Stable` | 1.5.0 | `fetch(player: Player?, params): List<Map<String, Any?>>` |
| [`DataSourceField`][DataSourceDeclaration] | `@Stable` | 1.3.0 | `name`, `fieldType: ModelFieldType` (2.0.0), `description?`; `DataSourceField(name, ModelFieldType[, description])` (2.0.0); the `FieldKind` constructors and `type: FieldKind` are `@Sunset` (removed in 3.0.0) |
| [`FieldKind`][FieldKind] | `@Stable`, `@Sunset` (3.0.0) | 1.3.0 | `STRING`, `NUMBER`, `INTEGER`, `BOOLEAN`, `LIST`, `OBJECT`, `ITEM` (Java enum); `toModelFieldType()` and `closestTo(type)` (2.0.0). Replaced by [`ModelFieldType`][ModelFieldType] |
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
| [`CommandHandler`][CommandHandler] | `@Stable` | 1.5.0 | `handle(player: Player, args: Map<String, Any?>)` — `args = {argv: List<String>, raw: String}` from menus; `argv` honours double quotes |
| `UnknownCommandException`, `DuplicateCommandException` | `@Stable` | 1.0.0 | Unknown name on `dispatch`; name registered twice |

Since 1.2.0, `run_command "<ns:name> …" as player` actions dispatch to this
registry when the ref is registered; anything else runs as a Bukkit command.

## Menus and actions

Guide: [Menus](/wiki/developers/menus/).

| Type | Stability | Since | Members |
|---|---|---|---|
| [`MenuApi`][MenuApi] | `@Beta` | 1.8.0 | `open(player, ref[, args])`, `open(player, MenuRef, args)`, `close(player)`, `openMenu(player)`, `menus()`, `onOpen/onClick/onClose(listener): MenuSubscription`, `NOOP` |
| [`MenuRef`][MenuApi] | `@Beta` | 1.8.0 | `projectId?`, `menuId`, `parse(ref)`; `toString()` = `project:menu` |
| [`MenuOpenListener`, `MenuClickListener`, `MenuCloseListener`][MenuApi] | `@Beta` | 1.8.0 | `onOpen(event)`, `onClick(event)`, `onClose(event)` |
| [`MenuSubscription`][MenuApi] | `@Beta` | 1.8.0 | `cancel()` |
| [`MenuOpenEvent`][MenuOpenEvent] | `@Beta` | 1.8.0 | Bukkit `PlayerEvent`, `Cancellable`: `menu`, `args` |
| [`MenuClickEvent`][MenuClickEvent] | `@Beta` | 1.8.0 | Bukkit `PlayerEvent`, `Cancellable`: `menu`, `slot`, `click: ClickType`, `hasActions()` |
| [`MenuCloseEvent`][MenuCloseEvent] | `@Beta` | 1.8.0 | Bukkit `PlayerEvent`: `menu`, `closeReason: MenuCloseReason` (2.10.0; `UNKNOWN` on Spigot). `getReason()`, Paper's type, is `@Sunset` |
| [`PlaceholderRegistry`][PlaceholderRegistry] | `@Beta` | 1.8.0 | `register(namespace, resolver[, exposeToPapi])`, `unregister(namespace)`, `namespaces()`, `resolve(player, text)`, `NOOP` |
| [`PlaceholderResolver`][PlaceholderRegistry] | `@Beta` | 1.8.0 | `resolve(player: Player?, key): String?` |
| [`ModuleActionsApi`][ModuleActionsApi] | `@Beta` | 1.4.0 | `execute(player, actions, args = {}, projectId = null)` — runs Action DSL on the player's thread; `projectId` since 1.6.0 |
| [`ItemStackApi`][ItemStackApi] | `@Beta` | 1.4.0 | `serialize(stack): String`, `describe(stack): Map<String, Any>` |
| `TextApi` (`api.getText()`) | `@Beta` | 2.10.0 | `send(to, miniMessage)`, `legacy(miniMessage)` (a `§` string for Bukkit's String methods), `plain`, `fromLegacy`, `NOOP`. Use it rather than Adventure types: the plugin then runs on Spigot too |
| [`ActionRegistry`][ActionRegistry] | `@Beta` | 2.0.0 | `register(decl)`, `unregister(name)`, `find(name)`, `has(name)`, `names()`, `declarations()`, `registered()` — every chain action, Artisan's own included, dispatches here; a module's actions are removed with it |
| [`ActionDeclaration`][ActionDeclaration] | `@Beta` | 2.0.0 | `(name, args: List<ModelField>, primary?, handler)`; `normalize(wire)`, `bind(wire)` (defaults added), `canonical(args)`, `toWire()`. Names `ns:name`; the scalar wire form (`- quests:start: intro`) binds `primary` |
| [`ActionHandler`][ActionHandler] | `@Beta` | 2.0.0 | `execute(ctx: ActionContext, args: Map<String, Object>, runtime: ActionRuntime): ActionContext` — return `ctx`, or `ctx.withArgs(...)` to bind values for the rest of the chain |
| [`ActionContext`][ActionContext], [`ActionRuntime`][ActionRuntime] | `@Beta` | 2.0.0 | `getPlayer()`, `getArgs()`, `getLang()`, `getProjectId()`, `withArgs(args)`; `text(ctx, ltext)`, `run(ctx, chain)`, `warn(message)` |
| [`ModelField`][ModelField], [`ModelFieldType`][ModelFieldType] | `@Beta` | 2.0.0 | `ModelField(name, type[, required])` + `withDefault/withLabel/withHelp/withSection/withRange/withPattern/withLocked`; `ModelFieldType.string()/number()/integer()/bool()/ltext()/…/enumOf(values)/documentRef(kind)` — what the editor's form shows for the action's arguments |

## Scheduling

Guide: [Threading & Folia](/wiki/developers/threading/).

| Type | Stability | Since | Members |
|---|---|---|---|
| [`SchedulerApi`][SchedulerApi] | `@Beta` | 1.8.0 | `forPlugin(owner: Plugin): TaskScheduler`, `DIRECT` |
| [`TaskScheduler`][SchedulerApi] | `@Beta` | 1.8.0 | `runGlobal[Later]`, `runAt[Later](location, …)`, `runFor[Later](entity, …)`, `runAsync[Later]`, `isOwnedByCurrentThread(entity)`, `isGlobalThread()`, `DIRECT` |

## Modules, projects and content

Guide: [Modules](/wiki/developers/modules/).

| Type | Stability | Since | Members |
|---|---|---|---|
| [`ProjectContentApi`][ProjectContentApi] | `@Stable` | 1.2.0 | `projectIds()`, `list(projectId, dir)`, `read(projectId, relPath)`, `hasContent(dir)`, `reload()` (1.6.0) |
| [`ProjectRootRegistry`][ProjectRootRegistry] | `@Stable` | 1.5.0 | `register(projectId, dir)`, `register(projectId, dir, moduleId)` (1.6.0), `NOOP`; the reload it triggers runs on the next tick since 1.8.0 |
| [`SchemaRegistry<T>`][SchemaRegistry] | `@Stable` | 1.0.0 | `register(migration)`, `loadToCurrent(data, currentVersion, versionOf)`, `has(from)` |
| [`SchemaMigration<T>`][SchemaMigration] | `@Stable` | 1.0.0 | `from`, `to`, `migrate(data)` — pure, idempotent, write-once |
| [`SchemaVersionReader<T>`][SchemaVersionReader] | `@Stable` | 1.5.0 | `versionOf(document): String` |
| `UnsupportedSchemaVersionException`, `CircularMigrationException` | `@Stable` | 1.0.0 | No migration from a version; migration loop |
| `DuplicateModuleException` | `@Stable` | 1.1.0 | Module id registered twice |

`SchemaRegistry`, `SchemaMigration` and their exceptions live in
`net.artisanmc.modules.api.schemas`.

## Data models and config screens

Guide: [Data models & config screens](/wiki/developers/data-models/).

| Type | Stability | Since | Members |
|---|---|---|---|
| [`ModelRegistry`][ModelRegistry] | `@Beta` | 1.5.0 | `declare(ModelDeclaration)` and `declare(id, keyField, fields)` (2.0.0), `has(id)`, `declared()`; `declare(document: Map)` is `@Sunset` (removed in 3.0.0) |
| [`ModelDeclaration`][ModelRegistry] | `@Beta` | 2.0.0 | `ModelDeclaration(id, keyField, fields)` + `withName`, `withVersion(version[, migrations])`, `withMasterDetail`; `toWire()` (the `model/v1` document) |
| `ModelMigration`, `MigrationStep` | `@Beta` | 2.0.0 | `ModelMigration(from, to, steps)`; `MigrationStep.renameField/setDefault/renameEnumValue/renameVariant` (optional `path`) |
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
| [`ModuleEventHandler`][ModuleEventHandler] | `@Stable` | 1.5.0 | `onEvent(event: ModuleEvent)` |

The menu Bukkit events (`MenuOpenEvent`, `MenuClickEvent`, `MenuCloseEvent`) are
listed under [Menus and actions](#menus-and-actions).

## File formats

Add-ons that ship or read project files meet these YAML schemas: `manifest/v1`,
`menu/v1`, `command/v1`, `dialog/v1`, `model/v1`, `template/v1`, plus bare data
files under `data/`. Artisan rejects unsupported versions when it reads a
project. The JSON Schemas live in the repository under
[`docs/schema/`](https://github.com/artisanmc/artisan/tree/main/docs/schema).

[ArtisanAPI]: https://github.com/artisanmc/artisan/blob/main/plugin/api/src/main/java/net/artisanmc/modules/api/ArtisanAPI.java
[ArtisanModule]: https://github.com/artisanmc/artisan/blob/main/plugin/api/src/main/java/net/artisanmc/modules/api/ArtisanModule.java
[ModuleRegistry]: https://github.com/artisanmc/artisan/blob/main/plugin/api/src/main/java/net/artisanmc/modules/api/ModuleRegistry.java
[SemVer]: https://github.com/artisanmc/artisan/blob/main/plugin/api/src/main/java/net/artisanmc/modules/api/SemVer.java
[DataFetcher]: https://github.com/artisanmc/artisan/blob/main/plugin/api/src/main/java/net/artisanmc/modules/api/datasource/DataFetcher.java
[CommandHandler]: https://github.com/artisanmc/artisan/blob/main/plugin/api/src/main/java/net/artisanmc/modules/api/command/CommandHandler.java
[SchemaVersionReader]: https://github.com/artisanmc/artisan/blob/main/plugin/api/src/main/java/net/artisanmc/modules/api/schemas/SchemaVersionReader.java
[ModuleEventHandler]: https://github.com/artisanmc/artisan/blob/main/plugin/api/src/main/java/net/artisanmc/modules/api/event/ModuleEventHandler.java
[DataSourceRegistry]: https://github.com/artisanmc/artisan/blob/main/plugin/api/src/main/java/net/artisanmc/modules/api/datasource/DataSourceRegistry.java
[DataSourceDeclaration]: https://github.com/artisanmc/artisan/blob/main/plugin/api/src/main/java/net/artisanmc/modules/api/datasource/DataSourceDeclaration.java
[FieldKind]: https://github.com/artisanmc/artisan/blob/main/plugin/api/src/main/java/net/artisanmc/modules/api/datasource/FieldKind.java
[Stability]: https://github.com/artisanmc/artisan/blob/main/plugin/api/src/main/java/net/artisanmc/modules/api/datasource/Stability.java
[CommandRegistry]: https://github.com/artisanmc/artisan/blob/main/plugin/api/src/main/java/net/artisanmc/modules/api/command/CommandRegistry.java
[CommandDeclaration]: https://github.com/artisanmc/artisan/blob/main/plugin/api/src/main/java/net/artisanmc/modules/api/command/CommandDeclaration.java
[ModuleActionsApi]: https://github.com/artisanmc/artisan/blob/main/plugin/api/src/main/java/net/artisanmc/modules/api/action/ModuleActionsApi.java
[ItemStackApi]: https://github.com/artisanmc/artisan/blob/main/plugin/api/src/main/java/net/artisanmc/modules/api/item/ItemStackApi.java
[ActionRegistry]: https://github.com/artisanmc/artisan/blob/main/plugin/api/src/main/java/net/artisanmc/modules/api/action/ActionRegistry.java
[ActionDeclaration]: https://github.com/artisanmc/artisan/blob/main/plugin/api/src/main/java/net/artisanmc/modules/api/action/ActionDeclaration.java
[ActionHandler]: https://github.com/artisanmc/artisan/blob/main/plugin/api/src/main/java/net/artisanmc/modules/api/action/ActionHandler.java
[ActionContext]: https://github.com/artisanmc/artisan/blob/main/plugin/api/src/main/java/net/artisanmc/modules/api/action/ActionContext.java
[ActionRuntime]: https://github.com/artisanmc/artisan/blob/main/plugin/api/src/main/java/net/artisanmc/modules/api/action/ActionRuntime.java
[ModelField]: https://github.com/artisanmc/artisan/blob/main/plugin/api/src/main/java/net/artisanmc/modules/api/model/ModelField.java
[ModelFieldType]: https://github.com/artisanmc/artisan/blob/main/plugin/api/src/main/java/net/artisanmc/modules/api/model/ModelFieldType.java
[ProjectContentApi]: https://github.com/artisanmc/artisan/blob/main/plugin/api/src/main/java/net/artisanmc/modules/api/project/ProjectContentApi.java
[ProjectRootRegistry]: https://github.com/artisanmc/artisan/blob/main/plugin/api/src/main/java/net/artisanmc/modules/api/project/ProjectRootRegistry.java
[SchemaRegistry]: https://github.com/artisanmc/artisan/blob/main/plugin/api/src/main/java/net/artisanmc/modules/api/schemas/SchemaRegistry.java
[SchemaMigration]: https://github.com/artisanmc/artisan/blob/main/plugin/api/src/main/java/net/artisanmc/modules/api/schemas/SchemaMigration.java
[ModelRegistry]: https://github.com/artisanmc/artisan/blob/main/plugin/api/src/main/java/net/artisanmc/modules/api/model/ModelRegistry.java
[EditorScreenRegistry]: https://github.com/artisanmc/artisan/blob/main/plugin/api/src/main/java/net/artisanmc/modules/api/screen/EditorScreenRegistry.java
[DatabaseApi]: https://github.com/artisanmc/artisan/blob/main/plugin/api/src/main/java/net/artisanmc/modules/api/database/DatabaseApi.java
[DatabaseDialect]: https://github.com/artisanmc/artisan/blob/main/plugin/api/src/main/java/net/artisanmc/modules/api/database/DatabaseDialect.java
[ModuleEventBus]: https://github.com/artisanmc/artisan/blob/main/plugin/api/src/main/java/net/artisanmc/modules/api/event/ModuleEventBus.java
[MenuApi]: https://github.com/artisanmc/artisan/blob/main/plugin/api/src/main/java/net/artisanmc/modules/api/menu/MenuApi.java
[MenuOpenEvent]: https://github.com/artisanmc/artisan/blob/main/plugin/api/src/main/java/net/artisanmc/modules/api/menu/MenuOpenEvent.java
[MenuClickEvent]: https://github.com/artisanmc/artisan/blob/main/plugin/api/src/main/java/net/artisanmc/modules/api/menu/MenuClickEvent.java
[MenuCloseEvent]: https://github.com/artisanmc/artisan/blob/main/plugin/api/src/main/java/net/artisanmc/modules/api/menu/MenuCloseEvent.java
[PlaceholderRegistry]: https://github.com/artisanmc/artisan/blob/main/plugin/api/src/main/java/net/artisanmc/modules/api/placeholder/PlaceholderRegistry.java
[SchedulerApi]: https://github.com/artisanmc/artisan/blob/main/plugin/api/src/main/java/net/artisanmc/modules/api/scheduler/SchedulerApi.java
