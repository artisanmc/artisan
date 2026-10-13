---
title: Resource packs
description: How Artisan's resource pack reaches players — delegation to Nexo, Oraxen or ItemsAdder, or a pack pushed by Artisan.
sidebar:
  order: 5
---

Custom images, glyphs, fonts and composed titles reach players through a resource
pack. The editor builds that pack **in your browser** after each publish and uploads
it to the server that serves the editor (requires `artisan.editor.publish`). The
server then applies it in one of two modes, chosen by `resource-pack.delegate-to-dir`
in [config.yml](/wiki/configuration/config-yml/).

| | Delegation (recommended with a pack plugin) | Push by Artisan |
|---|---|---|
| `delegate-to-dir` | A path in your pack plugin's folder | Empty (default) |
| Who sends the pack to players | Nexo, Oraxen or ItemsAdder, merged with their own pack | Artisan, as an extra pack (1.20.3+ pack stack, alongside other packs) |
| Prompts players see | One | One per plugin that sends a pack |
| What players must reach | Nothing new | `<web.url>/resource-pack/<sha1>.zip` on the editor's web server |

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

If the directory cannot be written, Artisan logs
`[delegate] delegate-to-dir … is not a writable directory — falling back to legacy push mode`
and pushes the pack itself.

In delegation mode the server downloads the pack from the editor's web server: on a
leaf, from the HTTP address of its `web.hub-url`. Players never contact it.

## Push by Artisan

Leave `delegate-to-dir` empty. Artisan sends its pack on join (after
`send-delay-ticks`, if `send-on-join` is true) and to everyone online right after a
publish. The pack is optional for the client: a player who declines still joins.

Players' clients download the zip from the editor's web server, so:

1. Set `web.url` in `environment.yml` (of the hub, in a network) to an address
   players can open — your domain behind a reverse proxy, or `http://<public-ip>:8765`.
2. Make sure that address is reachable from the internet, including
   `/resource-pack/`.

Each client's answer is logged, which is the quickest way to diagnose:

```
[resource-pack] Steve: ACCEPTED (pack …)
[resource-pack] Steve: SUCCESSFULLY_LOADED (pack …)
[resource-pack] Alex: FAILED_DOWNLOAD (pack …)
```

`FAILED_DOWNLOAD` means the client could not fetch the URL: check `web.url`.

## In a network

Each server has its own `config.yml`, so each server picks its mode. The pack of a
leaf is uploaded through the hub, stored by the hub, and:

- in push mode, players of the leaf download it from the **hub's** `web.url`;
- in delegation mode, the leaf downloads it from the hub over the internal address
  of `web.hub-url` and hands it to its local pack plugin.

The last applied pack is cached on each server (`plugins/Artisan/cache/`) and
survives restarts, even while the hub is unreachable.
