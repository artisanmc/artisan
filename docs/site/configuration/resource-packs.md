---
title: Resource packs
description: How Artisan's resource pack reaches players — sent by Artisan, or through Nexo, Oraxen or ItemsAdder.
sidebar:
  order: 5
---

Custom images, glyphs, fonts and composed titles reach players through a resource
pack. The editor builds that pack **in your browser** after each publish and uploads
it to the server that serves the editor (requires `artisan.editor.publish`).

Two ways bring it to players, chosen in [config.yml](../config-yml/):

| | Direct sending | Delegation |
|---|---|---|
| Set up | nothing (default) | `resource-pack.delegate-to-dir` |
| Who sends the pack | Artisan | Nexo, Oraxen or ItemsAdder |
| Prompts | one for Artisan's pack, next to the other plugins' | one, the host's |
| Players download from | Artisan's pack host (`web.pack-cdn`), else the editor's web server | the host's pack server |

## Direct sending

Without a delegate folder, Artisan adds its own pack to each player's pack stack
(1.20.3+), next to any other pack: a pack from Nexo, Oraxen or ItemsAdder stays
loaded. Players get it when they join, and online players get each new pack as soon
as it is published; the previous Artisan pack is removed from their client.

```yaml
resource-pack:
  enabled: true
  prompt: ""            # empty: resource_pack.prompt of the player's language
  required: false       # true: a player who declines is disconnected
  send-on-join: true
  send-delay-ticks: 20
```

Players' clients download the zip from Artisan's pack host,
`https://cdn.artisanmc.net/resource-pack/<sha1>.zip`: the server that serves the editor
uploads each new pack there once, so neither its port nor its tunnel carries the
players' downloads, and a server with no open port needs nothing more. Packs there are
public (whoever has the hash downloads them, as on your own web server) and deleted 30
days after the server stops using them.

With `web.pack-cdn: ""` in `environment.yml`, or when the host cannot be reached or
refuses the pack (over 100 MB, daily quota), players download it from the editor's web
server instead, at `/resource-pack/<sha1>.zip`. That address must be reachable from
their machine: set `web.url` to the public address of the web server (see
[web server](../web-server/)). Without it, Artisan uses `http://<server-ip>:<web.port>`,
and warns when that address only resolves on the server itself (`localhost`). The
prompt is translated like any Artisan message: `resource_pack.prompt` in
`plugins/Artisan/lang/<code>.yml`, in each player's language with
`per_player_language: true`.

A player whose client already loaded the current pack is not sent it again on
`/artisan reload` or when the server reconnects to its hub.

## Delegation to a pack host

With `delegate-to-dir` set, Artisan never sends a pack itself: players see a single
prompt, the host's, and never contact the editor's web server. Artisan writes its files where the host plugin merges external packs, then runs its
reload command.

```yaml
# Nexo: a single zip (Nexo's directory scanner skips PNGs of non-vanilla namespaces)
resource-pack:
  delegate-to-dir: "plugins/Nexo/pack/external_packs/artisan.zip"
  delegate-reload-command: "n reload"
```

```yaml
# Oraxen: a directory; Artisan writes <path>/assets/artisan/
resource-pack:
  delegate-to-dir: "plugins/Oraxen/pack/external_packs/artisan"
  delegate-reload-command: "oraxen reload pack"
```

For ItemsAdder or another host, point `delegate-to-dir` at the folder it merges and
set its reload command. The path is absolute or relative to the server root. On
success the log shows:

```
[delegate] delegation enabled, target dir: /…/plugins/Nexo/pack/external_packs/artisan.zip
[delegate] applying pack <sha1> from <url>
[delegate] dispatching host reload: /n reload
```

The server downloads the pack from the editor's web server: on a leaf, from the HTTP
address of its `web.hub`.

Each client's answer to a pack (Artisan's or the host's) is logged, which is the quickest way to
diagnose:

```
[resource-pack] Steve: ACCEPTED (pack …)
[resource-pack] Steve: SUCCESSFULLY_LOADED (pack …)
[resource-pack] Alex: FAILED_DOWNLOAD (pack …)
```

## Without either

With `enabled: false` and `delegate-to-dir` empty, Artisan's textures, glyphs and
composed titles reach no player. Menus still open, but custom images show as missing
characters. Every pack update says so in the console:

```
[resource-pack] pack <sha1> not applied: resource-pack.enabled is false and resource-pack.delegate-to-dir is empty
```

A delegate folder that cannot be written falls back to direct sending; Artisan logs at
startup `[delegate] delegate-to-dir … is not a writable directory — sending the pack to players directly`.

## In a network

Each server has its own `config.yml`, and chooses its own way. The pack of a leaf is
uploaded through the hub and stored by the hub. Delegated, the leaf downloads it over
the internal address of `web.hub` and hands it to its local pack plugin; sent
directly, players download it from Artisan's pack host, else from the hub's public
address (the hub's `web.url`). Only the hub's `web.pack-cdn` counts.

The last applied pack is cached on each server (`plugins/Artisan/cache/`) and
survives restarts, even while the hub is unreachable.
