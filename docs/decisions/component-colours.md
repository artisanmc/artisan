# A component takes a colour from the theme's palette

**Status:** accepted (2026-11-27). Being built: step 1 (a literal tint on a layer, both
builders, a pack vector) and the pack's half of step 2 (`palette.yml` of a theme's Project and
of the library, the lookup of a name, the default palette, a pack vector) are in the code; the
editor's previews and its mark on an unknown name are not yet. Follows `themes-reach-modules`
("Left open: colour").

## Context

- A server wants a button in several colours (confirm, cancel, neutral) without drawing each
  one at each size. Today a colour is an image: `button.3x1` has one look, and a red button is
  another PNG someone draws, for every size.
- `resources-one-screen` (decision 3) removed the colour tables: a theme repainted pixels of
  any image by ramps, a mechanism nobody could predict from the image. That stays removed.
- A composed image (`compose.ts`, `Compose.kt`) is already a recipe both pack builders
  assemble from layers into one PNG. It is the place where an image is computed.
- A component's look gives parameters (`ComponentEditor`): a text, an image.

## Decisions

1. **A tint is a property of a layer of a composed image.** `tint: <colour>` on a layer
   multiplies each pixel of that layer's image by the colour, channel by channel, and keeps its
   alpha: a white pixel takes the colour, a grey one a darker shade of it, a transparent one
   stays transparent. Nothing else repaints pixels: a PNG is shown as drawn, and an image that
   is not composed has no tint.

2. **A colour is a name of the palette, or a literal.** `tint: primary` or `tint: "#c0392b"`.
   The palette is the file `palette.yml` at the root of a theme (not the removed
   `overrides/colors.yml`), a map of names to `#rrggbb`. A name is
   looked up like an image's (`themes-reach-modules`): the themes in place from the highest
   down, then the library, whose base ships a default palette (`neutral`, `primary`,
   `success`, `danger`, `warning`). A name no place defines leaves the layer untinted, and the
   editor says so on the image.

3. **The base ships neutral pieces and their coloured recipes.** For each tintable piece, a
   greyscale PNG (`button.neutral.3x1`) and one composed image per palette name
   (`button.primary.3x1`: that PNG tinted `primary`). `button.3x1` keeps its present drawing:
   no menu changes. A theme changes every coloured button by one line of `palette.yml`, or
   redraws one variant by holding a PNG of its name, as for any image.

4. **A component declares a choice among names.** A parameter of type `choice` lists values;
   the look of `button` takes `color` and names its image `button.<color>.<size>`. The
   inspector shows a list, never a colour picker: the colour's value belongs to the theme.

5. **A theme's sheet.** The theme's page shows each tintable piece in each palette name, in
   place of the single trial menu, without the theme and with it.

6. **Both builders, same bytes.** The multiplication is on whole numbers
   (`(c * t + 127) / 255`), with a case in the shared pack vectors.

## Rejected

- **Variants drawn by hand only.** Faithful, and it stays possible (decision 3), but as the
  only way it costs one image per colour and per size, which is what the request wants out of.
- **Colouring by the text's colour in game.** Works only where the image is a glyph of a text,
  and paints the whole image one colour: no shading, no second colour.
- **Bringing the colour tables back.** Repainting any image by ramps was removed for being
  unpredictable; here only a layer that asks for a tint is repainted.

## Steps

1. `tint` with a literal on a layer, both builders, vectors.
2. `palette.yml` and the lookup of a name; the editor's mark on an unknown name.
3. Neutral pieces, coloured recipes and the default palette in the base.
4. The `choice` parameter and `color` on `button`.
5. The theme's sheet, and the palette edited on the theme's page.

## Consequences

- One PNG in the pack per coloured variant a server's files hold, used or not: about five per
  tintable piece and size.
- A theme has a second kind of file beside its images. The MCP tools and the export must carry
  `palette.yml`.
- A piece is tintable only if someone drew its neutral version: the quality of the greyscale
  drawing bounds the quality of every colour.
