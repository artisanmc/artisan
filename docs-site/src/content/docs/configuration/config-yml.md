---
title: config.yml
description: Reference of plugins/Artisan/config.yml — language, resource pack and database pool size.
sidebar:
  order: 2
---

`plugins/Artisan/config.yml` holds every server setting that is not about *where*
the server is (that is [environment.yml](/wiki/configuration/environment/)).

Edit it in either place:

- **By hand**, then run `/artisan reload`.
- **From the editor**: the server page, **Configuration** section (requires
  `artisan.editor.config`). The plugin checks each value, rewrites the file with its
  comments kept, and reloads by itself. From the editor, paths must stay under the
  server root (no absolute path, no `..`), and texture references must look like
  `project:image`.

## Keys

| Key | Default | Meaning |
|---|---|---|
| `database.pool-size` | `4` | Maximum connections of **each** plugin's pool on the [database](/wiki/configuration/database/) (clamped to 1–50). Applies to pools opened after the change: restart for plugins already connected. |
| `language` | `"en"` | Language of the plugin's own messages: `en` or `fr`. |
| `per_player_language` | `false` | `true`: send plugin messages in each player's client language when a matching lang file exists, else in `language`. |
| `resource-pack.enabled` | `true` | Push Artisan's pack to players. Only gates the push: in delegation mode it decides nothing — keep it `true`. |
| `resource-pack.prompt` | `"<gold>Pack Artisan</gold>"` | Text of the pack prompt, in MiniMessage. |
| `resource-pack.send-on-join` | `true` | Send the pack when a player joins. Players online during a publish get the new pack immediately either way. |
| `resource-pack.send-delay-ticks` | `20` | Delay after joining before the pack is sent (20 ticks = 1 s). `0`: immediately. |
| `resource-pack.delegate-to-dir` | `""` | Empty: Artisan pushes its own pack. Set: Artisan writes its pack there for Nexo, Oraxen or ItemsAdder to merge, and never touches players. A `.zip` path writes one zip; any other path is a directory (Artisan writes `<path>/assets/artisan/`, wiped on each update). Absolute, or relative to the server root. |
| `resource-pack.delegate-reload-command` | `""` | Console command run after each pack update in delegation mode, e.g. `n reload` (Nexo), `oraxen reload pack` (Oraxen). |
| `resource-pack.container-textures.chest` | `""` | Texture drawn back on other chest windows when a menu turns the vanilla chest texture off. `project:image` names a project image in the vanilla layout (256×256 or an HD multiple). Empty: vanilla texture. |
| `resource-pack.container-textures.hopper` | `""` | Same, for hoppers. |
| `resource-pack.container-textures.dispenser` | `""` | Same, for dispensers. |

The two resource-pack modes are explained in [Resource packs](/wiki/configuration/resource-packs/).

## Custom messages

The bundled message files are `en` and `fr`. To change wording or add a language,
place a file at `plugins/Artisan/lang/<code>.yml` (copy the keys from the bundled
file): it overrides the bundled one for that code.

## Default file

```yaml
database:
  pool-size: 4

language: "en"
per_player_language: false

resource-pack:
  enabled: true
  prompt: "<gold>Pack Artisan</gold>"
  send-on-join: true
  send-delay-ticks: 20
  delegate-to-dir: ""
  delegate-reload-command: ""
  container-textures:
    chest: ""
    hopper: ""
    dispenser: ""
```
