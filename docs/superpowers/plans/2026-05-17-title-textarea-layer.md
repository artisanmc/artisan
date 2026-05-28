# Title Textarea Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new `textarea` title layer kind that holds a single i18n value with literal `\n`s and renders as N MC-pixel-aligned lines sharing `lineHeight`, `alignment`, and optional `fontAssetId`.

**Architecture:** Two halves — (1) plugin runtime gets a new sealed-class variant + parser case + `TitleCompiler` branch that emits per-line offsets/font wrappers; the existing `compileLayerBody` signature is refactored to return `Pair<String, Int>` so the textarea branch can own its sub-positioning. (2) editor gets a third `+ Textarea` button in `AddLayerControls`, a new `TextareaLayerForm` sub-form in `LayerEditForm`, a new branch in `TitleRender` that renders N children with alignment-aware x offsets, and YAML round-trip support in `transform.ts`. No migration — `textarea` is a green-field kind.

**Tech Stack:** Plugin = Kotlin 2.0 + Paper 1.21.4 + Adventure MiniMessage, JUnit 5 (`./gradlew test`). Editor = React 19 + Konva + Zustand + Vitest. Spec: `docs/superpowers/specs/2026-05-17-title-textarea-layer-design.md`.

---

## Branch / hygiene

- Target branch: continue on `feat/title-composer` (current branch).
- Standing WIP across the tree must remain **unstaged** at every commit. Visible in `git status`:
  - `CLAUDE.md` (will be modified in the last task — stage it then, not before)
  - `backend/**` (entire backend tree is dirty from prior work — never stage in this plan)
  - `editor/package*.json`, `editor/tests/setup.ts`
  - `editor/src/domain/menuTitle.ts`, `editor/src/domain/types.ts` — types.ts WILL be modified in Task 6; stage only the lines we touch
  - `editor/src/features/canvas/CommandGroup.tsx`, `DialogGroup.tsx`, `MenuGroup.tsx`, `MiniMessageKonvaText.tsx`, `NewCommandDialog.tsx`, `NewDialogDialog.tsx`, `Selection.tsx`, `Stage.tsx`
  - `editor/src/features/canvas/title/composer/*` — many files dirty; stage only files we touch
  - `editor/src/features/export/transform*.ts` — will be modified in Task 7
  - `editor/src/locales/{en,fr}.ts` — DO NOT touch in this plan; the composer uses hardcoded French strings per existing convention
  - `editor/src/routes/pack.$packId.tsx`
  - `plugin/src/main/kotlin/net/artisanmc/plugin/engine/*.kt`, `model/*.kt`, `render/*.kt`
- **Always use explicit `git add <paths>` per task.** Never `git add -A`.
- Convention: French strings inline (no i18n file changes for the composer UI — match existing `LayerEditForm.tsx`, `AddLayerControls.tsx`).
- Run scoped tests with `rtk` (token-killer) per the user's global preferences.

## File structure overview

### Created

- `editor/src/features/canvas/title/composer/TextareaLayerForm.tsx` — new sub-form in `LayerEditForm.tsx` is co-located in the same file as the other sub-forms (`TextLayerForm`, `ImageLayerForm`, etc.); we do NOT split into a new file — see Task 10 rationale.

(No standalone new files. Everything is an addition to existing files.)

### Modified

**Plugin:**
- `plugin/src/main/kotlin/net/artisanmc/plugin/model/MenuTitleLayer.kt` — add `Alignment` enum + `Textarea` data class
- `plugin/src/main/kotlin/net/artisanmc/plugin/engine/MenuTitleParser.kt` — add `"textarea"` case
- `plugin/src/test/kotlin/net/artisanmc/plugin/MenuTitleParserTest.kt` — parse tests
- `plugin/src/main/kotlin/net/artisanmc/plugin/render/TitleCompiler.kt` — refactor `compileLayerBody` signature to return `Pair<String, Int>`, add `measureLineWidth` helper extraction, add textarea branch, update `estimateBodyWidth`, update `compileTitle`
- `plugin/src/test/kotlin/net/artisanmc/plugin/TitleCompilerTest.kt` — fix existing call sites for new signature + add textarea tests

**Editor:**
- `editor/src/domain/types.ts` — extend `MenuTitleLayer` union with `textarea` kind
- `editor/src/features/export/transform.ts` — serialize + parse textarea
- `editor/src/features/export/transform.test.ts` — round-trip tests
- `editor/src/features/canvas/title/composer/AddLayerControls.tsx` — `+ Textarea` button + extend `kind` union to `"image" | "text" | "textarea"`
- `editor/src/features/canvas/title/composer/AddLayerControls.test.tsx` — `+ Textarea` test
- `editor/src/features/canvas/title/composer/LayersPanel.tsx` — extend `buildLayer` + `onPlace` for textarea kind
- `editor/src/features/canvas/title/composer/LayerEditForm.tsx` — add `TextareaLayerForm` dispatch + sub-form
- `editor/src/features/canvas/title/composer/LayerEditForm.test.tsx` — TextareaLayerForm tests
- `editor/src/features/canvas/title/composer/LayerListItem.tsx` — `deriveAutoName` textarea branch
- `editor/src/features/canvas/title/composer/TitleRender.tsx` — textarea render branch + bbox computation
- `editor/src/features/canvas/title/composer/TitleRender.test.tsx` — textarea render tests
- `editor/src/features/canvas/title/composer/useTitleLayerDrag.ts` — no functional change (already kind-agnostic on `{ x, y }`), but add a comment confirming textarea is supported (verified by drag test)

**Docs:**
- `CLAUDE.md` — add `textarea` to the YAML example + remove the stale "limitation : `y` non utilisé" note

---

## Task 1: Plugin model — Alignment enum + Textarea data class

**Files:**
- Modify: `plugin/src/main/kotlin/net/artisanmc/plugin/model/MenuTitleLayer.kt`

- [ ] **Step 1: Add `Alignment` enum and `Textarea` data class**

Open `plugin/src/main/kotlin/net/artisanmc/plugin/model/MenuTitleLayer.kt`. After the `ExternalGlyph` data class (line 41), inside the sealed-class body, append:

```kotlin
    /** Alignment of each line inside a [Textarea] layer. */
    enum class Alignment { LEFT, CENTER, RIGHT }

    /**
     * A multi-line text block. The resolved [LText] string is split on `\n`
     * at compile time; each line is rendered at `(layer.x, layer.y + i * lineHeight)`
     * with the same [alignment]. Coexists with [Text] (single-line, no
     * line-height/alignment).
     */
    data class Textarea(
        val value: LText,
        val x: Int,
        val y: Int,
        val lineHeight: Int,
        val alignment: Alignment,
        val fontAssetId: String? = null,
    ) : MenuTitleLayer()
```

- [ ] **Step 2: Verify compilation**

Run: `(cd plugin && ./gradlew compileKotlin)`
Expected: BUILD SUCCESSFUL.

- [ ] **Step 3: Commit**

```bash
git add plugin/src/main/kotlin/net/artisanmc/plugin/model/MenuTitleLayer.kt
git commit -m "$(cat <<'EOF'
feat(plugin): add Textarea title layer + Alignment enum

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Plugin parser — `"textarea"` case (TDD)

**Files:**
- Modify: `plugin/src/test/kotlin/net/artisanmc/plugin/MenuTitleParserTest.kt`
- Modify: `plugin/src/main/kotlin/net/artisanmc/plugin/engine/MenuTitleParser.kt`

- [ ] **Step 1: Write the failing parser tests**

Append to `plugin/src/test/kotlin/net/artisanmc/plugin/MenuTitleParserTest.kt` (before the closing `}` of the class):

```kotlin
    @Test fun `textarea kind parses all fields`() {
        val raw = mapOf(
            "kind" to "textarea",
            "value" to mapOf("key" to "menu.welcome"),
            "x" to 12,
            "y" to 8,
            "line_height" to 11,
            "alignment" to "center",
            "font_asset_id" to "font_pixel",
        )
        val ta = MenuTitleParser.parse(raw).single() as MenuTitleLayer.Textarea
        assertEquals(LText("menu.welcome"), ta.value)
        assertEquals(12, ta.x)
        assertEquals(8, ta.y)
        assertEquals(11, ta.lineHeight)
        assertEquals(MenuTitleLayer.Alignment.CENTER, ta.alignment)
        assertEquals("font_pixel", ta.fontAssetId)
    }

    @Test fun `textarea defaults lineHeight to 10 and alignment to LEFT when absent`() {
        val raw = mapOf(
            "kind" to "textarea",
            "value" to mapOf("key" to "k"),
            "x" to 0, "y" to 0,
        )
        val ta = MenuTitleParser.parse(raw).single() as MenuTitleLayer.Textarea
        assertEquals(10, ta.lineHeight)
        assertEquals(MenuTitleLayer.Alignment.LEFT, ta.alignment)
        assertNull(ta.fontAssetId)
    }

    @Test fun `textarea unknown alignment falls back to LEFT`() {
        val raw = mapOf(
            "kind" to "textarea",
            "value" to mapOf("key" to "k"),
            "x" to 0, "y" to 0,
            "alignment" to "junk",
        )
        val ta = MenuTitleParser.parse(raw).single() as MenuTitleLayer.Textarea
        assertEquals(MenuTitleLayer.Alignment.LEFT, ta.alignment)
    }

    @Test fun `textarea lineHeight clamps to 1 minimum`() {
        val raw = mapOf(
            "kind" to "textarea",
            "value" to mapOf("key" to "k"),
            "x" to 0, "y" to 0,
            "line_height" to 0,
        )
        val ta = MenuTitleParser.parse(raw).single() as MenuTitleLayer.Textarea
        assertEquals(1, ta.lineHeight)
    }

    @Test fun `textarea lineHeight clamps to 32 maximum`() {
        val raw = mapOf(
            "kind" to "textarea",
            "value" to mapOf("key" to "k"),
            "x" to 0, "y" to 0,
            "line_height" to 999,
        )
        val ta = MenuTitleParser.parse(raw).single() as MenuTitleLayer.Textarea
        assertEquals(32, ta.lineHeight)
    }

    @Test fun `textarea with missing value yields key empty string (parser leniency)`() {
        val raw = mapOf(
            "kind" to "textarea",
            "x" to 0, "y" to 0,
        )
        val ta = MenuTitleParser.parse(raw).single() as MenuTitleLayer.Textarea
        // Existing `parseLText` returns LText("") for missing — matches `text` / `plain` behaviour.
        assertEquals(LText(""), ta.value)
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `(cd plugin && ./gradlew test --tests "net.artisanmc.plugin.MenuTitleParserTest")`
Expected: FAIL — `Test framework quit unexpectedly` OR `MenuTitleLayer.Textarea` unresolved. Either way, red.

- [ ] **Step 3: Implement the parser case**

In `plugin/src/main/kotlin/net/artisanmc/plugin/engine/MenuTitleParser.kt`, inside the `parseLayer` `when (m["kind"])` block, add a `"textarea"` case after the `"text"` case (before `"external_glyph"`):

```kotlin
            "textarea" -> MenuTitleLayer.Textarea(
                value = parseLText(m["value"]),
                x = (m["x"] as? Number)?.toInt() ?: 0,
                y = (m["y"] as? Number)?.toInt() ?: 0,
                lineHeight = ((m["line_height"] as? Number)?.toInt() ?: 10).coerceIn(1, 32),
                alignment = parseAlignment(m["alignment"] as? String),
                fontAssetId = m["font_asset_id"] as? String,
            )
```

Then add a private helper above `parseLText`:

```kotlin
    private fun parseAlignment(s: String?): MenuTitleLayer.Alignment = when (s?.lowercase()) {
        "center" -> MenuTitleLayer.Alignment.CENTER
        "right" -> MenuTitleLayer.Alignment.RIGHT
        else -> MenuTitleLayer.Alignment.LEFT
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `(cd plugin && ./gradlew test --tests "net.artisanmc.plugin.MenuTitleParserTest")`
Expected: 17 tests, all green (12 existing + 5 new — the "missing value" test merges into existing leniency behaviour).

- [ ] **Step 5: Commit**

```bash
git add plugin/src/main/kotlin/net/artisanmc/plugin/engine/MenuTitleParser.kt plugin/src/test/kotlin/net/artisanmc/plugin/MenuTitleParserTest.kt
git commit -m "$(cat <<'EOF'
feat(plugin): parse textarea title layer YAML

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Plugin compiler — refactor `compileLayerBody` signature

This task is a pure refactor: change the signature from `(layer, langMap, lookup) -> String` to `(layer, startX, langMap, lookup, offsetEncoder) -> Pair<String, Int>` for all existing kinds. No textarea logic yet. Existing tests update mechanically (add `startX = 0` arg, unwrap `.first`).

**Files:**
- Modify: `plugin/src/main/kotlin/net/artisanmc/plugin/render/TitleCompiler.kt`
- Modify: `plugin/src/test/kotlin/net/artisanmc/plugin/TitleCompilerTest.kt`

- [ ] **Step 1: Refactor `compileLayerBody` to the new signature**

In `TitleCompiler.kt`, replace the existing `compileLayerBody` (lines 159–199) with:

```kotlin
    /**
     * Compiles a single [layer] to its MiniMessage string fragment AND returns
     * the post-layer cursor X. For all kinds except [MenuTitleLayer.Textarea],
     * the returned cursor is `startX + estimateBodyWidth(layer, ...)` and the
     * fragment is what the v1 signature returned — they don't emit offsets
     * themselves. Textarea owns its own per-line offset emission and reports
     * the rightmost end-of-line as the new cursor.
     *
     * Internal so unit tests can assert on the produced string directly.
     * Returned MiniMessage assumes it will be rendered inside an outer
     * `<font:artisan:default>` (set by [compileTitle]).
     */
    internal fun compileLayerBody(
        layer: MenuTitleLayer,
        startX: Int,
        langMap: Map<String, String>,
        lookupAsset: (String) -> AssetEntry?,
        offsetEncoder: OffsetEncoder,
    ): Pair<String, Int> {
        val body: String = when (layer) {
            is MenuTitleLayer.Background -> {
                val entry = lookupAsset(layer.assetId) ?: return Pair("", startX)
                val ch = entry.codepointChar ?: return Pair("", startX)
                "<white>$ch</white>"
            }
            is MenuTitleLayer.Glyph -> {
                val entry = lookupAsset(layer.assetId) ?: return Pair("", startX)
                val ch = entry.codepointChar ?: return Pair("", startX)
                "<white>$ch</white>"
            }
            is MenuTitleLayer.Text -> {
                val text = resolveLText(layer.value, langMap)
                val colored = layer.color?.let { "<color:$it>$text</color>" } ?: text
                if (layer.fontAssetId != null) {
                    val ns = lookupAsset(layer.fontAssetId)?.takeIf { it.type == "font" }?.namespace
                    if (ns != null) return Pair(
                        "<font:$ns>$colored</font>",
                        startX + estimateBodyWidth(layer, langMap, lookupAsset),
                    )
                }
                "<font:artisan:text_y${layer.y}>$colored</font>"
            }
            is MenuTitleLayer.Plain -> {
                val text = resolveLText(layer.value, langMap)
                layer.color?.let { "<color:$it>$text</color>" } ?: text
            }
            is MenuTitleLayer.ExternalGlyph -> "□"
            is MenuTitleLayer.Textarea -> {
                // Implemented in Task 4. For now, no-op so existing kinds still
                // compile.
                return Pair("", startX)
            }
        }
        return Pair(body, startX + estimateBodyWidth(layer, langMap, lookupAsset))
    }
```

Also extend `estimateBodyWidth` (currently lines 218–247) to add a `Textarea` case so the `when` is exhaustive:

```kotlin
        is MenuTitleLayer.Textarea -> {
            // Implemented in Task 4 — returns max line width. For now, 0.
            0
        }
```

And extend `layerX` (lines 205–211) to add a `Textarea` case:

```kotlin
        is MenuTitleLayer.Textarea -> layer.x
```

- [ ] **Step 2: Update `compileTitle` to use the new signature**

Replace the body of the `for (layer in sorted)` loop in `compileTitle` (lines 137–144) with:

```kotlin
        for (layer in sorted) {
            val isTextarea = layer is MenuTitleLayer.Textarea
            val targetX = layerX(layer)
            // For non-textarea: emit outer offset to position cursor at targetX,
            // then pass targetX as startX (the layer body draws from there).
            // For textarea: skip the outer offset; the branch emits its own
            // per-line offsets from `currentX`.
            val startX = if (isTextarea) {
                currentX
            } else {
                if (targetX != currentX) sb.append(offsetEncoder.encode(targetX - currentX))
                targetX
            }
            val (frag, newX) = compileLayerBody(layer, startX, langMap, lookupAsset, offsetEncoder)
            sb.append(frag)
            currentX = newX
        }
```

- [ ] **Step 3: Migrate existing compileLayerBody test calls**

In `plugin/src/test/kotlin/net/artisanmc/plugin/TitleCompilerTest.kt`, every existing call of the form:

```kotlin
val s = TitleCompiler.compileLayerBody(layer, <langMap>, <lookup>)
```

becomes:

```kotlin
val (s, _) = TitleCompiler.compileLayerBody(layer, 0, <langMap>, <lookup>, OffsetEncoder.EMPTY)
```

Apply this pattern to all 23 call sites of `compileLayerBody` in the test file. The assertion lines (`assertEquals("...", s)`) stay unchanged because the body string is identical to before.

Use Edit's `replace_all` only if every occurrence has the exact same pre/post shape — otherwise do them one by one. A safe per-call edit pattern:

```kotlin
// Before:
val s = TitleCompiler.compileLayerBody(layer, mapOf("greeting" to "hello"), emptyLookup)
// After:
val (s, _) = TitleCompiler.compileLayerBody(layer, 0, mapOf("greeting" to "hello"), emptyLookup, OffsetEncoder.EMPTY)
```

- [ ] **Step 4: Run the full TitleCompiler suite**

Run: `(cd plugin && ./gradlew test --tests "net.artisanmc.plugin.TitleCompilerTest")`
Expected: all existing tests pass (the body string is unchanged; only the call shape moved).

- [ ] **Step 5: Run the full plugin test suite**

Run: `(cd plugin && ./gradlew test)`
Expected: BUILD SUCCESSFUL — ~282 tests pass (existing ~277 + 5 textarea-parser tests from Task 2).

- [ ] **Step 6: Commit**

```bash
git add plugin/src/main/kotlin/net/artisanmc/plugin/render/TitleCompiler.kt plugin/src/test/kotlin/net/artisanmc/plugin/TitleCompilerTest.kt
git commit -m "$(cat <<'EOF'
refactor(plugin): compileLayerBody returns Pair<String, Int>

Thread post-layer cursor x through the return value so the upcoming
Textarea branch can own its per-line offset emission.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Plugin compiler — Textarea branch (TDD)

**Files:**
- Modify: `plugin/src/test/kotlin/net/artisanmc/plugin/TitleCompilerTest.kt`
- Modify: `plugin/src/main/kotlin/net/artisanmc/plugin/render/TitleCompiler.kt`

- [ ] **Step 1: Write the failing compiler tests for textarea**

Append to `plugin/src/test/kotlin/net/artisanmc/plugin/TitleCompilerTest.kt` (before the final closing `}` of the class):

```kotlin
    // ---------- compileLayerBody for Textarea ----------

    @Test
    fun `compileLayerBody textarea with one line renders one text_y wrapper`() {
        val layer = MenuTitleLayer.Textarea(
            value = LText("g"), x = 0, y = 0, lineHeight = 10,
            alignment = MenuTitleLayer.Alignment.LEFT,
        )
        val (s, _) = TitleCompiler.compileLayerBody(
            layer, 0, mapOf("g" to "hi"), emptyLookup, standardEncoder,
        )
        assertEquals("<font:artisan:text_y0>hi</font>", s)
    }

    @Test
    fun `compileLayerBody textarea with three lines emits three text_y wrappers`() {
        val layer = MenuTitleLayer.Textarea(
            value = LText("g"), x = 0, y = 0, lineHeight = 10,
            alignment = MenuTitleLayer.Alignment.LEFT,
        )
        val (s, _) = TitleCompiler.compileLayerBody(
            layer, 0, mapOf("g" to "a\nb\nc"), emptyLookup, standardEncoder,
        )
        // Each line starts at x=0; cursor is already at 0, so first offset is empty.
        // After "a" (width 6) cursor=6, next line needs offset 0-6=-6.
        // After "b" cursor=6, next line offset 0-6=-6.
        assertTrue(s.contains("<font:artisan:text_y0>a</font>"))
        assertTrue(s.contains("<font:artisan:text_y10>b</font>"))
        assertTrue(s.contains("<font:artisan:text_y20>c</font>"))
    }

    @Test
    fun `compileLayerBody textarea alignment center positions lines around layer x`() {
        val layer = MenuTitleLayer.Textarea(
            value = LText("g"), x = 50, y = 0, lineHeight = 10,
            alignment = MenuTitleLayer.Alignment.CENTER,
        )
        // "ab" width = 6+6 = 12, so center → lineX = 50 - 12/2 = 44.
        // Cursor starts at 0, first offset = 44.
        val (s, _) = TitleCompiler.compileLayerBody(
            layer, 0, mapOf("g" to "ab"), emptyLookup, standardEncoder,
        )
        val firstOffset = standardEncoder.encode(44)
        assertEquals("$firstOffset<font:artisan:text_y0>ab</font>", s)
    }

    @Test
    fun `compileLayerBody textarea alignment right ends all lines at layer x`() {
        val layer = MenuTitleLayer.Textarea(
            value = LText("g"), x = 60, y = 0, lineHeight = 10,
            alignment = MenuTitleLayer.Alignment.RIGHT,
        )
        // "ab" width = 12, right → lineX = 60 - 12 = 48.
        val (s, _) = TitleCompiler.compileLayerBody(
            layer, 0, mapOf("g" to "ab"), emptyLookup, standardEncoder,
        )
        val firstOffset = standardEncoder.encode(48)
        assertEquals("$firstOffset<font:artisan:text_y0>ab</font>", s)
    }

    @Test
    fun `compileLayerBody textarea truncates lines past y=140`() {
        val layer = MenuTitleLayer.Textarea(
            value = LText("g"), x = 0, y = 135, lineHeight = 10,
            alignment = MenuTitleLayer.Alignment.LEFT,
        )
        // y=135 → line 0 at 135 (≤140 ok). Line 1 at 145 → drops. Line 2 at 155 → drops.
        val (s, _) = TitleCompiler.compileLayerBody(
            layer, 0, mapOf("g" to "a\nb\nc"), emptyLookup, standardEncoder,
        )
        assertTrue(s.contains("text_y135"))
        assertFalse(s.contains("text_y145"))
        assertFalse(s.contains("text_y155"))
    }

    @Test
    fun `compileLayerBody textarea empty value returns empty fragment with unchanged x`() {
        val layer = MenuTitleLayer.Textarea(
            value = LText("g"), x = 0, y = 0, lineHeight = 10,
            alignment = MenuTitleLayer.Alignment.LEFT,
        )
        val (s, newX) = TitleCompiler.compileLayerBody(
            layer, 42, mapOf("g" to ""), emptyLookup, standardEncoder,
        )
        // Single empty line → empty body and cursor unchanged from start.
        assertEquals("", s)
        assertEquals(42, newX)
    }

    @Test
    fun `compileLayerBody textarea reports maxLastX of last line for cursor tracking`() {
        val layer = MenuTitleLayer.Textarea(
            value = LText("g"), x = 0, y = 0, lineHeight = 10,
            alignment = MenuTitleLayer.Alignment.LEFT,
        )
        // "a" width 6, "bc" width 12. After 2 lines starting at x=0: cursor max = 0 + 12 = 12.
        val (_, newX) = TitleCompiler.compileLayerBody(
            layer, 0, mapOf("g" to "a\nbc"), emptyLookup, standardEncoder,
        )
        assertEquals(12, newX)
    }

    @Test
    fun `compileTitle textarea followed by glyph positions glyph past textarea end`() {
        val glyphCh = 0xE000.toChar()
        val lookup = stubLookup(mapOf("asset_coin" to glyphEntry("coin", 0xE000, width = 8)))
        val result = TitleCompiler.compileTitle(
            layers = listOf(
                MenuTitleLayer.Textarea(
                    value = LText("g"), x = 0, y = 0, lineHeight = 10,
                    alignment = MenuTitleLayer.Alignment.LEFT,
                ),
                MenuTitleLayer.Glyph(assetId = "asset_coin", x = 100, y = 0),
            ),
            lang = "en_us",
            langMap = mapOf("g" to "ab"),
            lookupAsset = lookup,
            offsetEncoder = standardEncoder,
        )
        // Stable-sort places Text-like layers last. Textarea is not Text per the
        // sortedWith comparator (see compileTitle), so it stays in input order.
        // Decode the rendered Component to ensure glyph appears.
        assertTrue(result.toString().contains(glyphCh.toString()))
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `(cd plugin && ./gradlew test --tests "net.artisanmc.plugin.TitleCompilerTest")`
Expected: 8 new tests fail — body string is currently `""` because Task 3 stubbed the branch.

- [ ] **Step 3: Implement the Textarea branch**

In `TitleCompiler.kt`, replace the textarea stub:

```kotlin
            is MenuTitleLayer.Textarea -> {
                // Implemented in Task 4. For now, no-op so existing kinds still compile.
                return Pair("", startX)
            }
```

with:

```kotlin
            is MenuTitleLayer.Textarea -> {
                val text = resolveLText(layer.value, langMap)
                val lines = text.split("\n")
                val sb = StringBuilder()
                var localX = startX
                var maxLastX = startX
                for ((i, line) in lines.withIndex()) {
                    val lineY = layer.y + i * layer.lineHeight
                    if (lineY > 140) break // text_y fonts exist for Y=0..140
                    if (line.isEmpty()) continue // skip empty lines (no advance, no render)
                    val lineWidth = measureLineWidth(line)
                    val lineX = when (layer.alignment) {
                        MenuTitleLayer.Alignment.LEFT -> layer.x
                        MenuTitleLayer.Alignment.CENTER -> layer.x - lineWidth / 2
                        MenuTitleLayer.Alignment.RIGHT -> layer.x - lineWidth
                    }
                    if (lineX != localX) sb.append(offsetEncoder.encode(lineX - localX))
                    sb.append("<font:artisan:text_y${lineY}>")
                    sb.append(line)
                    sb.append("</font>")
                    localX = lineX + lineWidth
                    if (localX > maxLastX) maxLastX = localX
                }
                return Pair(sb.toString(), maxLastX)
            }
```

- [ ] **Step 4: Extract `measureLineWidth` helper**

In `TitleCompiler.kt`, add a private helper right above `charAdvance` (around line 66):

```kotlin
    /**
     * Best-effort pixel width of a single MiniMessage-bearing line. Strips
     * tags via the same regex used by [estimateBodyWidth], sums per-char
     * advances from [charAdvance], and adds the MC bold-shift bump via
     * [countBoldChars]. Used by the [MenuTitleLayer.Textarea] branch to
     * compute per-line widths for alignment math.
     */
    private fun measureLineWidth(text: String): Int {
        val anyTagPattern = Regex("<[^>]+>")
        val visible = anyTagPattern.replace(text, "")
        return visible.sumOf { charAdvance(it) } + countBoldChars(text)
    }
```

Then refactor the `Text` branch of `estimateBodyWidth` to delegate (lines 232–239):

```kotlin
        is MenuTitleLayer.Text -> {
            val text = resolveLText(layer.value, langMap)
            measureLineWidth(text)
        }
```

And the `Plain` branch (lines 240–245):

```kotlin
        is MenuTitleLayer.Plain -> {
            val text = resolveLText(layer.value, langMap)
            measureLineWidth(text)
        }
```

And the `Textarea` branch:

```kotlin
        is MenuTitleLayer.Textarea -> {
            val text = resolveLText(layer.value, langMap)
            val lines = text.split("\n")
            lines.maxOfOrNull { measureLineWidth(it) } ?: 0
        }
```

- [ ] **Step 5: Run the test suite**

Run: `(cd plugin && ./gradlew test --tests "net.artisanmc.plugin.TitleCompilerTest")`
Expected: all tests green including the 8 new textarea tests.

- [ ] **Step 6: Run the full plugin test suite**

Run: `(cd plugin && ./gradlew test)`
Expected: BUILD SUCCESSFUL. ~290 tests pass.

- [ ] **Step 7: Commit**

```bash
git add plugin/src/main/kotlin/net/artisanmc/plugin/render/TitleCompiler.kt plugin/src/test/kotlin/net/artisanmc/plugin/TitleCompilerTest.kt
git commit -m "$(cat <<'EOF'
feat(plugin): TitleCompiler textarea branch

Multi-line title text via N text_y{Y} font wrappers, per-line offsets,
left/center/right alignment, truncation past y=140. measureLineWidth
extracted from estimateBodyWidth.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Editor domain types — extend `MenuTitleLayer` union

**Files:**
- Modify: `editor/src/domain/types.ts`

- [ ] **Step 1: Add `textarea` to the union**

In `editor/src/domain/types.ts`, replace the `MenuTitleLayer` union (lines 40–50). Before:

```ts
export type MenuTitleLayer =
  | { kind: "background"; assetId: AssetId }
  | { kind: "glyph"; assetId: AssetId; x: number; y: number }
  | { kind: "text"; value: LText; x: number; y: number;
      fontAssetId?: AssetId;
      color?: string }
  /** Plain vanilla title — no resource pack required. Emitted as a raw
   *  MiniMessage string in YAML (legacy format) so any server can use it. */
  | { kind: "plain"; value: LText; color?: string }
  | { kind: "external_glyph"; provider: "oraxen" | "nexo" | "itemsadder";
      glyphName: string; x: number; y: number };
```

After:

```ts
export type MenuTitleLayer =
  | { kind: "background"; assetId: AssetId }
  | { kind: "glyph"; assetId: AssetId; x: number; y: number }
  | { kind: "text"; value: LText; x: number; y: number;
      fontAssetId?: AssetId;
      color?: string }
  /** Plain vanilla title — no resource pack required. Emitted as a raw
   *  MiniMessage string in YAML (legacy format) so any server can use it. */
  | { kind: "plain"; value: LText; color?: string }
  /** Multi-line text block. `value` resolves to a string containing literal
   *  `\n`s; the runtime splits and renders one line per split at
   *  `(x, y + i * lineHeight)`. Lines share alignment + optional font. */
  | { kind: "textarea"; value: LText; x: number; y: number;
      lineHeight: number;
      alignment: "left" | "center" | "right";
      fontAssetId?: AssetId }
  | { kind: "external_glyph"; provider: "oraxen" | "nexo" | "itemsadder";
      glyphName: string; x: number; y: number };
```

- [ ] **Step 2: Verify typecheck**

Run: `(cd editor && npx tsc --noEmit)`
Expected: errors in files that exhaustively switch on `MenuTitleLayer.kind` — these will be fixed in subsequent tasks. Note the locations now so you know what Tasks 7–13 must cover. Run the editor unit suite to confirm no test regressions (any test that doesn't switch on kind exhaustively will still pass):

Run: `(cd editor && rtk vitest run)`
Expected: tests fail in files we'll modify next (transform, LayerEditForm, LayerListItem, TitleRender). Capture the failing-file list for sanity — they should match the file touch list.

- [ ] **Step 3: Commit**

```bash
git add editor/src/domain/types.ts
git commit -m "$(cat <<'EOF'
feat(editor): MenuTitleLayer.textarea kind

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Editor transform — YAML round-trip (TDD)

**Files:**
- Modify: `editor/src/features/export/transform.test.ts`
- Modify: `editor/src/features/export/transform.ts`

- [ ] **Step 1: Find an existing transform test that round-trips a `text` layer** to use as a shape reference.

Run: `rtk grep -n 'kind: "text"' editor/src/features/export/transform.test.ts || rtk grep -n "kind: 'text'" editor/src/features/export/transform.test.ts`

If a textarea-applicable round-trip helper exists, model the new tests after it.

- [ ] **Step 2: Write the failing serialize + parse tests**

In `editor/src/features/export/transform.test.ts`, find a `describe` block for title-layer serialization (or create one at the bottom). Add:

```ts
describe("transform — textarea title layer", () => {
  it("serializeTitleLayer emits snake_case fields with no extras", () => {
    // serializeTitleLayer is not exported; round-trip through transform()
    // by inspecting the emitted menu YAML.
    const pack = makeMinimalPack({
      menus: [
        {
          id: "m1" as MenuId,
          packId: "p1" as PackId,
          title: [
            {
              kind: "textarea",
              value: { key: "k1" as I18nKey },
              x: 12,
              y: 8,
              lineHeight: 11,
              alignment: "center",
              fontAssetId: "font_a" as AssetId,
            },
          ],
          rows: 3,
          layers: [],
        },
      ],
    });
    const files = transform(pack);
    const yaml = files["plugins/Artisan/packs/p1/menus/m1.yaml"];
    expect(yaml).toContain("kind: textarea");
    expect(yaml).toContain("x: 12");
    expect(yaml).toContain("y: 8");
    expect(yaml).toContain("line_height: 11");
    expect(yaml).toContain("alignment: center");
    expect(yaml).toContain("font_asset_id: font_a");
  });

  it("parseTitleNode round-trips a textarea with all fields", () => {
    const node = [
      {
        kind: "textarea",
        value: { key: "k1" },
        x: 12,
        y: 8,
        line_height: 11,
        alignment: "right",
        font_asset_id: "font_a",
      },
    ];
    const layers = parseTitleNode(node);
    expect(layers).toEqual([
      {
        kind: "textarea",
        value: { key: "k1" },
        x: 12,
        y: 8,
        lineHeight: 11,
        alignment: "right",
        fontAssetId: "font_a",
      },
    ]);
  });

  it("parseTitleNode applies defaults when line_height / alignment absent", () => {
    const node = [
      { kind: "textarea", value: { key: "k1" }, x: 0, y: 0 },
    ];
    const layers = parseTitleNode(node);
    expect(layers[0]).toMatchObject({
      kind: "textarea",
      lineHeight: 10,
      alignment: "left",
    });
  });

  it("parseTitleNode falls back to LEFT for unknown alignment", () => {
    const node = [
      { kind: "textarea", value: { key: "k1" }, x: 0, y: 0, alignment: "junk" },
    ];
    expect(parseTitleNode(node)[0]).toMatchObject({ alignment: "left" });
  });

  it("parseTitleNode rejects textarea without value.key", () => {
    const node = [{ kind: "textarea", x: 0, y: 0 }];
    expect(parseTitleNode(node)).toEqual([]);
  });
});
```

If `makeMinimalPack` doesn't exist in this test file, use whatever helper the existing tests use, or inline a `Pack` literal — match the patterns already in the file.

- [ ] **Step 3: Run tests to verify they fail**

Run: `(cd editor && rtk vitest run src/features/export/transform.test.ts)`
Expected: 5 new tests fail.

- [ ] **Step 4: Implement `serializeTitleLayer` textarea case**

In `editor/src/features/export/transform.ts`, inside `serializeTitleLayer` (after the `plain` block, before `external_glyph`, around line 183):

```ts
  if (layer.kind === "textarea") {
    const out: Record<string, unknown> = {
      kind: "textarea",
      value: { key: layer.value.key },
      x: layer.x,
      y: layer.y,
      line_height: layer.lineHeight,
      alignment: layer.alignment,
    };
    if (layer.fontAssetId !== undefined) out.font_asset_id = layer.fontAssetId;
    return out;
  }
```

- [ ] **Step 5: Implement `parseTitleLayer` textarea case**

In `parseTitleLayer`, after the `plain` case (around line 280), before `external_glyph`:

```ts
    case "textarea": {
      const value = m.value;
      let key: I18nKey | undefined;
      if (value && typeof value === "object" && typeof (value as { key?: unknown }).key === "string") {
        key = (value as { key: string }).key as I18nKey;
      }
      if (!key) return null;
      const rawAlign = typeof m.alignment === "string" ? m.alignment : "left";
      const alignment: "left" | "center" | "right" =
        rawAlign === "center" ? "center" : rawAlign === "right" ? "right" : "left";
      const rawLh = typeof m.line_height === "number" ? m.line_height : 10;
      const lineHeight = Math.min(32, Math.max(1, rawLh));
      const out: MenuTitleLayer = {
        kind: "textarea",
        value: { key },
        x: typeof m.x === "number" ? m.x : 0,
        y: typeof m.y === "number" ? m.y : 0,
        lineHeight,
        alignment,
      };
      if (typeof m.font_asset_id === "string") out.fontAssetId = m.font_asset_id as AssetId;
      return out;
    }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `(cd editor && rtk vitest run src/features/export/transform.test.ts)`
Expected: all transform tests pass.

- [ ] **Step 7: Commit**

```bash
git add editor/src/features/export/transform.ts editor/src/features/export/transform.test.ts
git commit -m "$(cat <<'EOF'
feat(editor): transform — textarea YAML round-trip

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Editor `+ Textarea` button (TDD)

**Files:**
- Modify: `editor/src/features/canvas/title/composer/AddLayerControls.test.tsx`
- Modify: `editor/src/features/canvas/title/composer/AddLayerControls.tsx`

- [ ] **Step 1: Read the existing test conventions**

Open `editor/src/features/canvas/title/composer/AddLayerControls.test.tsx`. Skim for an existing test that asserts on the `+ Texte` button + `onPlace("text", null)` invocation on click. Use the same fixture/mock shape for textarea.

- [ ] **Step 2: Write the failing tests**

Add a test verifying the `+ Textarea` button exists and that clicking it invokes `onPlace("textarea", null)`. The exact assertions should mirror the existing image/text equivalent. Template:

```tsx
it("clicking + Textarea invokes onPlace('textarea', null)", () => {
  const onPlace = vi.fn();
  render(<AddLayerControls onPlace={onPlace} />);
  fireEvent.click(screen.getByTestId("add-layer-textarea"));
  expect(onPlace).toHaveBeenCalledWith("textarea", null);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `(cd editor && rtk vitest run src/features/canvas/title/composer/AddLayerControls.test.tsx)`
Expected: fail — button with testid `add-layer-textarea` not in DOM.

- [ ] **Step 4: Extend the `kind` union and add the button**

In `AddLayerControls.tsx`:

(a) Change every `"image" | "text"` to `"image" | "text" | "textarea"` (4 occurrences: the prop type at line 24, the `ActiveGesture` interface at line 28, the `setDragging({ kind: g.kind, ... })` call at line 111 implicitly via the union, the `onPointerDown` parameter at line 91, the `onClick` parameter at line 153).

(b) Import `AlignLeft` (or another suitable lucide icon) at the top:

```tsx
import { AlignLeft, Image as ImageIcon, Type } from "lucide-react";
```

(c) Add a third `<Button>` after the `+ Texte` button (after line 189):

```tsx
      <Button
        type="button"
        data-testid="add-layer-textarea"
        size="sm"
        variant="outline"
        className="flex-1"
        onPointerDown={(e) => onPointerDown("textarea", e)}
        onClick={(e) => onClick("textarea", e)}
      >
        <AlignLeft className="mr-1 h-3.5 w-3.5" />
        + Bloc texte
      </Button>
```

- [ ] **Step 5: Run test to verify it passes**

Run: `(cd editor && rtk vitest run src/features/canvas/title/composer/AddLayerControls.test.tsx)`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add editor/src/features/canvas/title/composer/AddLayerControls.tsx editor/src/features/canvas/title/composer/AddLayerControls.test.tsx
git commit -m "$(cat <<'EOF'
feat(editor): + Bloc texte button in AddLayerControls

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Editor `LayersPanel` — `buildLayer` for textarea

**Files:**
- Modify: `editor/src/features/canvas/title/composer/LayersPanel.tsx`

- [ ] **Step 1: Update `buildLayer` and `onPlace` to accept `"textarea"`**

In `LayersPanel.tsx`, change the `buildLayer` signature (line 97):

```ts
  const buildLayer = (
    kind: "image" | "text" | "textarea",
    placement: { x: number; y: number } | null,
  ): MenuTitleLayer => {
    if (kind === "textarea") {
      return {
        kind: "textarea",
        value: { key: newI18nKey() },
        x: placement?.x ?? 8,
        y: placement?.y ?? 6,
        lineHeight: 10,
        alignment: "left",
      };
    }
    if (kind === "text") {
      return {
        kind: "text",
        value: { key: newI18nKey() },
        x: placement?.x ?? 8,
        y: placement?.y ?? 5,
      };
    }
    return {
      kind: "glyph",
      assetId: "" as AssetId,
      x: placement?.x ?? 0,
      y: placement?.y ?? 0,
    };
  };
```

Then update `onPlace`'s parameter type (line 120):

```ts
  const onPlace = (
    kind: "image" | "text" | "textarea",
    cursor: { x: number; y: number } | null,
  ) => {
```

- [ ] **Step 2: Verify the panel still typechecks**

Run: `(cd editor && npx tsc --noEmit)`
Expected: `LayersPanel.tsx` should pass typecheck.

- [ ] **Step 3: Run existing panel tests (no test additions for this task — covered by Task 7 + behavior is just a building-block)**

Run: `(cd editor && rtk vitest run src/features/canvas/title/composer/LayersPanel.test.tsx)`
Expected: green (existing tests don't assert against the new "textarea" code path).

- [ ] **Step 4: Commit**

```bash
git add editor/src/features/canvas/title/composer/LayersPanel.tsx
git commit -m "$(cat <<'EOF'
feat(editor): LayersPanel — buildLayer + onPlace textarea kind

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Editor `LayerListItem` — textarea auto-name (TDD)

**Files:**
- Modify: `editor/src/features/canvas/title/composer/LayerListItem.tsx`

- [ ] **Step 1: Check whether a `LayerListItem.test.tsx` exists**

Run: `rtk find editor/src/features/canvas/title/composer -name "LayerListItem.test.tsx"`

If it exists, add the textarea-naming test there. If not, the test is covered indirectly via `LayersPanel.test.tsx` (which mounts `LayerListItem` for each title layer); add the assertion there instead.

- [ ] **Step 2: Write a failing test for the auto-name (whichever file applies)**

```tsx
it("displays 'Bloc texte • <first line>…' for textarea layers", () => {
  // Mount LayerListItem (or LayersPanel) with a pack containing one textarea
  // layer whose i18n value resolves to "hello\nworld". Assert the row shows
  // "Bloc texte • hello…".
});
```

(Flesh out using whichever harness the surrounding tests use — `seedPack` style.)

- [ ] **Step 3: Run test to verify it fails**

Run: `(cd editor && rtk vitest run <path-to-test>)`
Expected: row text doesn't match — `deriveAutoName` returns `"Calque inconnu"` for textarea.

- [ ] **Step 4: Implement the textarea branch in `deriveAutoName`**

In `LayerListItem.tsx`, after the `if (layer.kind === "plain")` block (around line 168), add:

```tsx
  if (layer.kind === "textarea") {
    const raw = pack ? getText(pack, layer.value, activeLang) : "";
    const firstLine = (raw && raw.split("\n")[0]) || layer.value.key;
    const hasMore = raw && raw.includes("\n");
    const suffix = hasMore ? "…" : "";
    return `Bloc texte • ${truncate(firstLine, 18)}${suffix}`;
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `(cd editor && rtk vitest run <path-to-test>)`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add editor/src/features/canvas/title/composer/LayerListItem.tsx <path-to-test-if-modified>
git commit -m "$(cat <<'EOF'
feat(editor): LayerListItem — textarea auto-name

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Editor `LayerEditForm` — `TextareaLayerForm` (TDD)

This task colocates the textarea sub-form in `LayerEditForm.tsx` (no new file). Rationale: the existing sub-forms (`ImageLayerForm`, `TextLayerForm`, `PlainLayerForm`, `ExternalGlyphForm`) all live in the same file, sharing imports and idioms. Splitting one out would diverge from convention without benefit.

**Files:**
- Modify: `editor/src/features/canvas/title/composer/LayerEditForm.test.tsx`
- Modify: `editor/src/features/canvas/title/composer/LayerEditForm.tsx`

- [ ] **Step 1: Write the failing `TextareaLayerForm` tests**

Append a new `describe` block at the end of `LayerEditForm.test.tsx`:

```tsx
describe("LayerEditForm — textarea layer", () => {
  beforeEach(() => {
    seedPack(
      [
        {
          kind: "textarea",
          value: { key: K("t1") },
          x: 8,
          y: 6,
          lineHeight: 10,
          alignment: "left",
        },
      ],
      { t1: { en: "hello\nworld" } },
    );
    selectLayer(0);
  });

  it("renders the multi-line textarea + line-height + alignment + font picker + xy inputs", () => {
    render(<LayerEditForm packId={PACK_ID} />);
    expect(screen.getByTestId("textarea-content")).toBeTruthy();
    expect(screen.getByTestId("textarea-line-height")).toBeTruthy();
    expect(screen.getByTestId("textarea-align-left")).toBeTruthy();
    expect(screen.getByTestId("textarea-align-center")).toBeTruthy();
    expect(screen.getByTestId("textarea-align-right")).toBeTruthy();
    expect(screen.getByTestId("textarea-font")).toBeTruthy();
    expect(screen.getByTestId("textarea-x")).toBeTruthy();
    expect(screen.getByTestId("textarea-y")).toBeTruthy();
  });

  it("editing the content writes newlines to the i18n value", () => {
    render(<LayerEditForm packId={PACK_ID} />);
    const ta = screen.getByTestId("textarea-content") as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "line1\nline2\nline3" } });
    const updated = useAccountStore.getState().account.packs[0]!.i18nKeys.t1?.en;
    expect(updated).toBe("line1\nline2\nline3");
  });

  it("clicking center alignment updates layer.alignment", () => {
    render(<LayerEditForm packId={PACK_ID} />);
    fireEvent.click(screen.getByTestId("textarea-align-center"));
    const layer = useAccountStore.getState().account.packs[0]!.menus[0]!.title[0] as any;
    expect(layer.alignment).toBe("center");
  });

  it("line height clamps to [1, 32]", () => {
    render(<LayerEditForm packId={PACK_ID} />);
    const lh = screen.getByTestId("textarea-line-height") as HTMLInputElement;
    fireEvent.change(lh, { target: { value: "0" } });
    let layer = useAccountStore.getState().account.packs[0]!.menus[0]!.title[0] as any;
    expect(layer.lineHeight).toBe(1);
    fireEvent.change(lh, { target: { value: "999" } });
    layer = useAccountStore.getState().account.packs[0]!.menus[0]!.title[0] as any;
    expect(layer.lineHeight).toBe(32);
  });

  it("shows a Y-overflow warning when y + (lines-1)*lineHeight > 140", () => {
    // Seed: 5 lines, y=130, lineHeight=10 → line 4 at y=170 > 140.
    seedPack(
      [
        {
          kind: "textarea",
          value: { key: K("t1") },
          x: 0,
          y: 130,
          lineHeight: 10,
          alignment: "left",
        },
      ],
      { t1: { en: "a\nb\nc\nd\ne" } },
    );
    selectLayer(0);
    render(<LayerEditForm packId={PACK_ID} />);
    expect(screen.getByTestId("textarea-y-overflow-warning")).toBeTruthy();
  });

  it("does not show Y-overflow warning when all lines fit", () => {
    render(<LayerEditForm packId={PACK_ID} />);
    expect(screen.queryByTestId("textarea-y-overflow-warning")).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `(cd editor && rtk vitest run src/features/canvas/title/composer/LayerEditForm.test.tsx)`
Expected: 6 new tests fail (no `TextareaLayerForm` dispatch yet).

- [ ] **Step 3: Add the dispatch in `LayerEditForm`**

In `LayerEditForm.tsx`, after the `if (layer.kind === "plain")` block (around line 89), add:

```tsx
  if (layer.kind === "textarea") {
    return (
      <TextareaLayerForm
        packId={packId}
        menuId={selectedKey.menuId}
        index={selectedKey.index}
        layer={layer}
      />
    );
  }
```

- [ ] **Step 4: Implement `TextareaLayerForm`**

Append at the bottom of `LayerEditForm.tsx`, after `ExternalGlyphForm`:

```tsx
// ─── Textarea ──────────────────────────────────────────────────────────────

import { AlignCenter, AlignLeft, AlignRight } from "lucide-react";
import { cn } from "@/lib/cx";

interface TextareaLayerFormProps {
  packId: PackId;
  menuId: import("@/domain/types").MenuId;
  index: number;
  layer: Extract<MenuTitleLayer, { kind: "textarea" }>;
}

function TextareaLayerForm({ packId, menuId, index, layer }: TextareaLayerFormProps) {
  const textEdit = useTextEdit(packId, layer.value);
  const setI18nValue = useAccountStore((s) => s.setI18nValue);
  const updateLayer = useAccountStore((s) => s.updateMenuTitleLayer);
  const allAssets = useAssetStore((s) => s.assets);
  const fontAssets = allAssets.filter((a) => a.type === "font");

  // Y-overflow: line i renders at y + i*lineHeight, must be ≤ 140.
  const lines = textEdit.value.split("\n");
  const lastLineY = layer.y + (lines.length - 1) * layer.lineHeight;
  const overflows = lastLineY > 140;

  const setAlignment = (a: "left" | "center" | "right") =>
    updateLayer({
      packId, menuId, index,
      patch: { alignment: a } as Partial<MenuTitleLayer>,
    });

  return (
    <div className="flex flex-col gap-3 text-xs text-zinc-300">
      <div>
        <label
          htmlFor={`textarea-layer-content-${index}`}
          className="mb-1 block text-[10px] uppercase text-zinc-500"
        >
          Texte (MiniMessage, multi-ligne) — {textEdit.lang}
        </label>
        <textarea
          id={`textarea-layer-content-${index}`}
          data-testid="textarea-content"
          value={textEdit.value}
          onChange={(e) =>
            setI18nValue({
              packId,
              lt: layer.value,
              lang: textEdit.lang,
              value: e.target.value,
            })
          }
          rows={3}
          className="min-h-[80px] w-full resize-y rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 font-mono text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-zinc-500 focus:outline-none"
        />
      </div>

      <div className="rounded border border-zinc-800 bg-zinc-900/40 p-2">
        <div className="mb-1 text-[10px] uppercase text-zinc-500">Aperçu</div>
        {lines.map((line, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: order is stable within preview
          <MiniMessageInline key={i} source={line} className="font-mono text-xs" />
        ))}
      </div>

      <div className="flex gap-3">
        <div className="flex flex-col gap-1.5 flex-1">
          <div className="text-[10px] uppercase text-zinc-500">Hauteur de ligne (px)</div>
          <Input
            type="number"
            data-testid="textarea-line-height"
            value={layer.lineHeight}
            onChange={(e) => {
              const raw = parseInt(e.target.value, 10);
              if (!Number.isFinite(raw)) return;
              const clamped = Math.min(32, Math.max(1, raw));
              updateLayer({
                packId, menuId, index,
                patch: { lineHeight: clamped } as Partial<MenuTitleLayer>,
              });
            }}
            className="h-7 w-full font-mono text-xs"
          />
        </div>
        <div className="flex flex-col gap-1.5 flex-1">
          <div className="text-[10px] uppercase text-zinc-500">Alignement</div>
          <div className="flex rounded border border-zinc-700 bg-zinc-900 p-0.5">
            <button
              type="button"
              data-testid="textarea-align-left"
              onClick={() => setAlignment("left")}
              className={cn(
                "flex-1 rounded p-1",
                layer.alignment === "left" ? "bg-zinc-700 text-zinc-100" : "text-zinc-400",
              )}
              title="Aligner à gauche"
              aria-label="Aligner à gauche"
            >
              <AlignLeft className="mx-auto h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              data-testid="textarea-align-center"
              onClick={() => setAlignment("center")}
              className={cn(
                "flex-1 rounded p-1",
                layer.alignment === "center" ? "bg-zinc-700 text-zinc-100" : "text-zinc-400",
              )}
              title="Centrer"
              aria-label="Centrer"
            >
              <AlignCenter className="mx-auto h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              data-testid="textarea-align-right"
              onClick={() => setAlignment("right")}
              className={cn(
                "flex-1 rounded p-1",
                layer.alignment === "right" ? "bg-zinc-700 text-zinc-100" : "text-zinc-400",
              )}
              title="Aligner à droite"
              aria-label="Aligner à droite"
            >
              <AlignRight className="mx-auto h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="text-[10px] uppercase text-zinc-500">Police personnalisée</div>
        <select
          data-testid="textarea-font"
          value={layer.fontAssetId ?? ""}
          onChange={(e) => {
            const v = e.target.value;
            updateLayer({
              packId, menuId, index,
              patch: { fontAssetId: v || undefined } as Partial<MenuTitleLayer>,
            });
          }}
          className="h-8 w-full rounded border border-zinc-700 bg-zinc-900 px-2 text-xs text-zinc-200"
        >
          <option value="">Aucune (vanilla)</option>
          {fontAssets.map((f) => (
            <option key={f.id} value={f.id}>{f.name}</option>
          ))}
        </select>
      </div>

      <div className="flex gap-3">
        <div className="flex flex-col gap-1.5 flex-1">
          <div className="text-[10px] uppercase text-zinc-500">X</div>
          <Input
            type="number"
            data-testid="textarea-x"
            value={layer.x}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              if (Number.isFinite(v)) {
                updateLayer({ packId, menuId, index, patch: { x: v } as Partial<MenuTitleLayer> });
              }
            }}
            className="h-7 w-full font-mono text-xs"
          />
        </div>
        <div className="flex flex-col gap-1.5 flex-1">
          <div className="text-[10px] uppercase text-zinc-500">Y (ligne 0)</div>
          <Input
            type="number"
            data-testid="textarea-y"
            value={layer.y}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              if (Number.isFinite(v)) {
                updateLayer({ packId, menuId, index, patch: { y: v } as Partial<MenuTitleLayer> });
              }
            }}
            className="h-7 w-full font-mono text-xs"
          />
        </div>
      </div>

      {overflows ? (
        <div
          data-testid="textarea-y-overflow-warning"
          className="rounded border border-amber-700 bg-amber-950/40 px-2.5 py-2 text-[11px] text-amber-200"
        >
          ⚠ Certaines lignes dépassent la zone rendable (Y &gt; 140) et seront tronquées.
        </div>
      ) : null}
    </div>
  );
}
```

Move the imports `AlignCenter`, `AlignLeft`, `AlignRight`, and `cn` to the top-level imports block to avoid mid-file imports — or keep at the top of the function for clarity (the project mixes both styles; favour file-top to be safe). Adjust accordingly.

- [ ] **Step 5: Run tests to verify they pass**

Run: `(cd editor && rtk vitest run src/features/canvas/title/composer/LayerEditForm.test.tsx)`
Expected: all 6 new tests green.

- [ ] **Step 6: Commit**

```bash
git add editor/src/features/canvas/title/composer/LayerEditForm.tsx editor/src/features/canvas/title/composer/LayerEditForm.test.tsx
git commit -m "$(cat <<'EOF'
feat(editor): TextareaLayerForm in LayerEditForm

Multi-line content, line-height (1..32 clamp), alignment toggle,
font picker, x/y inputs, Y-overflow warning.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Editor `TitleRender` — textarea render branch (TDD)

**Files:**
- Modify: `editor/src/features/canvas/title/composer/TitleRender.test.tsx`
- Modify: `editor/src/features/canvas/title/composer/TitleRender.tsx`

- [ ] **Step 1: Inspect the existing test harness in `TitleRender.test.tsx`**

Open `editor/src/features/canvas/title/composer/TitleRender.test.tsx` and find an existing test for a `text` layer. Reuse its `render` setup (Konva mocks, pack seeding) to write the textarea tests.

- [ ] **Step 2: Write the failing render tests**

Add a new `describe` block:

```tsx
describe("TitleRender — textarea layer", () => {
  it("renders N child line renderers for N \\n-separated lines", () => {
    // Seed a pack with one textarea (3 lines) and assert the rendered Konva
    // subtree contains 3 VanillaMcText (or McFontText) children. Use the
    // same render helper as the existing text layer tests.
  });

  it("places lines at y + i * lineHeight", () => {
    // Assert each line's y-coord is layer.y + i * layer.lineHeight (in MC pixels,
    // multiplied by `scale` for the Konva subtree).
  });

  it("center alignment: line x = layer.x - lineWidth/2", () => {
    // Assert: for content "a\nbb", line 0 at x = layer.x - vanillaTextWidth("a")/2,
    // line 1 at x = layer.x - vanillaTextWidth("bb")/2.
  });

  it("right alignment: line x = layer.x - lineWidth", () => {
    // Similar.
  });
});
```

Flesh out by mirroring the existing single-line `text` tests. If `react-konva` is mocked at the top of the file, assert via the mock; otherwise lean on `vanillaTextWidth` calls.

- [ ] **Step 3: Run test to verify it fails**

Run: `(cd editor && rtk vitest run src/features/canvas/title/composer/TitleRender.test.tsx)`
Expected: fails (no textarea branch).

- [ ] **Step 4: Add a textarea branch to `LayerNode`**

In `TitleRender.tsx`, inside `LayerNode`, find the `body` assignment chain (around line 289). Currently:

```tsx
  let body: React.ReactNode = null;
  if (layer.kind === "background" || layer.kind === "glyph") { ... }
  else if (layer.kind === "text") { ... }
  else if (layer.kind === "plain") { ... }
  else { /* external_glyph */ }
```

Insert before the `else { /* external_glyph */ }` branch:

```tsx
  else if (layer.kind === "textarea") {
    const fullText = text; // already resolved by the parent via getText
    const lines = fullText.split("\n");
    body = (
      <>
        {lines.map((line, i) => {
          const lineWidth = vanillaTextWidth(line);
          const lineX =
            layer.alignment === "center"
              ? -(lineWidth / 2) * scale
              : layer.alignment === "right"
                ? -lineWidth * scale
                : 0;
          const lineY = i * layer.lineHeight * scale;
          return fontAsset ? (
            // biome-ignore lint/suspicious/noArrayIndexKey: stable visual order
            <McFontText
              key={i}
              text={line}
              font={fontAsset}
              x={lineX}
              y={lineY + (fontRefAscent != null ? fontRefAscent * scale : BASELINE_Y_PX * scale)}
              scale={scale}
              listening={false}
            />
          ) : (
            // biome-ignore lint/suspicious/noArrayIndexKey: stable visual order
            <VanillaMcText
              key={i}
              source={line}
              x={lineX}
              y={lineY}
              scale={scale}
              defaultColor="#404040"
              listening={false}
            />
          );
        })}
      </>
    );
  }
```

Then extend the `text` extraction at the top of `TitleRender` (line 126) to also pull text for textarea:

```tsx
        const text = (layer.kind === "text" || layer.kind === "plain" || layer.kind === "textarea") ? getText(pack, layer.value, activeLang) : "";
```

And fontAsset extraction (line 122–125) to include textarea:

```tsx
        const fontAsset =
          (layer.kind === "text" || layer.kind === "textarea") && layer.fontAssetId
            ? assets.find((a) => a.id === layer.fontAssetId)
            : undefined;
```

Also extend the `groupX` / `groupY` computation in `LayerNode` (lines 202–219). For textarea, `groupX` should be `layer.x * scale` (matching `text`); `groupY` should be `layer.y * scale` (each child line offsets from there). Update the conditional to include textarea:

```tsx
  const groupX =
    layer.kind === "background" ? 0
    : layer.kind === "plain" ? TITLE_LABEL_X * scale
    : "x" in layer ? layer.x * scale : 0;
  const groupY =
    layer.kind === "background"
      ? (asset?.ascent != null ? (GLYPH_Y_BASE - asset.ascent) * scale : MC_TITLE_H * scale)
      : layer.kind === "plain"
        ? MC_TITLE_LABEL_Y * scale
        : layer.kind === "text"
          ? fontRefAscent != null
            ? (GLYPH_Y_BASE - fontRefAscent) * scale
            : layer.y * scale
          : layer.kind === "textarea"
            ? layer.y * scale
            : layer.kind === "glyph"
              ? (asset?.ascent != null ? (GLYPH_Y_BASE - asset.ascent) * scale : layer.y * scale)
              : "y" in layer
                ? layer.y * scale
                : 0;
```

Update the `outlineW` / `outlineH` and `hitW` / `hitH` bbox math (lines 360–393) to handle textarea — compute as max line width × n_lines × lineHeight:

```tsx
  const textareaLines = layer.kind === "textarea" ? text.split("\n") : [];
  const textareaMaxLineW =
    layer.kind === "textarea"
      ? Math.max(...textareaLines.map((l) => vanillaTextWidth(l)), 8)
      : 0;
  const textareaTotalH =
    layer.kind === "textarea"
      ? Math.max(1, textareaLines.length) * (layer as any).lineHeight
      : 0;
```

Then incorporate into the bbox conditionals:

```tsx
  const outlineW =
    layer.kind === "background" || layer.kind === "glyph"
      ? imageW
      : layer.kind === "external_glyph"
        ? 10 * scale
        : layer.kind === "textarea"
          ? textareaMaxLineW * scale
          : Math.max(vanillaTextWidth(text) * scale, 8);
  const outlineH =
    layer.kind === "background" || layer.kind === "glyph"
      ? imageH
      : layer.kind === "external_glyph"
        ? 10 * scale
        : layer.kind === "textarea"
          ? textareaTotalH * scale
          : MC_FONT_HEIGHT_PX * scale;
  const hitW =
    layer.kind === "background" || layer.kind === "glyph"
      ? imageW
      : layer.kind === "text" || layer.kind === "plain"
        ? Math.max(vanillaTextWidth(text) * scale, 8)
        : layer.kind === "textarea"
          ? textareaMaxLineW * scale
          : 10 * scale;
  const hitH =
    layer.kind === "background" || layer.kind === "glyph"
      ? imageH
      : layer.kind === "text" || layer.kind === "plain"
        ? MC_FONT_HEIGHT_PX * scale
        : layer.kind === "textarea"
          ? textareaTotalH * scale
          : 10 * scale;
```

Also extend `handleDragEnd`'s switch (line 257) so textarea drags update `(x, y)` directly (no ascent fixup):

```tsx
      if (layer.kind === "background" || layer.kind === "plain") return; // no x/y
      // ...
      const finalY =
        layer.kind === "text" && fontRefAscent != null
          ? GLYPH_Y_BASE - fontRefAscent
          : layer.kind === "glyph" && asset?.ascent != null
            ? GLYPH_Y_BASE - asset.ascent
            : snapped.y;
```

The existing `else` (`snapped.y`) already handles textarea — no change needed there.

- [ ] **Step 5: Run tests to verify they pass**

Run: `(cd editor && rtk vitest run src/features/canvas/title/composer/TitleRender.test.tsx)`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add editor/src/features/canvas/title/composer/TitleRender.tsx editor/src/features/canvas/title/composer/TitleRender.test.tsx
git commit -m "$(cat <<'EOF'
feat(editor): TitleRender textarea render branch

Renders N lines per textarea layer with alignment-aware x and
y = layer.y + i * lineHeight. Bounding box matches max line width
× lineHeight × N lines for selection / drag pickup.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Editor `useTitleLayerDrag` — verify textarea drag works (TDD)

`useTitleLayerDrag.ts` patches `{ x, y }` on the selected layer and is kind-agnostic (any layer with `x`/`y` fields). The only guard is `if (layer.kind === "background") return;` — textarea passes that guard and is patched correctly.

This task adds a regression test pinning that behavior.

**Files:**
- Modify: `editor/src/features/canvas/title/composer/useTitleLayerDrag.test.ts` (if it exists; otherwise add the assertion in `TitleRender.test.tsx` via simulated drag)

- [ ] **Step 1: Check whether `useTitleLayerDrag.test.ts` exists**

Run: `rtk find editor/src/features/canvas/title/composer -name "useTitleLayerDrag.test.ts"`

If it exists, append a textarea test. If not, skip this task — the TitleRender test in Task 11 already exercises the drag path indirectly.

- [ ] **Step 2 (only if test file exists): Write a failing drag test**

```ts
it("drag end on a textarea layer updates layer.x and layer.y", () => {
  // Seed pack with a textarea at (8, 6). Invoke onPositionChange({x: 20, y: 30}).
  // Assert the layer in the store is now { kind: "textarea", x: 20, y: 30, ... }.
});
```

- [ ] **Step 3: Run test to verify it passes**

Run: `(cd editor && rtk vitest run src/features/canvas/title/composer/useTitleLayerDrag.test.ts)`
Expected: green — no implementation change required (hook is kind-agnostic).

If failing, the hook needs an `if (layer.kind === "textarea") { ... }` branch — investigate.

- [ ] **Step 4: Commit (only if files changed)**

```bash
git add editor/src/features/canvas/title/composer/useTitleLayerDrag.test.ts
git commit -m "$(cat <<'EOF'
test(editor): useTitleLayerDrag — textarea regression test

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

If no changes, skip the commit and proceed to Task 13.

---

## Task 13: Update `CLAUDE.md`

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update the YAML title example**

In `CLAUDE.md`, find the section "Format menu YAML — champ `title`" (search: `kind: textarea` does not exist yet; search for `kind: external_glyph` and locate the example block). Append a new example layer in the same YAML block:

```yaml
  - kind: textarea
    value:
      key: i18nKey_block
    x: 8
    y: 6
    line_height: 10
    alignment: left
```

Also append a one-line summary near the section: "Sub-project SP5 introduces `kind: textarea` — un bloc de texte multi-ligne (split sur `\n`) avec `line_height` + `alignment` partagés sur toutes les lignes."

- [ ] **Step 2: Remove the stale `y`-not-used note**

Search `CLAUDE.md` for "Limitation connue" / "champ `y` des layers `text` est stocké dans le YAML et parsé mais **non utilisé**". This entire paragraph is now stale (since SP4 shipped `text_y{Y}` fonts that DO use `layer.y`). Delete it.

- [ ] **Step 3: Update the test counts**

In the "Tests — ce qui est couvert" table, bump:
- Plugin: `277` → roughly `290+` (8 textarea-compiler + 5 textarea-parser tests added)
- Editor: `622` → roughly `640` (textarea form + render + transform tests)

Use approximate numbers — the next CLAUDE.md tidy-up will reconcile against `./gradlew test` and `vitest run` actual output.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "$(cat <<'EOF'
docs(CLAUDE.md): textarea title layer + remove stale y-not-used note

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: Full-suite green check

- [ ] **Step 1: Run the full editor suite**

Run: `(cd editor && rtk vitest run)`
Expected: BUILD SUCCESSFUL — all tests green.

- [ ] **Step 2: Run the full plugin suite**

Run: `(cd plugin && ./gradlew test)`
Expected: BUILD SUCCESSFUL — all tests green.

- [ ] **Step 3: Typecheck the editor**

Run: `(cd editor && npx tsc --noEmit)`
Expected: no errors.

- [ ] **Step 4: Manual smoke test (Docker)**

Start the stack and verify a textarea renders end-to-end:

```bash
docker compose up -d
```

- Open `http://localhost:5173` → pack → menu.
- Click `+ Bloc texte` → set content `Welcome\nto the shop` → alignment center → save.
- Run `/artisan` in Minecraft to open the menu and confirm 2 lines render at the expected y positions and are horizontally centered around `layer.x`.

This is a visual check only — there is no automated cross-stack E2E in this project. If the visual matches, the feature is shipped.

- [ ] **Step 5: Sanity log**

Stop here — no further commits. The plan is complete.

---

## Self-review checklist

Run through this before declaring the plan done.

**Spec coverage:**

- [x] Section "Model" (Domain TS + Plugin Kotlin + YAML) → Tasks 1 (Kotlin) + 5 (TS) + 6 (YAML transform)
- [x] Section "Runtime — TitleCompiler" (compileLayerBody refactor + measureLineWidth + truncation + empty/single-line) → Tasks 3 + 4
- [x] Section "Editor" (AddLayerControls, LayerEditForm/TextareaLayerForm, LayerListItem, TitleRender, useTitleLayerDrag, transform) → Tasks 6–12
- [x] Section "Parsing (plugin)" → Task 2
- [x] Section "Tests" → integrated TDD-first in each task
- [x] Section "Migration / backward compat" → confirmed no migration; not a task
- [x] Section "File touch list" → matches Task structure

**Placeholder scan:** No "TBD", "TODO", or "add appropriate error handling". Every code step has actual code; every test step has actual assertions.

**Type consistency:**

- Plugin `MenuTitleLayer.Textarea` matches the spec (LText, x, y, lineHeight, alignment, fontAssetId).
- Editor `MenuTitleLayer { kind: "textarea", ... }` matches the spec (camelCase: lineHeight, fontAssetId).
- YAML field names snake_case throughout (line_height, font_asset_id) — consistent between transform serializer, transform parser, plugin parser.
- Alignment enum vs union: Kotlin `MenuTitleLayer.Alignment.{LEFT,CENTER,RIGHT}`, TS `"left" | "center" | "right"`, YAML lowercase. Cross-side conversion happens at parser boundaries (both directions).
