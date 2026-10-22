---
title: Requirements
description: What your server needs before you install Artisan.
sidebar:
  order: 1
---

Artisan is a single Paper plugin. It serves the web editor itself, from your own
server: there is no account, no cloud service and no separate backend to run.

## Server

| Requirement | Detail |
|---|---|
| Server software | Paper 1.21 or newer. Folia and Leaf (Paper forks) are supported. Spigot and CraftBukkit are not. |
| Java | Java 21 or newer, and at least what your Minecraft version requires. |
| Outbound internet at first start | Paper downloads the plugin's libraries from Maven Central when Artisan first loads: HikariCP, the H2, MySQL and MariaDB drivers, and Jetty (the editor's web server). If Jetty is missing, the plugin runs without the editor. |
| One free TCP port | `8765` by default, for the editor. In a network, only the hub opens it (see [Network mode](../../network/concepts/)). |

PacketEvents is bundled in the jar: you do not need to install it for Artisan.

## Who needs to reach what

| Who | Reaches | When |
|---|---|---|
| Admins (browser) | The editor port, or the HTTPS address in front of it | Always, to use the editor |
| Players (Minecraft client) | Nothing beyond the Minecraft port | Always: the pack comes from your pack plugin (see [Resource packs](../../configuration/resource-packs/)) |
| Other servers of a network | The hub's `/ws/plugin`, on the editor port | Only in [network mode](../../network/concepts/) |

## Optional plugins

Artisan detects these when they are present, and works without them:
Vault, PlaceholderAPI, WorldGuard, HeadDatabase, and the resource-pack hosts Nexo,
Oraxen and ItemsAdder.

## Database

Nothing to set up: Artisan uses an embedded H2 file by default. MySQL 8+ and
MariaDB 10.6+ are supported when several servers must share data — see
[Database](../../configuration/database/).
