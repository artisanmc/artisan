---
title: Install Artisan
description: Install the Artisan plugin on a Paper server, start it, and check the editor runs.
sidebar:
  order: 2
---

Check the [requirements](/wiki/getting-started/requirements/) first. Installing on
several servers behind a proxy? Read [Network mode](/wiki/network/concepts/) too.

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
| `plugins/Artisan/config.yml` | Server settings: language, resource pack. Editable from the editor. [Reference](/wiki/configuration/config-yml/) |
| `plugins/Artisan/environment.yml` | Where and who this server is: web editor, network, database. Never read nor written by the editor. [Reference](/wiki/configuration/environment/) |
| `plugins/Artisan/modules/` | Your projects (menus, dialogs, images), one folder each. Servers from before October 2026 had them in `projects/`: Artisan moves them on first start and keeps the old folder as `projects.artisan-migrated/`. |
| `plugins/Artisan/database/` | The embedded H2 database (`suite.mv.db`), created when a plugin first asks for the database. |
| `plugins/Artisan/cache/` | Downloaded Minecraft assets, resource packs, asset index. |
| `plugins/Artisan/network-secret` | Only on a network hub with no other secret source. See [the shared secret](/wiki/network/setup/#4-the-shared-secret). |

The console should show:

```
[Artisan] Editor listening on port 8765
Artisan <version> enabled
```

| Instead you see | Fix |
|---|---|
| `[Artisan] Editor disabled: cannot listen on *:8765 (…)` | The port is taken or refused. Change `web.port` in `environment.yml` and restart. |
| `[Artisan] Editor disabled: web server libraries are missing (…)` | Paper could not download Jetty. Give the server outbound access to Maven Central for one start. |
| `PacketEvents failed to load — menus will open empty` | Your Minecraft version is newer than the bundled PacketEvents. Update Artisan. |

## 3. Open the port, or put a proxy in front

Admins reach the editor on port 8765 of the server. Either open that port in your
firewall for the people who edit menus, or keep it closed and serve the editor over
HTTPS through a reverse proxy or a tunnel: see [Web server & HTTPS](/wiki/configuration/web-server/).

## 4. Next steps

- [Open the editor](/wiki/getting-started/open-the-editor/) with `/artisan editor`.
- [Build your first menu](/wiki/getting-started/first-menu/).

## Updating

Stop the server, replace the jar, start it again. Projects, `config.yml` and
`environment.yml` are kept. In a network, update every server together: a server
whose protocol differs from the hub's cannot be edited (see
[Protocol versions](/wiki/network/concepts/#protocol-versions)).
