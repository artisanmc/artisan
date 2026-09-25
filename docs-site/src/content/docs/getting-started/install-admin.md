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
Releases page, then drop it into your server's `plugins/` folder. Nothing
else is required: the plugin ships its own copy of PacketEvents.

Restart the server once. A default `plugins/Artisan/config.yml` is
generated. The plugin will log a startup line indicating offline mode
because no `server_key` is set yet.

## 2. Link your server

Linking is **editor-first**: you add the server in the web editor, which gives
you a one-time code, and you run that code on your Minecraft server.

1. First, point the plugin at the backend. Open `plugins/Artisan/config.yml`:

   ```yaml
   ws_url: "wss://api.artisanmc.net/ws/plugin"
   ```

   This is the backend host, not the editor host (`editor.artisanmc.net` serves
   the web app only and answers `/api` requests with `405`). Adjust `ws_url`
   only if you are self-hosting the backend. Leave `server_key` empty —
   `/artisan link` fills it in.

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

By default, a signed-in non-member sees **Request access**. They can send a message to the network managers, who approve or deny it from **Members** (email notification requires SMTP).

To authorize accounts from the server console instead, configure:

```yaml
editor:
  access_mode: console # invitation (default) | console
```

Run `artisan reload` after changing this setting. If any server in the network
enables console access, the access page lists those servers and shows
`artisan member add <email>` for the signed-in account. Run the copied command
in one of their consoles (RCON supported). It grants **member access to the whole
network**, including every server and project. Existing roles are preserved.
The account must already exist, and the server must be connected to the backend.
The page opens automatically after authorization. Manual invitations remain
available in both modes. Set every enabled server back to `invitation` and reload
to restore access requests. This setting is independent of `editor.console_only`.

Once the editor opens, see the [Editor overview](/wiki/editor/) for next steps — how to create your first project and menu, add slots, and wire up actions.

## 4. Invite your team

From the web editor, click your network name in the top bar, then **Members**. As the owner, you can invite teammates by email or share an invite link. Click **Invite** and either enter an email address (they'll receive a link by mail) or leave it blank to copy a link and share it manually. Invited users become **members** with full editorial access to all projects on every server in your network. Only the owner can manage members, rotate or create server keys, and rename the network.

## 5. Useful commands

| Command | Description |
|---|---|
| `/artisan menu <id>` | Open a menu by id (in-game, players only). |
| `/artisan reload` | Reload all menus from disk. |
| `artisan member add <email>` | Console/RCON only, requires `editor.access_mode: console`. Add an existing account as a member of this server's entire network. |
| `/artisan sync status` | Show the last sync status with the backend. |
| `/artisan sync reject` | Reload menus from disk and reconnect to the backend. |
| `/artisan editor` | Print the deep-link to this server's editor page + network name if linked (requires `artisan.editor` permission), otherwise print the editor home URL to add the server. |
| `/artisan link <code>` | Redeem a link code from the editor: writes the `server_key` to `config.yml` and connects. On an already-linked server it rotates the key in place. Codes are single-use and expire after 10 minutes. |
| `/artisan pushLocal <id\|--all>` | Manually push local on-disk project changes to the backend. Rarely needed: the plugin scans your project files every few seconds and pushes disk edits automatically. When both the disk and the web editor changed since the last sync, nothing is overwritten: the editor shows a resolution banner where you pick, per file, which side to keep — `pushLocal` remains the "force the disk side" shortcut. |

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

**Disk edits don't show up in the editor**
The plugin waits for a file to stop changing before pushing it, so a slow
upload is never sent half-written — give it a few seconds. If the web editor
also changed the same project since the last sync, nothing is pushed on its
own: open the project in the editor and resolve the banner, or run
`/artisan pushLocal <id>` to force the disk side.

**`/artisan editor` says "connecting, retry shortly"**
The server is linked (`server_key` set) but hasn't completed its WebSocket handshake with the backend yet — usually just after a restart or a brief backend outage. Wait a few seconds and run the command again; check `ws_url` reachability if it persists.

**Menus open empty**
Menu content is sent to players through packets. If the startup log shows
`PacketEvents failed to load` or `failed to start`, your server version is
newer than the bundled PacketEvents: update Artisan.

**`/artisan editor` is console-only**
`editor.console_only` is set to `true` in `config.yml`. Either change it
or run the command from the console.

## 8. Assistant server import sources

The AI assistant can attach text files directly from named, read-only roots on
the Minecraft server. Only users who can edit the linked Project can request
their listing and contents. Configure the roots locally in
`plugins/Artisan/config.yml`:

```yaml
assistant:
  import-sources:
    zmenu:
      enabled: true
      label: "zMenu"
      path: "plugins/zMenu/menus"
      extensions: [".yml", ".yaml"]
    deluxe-menus:
      enabled: true
      label: "DeluxeMenus"
      path: "plugins/DeluxeMenus/gui_menus"
      extensions: [".yml", ".yaml"]
```

Relative paths start at the Minecraft server root; an absolute path is also
accepted when the administrator declares it explicitly. Extension matching is
case-insensitive. Artisan never writes to these roots and rejects hidden path
segments, path traversal, and symbolic links (including links in intermediate
directories). Selecting a folder in the editor expands it into explicit file
paths; the plugin accepts only regular files in a read request.

Each source listing is limited to 5,000 entries. One assistant turn may read at
most 200 files, 1 MiB per file, and 8 MiB in total. Files must be valid UTF-8.
Invalid, missing, or unreadable sources are omitted and produce a warning in the
server console. Set `enabled: false` to keep a configured source private.
Run `/artisan reload` after changing the source configuration.

## 9. Resource pack distribution (advanced)

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

## 10. Reference: `config.yml`

```yaml
# Backend endpoint for live sync (WebSocket). Not the editor URL — the editor
# lives on editor.artisanmc.net and doesn't proxy the API.
# Leave empty to run offline using only locally exported packs.
server_key: ""
ws_url: "wss://api.artisanmc.net/ws/plugin"

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

# Read-only roots that Project members may browse from the AI assistant.
assistant:
  import-sources:
    zmenu:
      enabled: true
      label: "zMenu"
      path: "plugins/zMenu/menus"
      extensions: [".yml", ".yaml"]
    deluxe-menus:
      enabled: true
      label: "DeluxeMenus"
      path: "plugins/DeluxeMenus/gui_menus"
      extensions: [".yml", ".yaml"]

# Resource pack pushed by Artisan (independent from Oraxen/Nexo/ItemsAdder packs;
# uses the 1.20.3+ pack stack so it coexists with other packs side-by-side).
resource-pack:
  # Only gates the push to players. In delegation mode (delegate-to-dir set)
  # Artisan never touches players, so this flag decides nothing there —
  # keep it true.
  enabled: true
  prompt: "<gold>Pack Artisan</gold>"
  send-on-join: true
  send-delay-ticks: 20
  # When set, Artisan stops pushing its own RP to players and writes its
  # pack contents to this path. The admin configures the host RP plugin
  # (Oraxen / Nexo / ItemsAdder / etc.) to read from it.
  #
  # In this mode `enabled`, `prompt`, `send-on-join` and `send-delay-ticks`
  # are moot: Artisan only exports `assets/artisan/*` and the host plugin
  # serves it.
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
