---
title: Threading & Folia
description: Which thread Artisan calls your code on, and how to schedule work so your add-on runs on Paper, Folia and Leaf.
sidebar:
  order: 3
---

Artisan runs on Paper, Folia and Leaf (parallel world ticking). On Folia there
is no single main thread: each region of the world ticks on its own thread, and
a player may only be touched from the thread that owns their region. Artisan
routes all of its own work through an internal scheduler port for this reason —
it never calls `Bukkit.getScheduler()`.

## `api.scheduler`

Since 1.8.0 that port is exposed as `api.scheduler` (`@Beta`): ask it for a
scheduler owned by **your** plugin, and every task lands on the right thread on
Paper, Folia and Leaf alike.

```kotlin
val tasks = api.scheduler.forPlugin(plugin)      // once, in onEnable

tasks.runAsync {
    val reward = repository.claim(player.uniqueId)   // SQL, off-thread
    tasks.runFor(player) { player.inventory.addItem(reward) }
}
```

```java
TaskScheduler tasks = api.getScheduler().forPlugin(this);
tasks.runAsync(() -> {
    ItemStack reward = repository.claim(player.getUniqueId());
    tasks.runFor(player, () -> player.getInventory().addItem(reward));
});
```

| You need to… | Use |
|---|---|
| Touch a player or an entity (inventory, teleport, messages) | `runFor(entity, task)`, `runForLater(entity, delayTicks, task)` — skipped if the entity is removed first |
| Touch a location or block | `runAt(location, task)`, `runAtLater(location, delayTicks, task)` |
| Touch server-wide state (console commands, worlds list) | `runGlobal(task)`, `runGlobalLater(delayTicks, task)` |
| Do I/O (SQL, HTTP, files) | `runAsync(task)`, `runAsyncLater(delayTicks, task)` |
| Check where you are | `isOwnedByCurrentThread(entity)`, `isGlobalThread()` |

Delays are in ticks (20 per second); 0 runs as soon as possible. Tasks cannot be
cancelled once scheduled: check your own state when they run. The server
cancels them when the plugin passed to `forPlugin` disables — pass **your**
plugin instance, never `api.plugin`.

Paper's own region-aware schedulers work just as well and offer cancellable,
repeating tasks:

| You need to… | Use |
|---|---|
| Touch a player (inventory, teleport, messages) | `player.scheduler.run(plugin, { task -> … }, null)` |
| Touch server-wide state (console commands, worlds list) | `server.globalRegionScheduler.execute(plugin) { … }` |
| Touch a location or block | `server.regionScheduler.execute(plugin, location) { … }` |
| Do I/O (SQL, HTTP, files) | `server.asyncScheduler.runNow(plugin) { task -> … }` |

Declare `folia-supported: true` in your `plugin.yml` only once your add-on
follows these rules everywhere — Folia refuses to load plugins without it.

## Which thread calls you

| Callback | Thread | Rules |
|---|---|---|
| `ArtisanModule.onEnable(api)` | The thread that calls `api.modules.register(…)` — your plugin's `onEnable`, at startup | Declare everything here |
| `ArtisanModule.onReload()` | The global region thread (Paper: main thread) | Re-read files, swap caches; no player access |
| `ArtisanModule.onDisable()` | Artisan's own `onDisable` | Release resources |
| `DataFetcher.fetch(player, params)` at menu render | The viewing player's region thread | Return in microseconds, from memory |
| `DataFetcher.fetch(null, params)` for an editor preview | The global region thread | Same; `player` is `null` |
| `CommandHandler.handle(player, args)` | The clicking player's region thread | Safe to touch that player; move I/O off-thread |
| `ModuleEventHandler.onEvent(event)` | The thread that published the event | Core reloads publish from the global region thread |
| `api.menus` listeners, menu Bukkit events | The menu's player's region thread | Clicks arrive a tick late; do not open an inventory from a close |
| `PlaceholderResolver.resolve(player, key)` from a menu | The viewing player's region thread | Read memory only |
| `PlaceholderResolver.resolve(player, key)` from PlaceholderAPI | Whatever thread asked PlaceholderAPI | `player` may be `null` |

Several region threads can call the same fetcher at once on Folia. Keep the data
your fetcher reads in an immutable snapshot swapped atomically (a `@Volatile`
field holding an immutable list, or a `ConcurrentHashMap`), and rebuild the
snapshot off-thread.

## Calling Artisan from your threads

| Call | From any thread? |
|---|---|
| `api.actions.execute(player, …)` | Yes — Artisan hops to the player's thread itself |
| `api.menus.open/close(player, …)` | Yes — same |
| `api.menus.openMenu/menus()`, `api.placeholders.register/unregister` | Yes |
| `api.scheduler.forPlugin(…)` and its `run…` methods | Yes |
| `api.dataSources.fetch(…)` | Runs the fetcher on your thread: call it where the fetcher's owner expects (normally the player's thread) |
| `api.commands.dispatch(…)` | Runs the handler on your thread: call it from the player's thread |
| Registries: `register`, `declare`, `has`, `refs()`… | Yes (thread-safe maps), but register at startup |
| `api.project.read/list/projectIds` | Yes — reads from disk |
| `api.project.reload()` | Yes — the reload then runs on the global region thread |
| `api.database.dataSource(plugin)` | Blocks on the first call to test a connection: call it once from `onEnable`; run queries on the async scheduler |

## Never block a region thread

A fetcher or command handler that waits on SQL or HTTP freezes every player in
that region (on Paper, the whole server). The pattern that works:

```kotlin
// command handler: on the player's thread
val tasks = api.scheduler.forPlugin(plugin)
api.commands.register(CommandDeclaration("myplugin:claim") { player, _ ->
    tasks.runAsync {
        val reward = repository.claim(player.uniqueId)          // SQL, off-thread
        tasks.runFor(player) { player.inventory.addItem(reward) } // back on the player's thread
    }
})
```

Data shown in menus follows the same split: a background task refreshes a
cache, the fetcher only reads it. See [Data sources](/wiki/developers/data-sources/).
