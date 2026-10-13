---
title: Events & reloads
description: The module event bus, the built-in events, your own events, and how your add-on learns that content changed.
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

Artisan does not fire Bukkit events of its own. Listen to Bukkit events in your
plugin as usual, and use [commands](/wiki/developers/commands/) for anything a
menu should trigger.
