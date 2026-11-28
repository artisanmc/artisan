# Artisan — HUD schema v1

A **HUD** (`huds/<id>.yml`) is what stays drawn on the players' screens: the player's name and
money at the top, a countdown during an event, the quest they follow. Images and texts laid out in
pixels in one overlay slot, the texts Templates that read the player and the Variables. Decision:
ADR `server-huds`.

## Files

| File | Role |
|---|---|
| `schema.json` | JSON Schema (Draft 2020-12), source of truth |
| `examples/profile.json` | Permanent: a panel with the player's name and coins, checked every 5 s. |
| `examples/countdown.json` | Temporary: shown by `show_hud` during an event, updated on each change of its Variable. |

## Model

```
HUD
 ├── enabled    ← true (default) | false: only while a show_hud lasts
 ├── slot       ← boss_bar (default) | action_bar
 ├── priority   ← order in the slot, highest on top (100)
 ├── refresh    ← ticks between two checks: 0 (on change only) or 5..1200 (20)
 ├── when       ← conditions, all required
 ├── layout     ← image and text layers (OverlayLayout)
 └── texts      ← the MiniMessage of each text layer, by name
```

| Lifetime | File |
|---|---|
| Permanent | `enabled` true, no `when` |
| Conditional | `when: [...]`: drawn while the player meets them |
| Temporary | `enabled: false`; `show_hud: {hud: countdown, duration: 600}` shows it for 600 ticks (no duration: until `hide_hud: countdown` or quit) |

## When it is drawn again

A HUD is resolved for each player (conditions, texts) and sent only when what it draws changed.
It is checked at once on a change of Variable (`variable_changed`), join, pack loaded, `show_hud` /
`hide_hud` and reload; then every `refresh` ticks for what changes without notice (a
PlaceholderAPI value, the time). `refresh: 0` waits for those events only.

## Texts

`{player}`, `{var.coins}`, `{var.guilds.rank}`: the value is drawn as text, a `<red>` in a
player's name stays visible as typed. `%papi%` placeholders are resolved as in menus. A line break
or `<newline>` starts a row; rows are wrapped to the layer's `width` and cut at its `lines`.

## Who sees it

Only a player whose client has loaded the resource pack (its fonts place the layers): never a
Bedrock player (Geyser). The screen's corners (`top_left`…) need the pack's text shader: a next
step of the ADR.
