# Artisan Public API Surface (v2.x)

This document lists the **stable** API surface of Artisan Core that modules can safely depend on.
Anything not listed here is internal and may change without notice.

> Source of truth : the `@Stable` annotations under `plugin/api/src/main/java/net/artisanmc/modules/api/` (one sub-package per domain since 2.0.0).
> This doc is hand-maintained; future versions will auto-generate it (see `versioning.md` §9.2).

## Annotations

| Annotation | Package | Meaning |
|---|---|---|
| `@Stable` | `net.artisanmc.modules.api.annotations.Stable` | Covered by SemVer. No breaking change within a major version. |
| `@Beta` | `net.artisanmc.modules.api.annotations.Beta` | Experimental. May change in minor versions. |
| `@Internal` | `net.artisanmc.modules.api.annotations.Internal` | DO NOT USE from modules. |
| `@Sunset(reason, removeInVersion, replacement)` | `net.artisanmc.modules.api.annotations.Sunset` | Scheduled for removal. Replacement is provided. |

Note : we use `@Sunset` rather than `@Deprecated`: the schedule-aware annotation carries removal version + replacement.

## 2.0.0 — the surface is Java

`plugin/api` is written in Java since 2.0.0 (ADR `extensible-document-kinds`, « Langue de l'API publique »): interfaces, immutable final classes, enums, `@FunctionalInterface` callbacks, nothing from `kotlin.*` and no `kotlin-stdlib` in the POM. The internals of the plugin (`core`, `database`, `hub`, `paper`) stay Kotlin and implement these interfaces.

- A property `x` of the 1.x tables below is the Java getter `getX()` (`ArtisanModule.getId()`, `DataSourceDeclaration.getRef()`, `api.getDataSources()`). Kotlin callers keep writing `module.id` and `api.dataSources`; a Kotlin implementor writes `override fun getId() = "shop"`. Boolean flags read as `MenuClickEvent.hasActions()`.
- Value classes (`DataSourceDeclaration`, `DataSourceField`, `CommandDeclaration`, `RegisteredDataSource`, `MenuRef`, `DeclaredModel`, `EditorScreenDeclaration`, `DataReloadEvent`, `ConfigReloadEvent`) are final classes with constructors, getters, `equals`/`hashCode`/`toString`. Kotlin's named arguments and `copy` are gone: `DataSourceDeclaration(ref, fetcher)`, `(ref, fetcher, schema)` or `(ref, fetcher, schema, stability, keyField)`.
- `ArtisanAPI` is built by Artisan through `ArtisanAPI.builder(plugin, dataSources, commands, events, schemas, modules, coreVersion, project)` (`@Internal`), the optional surfaces defaulting to their inert implementations; add-ons never construct it.
- Nullability is declared with `org.jetbrains.annotations.Nullable` where null is a value (`DataFetcher.fetch(player)`, `MenuRef.getProjectId()`, `ProjectContentApi.read`, …); everything else is non-null.
- Removed, as announced by `@Sunset`: `ModuleMessagesApi` and `ArtisanAPI.messages`, `DataSourceDeclaration.schemaHint` (and `schema_hint` on the `data_sources` wire). The Kotlin `DefaultImpls` of 1.x are gone too: interface members with a body are plain Java default methods.
- One package per domain: `ArtisanAPI`, `ArtisanModule`, `ModuleRegistry`, `DuplicateModuleException` and `SemVer` stay in `net.artisanmc.modules.api`; the rest moves to `api.action`, `api.command`, `api.datasource`, `api.model`, `api.document`, `api.screen`, `api.menu`, `api.event`, `api.placeholder`, `api.project`, `api.scheduler`, `api.database`, `api.item`, and `SchemaVersionReader` to `api.schemas`. Each exception sits with its domain. Only imports change: names, members and behaviour are the same.
- `ModuleActionsApi.execute` has Java overloads for its former default arguments: `execute(player, actions)`, `execute(player, actions, args)`, `execute(player, actions, args, projectId)`.
- One field-type vocabulary: `ModelField` / `ModelFieldType` type a data source row field (`new DataSourceField(name, ModelFieldType)`), a Data model (`ModelRegistry.declare(ModelDeclaration)`) and an Action's arguments. `FieldKind`, the `FieldKind` constructors of `DataSourceField`, `DataSourceField.getType()` and `ModelRegistry.declare(Map)` stay, `@Sunset` until 3.0.0, so an add-on built on 1.x still compiles; the `data_sources` and `declared_models` wires are unchanged.

| Member | Type | Since |
|---|---|---|
| The whole `net.artisanmc.modules.api` surface in Java, bean getters | | 2.0.0 |
| Sub-packages per domain (`api.action`, `api.command`, `api.datasource`, …) | | 2.0.0 |
| `ArtisanAPI.builder(...)`, `ArtisanAPI.Builder` (`@Internal`) | `Builder` | 2.0.0 |
| `MenuClickEvent.hasActions()` (was `getHasActions()`) | `boolean` | 2.0.0 |
| `ModuleActionsApi.execute(player, actions)`, `execute(player, actions, args)` | `void` | 2.0.0 |
| `ModuleMessagesApi`, `ArtisanAPI.messages`, `DataSourceDeclaration.schemaHint` removed | | 2.0.0 |
| `DataSourceField(name, ModelFieldType[, description])`, `getFieldType()`; `FieldKind` `@Sunset` | | 2.0.0 |
| `ModelRegistry.declare(ModelDeclaration)`, `declare(id, keyField, fields)`; `declare(Map)` `@Sunset` | | 2.0.0 |

An add-on built against 1.x recompiles against 2.0.0: the getters keep their JVM names, the imports of the moved types, the removed members and the `DataSourceDeclaration` constructors are the source changes to expect.

## Stable APIs

### `net.artisanmc.modules.api.ArtisanModule`

Contract implemented by every module.

| Member | Type | Since |
|---|---|---|
| `id` | `String` | 1.0.0 |
| `schemaVersion` | `String` | 1.0.0 |
| `onEnable(api: ArtisanAPI)` | `Unit` | 1.0.0 |
| `onDisable()` | `Unit` | 1.0.0 |
| `onReload()` | `Unit` (default empty) | 1.0.0 |
| `onReload()` as a JVM default method (Java modules may leave it out) | | 1.8.0 |
| `onDisable()` called when the module's own plugin disables | | 1.8.0 |

`onDisable()` runs when the module is unregistered: when the plugin whose class loader loaded the module disables (`PluginDisableEvent`, fired before that plugin's own `onDisable`), on `ModuleRegistry.unregister`, or, for the modules still registered, when Artisan disables. Before 1.8.0 it only ran at Artisan's disable, after the add-on's plugin was already disabled.

Interface members with a body (`onReload()`, `ProjectContentApi.reload()`, `ProjectRootRegistry.register(projectId, dir, moduleId)`) are Java default methods. Before 2.0.0 the Kotlin api compiled them with `-Xjvm-default=all-compatibility`, with `DefaultImpls` twins for add-ons compiled against 1.7.x and earlier; those twins are gone.

### `net.artisanmc.modules.api.ArtisanAPI`

The facade passed to every module at `onEnable(api)`. Also available to external plugins via Bukkit `ServicesManager`:

```java
ArtisanAPI api = getServer().getServicesManager().load(ArtisanAPI.class);
if (api == null) throw new IllegalStateException("Artisan not loaded");
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
| `apiVersion` | `String` | 1.8.0 |
| `isCompatibleWith` compares `apiVersion` | | 1.8.0 |
| `messages` removed; built through `ArtisanAPI.builder(...)` | | 2.0.0 |
| `actionRegistry` (`getActionRegistry()`, `@Beta`) | `ActionRegistry` | 2.0.0 |
| `documentKinds` (`getDocumentKinds()`, `@Beta`) | `DocumentKindRegistry` | 2.1.0 |
| `conditions` (`getConditions()`, `@Beta`) | `ConditionsApi` | 2.2.0 |
| `editorBundles` (`getEditorBundles()`, `@Beta`) | `EditorBundleRegistry` | 2.3.0 |
| `translations` (`getTranslations()`, `@Beta`) | `TranslationsApi` | 2.5.0 |
| `templates` (`getTemplates()`, `@Beta`) | `TemplateRegistry` | 2.6.0 |
| `playerCommands` (`getPlayerCommands()`, `@Beta`) | `PlayerCommandRegistry` | 2.7.0 |
| `text` (`getText()`, `@Beta`) | `TextApi` | 2.10.0 |

`coreVersion` is the Artisan plugin version (`plugin.yml`, `1.0.<build>`), unrelated to the API numbering. `apiVersion` is this API's version, generated at build time from this document (highest `Since`, the `generateApiVersion` task of `plugin/api`). `isCompatibleWith(min)` is true when `apiVersion` has the same major as `min` and is greater or equal (`SemVer.satisfies`); before 1.8.0 it compared `coreVersion`, so `isCompatibleWith("1.7.0")` was false on every server.

### `net.artisanmc.modules.api.ModuleRegistry`

Manages the set of active modules for a running Artisan instance.

| Member | Stability | Type | Description |
|---|---|---|---|
| `register(module: ArtisanModule)` | `@Stable` | `Unit` | Register a module. Throws `DuplicateModuleException` if the id is already registered. Triggers `modules_changed` WS message if the plugin is connected. |
| `active()` | `@Stable` | `List<ArtisanModule>` | Returns all currently registered modules. |
| `has(id: String)` | `@Stable` | `Boolean` | Returns true if a module with that id is registered. |
| `unregister(id: String)` | `@Stable` | `Boolean` | Calls the module's `onDisable()`, removes it and the data sources, commands, models, screens, actions, document kinds, editor bundle and templates registered from its `onEnable`, triggers `modules_changed`. False for an unknown id. Since 1.8.0 |
| `bind(api: ArtisanAPI, onChange: Runnable)` | `@Internal` | `Unit` | Used internally by the plugin to be notified on registry changes (triggers `modules_changed`). DO NOT USE from modules. |
| `unregisterLoadedBy(loader: ClassLoader)` | `@Internal` | `List<Exception>` | Called by Artisan on `PluginDisableEvent`: unregisters the modules loaded by that plugin's class loader, then the data sources and commands whose callback it loaded. Returns the `onDisable()` failures. |

A plugin that disables (server stop, `/reload`, PlugMan) loses everything it registered before its own `onDisable` runs, so registering the same ids again after a reload works.

Exceptions: `DuplicateModuleException`.

### `net.artisanmc.modules.api.datasource.DataSourceRegistry`

| Member | Type | Since |
|---|---|---|
| `register(decl: DataSourceDeclaration)` | `Unit` | 1.0.0 |
| `fetch(ref: String, player: Player?, params: Map<String, Any?>)` | `List<Map<String, Any?>>` | 1.0.0 |
| `has(ref: String)` | `Boolean` | 1.0.0 |
| `refs()` | `Set<String>` | 1.0.0 |
| `declarations()` | `List<DataSourceDeclaration>` | 1.2.0 |
| `registered()` | `List<RegisteredDataSource>` | 1.3.0 |
| `unregister(ref: String)` | `Boolean` | 1.8.0 |

Exceptions: `UnknownDataSourceException`, `DuplicateDataSourceException`, `PlayerRequiredException`.

**Breaking change (1.3.0)**: `fetch` signature changed from `(player: Player, …)` to `(player: Player?, …)`. Preview mode (editor) calls fetchers with `player = null`; modules that require a real player must either return generic data or throw `PlayerRequiredException`.

### `net.artisanmc.modules.api.datasource.DataSourceDeclaration`

| Member | Type | Stability | Since |
|---|---|---|---|
| `ref` | `String` | `@Stable` | 1.0.0 |
| `fetcher` | `DataFetcher` | `@Stable` | 1.3.0 (type 1.5.0) |
| `schema` | `List<DataSourceField>` | `@Stable` | 1.3.0 |
| `stability` | `Stability` | `@Stable` | 1.4.0 |
| `keyField` | `String?` | `@Stable` | 1.4.0 |
| `schemaHint` | `String?` | removed in 2.0.0 | 1.0.0 → 2.0.0 |

Constructing a `Stability.STATIC` declaration without a non-blank `keyField` throws (`require`) — a static source must declare its Row key.

Constructors (2.0.0): `DataSourceDeclaration(ref, fetcher)`, `(ref, fetcher, schema)`, `(ref, fetcher, schema, stability, keyField)`; `DataSourceField(name, type)`, `(name, type, description)` with a `ModelFieldType` (or, `@Sunset`, a `FieldKind`); `PlayerRequiredException()`, `(message)`. Before 2.0.0 the same overloads came from `@JvmOverloads` on Kotlin constructors with default arguments (since 1.8.0).

### Aucun type Kotlin ne traverse la frontière (1.5.0, api en Java depuis 2.0.0)

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

Depuis 2.0.0 la surface entière est écrite en Java (section « 2.0.0 » ci-dessus) :
`ApiSurfaceIsJavaFriendlyTest` échoue si une classe Kotlin apparaît dans `plugin/api/src/main`
ou si un type `kotlin.*` réapparaît dans une signature. L'implémentation (`core`, `paper`…)
reste en Kotlin.

**Ce que ça ne fait pas** : le JAR du plugin embarque toujours la kotlin-stdlib
sous ses noms d'origine. Elle ne peut pas être relocalisée — `kotlin-reflect`
(tiré par `jackson-module-kotlin`, qui lit les data classes YAML) résout ses
built-ins par nom de chaîne et ne survit pas au renommage. Artisan reste donc un
fournisseur possible de `kotlin.*` pour un plugin tiers qui en chercherait ; ce
qui est corrigé, c'est qu'aucun add-on Artisan n'a plus de raison d'en chercher.

### `net.artisanmc.modules.api.item.ItemStackApi` (`@Beta`)

Captured-item helpers for modules (`api.items`): `serialize(stack)` — canonical wrapped YAML (what a project stores under `items/<id>.yml`) — and `describe(stack)` — the generic display descriptor (material enriched to a recognized custom ref, head_texture, enchanted, count, name). Since 1.4.0.

Since 2.4.0, an **item spec** — a map with the fields of a menu button's appearance (`material`: vanilla, `item:<captured id>` or `<namespace>:<id>`; `title`, `lore`, `enchants`, `custom_model_data`, `count`…), as a module stores it in its Document — is built and compared: `build(spec)` makes its stack the way a menu does (no player, MiniMessage text; null when the material resolves to nothing), `matches(spec, stack, comparisons)` checks a player's stack against it on each `ItemComparison` asked (amount never compared; an empty set reads as `defaultComparisons`), and `defaultComparisons(spec)` reads the criteria off the built item: custom item when it is one, else material, plus name, lore, enchants and custom model data when the item carries them, and always `damage` (an item that cannot wear has none). Repair cost and hidden tags count only under `exact` (Bukkit `isSimilar`), so a captured Lure III rod matches any Lure III rod no more worn than it. `enchants` is a containment (the spec's enchantments at their level or higher), `name`/`lore` ignore colours. Implemented by `ItemSpecs` (paper). Wire ids: `ItemComparison.id()` / `fromId`.

| Member | Type | Since |
|---|---|---|
| `ItemStackApi.build(spec)` | `ItemStack` (nullable) | 2.4.0 |
| `ItemStackApi.matches(spec, stack, comparisons)`, `defaultComparisons(spec)` | `boolean`, `Set<ItemComparison>` | 2.4.0 |
| `ItemComparison` (`material`, `custom_item`, `name`, `lore`, `enchants`, `custom_model_data`, `damage`, `exact`) | enum | 2.4.0 |

### `net.artisanmc.modules.api.ModuleMessagesApi` (removed in 2.0.0)

Fire-and-forget module messages (`api.messages.send(type, payload)`), 1.4.0 → 2.0.0. Without a receiver since the editor moved into the plugin (phase F, 2026-10), `@Sunset` since 1.8.0, removed in 2.0.0 with no replacement. A module that wants to change its own project files writes them itself and calls `api.project.reload()` (ADR `server-disk-only-storage`).

### `net.artisanmc.modules.api.action.ModuleActionsApi` (`@Beta`)

`api.actions.execute(player, actions, args, projectId?)` (Java overloads without `args` and `projectId` since 2.0.0) — runs an Action DSL string (`parseActionDsl` → `dslToEngineSteps`) through the core `ActionExecutor`. Main-thread (dispatched if needed); `args` become `{name}` placeholder bindings (`player` is implicit); a malformed string is skipped with a WARN. Used by the boutique to run an item's purchase actions after payment. `projectId` (since 1.6.0, optional) puts that Project's `lang/` in scope so an action may carry `@key` (ADR `yaml-assisted-editing` ④); without it, action text stays literal. Since 1.4.0.

`api.actions.run(player, chain[, args[, projectId]])` (since 2.2.0) runs a chain in its wire form, as a module stores it in its own Document (rewards and hooks of a quest): a keyed step or a list of them, compiled by `ActionChainCompiler` like a menu's `actions` (a string is still read as the legacy DSL). Same thread, `{name}` bindings and i18n scope as `execute`; a null or empty chain does nothing, an unreadable one is skipped with a WARN.

| Member | Type | Since |
|---|---|---|
| `ModuleActionsApi.run(player, chain, args, projectId)`, `run(player, chain, args)`, `run(player, chain)` | `void` | 2.2.0 |

### `net.artisanmc.modules.api.condition.ConditionsApi` (`@Beta`, 2.2.0)

`api.getConditions().test(player, conditions[, args])` evaluates a list of conditions outside a chain, with the evaluator of `if:` (`ConditionEvaluator`): a module's requirements (can this quest start?) read the vocabulary of a menu. An entry is one keyed condition (`{has_permission: vip.use}`, `not:`, `and:`, `or:`) or the type-tagged form (`{type: has_permission, perm: …}`); the list is an AND and an empty list holds. The read is strict and fails closed: an unknown name, a missing or non-numeric argument, a blank required string, an unreadable regex or time range, or one bad operand of `and:`/`or:` makes `test` false with one WARN per distinct problem, where a menu's tolerant read drops or defaults it. `validate(conditions)` returns those problems by index (empty when valid), for a load-time report. `args` are bound for `expression`; `pagination_at_*` hold (no menu). `test` reads the player, so it throws `IllegalStateException` off the thread that owns the player (main thread on Paper, the player's region on Folia), and is false until the engine has started. `NOOP`: only an empty list holds.

| Member | Type | Since |
|---|---|---|
| `ConditionsApi.test(player, conditions, args)`, `test(player, conditions)` | `boolean` | 2.2.0 |
| `ConditionsApi.validate(conditions)` | `List<String>` | 2.2.0 |
| `ConditionsApi.NOOP`, `ArtisanAPI.Builder.conditions(conditions)` (`@Internal`) | | 2.2.0 |

### `net.artisanmc.modules.api.translation.TranslationsApi` (`@Beta`, 2.5.0)

The system messages (commands, statuses, errors) of the suite's plugins: one rule for a player's language, one loader and one renderer, each plugin keeping its lang files under its own namespace. Artisan's own messages are the bundle `artisan`. The texts of a Project (`ltext`, `{i18n:key}`) are not here: actions read them with `ActionRuntime.text`.

- `langOf(sender)`: the client language when `per_player_language` is on and the sender is a player, else `language` (`config.yml`); both re-read on `/artisan reload`.
- `register(declaration)` loads a `MessageBundle`. `MessageBundleDeclaration.files(owner, namespace, bundledLangs...)`: Artisan reads the jar's `lang/<code>.yml` for each bundled language and every `plugins/<Plugin>/lang/*.yml`, merged key by key (the server's keys win), never written. `MessageBundleDeclaration.of(owner, namespace, source)`: the plugin reads its files itself (`MessageSource.load()`: `lang -> key -> text`). `withDefaultLang(lang)` keeps a plugin's own `language` setting in place of Artisan's. Namespace `[a-z][a-z0-9_]*` (`IllegalArgumentException`), unique (`IllegalStateException`); a bundle goes when its owner disables.
- `MessageBundle.langOf(viewer)` picks among the bundle's languages: the asked one, else the bundle's default, else `en`; `fr` matches `fr_FR` and the reverse. `raw(lang, key)` falls back to the default, then `en`, then the key; `find(lang, key)` has no fallback. `format(template, placeholders)` replaces `<name>`, `{name}` and `%name%` for the names of the map in one pass, the value's tags escaped (a player-typed value cannot inject a click); other names stay (PlaceholderAPI's). `send(viewer, key[, placeholders])` sends `raw`, `format`, MiniMessage in the viewer's language; `legacy(lang | viewer, key, placeholders)` returns it as a `§` string (see `TextApi.legacy`). `get(...)` is `raw`, `format`, MiniMessage as an Adventure `Component`: Paper only, `@Sunset` since 2.10.0. `reload()` keeps the previous translations when the source fails.

| Member | Type | Since |
|---|---|---|
| `TranslationsApi.getDefaultLang()`, `langOf(sender)` | `String` | 2.5.0 |
| `TranslationsApi.register(declaration)`, `unregister(namespace)`, `bundle(namespace)`, `namespaces()` | | 2.5.0 |
| `MessageBundleDeclaration.files(owner, namespace, bundledLangs...)`, `of(owner, namespace, source)`, `withDefaultLang(lang)` | `MessageBundleDeclaration` | 2.5.0 |
| `MessageSource.load()` (`@FunctionalInterface`) | `Map<String, Map<String, String>>` | 2.5.0 |
| `MessageBundle.getNamespace()`, `getLanguages()`, `getDefaultLang()`, `langOf(viewer)`, `find`, `raw`, `format`, `get`, `reload()` | | 2.5.0 |
| `TranslationsApi.NOOP`, `ArtisanAPI.Builder.translations(translations)` (`@Internal`) | | 2.5.0 |
| `MessageBundle.send(viewer, key)`, `send(viewer, key, placeholders)` | `void` | 2.10.0 |
| `MessageBundle.legacy(lang, key, placeholders)`, `legacy(viewer, key, placeholders)` | `String` | 2.10.0 |

### `net.artisanmc.modules.api.text.TextApi` (`@Beta`, 2.10.0)

Text for players without Adventure types, so a plugin runs on Paper and Spigot alike. Input is MiniMessage, `§` codes accepted; malformed text degrades to plain text, never throws. Any thread.

- `send(to, miniMessage)`: parsed and sent.
- `legacy(miniMessage)`: a `§` string, `§x§r§r§g§g§b§b` for a hex color, for Bukkit's String methods (item names and lore, inventory, boss bar and title texts). Fonts, hover and click are lost.
- `plain(miniMessage)`: without formatting. `fromLegacy(legacy)`: a `§` string (an item's name read from Bukkit) as MiniMessage.

| Member | Type | Since |
|---|---|---|
| `TextApi.send(to, miniMessage)` | `void` | 2.10.0 |
| `TextApi.legacy(miniMessage)`, `plain(miniMessage)`, `fromLegacy(legacy)` | `String` | 2.10.0 |
| `TextApi.NOOP`, `ArtisanAPI.Builder.text(text)` (`@Internal`) | | 2.10.0 |

### `net.artisanmc.modules.api.action.ActionRegistry` and the action contract (`@Beta`, 2.0.0)

Every action of a chain, Artisan's own included, runs through this registry (ADR `extensible-document-kinds`, R1). A module registers its actions from `onEnable`; they are removed with the module. Names: `^[a-z][a-z0-9_]*(:[a-z][a-z0-9_]*)?$`, a module's namespaced (`quests:start`).

| Member | Type | Since |
|---|---|---|
| `ActionRegistry.register(decl)` (throws `DuplicateActionException`), `unregister(name)`, `find(name)`, `has(name)`, `names()`, `declarations()`, `registered()` | | 2.0.0 |
| `ActionDeclaration(name, handler)`, `(name, args, handler)`, `(name, args, primary, handler)` ; `getName()`, `getArgs()`, `getPrimary()`, `getHandler()`, `arg(name)` | `ActionDeclaration` | 2.0.0 |
| `ActionDeclaration.normalize(wire)` (null → `{}`, argument map → map, else `{primary: value}`), `bind(wire)` (+ declared defaults), `canonical(args)`, `toWire()` | `Map<String, Object>` / `Object` / `Map` | 2.0.0 |
| `ActionHandler.execute(ctx, args, runtime): ActionContext` (`@FunctionalInterface`) | `ActionContext` | 2.0.0 |
| `ActionContext.getPlayer()`, `getArgs()`, `getLang()`, `getProjectId()`, `withArgs(args)` | | 2.0.0 |
| `ActionRuntime.text(ctx, ltext)`, `run(ctx, chain)`, `warn(message)` | | 2.0.0 |
| `RegisteredAction.getDeclaration()`, `getModuleId()`, `toWire()` (`{name, args, primary?, module_id?}`, the `declared_actions` wire) | `RegisteredAction` | 2.0.0 |
| `ModelField(name, type[, required])`, `withDefault`, `withLabel`, `withHelp`, `withRequired`, `toWire()` | `ModelField` | 2.0.0 |
| `ModelFieldType.string()`, `number()`, `integer()`, `bool()`, `ltext()`, `minimessage()`, `minimessageMultiline()`, `item()`, `actions()`, `conditions()`, `list(of)`, `object(fields)`, `model(ref)`, `map(of)`, `enumOf(values)`, `union(tag, variants)`, `documentRef(kind)` ; `toWire()` (the editor's `ModelFieldType` shape) | `ModelFieldType` | 2.0.0 |
| `UnionVariant(name, fields)` | `UnionVariant` | 2.0.0 |
| `ArtisanAPI.Builder.actionRegistry(registry)` (`@Internal`) | `Builder` | 2.0.0 |

The three wire forms (`- name`, `- name: value`, `- name: {args}`) bind to one argument map: the scalar form binds `primary` (the only argument when there is exactly one, unless given). The runtime is tolerant (an unknown key is kept, an unknown name is skipped with a warning); the editor's form is strict.

### `net.artisanmc.modules.api.document.DocumentKindRegistry` and the document-kind contract (`@Beta`, 2.1.0)

Every kind of Document a project folder holds, Artisan's own (menu, command, dialog) included, is declared here (ADR `extensible-document-kinds`, decisions 1 and 10, W6). A module declares its kinds from `onEnable`; they are removed with the module. The folder is what tells a Document's kind on disk, so two kinds may not share a kind id or a folder. Kind ids: `^[a-z][a-z0-9_]*$`; folders: `^[a-z][a-z0-9_-]*$`.

A file of a declared kind is read by Artisan as a **raw document** (its YAML mapping, the file name as `id`, its `schema:` checked against the declared labels — an undeclared label is a loud reload error, like a core kind's), listed in the resource inventory, resolvable by reference, reported at Presence (`document_kinds`) and handed back to the module through `ProjectContentApi.documents(projectId, kind)`. What a Document of that kind *does* is the module's business: Artisan dispatches nothing for it.

| Member | Type | Since |
|---|---|---|
| `DocumentKindRegistry.register(decl)` (throws `DuplicateDocumentKindException` on a shared kind or folder), `unregister(kind)`, `find(kind)`, `byDir(dir)`, `has(kind)`, `declarations()` (registration order), `registered()` | | 2.1.0 |
| `DocumentKindDeclaration(kind, dir, schemaVersion)`, `(kind, dir, schemaVersions, idPrefix)` ; `getKind()`, `getDir()`, `getSchemaVersions()` (first = canonical), `getCanonicalSchema()`, `getIdPrefix()`, `acceptsSchema(schema)` (empty accepted), `toWire()` (`{kind, dir, schema_versions, id_prefix?}`) | `DocumentKindDeclaration` | 2.1.0 |
| `RegisteredDocumentKind.getDeclaration()`, `getModuleId()`, `toWire()` (+ `module_id?`, the `document_kinds` wire) | `RegisteredDocumentKind` | 2.1.0 |
| `DuplicateDocumentKindException` (extends `IllegalStateException`) | | 2.1.0 |
| `ProjectContentApi.documents(projectId, kind)` : the raw documents of a module kind as the last load read them (`id` = file name); `[]` for a core kind or an unknown project | `List<Map<String, Object>>` | 2.1.0 |
| `ArtisanAPI.Builder.documentKinds(registry)` (`@Internal`) | `Builder` | 2.1.0 |

```java
api.getDocumentKinds().register(new DocumentKindDeclaration("quest", "quests", List.of("quest/v1"), "quest_"));
// after api.getProject().reload(), or in onReload():
for (Map<String, Object> quest : api.getProject().documents(projectId, "quest")) { … }
```

### `net.artisanmc.modules.api.editor.EditorBundleRegistry` and the editor bundle contract (`@Beta`, 2.3.0)

A module may ship its **editor view** in its own jar (runtime module bundles, level 3; `modules.md` §4.6): one ES module script built against `@artisan/editor-sdk`, registered from `onEnable` and removed with the module. The bundle is reported at Presence on the module's `installed_modules` entry (`editor_bundle: {sdk, hash, size}`, protocol 1.2), served by the hub at `GET /api/v1/servers/:server/modules/:module/ui.js` and loaded by the editor against its SDK.

| Member | Type | Since |
|---|---|---|
| `EditorBundleRegistry.register(decl)` (owner = the module whose `onEnable` runs; outside one `IllegalStateException`, a second bundle for that module `DuplicateEditorBundleException`), `unregister(moduleId)`, `find(moduleId)` (nullable), `registered()` (module id → declaration, registration order) | | 2.3.0 |
| `EditorBundleDeclaration(script, sdk)` (UTF-8, non-empty, ≤ `MAX_SIZE` = 4 MiB; `sdk` `MAJOR.MINOR[.PATCH]`; else `IllegalArgumentException`), `fromResource(loader, path, sdk)` (missing resource: `IllegalArgumentException`) ; `getScript()` (copy), `getSdk()`, `getHash()` (lowercase hex SHA-256), `getSize()`, `toWire()` (`{sdk, hash, size}`) | `EditorBundleDeclaration` | 2.3.0 |
| `DuplicateEditorBundleException` (extends `IllegalStateException`) | | 2.3.0 |
| `ArtisanAPI.Builder.editorBundles(registry)` (`@Internal`) | `Builder` | 2.3.0 |

```java
api.getEditorBundles().register(
    EditorBundleDeclaration.fromResource(getClass().getClassLoader(), "artisan-editor/ui.js", "1.0"));
```

### `net.artisanmc.modules.api.template.TemplateRegistry` and the template contract (`@Beta`, 2.6.0)

A module may ship **templates**: example content (Documents, menus, `lang/` files…) it offers to copy into any Project, registered from `onEnable` and removed with the module (ADR `module-templates`). A template is announced at Presence on the module's `installed_modules` entry (`templates: [{id, title, version, seed_project?, files:[{path, hash, size}]}]`, protocol 1.3), without its content; the editor reads the files on demand (the default version, read-only), copies them into a Project, and compares a copy to the version shipped. A copy is never automatic and never overwrites the owner's edits unless they ask. A template with a seed project is copied once into a new Project of that name, the first start that knows it, and never again (`<core projects root>/.artisan-seeds.yaml`), even when the owner deletes it. When that name is the module's own folder (`moduleFolder`), the files go there instead, never overwriting one already present.

| Member | Type | Since |
|---|---|---|
| `TemplateRegistry.register(decl)` (owner = the module whose `onEnable` runs; outside one, or a second template with that id for that module, `IllegalStateException`), `find(moduleId, templateId)` (nullable), `of(moduleId)` (registration order), `registered()` (module id → declarations) | | 2.6.0 |
| `TemplateDeclaration.builder(id, version)` (`id` `^[a-z][a-z0-9_]*$`, `version` ≥ 1, raised each time the files change), `fromResources(loader, root, id, version, paths)` (missing resource: `IllegalArgumentException`); `Builder.title(title)`, `seed(projectId)` (`^[a-z0-9][a-z0-9_-]*$`), `file(path, bytes)` (relative `/` path of plain segments, no `..`, no leading dot, never `.artisan*`; ≤ `MAX_SIZE` = 4 MiB in all), `build()` | `TemplateDeclaration.Builder` | 2.6.0 |
| `TemplateDeclaration.getId()`, `getTitle()` (the id when none), `getVersion()`, `getSeedProject()` (nullable), `getPaths()`, `getFile(path)` (copy, nullable), `getHash(path)` (lowercase hex SHA-256, nullable), `toWire()`, `sha256(bytes)` | | 2.6.0 |
| `TemplateDeclaration.Builder.system()`, `isSystem()`: the files are the module's **system elements** (the menus and dialogs its code opens by id), kept in the module's first folder by name at every start and module arrival. A missing file is written again (unless a file of that name sits under the same kind folder elsewhere in the module: moved), an untouched copy of an earlier version is replaced, an edited one stays until the editor resets it (`template_copy` with `replace`, into the module's folder only: elsewhere `system_template`). Not with `seed(...)` (`IllegalArgumentException`). Presence adds `system: true` to the template | | 2.12.0 |
| `ArtisanAPI.Builder.templates(registry)` (`@Internal`) | `Builder` | 2.6.0 |

```java
api.getTemplates().register(TemplateDeclaration
    .fromResources(getClass().getClassLoader(), "artisan-templates/daily", "daily", 1,
        List.of("quest_groups/daily.yaml", "menus/quests_daily.yaml"))
    .title("Daily quests")
    .seed("quests")
    .build());
```

### `net.artisanmc.modules.api.playercommand.PlayerCommandRegistry` and the player command contract (`@Beta`, 2.7.0)

A module declares the commands players type: each root becomes a `command/v1` file of the module's first folder, `commands/<name>.yaml` (`commands/<name>_command.yaml`, its `name` written, when another Document of the module's templates holds that id, as a menu the command opens), kept there as a system element (template `player_commands`, generated by Artisan) and edited by the admin like any command (name and aliases, permission, description, cooldown, requirements and fallback, `enabled`, actions). Artisan registers it in the command map and refreshes the players' completion when it changes; a module without a folder has its commands registered as generated, in memory. The id `<module>:<name>` never changes; the command is reachable as `/<module>:<name>` while no other command holds that form, and a short name already taken (by an admin's `command/v1`, another module, another plugin) leaves only that form, with a warning. Distinct from `CommandRegistry`, which menus call through `run_command`. Design: `design-framework-commandes.md` (project files).

| Member | Type | Since |
|---|---|---|
| `PlayerCommandRegistry.register(decl)` (the root and its children; a taken id, `DuplicatePlayerCommandException`), `unregister(id)`, `declarations()` (roots, registration order), `find(id)` (root or child, nullable); owner = the module whose `onEnable` runs, else removed when the plugin that loaded its executor disables | | 2.7.0 |
| `PlayerCommandDeclaration.builder(id)` (`^[a-z0-9_]+:[a-z0-9_.-]+$`); `Builder.name`, `aliases`, `permission` (null: everyone), `description(Map<lang, text>)`, `argument`, `arguments`, `executor`, `consoleAllowed`, `child` (same namespace, distinct names), `build()` (neither executor nor child, a `TEXT` argument not last, a required argument after an optional one: `IllegalArgumentException`); getters, `namespace()` | | 2.7.0 |
| `CommandArgument.string`, `text` (rest of the line), `integer`, `player`, `world`, `choice(name, values)`, `optional()`; `CommandArgument.Type` | | 2.7.0 |
| `PlayerCommandExecutor.execute(context)`, run on the sender's thread once the permissions, requirements and cooldown of its command file pass; an exception is logged and the sender told (`cmd.failed`) | | 2.7.0 |
| `PlayerCommandContext`: `getCommandId()`, `getSender()`, `getPlayer()` (null for the console), `getLanguage()`, `getArguments()`, `get(name, type)` | | 2.7.0 |
| `PlayerCommandRegistry.onChange(callback)`, `ArtisanAPI.Builder.playerCommands(registry)` (`@Internal`) | | 2.7.0 |
| `PlayerCommandDeclaration.Builder.opensMenu(menuRef)`, `getOpensMenu()`: the command opens that menu (Action DSL ref, `folder:menu` or a bare id resolved server-wide) instead of running an executor, its arguments as the menu's context; player-only. `build()` refuses an executor and a menu together, and a menu with `consoleAllowed(true)` (`IllegalArgumentException`). The editor draws the link on the board | | 2.11.0 |

```java
api.getPlayerCommands().register(PlayerCommandDeclaration.builder("attribution:open")
    .name("attribution")
    .permission("artisanattribution.command")
    .description(Map.of("en", "How did you find the server?", "fr", "Comment as-tu connu le serveur ?"))
    .executor(ctx -> service.openOwn(ctx.getPlayer()))
    .build());
```

The generated file's actions are `module_command: <id>` (the module's code) or `open_menu: <menuRef>` (a command that opens a menu); each child is a node of `subcommands`, and `console: true` stands for `consoleAllowed`. The admin's edits stay theirs: the file follows the module only while untouched, and Reset puts the module's version back. The action `module_command` (`command`, `args`, owner `artisan` in `api.actionRegistry`) runs the declared command's code: an argument absent from `args` takes the bound value of its name (the command's own, parsed from what was typed), `{name}` alone passes a bound value as is, and a call from elsewhere (a menu button) checks the permissions the command's file sets on the way to it. The console runs a node marked `console: true` whose actions are one `module_command`, when the module allows it. The former `command_override/v1` files are merged once into the commands' files and moved to `.artisan/migrated/overrides-command/`. None of this changes the API: it is the `command/v1` format and the action vocabulary.

### `net.artisanmc.modules.api.model.ModelRegistry` (`@Beta`)

`api.models.declare(model)` — declares a Data model, typed: a `ModelDeclaration(id, keyField, fields)` (namespaced `id` (`ns:model`), `List<ModelField>`), with `withName`, `withVersion(version[, migrations])` (monotonic version, declarative `ModelMigration(from, to, steps)` whose `MigrationStep`s are `renameField`, `setDefault`, `renameEnumValue`, `renameVariant`, each with an optional `path`) and `withMasterDetail`. Its `toWire()` is the `model/v1` document (`schema`, `id`, `name?`, `key_field`, `fields`, `version?`, `master_detail?`, `migrations?`). Pure passthrough: nothing is interpreted plugin-side — the documents are reported at Presence (`hello.declared_models` / `modules_changed`) and consumed by the editor, which renders the schema-driven form and treats the shape as read-only for the admin (ADR `composable-data-models` §4/§5). Duplicate id or non-namespaced id throws at declare time. `has(id)`, `declared()` (sorted). Since 1.5.0; typed since 2.0.0.

```java
api.getModels().declare(new ModelDeclaration("boutique:item", "id", List.of(
        new ModelField("id", ModelFieldType.string(), true).withLocked(true),
        new ModelField("name", ModelFieldType.ltext()),
        new ModelField("price", ModelFieldType.number()).withRange(0.0, null)))
    .withName("Item")
    .withVersion(2, List.of(new ModelMigration(1, 2, List.of(MigrationStep.renameField("cost", "price"))))));
```

| Member | Type | Since |
|---|---|---|
| `declare(document: Map)` (`@Sunset`, removed in 3.0.0: use `declare(ModelDeclaration)`), `has(id)`, `declared()` | | 1.5.0 |
| `declare(ModelDeclaration)`, `declare(id, keyField, fields)` | | 2.0.0 |
| `ModelDeclaration(id, keyField, fields)`, `withName`, `withVersion(version)`, `withVersion(version, migrations)`, `withMasterDetail`, getters, `toWire()` | `ModelDeclaration` | 2.0.0 |
| `ModelMigration(from, to, steps)`, `toWire()` | `ModelMigration` | 2.0.0 |
| `MigrationStep.renameField`, `setDefault`, `renameEnumValue`, `renameVariant` (each with an optional `path`), `getOp()`, `toWire()` | `MigrationStep` | 2.0.0 |
| `ModelField.withSection`, `withRange(min, max)`, `withPattern`, `withLocked` and their getters (the rest of the `model/v1` field hints) | `ModelField` | 2.0.0 |

### `net.artisanmc.modules.api.screen.EditorScreenRegistry` (`@Beta`)

`api.screens.declare(id, label, table, projectId)` — declares a **Config screen**: a named entry in the editor's sidebar under the module, whose core-generated form edits one declared-model Table/Config of the module's owned Project, live over the WS relay (ADR `module-config-screens` §2/§3). `id` must be namespaced (`boutique:catalog`); `table` is a Project-relative path (`data/categories`) — absolute paths, `..` and a first segment starting with `.artisan` are rejected at declare time, as is a duplicate id. Pure passthrough: nothing is interpreted plugin-side — the declarations are reported at Presence (`hello.editor_screens` / `modules_changed`) and the editor mounts the entries. A module that declares models + owns a Project but no screen gets a fallback "Données" screen synthesized by the editor. `declared()` (sorted by id). Since 1.6.0.

`declare(id, label, table, projectId, component)` (2.7.0) names the module's own view of the screen: a key of its `FrontendModule.screens` (`@artisan/editor-sdk` 1.6.0, `^[a-z][a-zA-Z0-9_-]*$`, `IllegalArgumentException` otherwise), reported as `component` in `editor_screens`. The editor renders that view in place of the generated form and keeps the read, Save, the YAML tab and the file's history; a bundle without that key gets the generated form. `EditorScreenDeclaration.getComponent()` (nullable), 2.7.0.

### `net.artisanmc.modules.api.database.DatabaseApi` (`@Beta`)

`api.database.dataSource(plugin)` — the database lent to the plugins of the suite (ADR `suite-foundation-database`): one HikariCP pool **per plugin**, opened on the first call (it checks a connection, so call it from `onEnable`), returned as is afterwards, closed 5 seconds after that plugin is disabled (its `onDisable` can still save; a reloaded plugin gets the same pool back). Credentials are set once by the admin in `plugins/Artisan/environment.yml`; only `javax.sql.DataSource` crosses the boundary, the plugin brings its own access layer and migrations. `dialect` (`DatabaseDialect`: `H2`, `MYSQL`, `MARIADB`, Java enum) lets a plugin branch on the few statements that differ. All plugins share one database (the configured MySQL/MariaDB one, or a single H2 file): a plugin names every table, index and constraint it creates `tablePrefix(module) + name`, where `tablePrefix("quests")` is `database.table-prefix` (`artisan_` by default, `getTablePrefix()`) + `quests_`. `module` is one lower-case word, not a first segment of Artisan's own tables (`servers`, `meta`, `versions`, `drafts`, `editor`…), else `IllegalArgumentException`; an invalid `table-prefix` throws it too. Misconfiguration or an unreachable server throws `IllegalStateException` naming the plugin and the file to fix. Default `DatabaseApi.NONE` throws on every call. Since 1.7.0; a single shared H2 file since 1.7.1 (1.7.0 kept one file per plugin).

| Member | Type | Since |
|---|---|---|
| `ArtisanAPI.database` | `DatabaseApi` | 1.7.0 |
| `dialect` | `DatabaseDialect` | 1.7.0 |
| `dataSource(owner: Plugin)` | `javax.sql.DataSource` | 1.7.0 |
| `getTablePrefix()` | `String` | 2.9.0 |
| `tablePrefix(module: String)` | `String` | 2.9.0 |

### `net.artisanmc.modules.api.menu.MenuApi` (`@Beta`)

`api.menus` — open, close and query a player's Artisan menu, and listen to menus opening, clicks and closes. A menu is named by `MenuRef(projectId?, menuId)` (`toString()` = `project:menu`, `MenuRef.parse`) or by the same text ref the Action DSL takes (`shop:main`, or a bare id resolved server-wide). Callable from any thread: `open`/`close` run on the player's region thread (scheduled if needed); `open` returns false, opening nothing, when no menu matches. Listeners (`fun interface`s) return a `MenuSubscription` whose `cancel()` removes them, and run on the player's region thread. Implemented in `paper` by `PaperMenuApi` over the menu provider, the session store and `MenuEventDispatcher`.

| Member | Type | Since |
|---|---|---|
| `ArtisanAPI.menus` | `MenuApi` | 1.8.0 |
| `open(player, menu: MenuRef, args: Map<String, Any>)` | `Boolean` | 1.8.0 |
| `open(player, ref: String, args: Map<String, Any>)` | `Boolean` | 1.8.0 |
| `open(player, ref: String)` | `Boolean` | 1.8.0 |
| `close(player)` | `Unit` | 1.8.0 |
| `openMenu(player)` | `MenuRef?` | 1.8.0 |
| `menus()` | `List<MenuRef>` | 1.8.0 |
| `onOpen(MenuOpenListener)`, `onClick(MenuClickListener)`, `onClose(MenuCloseListener)` | `MenuSubscription` | 1.8.0 |
| `MenuRef(projectId: String?, menuId: String)`, `MenuRef.parse(ref)` | — | 1.8.0 |
| `NOOP` | `MenuApi` | 1.8.0 |

### Menu events (`@Beta`)

`MenuOpenEvent`, `MenuClickEvent`, `MenuCloseEvent` — Bukkit `PlayerEvent`s (with `getHandlerList()`), passed to the `MenuApi` listeners first, then fired through Bukkit's plugin manager, on the player's region thread. Open fires before rendering (cancel = nothing opens; history untouched); click fires on the tick after the click, before the slot's actions (cancel = actions skipped); close fires from `InventoryCloseEvent`. A menu opened over another fires the new open, then the old close (`OPEN_NEW`); repaints (pagination, `set`) do the same. They live in the API so non-add-on plugins can listen.

| Member | Type | Since |
|---|---|---|
| `MenuOpenEvent.menu`, `.args` | `MenuRef`, `Map<String, Any>` | 1.8.0 |
| `MenuClickEvent.menu`, `.slot`, `.click`, `.hasActions` | `MenuRef`, `Int`, `ClickType`, `Boolean` | 1.8.0 |
| `MenuClickEvent.hasActions()` is the Java name of the flag (was `getHasActions()`) | | 2.0.0 |
| `MenuCloseEvent.menu`, `.reason` | `MenuRef`, `InventoryCloseEvent.Reason` | 1.8.0 |
| `MenuCloseEvent.closeReason`, constructor `(player, menu, MenuCloseReason)`; `MenuCloseReason` (Paper's names, `UNKNOWN` on Spigot, `named(name)`) | `MenuCloseReason` | 2.10.0 |

### `net.artisanmc.modules.api.scheduler.SchedulerApi` (`@Beta`)

`api.scheduler.forPlugin(owner)` — a `TaskScheduler` backed by the core `Scheduler` port (`RegionizedScheduler` on Paper/Folia/Leaf, `BukkitTaskScheduler` otherwise), whose tasks belong to `owner`. Global, region (`Location`), entity (skipped if removed) and async threads, each immediate or delayed (ticks; 0 = as soon as possible); `isOwnedByCurrentThread(entity)`, `isGlobalThread()`. No cancellation handle, no repeating tasks — Paper's schedulers remain available for those. `DIRECT` runs everything inline (tests).

| Member | Type | Since |
|---|---|---|
| `ArtisanAPI.scheduler` | `SchedulerApi` | 1.8.0 |
| `forPlugin(owner: Plugin)` | `TaskScheduler` | 1.8.0 |
| `TaskScheduler.runGlobal`, `runGlobalLater`, `runAt`, `runAtLater`, `runFor`, `runForLater`, `runAsync`, `runAsyncLater` | `Unit` | 1.8.0 |
| `TaskScheduler.isOwnedByCurrentThread(entity)`, `isGlobalThread()` | `Boolean` | 1.8.0 |

### `net.artisanmc.modules.api.placeholder.PlaceholderRegistry` (`@Beta`)

`api.placeholders.register(namespace, resolver[, exposeToPapi])` — every `%<namespace>_<key>%` in menu text, action text and conditions asks the `PlaceholderResolver` (`resolve(player: Player?, key): String?`; null leaves the token as written). Resolved in Artisan's own `%…%` step (the `PapiProvider` the renderer, executor and condition evaluator use) before PlaceholderAPI, so it works without PlaceholderAPI. `exposeToPapi = true` with PlaceholderAPI enabled also registers an expansion of that identifier. Namespace `[a-z][a-z0-9]*` (`IllegalArgumentException`), unique (`IllegalStateException`). `unregister`, `namespaces()`, `resolve(player, text)`. Not yet reported to the editor's placeholder autocompletion.

| Member | Type | Since |
|---|---|---|
| `ArtisanAPI.placeholders` | `PlaceholderRegistry` | 1.8.0 |
| `register(namespace, resolver)`, `register(namespace, resolver, exposeToPapi)` | `Unit` | 1.8.0 |
| `unregister(namespace)` | `Unit` | 1.8.0 |
| `namespaces()` | `Set<String>` | 1.8.0 |
| `resolve(player, text)` | `String` | 1.8.0 |
| `PlaceholderResolver.resolve(player: Player?, key)` | `String?` | 1.8.0 |

### `net.artisanmc.modules.api.datasource.Stability`

Declared (not inferred) axis of a data source. `STATIC` = a stable, enumerable key-set (`fetcher(null)` returns the authoritative rows, each identified by `keyField`) — placeable in a menu's placement mode. `DYNAMIC` (default) = runtime/player-dependent, unbounded — pagination only.

Values: `STATIC`, `DYNAMIC`.

### `net.artisanmc.modules.api.datasource.FieldKind` (`@Sunset`, removed in 3.0.0)

Enum describing the type of a declared data-source row field before 2.0.0. Replaced by `ModelFieldType` (`new DataSourceField(name, ModelFieldType)`): one vocabulary for data source rows, Data models and Action arguments.
`ITEM` declares a complete item value (reference or structured material/quantity/metadata), exposed as `item` in source schemas. The editor offers these fields in **Displayed item → Use an item from data**. Text fields remain `STRING`.

Values: `STRING`, `NUMBER`, `INTEGER`, `BOOLEAN`, `LIST`, `OBJECT`, `ITEM`.

| `FieldKind` | `ModelFieldType` (`toModelFieldType()`) | wire `type` |
|---|---|---|
| `STRING` | `string()` | `string` |
| `NUMBER` | `number()` | `number` |
| `INTEGER` | `integer()` | `integer` |
| `BOOLEAN` | `bool()` | `boolean` |
| `LIST` | `list(string())` (1.x did not type the elements) | `list` |
| `OBJECT` | `object([])` (nor the fields) | `object` |
| `ITEM` | `item()` | `item` |

`FieldKind.closestTo(type)` goes the other way for `DataSourceField.getType()`: `ltext`, `minimessage*`, `enum` and `document_ref` read as `STRING`, `actions` and `conditions` as `LIST`, `map`, `model` and `union` as `OBJECT`. `toModelFieldType()` and `closestTo` since 2.0.0.

### `net.artisanmc.modules.api.datasource.DataSourceField`

One declared row field in a data source's schema.

| Member | Type | Since |
|---|---|---|
| `name` | `String` | 1.3.0 |
| `type` | `FieldKind` (`@Sunset`: the closest kind of `fieldType`) | 1.3.0 |
| `description` | `String?` | 1.3.0 |
| `fieldType` | `ModelFieldType` | 2.0.0 |

The `data_sources` wire reports `schema[].type` as `fieldType.kind`: the same strings as 1.x for a field declared with a `FieldKind`, and the richer kinds (`ltext`, `enum`, `map`…) for a `ModelFieldType` one.

### `net.artisanmc.modules.api.datasource.RegisteredDataSource`

A `DataSourceDeclaration` paired with its owning module id. Returned by `DataSourceRegistry.registered()`.

| Member | Type | Since |
|---|---|---|
| `declaration` | `DataSourceDeclaration` | 1.3.0 |
| `moduleId` | `String?` | 1.3.0 |

`moduleId` is non-null when the data source was registered from a module's `onEnable`, null for third-party registrations via ServicesManager.

### `net.artisanmc.modules.api.datasource.PlayerRequiredException`

Exception thrown by a `DataSourceDeclaration.fetcher` when it cannot produce meaningful rows without a real player (e.g., inventory-dependent data). The editor catches this on preview mode and surfaces a typed `player_required` error instead of crashing.

Since 1.3.0.

### `net.artisanmc.modules.api.command.CommandRegistry`

| Member | Type | Since |
|---|---|---|
| `register(decl: CommandDeclaration)` | `Unit` | 1.0.0 |
| `dispatch(name: String, player: Player, args: Map<String, Any?>)` | `Unit` | 1.0.0 |
| `has(name: String)` | `Boolean` | 1.0.0 |
| `names()` | `Set<String>` | 1.0.0 |
| `unregister(name: String)` | `Boolean` | 1.8.0 |

Exceptions: `UnknownCommandException`, `DuplicateCommandException`.

Commands registered from a module's `onEnable` record that module since 1.8.0, so `ModuleRegistry.unregister` removes them.

Runtime consumer (since 1.2.0): `run_command … as player` actions whose command starts with a `namespace:name` ref registered here are dispatched to the module handler with `args = {argv: List<String>, raw: String}`. Unknown refs fall back to Bukkit; `as console` always goes to Bukkit. The ref matches ignoring case (exact match first), and `argv` honours double quotes (`"Diamond Sword"`, `\"` and `\\` escapes; an unbalanced quote falls back to splitting on spaces) — plugin behaviour, not an API change.

### `net.artisanmc.modules.api.event.ModuleEventBus`

| Member | Type | Since |
|---|---|---|
| `subscribe(type: Class<out ModuleEvent>, handler: ModuleEventHandler)` | `Unit` | 1.0.0 (signature 1.5.0) |
| `publish(event: ModuleEvent)` | `Unit` | 1.0.0 |

There is no unsubscribe: when a plugin disables, Artisan removes the handlers its classes registered (`@Internal unsubscribeLoadedBy`), as it does for its `api.menus` listeners and `api.placeholders` namespaces.

Event types: `DataReloadEvent`, `ConfigReloadEvent`. Add-ons may define their own events by implementing `ModuleEvent`, an open interface since 1.8.0 (sealed before: add-on events did not compile).

- `ConfigReloadEvent("menus")` is published by Artisan after every content reload, after the modules' `onReload()`.
- `DataReloadEvent` is never published nor consumed by Artisan (menus re-fetch their sources on every render): it is for add-ons that cache another add-on's rows.

### `net.artisanmc.modules.api.schemas.SchemaRegistry<T>`

| Member | Type | Since |
|---|---|---|
| `register(migration: SchemaMigration<T>)` | `Unit` | 1.0.0 |
| `loadToCurrent(data: T, currentVersion: String, versionOf: SchemaVersionReader<T>)` | `T` | 1.0.0 (type 1.5.0) |
| `has(from: String)` | `Boolean` | 1.0.0 |

Exceptions: `UnsupportedSchemaVersionException`, `CircularMigrationException`.

### `net.artisanmc.modules.api.schemas.SchemaMigration<T>`

| Member | Type | Since |
|---|---|---|
| `from` | `String` | 1.0.0 |
| `to` | `String` | 1.0.0 |
| `migrate(data: T)` | `T` | 1.0.0 |

Migrations MUST be pure, idempotent, and write-once. See `versioning.md` §2.5.

### `net.artisanmc.modules.api.project.ProjectContentApi`

Read-only project content (`plugins/Artisan/modules/` and the registered roots), as the last load read it: `list` and `read` answer from the loaded snapshot, without a lock or a disk walk; a Project not loaded yet (a folder registered a moment ago) and a file the snapshot lacks (one the module just wrote, before its `reload()`) are read from the disk. The `.artisan*` namespace is never exposed. Re-read in `onReload()` after a sync.

| Member | Type | Since |
|---|---|---|
| `projectIds()` | `List<String>` | 1.2.0 |
| `list(projectId: String, dir: String)` | `List<String>` | 1.2.0 |
| `read(projectId: String, relPath: String)` | `String?` | 1.2.0 |
| `hasContent(dir: String)` | `Boolean` | 1.2.0 |
| `reload()` | `Unit` | 1.6.0 — asynchronous since 1.8.0: the disk is read on Artisan's reload thread, and modules' `onReload()` follows on the global thread |
| `documents(projectId: String, kind: String)` (`@Beta`) | `List<Map<String, Object>>` | 2.1.0 — see `DocumentKindRegistry` |

### `net.artisanmc.modules.api.project.ProjectRootRegistry`

Lets an Add-on host its Project in its **own plugin dir** instead of the core `plugins/Artisan/modules/` (ADR `addon-owned-project-roots`). Call once from `onEnable(api)`.

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
| `registerConfig(projectId: String, dir: File, moduleId: String)` (`@Beta`): a root holding the module's configuration (a singleton edited by its screens), reported with `role: config` in `project_roots`; read, published and versioned like any Project, listed under the module and not among Projects | `Unit` | 2.7.0 |
| `moduleFolder(folder: String, moduleId: String, legacyDir: File?)` (`@Beta`): `plugins/Artisan/modules/<folder>/`, created if missing and registered like `register(folder, …, moduleId)` (key `addon:<folder>`, not renamable). `legacyDir` moves there once when the folder does not exist; while both hold files, or when the move fails, `legacyDir` stays registered and is returned (SEVERE). `folder` matches `^[a-z0-9][a-z0-9_-]*$`, else `IllegalArgumentException`. The default method (a registry other than Artisan's) registers `legacyDir` and returns it, and throws `UnsupportedOperationException` without one | `File` | 2.8.0 |
| Reload deferred to the next tick | | 1.8.0 |

Projects merge into modules (one folder of `plugins/Artisan/modules/` per module): a new add-on calls `moduleFolder` and reads its files from the returned directory; an add-on that registered a root passes it as `legacyDir`, with the project id it used as `folder`, so its Versions, drafts and qualified references (`<folder>:<id>`) follow.

Registering reloads the projects on the next server tick, once the caller's `onEnable` has returned: bootstrap content written after `register` is read, and the `onReload()` of the module owning the root runs then (it used to be every module's). That reload reads the registered roots only, and the roots registered before that tick make one. Before 1.8.0 the reload ran inside `register`, calling the add-on's own `onReload()` while its `onEnable` was still running, and files written afterwards stayed invisible until `project.reload()`.

### `net.artisanmc.modules.api.SemVer`

| Member | Type | Since |
|---|---|---|
| `satisfies(core: String, min: String)` | `Boolean` — same major and `core >= min`; a `-SUFFIX` is ignored | 1.1.0 |

## Beta APIs (may change)

None at this time.

## Deprecated APIs

| Member | Sunset since | Removed in | Replacement |
|---|---|---|---|
| `DataSourceDeclaration.schemaHint` | 1.3.0 | 2.0.0 (done) | `schema` |
| `ModuleMessagesApi`, `ArtisanAPI.messages` | 1.8.0 | 2.0.0 (done) | none — nothing receives the messages |

Deprecated (`@Deprecated`), kept with no removal planned (decision of 2026-10-21: Artisan bundles Adventure, so nothing forces an API 3.0 for Spigot): `MessageBundle.get(...)` (use `send`, `legacy`, or `raw` + `format`), `MenuCloseEvent.getReason()` and its constructor with `InventoryCloseEvent.Reason` (use `getCloseReason()` and the constructor with `MenuCloseReason`). `getReason()` exists only on Paper (Spigot lacks Paper's type). `get` works on Spigot too, since Artisan bundles Adventure, but a plugin cannot send its `Component` there itself: Spigot has no `sendMessage(Component)`.

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

The publication carries a sources jar (Javadoc) and a POM with no dependency: the surface is Java (2.0.0; the 1.x POM declared `kotlin-stdlib`). License: GPL-3.0, like the repo. External module plugins declare it as `compileOnly` (the jar is provided by the running Artisan plugin at runtime):

```kotlin
// build.gradle.kts
repositories { maven("https://repo.artisanmc.net/releases") }
dependencies { compileOnly("net.artisanmc:artisan-core-api:<version>") }
```

`./gradlew publishToMavenLocal` still works for testing an unreleased API change against an add-on; CI runs `publishCoreApiPublicationToMavenLocal` so a broken publication fails the PR.

The artifact contains only the `net.artisanmc.modules.api.*` packages filtered through `apiJar`. Nothing under `net.artisanmc.plugin.*` is included.

## Protocol surfaces

- **WebSocket** : the hub ↔ server protocol carries `protocol_version` (`"1.3"`, major.minor) in the hello message; a different major is refused, unknown message types are ignored. See `versioning.md` §4 and `ws-protocol.md`.
- **REST API** : versioned under `/api/v1/*`, served by the hub to the editor shipped in the same jar. See `versioning.md` §5.
- **YAML schemas** : `manifest/v1`, `menu/v1`, `command/v1`, `dialog/v1`. Plugin `ProjectReader` rejects unsupported versions; the schema migration framework brings legacy data forward when newer versions ship.
- **Database** : each suite plugin migrates its own tables through `DatabaseApi`, named with `tablePrefix(module)`. See `versioning.md` §6.
