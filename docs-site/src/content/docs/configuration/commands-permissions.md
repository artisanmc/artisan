---
title: Commands & permissions
description: The /artisan command and the editor permissions.
sidebar:
  order: 6
---

## Commands

| Command | Description |
|---|---|
| `/artisan menu <id>` | Open a menu by id. Players only; ids autocomplete. |
| `/artisan reload` | Re-read `config.yml`, `environment.yml` and the language files, and reload every project from disk (including files edited by hand). On a leaf, reconnects to the hub. The web server and database pools are not restarted: `web.*` and `database.*` changes need a server restart. |
| `/artisan editor` | Print your single-use sign-in link to the editor. Players only; requires `artisan.editor.view`. See [Open the editor](/wiki/getting-started/open-the-editor/). |
| `/artisan sync reject` | Reload projects from disk; on a leaf, reconnect to the hub. |
| `/artisan sync status` | Only points to the server log. |

Projects can also declare their own commands; they are registered when the project
loads and skipped (with a warning in the log) if another plugin already owns the name.

:::caution
Artisan declares no permission on `/artisan menu`, `/artisan reload` and
`/artisan sync`. Restrict them with your permissions plugin if players must not run
them (for example by denying the `artisan` command and granting it to staff).
:::

## Permissions

| Permission | Allows | Default |
|---|---|---|
| `artisan.editor` | All four editor permissions below. | op |
| `artisan.editor.view` | Request a link with `/artisan editor`, open the editor, read projects. | op |
| `artisan.editor.edit` | Change projects (private drafts). | op |
| `artisan.editor.publish` | Publish projects to the server; upload the resource pack. | op |
| `artisan.editor.config` | Change `config.yml` from the editor's server page. | op |

The editor reads these permissions when the link is requested and keeps them for the
12-hour session: after changing them, request a new link.

In a network, each server reads the permissions of the player who types
`/artisan editor` **on that server** and passes them to the hub; the hub checks no
permission of its own. Give editor permissions on the servers where your staff
requests links.
