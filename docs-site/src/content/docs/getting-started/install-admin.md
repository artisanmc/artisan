---
title: Install on a Paper server
description: Get Artisan running on your Paper server in five minutes.
---

This guide walks you through installing the Artisan plugin on a Paper
server and linking it to the Artisan backend so you can design menus
from the web editor.

> **Prerequisites**
> - Paper 1.21.4 or newer
> - Java 21
> - An Artisan backend (self-hosted or managed)

## 1. Download the plugin

Download the latest `artisan-plugin-*.jar` from the Artisan GitHub
Releases page, then drop it into your server's `plugins/` folder.

Restart the server once. A default `plugins/Artisan/config.yml` is
generated. The plugin will log a startup line indicating offline mode
because no `server_key` is set yet.

## 2. Link your server

Linking is **editor-first**: you add the server in the web editor, which gives
you a one-time code, and you run that code on your Minecraft server.

1. First, point the plugin at the backend. Open `plugins/Artisan/config.yml`:

   ```yaml
   ws_url: "wss://editor.artisanmc.net/ws/plugin"
   ```

   Adjust `ws_url` only if you are self-hosting the backend. Leave `server_key`
   empty — `/artisan link` fills it in.

2. In the editor, create a network and **Add a server**. You'll get a command
   like `/artisan link ABCD2345`.

3. Run that command in-game or from the console. The plugin redeems the code,
   writes the `server_key` to `config.yml`, and connects immediately — no
   restart needed. Codes are single-use and expire after 10 minutes.

To **re-link** a server later (rotate its key, or move it to a different server
entry), use **Re-link / new code** on the server card in the editor and run the
new `/artisan link <code>` — it rotates the key in place, keeping your projects.

## 3. Open the editor

In-game, run:

```
/artisan editor
```

The command requires the `artisan.editor` permission, granted to ops by default. If running it as a non-op produces no response, grant the permission via your permissions plugin (LuckPerms, PermissionsEx, etc.) or run from console.

If the server is linked and connected to the backend, this prints a clickable deep-link straight to this server's page in the editor, along with the network it belongs to. If the server is linked but the backend connection hasn't come up yet (e.g. just after a restart), it tells you to retry shortly. If the server is not yet linked, it prints the editor home URL so you can add the server there and get a link code.

Opening the editor URL requires signing in with your Artisan account, and that account must be a **member of the network** the server is linked to (the account that created the network is the owner; invite teammates from the network settings page).

If a logged-in user without network membership clicks the link, they see a **"Request access"** panel where they can optionally add a message and submit a request. The network owner receives an email notification (if SMTP is configured) and can approve or deny the request from the **Members** section of the network settings. Once approved, the user gains membership and can access all servers and projects in the network.

Once the editor opens, see the [Editor overview](/editor/) for next steps — how to create your first project and menu, add slots, and wire up actions.

## 4. Invite your team

From the web editor, click your network name in the top bar, then **Members**. As the owner, you can invite teammates by email or share an invite link. Click **Invite** and either enter an email address (they'll receive a link by mail) or leave it blank to copy a link and share it manually. Invited users become **members** with full editorial access to all projects on every server in your network. Only the owner can manage members, rotate or create server keys, and rename the network.

## 5. Useful commands

| Command | Description |
|---|---|
| `/artisan menu <id>` | Open a menu by id (in-game, players only). |
| `/artisan reload` | Reload all menus from disk. |
| `/artisan sync status` | Show the last sync status with the backend. |
| `/artisan sync reject` | Reload menus from disk and reconnect to the backend. |
| `/artisan editor` | Print the deep-link to this server's editor page + network name if linked (requires `artisan.editor` permission), otherwise print the editor home URL to add the server. |
| `/artisan link <code>` | Redeem a link code from the editor: writes the `server_key` to `config.yml` and connects. On an already-linked server it rotates the key in place. Codes are single-use and expire after 10 minutes. |
| `/artisan pushLocal <id\|--all>` | Push local on-disk project changes to the backend (FTP scenario). |

## 6. Billing administration (super-admins)

Super-admins have a dedicated **`/admin/billing`** page in the editor with four tabs:

- **Sales** — top-up revenue (per currency) and active subscribers per plan over a chosen period (7 / 30 days or custom range).
- **Credit packs** / **Subscriptions** — create, edit, activate or deactivate the credit packs and subscription plans offered on the `/credits` page (each change provisions the corresponding Stripe product/price).
- **Manual grant** — add top-up credits to a specific network (recorded as an adjustment in the audit trail), e.g. for support or compensation.

## 7. Troubleshooting

**Connection refused / backend unreachable**
The plugin cannot reach `ws_url`. Check outbound internet access and
firewall rules on your server host.

**Invalid server_key**
The key was rotated or revoked. Get a fresh one from your dashboard,
paste it into `config.yml`, and run `/artisan reload`.

**Resource pack not loading**
By default the plugin sends its own resource pack on join. If a competing
plugin (Oraxen, Nexo, ItemsAdder) also sends one, players see two prompts
at login. See _Resource pack distribution_ below.

**Editor link says server is not linked**
`server_key` or `ws_url` is empty. Complete step 2 first.

**`/artisan editor` says "connecting, retry shortly"**
The server is linked (`server_key` set) but hasn't completed its WebSocket handshake with the backend yet — usually just after a restart or a brief backend outage. Wait a few seconds and run the command again; check `ws_url` reachability if it persists.

**`/artisan editor` is console-only**
`editor.console_only` is set to `true` in `config.yml`. Either change it
or run the command from the console.

## 8. Resource pack distribution (advanced)

Three modes, controlled by `resource-pack.delegate-to-dir` in `config.yml`.

**Default — Artisan pushes its own pack**

Leave `delegate-to-dir` empty. Artisan pushes its pack to each player
using the 1.20.3+ multi-pack stack, coexisting with other RP plugins.
Two login prompts appear when a host plugin also pushes one.

**Delegation to a directory** — for Oraxen / ItemsAdder

```yaml
resource-pack:
  delegate-to-dir: "plugins/Oraxen/pack/external_packs/artisan"
  delegate-reload-command: "oraxen reload pack"
```

Artisan writes its pack contents under `<path>/assets/artisan/`
on every update and skips the player push. Set `delegate-reload-command`
so the host plugin reloads its merged pack automatically.

**Delegation to a zip** — for Nexo

```yaml
resource-pack:
  delegate-to-dir: "plugins/Nexo/pack/external_packs/artisan.zip"
  delegate-reload-command: "n reload"
```

Same idea, but written as a single zip file. Required for Nexo because
its directory scanner skips PNGs for non-vanilla namespaces — only the
zip-merger picks them up.

The path is filesystem-absolute or relative to the server root.

## 9. Reference: `config.yml`

```yaml
# Set to connect this server to the Artisan editor backend for live sync.
# Leave empty to run offline using only locally exported packs.
server_key: ""
ws_url: "wss://editor.artisanmc.net/ws/plugin"

# Language for plugin system messages (en, fr). Defaults to en.
# Place custom lang files in plugins/Artisan/lang/<code>.yml to override.
language: "en"

# When true, plugin messages are sent in each player's client language when
# a matching lang file is available. Falls back to 'language' if not.
per_player_language: false

# Editor access settings.
editor:
  # Set to true to restrict /artisan editor to console only (no in-game players).
  console_only: false

# Resource pack pushed by Artisan (independent from Oraxen/Nexo/ItemsAdder packs;
# uses the 1.20.3+ pack stack so it coexists with other packs side-by-side).
resource-pack:
  enabled: true
  prompt: "<gold>Pack Artisan</gold>"
  send-on-join: true
  send-delay-ticks: 20
  # When set, Artisan stops pushing its own RP to players and writes its
  # pack contents to this path. The admin configures the host RP plugin
  # (Oraxen / Nexo / ItemsAdder / etc.) to read from it.
  #
  # Output shape depends on the path suffix:
  #   - `<path>.zip`  → single zip file with `assets/artisan/*` and a
  #                     minimal pack.mcmeta. **Use this with Nexo's
  #                     pack/external_packs/** — its directory scanner skips
  #                     PNGs for non-vanilla namespaces, the zip-merger does
  #                     not.
  #   - `<path>`      → directory; Artisan writes under
  #                     `<path>/assets/artisan/` (wiped before each update).
  #
  # Path is filesystem-absolute or relative to the server root.
  #
  # Nexo example:
  #   delegate-to-dir: "plugins/Nexo/pack/external_packs/artisan.zip"
  #   delegate-reload-command: "n reload"
  #
  # Default: empty (legacy mode — Artisan pushes its own RP to players).
  delegate-to-dir: ""
  # Optional: command dispatched on the console after each pack update.
  # Use this to auto-reload the host RP plugin so players don't see missing
  # glyphs until they manually rejoin. Examples: "n reload" (Nexo),
  # "oraxen reload pack" (Oraxen).
  delegate-reload-command: ""
```
