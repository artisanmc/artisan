# Element parts, sliced images and components: a button made of several pieces, at any width, drawn once for the server

**Status:** direction accepted (2026-11-26: components are linked, per module and common to
the server, edited in a menu and in the atelier); steps 1 and 2 (format) built (see *Built so far*)

**Extends:** `common-images-and-themes.md` (decision 4, an image's function), `menu/v1`
(`Appearance.image`, `Appearance.label`), `element-display-and-states.md`

## Context

The owner wants a button made of a background, an icon and a text that changes per player, the
same button at several widths, and asks whether menus need a markup language of their own, with
a new menu format.

What `menu/v1` already holds:

- `image` on an Element's look: one image drawn over its rectangle of slots, `fit: contain`,
  `stretch` or `native`, with offsets (`imageButtonGeometry.ts`, `Menus.kt`).
- `label`: one text drawn in the title over that rectangle, aligned, at a size from 8 to 32,
  with expressions evaluated per player.
- No shared button. `template_ref` of the format's types is read by nothing and is not about
  this: it named how a row of data (a quest) renders, and the Item template it came with was
  removed on 2026-07-31 (`item-templates-and-data-library`).

What is missing, and nothing else:

1. **A resize that keeps pixel art.** `fit: stretch` scales the pixels. The base therefore ships
   one drawing per width (`button.2x1`, `button.3x1`), and each redraw or theme redraws them all.
2. **Several pieces in one look.** One image and one label: an icon has to be baked into the
   background, so a button with ten icons is ten images, and a button with a name and a price
   cannot be written.
3. **A button made once and placed again**, in another menu, with another icon and text.

What the client draws sets the limits of any answer. An image is a glyph baked in the pack, the
same for every player. An item sits in an 18 px slot. A text is drawn in the title at a height
its font fixes, without wrapping or clipping, and its width is known to the server only.

## Decisions

1. **No `menu/v2`.** Sliced images and parts are additive keys; the shared button is a new
   kind of file, the component (decision 6), which a menu names. A menu written today is read and built as today, byte for byte.
   *Rejected:* a markup tree with a layout engine (rows, columns, flex). The client measures
   nothing, so the engine would run at build time on sizes that are already fixed by the slots,
   and give the owner a second way to say what `positions` says.

2. **A sliced image.** An image's `<name>.yml` may declare the margins that stay as drawn:

   ```yaml
   function: menu
   slice: { left: 4, right: 4, top: 4, bottom: 4 }
   ```

   The four corners are copied, the four edges and the middle are **repeated** (never scaled)
   to fill the size asked. A sliced image has no slot size of its own: decision 4 of
   `common-images-and-themes` gains the clause "a sliced menu image fits any rectangle at least
   as large as its margins". A look names it as any image; `fit` is ignored for it, and the pack
   draws it at the Element's rectangle (N slots span N × 18 px). A redraw or a theme that
   replaces a sliced image must declare the same margins, or it is not taken (the rule of
   decision 4).
   *Rejected:* margins written on the Element (every menu would repeat them, and a redraw could
   not move them). *Rejected:* scaling the middle (blurs a textured fill).

3. **A look is a list of parts.** `parts` is an ordered list, drawn bottom to top, each part an
   image or a label placed in the Element's rectangle:

   ```yaml
   - id: buy
     positions: 20-22
     parts:
       - image: button                      # sliced: drawn at 54 × 18
       - image: icon.coin
         anchor: left
         offset_x: 3
       - label: "{i18n:shop.buy}"
         anchor: center
       - label: "{item.price}"
         anchor: right
         offset_x: -4
         size: 8
     click:
       left: buy_item {item.id}
   ```

   `anchor` is one of nine places (`left`, `center`, `right`, combined with `top` and `bottom`),
   `center` by default; `offset_x` and `offset_y` shift it. An image part that is not sliced is
   drawn at its own size. `image` and `label` as written today stay valid and mean a list of
   those two parts; a look that writes both forms is refused with a message. A state replaces
   the whole look, parts included (`element-display-and-states`).

4. **Each image part is one glyph; baking is for Bedrock.** *(amended 2026-11-26, was: the
   image parts of a look are baked into one picture)* On Java each image part is the glyph an
   image button already is, keyed by its image, the rectangle, the fit, the offsets and now
   the anchor: the pack builders and the runtime compute that key as today, and a background
   used by twenty buttons of one width is one texture, not twenty. The title gains one glyph
   per image part, which a menu of buttons affords. Bedrock draws one texture per button and
   state: there the image parts are to be baked into one picture by the pack (nothing for
   the runtime to compute); until that is built a Bedrock player sees the first image.
   Labels stay title text, one area each.

5. **An image's name is known at build time.** A part's `image` is a literal. A name computed
   per player is refused, as today (the row-bound Element and its 18 px image per slot keep
   their own rule).

6. **A component is a named look, linked.** A file `components/<name>.yml` of a module or of
   the common scope holds a list of parts and the parameters it takes:

   ```yaml
   # components/confirm.yml
   params:
     text: { type: text, default: "{i18n:common.confirm}" }
     icon: { type: image, default: icon.check }
   parts:
     - image: button.primary          # sliced
     - image: "{icon}"
       anchor: left
       offset_x: 3
     - label: "{text}"
   ```

   An Element's look names it, and gives its parameters:

   ```yaml
   - id: confirm
     positions: 20-22
     component: { name: confirm, text: "{i18n:shop.buy}" }
     click:
       left: buy_item {item.id}
   ```

   Positions, conditions, clicks, title and lore stay the Element's: a component is a look.
   The link is kept: a component that changes changes every Element that names it, which is
   what a shared UI needs (the server's redraw, a theme). A look writes `component`, or
   `parts`, or `image`/`label`, one of the three.
   **Scopes are an image's** (`common-images-and-themes`, decisions 1, 3, 6, 8): a bare name is
   the menu's module's component, else the common one; `guilds:confirm` and `artisan:confirm`
   as for images; Artisan's base ships components, which are originals the server redraws
   under the same name and a theme replaces (`overrides/`). A name nothing answers shows a
   visible fallback in game and a problem in the editor.
   **Parameters are resolved where their part is drawn.** An `image` parameter is a literal
   in the menu's file, known at build time (decision 5). A `text` parameter is the label's
   text, with its expressions evaluated per player.
   *Not the Item template again:* that one bound a look to rows of data and lived beside a
   second, self-sufficient model. A component binds nothing to data and replaces no model:
   an Element without `component` is as today.
   *Accepted cost:* a button's look is no longer read in its menu's file; the editor shows
   where a component is used before a change to it is saved.

7. **One editor of parts, two ways in.** The list of parts is edited by one panel. In a menu,
   on the canvas, the owner assembles a look on a real Element and may "Save as component"
   (the look moves to a file, the Element names it). In the atelier, a component opens alone,
   at a width the owner picks, with sample values for its parameters. The atelier keeps
   drawing pixels for images; a component there is an arrangement of images and texts.

8. **A width that follows the text is not built now.** It is possible (left edge, a repeated
   middle glyph, right edge, written as text, the way a conversation's HUD is composed), costs a
   font and a width computation per player, and no menu asks for it yet. The width is a count of
   slots.

## Steps

1. **Sliced images.** Descriptor key, both pack builders with a conformance case, the editor's
   canvas and `render_menu`, margins shown and dragged as guides in the atelier, the base's
   buttons declared sliced. Value on its own: one button drawing for every width.
2. **Parts.** Schema and types, validation (`imageButtonErrors` and its Kotlin twin), both
   builders, the editor's Element panel (a list of parts with anchor and offsets, on the
   canvas).
3. **Components.** The kind and its scopes, `component` on a look, both pack builders (the
   baked picture of a component at a rectangle) and the runtime (its labels), with shared
   cases; "Save as component" and the parameters' fields in the Element panel.
4. **The component in the atelier**, opened alone; where it is used.
5. **Artisan's base components** (confirm, cancel, tab…), and a theme's replacement of one.

Done when the base's `confirm`, placed on 2 slots and on 4 in two menus, shows its background
intact, its icon at the left and its label centred, in game on Java and Bedrock, and a change
to the component shows in both menus.

## Built so far

**Step 1, first part (2026-11-26): the pack draws a sliced image.** `slice` is read from an
image's descriptor (`sliceOf` in `lib/pack/slice.ts`, `Slices.of` in `Images.kt`) and carried
on its row (`AssetRow.slice`). `renderImageButton` / `ImageButtons.render` draw a sliced image
at the button's rectangle (`drawSliced` / `Slices.draw`), then shift it by the offsets, for
the Java glyph and the Bedrock texture alike; margins the image or the rectangle cannot hold
leave the `fit`. The glyph's key does not change (it names the image, the rectangle and the
fit), so the runtime needs nothing. A server's own common image carries its margins to the
common row. The editor's canvas draws the same picture (`ImageButtonsRender`), and the
editor's writes of a descriptor keep `slice` (upload over an image, patch, duplicate); a
`PATCH` of an image takes `slice` (an object, or `null` to take it off) for a menu image.
Shared case in `testdata/resource-pack-conformance.json`.

**Step 1, second part (2026-11-26): the margins in the atelier.** `SlicePanel`, a section of
the atelier's right column for an image laid on slots (not a window): four fields in pixels,
written by `patchAsset({ slice })` when a field is left, `null` when all are 0; margins that
leave nothing to repeat are refused before any write. `ImageGuides` draws a dashed line at
each margin, whatever guides are shown. `slice` is accepted for any image, with or without a
function. The lines are not dragged yet.

**Sliced layers of a composed image (2026-11-26).** A `compose` layer takes `width` and
`height` (both, never on a `grid`): when its image declares margins that fit, the layer is
drawn at that size (`layerPicture` in `compose.ts`, `ComposedImages.picture` in
`Compose.kt`), else at the image's own. Both builders look the margins up by the name the
layer writes (the module's image, or the server's common one), with a shared case. In the
atelier a layer of a sliced image shows its size in place of columns and rows and has a
handle at its bottom right corner (Shift: whole slots); the stage draws it as the pack does
(`useSlicedUrl`). The hub's own renders of a composed image (`read_image`, the MCP previews)
pass no margins yet and draw such a layer at its own size.

**Step 2, the format end to end (2026-11-26).** `parts` on a look and `anchor` on `image`
are in `menu/v1` (schema, types, `imageButtonErrors`: both forms in one look, a part that is
neither an image nor a text, an expression as an image's name, an unknown anchor, parts on a
row-bound element). One reader per side gives a look's images and texts whatever the form
(`lookImages` / `lookLabels`, `Looks`, `AppearanceYaml.images` / `.labels`,
`appearanceImages` / `appearanceLabels`); `image` + `label` are those two pieces. Both pack
builders write one glyph per image part (shared case in the conformance vector) and the
text fonts of the label parts; the runtime draws them in order and keeps the hit item when
one image at least is in the pack; `render_menu` and the editor's canvas draw them; the
editor reads and writes `parts` without loss (texts as field-local translations). A part's
image defaults to `fit: native`. Not built in this step: the Element panel's list of parts
(the list is written in the file), the baked picture for Bedrock (first image shown).

Not built: `render_menu` (it draws a sliced image by
its fit), the base's buttons declared sliced, the rule that a redraw or a theme keeps the
margins (the margins are the descriptor's of the image that is shown; a theme's
`overrides/` PNG is drawn with the margins of the image it redraws).

## Consequences

- The base can retire the per-width button drawings once its menus name the sliced one; the old
  names stay answered until then.
- A theme redraws one button instead of one per width, and may replace a component.
- The plugin reads components: one more kind in every Project root, loaded and reloaded as
  images are named today.
- A long label still overflows its button: the server knows the width and could shorten the
  text, which is a separate decision.

## Still to check in the code

- The Bedrock texture of a look of several images: a key over the whole list, computed by
  the pack only (the runtime sends Bedrock a button and a state, not a key).
