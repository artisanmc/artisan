---
title: Variants
description: Show other versions of a module's menus and dialogs to some players — Bedrock, with the resource pack, VIPs, a version still in progress.
sidebar:
  order: 11
---

A **variant** is a named set of versions of a module's menus and dialogs. A player sees a
variant's version of a menu when a **display rule** says so; everyone else sees the module's own
menu. Every variant is loaded on the server at once: nothing is "switched on" for everybody.

Typical uses: a `bedrock` variant (Bedrock menus only take a tap), a `textured` variant for
players who loaded the resource pack, a `vip` one, or a `dev` variant only operators see while
you build it.

## View as

On the board, the toolbar's **View as** menu picks what the canvas shows: **Default** (the
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

**New variant…** in the same menu creates one. Nobody sees it until the display rules show it.
To delete a variant, hover it in that menu and click its trash icon.

## Display rules

**View as → Display rules…** is one tree, edited like an action chain: **If** branches (with
**Else if** and **Else**), and two steps, **Show variant** (pick which) and **Show Default**. It
always ends on **Otherwise: Show Default**, which cannot be removed.

The tree is read for each player, top to bottom. For each menu or dialog, the **first variant
shown on the player's path that has that file** wins; **Show Default**, or the end of the tree,
gives the module's own file. So a `bedrock` variant that only redraws two menus still shows the
module's other menus to Bedrock players.

The conditions are the same as an action's `if`, edited the same way: permission, money, world,
placeholder, and two made for variants:

| Condition | Holds when |
|---|---|
| Client is | The player plays on Java, or on Bedrock (through Geyser). |
| Has the resource pack | The player loaded the server's resource pack. A Bedrock player counts as having it when the server has a Bedrock pack. Wrap it in NOT for players without it. |

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
  variants.yml                       the display rules
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
show:
  - if: [{ client_is: bedrock }]
    do: [{ show_variant: bedrock }]
    else:
      - if: [{ has_resource_pack: true }]
        do: [{ show_variant: textured }]
  - show_default
```

The resource packs (Java and Bedrock) include the variants' menus. An AI app connected through
MCP writes variants with the same file tools as the rest of a module.
