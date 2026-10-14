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
| `resource-pack.delegate-to-dir` | `""` | Where Artisan writes its pack for Nexo, Oraxen or ItemsAdder to merge and send to players. Empty: Artisan's textures and glyphs reach no player, and the console says so on every pack update. A `.zip` path writes one zip; any other path is a directory (Artisan writes `<path>/assets/artisan/`, wiped on each update). Absolute, or relative to the server root. |
| `resource-pack.delegate-reload-command` | `""` | Console command run after each pack update, e.g. `n reload` (Nexo), `oraxen reload pack` (Oraxen). |
| `resource-pack.container-textures.chest` | `""` | Texture drawn back on other chest windows when a menu turns the vanilla chest texture off. `project:image` names a project image in the vanilla layout (256×256 or an HD multiple). Empty: vanilla texture. |
| `resource-pack.container-textures.hopper` | `""` | Same, for hoppers. |
| `resource-pack.container-textures.dispenser` | `""` | Same, for dispensers. |

How the pack reaches players is explained in [Resource packs](/wiki/configuration/resource-packs/).

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
  delegate-to-dir: ""
  delegate-reload-command: ""
  container-textures:
    chest: ""
    hopper: ""
    dispenser: ""
```
