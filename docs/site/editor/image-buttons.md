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
and 3 × 2 or 2 × 3 covers six. Drag the image to move the entire button: the part of the
button you hold lands on the slot under the pointer. Release it over another menu of the
project to move it there.

**UI kit.** Beside **Item** and **Image**, **UI kit** lists the images every server has
(`kit:button.3x1`, `kit:close.1x1`, arrows, toggles…) and the images of this server's `ui-kit`
module. The menu names the image instead of copying it: when the server redraws the kit's
button, every menu that names it follows. A kit image whose name ends with its slots (`3x1`)
takes that area. A title's image layer offers the same list, with the kit's windows
(`kit:window.6`, `kit:window.3`).

**Composed images.** An image may be a recipe instead of a PNG: a `compose:` list in its
`.yml`, which stacks kit images and PNGs of the module (see
[AI](../../configuration/ai/), "Composed images"). The Resources page lists it with its picture
and says what it is made of; you rename, duplicate or delete it there. It has no file to
reimport, and it stays in its module: another module cannot copy it.

**Compose an image** in the Resources page starts one from a kit window or a kit button. Its
detail is a composer: drag a layer to move it (hold Shift to move by one slot, or use the arrow
keys for one pixel), reorder or remove layers in the list, add a **Kit piece** or a
**Module image**. A layer repeats with **Columns** and **Rows** (the slots of a window: a grid
of `kit:cell`). The image is as large as its bottom layer reaches unless you give it a
**Fixed size**; what goes past is cut. **Save layers** writes the recipe into your draft.

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
In the editor, image buttons use fixed positions. A menu written in YAML can also put an
`image` on an element that iterates a list or places rows (`iterates`, `places`): each slot
then shows its own 18×18 image, chosen per row by the element's states, with the row's title,
lore and clicks. Give such an appearance a `material` too: players without the resource pack,
Bedrock players, and rows whose image is not in the pack yet see that item instead.

```yaml
- id: days
  positions: "10-16,19-25"
  iterates: { source: days, alias: d }
  states:
    - if: [{ expression: d.is_claimed }]
      image: { asset: day_claimed, fit: stretch }
      material: GRAY_DYE        # without the image
      title: "Claimed"
  item: "{d.icon}"
```
Choose **Item** to return to a material-based appearance.

**Label.** Any button that does not repeat (no `iterates`/`places`) can carry a **Label**:
a text drawn in the menu's title over the button's slots. It is centred in the button by
default; **Alignment**, the text size and the offsets (in pixels) move it inside the area.
The label follows the button when you move or resize it, and each state has its own, so a
button can show "Claim" in white when a reward waits and in grey otherwise. It reads
placeholders like any title text (`{status[0].freezes}/{status[0].freeze_max}`). Bedrock
players and players without the resource pack do not see it, nor is it drawn over an image
missing from the pack.

```yaml
- id: freezes
  positions: "7-8"
  image: { asset: freeze_box, fit: native }
  label: { text: "<aqua>{status[0].freezes}/{status[0].freeze_max}" }
  title: "Freezes"
  lore: [ "A freeze covers one missed day." ]
```

**Hover area.** A button with neither image nor item (no `image`, `material` nor `item`) is
invisible: its slots show nothing but keep its title, lore and clicks. Use it to explain a
part of a background image on hover, or to put a label on the background.

Players need the updated Artisan plugin and generated resource pack to see images.
A missing image is not left as an invisible clickable button.
