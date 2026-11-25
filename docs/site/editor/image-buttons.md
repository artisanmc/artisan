---
title: Image buttons
description: Use a PNG as a clickable menu button covering one or several slots.
sidebar:
  order: 3
---

Open **Buttons → Images**, upload a PNG if needed, then drag its thumbnail
onto the menu. The button automatically occupies the slots it needs to fit, a slot being 18
pixels from the next: 54×18 uses 3×1 slots; 54×36 uses 3×2; 16×16 uses one; 48×16 uses 3×1.
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

**Common images.** Beside **Item** and **Image**, **Common** lists the images every server has
(`button.3x1`, `close.1x1`, arrows, toggles…) and the ones this server added, kept in
`plugins/Artisan/themes/artisan/`. The menu names the image instead of copying it: when the
server redraws the common button, every menu that names it follows. A common image whose name
ends with its slots (`3x1`) takes that area. A title's image layer offers the same list, with
the common windows (`window.6`, `window.3`). When the server's pack is built in a theme
(see [AI](../../configuration/ai/), "Themes"), the editor shows these images in that theme, as
players see them.

**The same name in two modules.** A menu shows the image of its own module. When two modules
each hold a `gold.png`, each one's menus show their own. To show another module's image, name
it with its module in the menu's file: `image: { asset: "guilds:gold" }`. The editor's picker
lists the open module's images and the common ones.

**Common images by their name.** A name the menu's module holds no image of is a common image:
`button.3x1` shows the server's common image of that name, even when another module holds a
`button.3x1` of its own. A module that draws its own `button.3x1` shows it in its own menus
only; `artisan:button.3x1` shows the common one there too. The picker writes the name alone,
and `artisan:<name>` when the open module holds an image of that name. `kit:button.3x1`, which
older menus hold, means the same and stays read. A name that neither the menu's module nor the
common images hold still reaches another module's image of that name, as before.

**Common images in a module's Resources.** The **Module** selector of the Resources screen has
an entry **Common images**, beside this module, all modules and the other modules. It lists
every common image as the server has it deployed; one selected shows its size, who drew it
(**Artisan**, **Redrawn** or **This server's**) and what a menu of the open module writes to
name it. Nothing is copied into the module. **Redraw for the server** (a piece still Artisan's)
or **Open in the common images** opens the image in the atelier of the common images. The
common images are not one of the other modules of that selector. **Menus that name it** lists
the menus of the whole server that show this image, each a link to that menu: the other
modules' menus as deployed, the open module's as you are editing them. A menu whose module
holds an image of the same name is not listed, since it shows its own.

**Resources, a tab of the server.** The server page's **Resources** tab is the Resources screen
for the whole server: the images and fonts of every module and the common images in one list,
as deployed. **Show** narrows it to one module or to the common images. An image selected
shows who provides it (its module, or the common images), its size, and the menus of the
server that name it, each a link to that menu: a menu of its own module that writes its name,
and a menu of another module that writes `<module>:<name>`. Nothing is changed from this
list: **Open in** opens the module's Resources on that image, and a common image opens in the
atelier of the common images.

**Show: Common images** is the page of the common images alone, as the server has them
deployed: every piece of the base by family (buttons; windows, panels and
values; arrows and controls) with its size and who drew it, **Artisan** or this server
(**Redrawn**), then the images the server added. Each image says how many deployed menus name
it, so an image no menu names is seen before it is redrawn. **In a menu** sets every piece on one window,
as players see it. Click a piece, on its card or on that menu, to open it in the atelier of the
common images (the theme `artisan`, which is not in the module list): a piece still Artisan's
is first copied under the piece's name, at the piece's size, so the menus keep their layout.
An image of a piece's name at another size is not taken: menus keep the original, and the
image is marked **Not taken**, with its size and the piece's, on its card, in the Resources
lists and in the common images' own Resources, until it has the piece's size.
A piece the server drew its own version of shows **Artisan's original** beside it, wherever
the image is selected. In the common images' own Resources, **Restore the original** deletes
the server's version: it gives the piece back to Artisan: the base Artisan ships stays beside it, in
`themes/artisan/originals/`, rewritten when an update of Artisan changes it. Like any change, a
redrawn piece reaches players when the draft is deployed and the pack rebuilt.

A server that had a `ui-kit` module keeps its images: at the first start after the update, the
module's folder moves to `plugins/Artisan/themes/artisan/`, and the menus that name its images
keep working.

**Themes.** The tab lists the themes, the one in place marked. A theme opens on what it
changes (the colours it replaces, the pieces it redraws) and on the same menu without it and
with it. **Put in place on the server** sets the server's theme and rebuilds its pack: players
receive it at their next connection. **Take off the server** goes back to no theme. A theme's
files are written with the common images (see [AI](../../configuration/ai/), "Themes") and read
here once deployed.

**Composed images.** An image may be a recipe instead of a PNG: a `compose:` list in its
`.yml`, which stacks kit images and PNGs of the module (see
[AI](../../configuration/ai/), "Composed images"). The Resources page lists it with its picture
and says what it is made of; you rename, duplicate or delete it there. It has no file to
reimport, and it stays in its module: another module cannot copy it.

**New image** in the Resources page asks what the image is for, which gives its size: a
**menu background** (a window of 1 to 6 rows), **slots** (pick the area on a 9 × 6 grid: 3 × 1
for a button), an **icon** (16 × 16) or a **free size**. It starts empty, to be drawn, or from
a kit piece of that size, as a composed image.

**The atelier.** Selecting an image shows it in the side panel; **Open in the atelier** gives
it the whole page. A PNG opens in the pixel editor, a composed image in the composer: drag a
layer to move it (hold Shift to move by one slot, or use the arrow keys for one pixel), reorder
or remove layers in the list, add a **Kit piece** or a **Module image**. A layer repeats with
**Columns** and **Rows** (the slots of a window: a grid of `kit:cell`). The image is as large
as its bottom layer reaches unless you give it a **Fixed size**; what goes past is cut. **Save
layers** writes the recipe into your draft. The atelier draws guides over the image, each
switched on or off: the **slots**, and on a menu background the **inventory** and the
**title** line. **In a menu** shows an image on slots at the game's size, on the kit's window,
while you draw.

**One image, one or several layers.** A PNG open in the atelier is an image of one layer.
**Add layers** turns it into a composed image of the same name whose first layer is that
drawing (kept in the module as `<image>_layer`): the menus that show it keep showing it, and
you set kit pieces or other drawings over it. **Flatten**, on a composed image, does the
reverse: its layers become one PNG of the same name, which no longer follows the kit; the
layers stay in the module as images.

**Draw a layer** adds an empty image of the composed image's size on top of the others, saves
the recipe, and opens the pixel editor on it: you draw among the other layers, the ones above
shown through. The layer is a PNG of the module (`<image>_layer`), and the image stays a
recipe, so it still follows the kit. **Retouch this layer** does the same for any layer that is
a PNG of the module; a kit piece is redrawn among the common images.

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
