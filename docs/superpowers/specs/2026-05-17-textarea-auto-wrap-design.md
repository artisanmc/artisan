# Textarea Auto-Wrap — Design Spec

**Date:** 2026-05-17
**Status:** Draft (post-brainstorm)
**Scope:** Extend the recently-shipped `textarea` title layer with a `width` field, word-wrap algorithm (plugin + editor), and a right-edge drag handle for resizing the block visually.

## Goal

Today the `textarea` layer only line-breaks on explicit `\n` characters. Long sentences either run off the chest title bar or force users to insert manual breaks. This change adds:

1. A `width` field (in MC pixels) on the textarea layer.
2. A word-wrap algorithm that splits long lines at whitespace boundaries to fit within `width`.
3. A right-edge drag handle in the editor that mutates `width` live, with the rendered wrap updating in real time.

Explicit `\n`s remain hard breaks; auto-wrap layers on top of each hard-line segment.

## Non-goals

- **Break-word / hyphenation.** A single word wider than `width` overflows the boundary; we don't break mid-character. (Soft constraint.)
- **Truncation with `…`.** No data loss.
- **Wrap at characters other than whitespace.** No hyphen-break, no `\t`-break — only space-based word boundaries.
- **Height resize.** Height is fully derived from `lines × lineHeight`. The user only controls width.
- **Left-edge handle.** Single right-edge handle. Repositioning the block uses the existing drag on `(x, y)`.
- **Resize handle on non-textarea layers.** Image layers keep their existing aspect-locked corner handles (`ResizeHandles.tsx`).

## Model

### Domain (TypeScript)

Extend `MenuTitleLayer` in `editor/src/domain/types.ts`:

```ts
| { kind: "textarea";
    value: LText;
    x: number; y: number;
    width: number;                                 // NEW — MC pixels
    lineHeight: number;
    alignment: "left" | "center" | "right";
    fontAssetId?: AssetId }
```

### Plugin (Kotlin)

```kotlin
data class Textarea(
    val value: LText,
    val x: Int,
    val y: Int,
    val width: Int,                                 // NEW
    val lineHeight: Int,
    val alignment: Alignment,
    val fontAssetId: String? = null,
) : MenuTitleLayer()
```

### YAML

```yaml
- kind: textarea
  value: { key: i18nKey_block }
  x: 8
  y: 6
  width: 168
  line_height: 10
  alignment: left
```

`width` is snake-case-stable (single word). Goes through transform + plugin parser unchanged.

### Defaults & bounds

- **Default width** when creating a new textarea via `+ Bloc texte`: `168` (≈ chest title bar 176 px − 8 px left margin).
- **Min width**: `8` px (≈ one narrow character).
- **Max width**: `256` px. Above this, the `space` font offset encoder starts producing long sequences and the chest title visually wraps off-screen.
- **Backward compat**: a YAML textarea without `width` parses with `width = 168`.

## Word-Wrap Algorithm

### Plugin (Kotlin)

New private helper in `TitleCompiler.kt`, sibling of `measureLineWidth`:

```kotlin
/**
 * Splits a single line into N sub-lines, each fitting within [maxWidth] px.
 * Wraps at word boundaries (whitespace). A single word wider than [maxWidth]
 * overflows on its own line (soft constraint — design decision).
 *
 * MiniMessage tags are inline; [measureLineWidth] strips them so they don't
 * count toward the measured width. Tag spans crossing sub-line boundaries are
 * fine — MC's MiniMessage stack tolerates the resulting nested wrappers.
 */
private fun wrapLine(line: String, maxWidth: Int): List<String> {
    if (line.isEmpty()) return listOf("")
    // Split keeping whitespace runs as separate tokens — we trim them at
    // sub-line edges below.
    val tokens = line.split(Regex("(?<=\\s)|(?=\\s)"))
    val out = mutableListOf<String>()
    val current = StringBuilder()
    var currentWidth = 0
    for (token in tokens) {
        val tokenWidth = measureLineWidth(token)
        if (currentWidth + tokenWidth <= maxWidth) {
            current.append(token)
            currentWidth += tokenWidth
            continue
        }
        // Doesn't fit. If current line empty, overflow this token alone.
        if (current.isEmpty()) {
            out.add(token.trimEnd())
            currentWidth = 0
            continue
        }
        // Flush current, start new with this token (drop leading whitespace).
        out.add(current.toString().trimEnd())
        current.clear()
        val trimmed = token.trimStart()
        current.append(trimmed)
        currentWidth = measureLineWidth(trimmed)
    }
    if (current.isNotEmpty()) out.add(current.toString().trimEnd())
    return out
}
```

The `Textarea` branch of `compileLayerBody` swaps its current `text.split("\n")` for:

```kotlin
val hardLines = text.split("\n")
val lines = hardLines.flatMap { wrapLine(it, layer.width) }
```

Everything downstream of `lines` is unchanged — per-line offsets, alignment math, `<font:artisan:text_y{Y}>` wrappers, and `lineY > 140` truncation all operate on the already-wrapped lines.

### Editor (TypeScript)

Mirror helper in `TitleRender.tsx`, named `wrapLineJs`, uses `vanillaTextWidth(token)` for measurement. Same algorithm.

```ts
function wrapLineJs(line: string, maxWidth: number): string[] {
  if (line === "") return [""];
  const tokens = line.split(/(?<=\s)|(?=\s)/);
  const out: string[] = [];
  let current = "";
  let currentW = 0;
  for (const tok of tokens) {
    const tokW = vanillaTextWidth(tok);
    if (currentW + tokW <= maxWidth) {
      current += tok;
      currentW += tokW;
      continue;
    }
    if (current === "") {
      out.push(tok.trimEnd());
      currentW = 0;
      continue;
    }
    out.push(current.trimEnd());
    current = tok.trimStart();
    currentW = vanillaTextWidth(current);
  }
  if (current !== "") out.push(current.trimEnd());
  return out;
}
```

The textarea render branch computes `lines = text.split("\n").flatMap(l => wrapLineJs(l, layer.width))` and renders one `<McFontText>` or `<VanillaMcText>` per resulting line. Per-line alignment uses each line's own `vanillaTextWidth(line)` width.

### Algorithm details

- **Hard breaks come first.** Explicit `\n` always breaks. Each segment between `\n`s is then word-wrapped independently.
- **Whitespace at sub-line edges is trimmed** (`trimStart` / `trimEnd`). Otherwise alignment-center / -right would visibly shift.
- **MiniMessage tags don't count.** Both `measureLineWidth` (Kotlin) and `vanillaTextWidth` (TS) strip tags before summing.
- **Cross-line tag spans:** an opening tag emitted on line N with its closing tag on line N+M produces nested `<font>` wrappers in the compiled output (`<font:text_y{Y}><gold>foo</font><font:text_y{Y+10}>bar</gold></font>`). MiniMessage's stack tolerates this. Test pinned.
- **Empty string input.** `wrapLine("", w)` returns `[""]` (one empty line). Matches behavior of `split("\n")` on `""`. Downstream `if (line.isEmpty()) continue` skips empty lines for rendering.

## Editor UX

### `WidthResizeHandle.tsx` (NEW)

Sibling of `ResizeHandles.tsx`. Single vertical bar on the right edge of the textarea's bounding box. Drag horizontal → updates `width`. Cursor `ew-resize`.

```tsx
interface WidthResizeHandleProps {
  /** Right-edge x in canvas px (= (layer.x + layer.width) * scale). */
  x: number;
  /** Top y in canvas px. */
  y: number;
  /** Height of the bar (= bounding box height in canvas px). */
  height: number;
  /** Continuous during drag. */
  onResize: (newWidth: number) => void;
  /** Once on drag end (for commit). */
  onResizeEnd?: (newWidth: number) => void;
}
```

Visual: 4 px wide rectangle, full bbox height, yellow `#eab308` (matches selection outline color). Hit area widened to 8 px for easier grabbing.

Clamps `newWidth` to `[8, 256]` during the drag (no overflow-then-clamp jitter).

Purely presentational — parent (`TitleRender.LayerNode`) owns the store mutation via `updateMenuTitleLayer`.

### `TitleRender.tsx` — LayerNode textarea branch

When `layer.kind === "textarea"`:

- Compute `lines = text.split("\n").flatMap(l => wrapLineJs(l, layer.width))`.
- Render each line as McFontText/VanillaMcText with alignment-aware `lineX`, `y = i * lineHeight * scale`.
- **Bounding box** : `outlineW = layer.width * scale` (the contracted width, NOT max line width — the user wants the box to show the wrap boundary even if the longest visible line is shorter). `outlineH = lines.length * lineHeight * scale`.
- When `selected`, mount `<WidthResizeHandle x={(layer.x + layer.width) * scale} y={layer.y * scale} height={lines.length * lineHeight * scale} onResize={...} onResizeEnd={...} />` inside the same `<Group>`.

### `LayerEditForm.tsx` — `TextareaLayerForm`

New numeric input between alignment and X/Y. Label "Largeur (px)". Clamped `[8, 256]` on change. Bound to `layer.width` via `updateMenuTitleLayer`. Stays in sync with drag handle.

### `LayersPanel.tsx` — `buildLayer("textarea", ...)`

New textareas land with `width: 168` (the default).

## Parsing

### Plugin `MenuTitleParser.kt`

Add to the `"textarea"` case:

```kotlin
width = ((m["width"] as? Number)?.toInt() ?: 168).coerceIn(8, 256),
```

### Editor `transform.ts`

`serializeTitleLayer` textarea case emits:

```ts
width: layer.width,
```

`parseTitleLayer` textarea case extracts:

```ts
const rawW = typeof m.width === "number" ? m.width : 168;
const width = Math.min(256, Math.max(8, rawW));
```

## Tests (write first, TDD)

### Plugin

**`TitleCompilerTest`** (extend):

- `wrapLine returns single element when input fits` — `wrapLine("hello", 100)` → `["hello"]`.
- `wrapLine breaks at word boundary` — `wrapLine("a b c d e f g", 12)` → multiple sub-lines, each ≤ 12 px.
- `wrapLine overflow for word longer than maxWidth` — `wrapLine("verylongword", 8)` → `["verylongword"]` (single line, soft-overflows).
- `wrapLine trims leading/trailing whitespace per sub-line` — input `"a  b"` with tight width emits `["a", "b"]` not `["a", " b"]`.
- `wrapLine on empty string returns [""]`.
- `wrapLine preserves MiniMessage tags inline across breaks` — `wrapLine("<gold>foo bar baz</gold>", X)` produces sub-lines that don't break inside the tag literal.
- `compileLayerBody textarea wraps explicit and auto lines together` — input `"line1\nthis is a long line"` with `width = small` → expected total sub-line count, each fits.
- `compileLayerBody textarea wrap + alignment center` — each wrapped sub-line centered on its OWN measured width, not on max line width or on `width`.
- `compileLayerBody textarea wrap + y=140 truncation` — wrap produces 20 sub-lines but lineY > 140 are dropped.
- `compileLayerBody textarea wrap with tag spanning multiple sub-lines compiles to valid MiniMessage` — pin the MiniMessage stack behavior.

**`MenuTitleParserTest`** (extend):

- `textarea parses width field`.
- `textarea defaults width to 168 when absent`.
- `textarea clamps width to [8, 256]` (test both bounds).

### Editor

**`transform.test.ts`**:

- Round-trip: serialize then parse preserves `width`.
- Default `width = 168` when YAML omits the field.
- Width clamping at parse.

**`TitleRender.test.tsx`**:

- Textarea with `width = 30` and 3-word content renders 3+ sub-lines.
- Bounding box width matches `layer.width * scale`, NOT max line width.
- `WidthResizeHandle` is mounted when textarea is selected.
- `WidthResizeHandle` is NOT mounted when unselected.

**`WidthResizeHandle.test.tsx`** (NEW file):

- Drag right by 20 px → `onResize` called with `oldWidth + 20`.
- Drag left below `min=8` → `onResize` clamps to `8`.
- Drag right above `max=256` → `onResize` clamps to `256`.
- `onResizeEnd` fires exactly once on drag end with final dims.

**`LayerEditForm.test.tsx`** (extend the existing textarea block):

- Width input shows `layer.width`.
- Editing the input updates `layer.width` in the store.
- Width below 8 or above 256 clamps.

## File touch list

**Plugin:**

- `plugin/src/main/kotlin/net/artisanmc/plugin/model/MenuTitleLayer.kt` — add `width: Int` to `Textarea`.
- `plugin/src/main/kotlin/net/artisanmc/plugin/engine/MenuTitleParser.kt` — parse `width`.
- `plugin/src/main/kotlin/net/artisanmc/plugin/render/TitleCompiler.kt` — `wrapLine` helper; Textarea branch uses it.
- `plugin/src/test/kotlin/net/artisanmc/plugin/MenuTitleParserTest.kt` — tests.
- `plugin/src/test/kotlin/net/artisanmc/plugin/TitleCompilerTest.kt` — tests.

**Editor:**

- `editor/src/domain/types.ts` — `width: number` in textarea variant.
- `editor/src/features/export/transform.ts` — serialize / parse `width`.
- `editor/src/features/export/transform.test.ts` — tests.
- `editor/src/features/canvas/title/composer/LayersPanel.tsx` — default `width: 168` in `buildLayer`.
- `editor/src/features/canvas/title/composer/LayerEditForm.tsx` — width input field.
- `editor/src/features/canvas/title/composer/LayerEditForm.test.tsx` — tests.
- `editor/src/features/canvas/title/composer/TitleRender.tsx` — `wrapLineJs` + render branch update + mount handle.
- `editor/src/features/canvas/title/composer/TitleRender.test.tsx` — tests.
- `editor/src/features/canvas/title/composer/WidthResizeHandle.tsx` (NEW).
- `editor/src/features/canvas/title/composer/WidthResizeHandle.test.tsx` (NEW).

**Docs:**

- `CLAUDE.md` — update the textarea YAML example with `width: 168`.

## Migration / backward compat

`width` is optional in the YAML parser (defaults to 168). Existing textareas saved without `width` (from the previous SP5 spec) load with `width = 168` and start auto-wrapping immediately. If a user notices their existing textarea now wraps when it didn't before, they can either widen `width` or re-introduce their `\n`s — the behavior change is intentional.

## Out of scope (future)

- Hyphenation / break-word for long single words.
- Wrap at non-whitespace boundaries (hyphens, slashes).
- Per-line `width` override.
- Left-edge resize handle (would require moving `x` and resizing simultaneously).
- Auto-fit: a "shrink-to-fit" mode where `width` adapts to content. Defers to user's manual control.
