---
title: Developer guide
description: Integrate your Paper plugin with Artisan — feed menus with live data, run your code from buttons, share the database, ship a configuration UI.
sidebar:
  order: 1
  label: Overview
---

Artisan is a Paper plugin that ships its own web editor. Admins design menus,
commands and dialogs in the browser; the result is written as plain YAML on the
server disk and runs in game. There is no cloud service: the plugin serves the
editor itself, and in a network one server (the hub) serves it for all of them.

Your plugin can plug into this so that admins build menus around **your** data
and configure **your** plugin from the same editor — with no UI code on your side.

Everything goes through one public API module, `net.artisanmc:artisan-core-api`
(package `net.artisanmc.modules.api`). Nothing else in Artisan is API.

## What you can integrate

| You want to… | Use | Page |
|---|---|---|
| Show your data in menus (shop items, homes, quests…) | `DataSourceRegistry` | [Data sources](data-sources/) |
| Run your code when a player clicks a button | `CommandRegistry` | [Commands](commands/) |
| Open a menu from your code, run admin-authored actions | `ModuleActionsApi` | [Menus](menus/) |
| Appear in the editor as a module, read project files, hot-reload | `ArtisanModule`, `ProjectContentApi` | [Modules](modules/) |
| Give admins a generated config UI for your plugin | `ModelRegistry`, `EditorScreenRegistry` | [Data models & config screens](data-models/) |
| Store data in the suite's shared SQL database | `DatabaseApi` | [Database](database/) |
| React to reloads | `ModuleEventBus` | [Events & reloads](events/) |

## Three levels of integration

| Level | You do | Admins get |
|---|---|---|
| **1 — Data source** | Register one `DataSourceDeclaration` | Your live rows in any menu: paginated, filtered, sorted, placed on slots |
| **2 — Module** | Implement `ArtisanModule`, register it, add commands | Level 1 + your plugin listed in the editor, buttons that call your code, hot-reload when content changes |
| **3 — Add-on** | Level 2 + declared models, config screens, an owned project | A full configuration UI for your plugin: typed forms, translations, item pickers, live edit |

The Boutique add-on (a shop) is the reference level-3 integration; several
examples in this guide come from it. The [worked example](example/)
builds a small level-3 add-on from scratch.

## Read in order

1. [Depend on the API](setup/) — build file, `plugin.yml`, getting the `ArtisanAPI` handle, versions
2. [Threading & Folia](threading/) — which thread calls you, and how to schedule work
3. [Modules](modules/) — the lifecycle every integration hangs on
4. The topic pages above, as you need them
5. [Worked example](example/) and the [API reference](api-reference/)

## What Artisan guarantees you

- **Files are the source of truth.** Everything an admin edits lands as plain
  YAML in a project directory on the server disk. Your plugin reads files and
  keeps working when nobody has the editor open.
- **A versioned API.** Members marked `@Stable` follow SemVer within a major
  version; `@Beta` members may change in a minor version. Every member carries
  the API version it appeared in (its *Since*).
- **No coupling between integrations.** Plugins never import each other's
  classes — they meet through the registries (data sources, commands) and the
  event bus.
- **Artisan is optional-friendly.** With `softdepend`, your plugin can run with
  or without Artisan installed.
