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

That port is **not** part of the API. Your add-on schedules its own work with
Paper's region-aware schedulers, which exist on Paper too (where they all map to
the main thread):

| You need to… | Use |
|---|---|
| Touch a player (inventory, teleport, messages) | `player.scheduler.run(plugin, { task -> … }, null)` |
| Touch server-wide state (console commands, worlds list) | `server.globalRegionScheduler.execute(plugin) { … }` |
| Touch a location or block | `server.regionScheduler.execute(plugin, location) { … }` |
| Do I/O (SQL, HTTP, files) | `server.asyncScheduler.runNow(plugin) { task -> … }` |

Pass **your** plugin instance, never `api.plugin`: tasks are cancelled with the
plugin that owns them.

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

Several region threads can call the same fetcher at once on Folia. Keep the data
your fetcher reads in an immutable snapshot swapped atomically (a `@Volatile`
field holding an immutable list, or a `ConcurrentHashMap`), and rebuild the
snapshot off-thread.

## Calling Artisan from your threads

| Call | From any thread? |
|---|---|
| `api.actions.execute(player, …)` | Yes — Artisan hops to the player's thread itself |
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
api.commands.register(CommandDeclaration("myplugin:claim") { player, _ ->
    server.asyncScheduler.runNow(plugin) { _ ->
        val reward = repository.claim(player.uniqueId)          // SQL, off-thread
        player.scheduler.run(plugin, { _ ->                     // back on the player's thread
            player.inventory.addItem(reward)
        }, null)
    }
})
```

Data shown in menus follows the same split: a background task refreshes a
cache, the fetcher only reads it. See [Data sources](/wiki/developers/data-sources/).
