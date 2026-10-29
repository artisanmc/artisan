---
title: config.yml
description: Reference of plugins/Artisan/config.yml — language, resource pack and database pool size.
sidebar:
  order: 2
---

`plugins/Artisan/config.yml` holds every server setting that is not about *where*
the server is (that is [environment.yml](../environment/)).

Edit it in either place:

- **By hand**, then run `/artisan reload`.
- **From the editor**: the server page, **Settings** tab (requires
  `artisan.editor.config`). The plugin checks each value, rewrites the file with its
  comments kept, and reloads by itself. From the editor, paths must stay under the
  server root (no absolute path, no `..`), and texture references must look like
  `project:image`.

## Keys

| Key | Default | Meaning |
|---|---|---|
| `language` | `"en"` | Language of the plugin's own messages: `en` or `fr`. |
| `per_player_language` | `false` | `true`: send plugin messages in each player's client language when a matching lang file exists, else in `language`. |
| `resource-pack.enabled` | `true` | Without a delegate folder, Artisan sends its pack to players itself. `false` and no delegate folder: the pack reaches no player. Ignored when `delegate-to-dir` is set. |
| `resource-pack.prompt` | `""` | Prompt of the pack (MiniMessage). Empty: `resource_pack.prompt` of the player's language. |
| `resource-pack.required` | `false` | `true`: a player who declines Artisan's pack is disconnected. Direct sending only. |
| `resource-pack.send-on-join` | `true` | Send the pack to each joining player. |
| `resource-pack.send-delay-ticks` | `20` | Ticks between joining and receiving the pack. |
| `resource-pack.delegate-to-dir` | `""` | Where Artisan writes its pack for Nexo, Oraxen or ItemsAdder to merge and send to players; setting it turns direct sending off. Empty: Artisan sends its pack itself (`enabled`). A `.zip` path writes one zip; any other path is a directory (Artisan writes `<path>/assets/artisan/`, wiped on each update). Absolute, or relative to the server root. |
| `resource-pack.delegate-reload-command` | `""` | Console command run after each pack update, e.g. `n reload` (Nexo), `oraxen reload pack` (Oraxen). |
| `resource-pack.container-textures.chest` | `""` | Texture drawn back on other chest windows when a menu turns the vanilla chest texture off. `project:image` names a project image in the vanilla layout (256×256 or an HD multiple). Empty: vanilla texture. |
| `resource-pack.container-textures.hopper` | `""` | Same, for hoppers. |
| `resource-pack.container-textures.dispenser` | `""` | Same, for dispensers. |

How the pack reaches players is explained in [Resource packs](../resource-packs/).

## Custom messages

The bundled message files are `en` and `fr`. To change wording or add a language,
place a file at `plugins/Artisan/lang/<code>.yml` (copy the keys from the bundled
file): it overrides the bundled one for that code.

## Default file

```yaml
language: "en"
per_player_language: false

resource-pack:
  enabled: true
  prompt: ""
  required: false
  send-on-join: true
  send-delay-ticks: 20
  delegate-to-dir: ""
  delegate-reload-command: ""
  container-textures:
    chest: ""
    hopper: ""
    dispenser: ""
```
