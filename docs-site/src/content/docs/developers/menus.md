---
title: Menus
description: How an add-on works with Artisan menus — shipping menus, opening them from code, running admin-authored actions, and feeding them with data, commands, placeholders and items.
sidebar:
  order: 7
---

Menus belong to the admin. They are documents (`menu/v1`) in a project,
designed in the editor and stored as YAML; Artisan renders them and runs their
click actions. An add-on does not build inventories through the API — it
**feeds** menus and **opens** them:

| Your plugin… | With |
|---|---|
| Supplies the rows a menu shows | [Data sources](/wiki/developers/data-sources/) |
| Runs code when a button is clicked | [Commands](/wiki/developers/commands/) |
| Opens a menu, or runs any admin-authored actions | `api.actions` (below) |
| Exposes per-player values (`%homes_count%`) | A PlaceholderAPI expansion (below) |
| Ships starter menus admins can restyle | Your [own project](/wiki/developers/modules/#own-your-project-directory) |

## Open a menu from your code

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
| `actions` | Action DSL text: one action per line, `if`/`else` blocks allowed ([syntax](/wiki/editor/data-sources/#syntax)) |
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
player the menu was not found.

Other actions work the same way: `close_menu`, `open_dialog <id>`,
`send_message "…"`, `give_item DIAMOND 1`, `run_command "…" as console`…

### Run actions the admin wrote

The most useful pattern: let admins author **what happens** in your data, and
run it when your own logic succeeds. The Boutique stores an `actions` field on
each item (declared with the `actions` kind in its [data model](/wiki/developers/data-models/))
and, after payment:

```kotlin
api.actions.execute(player, item.onBuy, mapOf("item" to item.id, "price" to item.price), "boutique_shop")
```

Your plugin owns the transaction; the admin owns the side effects (messages,
sounds, commands). A broken chain never breaks your transaction.

## Ship menus with your add-on

Write starter menus into your project on first boot (see
[Ship default content](/wiki/developers/modules/#ship-default-content)). They
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

## PlaceholderAPI

When PlaceholderAPI is installed, Artisan resolves `%placeholders%` in menu
titles, names, lore and action text for the viewing player. A PlaceholderAPI
expansion is therefore the simplest way to show a single per-player value
(`%homes_count%`, `%homes_max%`).

Return your placeholders from your expansion's `getPlaceholders()`: the editor
lists every declared placeholder in its autocompletion, grouped by expansion.
Undeclared placeholders still resolve in game; they just do not show up there.

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

There is no API to build a menu in code, to listen to a menu being opened,
clicked or closed, or to read which menu a player has open. Model those
interactions as commands called from the menu's actions, and keep menus as
documents the admin owns.
