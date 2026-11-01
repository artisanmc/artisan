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
  too, and editing them changes them for every variant.

Select a document to see the same in the properties panel. **Create a version for …** copies the
module's document into the variant: from then on, edits change only what that variant's players
see. **Remove the version for …** deletes the copy; the variant's players see the module's
document again.

**New variant…** in the same menu creates one. Its display rule starts **off**.

## Display rules

**View as → Display rules…** lists the rules, in order. For each player and each menu or dialog,
the **first rule that is on, holds, and whose variant has that file** wins; otherwise the player
gets the module's own file. So a `bedrock` variant that only redraws two menus still shows the
module's other menus to Bedrock players.

A rule holds when all of its conditions do:

| Condition | Holds when |
|---|---|
| Client | The player plays on Java, or on Bedrock (through Geyser). |
| Resource pack | The player loaded the server's resource pack, or did not. A Bedrock player counts as having it when the server has a Bedrock pack. |
| Permission | The player has this permission (`op` style permissions work). |
| Engine condition | Any condition of the action engine, written in YAML, e.g. `{ type: has_permission, perm: guilds.vip }`. |

A rule with no condition holds for everyone. Turn a rule off to keep a variant without showing it.

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
rules:
  - variant: dev
    enabled: false
    when: { permission: op }
  - variant: bedrock
    when: { client: bedrock }
  - variant: textured
    when: { has_pack: true }
```

The resource packs (Java and Bedrock) include the variants' menus. An AI app connected through
MCP writes variants with the same file tools as the rest of a module.
