---
title: Image buttons
description: Use a PNG as a clickable menu button covering one or several slots.
sidebar:
  order: 3
---

Open **Buttons → Images**, upload a PNG if needed, then drag its thumbnail
onto the menu. The button automatically occupies one slot per 16 source pixels
in each direction (rounded up): 16×48 uses 1×3 slots; 48×16 uses 3×1; 32×32 uses 2×2.
You can also convert an existing item by choosing **Image** in its appearance card.
While dragging, the image preview uses its native pixel dimensions at the current
canvas zoom, matching its size after placement instead of a fixed-size thumbnail.
The preview is centered on the pointer whether you grab the thumbnail, name or slot label.
Images imported here are classified as buttons. Manage their classification in
the project's **Resources** tab: a background or decoration is offered here only
when it is also classified for buttons. Several uses share the same image file.
To use an image of another project of the server, choose that project in the
**Project** menu above the thumbnails: the image is copied into your project when you drop it
(see [Projects](../projects/)).
Adjust **Width** and **Height** in slots:
2 × 1 makes a horizontal button, 1 × 2 a vertical button, 2 × 2 covers four slots,
and 3 × 2 or 2 × 3 covers six. Drag the image to move the entire button.

**Natural size** is the default for new buttons: an 8×8 PNG stays 8×8 and is centered.
Use **Horizontal/Vertical offset (px)** to move it within the area, or **Center image**
to reset both offsets. Pixels outside the area are clipped; the clickable slots stay fixed.
**Contain** preserves the image's proportions and centres it in the area with
transparent padding. **Stretch** fills the entire area. The source PNG is unchanged.
Replacing an existing button's image keeps its area and settings. **Fit slots to image**
recalculates its footprint when desired. Existing buttons retain their previous rendering.

**Using Nexo glyphs.** In the project's **Resources** tab, **Import from Nexo** lists
the glyphs configured in `plugins/Nexo/glyphs/` on the server. Selected glyphs are
copied into the project as images, so they work as buttons, backgrounds or title
glyphs like any upload. Greyed glyphs have no texture in the Nexo pack. If you change
a glyph in Nexo, import it again: the image is updated and its uses are kept.

Configure the title, lore and click actions as usual. Every slot in the rectangle
triggers the same actions, including transparent parts of the image. Minecraft
handles clicks by slot, so the small gaps between slots are not separate targets.
Titles and lore appear on hover and use the player's language, including when a
project command opens the menu. If per-player language is disabled, the plugin's
configured language is used; missing translations fall back to the project default.

Each conditional state can select its own image and actions. A state is a complete
appearance: it does not inherit omitted fields from the default appearance.
All states share the element's position and dimensions.
To change another button's state, use a click action such as `set test_tag = "test"`
and the condition `test_tag == "test"` on that button's state. The quotes delimit
the text value. Setting the value already refreshes the current menu; reopening it
with `open_menu` is optional.

The rectangle must fit inside the menu and cannot overlap another element. When the
menu hides the player inventory, an image button can also sit in the 3 inventory
rows or in the hotbar — within one of them, since the gaps between these parts
break the slot grid.
Image buttons currently use fixed positions, without iteration or data placements.
Choose **Item** to return to a material-based appearance.

Players need the updated Artisan plugin and generated resource pack to see images.
A missing image is not left as an invisible clickable button.
