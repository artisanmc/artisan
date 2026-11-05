---
title: Bedrock players
description: Show your styled menus to Bedrock players through Geyser, on the server or on the proxy.
sidebar:
  order: 9
---

Artisan builds a Bedrock pack that redraws the menus you styled in the editor, and hands it to
Bedrock players through Geyser. Chests of 1 to 6 rows work; a chest of 1, 2, 4 or 5 rows shows a
plain band where Bedrock keeps the rows it lacks. Bedrock players are recognised by their
Floodgate UUID.

Where is your Geyser?

## Geyser on the Minecraft server (Geyser-Spigot)

1. Start the server once with Artisan and Geyser-Spigot.
2. Artisan writes `plugins/Geyser-Spigot/custom_mappings/artisan.json` and asks for a restart.
3. Restart. Bedrock players now get the menus.

## Geyser on the proxy (Velocity, BungeeCord)

1. Drop `artisan-geyser.jar` into the proxy Geyser's `extensions/` folder and start the proxy once.
2. Edit the file it created, `extensions/artisan/config.yml`:

   ```yaml
   # the editor's address: the plugin's web.url, or http://<server ip>:8765
   hub: "https://survie.artisanmc.app"
   # content of plugins/Artisan/server-id on the server whose menus Bedrock players see
   server: "3f6c1a0e-…"
   ```

3. Restart the proxy (this also loads the click mapping the extension writes).

From then on, the extension checks the server's Bedrock pack every 30 seconds and hands the new
one to Bedrock players at their next connection: no copy, no restart.

**Without the extension**, copy by hand after each change, and only one of the two methods, or
players receive the pack twice:

| From the server | Into Geyser |
|---|---|
| `plugins/Artisan/cache/bedrock-pack/<hash>.mcpack` | `packs/` |
| `plugins/Artisan/cache/geyser/custom_mappings/artisan.json` | `custom_mappings/` |
