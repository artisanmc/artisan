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
the common windows (`window.6`, `window.3`). When the server has themes in place
(see [AI](../../configuration/ai/), "Themes"), the editor shows these images in them, as
players see them.

**The same name in two modules.** A menu shows the image of its own module. When two modules
each hold a `gold.png`, each one's menus show their own. To show another module's image, name
it with its module: `image: { asset: "guilds:gold" }`. The editor draws it in the menu as that
module has it deployed, and says under the image whose it is. In the picker of a button's
image or of a title layer, choose the other module in the menu above the thumbnails: the image
you pick is copied into the open module, unless you tick **Name it in its module, without a
copy**. The menu then writes `guilds:gold`, follows what that module deploys, and needs that
module on the server.

**Common images by their name.** A name the menu's module holds no image of is a common image:
`button.3x1` shows the server's common image of that name, even when another module holds a
`button.3x1` of its own. A module that draws its own `button.3x1` shows it in its own menus
only; `artisan:button.3x1` shows the common one there too. The picker writes the name alone,
and `artisan:<name>` when the open module holds an image of that name. `kit:button.3x1`, which
older menus hold, means the same and stays read. A name that neither the menu's module nor the
common images hold still reaches another module's image of that name, as before. The editor
says so under the image, with a button that writes the name with its module (`guilds:gold`),
and the deploy review warns about it. Both also flag a name no image answers on the server,
which shows nothing in game. The review reads the same way the names an add-on's files write
(a HUD's images), and says which file writes them. The server says it too: each time it
rebuilds its pack, its console names, module by module, the images written that no image
answers and the layers of composed images that take nothing, once until the list changes. That is how a module's folder copied by hand from
another server tells what it lacks.

**Common images in a module's Resources.** The **Module** selector of the Resources screen has
an entry **Common images**, beside this module, all modules and the other modules. It lists
every common image as the server has it deployed; one selected shows its size, who drew it
(**Artisan**, **Redrawn** or **This server's**) and what a menu of the open module writes to
name it. Nothing is copied into the module. **Redraw for the server** (a piece still Artisan's)
or **Open in the common images** opens the image in the atelier of the common images. The
common images are not one of the other modules of that selector. **What names it** lists what
shows this image on the whole server: the menus, each a link to that menu, the composed images
built over it, and the files of a module that draw it on screen (a conversation's HUD, for
example). The other modules are read as deployed, the open module's menus, composed images
and files as you are editing them. A menu whose module holds an image of the same name is not listed,
since it shows its own.

**Making a module's image common.** On an image or a font of the module, **Copy to the common
images** opens the common images with a copy of it under the same name, in their draft: deploy
them and every module can name it. The module keeps its own image, which its menus still
show; delete it there afterwards and its menus take the common one, with nothing to rewrite
since the name is the same. The button is off when the common images already have an image of
that name, and is not offered for a composed image, whose layers are the module's. The
server's **Resources** tab has the same button on a module's own image or font.

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

When an update of Artisan changes an original the server drew its own version of, the image
says **The original changed since your version**. Menus keep showing the server's version.
**Keep mine** records that it is kept knowingly, and the notice goes; **Restore the original**
gives the piece back to Artisan, to redraw it from the new original. The same notice shows on
a module's image the server drew over. It needs Artisan up to date on the server that holds
the files, and it starts counting at the first start after the server's version was deployed:
an original that changes before that start is not flagged.

A server that had a `ui-kit` module keeps its images: at the first start after the update, the
module's folder moves to `plugins/Artisan/themes/artisan/`, and the menus that name its images
keep working.

**Themes.** The tab lists the themes, the ones in place first and numbered from the lowest to
the highest. A theme opens on what it changes (the colours it replaces, the pieces it redraws)
and on the same menu without it and with it. **Put in place on the server** sets the theme
above the ones already in place and rebuilds the server's pack: players receive it at their
next connection. Several themes stack: each changes what the ones below show, so the highest
that redraws an image wins, and a theme of colours alone repaints what is below it (a seasonal
palette over a drawn theme). **Take off the server** removes that theme alone; to move a theme
to the top, take it off and put it back, or reorder the list in **Configuration**, **Themes in
place**. A theme's
files are written with the common images (see [AI](../../configuration/ai/), "Themes") and read
here once deployed. **New theme** creates one, empty, as a folder of its own on the server
(`plugins/Artisan/themes/<name>/`): it changes nothing until it holds colours or redrawn
images and is put in place. Its page says where its files are; the assistant fills it when
asked ("make the buttons red in the theme noel"). A theme changes the common images, and may
redraw a module's own image at its size; its page lists both.

A theme may also hold images of its own, under `assets/` of its folder (`assets/textures/`,
`assets/glyphs/`): a garland for the winter look, say. A menu names one with its theme,
`noel:garland`, never by its name alone. It is in the pack as long as the server has the
theme, in place or not, and shows as drawn: no theme repaints it. The theme's page lists
them under **Its own images**, each as a menu writes it, and **Common** (on a button's image
or a title layer) offers them after the common images: the menu names the one you pick,
nothing is copied.

**Resources**, **Show: Themes** lists the server's themes: those in place, the highest first,
and the others. The highest theme that redraws an image wins, and its colours repaint what
the ones below show; drag a theme by its handle to change its place, **Take off** or **Put in
place** to change the list. Each change rebuilds the server's pack. A click on a theme opens
its page.

A theme created as a folder of its own is renamed and deleted from its page (**Rename**,
**Delete**, under where its files are). A renamed theme keeps its colours, its images and its
place among the themes in place. A deleted theme is taken off the server and its folder moved
to the server's trash (`plugins/Artisan/themes/.artisan-trash/`): nothing is erased, and
moving the folder back into `themes/` under the theme's name restores it at the server's
next start. The common images
(`artisan`) are neither renamed nor deleted. Both need the server's plugin to be up to date.

**Export** on that page downloads the theme as an archive (`<name>.theme.zip`): its folder as
the server holds it, colours and redrawn images. On another server, **Resources**, **Show:
Themes**, **Import a theme** reads the archive, proposes the theme's name (change it when the
server already has a theme of that name) and creates the theme with its files. An imported
theme is not put in place: open it, look at the menu with it, then put it in place. A
module's archive is not a theme's: it is imported from the server's modules.

On the page of a theme, **Artisan's colours** has one colour to pick per family: main
(buttons), danger (delete, close), accent (highlights) and neutral (windows, frames). Pick
what a family's colour becomes and its shades follow, darker ones darker, lighter ones
lighter; the menu beside shows the result before anything is written. **Save the colours**
writes them in the theme's `overrides/colors.yml` on the server, as the exact list of colours
replaced, which you may still edit by hand. A theme in place has its pack rebuilt at once, so
players receive the new colours at their next connection; a theme that is not in place changes
nothing for them. The arrow beside a family puts Artisan's colour back.

A theme's colours repaint the images that follow them, and leave the others alone. Artisan's
own images always follow. An image of yours, common or a module's, follows when **Follows the
themes' colours** is ticked on it in **Resources**: tick it for an image drawn in Artisan's
base colours (the server's version of a base image, first drawn in the atelier, has it
ticked), and leave it for an icon or an imported picture, which would otherwise lose a green
it merely shares with the buttons. Once ticked, the image's panel shows which of its colours
are none of Artisan's: a theme leaves those as drawn, so redraw them in Artisan's colours if
the whole image is meant to change with the theme. A theme may be kept to one module: with `scope: guilds` in
its `overrides/colors.yml`, its colours change the images of `guilds` only, so a "Christmas
for Guilds" sits beside another theme (`scope: artisan`: the common images only). The theme's
page says what its colours reach.

**Composed images.** An image may be a recipe instead of a PNG: a `compose:` list in its
`.yml`, which stacks common images and PNGs of the module (see
[AI](../../configuration/ai/), "Composed images"). The Resources page lists it with its picture
and says what it is made of; you rename, duplicate or delete it there. It has no file to
reimport, and it stays in its module: another module cannot copy it. A layer takes a common
image (`artisan:<name>`) or a PNG of its own module, nothing else: a layer that names another
module's image, another composed image or a deleted one is left out of the picture, and the
deploy review lists such layers.

**New image** in the Resources page asks what the image is for, which gives its size: a
**menu background** (a window of 1 to 6 rows), **slots** (pick the area on a 9 × 6 grid: 3 × 1
for a button), an **icon** (16 × 16) or a **free size**. It starts empty, to be drawn, or from
a common image of that size, as a composed image.

**The atelier.** Selecting an image shows it in the side panel; **Open in the atelier** gives
it the whole page, laid out as a drawing program. The tools are on the left: **Move the
layer** (V), then pencil (B), eraser (E), pipette (I) and paint bucket (G). The image is in
the middle, with undo, redo and zoom in the bar above it. On the right are the **Layers**, the
settings of the selected one, the colours while you draw, the image's size, the guides and,
for an image on slots, the image **In a menu** at the game's size. **Save** in the bar writes
what changed, pixels and layers, into your draft.

**Layers.** Every image is one or several layers, listed from the top one down; the selected
one is what the tools act on. Add one with **Common image**, **Module image** or **Drawing**
(an empty image of the same size, on top, to draw on). With the move tool, drag a layer (hold
Shift to move by one slot, or use the arrow keys for one pixel), reorder or remove layers in
the list, and repeat one with **Columns** and **Rows** (the slots of a window: a grid of
`artisan:cell`). With a drawing tool, you draw on the selected layer among the others, the
ones above shown through; switching layer or tool saves what you drew. Only a drawing of the
module can be drawn on: a common image is placed here and redrawn among the common images. A
common image is written `artisan:<name>` in the recipe; `kit:<name>`, the former spelling, is
read the same and stays as written until the layer is replaced. The image is as large as its
bottom layer reaches unless you give it a **Fixed size**; what goes past is cut.

**A PNG is an image of one layer.** Adding a layer to it turns it into a composed image of the
same name whose first layer is that drawing (kept in the module as `<image>_layer`): the menus
that show it keep showing it. **Flatten**, under the layers, does the reverse: the layers
become one PNG of the same name, which no longer follows the common images; the layers stay in
the module as images. An image a module ships takes layers the same way: its drawing is copied
into your files as the first layer, and the composed image is your version of that name.
**Restore the original** on it gives the module's image back.

**Guides.** The atelier draws guides over the image, each switched on or off and shown in its
own colour: the **slots**, and on a menu background the player's **inventory** and the
**title** line.

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

**One drawing for every width.** An image whose file `<name>.yml` declares margins is a
*sliced* image: on a button it fills the button's slots, whatever its `fit`. The pixels inside
the margins stay as drawn (the four corners), and what is between them is repeated, never
scaled, so a button drawn once at 20 × 18 serves on 2, 3 or 5 slots without blurring.

```yaml
# assets/textures/button.yml
width: 20
height: 18
function: menu
slice: { left: 4, right: 4, top: 4, bottom: 4 }
```

Each margin is a whole number of pixels, 0 when left out. The margins must leave pixels to
repeat (left + right below the image's width, top + bottom below its height) and fit in the
button's slots; otherwise the image is drawn by its `fit` as any other. The editor's canvas
shows the button as the game does.

In the atelier, **Fixed edges** (right column) sets the four margins in pixels; a dashed line
shows each on the image. A margin is written when you leave its field, and all at 0 give
the image back to its `fit`.

**A resizable layer.** In an image made of layers, a layer whose image has fixed edges takes
a size in place of a count of repeats: **Layer width** and **Layer height** in the layer's
settings, or the handle at its bottom right corner (hold Shift for whole slots). A frame
drawn once so covers 4 × 2 slots of a background, a banner the menu's width. In the file:

```yaml
compose:
  - use: "artisan:window.6"
  - image: panel          # panel.yml declares `slice`
    x: 7
    y: 17
    width: 72
    height: 36
```

A size on an image without margins, or smaller than its margins, is ignored: the layer is
drawn at the image's own size.

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

**Parts.** A button can be made of several pieces instead of one image and one label:
`parts`, a list drawn bottom to top over the button's slots. Each piece is an image (by its
name) or a text, placed by an `anchor` (`center` by default, `left`, `right`, `top`, `bottom`,
or a corner such as `top_left`) and shifted by `offset_x` / `offset_y`. An image with fixed
edges fills the button; any other image is drawn at its own size (`fit: contain` or `stretch`
to scale it). A text takes a `size` like a label. One background and one icon per button are
enough for ten buttons: the icon is no longer drawn into the background.

```yaml
- id: buy
  positions: "20-22"
  parts:
    - image: button            # fixed edges: drawn at 54 x 18
    - image: icon_coin
      anchor: left
      offset_x: 3
    - label: "{i18n:shop.buy}"
    - label: "{item.price}"
      anchor: right
      offset_x: -4
  click:
    left: buy_item {item.id}
```

`image` and `label` stay valid and mean a list of those two pieces; a look writes one form
or the other. An image's name is written as is (no placeholder), and a button that repeats
(`iterates`/`places`) cannot be made of parts. Each state has its own list. A Bedrock player
sees the first image of the list.

In the editor, the button's properties have a **Parts** section under each state: **Add an
image** or **Add a text**, then for each piece its **Place** (the anchor), its offsets, the
fit of an image or the size of a text, and the arrows that bring it forward or send it
backward. The list shows the piece in front first. Adding a piece to a button that has an
image or a label keeps them: they become the first two pieces. Removing the last piece
leaves a plain button.

**Components.** A list of parts that several buttons share is written once, in a file of the
module's `components/` folder, and each button names it. The link is kept: changing the
component changes every button that names it.

```yaml
# components/confirm.yml
params:
  text: { type: text, default: OK }
  icon: { type: image, default: icon_check }
parts:
  - image: button
  - image: "{icon}"
    anchor: left
    offset_x: 3
  - label: "{text}"
```

```yaml
- id: buy
  positions: "20-22"
  component: { name: confirm, text: "{i18n:shop.buy}" }
  click:
    left: buy_item {item.id}
```

`component: confirm` alone takes every default. A `text` parameter is put where the
component writes `{text}` in a label, and may be one text or a text per language
(`text: { en: Buy, fr: Acheter }`); it keeps its placeholders, read per player. An `image`
parameter is an image's name, written as is. Positions, conditions, clicks, title and lore
stay the button's.

A bare name is this module's component, else one of the server's common ones (the
`components/` folder of the theme `artisan`); `guilds:confirm` names another module's and
`artisan:confirm` a common one. An image the component names belongs to the component's
module; an image the button gives is read from the button's. A button writes `component`,
`parts`, or `image` and `label`, one of the three, and a button that repeats cannot name a
component. A name no component answers draws nothing. The editor's canvas does not draw a
component yet: the button shows empty there, and is right in game.

**Hover area.** A button with neither image nor item (no `image`, `material` nor `item`) is
invisible: its slots show nothing but keep its title, lore and clicks. Use it to explain a
part of a background image on hover, or to put a label on the background.

Players need the updated Artisan plugin and generated resource pack to see images.
A missing image is not left as an invisible clickable button.
