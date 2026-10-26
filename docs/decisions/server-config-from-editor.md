# Server config editable from the editor — `connection.yml` apart

**Status:** accepted (2026-10-08). `connection.yml` renamed `environment.yml`
and extended to database credentials by the ADR `suite-foundation-database`
(2026-10-11); the "never written from the editor" criterion is unchanged.

## Context

The replacement textures of containers (chest, hopper, dispenser) were asset usages
(`chest_texture`…) ticked on a Project image. But the setting is **per server**: the
pack is built for one server from all its Projects, a single image per container, "the
first one found". Carrying it on an asset made it look local, and changing it went
through the Project's draft and then a publication.

The plugin's other settings (`config.yml`) could only be edited by hand.

## Decisions

1. **The disk stays the truth.** Server settings live in plugin files; the plugin
   works without an editor.
2. **Two files, separated by who may write them:**
   - `connection.yml` — `server_key` and `ws_url`, the plugin ↔ backend link.
     Never written from the editor (the backend could otherwise redirect itself or
     remove its own access).
   - `config.yml` — everything else, editable by hand **or** from the editor's
     server page.
3. **No "security" exclusion list beyond the connection.** An editor user can
   already run console commands from a menu action: `delegate-reload-command` or the
   access settings add nothing. Only **paths** add power (reading/writing files): the
   plugin refuses from the editor any absolute path or one containing `..`.
4. **Container textures**: `resource-pack.container-textures.{chest,hopper,dispenser}`
   = `project:image` (empty = vanilla texture). The backend resolves them when
   building the pack. The `*_texture` asset usages are removed (no migration:
   marginal setting, re-chosen on the server page).
5. **Protocol**: the plugin reports its editable config in `hello`
   (`server_config`). The editor writes via `server_config_write`; the plugin
   validates, rewrites `config.yml` (comments kept), reloads, and returns the config.
6. **Migration**: at startup, `server_key`/`ws_url` present in `config.yml`
   are moved to `connection.yml`.

*Rejected:* `settings.yml` next to `config.yml` (names indistinguishable for an admin);
closed choices (Nexo/Oraxen…) for pack delegation (guardrail moot given point 3);
storing the setting in the backend database (the plugin must work alone).
