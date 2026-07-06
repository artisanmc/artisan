# Inline Default-Language Export (Per-Field Hybrid i18n) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Export untranslated text fields as inline literals in menu/dialog/command YAML (readable, DeluxeMenus-like); keep `{i18n:key}` refs + `lang/` files only for fields that actually have a translation beyond the project's default language. A single-language project exports 100% literals and zero `lang/` files.

**Architecture:** The editor's internal model (opaque `lt_` keys + `Project.i18nKeys`) does NOT change. Only the export policy in `editor/src/features/export/transform.ts` changes (per-field: translated → ref, untranslated → inline default text), plus the import bridge for title layers, plus a small plugin change (title layers are the only field with a typed `{key}` object form — they gain a `literal` fallback). All other plugin resolvers already pass literals through untouched (`startsWith("{i18n:")` content convention). A load-time WARN flags orphan lang keys (FTP renames).

**Tech Stack:** TypeScript (editor, Vitest), Kotlin (plugin, JUnit + Gradle), JSON Schema (docs/schema).

**Deploy-order constraint:** Plugin tasks (1–3) ship FIRST. An old plugin JAR reading a new-format bundle renders title layers as `""` (its `parseLText` only accepts the `{key}` map form). Editor tasks (4–7) only flip the export after the plugin accepts both forms.

## Global Constraints

- Backend is untouched by this plan. If you ever run backend tests anyway: `bun run test` — NEVER `bun test` direct (wipes the dev DB).
- Prefix shell commands with `rtk` where applicable (`rtk git add …`, `rtk git commit …`).
- `git add` with EXPLICIT paths only — never `git add -A` (repo has standing WIP).
- Conventional commit messages (`feat:`, `fix:`, `test:`, `docs:`).
- Editor tests: `cd editor && npx vitest run <file>` for targeted runs, `npm test` for the suite.
- Plugin tests: `cd plugin && ./gradlew test --tests "<Class>"` targeted, `./gradlew test` for the suite.
- Schema changes ship with their doc alignment in the same commit (CLAUDE.md doc-impact rule).
- The i18n reference wire convention is the string `{i18n:<key>}` for all fields EXCEPT menu title layers, which use a `{key: <key>}` object (`LText`).

## Key facts (read this before any task)

- **Editor exporter:** `editor/src/features/export/transform.ts`. `i18nRef` helper at line 25. Emission sites: actions (lines 64, 66-67, 90), appearance title/lore (166-167), title layers (`serializeTitleLayer`, 204-257, emits `value: { key }`), dialogs (487, 495, 507, 514, 524). Lang files: `transform()` lines 639-646 via `collectReferencedKeys` (548) + `serializeLang` (589).
- **Editor importer:** `editor/src/schema/menuV1ToDomain.ts` — `text()` helper (line 53) already mints a key for literal strings; title layers (`titleLayer`, line 109) currently call `ref(l.value.key)` only.
- **Plugin:** `LText` data class (`plugin/src/main/kotlin/net/artisanmc/plugin/model/LText.kt`); `MenuTitleParser.parseLText` (MenuTitleParser.kt:92-95) accepts `{key}` map only; `TitleCompiler.resolveLText` (TitleCompiler.kt:449-450) resolves a miss to `""` — this makes legacy bare-string titles render EMPTY today (latent bug this plan fixes via `literal`). Item/action/dialog resolvers (`MenuRenderer.resolveText`:180, `ActionExecutor.resolveText`:76, `DialogTextResolver.resolve`:36) already pass non-`{i18n:}` strings through — NO change needed there.
- **Plugin loader:** `ProjectReader` (`plugin/src/main/kotlin/net/artisanmc/plugin/yaml/ProjectReader.kt`) reads `lang/<lang>.yaml` per `manifest.languages`, missing file → `emptyMap()`. Fallback chain: `langMaps[lang] ?: langMaps[defaultLang] ?: emptyMap()` (`ProjectBundle.kt:222`, `:164`).
- **Domain glossary:** the `Project` type is aliased `pack` in transform.ts parameter names — keep existing naming.

---

### Task 1: Plugin — `LText.literal` + title-layer literal parsing + resolution

**Files:**
- Modify: `plugin/src/main/kotlin/net/artisanmc/plugin/model/LText.kt`
- Modify: `plugin/src/main/kotlin/net/artisanmc/plugin/engine/MenuTitleParser.kt:92-110`
- Modify: `plugin/src/main/kotlin/net/artisanmc/plugin/render/TitleCompiler.kt:443-450`
- Test: `plugin/src/test/kotlin/net/artisanmc/plugin/MenuTitleParserTest.kt`
- Test: `plugin/src/test/kotlin/net/artisanmc/plugin/TitleCompilerTest.kt`

**Interfaces:**
- Consumes: nothing new.
- Produces: `data class LText(val key: String = "", val literal: String? = null)`. `MenuTitleParser.parse` accepts `value: "<string>"` in structured layers (literal or `{i18n:key}`). `TitleCompiler` resolves `literal ?: langMap[key] ?: ""`.

- [ ] **Step 1: Write the failing tests**

Add to `MenuTitleParserTest.kt` (match the file's existing test style — plain JUnit assertions on `MenuTitleParser.parse(...)`):

```kotlin
@Test
fun `structured text layer accepts a literal string value`() {
    val layers = MenuTitleParser.parse(listOf(mapOf("kind" to "text", "value" to "<gold>Boutique", "x" to 8, "y" to 5)))
    val text = layers.single() as MenuTitleLayer.Text
    assertEquals(null, text.value.key.takeIf { it.isNotEmpty() })
    assertEquals("<gold>Boutique", text.value.literal)
}

@Test
fun `structured layer string value with i18n wrapper unwraps to key`() {
    val layers = MenuTitleParser.parse(listOf(mapOf("kind" to "plain", "value" to "{i18n:menus.shop.title}")))
    val plain = layers.single() as MenuTitleLayer.Plain
    assertEquals("menus.shop.title", plain.value.key)
    assertEquals(null, plain.value.literal)
}

@Test
fun `legacy bare-string title becomes a literal, not a key`() {
    val layers = MenuTitleParser.parse("Boutique")
    val plain = layers.single() as MenuTitleLayer.Plain
    assertEquals("Boutique", plain.value.literal)
}
```

Add to `TitleCompilerTest.kt` a test exercising literal resolution. `resolveLText` is private — test through the compiler's public path the same way existing langMap-resolution tests in this file do, with a layer whose `LText` has `literal = "Hello"` and an empty langMap, asserting the compiled title contains/renders "Hello". Mirror the structure of the existing key-resolution test and only change the input LText + expectation.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd plugin && ./gradlew test --tests "net.artisanmc.plugin.MenuTitleParserTest"`
Expected: FAIL — `literal` unresolved reference (compile error), which is the failure we want.

- [ ] **Step 3: Implement**

`LText.kt` — replace the class (keep package line):

```kotlin
/**
 * A localized text: either a reference into the lang map (`key`) or an inline
 * literal (`literal`, the project's default-language text shipped directly in
 * the menu YAML by the hybrid export policy — untranslated fields inline).
 *
 * Resolution order: `literal` wins when non-null; otherwise `key` is looked up
 * in the active lang map; a miss resolves to `""` (never echo the raw key).
 */
data class LText(val key: String = "", val literal: String? = null)
```

`MenuTitleParser.kt` — replace `parseLText` and `literalToLText`:

```kotlin
    private fun parseLText(v: Any?): LText = when (v) {
        is String -> literalToLText(v)
        is Map<*, *> -> LText(key = v["key"] as? String ?: "")
        else -> LText(key = "")
    }

    /**
     * String-valued text: `{i18n:foo.bar}` unwraps to the bare key; anything
     * else is inline literal text (hybrid export) — also covers the legacy
     * bare-string `title:` shape.
     */
    private fun literalToLText(raw: String): LText {
        if (raw.startsWith("{i18n:") && raw.endsWith("}")) {
            return LText(key = raw.removePrefix("{i18n:").removeSuffix("}"))
        }
        return LText(literal = raw)
    }
```

Also update the class KDoc (lines 6-17) sentence about legacy strings: literals now render as literal text (drop the stale "treats keys with no entry as literal text" claim, which was never true).

`TitleCompiler.kt` — replace `resolveLText` (keep the KDoc, amend it):

```kotlin
    /**
     * Resolve an [LText]: inline literal wins; otherwise look up the key in
     * the language map. On a miss we return `""` rather than echoing the raw
     * key — showing `menus.foo.title` in chat is worse than showing nothing.
     */
    private fun resolveLText(value: LText, langMap: Map<String, String>): String =
        value.literal ?: langMap[value.key] ?: ""
```

Then grep for other `LText(` construction/consumption sites and fix any compile breakage (named-arg constructions keep working since `key` now has a default):

Run: `cd plugin && grep -rn "LText(" src/main src/test --include=*.kt`

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd plugin && ./gradlew test --tests "net.artisanmc.plugin.MenuTitleParserTest" --tests "net.artisanmc.plugin.TitleCompilerTest"`
Expected: PASS (including pre-existing tests — if a pre-existing test pinned the old literal-as-key behavior, update it to the new literal semantics and say so in the commit body).

- [ ] **Step 5: Commit**

```bash
rtk git add plugin/src/main/kotlin/net/artisanmc/plugin/model/LText.kt plugin/src/main/kotlin/net/artisanmc/plugin/engine/MenuTitleParser.kt plugin/src/main/kotlin/net/artisanmc/plugin/render/TitleCompiler.kt plugin/src/test/kotlin/net/artisanmc/plugin/MenuTitleParserTest.kt plugin/src/test/kotlin/net/artisanmc/plugin/TitleCompilerTest.kt
rtk git commit -m "feat(plugin): title layers accept inline literal text (LText.literal)"
```

---

### Task 2: Plugin — integration test: mono-language project with no `lang/` dir

**Files:**
- Test: `plugin/src/test/kotlin/net/artisanmc/plugin/MonoLanguageProjectTest.kt` (create)

**Interfaces:**
- Consumes: `ProjectReader(projectsRoot, logger).readAll()`, `BundleMenu`, `MenuTitleLayer`, `LText` from Task 1.
- Produces: nothing (pin-down test only).

- [ ] **Step 1: Write the test**

Look at `plugin/src/test/kotlin/net/artisanmc/plugin/ProjectReaderTest.kt` first and reuse its temp-dir + YAML-file scaffolding helpers if it has them; otherwise use `@TempDir` as below:

```kotlin
package net.artisanmc.plugin

import net.artisanmc.plugin.model.MenuTitleLayer
import net.artisanmc.plugin.yaml.ProjectReader
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.io.File

/**
 * Hybrid export: a single-language project ships inline literals and NO lang/
 * directory. The reader must load it and keep literals intact end-to-end.
 */
class MonoLanguageProjectTest {

    @Test
    fun `project without lang dir loads with inline literals`(@TempDir root: File) {
        val proj = File(root, "shop_proj").apply { mkdirs() }
        File(proj, "manifest.yaml").writeText(
            """
            schema: manifest/v1
            project_id: shop_proj
            default_lang: en
            languages: [en]
            files:
              menus: [shop]
              commands: []
              dialogs: []
            """.trimIndent()
        )
        File(proj, "menus").mkdirs()
        File(proj, "menus/shop.yaml").writeText(
            """
            schema: menu/v1
            id: shop
            title:
              - kind: plain
                value: "<gold>Boutique"
            size: 27
            layers:
              - id: base
                name: Base
                elements:
                  - id: sword
                    positions: [4]
                    appearances:
                      - material: iron_sword
                        title: "Épée en fer"
                        lore:
                          - "Une épée robuste"
                          - "Ligne deux"
            """.trimIndent()
        )

        val bundles = ProjectReader(root).readAll()
        assertEquals(1, bundles.size)
        val menu = bundles.single().menus.single()

        val titleLayer = menu.titleLayers.single() as MenuTitleLayer.Plain
        assertEquals("<gold>Boutique", titleLayer.value.literal)

        val app = menu.appearancesFor("sword").single()
        assertEquals("Épée en fer", app.title)
        assertEquals(listOf("Une épée robuste", "Ligne deux"), app.lore)
    }
}
```

⚠ Adapt the two accessor lines (`menu.titleLayers`, `menu.appearancesFor("sword")`) to the real `BundleMenu` API — check `plugin/src/main/kotlin/net/artisanmc/plugin/model/ProjectBundle.kt` for the actual property/method names (the compiled menu holds title layers and compiled appearances; ProjectReaderTest shows how existing tests reach them). The assertions (literal preserved, title/lore strings unchanged) are the contract.

- [ ] **Step 2: Run the test**

Run: `cd plugin && ./gradlew test --tests "net.artisanmc.plugin.MonoLanguageProjectTest"`
Expected: PASS immediately (Task 1 already made it work; this pins the behavior). If it fails, that is a real bug in Task 1 — fix there, not here.

- [ ] **Step 3: Commit**

```bash
rtk git add plugin/src/test/kotlin/net/artisanmc/plugin/MonoLanguageProjectTest.kt
rtk git commit -m "test(plugin): pin mono-language project load without lang dir"
```

---

### Task 3: Plugin — WARN on orphan lang keys at project load

**Files:**
- Create: `plugin/src/main/kotlin/net/artisanmc/plugin/yaml/LangKeyAuditor.kt`
- Modify: `plugin/src/main/kotlin/net/artisanmc/plugin/yaml/ProjectReader.kt:39-72`
- Test: `plugin/src/test/kotlin/net/artisanmc/plugin/LangKeyAuditorTest.kt` (create)

**Interfaces:**
- Consumes: raw YAML file texts.
- Produces: `LangKeyAuditor.referencedKeys(yamlTexts: List<String>): Set<String>`; one `logger.warning(...)` per project listing orphan keys.

- [ ] **Step 1: Write the failing test**

```kotlin
package net.artisanmc.plugin

import net.artisanmc.plugin.yaml.LangKeyAuditor
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class LangKeyAuditorTest {

    @Test
    fun `collects i18n refs and title-layer key fields`() {
        val menuYaml = """
            title:
              - kind: text
                value:
                  key: menus.shop.title
            layers:
              - elements:
                  - appearances:
                      - title: "{i18n:menus.shop.elements.sword.title}"
                        lore:
                          - "literal line, no key"
        """.trimIndent()
        val keys = LangKeyAuditor.referencedKeys(listOf(menuYaml))
        assertEquals(setOf("menus.shop.title", "menus.shop.elements.sword.title"), keys)
    }

    @Test
    fun `no refs yields empty set`() {
        assertEquals(emptySet<String>(), LangKeyAuditor.referencedKeys(listOf("title: \"Plain\"")))
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd plugin && ./gradlew test --tests "net.artisanmc.plugin.LangKeyAuditorTest"`
Expected: FAIL — unresolved reference `LangKeyAuditor`.

- [ ] **Step 3: Implement `LangKeyAuditor`**

```kotlin
package net.artisanmc.plugin.yaml

/**
 * Text-level scan for translation-key references inside project YAML files.
 *
 * Two shapes exist on the wire: `{i18n:<key>}` strings (items, actions,
 * dialogs) and title-layer `key: <key>` fields. A plain-text regex scan
 * over-collects (any `key:` field matches) — acceptable: over-collection only
 * suppresses warnings, never fabricates one.
 */
object LangKeyAuditor {

    private val I18N_REF = Regex("""\{i18n:([^}]+)}""")
    private val KEY_FIELD = Regex("""(?m)^\s*key:\s*"?([^"\s]+)"?\s*$""")

    fun referencedKeys(yamlTexts: List<String>): Set<String> =
        yamlTexts.flatMapTo(mutableSetOf()) { text ->
            I18N_REF.findAll(text).map { it.groupValues[1] }.toList() +
                KEY_FIELD.findAll(text).map { it.groupValues[1] }.toList()
        }
}
```

In `ProjectReader.readProject`, after the `dialogs` block (line 69) and before the `return` (line 71), add:

```kotlin
        val contentFiles =
            manifest.files.menus.map { File(projectDir, "menus/$it.yaml") } +
                manifest.files.commands.map { File(projectDir, "commands/$it.yaml") } +
                manifest.files.dialogs.map { File(projectDir, "dialogs/$it.yaml") }
        val referenced = LangKeyAuditor.referencedKeys(contentFiles.filter { it.exists() }.map { it.readText() })
        val orphans = langMaps.values.flatMapTo(mutableSetOf()) { it.keys } - referenced
        if (orphans.isNotEmpty()) {
            logger?.warning(
                "Project ${manifest.projectId}: ${orphans.size} lang key(s) not referenced by any " +
                    "menu/command/dialog (renamed file?): ${orphans.sorted().joinToString(", ")}"
            )
        }
```

One WARN, no interactive behavior (per the no-theater rule).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd plugin && ./gradlew test --tests "net.artisanmc.plugin.LangKeyAuditorTest" --tests "net.artisanmc.plugin.ProjectReaderTest"`
Expected: PASS.

- [ ] **Step 5: Run the full plugin suite**

Run: `cd plugin && ./gradlew test`
Expected: all pass (~45 files).

- [ ] **Step 6: Commit**

```bash
rtk git add plugin/src/main/kotlin/net/artisanmc/plugin/yaml/LangKeyAuditor.kt plugin/src/main/kotlin/net/artisanmc/plugin/yaml/ProjectReader.kt plugin/src/test/kotlin/net/artisanmc/plugin/LangKeyAuditorTest.kt
rtk git commit -m "feat(plugin): warn on orphan lang keys at project load"
```

---

### Task 4: Editor — hybrid emission helpers + actions + appearances

**Files:**
- Modify: `editor/src/features/export/transform.ts:25` (helpers), `:55-132` (`serializeAction`), `:136-156` (step threading), `:160-177` (appearance)
- Test: `editor/src/features/export/transform.test.ts`

**Interfaces:**
- Consumes: `Project.i18nKeys`, `Project.defaultLang`, `i18nRef`.
- Produces (module-internal, used by Tasks 5-6):
  - `isTranslated(pack: Project, key: string): boolean` — true iff `pack.i18nKeys[key]` has a non-empty value for some lang ≠ `pack.defaultLang`.
  - `defaultText(pack: Project, key: string): string` — the defaultLang value or `""`.
  - `emitText(pack: Project, lt: { key: I18nKey }): string` — `{i18n:key}` if translated, else inline default text.
  - `serializeAction(action: Action, pack: Project)` — signature gains `pack`.

- [ ] **Step 1: Write the failing tests**

In `transform.test.ts`, reuse the file's existing pack-builder helpers/fixtures (it builds `Project` objects for the current `{i18n:}` assertions at lines ~241-244, ~336-337). Add a describe block; the assertions below are the contract:

```ts
describe("hybrid inline export", () => {
  // pack with defaultLang "en", one menu, element appearance:
  //   title key K1 -> { en: "Iron Sword" }                      (untranslated)
  //   lore  key K2 -> { en: "Line one\nLine two" }              (untranslated)
  //   click send_message key K3 -> { en: "Hi", fr: "Salut" }    (translated)

  it("emits untranslated appearance title as inline literal", () => {
    const files = transform(pack);
    const menu = parseYaml(files[`plugins/Artisan/projects/${pack.id}/menus/${menuId}.yaml`]);
    const app = menu.layers[0].elements[0].appearances[0];
    expect(app.title).toBe("Iron Sword");
  });

  it("emits untranslated lore as one literal line per array entry", () => {
    const app = /* same appearance */;
    expect(app.lore).toEqual(["Line one", "Line two"]);
  });

  it("keeps {i18n:} ref for a translated action text", () => {
    const app = /* same appearance */;
    expect(app.click.left.steps[0].action.text).toBe(`{i18n:${K3}}`);
  });

  it("empty-string translations do not count as translated", () => {
    // K1 gets { en: "Iron Sword", fr: "" } -> still inline
    expect(app.title).toBe("Iron Sword");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd editor && npx vitest run src/features/export/transform.test.ts`
Expected: new tests FAIL (title is `{i18n:...}` today); pre-existing tests still pass.

- [ ] **Step 3: Implement**

Below `i18nRef` (transform.ts:25) add:

```ts
/** True iff the key carries a non-empty value in some language other than the pack default. */
function isTranslated(pack: Project, key: string): boolean {
  const entry = pack.i18nKeys[key as keyof typeof pack.i18nKeys];
  if (!entry) return false;
  return Object.entries(entry).some(([lang, v]) => lang !== pack.defaultLang && !!v);
}

function defaultText(pack: Project, key: string): string {
  return pack.i18nKeys[key as keyof typeof pack.i18nKeys]?.[pack.defaultLang] ?? "";
}

/**
 * Hybrid emission: translated fields keep the `{i18n:key}` ref (the runtime
 * needs the key to look up lang maps); untranslated fields inline their
 * default-language text so single-language YAML stays human-readable.
 */
function emitText(pack: Project, lt: { key: I18nKey }): string {
  return isTranslated(pack, lt.key) ? i18nRef(lt.key) : defaultText(pack, lt.key);
}
```

Change `serializeAction(action: Action)` → `serializeAction(action: Action, pack: Project)` and update its three text emissions:

```ts
    case "send_message":
      return { type: "send_message", text: emitText(pack, action.text) };
```

```ts
    case "show_title": {
      const out: Record<string, unknown> = { type: "show_title", title: emitText(pack, action.title) };
      if (action.subtitle) out.subtitle = emitText(pack, action.subtitle);
```

```ts
    case "broadcast":
      return { type: "broadcast", text: emitText(pack, action.text) };
```

Update the two call sites: `serializeStep` line 138 → `serializeAction(step.action, pack)`; `extractFlatActions(steps: Step[])` (line 477) → `extractFlatActions(steps: Step[], pack: Project)` with `serializeAction(step.action, pack)`; its caller `serializeDialogButton` gains `pack` (fully rewired in Task 5 — for now pass `pack` through `serializeDialogButton(btn, pack)` and `serializeDialog(dialog, pack)` minimally so it compiles; `packToDialogV1` line 535 → `serializeDialog(d, pack)`, and `editor/src/routes/session.tsx` / any other `serializeDialog(` caller — `grep -rn "serializeDialog(" editor/src` — gets the pack argument).

In `serializeAppearance` (lines 166-167):

```ts
  if (app.title) out.title = emitText(pack, app.title);
  if (app.lore) {
    out.lore = isTranslated(pack, app.lore.key)
      ? [i18nRef(app.lore.key)]
      : defaultText(pack, app.lore.key).split("\n");
  }
```

(The importer's `loreText` joins multi-entry arrays with `\n` — round-trip safe.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd editor && npx vitest run src/features/export/transform.test.ts`
Expected: new tests PASS. Pre-existing tests asserting `{i18n:}` on untranslated fixtures will now FAIL — update those assertions to the new inline expectation (they are policy pins, not regressions; note it in the commit body). Tests whose fixtures include a second language keep their `{i18n:}` expectations.

- [ ] **Step 5: Commit**

```bash
rtk git add editor/src/features/export/transform.ts editor/src/features/export/transform.test.ts editor/src/routes/session.tsx
rtk git commit -m "feat(editor): hybrid inline export for action and appearance text"
```

(Only include `session.tsx` if it actually changed.)

---

### Task 5: Editor — title layers + dialog fields hybrid emission

**Files:**
- Modify: `editor/src/features/export/transform.ts:204-257` (`serializeTitleLayer`), `:420` (caller), `:486-531` (dialog serializers)
- Test: `editor/src/features/export/transform.test.ts`

**Interfaces:**
- Consumes: `emitText`, `isTranslated`, `defaultText` from Task 4.
- Produces: `serializeTitleLayer(layer: MenuTitleLayer, pack: Project)` emitting `value: "<literal>"` (string) for untranslated text/plain/textarea layers, `value: { key }` for translated ones. `serializeDialogBody/Input/Button(x, pack)`, `serializeDialog(dialog: Dialog, pack: Project)`.

- [ ] **Step 1: Write the failing tests**

```ts
it("emits untranslated title layer value as a literal string", () => {
  // menu title: [{ kind: "plain", value: K_title }], K_title -> { en: "<gold>Shop" }
  const menu = parseYaml(files[...menus path...]);
  expect(menu.title[0].value).toBe("<gold>Shop");
});

it("keeps { key } object for a translated title layer", () => {
  // K_title -> { en: "<gold>Shop", fr: "<gold>Boutique" }
  expect(menu.title[0].value).toEqual({ key: K_title });
});

it("emits untranslated dialog title and button label inline", () => {
  const dialog = parseYaml(files[...dialogs path...]);
  expect(dialog.title).toBe("Confirm purchase");
  expect(dialog.buttons[0].label).toBe("Buy");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd editor && npx vitest run src/features/export/transform.test.ts`
Expected: FAIL — values are `{key}` / `{i18n:}` today.

- [ ] **Step 3: Implement**

`serializeTitleLayer(layer: MenuTitleLayer)` → `serializeTitleLayer(layer: MenuTitleLayer, pack: Project)`. Add a local helper and use it for the three text kinds:

```ts
  const titleValue = (lt: { key: I18nKey }): unknown =>
    isTranslated(pack, lt.key) ? { key: lt.key } : defaultText(pack, lt.key);
```

- `text` (line 214): `value: titleValue(layer.value),`
- `plain` (line 227): `value: titleValue(layer.value)` — keep the existing comment.
- `textarea` (line 234): `value: titleValue(layer.value),`

Caller at line 420: `title: menu.title.map((l) => serializeTitleLayer(l, pack)),`

Dialog serializers — replace the four `i18nRef(x.key)` with `emitText(pack, x)` and thread `pack`:

```ts
function serializeDialogBody(body: DialogBody, pack: Project): Record<string, unknown> {
  if (body.type === "text") return { type: "text", text: emitText(pack, body.text) };
  return { type: "item", material: body.material, count: body.count };
}
```

- `serializeDialogInput(input, pack)`: `label: emitText(pack, input.label)`; single_option options: `label: emitText(pack, opt.label)`.
- `serializeDialogButton(btn, pack)`: `label: emitText(pack, btn.label)` (its `extractFlatActions(btn.steps, pack)` call was rewired in Task 4).
- `serializeDialog(dialog, pack)`: `title: emitText(pack, dialog.title)`, and pass `pack` down to body/inputs/buttons maps.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd editor && npx vitest run src/features/export/transform.test.ts`
Expected: PASS (again, update pre-existing `{i18n:}` / `{key}` pins on untranslated fixtures).

- [ ] **Step 5: Commit**

```bash
rtk git add editor/src/features/export/transform.ts editor/src/features/export/transform.test.ts
rtk git commit -m "feat(editor): hybrid inline export for title layers and dialog text"
```

---

### Task 6: Editor — lang files only for translated referenced keys

**Files:**
- Modify: `editor/src/features/export/transform.ts:589-612` (`serializeLang` comment), `:639-646` (lang emission in `transform()`)
- Test: `editor/src/features/export/transform.test.ts`

**Interfaces:**
- Consumes: `collectReferencedKeys` (unchanged), `isTranslated`.
- Produces: `transform()` emits `lang/<lang>.yaml` only when it has ≥1 entry; a fully-untranslated project produces NO `lang/` files. `lang/<defaultLang>.yaml` still exists when any key is translated (fallback anchor, `""`-seeded for missing default values).

- [ ] **Step 1: Write the failing tests**

```ts
it("mono-language project emits no lang files at all", () => {
  const files = transform(monoPack); // every key has only defaultLang values
  expect(Object.keys(files).filter((f) => f.includes("/lang/"))).toEqual([]);
});

it("translated key emits lang files for default + translated languages, untranslated keys excluded", () => {
  const files = transform(mixedPack); // K3 translated fr, K1/K2 not
  const en = parseYaml(files[`${base}/lang/en.yaml`]);
  const fr = parseYaml(files[`${base}/lang/fr.yaml`]);
  expect(Object.keys(en)).toEqual([K3]);
  expect(Object.keys(fr)).toEqual([K3]);
  expect(en[K3]).toBe("Hi");
  expect(fr[K3]).toBe("Salut");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd editor && npx vitest run src/features/export/transform.test.ts`
Expected: FAIL — lang files currently contain every referenced key for every language.

- [ ] **Step 3: Implement**

Replace transform() lines 639-646:

```ts
  const langs = listLanguages(pack);
  // Hybrid policy: only translated keys keep {i18n:} refs in the content
  // files, so only those need lang entries. Untranslated keys are inlined at
  // their site and never looked up. No translated key ⇒ no lang/ dir at all.
  const referencedKeys = new Set(
    [...collectReferencedKeys(pack)].filter((k) => isTranslated(pack, k)),
  );
  for (const lang of langs) {
    const entries = serializeLang(pack, lang, referencedKeys);
    if (Object.keys(entries).length > 0) {
      files[`${base}/lang/${lang}.yaml`] = stringify(entries, yamlOpts);
    }
  }
```

Update the stale comment inside `serializeLang` (lines 595-599): it now receives only translated referenced keys; the defaultLang `""` seeding stays (a translated key can still lack a default value — the runtime must resolve it to `""`, not echo the key).

`manifest.languages` stays `listLanguages(pack)` — the plugin tolerates a listed language with no file (`emptyMap()`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd editor && npx vitest run src/features/export/transform.test.ts`
Expected: PASS. Update pre-existing lang-file tests (e.g. "textarea i18n key is exported to lang/<lang>.yaml", line ~837, and the lang parses at ~509-510, ~867) to translated fixtures or new expectations.

- [ ] **Step 5: Commit**

```bash
rtk git add editor/src/features/export/transform.ts editor/src/features/export/transform.test.ts
rtk git commit -m "feat(editor): emit lang files only for translated referenced keys"
```

---

### Task 7: Editor — import accepts literal title-layer values + round-trip

**Files:**
- Modify: `editor/src/schema/menuV1ToDomain.ts:109-158` (`titleLayer`)
- Modify: `editor/src/features/export/transform.ts:300-402` (`parseTitleLayer` tolerance)
- Test: `editor/src/schema/menuV1ToDomain.test.ts`, `editor/src/schema/menuV1ToDomain.roundtrip.test.ts`

**Interfaces:**
- Consumes: existing `text()` / `ref()` bridge in `menuV1ToDomain.ts` (lines 48-59).
- Produces: `titleLayer` accepts `value: string` (literal or `{i18n:key}`) for kinds text/plain/textarea, minting keys via `text()`.

- [ ] **Step 1: Write the failing tests**

In `menuV1ToDomain.test.ts` (reuse the file's fixture style):

```ts
it("imports a literal title-layer value by minting a key", () => {
  const src = {
    schema: "menu/v1", id: "shop", size: 27, layers: [],
    title: [{ kind: "plain", value: "<gold>Shop" }],
  };
  const { menu, i18nKeys } = menuV1ToDomain(src, { projectId: pid, lang: "en" });
  const layer = menu.title[0] as Extract<MenuTitleLayer, { kind: "plain" }>;
  expect(i18nKeys[layer.value.key]).toEqual({ en: "<gold>Shop" });
});

it("imports an {i18n:} string title-layer value as a key ref", () => {
  const src = { ...same, title: [{ kind: "plain", value: "{i18n:menus.shop.title}" }] };
  const { menu } = menuV1ToDomain(src, { projectId: pid, lang: "en" });
  expect((menu.title[0] as any).value.key).toBe("menus.shop.title");
});
```

In `menuV1ToDomain.roundtrip.test.ts`, add a case: mono-language pack → `serializeMenuToV1` → `menuV1ToDomain` → re-serialize → identical YAML object (title literal, appearance title literal, multi-line lore array preserved).

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd editor && npx vitest run src/schema/menuV1ToDomain.test.ts src/schema/menuV1ToDomain.roundtrip.test.ts`
Expected: FAIL — `ref(l.value.key)` reads `.key` of a string → `undefined` key.

- [ ] **Step 3: Implement**

In `menuV1ToDomain.ts`, add next to the `text`/`ref` helpers:

```ts
  /** Title-layer `value` is either a `{key}` ref object or a literal string (hybrid export). */
  function layerValue(v: unknown): LText {
    return typeof v === "string" ? text(v) : ref((v as Json).key);
  }
```

Replace the three `ref(l.value.key)` calls in `titleLayer` (lines 118, 128, 135) with `layerValue(l.value)`.

In `transform.ts` `parseTitleLayer` (normalization helper): for the `text`/`plain`/`textarea` cases, before the object check, accept strings:

```ts
      const value = m.value;
      let key: I18nKey | undefined;
      if (typeof value === "string") {
        // Literal-string value (hybrid export). This helper has no minting
        // ability, so it stores the literal as the key — menuV1ToDomain is
        // the real import path and mints properly.
        key = value as I18nKey;
      } else if (
        value && typeof value === "object" &&
        typeof (value as { key?: unknown }).key === "string"
      ) {
        key = (value as { key: string }).key as I18nKey;
      }
```

(Check callers first: `grep -rn "parseTitleNode\|parseTitleLayer" editor/src` — if only tests/none call it, this tolerance change is still correct and cheap.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd editor && npx vitest run src/schema/menuV1ToDomain.test.ts src/schema/menuV1ToDomain.roundtrip.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full editor suite**

Run: `cd editor && npm test`
Expected: all pass (≥126 files). Fix any straggler tests pinning the old export shape (`canonical.test.ts`, `menuV1.test.ts`, `validate.test.ts`, `dialogV1.schema.test.ts`, i18n round-trips) by updating expectations to the hybrid policy — the domain model itself is untouched, so failures should be assertion-only.

- [ ] **Step 6: Commit**

```bash
rtk git add editor/src/schema/menuV1ToDomain.ts editor/src/features/export/transform.ts editor/src/schema/menuV1ToDomain.test.ts editor/src/schema/menuV1ToDomain.roundtrip.test.ts
rtk git commit -m "feat(editor): import literal title-layer values (hybrid round-trip)"
```

(Add any other test files you had to update.)

---

### Task 8: JSON schemas — title-layer `value` oneOf + hybrid policy descriptions

**Files:**
- Modify: `docs/schema/menu/v1/schema.json` (LText usage in `MenuTitleLayer`, ~lines 347-363; appearance `title`/`lore` descriptions ~271-272; action `text`/`title`/`subtitle` descriptions ~387-393)
- Modify: `docs/schema/dialog/v1/schema.json` (descriptions only — literals already allowed)
- Test: `cd editor && npx vitest run src/schema` (fixtures/examples validated by `validateMenuV1` tests)

**Interfaces:**
- Consumes: export shapes from Tasks 4-6.
- Produces: menu/v1 schema accepting `value: string | {key}` on text/plain/textarea layers.

- [ ] **Step 1: Read the schema and update `MenuTitleLayer.value`**

Read `docs/schema/menu/v1/schema.json` lines 340-370. Wherever a text-bearing layer's `value` property is `{"$ref": "#/$defs/LText"}`, replace with:

```json
"value": {
  "oneOf": [
    { "type": "string", "description": "Texte littéral (langue par défaut, export hybride) ou {i18n:key}." },
    { "$ref": "#/$defs/LText" }
  ]
}
```

Update the `LText` def description: drop the "harmonisation future" note, document the hybrid policy (untranslated → inline literal; translated → ref). Update appearance `title`/`lore` and action text descriptions to: "Littéral (texte de la langue par défaut, export hybride) ou référence {i18n:key} pour un champ traduit."

- [ ] **Step 2: Update dialog/v1 descriptions**

Same policy sentence on `title`, body `text`, and the `label` fields (they already say "Référence i18n {i18n:key} ou littéral MiniMessage" — align the wording).

- [ ] **Step 3: Validate fixtures/examples**

Run: `cd editor && npx vitest run src/schema`
Expected: PASS (schema-validation tests, including any `docs/schema/**/examples`). If an example file exists for menu/v1, add one title layer with a literal `value` to exercise the new branch.

- [ ] **Step 4: Commit**

```bash
rtk git add docs/schema/menu/v1/schema.json docs/schema/dialog/v1/schema.json
rtk git commit -m "docs(schema): menu/v1 title-layer value accepts literal string (hybrid i18n export)"
```

(Include example files if touched.)

---

### Task 9: Docs + CHANGELOG + final verification

**Files:**
- Modify: `docs/architecture/editor-internals.md` (title composer / i18n sections)
- Modify: `docs/architecture/schemas-codegen.md` (wire-shape note)
- Modify: `CHANGELOG.md` (`[Unreleased]`)

**Interfaces:** none (documentation).

- [ ] **Step 1: Document the hybrid policy**

In `editor-internals.md`, in the i18n/title-composer section, add a short "Hybrid inline export" subsection: per-field rule (translated → `{i18n:key}` + lang entries incl. defaultLang anchor; untranslated → inline defaultLang literal, lore as one array entry per line), mono-language ⇒ no `lang/` dir, plugin side (`LText.literal`, resolution `literal ?: langMap[key] ?: ""`, orphan-key WARN in `ProjectReader`). Keep it ≤30 lines; if it balloons, stop and run `/sync-docs` instead.

In `schemas-codegen.md`, note the `value: string | {key}` union on title layers and the policy sentence.

In `CHANGELOG.md` under `[Unreleased]`:

```markdown
- Hybrid i18n export: untranslated text fields now ship inline default-language literals in menu/command/dialog YAML; `lang/<lang>.yaml` files are emitted only for translated keys. Single-language projects have no `lang/` directory. menu/v1 title-layer `value` now accepts a literal string. Plugin warns on orphan lang keys at load. Old plugin JARs render literal title layers as empty — update the plugin before redeploying bundles.
```

- [ ] **Step 2: Full cross-suite verification**

Run: `cd plugin && ./gradlew test` → all pass.
Run: `cd editor && npm test` → all pass.
Run: `cd editor && npm run build` → builds clean.

- [ ] **Step 3: Commit**

```bash
rtk git add docs/architecture/editor-internals.md docs/architecture/schemas-codegen.md CHANGELOG.md
rtk git commit -m "docs: hybrid inline i18n export policy"
```

- [ ] **Step 4: Doc-debt check**

Invoke the `/sync-docs` skill to audit the full diff against `doc-impact-map.yaml`; apply anything it flags (e.g. docs-site user page for translations if warranted).

---

## Risks / known trade-offs (accepted at design time)

- **Old plugin JAR + new bundle:** title layers with literal `value` render `""` on pre-Task-1 JARs (map-only `parseLText`). Items/actions/dialogs are unaffected (content convention). Mitigation: plugin tasks land first; CHANGELOG entry warns operators.
- **FTP rename orphans translations:** covered by the load-time WARN (Task 3), not by remapping.
- **A literal that textually starts with `{i18n:`** would be reinterpreted as a ref on import/at runtime. Pre-existing limitation, unchanged.
- **Adding a language to an FTP-managed mono-language project** requires converting the target fields to `{i18n:key}` refs by hand (or via the editor, which does it automatically on next deploy once a translation exists).
