---
title: Developer guide
description: Integrate your Paper plugin with Artisan — expose data sources, declare models, ship a full Add-on.
---

Artisan is a web configuration layer for Paper servers. Your plugin can plug into
it so that admins configure **your** plugin from the same visual editor they use
for menus — no YAML by hand, no UI for you to write.

Integration is **declarative**: you describe what you expose (data, shapes,
screens), the core does the rest — editing UI, validation, translations, sync to
disk, hot-reload. You never write editor code.

## Three levels of integration

| Level | You do | Admins get |
|---|---|---|
| **1 — Data source** | Register one `DataSourceDeclaration` from your `onEnable` | Your live data (shop items, quests, homes…) usable in any menu: paginated, filtered, placed on slots |
| **2 — Module** | Implement `ArtisanModule` and register it | Level 1 + presence in the editor (your plugin appears when installed), commands callable from menu buttons, project files readable by your plugin |
| **3 — Add-on** | Level 2 + declared models, config screens, an owned Project root | A full configuration UI for your plugin: typed forms, translations, live edit — generated from your declarations |

The [Boutique](https://artisanmc.net) Add-on is the reference implementation of
level 3, and every example in these pages is taken from it.

## Read next

- [Depend on the API](/wiki/developers/setup/) — Gradle/Maven, `plugin.yml`, getting the `ArtisanAPI` handle
- [Data sources](/wiki/developers/data-sources/) — exposing live rows to menus
- [Modules](/wiki/developers/modules/) — the module lifecycle, commands, project content
- [Data models & config screens](/wiki/developers/data-models/) — a generated configuration UI for your plugin
- [API reference](/wiki/developers/api-reference/) — stability contract, version table

## What Artisan guarantees you

- **Files stay the source of truth.** Everything an admin edits lands as plain
  YAML in a project directory on the server disk. Your plugin reads files, not a
  database, and keeps working when nobody has the editor open.
- **Stable API.** Anything annotated `@Stable` follows SemVer within a major
  version. `@Beta` may move in a minor. Nothing outside
  `net.artisanmc.modules.api.*` is API.
- **No hard coupling.** Modules never depend on each other — only on the core
  registries. Artisan itself is optional-friendly: your plugin can `softdepend`
  and degrade gracefully when Artisan is absent.
