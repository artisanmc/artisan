---
title: Modules
description: Implement ArtisanModule — lifecycle, commands, project files, and your own project root.
---

A **module** is the unit of integration. Implementing `ArtisanModule` gets your
plugin a lifecycle tied to Artisan's own (enable, disable, hot-reload after a
sync), attribution in the editor UI, and access to project content on disk.

## The contract

```kotlin
class MyModule(private val plugin: MyPlugin) : ArtisanModule {
    override val id = "myplugin"            // lowercase, used as data source namespace
    override val schemaVersion = "myplugin/v1"

    private lateinit var api: ArtisanAPI

    override fun onEnable(api: ArtisanAPI) {
        this.api = api
        api.dataSources.register(/* … */)
        api.commands.register(/* … */)
        loadFromProject()
    }

    override fun onReload() = loadFromProject()  // called after every disk sync

    override fun onDisable() {
        // release listeners, executors, threads
    }
}
```

```java
public final class MyModule implements ArtisanModule {
    @Override public String getId() { return "myplugin"; }
    @Override public String getSchemaVersion() { return "myplugin/v1"; }
    @Override public void onEnable(ArtisanAPI api) { /* … */ }
    @Override public void onReload() { /* … */ }
    @Override public void onDisable() {}
}
```

## Register it

From your plugin's `onEnable`, after obtaining the API handle:

```kotlin
api.modules.register(MyModule(this))
```

The registry calls your `onEnable(api)` immediately, on the main thread, and
notifies the backend — your module (and everything it declared) shows up in the
editor without a reconnect. Registering the same `id` twice throws
`DuplicateModuleException`.

**Order matters.** Anything you want attributed to your module — data sources,
declared models, config screens — must be declared inside `onEnable(api)`. The
registry tracks ownership only for that window.

## Lifecycle

| Hook | When | What to do |
|---|---|---|
| `onEnable(api)` | Once, at registration | Declare everything, read initial project content |
| `onReload()` | After every project sync from the editor, and on `/artisan reload` | Re-read project files, rebuild caches |
| `onDisable()` | Plugin disable | Release listeners, executors, threads |

`onReload()` is the one people forget. Admins edit in the browser, the change
lands on disk seconds later, and your in-memory state is stale until you re-read.

## Read project content

`api.project` is a read-only view of project files on disk, with `/` separators.
The `.artisan*` namespace (sync metadata, trash) is never exposed.

```kotlin
for (pid in api.project.projectIds()) {
    val rows = api.project.list(pid, "data/categories")     // relative paths, sorted
        .filter { it.endsWith(".yaml") }
    for (rel in rows) {
        val yaml = api.project.read(pid, "data/categories/$rel") ?: continue
        // parse and cache
    }
}
```

`hasContent(dir)` is a cheap bootstrap check: "does any project already have a
non-empty `<dir>/`?" — use it to decide whether to write your default content.

Re-read in `onReload()`; never cache a file handle.

## Commands callable from menus

Register a handler and menu buttons can call it through a `run_command` action
using your `namespace:name` ref:

```kotlin
api.commands.register(CommandDeclaration("myplugin:teleport") { player, args ->
    val argv = args["argv"] as? List<*> ?: emptyList<String>()
    // …
})
```

```java
api.getCommands().register(new CommandDeclaration("myplugin:teleport", (player, args) -> {
    handle(player, args);
    return kotlin.Unit.INSTANCE;
}));
```

Handlers receive `args = {argv: List<String>, raw: String}`. A `run_command`
action whose command does not match a registered ref falls through to Bukkit, so
your ref never shadows a real command.

## Own your project root

By default a project lives in `plugins/Artisan/projects/<id>/`. An Add-on can
host its own project inside **its** plugin folder instead — admins then find your
configuration where they expect it, and uninstalling your plugin takes its
content with it.

```kotlin
val projectDir = File(dataFolder, "editor")
api.projectRoots.register("myplugin_shop", projectDir)
```

Register it **before** writing any bootstrap content, and once per boot.

:::caution[Use a dedicated directory]
Never pass your plugin's data-folder root. Sync deletes any file under a project
directory that is not part of the bundle — point it at a subdirectory that holds
nothing but that project's files (`plugins/MyPlugin/editor/`, not
`plugins/MyPlugin/`).
:::

### Ship default content

On first boot, write a starter project so admins open the editor to something
real rather than an empty canvas — a manifest, a menu or two, and your data
files. Write to a temporary sibling directory and rename atomically, so a failed
write never leaves a half-populated project that blocks every future retry:

```
plugins/MyPlugin/editor/
  manifest.yaml
  menus/shop_main.yaml
  data/categories/weapons.yaml
  lang/en.yaml
```

Artisan picks the directory up, hashes it, and pushes it to the editor on the
next sync.

## React to other modules

```kotlin
api.events.subscribe<DataReloadEvent> { event ->
    if (event.dataSourceRef == "boutique:items") invalidateCache()
}
api.events.publish(ConfigReloadEvent("myplugin"))
```

Two event types ship with the core — `DataReloadEvent(dataSourceRef)` and
`ConfigReloadEvent(moduleId)`. You may publish your own `ModuleEvent` subtypes;
subscribers that do not know the type simply do not receive it.

The event bus and the two registries are the **only** sanctioned channels
between modules. No module ever imports another module's classes.

## Beta helpers

- **`api.items`** — `serialize(stack)` returns the canonical YAML Artisan stores
  under `items/<id>.yml`; `describe(stack)` returns the display descriptor
  (material or custom ref, head texture, enchanted, count, name). Use both to
  build a "capture the item in my hand" admin command whose result the editor
  renders correctly.
- **`api.messages.send(type, payload)`** — fire-and-forget message to the
  backend, routed by `type` to your module's backend layer. No-op while
  disconnected, so word your UX accordingly ("the update lands in a few
  seconds").
- **`api.actions.execute(player, actions, args, projectId)`** — run an
  [Action DSL](/wiki/editor/data-sources/#action-fields--the-action-dsl) string on
  behalf of a player: the chain an admin authored on a row (an item's on-buy,
  say) after your own logic succeeded. Runs on the main thread; `args` become
  `{name}` placeholders; passing `projectId` puts that project's `lang/` files in
  scope so `@key` messages resolve. Malformed input is skipped with a warning —
  bad admin data never breaks your transaction.

## Schema migrations

When your own YAML shape changes, register a migration instead of breaking
existing installs:

```kotlin
api.schemas.register(object : SchemaMigration<MutableMap<String, Any?>> {
    override val from = "myplugin/v1"
    override val to = "myplugin/v2"
    override fun migrate(data: MutableMap<String, Any?>) = data.apply { /* … */ }
})
```

Migrations must be pure, idempotent, and write-once — never edit a shipped
migration, add the next one.
