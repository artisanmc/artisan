# Title Textarea Layer — Design Spec

**Date:** 2026-05-17
**Status:** Draft (post-brainstorm)
**Scope:** Title composer — new layer kind `textarea`. Touches editor (UI + rendering + transform), plugin (model + parser + compiler), and tests on both sides.

## Goal

Let users author multi-line text in a single composed title without manually
creating N stacked `text` layers. A new `textarea` layer kind owns a single
i18n value containing `\n`, plus shared formatting (line height, alignment,
font) that applies to all rendered lines.

This is sibling work to a future animations sub-project (typewriter etc.);
the two were split — animations are not in scope here.

## Non-goals

- **Animations.** Separate sub-project.
- **Auto-wrapping.** No measurement-driven line breaks; users insert `\n`
  themselves.
- **Per-line color/font/offset overrides.** The whole block shares one
  format. Inline MiniMessage tags (`<gold>`, `<bold>`) still work per
  character.
- **Per-line position adjustments.** If the user needs that, they use
  multiple `text` layers (existing model).
- **Replacing the existing `text` layer.** `textarea` coexists. Single-line
  text stays as `text`.
- **Removing `color` from existing `text` layer.** Redundant with
  MiniMessage but out of scope; cleanup later.

## Model

### Domain (TypeScript)

In `editor/src/domain/types.ts`, extend the `MenuTitleLayer` union:

```ts
| { kind: "textarea";
    value: LText;                                  // resolves to string containing \n
    x: number; y: number;                          // origin = line 0 top-left anchor
    lineHeight: number;                            // px, default 10
    alignment: "left" | "center" | "right";        // default "left"
    fontAssetId?: AssetId }                        // optional custom font
```

No `color`: MiniMessage tags inside the i18n string handle coloring.

### Plugin (Kotlin)

In `plugin/.../model/MenuTitleLayer.kt`, add the corresponding sealed-class
variant:

```kotlin
data class Textarea(
    val value: LText,
    val x: Int,
    val y: Int,
    val lineHeight: Int,
    val alignment: Alignment,            // enum LEFT, CENTER, RIGHT
    val fontAssetId: String?,
) : MenuTitleLayer
```

### YAML

```yaml
- kind: textarea
  value: { key: i18nKey_xyz }
  x: 8
  y: 6
  line_height: 10
  alignment: center
  font_asset_id: asset_abc123   # optional
```

The translated string lives in `pack.i18nKeys[xyz][lang]` and contains literal
`\n` characters. i18n stays atomic — different languages can have different
line counts.

## Runtime — TitleCompiler

### Architectural change: thread `currentX` through `compileLayerBody`

Today, `compileLayerBody(layer, ...) -> String` is pure and `compileTitle`
owns `currentX`. A `textarea` emits several sub-fragments at different x
positions (one per line), so the branch needs to manage offsets internally.

**Refactor:** change the signature to

```kotlin
internal fun compileLayerBody(
    layer: MenuTitleLayer,
    startX: Int,
    langMap: Map<String, String>,
    lookupAsset: (String) -> AssetEntry?,
    offsetEncoder: OffsetEncoder,
): Pair<String, Int>   // (body fragment, new currentX after the fragment)
```

For existing kinds (`background`, `glyph`, `text`, `plain`, `external_glyph`),
the new `currentX` is `startX + estimateBodyWidth(layer, ...)` and the
returned fragment is unchanged — they don't emit offsets themselves.

For `textarea`, the branch emits its own per-line offsets:

```
text = resolveLText(layer.value, langMap)
lines = text.split("\n")
sb = StringBuilder
localX = startX
maxLastX = startX
for (i, line) in lines:
  if (layer.y + i*layer.lineHeight > 140) break   // truncate (see below)
  lineY = layer.y + i * layer.lineHeight
  lineWidth = measureLineWidth(line)              // reuses charAdvance + bold logic
  lineX = when (layer.alignment):
     LEFT   -> layer.x
     CENTER -> layer.x - lineWidth / 2
     RIGHT  -> layer.x - lineWidth
  sb.append(offsetEncoder.encode(lineX - localX))
  sb.append("<font:artisan:text_y${lineY}>")
  sb.append(line)                                  // MiniMessage as-is
  sb.append("</font>")
  localX = lineX + lineWidth
  maxLastX = max(maxLastX, localX)
return Pair(sb.toString(), maxLastX)
```

`compileTitle` becomes:

```kotlin
for (layer in sorted) {
    val targetX = layerX(layer)
    if (targetX != currentX && layer !is Textarea) {
        sb.append(offsetEncoder.encode(targetX - currentX))
    }
    val (frag, newX) = compileLayerBody(layer, if (layer is Textarea) currentX else targetX, ...)
    sb.append(frag)
    currentX = if (layer is Textarea) newX else targetX + estimateBodyWidth(layer, ...)
}
```

(For `textarea` the outer offset emission is skipped because the branch
handles its own positioning starting from `startX`.)

### Width measurement helper

Extract the inner advance-summing logic from `estimateBodyWidth(Text)` into
a private `measureLineWidth(text: String): Int` that:

- Strips MiniMessage tags via `Regex("<[^>]+>")`
- Sums `charAdvance(ch)` for each visible char
- Adds `countBoldChars(text)` for the bold rendering shift

`estimateBodyWidth(Text)` keeps its current behavior by delegating.
`estimateBodyWidth(Textarea)` reports the **maximum line width** across all
lines (used only when something else queries it; the `textarea` branch above
computes its own per-line widths directly).

### Truncation

`text_y{Y}.json` fonts exist for `Y = 0..140`. If `layer.y + i*lineHeight > 140`
for some line `i`, that line and all subsequent lines are dropped at compile
time. The plugin logs a single warn line per affected menu (no log spam per
render). The editor enforces the same bound visually (warning indicator in
`LayerEditForm`).

### Empty / single-line behavior

- Empty `value` resolves to empty string → `split("\n")` yields `[""]` → one
  empty line emitted, no characters. Effectively a no-op.
- Single line (no `\n`) → behaves identically to a `text` layer at the same
  position/alignment.

## Editor

### `AddLayerControls`

Add `+ Textarea` button next to `+ Image` / `+ Text`. Same cursor-attach
flow (`attachLayerAtCursor`): drag attaches to nearest menu; click attaches
to last selected.

Default new textarea:

```ts
{
  kind: "textarea",
  value: { key: <fresh i18nKey> },        // new key, empty translations
  x: 8, y: 6,
  lineHeight: 10,
  alignment: "left",
}
```

### `LayerEditForm` — new `TextareaLayerForm`

Sibling sub-form alongside `TextLayerForm` / `ImageLayerForm`. Fields:

- **Content** — multi-line `<textarea>` (rows=3 min, auto-grow). Mapped to
  `pack.i18nKeys[value.key][activeLang]` via `useTextEdit`. Newlines stored
  literally.
- **Line height** — numeric input, clamp `1..32`, default 10.
- **Alignment** — 3-segment toggle (Left / Center / Right), lucide icons.
- **Font** — same picker component as `TextLayerForm` (font asset).
- **Position** — `x` / `y` numeric inputs (same component pattern).
- **Preview** — `MiniMessageInline` rendering each line (non-pixel-perfect
  text fallback, sufficient for content preview).
- **Y-overflow warning** — if `y + (lines-1)*lineHeight > 140`, show inline
  warn icon + tooltip "Some lines go past the renderable area (Y > 140) and will be cut off.".

### `LayerListItem`

Display:
- Icon: `AlignLeft`/`AlignCenter`/`AlignRight` lucide (matches alignment),
  with a small "≡" overlay to disambiguate from single-line Text.
- Label: first line of resolved text + " …" if `lines > 1`, or i18n key
  fallback.

### `TitleRender.tsx` (pixel-perfect canvas)

New branch for `kind === "textarea"`:

- Split resolved text on `\n` into `lines`.
- For each line `i`:
  - Compute `lineWidth` via existing `vanillaTextWidth` (or McFont width path
    when `fontAssetId` set).
  - Compute `lineX = layer.x` (left), `layer.x - lineWidth/2` (center), or
    `layer.x - lineWidth` (right).
  - Place a `<McFontText>` or `<MiniMessageKonvaText>` at
    `(lineX, layer.y + i*lineHeight + BASELINE_Y_PX)`.
- **Sel box** = bounding rect: `x = min(lineX_i)`, `y = layer.y`,
  `width = max(lineWidth_i)`, `height = lines.length * lineHeight`.
- **Drag** handled by `useTitleLayerDrag` — moves `(layer.x, layer.y)`. No
  per-line drag.
- **Snap** via `snapDragPosition` applied to layer origin. No change.

### `useTitleLayerDrag.ts`

Add `textarea` to the switch in the position-update reducer. Same shape as
text (x, y numbers).

### `transform.ts`

Serialize textarea to YAML with snake-case (`line_height`, `font_asset_id`).
Deserialize symmetrically. Apply defaults at load (`lineHeight ?? 10`,
`alignment ?? "left"`).

## Parsing (plugin)

`MenuTitleParser.kt`: new `"textarea"` case.

- `value` → `LText` (delegates to existing helper)
- `x`, `y` → required `Int`
- `line_height` → optional `Int`, default 10, clamp to `1..32`
- `alignment` → optional string, parsed to enum (`left`/`center`/`right`),
  fallback `LEFT` on unknown
- `font_asset_id` → optional `String`

Parse errors (missing `value`, malformed types) propagate via existing
`MenuParseException` path.

## Tests (write first, TDD)

### Plugin

**`TitleCompilerTest`** (extend):

- `textarea single line renders same as text` — one `\n`-less line produces
  output equivalent to a `text` layer at same `(x, y)`.
- `textarea three lines emits three text_y fonts` — verify three distinct
  `<font:artisan:text_y{Y}>` wrappers at `y, y+lineHeight, y+2*lineHeight`.
- `textarea alignment center` — widest line dictates; shorter lines offset
  to center under widest.
- `textarea alignment right` — all lines end at the same x.
- `textarea truncates past y=140` — line with `lineY > 140` dropped; warn
  logged once.
- `textarea empty value` — no fragment emitted; `currentX` unchanged.
- `textarea followed by glyph` — outer cursor advances to `maxLastX` of
  textarea, so subsequent glyph positions correctly.
- `textarea preserves MiniMessage tags per line` — `<gold>foo\n<bold>bar`
  renders first line gold, second line gold+bold. MiniMessage stack
  semantics: each `<font:text_y{Y}>` wrap is closed at line end so font
  switches cleanly, but color/decoration tags propagate to subsequent
  lines until explicit close (intended — users can color the whole block
  with one opening tag).

**`MenuTitleParserTest`** (extend):

- Parse complete textarea YAML.
- Defaults applied when `line_height` / `alignment` absent.
- Unknown alignment falls back to `left`.
- `line_height` clamped to `[1, 32]`.
- Missing `value` → `MenuParseException`.

### Editor

**`transform.test.ts`**:

- Round-trip textarea: domain → YAML → domain preserves all fields.
- Defaults applied when YAML omits `line_height` / `alignment`.

**`LayerEditForm.test.tsx`** (new `TextareaLayerForm` block):

- Editing the multi-line textarea writes newlines to the i18n value.
- Alignment toggle updates `layer.alignment` in store.
- Line height clamps to `1..32`.
- Y-overflow warning shows when `y + (n-1)*lineHeight > 140`.

**`TitleRender.test.tsx`**:

- Renders N children for N lines in a textarea.
- Lines stacked at correct pitch (`lineHeight`).
- Alignment left/center/right places each line at correct x.

**`AddLayerControls.test.tsx`**:

- `+ Textarea` button creates a textarea layer with defaults.
- Cursor-attach flow attaches to nearest menu.

## Migration / backward compat

No migration. `textarea` is a new YAML kind; existing menus don't contain it.
Older plugins without textarea support won't load packs containing it — out
of scope (same as any new layer kind).

## Out of scope (future work)

- **Textarea + animation interaction.** When the animations sub-project
  lands, animating a textarea (typewriter per line, all-at-once fade, etc.)
  may need extra parameters. Defer.
- **Per-line color/font/offset.** Use multiple `text` layers.
- **Auto-wrap on width.** Manual `\n` only.
- **Remove redundant `color` from existing `text` layer.** Cleanup pass.

## File touch list

**Editor:**

- `editor/src/domain/types.ts` — extend `MenuTitleLayer` union
- `editor/src/features/canvas/title/composer/AddLayerControls.tsx` — `+ Textarea`
- `editor/src/features/canvas/title/composer/LayerEditForm.tsx` — dispatch
- `editor/src/features/canvas/title/composer/LayerEditForm.test.tsx` — tests
- `editor/src/features/canvas/title/composer/TextareaLayerForm.tsx` — new
- `editor/src/features/canvas/title/composer/LayerListItem.tsx` — icon/label
- `editor/src/features/canvas/title/composer/TitleRender.tsx` — render branch
- `editor/src/features/canvas/title/composer/TitleRender.test.tsx` — tests
- `editor/src/features/canvas/title/composer/useTitleLayerDrag.ts` — branch
- `editor/src/features/export/transform.ts` — YAML serialize/parse
- `editor/src/features/export/transform.test.ts` — round-trip tests
- `editor/src/locales/en.ts` + `fr.ts` — strings ("Textarea", "Line height",
  "Alignment", "Lines overflow…")

**Plugin:**

- `plugin/.../model/MenuTitleLayer.kt` — new `Textarea` variant + `Alignment` enum
- `plugin/.../engine/MenuTitleParser.kt` — new `"textarea"` case
- `plugin/.../engine/MenuTitleParserTest.kt` — tests
- `plugin/.../render/TitleCompiler.kt` — `compileLayerBody` signature change
  + textarea branch + `measureLineWidth` extraction
- `plugin/.../render/TitleCompilerTest.kt` — tests

**Docs:**

- `CLAUDE.md` — section "Format menu YAML — champ `title`" : add `textarea`
  example. Remove the stale "limitation: `y` not used" note (already
  shipped via `text_y{Y}` fonts).
