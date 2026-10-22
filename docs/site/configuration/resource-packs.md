---
title: Resource packs
description: How Artisan's resource pack reaches players — through Nexo, Oraxen or ItemsAdder.
sidebar:
  order: 5
---

Custom images, glyphs, fonts and composed titles reach players through a resource
pack. The editor builds that pack **in your browser** after each publish and uploads
it to the server that serves the editor (requires `artisan.editor.publish`).

Artisan never sends a pack to players itself. It writes its pack into the pack of a
resource-pack plugin — Nexo, Oraxen or ItemsAdder — which merges it into its own and
sends it to players. Players see one prompt, and never contact the editor's web
server. You choose where Artisan writes with `resource-pack.delegate-to-dir` in
[config.yml](../config-yml/).

## Delegation to a pack host

Artisan writes its files where the host plugin merges external packs, then runs its
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

Each client's answer to the host's pack is logged, which is the quickest way to
diagnose:

```
[resource-pack] Steve: ACCEPTED (pack …)
[resource-pack] Steve: SUCCESSFULLY_LOADED (pack …)
[resource-pack] Alex: FAILED_DOWNLOAD (pack …)
```

## Without a pack host

With `delegate-to-dir` empty, Artisan's textures, glyphs and composed titles reach no
player. Menus still open, but custom images show as missing characters. Every pack
update says so in the console:

```
[resource-pack] pack <sha1> not applied: set resource-pack.delegate-to-dir to the pack folder of Nexo, Oraxen or ItemsAdder
```

The same happens when the folder cannot be written; Artisan then logs at startup
`[delegate] delegate-to-dir … is not a writable directory — Artisan's pack will not reach players`.

## In a network

Each server has its own `config.yml` and its own pack host. The pack of a leaf is
uploaded through the hub, stored by the hub, and the leaf downloads it over the
internal address of `web.hub` and hands it to its local pack plugin.

The last applied pack is cached on each server (`plugins/Artisan/cache/`) and
survives restarts, even while the hub is unreachable.
