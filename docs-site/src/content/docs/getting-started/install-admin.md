---
title: Install on a Paper server
description: Get Interfaze running on your Paper server in five minutes.
---

This guide walks you through installing the Interfaze plugin on a Paper
server and linking it to the Interfaze backend so you can design menus
from the web editor.

> **Prerequisites**
> - Paper 1.21.4 or newer
> - Java 21
> - An Interfaze backend (self-hosted or managed)

## 1. Download the plugin

Download the latest `interfaze-plugin-*.jar` from the Interfaze GitHub
Releases page, then drop it into your server's `plugins/` folder.

Restart the server once. A default `plugins/Interfaze/config.yml` is
generated. The plugin will log a startup line indicating offline mode
because no `server_key` is set yet.

## 2. Link your server

### Option A — guided setup (recommended)

Run `/ifz setup` in-game or from the console. A clickable link appears in
chat. Open it in your browser, follow the pairing flow, and the server key
is written to `config.yml` automatically. The plugin reconnects
immediately — no restart needed.

### Option B — manual

Get a `server_key` from your Interfaze dashboard. Open
`plugins/Interfaze/config.yml` and paste it:

```yaml
server_key: "sk_live_..."
ws_url: "wss://editor.interfaze.gg/ws/plugin"
```

Adjust `ws_url` if you are self-hosting the backend.

Then run `/ifz reload` (or restart). The log should show a successful
connection to the backend.

## 3. Open the editor

In-game, run:

```
/ifz editor
```

A trust link appears in chat. Click it to open the editor in your browser.
The editor is now paired with your server — any change you save is
live-synced to your players' next menu open.

To revoke the active editor session at any time:

```
/ifz editor revoke
```

## 4. Useful commands

| Command | Description |
|---|---|
| `/ifz menu <id>` | Open a menu by id (in-game, players only). |
| `/ifz reload` | Reload all menus from disk. |
| `/ifz sync status` | Show the last sync status with the backend. |
| `/ifz sync reject` | Reload menus from disk and reconnect to the backend. |
| `/ifz editor` | Request an editor session link (requires `interfaze.editor` permission). |
| `/ifz editor revoke` | Revoke the currently active editor session. |
| `/ifz setup [code]` | Start the guided server-linking flow (clickable pairing link). Optional `code` argument lets you reuse an existing pairing code instead of generating a new one. |

## 5. Troubleshooting

**Connection refused / backend unreachable**
The plugin cannot reach `ws_url`. Check outbound internet access and
firewall rules on your server host.

**Invalid server_key**
The key was rotated or revoked. Get a fresh one from your dashboard,
paste it into `config.yml`, and run `/ifz reload`.

**Resource pack not loading**
By default the plugin sends its own resource pack on join. If a competing
plugin (Oraxen, Nexo, ItemsAdder) also sends one, players see two prompts
at login. See _Resource pack distribution_ below.

**Editor link says server is not linked**
`server_key` or `ws_url` is empty. Complete step 2 first.

**`/ifz editor` is console-only**
`editor.console_only` is set to `true` in `config.yml`. Either change it
or run the command from the console.

## 6. Resource pack distribution (advanced)

Three modes, controlled by `resource-pack.delegate-to-dir` in `config.yml`.

**Default — Interfaze pushes its own pack**

Leave `delegate-to-dir` empty. Interfaze pushes its pack to each player
using the 1.20.3+ multi-pack stack, coexisting with other RP plugins.
Two login prompts appear when a host plugin also pushes one.

**Delegation to a directory** — for Oraxen / ItemsAdder

```yaml
resource-pack:
  delegate-to-dir: "plugins/Oraxen/pack/external_packs/interfaze"
  delegate-reload-command: "oraxen reload pack"
```

Interfaze writes its pack contents under `<path>/assets/interfaze/`
on every update and skips the player push. Set `delegate-reload-command`
so the host plugin reloads its merged pack automatically.

**Delegation to a zip** — for Nexo

```yaml
resource-pack:
  delegate-to-dir: "plugins/Nexo/pack/external_packs/interfaze.zip"
  delegate-reload-command: "n reload"
```

Same idea, but written as a single zip file. Required for Nexo because
its directory scanner skips PNGs for non-vanilla namespaces — only the
zip-merger picks them up.

The path is filesystem-absolute or relative to the server root.

## 7. Reference: `config.yml`

```yaml
# Set to connect this server to the Interfaze editor backend for live sync.
# Leave empty to run offline using only locally exported packs.
server_key: ""
ws_url: "wss://editor.interfaze.gg/ws/plugin"

# Language for plugin system messages (en, fr). Defaults to en.
# Place custom lang files in plugins/Interfaze/lang/<code>.yml to override.
language: "en"

# When true, plugin messages are sent in each player's client language when
# a matching lang file is available. Falls back to 'language' if not.
per_player_language: false

# Editor access settings.
editor:
  # Set to true to restrict /ifz editor to console only (no in-game players).
  console_only: false

# Resource pack pushed by Interfaze (independent from Oraxen/Nexo/ItemsAdder packs;
# uses the 1.20.3+ pack stack so it coexists with other packs side-by-side).
resource-pack:
  enabled: true
  prompt: "<gold>Pack Interfaze</gold>"
  send-on-join: true
  send-delay-ticks: 20
  # When set, Interfaze stops pushing its own RP to players and writes its
  # pack contents to this path. The admin configures the host RP plugin
  # (Oraxen / Nexo / ItemsAdder / etc.) to read from it.
  #
  # Output shape depends on the path suffix:
  #   - `<path>.zip`  → single zip file with `assets/interfaze/*` and a
  #                     minimal pack.mcmeta. **Use this with Nexo's
  #                     pack/external_packs/** — its directory scanner skips
  #                     PNGs for non-vanilla namespaces, the zip-merger does
  #                     not.
  #   - `<path>`      → directory; Interfaze writes under
  #                     `<path>/assets/interfaze/` (wiped before each update).
  #
  # Path is filesystem-absolute or relative to the server root.
  #
  # Nexo example:
  #   delegate-to-dir: "plugins/Nexo/pack/external_packs/interfaze.zip"
  #   delegate-reload-command: "n reload"
  #
  # Default: empty (legacy mode — Interfaze pushes its own RP to players).
  delegate-to-dir: ""
  # Optional: command dispatched on the console after each pack update.
  # Use this to auto-reload the host RP plugin so players don't see missing
  # glyphs until they manually rejoin. Examples: "n reload" (Nexo),
  # "oraxen reload pack" (Oraxen).
  delegate-reload-command: ""
```
