---
title: HUDs
description: Keep images and texts on your players' screens — their name and money, a countdown during an event — permanent, conditional or for a while.
sidebar:
  order: 14
---

A **HUD** is what stays drawn on your players' screens: a panel with their name and coins, the
countdown of an event. Create one from the project's **New** menu (**HUD**); it is a file of the
project's `huds/` folder.

HUDs need the [resource pack](../../configuration/resource-packs/): a player who has not loaded it, and every Bedrock player, sees none.

## Where

- **Area**: under the top of the screen (the boss bar's row) or above the action bar. The HUDs of
  one area, yours and the modules' (a conversation, the tracked quest), stack: the highest
  **priority** is drawn on top. The screen's corners will come later, with a shader in the pack.
- **Layout**: drag the layers on the game's screen. Add an image of the project's assets, or a text.

## How long it stays

| Display | What it does |
|---|---|
| **Permanent** | Always on screen. |
| **Conditional** | On screen while the player meets the conditions you list ("Only if"). |
| **Temporary** | Hidden until an action shows it. `show_hud: {hud: countdown, duration: 600}` shows it for 600 ticks (30 s); without a duration it stays until `hide_hud: countdown` or until the player leaves. |

A temporary HUD fits a chain: a Trigger or a command that starts an
event sets a Variable, shows the HUD, then hides it.

## Texts

Each text layer has a MiniMessage text. Type `{` to insert a value: `{player}`, a Variable
(`{var.coins}`), a module's Variable (`{var.guilds.rank}`); `%placeholders%` work too. A value is
drawn as text, so a player named `<red>Bob` shows those characters. A line break starts a new row;
rows wrap to the layer's width and stop at its number of lines.

## When it updates

A change of Variable updates the HUD at once. **Checked again** sets how often it is also redrawn
for values that change without notice (a placeholder, the time): every 0.25 s, 1 s, 5 s, or on
change only. A HUD is only sent to a player when what it shows changed.
