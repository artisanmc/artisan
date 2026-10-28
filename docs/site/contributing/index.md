---
title: Contributing
description: Architecture and development guide for contributors and forkers.
sidebar:
  order: 1
---

Artisan has no backend: the Paper plugin serves the editor, its API and the resource
pack itself. The architecture notes for contributors live in the repository, under
`docs/architecture/` (in French).

## Repository layout

| Folder | Content |
|---|---|
| `editor/` | The web editor (React 19, Vite, Konva). It also builds the resource pack, in the browser. |
| `plugin/` | The Paper plugin (Kotlin 2.0), in Gradle modules: `api` (surface for add-ons), `core` (domain, no Bukkit), `database`, `hub` (web server and network), `paper` (Bukkit integration and the jar). |
| `tools/minecraft-assets/` | Bun generators for vanilla Minecraft assets (item catalogue, 3D icons, glyph widths). Their outputs are committed and embedded in the jar. |
| `docs-site/` | This wiki (Astro Starlight). |
| `docker/` | Local Minecraft servers for development. |

## Running it locally

```bash
cd plugin
./gradlew test                     # plugin test suite
./gradlew shadowJar -PwithEditor   # jar with the editor embedded (npm required)
cd ..
docker compose up                  # Paper on 25565, editor on http://localhost:8765
```

Join the server, type `/artisan editor` and open the link. For a hub and a leaf
server, use `docker compose -f docker/network/compose.yml up` instead.

Editor tests run with `cd editor && npm test`; the self-hosted build alone is
`npm run build`.
