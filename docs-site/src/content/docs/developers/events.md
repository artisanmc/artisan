---
title: Events & reloads
description: The module event bus, the built-in events, your own events, the menu Bukkit events, and how your add-on learns that content changed.
sidebar:
  order: 10
---

Artisan has two ways to tell your add-on that something changed: the
`onReload()` hook of your [module](/wiki/developers/modules/#lifecycle), and
the module event bus `api.events`.

## When content changes: `onReload()`

Content changes on disk when an admin publishes from the editor, when someone
runs `/artisan reload`, when a network leaf receives new content from its hub,
when a module calls `api.project.reload()`, or on the tick after a module
registers its project root. Each time, Artisan re-reads the
projects, then:

1. calls `onReload()` on every registered module;
2. publishes `ConfigReloadEvent("menus")` on the event bus.

Both run on the global region thread (the main thread on Paper). For most
add-ons, `onReload()` is all you need: re-read your files there.

## The event bus

```kotlin
api.events.subscribe(ConfigReloadEvent::class.java) { event ->
    val reload = event as ConfigReloadEvent
    logger.info("Content reloaded by ${reload.moduleId}")
}

api.events.publish(DataReloadEvent("homes:list"))
```

```java
api.getEvents().subscribe(ConfigReloadEvent.class, event -> {
    ConfigReloadEvent reload = (ConfigReloadEvent) event;
    getLogger().info("Content reloaded by " + reload.getModuleId());
});
```

| Member | Meaning |
|---|---|
| `subscribe(type, handler)` | Call `handler` for every published event that is an instance of `type`. The handler receives a `ModuleEvent`: cast it |
| `publish(event)` | Call matching handlers synchronously, on the calling thread, in subscription order |

A handler that throws stops the delivery to the handlers after it and
propagates to the publisher: catch your own exceptions.

### Built-in events

| Event | Published by | Meaning |
|---|---|---|
| `ConfigReloadEvent(moduleId)` | Artisan, with `moduleId = "menus"`, after every content reload; modules may publish their own | Configuration was reloaded; refresh what you derived from it |
| `DataReloadEvent(dataSourceRef)` | Modules | The rows behind a data source changed |

Artisan never publishes nor reads `DataReloadEvent`: its menus re-fetch every
data source on each render anyway. It is a convention between add-ons — publish
it for **other add-ons** that cache your rows, listen to it if you cache
someone else's.

### Your own events

Since API 1.8.0 `ModuleEvent` is an open interface: implement it to give other
add-ons a typed event (before 1.8.0 it was sealed and only the two built-in
events existed).

```kotlin
data class HomeSetEvent(val player: UUID, val name: String) : ModuleEvent

api.events.publish(HomeSetEvent(player.uniqueId, "base"))
api.events.subscribe(HomeSetEvent::class.java) { event -> /* (event as HomeSetEvent).name */ }
```

```java
public record HomeSetEvent(UUID player, String name) implements ModuleEvent {}
```

Ship the event class in a small API jar of your own if other plugins should
subscribe to it, like Artisan does with `artisan-core-api`.

## Bukkit events

Since 1.8.0 Artisan fires three Bukkit events for its menus, so any plugin —
add-on or not — can react with a plain `@EventHandler`. They live in the API
artifact (`net.artisanmc.modules.api`), so compile against it.

| Event | Fired | Cancellable |
|---|---|---|
| `MenuOpenEvent` | Before a menu opens: `getPlayer()`, `menu` (`MenuRef`), `args` | Yes: nothing opens |
| `MenuClickEvent` | On the tick after a click, before the button's actions: `menu`, `slot`, `click`, `hasActions` | Yes: the actions are skipped |
| `MenuCloseEvent` | When the window closes: `menu`, `closeReason` | No |

```java
@EventHandler
public void onMenuClick(MenuClickEvent event) {
    if ("shop".equals(event.getMenu().getProjectId()) && !event.getPlayer().hasPermission("shop.use")) {
        event.setCancelled(true);
    }
}
```

They run on the player's thread (their region's thread on Folia), right after
the `api.menus` listeners, which receive the same objects: either side can
cancel, and Bukkit handlers see a listener's cancellation
(`ignoreCancelled = true` works). See
[Menus](/wiki/developers/menus/#listen-to-menus) for the ordering of opens and
closes. For anything a button itself should trigger, prefer
[commands](/wiki/developers/commands/).
