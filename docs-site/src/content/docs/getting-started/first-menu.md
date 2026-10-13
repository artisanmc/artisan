---
title: Your first menu
description: Create a project, place items, publish, and open the menu in game.
sidebar:
  order: 4
---

A short path from an empty server to a menu players can open. Each step links to
the editor page with the details.

1. **Create a project** on your server. It becomes a folder,
   `plugins/Artisan/projects/<folder>/`. See [Projects](/wiki/editor/projects/).
2. **Add a menu** to the project and note its id, for example `shop`.
3. **Place items.** Open **Buttons**, drag a game item onto a slot, then select it to
   edit its name, lore and appearance. For artwork use
   [Image buttons](/wiki/editor/image-buttons/); for heads,
   [Custom heads](/wiki/editor/custom-heads/).
4. **Add actions**: what a click does — open another menu, run a command, close.
   Back buttons are covered in [Navigation](/wiki/editor/navigation/), dynamic text in
   [Expressions](/wiki/editor/expressions/).
5. **Save, then publish.** Saving keeps a private draft on the server, visible to you
   only. Publishing (requires `artisan.editor.publish`) writes the files players use.
6. **Open it in game:**

   ```
   /artisan menu shop
   ```

   Menu ids autocomplete. If the menu uses images or a composed title, the resource
   pack must reach players first: see [Resource packs](/wiki/configuration/resource-packs/).

Files edited by hand in a project folder are picked up with `/artisan reload`.

Next: [composed titles](/wiki/editor/composed-titles/),
[translations](/wiki/editor/translations/), and the full [editor guide](/wiki/editor/).
