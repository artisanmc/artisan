---
title: Install Artisan
description: Install the Artisan plugin on a Paper server, start it, and check the editor runs.
sidebar:
  order: 2
---

Check the [requirements](../requirements/) first. Installing on
several servers behind a proxy? Read [Network mode](../../network/concepts/) too.

## 1. Add the jar

Download the latest `artisan-plugin-<version>-all.jar` from the Artisan releases and
drop it into your server's `plugins/` folder.

If you build from source, embed the editor:

```bash
cd plugin
./gradlew shadowJar -PwithEditor   # → paper/build/libs/artisan-plugin-<version>-all.jar
```

A jar built without `-PwithEditor` runs, but its web server only answers
`This Artisan build does not embed the editor.`

## 2. Start the server

On first start Artisan creates its folder:

| Path | Content |
|---|---|
| `plugins/Artisan/config.yml` | Server settings: language, resource pack. Editable from the editor. [Reference](../../configuration/config-yml/) |
| `plugins/Artisan/environment.yml` | Where and who this server is: web editor, network, database. Never read nor written by the editor. [Reference](../../configuration/environment/) |
| `plugins/Artisan/modules/` | Your projects (menus, dialogs, images), one folder each. Servers from before October 2026 had them in `projects/`: Artisan moves them on first start and keeps the old folder as `projects.artisan-migrated/`. An add-on keeps its own files in its plugin folder (`plugins/ArtisanConversations/artisan/`): delete that folder with the jar to uninstall it. |
| `plugins/Artisan/database/` | The embedded H2 database (`suite.mv.db`), created when a plugin first asks for the database. |
| `plugins/Artisan/cache/` | Downloaded Minecraft assets, resource packs (Java and Bedrock), asset index. |
| `plugins/Artisan/network-secret` | Only on a network hub with no other secret source. See [the shared secret](../../network/setup/#4-the-shared-secret). |
| `plugins/Artisan/tunnel-secret` | On the hub using the tunnel: it fixes the editor's `https://<id>.artisanmc.app` address. Delete it to get a new address. |

The console should show:

```
[Artisan] Editor listening on port 8765
Artisan <version> enabled
```

| Instead you see | Fix |
|---|---|
| `[Artisan] Editor disabled: cannot listen on *:8765 (…)` | The port is taken or refused. Change `web.port` in `environment.yml` and restart. |
| `[Artisan] Editor disabled: web server libraries are missing (…)` | Paper could not download Jetty. Give the server outbound access to Maven Central for one start. |
| `menu packets unavailable on this server — menus will open empty` | Your Minecraft version is newer than this Artisan. Update Artisan. |
| `Spigot <version> is not supported` | Spigot before 26.1. Update Spigot, or use Paper. |

### Bedrock players (Geyser)

Artisan can redraw your menus for Bedrock players through Geyser. See
[Bedrock players](../../configuration/bedrock/).

## 3. Nothing to open (or your own address)

By default the editor goes through the Artisan tunnel server: `/artisan editor` gives an
`https://<id>.artisanmc.app` link and no port needs to be open. To serve it yourself
(the tunnel server sees the editor's traffic), set `web.url` and open port 8765 or put a
reverse proxy in front: see [Web server & HTTPS](../../configuration/web-server/).

## 4. Next steps

- [Open the editor](../open-the-editor/) with `/artisan editor`.
- [Build your first menu](../first-menu/).

## Usage statistics (bStats)

Artisan reports anonymous usage to [bStats](https://bstats.org), like most plugins: the
server count, player count, Minecraft and Java versions, plus four Artisan charts: the active
modules (Artisan's own and the suite's add-ons; any other module only counts as `other`),
whether the server is a hub, a leaf or has the editor off, the database type and the
`language` setting. Nothing identifies the server or its players. To turn it off for every
plugin, set `enabled: false` in `plugins/bStats/config.yml` and restart.

## Updating

Stop the server, replace the jar, start it again. Projects, `config.yml` and
`environment.yml` are kept. In a network, update every server together: a server
whose protocol differs from the hub's cannot be edited (see
[Protocol versions](../../network/concepts/#protocol-versions)).
