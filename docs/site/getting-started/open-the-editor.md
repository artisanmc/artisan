---
title: Open the editor
description: Sign in to the editor with /artisan editor, and give your team access.
sidebar:
  order: 3
---

## Get a sign-in link

Join the server and run:

```
/artisan editor
```

Artisan answers with a clickable link. The link:

- signs you in **as your player**: there is no password and no account;
- works **once** and expires after **60 seconds**;
- can be requested **once per minute** per player (otherwise: `A link was just generated. Try again in N s.`).

The session it opens stays valid until **7 days without use** (`web.session-days` in
`environment.yml`), server restarts included: it is kept in the suite database. Once it
expires, or after **Sign out**, run the command again for a new link.

## From the console

Run `artisan editor` in the server console: it prints the link itself, as there is
nothing to click. The editor signs you in as **Console**, one identity shared by
whoever uses the console, with every editor permission: the same drafts, and
`Console` as the author in the history. `artisan editor logout` signs Console out
everywhere. Without `web.url`, the link uses the server's `server-ip`, else
`localhost`.

The link lands in the server log: it still works only once and for 60 seconds.

## Which address the link uses

| `web.url` in `environment.yml` | Link |
|---|---|
| empty (default) | `http://<address you joined the server with>:<web.port>/login/<token>` |
| set, e.g. `https://editor.example.com` | `https://editor.example.com/login/<token>` |

If you joined with `play.example.com`, the default link is
`http://play.example.com:8765/login/…`. Set `web.url` as soon as the editor sits
behind a reverse proxy, a tunnel, or a host name other than the one players join with.

In a [network](../../network/concepts/), `/artisan editor` works on every server:
a leaf asks the hub for the link, which uses the hub's `web.url`.

## Give access to your team

Permissions are read **when the link is requested**, then every minute while the player
is online on that server: a change applies within a minute, and removing
`artisan.editor.view` signs them out. To sign someone out right away, use
`/artisan editor logout <player>`.

| Permission | Allows | Default |
|---|---|---|
| `artisan.editor.view` | Open the editor and read projects. Required by `/artisan editor`. | op |
| `artisan.editor.edit` | Change projects (your private draft). | op |
| `artisan.editor.publish` | Publish projects to the server, upload the resource pack. | op |
| `artisan.editor.config` | Change `config.yml` from the editor's server page. | op |
| `artisan.editor` | All four above. | op |

Example with LuckPerms, for builders who can edit but not publish:

```
/lp group builder permission set artisan.editor.view true
/lp group builder permission set artisan.editor.edit true
```

Without `artisan.editor.view`, the command answers `[Artisan] Missing permission: artisan.editor`.

## If it does not work

| Message or symptom | Cause |
|---|---|
| `The web editor is not running on this server…` | `web.enabled` is `false`, the port is taken, or Jetty could not be downloaded. The startup log says which. |
| The link does not load in the browser | Port 8765 is not reachable from your computer: open it, or set up a [reverse proxy](../../configuration/web-server/) and `web.url`. |
| You land on the sign-in page instead of the editor | The link was already used or is older than 60 seconds. Request a new one. |
| Saving fails with `cross_origin`, or the editor never connects live | A reverse proxy rewrites the `Host` header. See [Web server & HTTPS](../../configuration/web-server/#what-the-proxy-must-do). |
| `The editor hub cannot be reached right now…` (on a leaf) | See [Network troubleshooting](../../network/troubleshooting/). |

Once signed in, continue with [your first menu](../first-menu/).
