---
title: Commands
description: Register handlers that menu buttons and admin-authored actions can call — CommandRegistry, the run_command bridge, arguments and threading.
sidebar:
  order: 6
---

`CommandRegistry` maps a `namespace:name` ref to a handler in your plugin. Any
action an admin writes in the editor — a button click, a command's actions, a
row's `on_buy` chain — can then call your code with `run_command`. These are
**not** Bukkit commands: they never appear in `/help`, need no permission node,
and players cannot type them in chat.

## Register a handler

```kotlin
api.commands.register(CommandDeclaration("homes:teleport") { player, args ->
    val argv = args["argv"] as List<*>          // ["base"]
    val home = homeCache.find(player.uniqueId, argv.firstOrNull() as? String ?: return@CommandDeclaration)
    player.teleportAsync(home.location)
})
```

```java
api.getCommands().register(new CommandDeclaration("homes:teleport", (player, args) -> {
    List<?> argv = (List<?>) args.get("argv");
    if (argv.isEmpty()) return;
    homeCache.find(player.getUniqueId(), (String) argv.get(0))
            .ifPresent(home -> player.teleportAsync(home.location()));
}));
```

Registering the same name twice throws `DuplicateCommandException`.
`api.commands.unregister("homes:teleport")` (Since 1.8.0) removes it; Artisan
does it for you when your plugin disables, and for a module's commands on
`api.modules.unregister`.

## Call it from a menu

In the editor, add a **Run command** action and type your ref followed by its
arguments. The Action DSL form is:

```
run_command "homes:teleport {home.id}" as player
```

Placeholders (`{home.id}`, `{player}`, `%papi%`) are resolved first, then
Artisan checks the first word:

- it matches `^[a-z][a-z0-9_]*:[a-z][a-z0-9_]*$` (lowercase `namespace:name`)
  **and** is registered → your handler runs;
- otherwise the text runs as a normal Bukkit command, so a ref never shadows a
  real `plugin:command`.

Only `as player` reaches the registry. `run_command "…" as console` always goes
to the server console as a Bukkit command.

## What the handler receives

| Argument | Value |
|---|---|
| `player` | The player who triggered the action — never `null` |
| `args["argv"]` | `List<String>`: the text after the ref, split on spaces (empty tokens dropped) |
| `args["raw"]` | `String`: the text after the ref, unsplit (`""` when there is none) |

Arguments are split on spaces with no quoting: pass a value that contains
spaces last and read it from `raw`, or pass an id instead of a display name.

## Threading and errors

The handler runs on the clicking player's thread — the main thread on Paper,
the player's region thread on Folia — so it may touch that player directly. Do
I/O on the async scheduler and come back with `player.scheduler`
([Threading & Folia](/wiki/developers/threading/)).

An exception thrown by your handler is caught and logged
(`[Artisan] command 'homes:teleport' failed: …`); the rest of the action chain
keeps running. The handler returns nothing: to show a result, message the
player, or open a menu with [`api.actions`](/wiki/developers/menus/#open-a-menu-from-your-code).

## Refresh the open menu

Menus re-fetch their data sources on every repaint. When your command changes
data a menu displays (a purchase, a deleted home), let the admin follow it
with an action that repaints: `open_menu` of the same menu, or a `set` of a menu
argument. Writing that chain is the admin's job; documenting it in your
plugin's README saves them guesswork.

## Call another plugin's command

```kotlin
if (api.commands.has("boutique:buy")) {
    api.commands.dispatch("boutique:buy", player, mapOf("argv" to listOf("diamond_sword"), "raw" to "diamond_sword"))
}
```

`dispatch` runs the handler synchronously on your thread (call it from the
player's thread) and throws `UnknownCommandException` for an unknown name.
`names()` lists every registered ref.

## Commands players type

Commands such as `/homes` are not registered through this API. Either register
a normal Bukkit command in your plugin, or ship a **command** document
(`command/v1`) in your project so admins can rename it, change its aliases and
choose which menu it opens from the editor — see [Menus](/wiki/developers/menus/).
