---
title: Composed titles
description: Add and align resizable text in resource-pack menu titles.
sidebar:
  order: 6
---

Select a menu, open **Menu appearance** and switch to **Composed** mode.
**Add an image**, next to **+ Text**, offers your
**Menu images** and can import a new one directly. Backgrounds, logos and
decorations are all images: place them freely and reorder their layers.
**Show all images** lets you reuse another project image: choosing it adds the
new use to the same file. Manage these uses in the project's **Resources** tab.
Remove a layer to remove its image from this menu without deleting the resource.

## Default texture

In composed title mode, the first row of the layer list is **Default texture**:
the vanilla container background (chest, hopper or dropper). Turn it off to draw the whole window yourself — the
menu becomes fully transparent in game, including the player inventory part
(its slots stay usable, just invisible). Add an image layer at `x = 0`, `y = 0`
to bring your own texture. On the canvas, a dashed outline and faint slot cells
remain so you can still place buttons.

Every other container of that kind on the server keeps its normal look: players
who loaded the resource pack get the vanilla texture drawn back through the window
title. Dispensers and droppers share one texture, so a transparent dropper menu
redraws every dispenser too.
Players who declined the pack see your menu over the plain vanilla texture.
If your server's resource pack restyles these containers, import its
`generic_54.png`, `hopper.png` or `dispenser.png` in a project's **Resources**, publish
it, then pick it under **Container textures** in the **Settings** tab of the
server page: the windows drawn back use it instead of the vanilla texture (256×256,
or a multiple for an HD pack). The choice is saved in the server's `config.yml`
(`resource-pack.container-textures`). A texture pack a player picks on their own side is not kept while this is
active. Switching back to a vanilla title turns the texture on again.

## Text

In composed title mode, use **+ Texte** for both single-line and multiline text.
Enter line breaks directly; longer text wraps automatically to the block's width.

Select the text and drag its right-hand handle, or edit **Largeur (px)**, to set
the width (8–256 Minecraft pixels). Font size changes the letters, not this width.
Use the left, center or right alignment buttons to position each line inside the
block. Changing alignment or width keeps the left edge of the block in place.
**X** and **Y** position the block; line height controls spacing between lines.
**Adjust line spacing**, beside the spacing label, sets it to the text size plus
2 pixels (maximum 32). Horizontal alignment has its own separate row.

Existing Text and Textarea layers both appear as **Texte** and remain editable.
Their translations are retained when editing them through the unified controls.
Composed titles require the server's resource pack; vanilla title mode is unchanged.

Image layers are dragged freely, or placed with their **X** and **Y** fields. An
image can't go above `y = 13 − its height`. **Choose an image** lists images for the
layer's use and has an **Upload** button; its name defaults to the file
name. A newly placed height reaches players with the next resource pack, sent after
**Deploy**.
