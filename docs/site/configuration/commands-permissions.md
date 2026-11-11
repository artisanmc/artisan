---
title: Commands & permissions
description: Every /artisan subcommand, every permission Artisan declares, and their defaults.
sidebar:
  order: 6
---

Artisan registers one command, `/artisan`, and the permissions below. Your projects can add
their own commands (see [Commands declared by projects](#commands-declared-by-projects)).

## Commands

| Command | Who can run it | What it does |
|---|---|---|
| `/artisan menu <id>` | `artisan.menu` (everyone by default), players only | Opens a menu by id. Ids autocomplete. |
| `/artisan reload` | `artisan.admin` | Re-reads `config.yml`, `environment.yml` and the language files, and reloads every project from disk, including files edited by hand. On a leaf, reconnects to the hub. The web server and the database pools are not restarted: `web.*` and `database.*` changes need a server restart. |
| `/artisan sync reject` | `artisan.admin` | Reloads projects from disk without re-reading `config.yml`. On a leaf, reconnects to the hub. |
| `/artisan sync status` | `artisan.admin` | Points to the server log, where the sync state is written. |
| `/artisan editor` | `artisan.editor.view` | Prints your single-use sign-in link to the editor. From the console, signs in as the shared Console identity. See [Open the editor](../../getting-started/open-the-editor/). |
| `/artisan editor logout` | anyone | Signs yourself out of the editor on every device (the Console identity from the console). |
| `/artisan editor logout <player>` | `artisan.admin` | Signs another player out of the editor on every device. `Console` names the console identity. |
| `/artisan editor sessions` | `artisan.editor.config` | Lists the open editor sessions of every server: player, server, last activity, rights, and whether the editor is open right now. Click a line to close that session. |
| `/artisan editor revoke <id>` | `artisan.editor.config` | Closes one session, by the start of its id as `sessions` shows it (8 characters at least). Its open tabs go back to sign-in. |
| `/artisan dump-title <id> [lang]` | `artisan.admin` | Diagnostic: prints how a menu's title is assembled, step by step, to the chat and the server log. Use it when a title sits differently in game than in the editor preview. |

`menu`, `reload`, `sync` and `dump-title` are hidden from tab completion for whoever lacks their permission.

In a network, `editor`, `editor logout`, `editor sessions` and `editor revoke` typed on a leaf
go through the hub; if the hub is unreachable they say so and change nothing.

## Permissions

| Permission | Allows | Default |
|---|---|---|
| `artisan.admin` | `/artisan reload`, `/artisan sync`, `/artisan dump-title`, and `/artisan editor logout <player>`. | op |
| `artisan.menu` | Open any menu by id with `/artisan menu`. Deny it to keep players to the menus your projects open for them. | everyone |
| `artisan.editor` | All four editor permissions below. | op |
| `artisan.editor.view` | Request a link with `/artisan editor`, open the editor, read projects, their versions and the server's settings. | op |
| `artisan.editor.edit` | Change projects (private drafts); use the editor's AI assistant; connect an AI app to the editor. | op |
| `artisan.editor.publish` | Publish projects to the server; rebuild or upload the resource pack and the Bedrock pack; let a connected AI app publish. | op |
| `artisan.editor.config` | Change the server's settings from the editor's server page; set up the AI assistant; pick the editor's address name on the tunnel; `/artisan editor sessions` and `/artisan editor revoke`. | op |

`artisan.editor` is a parent: granting it grants the four `artisan.editor.*` permissions. To give
a narrower set (for example read and edit, without publishing), grant the individual permissions
instead.

### When editor permissions change

The editor reads these permissions when the link is requested, then again every minute while
the player is online on the server where they requested it. A change applies within a minute;
removing `artisan.editor.view` signs them out of the editor.

In a network, each server reads the permissions of the player who types `/artisan editor`
**on that server** and passes them to the hub; the hub checks no permission of its own. Give
editor permissions on the servers where your staff requests links.

An AI app connected to the editor acts with the player's permissions, minus
`artisan.editor.config`, and without `artisan.editor.publish` unless the player allowed it to
publish when connecting it.

## Commands declared by projects

Projects can declare their own commands in the editor (name, aliases, permission, description,
cooldown, sub-commands). They are registered when the project loads, and skipped, with a warning
in the server log, if another plugin already owns the name.

Each command and sub-command can name a permission. Permissions add up on the way down: running
a sub-command needs its own permission and those of every command above it. A sub-command the
player lacks the permission for is hidden from their tab completion. These permissions are yours
to name: Artisan declares none of them, so the server treats them as op-only until your
permissions plugin grants them.
