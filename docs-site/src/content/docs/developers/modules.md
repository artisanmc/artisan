---
title: Modules
description: Implement ArtisanModule — registration, lifecycle, reading project files, owning a project directory and shipping default content.
sidebar:
  order: 4
---

A **module** is your plugin's identity inside Artisan. Implementing
`ArtisanModule` gets you:

- a listing in the editor (the server reports its active modules, and the
  editor groups your data sources, models and screens under your module);
- attribution: everything you declare in `onEnable(api)` is tagged with your
  module id;
- a reload hook, called every time project content changes on disk.

## The contract

```kotlin
class HomesModule(private val plugin: HomesPlugin) : ArtisanModule {
    override fun getId() = "homes"                 // lowercase; also your namespace
    override fun getSchemaVersion() = "homes/v1"   // the shape of your own files

    private lateinit var api: ArtisanAPI

    override fun onEnable(api: ArtisanAPI) {
        this.api = api
        api.dataSources.register(/* … */)
        api.commands.register(/* … */)
        loadFromProject()
    }

    override fun onReload() = loadFromProject()

    override fun onDisable() {
        // stop your tasks, close what you opened
    }

    private fun loadFromProject() { /* read files, rebuild caches */ }
}
```

```java
public final class HomesModule implements ArtisanModule {
    private final HomesPlugin plugin;
    private ArtisanAPI api;

    public HomesModule(HomesPlugin plugin) { this.plugin = plugin; }

    @Override public String getId() { return "homes"; }
    @Override public String getSchemaVersion() { return "homes/v1"; }

    @Override public void onEnable(ArtisanAPI api) {
        this.api = api;
        // register data sources, commands…
        loadFromProject();
    }

    @Override public void onReload() { loadFromProject(); }   // optional since API 1.8.0
    @Override public void onDisable() {}

    private void loadFromProject() { /* … */ }
}
```

| Member | Meaning |
|---|---|
| `id` | Lowercase module id (`boutique`, `homes`). Use the same string as the namespace of your refs: `homes:list`, `homes:teleport` |
| `schemaVersion` | The version of the YAML shape your module understands (`homes/v1`). Informational; pair it with [schema migrations](#migrate-your-own-yaml) |

## Register it

From your plugin's `onEnable`, once you have the [API handle](/wiki/developers/setup/#get-the-api-handle):

```kotlin
api.modules.register(HomesModule(this))
```

`register` calls your `onEnable(api)` **immediately and synchronously**, then
tells the editor that the module list changed — connected editors pick up your
module, sources, models and screens without reconnecting.

- Registering an id twice throws `DuplicateModuleException`.
- `api.modules.unregister("homes")` (Since 1.8.0) calls your `onDisable()` and
  removes the module with the data sources, commands, models and screens it
  declared in `onEnable(api)`. You rarely need it: Artisan does it when your
  plugin disables.
- `api.modules.has("boutique")` and `api.modules.active()` let you check for
  other modules (to integrate with them only when present).

**Declare inside `onEnable(api)`.** The registries record which module owns a
data source, command, model or screen only while your `onEnable(api)` runs.
Registered elsewhere, a data source shows up as unattributed and a model or
screen has no owner in the editor.

## Lifecycle

| Hook | When | Do |
|---|---|---|
| `onEnable(api)` | Once, inside `api.modules.register` | Declare everything, load initial content |
| `onReload()` | After the projects are re-read from disk: a publish from the editor, `/artisan reload`, a sync on a network leaf, a module calling `api.project.reload()` or registering a project root | Re-read your files, rebuild caches |
| `onDisable()` | When **your plugin** starts disabling (server stop, `/reload`, a plugin reloader), before your plugin's own `onDisable()`; on `api.modules.unregister`; or when Artisan disables | Release threads, executors, connections |

`onReload()` is the hook people forget. Admins edit in the browser, publish,
and the files on disk change; until you re-read them, your plugin serves stale
data. An exception thrown from `onReload()` is caught and ignored, so log your
own failures.

:::note[When your plugin disables]
Since API 1.8.0, as soon as your plugin starts disabling, Artisan calls your
module's `onDisable()` — your plugin is still enabled at that point — then
removes your modules, and the data sources and commands your plugin
registered (matched by the class loader of your fetchers and handlers). A
plugin reloader can then enable your plugin again and register the same ids.

Before 1.8.0, Artisan called `onDisable()` only when it disabled itself, after
your plugin, and kept every registration: a reload threw a
`Duplicate…Exception`.
:::

## Read project content

A **project** is a directory of YAML on the server disk: menus, commands,
dialogs, translations, data files. `api.project` is a read-only view of every
project, with `/` separators:

```kotlin
for (projectId in api.project.projectIds()) {
    for (rel in api.project.list(projectId, "data/homes")) {      // sorted, relative to the dir
        if (!rel.endsWith(".yaml")) continue
        val text = api.project.read(projectId, "data/homes/$rel") ?: continue
        // parse with your YAML library, then cache
    }
}
```

| Method | Returns |
|---|---|
| `projectIds()` | Ids of the projects on disk (core directory and registered roots) |
| `list(projectId, dir)` | File paths under `<project>/<dir>`, relative to `dir`, sorted; empty if absent |
| `read(projectId, relPath)` | UTF-8 content, or `null` if missing or outside the project |
| `hasContent(dir)` | True when at least one project has a non-empty `<dir>/` — a cheap "is there anything yet?" check |
| `reload()` | Re-read projects from disk, then call every module's `onReload()` |

The `.artisan*` namespace (drafts, history, trash, metadata) is never visible
through this API.

### After writing your own files, call `reload()`

Artisan serves a snapshot of the projects taken at load time. If your plugin
writes files into its project (an admin command that adds an item, say), call:

```kotlin
api.project.reload()
```

Without it, the running server and the editor keep the old content until
someone types `/artisan reload`.

## Own your project directory

By default projects live in `plugins/Artisan/modules/<id>/`. An add-on can host
its project in **its own** plugin folder instead: admins find your content where
they expect it, and removing your plugin removes it.

```kotlin
val projectDir = File(plugin.dataFolder, "editor")
api.projectRoots.register("homes", projectDir, id)   // projectId, directory, owning module id
```

- Call it **once per boot, from `onEnable(api)`.** Artisan then reads, hashes,
  publishes, trashes and hot-reloads that project from your directory.
- Registering reloads the projects **on the next server tick**, once your
  `onEnable` has returned (Since 1.8.0): files you write after `register` in the
  same `onEnable` are read, and every module's `onReload()` — yours included —
  runs then. Before 1.8.0 the reload ran inside `register`, calling your
  `onReload()` before your `onEnable(api)` was done.
- The `projectId` is a permanent identity: the editor cannot rename a
  registered project. If a project with the same id exists in the core
  directory, yours wins.
- The three-argument form (Since 1.6.0) names your module so the editor lists
  the project under it even when you declare no config screen. The two-argument
  form (Since 1.5.0) still works.

:::danger[Use a dedicated directory]
Never pass your plugin's data folder itself. When content is published, files
under a project directory that are not part of the project are deleted. Point
it at a subdirectory that holds nothing else (`plugins/Homes/editor/`, not
`plugins/Homes/`).
:::

### Ship default content

On first boot, write a starter project so admins open the editor to something
real: a manifest, a menu, your data files, translations.

```
plugins/Homes/editor/
  manifest.yaml
  menus/homes.yaml
  data/settings.yaml
  lang/en.yaml
```

```yaml
# manifest.yaml
schema: manifest/v1
default_lang: en
languages: [en]
```

A document's id is its file name: `menus/homes.yaml` is the menu `homes`.

Write into a temporary sibling directory and rename it into place, so a crash
mid-write never leaves a half-populated project that blocks the next attempt.
Written in the same `onEnable` as `register`, the files are picked up by the
reload on the next tick. Against API 1.7.x and earlier, call
`api.project.reload()` after writing: there, `register` reloaded before your
files existed.
Copying files from your jar's resources is the simplest way to ship them; the
[worked example](/wiki/developers/example/) does exactly that.

## Migrate your own YAML

If your plugin reads its own versioned YAML documents (with a `schema:` key
such as `homes/v1`), register one migration per step instead of breaking old
installs:

```kotlin
api.schemas.register(object : SchemaMigration<MutableMap<String, Any?>> {
    override fun getFrom() = "homes/v1"
    override fun getTo() = "homes/v2"
    override fun migrate(data: MutableMap<String, Any?>): MutableMap<String, Any?> {
        data["max_homes"] = data.remove("limit")
        data["schema"] = to
        return data
    }
})

val current = api.schemas.loadToCurrent(doc, "homes/v2") { it["schema"] as String }
```

`loadToCurrent` chains migrations until the document reaches the target version.
An unknown version throws `UnsupportedSchemaVersionException`, a loop throws
`CircularMigrationException`. Migrations must be pure (no I/O), idempotent and
never edited once released — add the next one instead.

The registry is shared by every module: key your versions with your own
namespace (`homes/v1`, never `v1`). For data edited through the editor, prefer
the declarative migrations of [data models](/wiki/developers/data-models/#version-and-migrate-your-shape).
