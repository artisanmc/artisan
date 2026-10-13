---
title: Network troubleshooting
description: Diagnose leaves that do not connect, refused secrets, offline servers and version mismatches.
sidebar:
  order: 4
---

Most problems show in two places: the **hub's** console (connections, refusals) and
the **leaf's** console (connection failures).

## A leaf never appears in the editor

Check the leaf's startup log for:

```
[Artisan] Editor served by the hub at ws://10.0.0.5:8765/ws/plugin
```

| Leaf log | Cause | Fix |
|---|---|---|
| No such line | `web.hub` is empty (the server runs as a second hub) | Set `hub` to the hub's address, e.g. `"10.0.0.5:8765"`, and restart. |
| `WS failure: Failed to connect to /10.0.0.5:8765` (or similar) | The leaf cannot reach the hub: wrong address, hub down, firewall, hub `web.bind` on another interface | Test from the leaf machine: `curl -I http://10.0.0.5:8765/`. |
| Line present, no `WS failure`, hub logs nothing | The leaf found **no secret** at all, and does not try to connect | Set `web.secret`, or enable Velocity forwarding, or copy the hub's `network-secret` (see [the shared secret](/wiki/network/setup/#4-the-shared-secret)). |

On the hub, a successful connection logs `[Artisan] Server <name> connected to the editor`.

## The hub refuses a leaf

The hub logs:

```
[Artisan] Server refused on /ws/plugin: invalid server_key
```

The secrets differ. Common causes:

- `web.secret` set on some servers only — it takes priority over Velocity's secret,
  so set it on all or none;
- Velocity forwarding enabled on the hub but not on a leaf (or the reverse);
- a leaf copied an old `network-secret` from a hub that has since regenerated it.

```
[Artisan] Server refused on /ws/plugin: invalid proxy_name
```

The leaf's name was not accepted by the hub. Set another `name`, using letters,
digits, `_` or `-`.

```
[Artisan] name "…" in environment.yml is invalid: …
```

The leaf refuses its own `name` before connecting: it contains a character other than
letters, digits, `_` and `-`, is longer than 64 characters, or is `local` (reserved for
the hub). Artisan never rewrites a written name, since it must match the server's name in
`velocity.toml`. Fix it and restart.

A refused leaf keeps retrying, up to once a minute.

## Two servers fight over one entry

Two leaves share a name (often both empty `name` with the same folder name, such
as `data` in Docker images). Each connection replaces the other. Give every server a
distinct `name`.

## `/artisan editor` on a leaf: "The editor hub cannot be reached right now"

The leaf is not connected to the hub at that moment. See
[A leaf never appears](#a-leaf-never-appears-in-the-editor). The same message appears
when the hub answers with an error.

## The link from a leaf does not open

The hub builds the link. Without `web.url` on the hub, it uses the address the player
joined with plus the hub's port — behind a proxy, that is the proxy's address. Set
`web.url` on the hub.

## `server_offline`

The editor shows a server as **offline**, or an action fails with `server_offline`:
the leaf disconnected, or has not reconnected yet after a restart (retries go up to
60 s apart). Its menus keep running for players. Wait, or run `/artisan reload` on the
leaf to reconnect at once. A leaf that has not connected since the hub started is not
listed at all.

## `plugin_update_required` / "Update required"

The server runs a different Artisan release from the hub:

- **"This server needs an Artisan update"** in the editor, and on the hub:
  `[Artisan] Server <name> speaks protocol <x>, the hub <y>: update both to the same release`
  — the major protocol version differs; the editor does not edit that server.
- **`plugin_update_required`** on a single action (create, delete, rename a project) —
  the leaf is older than the hub; everything else works.

Install the same jar on every server and restart them.

## Leaf projects work, but add-on data differs between servers

Each server uses its own H2 database. Switch every server to the same MySQL or
MariaDB — see [Database](/wiki/configuration/database/).

## Resource pack fails on leaves

In push mode, players of every server download the pack from the **hub's** `web.url`:
it must be reachable from the internet. In delegation mode, the leaf downloads it from
the address in its `web.hub`; the log shows
`[delegate] apply failed: download or extract of <url> failed: …` when it cannot. See
[Resource packs](/wiki/configuration/resource-packs/#in-a-network).
