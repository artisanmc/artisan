---
title: Variants
description: Show other versions of a module's menus and dialogs to some players — Bedrock, with the resource pack, VIPs, a version still in progress.
sidebar:
  order: 11
---

A **variant** is a named set of versions of a module's menus and dialogs. Variants are declared
by the server (`default`, `bedrock`, `textured`, and yours); a player sees a variant's version of
a menu when that variant is theirs, chosen automatically or by themselves; everyone else sees
the module's own menu. Every variant is loaded on the server at once: nothing is "switched on" for everybody.

Typical uses: a `bedrock` variant (Bedrock menus only take a tap), a `textured` variant for
players who loaded the resource pack, a `vip` one, or a `dev` variant only operators see while
you build it.

## View as

On the board and in a Document's focus view, the toolbar's **View as** menu picks what the canvas shows: **Default** (the
module's own documents) or one of the variants. While a variant is shown:

- a document that has a version for this variant shows that version, tagged with the variant's
  name;
- the others are faded and tagged **Module's, shared**: they are what this variant's players see
  too.

Edit a faded document and it becomes this variant's version: your edit goes to the variant, the
module's document stays as it was. Select a document to see the same in the properties panel.
**Create a version for …** does the same without an edit. **Remove the version for …** deletes
the copy; the variant's players see the module's document again. A command's name, aliases,
arguments and permission are shared by every variant: editing them in a variant's view changes
the module's command.

The variant shown is kept in the page's address (`?variant=textured`): a reload, or a link you
share, opens the same view.

**New variant…** in the same menu creates one: it offers the server's variants the module has no
version for yet (`bedrock`, `textured`, or one of yours), so their players get it. A name the
server does not declare is only shown by the module's own display rules, and the dialog says so.
To delete a variant, hover it in that menu and click its trash icon.

## The server's variants

Variants are declared by the server, the same for every module. Three are always there:

| Variant | Who gets it automatically | Falls back to |
|---|---|---|
| `default` | Everyone else: the module's own menus. | — |
| `bedrock` | Bedrock players (through Geyser). Bedrock menus only take a tap. | `default` |
| `textured` | Java players whose client loaded the server's resource pack. | `default` |

A module only ships versions for them, in `variants/<name>/`. A player sees one variant in every
module; for each menu, the first of that variant and its parents the module has a version of,
else the module's own menu. So a `bedrock` variant that only redraws two menus still shows the
module's other menus to Bedrock players.

When a client refuses the pack, or a reload of the pack fails, the player is back on `default`
at the next menu they open: no missing glyphs.

**Players choose** with `/artisan variant <name|auto>` (permission `artisan.variant`, granted to
everyone by default): for instance `default` when the pack loaded but draws wrong. The choice is
kept across restarts and the servers of a network; `auto` goes back to automatic. A player is
only offered what their client can show: `textured` needs the pack on Java, `bedrock` a Bedrock
client. Want a shorter command? Make an Artisan command (`/menus`) that runs `artisan variant`.

**Your own variants** are edited on the server page, **Configuration → Menu variants** (name,
the variant it falls back to, the conditions that show it automatically, whether players may
choose it), or by hand in `config.yml`, each with a parent to fall back to:

```yaml
menu-variants:
  - name: large-text          # only for the players who choose it
    parent: default
  - name: vip                 # picked automatically for VIPs, before bedrock and textured
    parent: textured
    if: [{ has_permission: rank.vip }]
    selectable: false         # not offered by /artisan variant
```

`if` takes the conditions of an action's `if`, all required. A variant with `if` is picked
automatically for the players it holds for; the first one declared wins. A variant's parent
must hold too: `vip` above needs the pack, like `textured`.

## Display rules (a module's own, legacy)

Before the server declared its variants, each module had its own **display rules** (`show:` in
its `variants.yml`). A module that still has them keeps them for the players who did not choose
a variant, so nothing changes on a server that updates Artisan; a player's choice goes through
the server's variants. Modules drop their rules as they update; a `variants.yml` you edited
yourself stays until you remove its `show:`.

**View as → Display rules…** edits them; an empty tree (the default for a new module) leaves the
choice to the server: one tree, edited like an action chain, **If** branches
(with **Else if** and **Else**), and two steps, **Show variant** (pick which) and **Show
Default**. It is read for each player, top to bottom, up to the first **Show** step they reach.
The conditions are the same as an action's `if`, with two made for variants:

| Condition | Holds when |
|---|---|
| Client is | The player plays on Java, or on Bedrock (through Geyser). |
| Has the resource pack | The player loaded the server's resource pack, in game or before joining (a pack Nexo sends with `send_pre_join`). A Bedrock player counts as having it when the server has a Bedrock pack. Wrap it in NOT for players without it. |

Both work in actions too.

## What a variant can change

- **Menus and dialogs**: a whole version, under the same id. A menu's version must take the same
  inputs as the module's menu: the code and the other menus open it with them.
- **Commands**: only what a command runs (`actions`, `requirements`, `fallback`), not its name,
  aliases, permission, arguments or sub-commands, which every variant shares. In the editor, a
  command's version shows the whole command with these fields locked: edit its steps, and only
  the steps that differ from the module's are written.
- Everything else (triggers, data, translations, images) is the module's, shared.

## On disk

```
guilds/
  variants.yml                       which variants the module has
  menus/ranks.yml                    the module's menu
  variants/
    textured/menus/ranks.yml         the textured version, same id
    bedrock/menus/ranks.yml
    bedrock/commands/guild.yml       actions only
```

```yaml
# variants.yml
schema: variants/v1
variants: [bedrock, textured]
```

The file marks `variants/` as the variants' folder. A `show:` in it is the module's own display
rules (legacy, above).

The resource packs (Java and Bedrock) include the variants' menus. An AI app connected through
MCP writes variants with the same file tools as the rest of a module.
