# Text size for menu title text + textarea layers — design

**Date:** 2026-05-19
**Status:** Approved (pending review)

## Problem

The `text` and `textarea` layers of the menu title always render at vanilla size (height 8). The user wants to choose between several fixed sizes (small / normal / large / etc.) per layer, to create visual hierarchies (title + subtitle, headlines, fine print).

## Key decisions

- **`size` field per layer**, restricted to the enum `{4, 8, 12, 16, 20, 24, 32}` (multiples of 4). Default = 8 (= vanilla, backward-compat).
- **Restriction to multiples of 4**: other values interpolate the vanilla PNG and render blurry. The chosen set guarantees a sharp render.
- **Systematic bake** of a `text_y{Y}_h{H}.json` matrix (Y ∈ [-32, 172] × H ∈ {4, 8, 12, 16, 20, 24, 32}) = 1400 files ~700KB JSON. Acceptable cost, simple code path (no on-demand bake).
- **Scope: vanilla text only.** If the layer has a `fontAssetId` (imported custom font), the `size` field is hidden — the size of a custom font is defined by its import.
- **No migration.** Legacy YAML without `size` → default 8 → current behavior unchanged.

## `MenuTitleLayer` schema

```ts
// editor/src/domain/types.ts
export type TextSize = 4 | 8 | 12 | 16 | 20 | 24 | 32;

| { kind: "text"; value: LText; x: number; y: number;
    fontAssetId?: AssetId; color?: string;
    size?: TextSize }   // default 8

| { kind: "textarea"; value: LText; x: number; y: number;
    width: number; lineHeight: number;
    alignment: "left" | "center" | "right";
    fontAssetId?: AssetId;
    size?: TextSize }   // default 8
```

On-wire YAML mirror: `size: 16` (integer). Omitted if equal to 8 (default), to minimize the diff on existing packs.

## Resource pack

### Rename `text_y{Y}.json` → `text_y{Y}_h{H}.json`

Today: `backend/src/lib/resourcePackBuilder.ts` bakes `text_y{Y}.json` for Y ∈ [-32, 172] via `buildTextYFontJson(y)` at `backend/src/lib/fontJsonBuilder.ts:103`. The plugin (`TitleCompiler.kt`) references `<font:artisan:text_y${clampedY}>`.

New: `buildTextYFontJson(y, h)` accepts a height. For each (Y, H) of the Cartesian product, emits `text_y{Y}_h{H}.json`. The plugin references `<font:artisan:text_y${Y}_h${H}>` with H=8 by default when the layer has no `size`.

### Render scale

Each bitmap provider (ASCII, accented, non-latin) has a vanilla "natural" `height` (`VANILLA_ASCII.height`, etc.). For a size H, we multiply each provider by the scale factor `H / 8`:

```ts
const scale = H / 8;
{
  type: "bitmap",
  file: "minecraft:font/ascii.png",
  ascent: VANILLA_ASCII.ascent + (6 - y),         // unchanged
  height: VANILLA_ASCII.height * scale,           // scaled
  chars: VANILLA_ASCII.chars,
}
```

For H ∈ {4, 8, 12, 16, 20, 24, 32}, scale ∈ {0.5, 1, 1.5, 2, 2.5, 3, 4}. The current vanilla heights (probably all even) × these scales stay integers; if a multiplication produces a float, we `Math.round` (to be validated via tests).

The ascent stays unchanged: the top of the glyph is positioned by ascent only; height only extends the glyph downward. The top of the text therefore stays at chest-y Y regardless of size — intuitive behavior for the user.

### Cost

- **Zip size**: +~600KB JSON (vanilla `ascii.png` reused, 0 additional textures).
- **Bake time**: ×7 on this step (1400 vs 200 files). Negligible compared to the rest of the build.

## Plugin

### `TitleCompiler.kt`

- Wrap: `<font:artisan:text_y${clampedY}_h${H}>$colored</font>` (and likewise for textarea). H = `layer.size ?: 8`.
- Width estimation: multiply `estimateTextWidth(content)` by `H / 8.0` (Double to preserve precision on fractional scales, then `.toInt()`).
- Clamp Y: no change (same range [-32, 172]).
- Removal of the old `text_y${Y}` format without the `_h` suffix: the plugin only emits the new form. The `text_y{Y}.json` files without size become obsolete and are removed from the bake.

### `MenuTitleParser`

Adds `size: Int?` to the parsing of Text and Textarea layers; validates that it is ∈ {4, 8, 12, 16, 20, 24, 32}, otherwise falls back to 8 (lenient, to absorb malformed YAML without breaking the whole menu).

## Editor

### `LayerEditForm`

- For Text and Textarea: add a "Size" dropdown with 7 options:
  | Value | Label |
  |---|---|
  | 4 | Very small (4) |
  | 8 | Normal (8) |
  | 12 | Medium (12) |
  | 16 | Large (16) |
  | 20 | Very large (20) |
  | 24 | Huge (24) |
  | 32 | Giant (32) |
- Default selected: Normal (8). Stored as `undefined` in the layer if = 8 (compactness).
- Hidden when `fontAssetId` is defined (with a short explanatory text: "The size follows the imported font").

### Textarea — "Align lineHeight" button

When the user changes the `size`, their `lineHeight` does NOT adjust automatically (the user may have set an intended spacing). Next to the `lineHeight` field, an "Align to size" button that sets `lineHeight = size + 2` in one click. Not automatic.

### Canvas — pixel-perfect preview

`VanillaMcText` (and `TextAreaText` for textarea) accept a `size: number` prop (default 8) and multiply the glyph's Konva scale by `size / 8`. Word-wrap (textarea, `wrapLine.ts`) recomputes the advances with the same scale to stay WYSIWYG with the plugin.

## Tests

| File | Cases |
|---|---|
| `backend/src/lib/fontJsonBuilder.test.ts` | (1) `buildTextYFontJson(0, 8)` returns the current JSON (regression); (2) `buildTextYFontJson(0, 16)` doubles all `height`s; (3) `buildTextYFontJson(0, 4)` halves them. |
| `backend/src/lib/resourcePackBuilder.test.ts` | 200 × 7 = 1400 `text_y{Y}_h{H}.json` file matrix; sample one (Y=10, H=16) and check the content. |
| `plugin/src/test/.../TitleCompilerTest.kt` | (1) default text → `text_y{Y}_h8`; (2) text size=16 → `text_y{Y}_h16`; (3) width estimate scales by H/8; (4) textarea with size=12 → all lines wrapped in the right font tag. |
| `plugin/src/test/.../MenuTitleParserTest.kt` | (1) parse `size: 16`; (2) invalid size (10) falls back to 8; (3) absent `size` → null/default. |
| `editor/src/.../LayerEditForm.test.tsx` | (1) dropdown appears for text + textarea; (2) selection writes `size`; (3) hidden if `fontAssetId` set; (4) "Align lineHeight" button sets `lineHeight = size + 2`. |
| `editor/src/.../VanillaMcText.test.tsx` | preview scales by size/8. |
| `editor/src/.../wrapLine.test.ts` | wrap recomputes scaled advances. |
| `editor/src/features/export/transform.test.ts` | YAML emits `size: N` if ≠ 8; omits otherwise. |
| `backend/src/lib/packImport.test.ts` | YAML with `size` → field present; without → undefined. |

## Risks / limits

- **Non-integer scale factor (0.5, 1.5, 2.5)**: if a vanilla provider has an odd height, the scale produces a float. Solution: `Math.round`. To be checked in tests on the 3 providers (ASCII, accented, non-latin) — corrective actions case by case if the visual rounding breaks.
- **Bake size grows**: ~700KB of JSON. If later we want to add other axes (e.g. ligature, slant), the matrix explodes. No immediate problem.
- **Sub-pixel positioning**: a layer's `x` stays in chest pixels. For a size H, a text of N characters occupies `N × char_advance × H/8` px. The offsets table (space provider) stays at 1px granularity — no quarter-pixel. Visually acceptable.
- **Compatibility between resource pack and plugin versions**: during a transition (old plugin, new RP), the plugin tries to reference `text_y{Y}` (without `_h`) which no longer exists → missing glyph squares. Mitigated by deploying plugin + backend together (the `./gradlew deploy` workflow rebuilds both).

## Out of scope

- Size on `fontAssetId` custom fonts.
- Non-uniform scaling (width ≠ height).
- Sizes < 4, > 32, or non-multiples of 4.
- "Manage sizes" editor globally / per pack — no user presets, the set is hardcoded.
- Application to Element titles/lores in the inventory (scope = title layers only).
