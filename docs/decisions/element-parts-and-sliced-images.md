# Element parts and sliced images: a button made of several pieces, at any width

**Status:** proposed (2026-11-26); step 1 partly built (see *Built so far*)

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
- `template_ref: { id, vars, overrides }`: an Element written once and placed with parameters.
- The atelier composes an image from layers (`compose:`), which covers an icon that never
  changes.

What is missing, and nothing else:

1. **A resize that keeps pixel art.** `fit: stretch` scales the pixels. The base therefore ships
   one drawing per width (`button.2x1`, `button.3x1`), and each redraw or theme redraws them all.
2. **Several pieces in one look.** One image and one label: an icon has to be baked into the
   background, so a button with ten icons is ten images, and a button with a name and a price
   cannot be written.
3. **The icon as a parameter** of a template.

What the client draws sets the limits of any answer. An image is a glyph baked in the pack, the
same for every player. An item sits in an 18 px slot. A text is drawn in the title at a height
its font fixes, without wrapping or clipping, and its width is known to the server only.

## Decisions

1. **No new kind, no `menu/v2`.** The reusable button is a template; the three gaps are closed by
   additive keys. A menu written today is read and built as today, byte for byte.
   *Rejected:* a markup tree with a layout engine (rows, columns, flex). The client measures
   nothing, so the engine would run at build time on sizes that are already fixed by the slots,
   and give the owner a second way to say what `positions` says. *Rejected:* a `component` kind:
   it would duplicate `template_ref`.

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

4. **The image parts of a look are baked into one picture.** The pack draws them in order into
   one image of the Element's rectangle, which becomes one glyph, as an image button is today.
   The count of glyphs per menu does not grow with the number of parts, and Bedrock gets the
   same picture. Labels stay title text, one area each.

5. **An image's name is known at build time.** A part's `image` is a literal, or a template's
   `vars` value, which is written in the menu's file. A name computed per player is refused,
   as today (the row-bound Element and its 18 px image per slot keep their own rule).

6. **A width that follows the text is not built now.** It is possible (left edge, a repeated
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
3. **Templates.** An image part named by a `vars` value; the base ships a button template
   (background, icon, label).

Done when the same template, placed on 2 slots and on 4, shows its background intact, its icon
at the left and its label centred, in game on Java and Bedrock.

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

Not built: the margins as guides in the atelier, `render_menu` (it draws a sliced image by
its fit), the base's buttons declared sliced, the rule that a redraw or a theme keeps the
margins (the margins are the descriptor's of the image that is shown; a theme's
`overrides/` PNG is drawn with the margins of the image it redraws).

## Consequences

- The base can retire the per-width button drawings once its menus name the sliced one; the old
  names stay answered until then.
- A theme redraws one button instead of one per width.
- A long label still overflows its button: the server knows the width and could shorten the
  text, which is a separate decision.

## Still to check in the code

- Whether a template's `vars` are resolved when the menu is read (build time) or per player; if
  per player, decision 5 needs a literal-only rule for image parts.
- Whether the pack shares one glyph between two Elements that bake the same picture.
- How `labelFrame` and `ImageButtonLayout.labelLayer` take nine anchors (today: three
  alignments, vertically centred).
