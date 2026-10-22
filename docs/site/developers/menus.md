---
title: Menus
description: How an add-on works with Artisan menus — shipping menus, opening and watching them from code, running admin-authored actions, and feeding them with data, commands, placeholders and items.
sidebar:
  order: 7
---

Menus belong to the admin. They are documents (`menu/v1`) in a project,
designed in the editor and stored as YAML; Artisan renders them and runs their
click actions. An add-on does not build inventories through the API — it
**feeds** menus and **opens** them:

| Your plugin… | With |
|---|---|
| Supplies the rows a menu shows | [Data sources](../data-sources/) |
| Runs code when a button is clicked | [Commands](../commands/) |
| Opens, closes or queries a player's menu | `api.menus` (below) |
| Reacts to menus opening, clicks, closing | `api.menus` listeners or Bukkit events (below) |
| Runs any admin-authored actions | `api.actions` (below) |
| Exposes per-player values (`%homes_count%`) | `api.placeholders` (below) |
| Ships starter menus admins can restyle | Your [own project](../modules/#own-your-project-directory) |

## Open a menu from your code

`api.menus` (`@Beta`, Since 1.8.0) opens a menu by reference: `project:menu`,
or a bare id looked up on the whole server.

```kotlin
api.menus.open(player, "homes:main")
api.menus.open(player, MenuRef("homes", "details"), mapOf("home" to home))
```

```java
api.getMenus().open(player, "homes:main");
api.getMenus().open(player, new MenuRef("homes", "details"), Map.of("home", home));
```

| Method | Does |
|---|---|
| `open(player, ref)` / `open(player, ref, args)` / `open(player, MenuRef, args)` | Opens the menu with `args` as its context (what `open_menu … with` passes); `false` when no menu matches, nothing opens |
| `close(player)` | Closes the player's Artisan menu, if one is open |
| `openMenu(player)` | The `MenuRef` the player has open, or `null` |
| `menus()` | Every menu of every loaded project |

`MenuRef(projectId, menuId)` prints as `project:menu`; `MenuRef.parse("homes:main")`
reads one. Every method may be called from any thread: opening and closing run
on the player's thread (their region's thread on Folia), scheduled if needed.
Args are passed as is, so a map stays a map and the menu can read `{home.world}`.

## Listen to menus

```kotlin
val subscription = api.menus.onClick { event ->
    if (event.menu.projectId == "homes" && event.slot == 13) {
        event.isCancelled = true          // skip the button's actions
        openTeleportPicker(event.player)
    }
}
// later: subscription.cancel()
```

| Listener | Event | Fields | Cancellable |
|---|---|---|---|
| `onOpen` | `MenuOpenEvent` | `player`, `menu`, `args` | Yes: nothing opens |
| `onClick` | `MenuClickEvent` | `player`, `menu`, `slot` (raw slot), `click` (Bukkit `ClickType`), `hasActions` | Yes: the button's actions are skipped |
| `onClose` | `MenuCloseEvent` | `player`, `menu`, `closeReason` (`MenuCloseReason`, `UNKNOWN` on Spigot) | No |

Listeners run on the player's thread. A click is delivered on the tick after
it happened, before the button's actions, so you may open another menu or
inventory from it; a close comes from Bukkit's close event, so schedule
anything you open from there with [`api.scheduler`](../threading/).
Opening a menu over another fires the new menu's open, then the old window's
close (reason `OPEN_NEW`). Pagination and `set` repaint by reopening the window,
which fires the same pair. A listener that throws is logged and skipped.

The same events are Bukkit events (see [Events](../events/#bukkit-events)),
fired right after the listeners: a plugin that is not an add-on can use
`@EventHandler`.

## Run actions

`api.actions` (`@Beta`, Since 1.4.0) runs Action DSL — the same language admins
write on buttons — for a player. Opening a menu is one action:

```kotlin
api.actions.execute(player, "open_menu homes", emptyMap(), "homes")
```

```java
api.getActions().execute(player, "open_menu homes", Map.of(), "homes");
```

| Parameter | Meaning |
|---|---|
| `player` | Who the actions run for (`{player}` is bound to them) |
| `actions` | Action DSL text: one action per line, `if`/`else` blocks allowed ([syntax](../../editor/data-sources/#syntax)) |
| `args` | Extra placeholder bindings: `mapOf("target" to "Steve")` makes `{target}` available in the text |
| `projectId` | The project the actions run in (Since 1.6.0): a bare menu id is looked up there first, and `@key` messages resolve in its `lang/` files. `null` = no project scope |

Pass values to the menu's inputs with `with`:

```kotlin
api.actions.execute(
    player,
    "open_menu home_details with home=\"{home}\"",
    mapOf("home" to homeName),
    "homes",
)
```

A value that is exactly one placeholder (`"{home}"`) is passed as is — a map
stays a map, so the target menu can read `{home.world}`. Anything else is
interpolated into text.

`execute` may be called from any thread — Artisan runs the actions on the
player's thread. Malformed text is skipped with a warning in the console rather
than thrown, so test your strings. A menu id that matches nothing tells the
player the menu was not found. `open_menu homes:main` reaches a menu of another
project.

Other actions work the same way: `close_menu`, `open_dialog <id>`,
`send_message "…"`, `give_item DIAMOND 1`, `run_command "…" as console`…

### Run actions the admin wrote

The most useful pattern: let admins author **what happens** in your data, and
run it when your own logic succeeds. The Boutique stores an `actions` field on
each item (declared with the `actions` kind in its [data model](../data-models/))
and, after payment:

```kotlin
api.actions.execute(player, item.onBuy, mapOf("item" to item.id, "price" to item.price), "boutique_shop")
```

Your plugin owns the transaction; the admin owns the side effects (messages,
sounds, commands). A broken chain never breaks your transaction.

## Ship menus with your add-on

Write starter menus into your project on first boot (see
[Ship default content](../modules/#ship-default-content)). They
are ordinary documents: admins open them in the editor, restyle them, and your
plugin keeps opening them by id. A minimal menu using a data source and a
command:

```yaml
# menus/homes.yaml
schema: menu/v1
title: []
size: 27
elements:
  - id: list
    positions: '10-16'
    iterates: { source: homes:list, alias: home }
    material: RED_BED
    title: '{home.id}'
    click:
      left: 'run_command "homes:teleport {home.id}" as player'
```

Prefer building the menu in the editor and copying the saved file into your
resources over writing YAML by hand: the editor writes every field it needs.

### A command that opens it

Players open menus through commands. Ship a `command/v1` document instead of a
hard-coded Bukkit command, and admins can rename it, add aliases, a permission
or a cooldown from the editor:

```yaml
# commands/homes.yaml
schema: command/v1
name: homes
aliases: [h]
actions: 'open_menu homes'
```

Admins can also open any menu with `/artisan menu <id>`.

## Placeholders

`api.placeholders` (`@Beta`, Since 1.8.0) is the simplest way to show a single
per-player value. Register a namespace, and every `%<namespace>_<key>%` in menu
titles, names, lore, action text and conditions asks your resolver — with or
without PlaceholderAPI installed:

```kotlin
api.placeholders.register("homes", { player, key ->
    when (key) {
        "count" -> player?.let { homeCache.count(it.uniqueId).toString() }
        "max" -> "5"
        else -> null                     // unknown key: the token stays as written
    }
}, true)                                 // also a PlaceholderAPI expansion, if installed
```

```java
api.getPlaceholders().register("homes", (player, key) -> switch (key) {
    case "count" -> player == null ? null : String.valueOf(homeCache.count(player.getUniqueId()));
    case "max" -> "5";
    default -> null;
}, true);
```

| Member | Does |
|---|---|
| `register(namespace, resolver)` | Artisan menus only |
| `register(namespace, resolver, exposeToPapi)` | With `true` and PlaceholderAPI installed, also registers a PlaceholderAPI expansion with that identifier, so scoreboards and chat plugins can show it |
| `unregister(namespace)` | Removes it, and its expansion |
| `namespaces()` | The registered namespaces |
| `resolve(player, text)` | `text` with Artisan's placeholders, then PlaceholderAPI's, resolved |

A namespace is a lowercase identifier without `_` (`[a-z][a-z0-9]*`); a malformed
one throws `IllegalArgumentException`, one already taken `IllegalStateException`.
Artisan's namespaces are resolved before PlaceholderAPI, so they win over an
expansion of the same name inside menus. The resolver runs on the viewing
player's thread at every render: read from memory, never block. Called through
PlaceholderAPI it runs on whatever thread asked, with `player = null` for an
offline player.

An existing PlaceholderAPI expansion keeps working too: Artisan hands what is
left to PlaceholderAPI. Return its placeholders from `getPlaceholders()` and the
editor lists them in its autocompletion; namespaces registered through
`api.placeholders` are not listed there yet.

Use a data source instead when the value is a list or has several fields.

## Items

A data source field of kind `ITEM` hands a complete item to the menu: admins
pick it under **Displayed item → Use an item from data**. To produce item
values the editor understands — for example an admin command that captures the
item in hand — use `api.items` (`@Beta`, Since 1.4.0):

| Method | Returns |
|---|---|
| `serialize(stack)` | The canonical YAML Artisan stores for an item (what a project keeps under `items/<id>.yml`) |
| `describe(stack)` | A display descriptor: material (or a recognized custom-item ref), head texture, enchanted, count, name |

Write the serialized YAML into your project, then call `api.project.reload()`.

## What the API does not do

There is no API to build a menu in code: menus stay documents the admin owns.
React to them with listeners or commands, feed them with data sources and
placeholders.
