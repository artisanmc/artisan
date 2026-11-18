# Updates and installs from the editor, through a site account

**Status:** accepted (2026-11-18). Follows `server-config-from-editor` and `editor-assistant`
(a network-wide setting kept in the suite database).

## Context

Artisan and its modules are jars an admin downloads from artisanmc.net and drops into
`plugins/`. The site knows every published version (two channels, `release` and `dev`), who
bought which paid module, and serves the jars. The editor knows which server runs what. Until
now nothing joined the two: an admin learned about a new version by visiting the site.

Three constraints:

- a paid module must only reach a server whose owner bought it, so the server has to prove an
  account to the site;
- the editor is used by several people with different rights, some through a public tunnel
  address: no secret of the site may be typed into it or shown by it;
- Paper, Folia and Leaf do not load or replace a plugin while the server runs.

## Decisions

1. **The network is linked to one site account, by a device flow.** The hub asks the site for a
   code (`POST /api/link/start/`), the editor shows it, the owner approves it on the site while
   signed in, and the hub collects a token once (`POST /api/link/token/`). Nothing is typed in
   the editor and the token never leaves the hub towards a browser. The site keeps only the
   token's hash and lists the link on the account page, where it can be revoked.
2. **The link is a network setting.** The token lives in `artisan_settings` (`site_link`), in
   clear like the assistant's key: whoever reads the database already controls the network.
   Every server of the database reads it, again every 30 s. While the database is not open:
   no link can be saved (503 `database_unavailable`). The request in progress (code, device code) stays in the hub's
   memory; a restart ends it.
3. **The site decides what is offered.** `GET /api/updates/` on the site returns, for the
   account, every module of the catalogue with its latest version on the asked channel, whether
   the account may have it (`access`: `ok`, `licence` for a paid module not bought, `supporter`
   for a free module's development build without the site's Supporter plan) and whether it is newer than what the server reports. The
   hub adds what the server runs (`plugins_fetch`: Bukkit plugin name → version) and what it
   staged. Version comparison stays on the site; a version it cannot read (a local build) is
   simply offered the published one.
4. **The server downloads, the hub never relays the jar.** On an install the hub asks the site
   again (never trusting an address or a hash from the browser) and sends the server
   `module_install` with the download address, the SHA-256, the size and the token. The server
   refuses any address outside its own `site.url`, streams the jar to a `.part` file, checks
   size and SHA-256, and only then moves it into place. A jar can be tens of megabytes and a
   leaf may be far from the hub: no WebSocket frame carries it.
5. **Nothing changes until the restart.** An installed plugin's new jar goes to Bukkit's update
   folder (`plugins/update/`) under the running jar's own file name, which the server swaps in
   at its next start; a new plugin's jar goes to `plugins/<Plugin>-<version>.jar`. The editor
   says a restart is needed and never triggers one by itself: it offers a **Restart the
   server** button (`config`, protocol 1.8 `server_restart`), which asks for a confirmation,
   tells the players and restarts after ten seconds (`Bukkit.spigot().restart()`). Whether the
   server comes back up is its host's doing, which the confirmation says: revised on
   2026-11-18, the button was first ruled out for that reason. A plugin whose jar is not directly in
   `plugins/` is refused (`not_updatable`). The jar is the one of `plugins/`, not the file the
   classes load from: Paper runs a plugin without Mojang mappings from a remapped copy in
   `plugins/.paper-remapped/`, so the original is found by that copy's file name, else by the
   plugin name its `plugin.yml` or `paper-plugin.yml` declares (`ModuleInstaller.sourceJar`).
6. **`module_install` answers at once.** The download runs in the background and its state
   (`downloading`, `ready`, `failed` + reason) is the `staged` of the next `plugins_fetch`,
   kept in memory until the restart. The editor polls while something downloads.
7. **Rights.** Reading the link and the list: `artisan.editor.view`. Linking, unlinking and
   installing: `artisan.editor.config`. An editor user who may publish can already run console
   commands (`server-config-from-editor`, decision 3); installing a jar the site signed off by
   hash, from one fixed origin, adds less than that.
8. **`site.url` lives in environment.yml** (default `https://artisanmc.net`), never editable
   from the editor: it is where the token is sent. Each server reads its own.
9. **Channel is the viewer's choice, module by module**, kept per server in the browser. A
   module follows `release` unless the version it runs is a development build, or `dev` was
   picked for it; a warning shows as soon as one follows `dev`. The editor asks the hub for the
   `dev` list only then. Nothing installs by itself on either channel.

## Consequences

- Protocol 1.7 (`MODULE_INSTALL`): a leaf on an older release answers 501
  `plugin_update_required` to both routes and is updated by hand once.
- Unlinking in the editor forgets the token locally; the site keeps listing the server until its
  owner unlinks it there. A token revoked on the site is forgotten at the next request (401).
- A module's requirement (`requires`) is shown and blocks the install button until the required
  module is present or staged; nothing is installed implicitly.
- No rollback: the previous jar is replaced at restart. The site keeps every release, so going
  back is a manual download.
- No signature beyond the SHA-256 the site announces over TLS: a compromised site account or
  site could ship a bad jar. Signing releases is left for when third parties publish modules.

*Rejected:* typing an API key into the editor (a secret in a browser, shared by everyone who
may configure); the hub downloading and pushing the jar over the WebSocket (size, memory, and a
leaf's hub is not always the nearest machine); hot-loading the new jar (not supported by Paper,
and a half-loaded plugin corrupts data); automatic updates (a restart and its timing belong to
the admin).
