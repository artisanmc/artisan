---
title: Network mode
description: How Artisan works across several servers — the hub, its leaves, project ids and versions.
sidebar:
  order: 1
---

Behind a proxy (Velocity, BungeeCord), you want to edit every server from one editor.

## Servers on one database (no setup)

Give your servers the same MySQL or MariaDB database ([Database](../../configuration/database/))
and leave `web.hub` empty: they find each other there. With the tunnel, they share **one
editor address** (`https://<id>.artisanmc.app`) whichever server you type `/artisan editor`
on, and it lists and publishes on **every** server of the database. They connect to each other with a secret kept in the database, over their internal
address when they reach it, else through their tunnel or `web.url`: no port to open, no hub
to pick, and the address keeps working while any one of them runs. Two admins on two links do
not see each other live; a publish that would overwrite the other's is refused instead.

## A fixed hub and leaves

To serve a single editor for the whole network instead, pick a hub and set `web.hub` on
the others: **one** Paper server then serves the editor for all of them.

| | Hub | Leaf |
|---|---|---|
| `web.hub` | `""` (the default) | The hub's address, e.g. `"10.0.0.5:8765"` |
| How many | Exactly one per network | Every other server |
| Web server | Serves the editor, its API, `/ws/editor`, `/ws/plugin` and resource packs on `web.port` | None: opens no port |
| Connection | Accepts leaves on `/ws/plugin` | Opens a WebSocket to the hub at `web.hub`, authenticated by the shared secret |
| Projects | Its own, in `plugins/Artisan/modules/` | Its own, in its `plugins/Artisan/modules/` |
| `/artisan editor` | Issues the link | Asks the hub for a link |

The hub is an ordinary Paper server of your network — a lobby, for example. Nothing
is installed on the proxy itself.

```
                    admins' browsers
                          │  https://editor.example.com
                          ▼
   ┌──────────── hub (lobby) ───────────┐
   │ Artisan, web.hub empty, port 8765  │
   └──────▲───────────────────▲─────────┘
          │ /ws/plugin        │ /ws/plugin      (internal network, shared secret)
   ┌──────┴──────┐     ┌──────┴──────┐
   │ leaf        │     │ leaf        │
   │ survival    │     │ skyblock    │
   └─────────────┘     └─────────────┘
```

## Everything stays on each server's disk

Each server keeps its own projects, published files and drafts on its own disk. The
hub does not copy them: when you open a leaf's project, the editor reads and writes
it through that leaf's connection. Menus run on each server from its own files.

Consequences:

- A leaf runs its menus normally while the hub is down; only editing waits.
- Projects are not shared: a project published on `survival` exists only on `survival`.

## Project ids

The editor names projects by server:

| Where the project lives | Id in the editor |
|---|---|
| On the hub | `<folder>`, e.g. `shop` |
| On a leaf | `<server>.<folder>`, e.g. `survival.shop` |

`<server>` is the leaf's `name`, or its folder name when empty. Two servers may
have a project folder with the same name; the prefix keeps them apart. Choose stable
names: renaming a server changes the ids of its projects in the editor.

Each server name must be unique in the network. A second server connecting with a
name already in use replaces the first one's connection.

## Offline servers

A leaf that disconnects stays listed in the editor as **offline**. Its projects
cannot be saved or published until it reconnects; the editor may show the last
version you visited. A leaf that has not connected since the hub started is not
listed at all.

Leaves reconnect by themselves, retrying after 1 s, then doubling up to every 60 s.
Restart order does not matter. `/artisan reload` on a leaf reconnects immediately.

## Protocol versions

Leaves announce their protocol version when they connect. Run the **same Artisan
release on every server**:

- A different **major** version: the hub logs
  `[Artisan] Server <name> speaks protocol <x>, the hub <y>: update both to the same release`,
  and the editor shows the server as **Update required** and does not edit it.
- An older **minor** version: the server works, but newer actions (for example
  creating, deleting or renaming projects) answer `plugin_update_required`.

## Shared data

A network shares one MySQL or MariaDB database, required for more than one server:
Artisan keeps the list of servers there, and add-ons of the suite (a shop, for example)
keep their shared data in it — see [Database](../../configuration/database/).

Next: [set up a network](../setup/).
