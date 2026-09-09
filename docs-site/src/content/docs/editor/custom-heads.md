---
title: Custom heads
description: Use HeadDatabase ids, base64 textures, or player names as menu item heads.
---

Pick **Player Head** as an element's material and a **custom head** row appears under it.

## Sources

| Source | Value | Example |
|---|---|---|
| HeadDatabase | The numeric id from `/hdb` | `128276` |
| Base64 texture | The `textures` value from any head site (minecraft-heads.com → "Other" → Value) | `eyJ0ZXh0dXJlcyI6…` |
| Player name | A literal name or a placeholder | `Notch`, `%player%` |

Pasting a full value anywhere works: `hdb:128276` or a raw `eyJ…` base64 string is detected
and routed to the right source automatically.

## Previews

Base64 textures and literal player names show their real texture in the editor.
HeadDatabase ids also show their real texture when the connected server has HeadDatabase
installed. The editor requests the skin from that server and caches it for subsequent previews.
While loading, or if the server or head is unavailable, a generic player head is shown.
Unavailable previews retry automatically every 30 seconds while visible. Player-name
placeholders keep a generic preview until resolved to a literal name.

## Server requirements

- `hdb:` heads require the [HeadDatabase](https://www.spigotmc.org/resources/14280/) plugin
  on the server. Without it, a plain player head is rendered and one warning is logged.
- Base64 and player-name heads work on any Paper server, no extra plugin.
- Player-name placeholders (`%player%`, `{alias.owner}`…) resolve per viewer at render time.
