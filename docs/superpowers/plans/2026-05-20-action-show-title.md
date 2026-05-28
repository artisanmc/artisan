# `show_title` Action Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new `show_title` click/command action that displays a Minecraft HUD title (with optional subtitle and timings) and routes its text through the same i18n machinery as `send_message`.

**Architecture:** Mirror end-to-end the existing `send_message` action across the three subsystems:
- **Plugin (Kotlin/Paper):** new `Action.ShowTitle` sealed-class case, `ActionParser` branch, and `ActionExecutor` execution using Adventure's `Audience.showTitle(Title)`.
- **Editor (React/TS):** new discriminated-union member, action picker entry, `ShowTitleEditor` form, i18n key allocation/GC/rekey walkers, and YAML serializer.
- **i18n contract:** `title` is always an `LText` (mandatory); `subtitle` is an optional `LText`. Both flow through `pack.i18nKeys` and serialize as `{i18n:<key>}` in exported YAML. Timing fields (`fadeIn`/`stay`/`fadeOut`) are optional numbers in ticks; defaults match Adventure (`10/70/20`).

**Tech Stack:** Kotlin 2.0 + Paper 1.21.4 (Adventure API) on the plugin side; React 19 + TypeScript + Vitest + Zustand/immer on the editor side. No backend changes — backend just shuttles the YAML through unchanged.

---

## File Structure

**Plugin (Kotlin) — modified only:**

- `plugin/src/main/kotlin/net/artisanmc/plugin/engine/Action.kt` — add `Action.ShowTitle` data class.
- `plugin/src/main/kotlin/net/artisanmc/plugin/engine/ActionParser.kt` — add `"show_title"` branch.
- `plugin/src/main/kotlin/net/artisanmc/plugin/engine/ActionExecutor.kt` — add `is Action.ShowTitle` branch using Adventure `Title.title(...)`.
- `plugin/src/test/kotlin/net/artisanmc/plugin/ActionParserTest.kt` — parse tests.
- `plugin/src/test/kotlin/net/artisanmc/plugin/ActionExecutorTest.kt` — execution test.

**Editor (TypeScript) — modified:**

- `editor/src/domain/types.ts` — extend `Action` union with `show_title`.
- `editor/src/features/flow/defaults.ts` — add `show_title` to `ACTION_TYPES` + `defaultAction`.
- `editor/src/features/flow/labels.ts` — add `actionTypeLabel("show_title")` case.
- `editor/src/features/flow/PseudocodeView.tsx` — add `actionSummaryArgs` case.
- `editor/src/lib/i18nKeys.ts` — add key helpers + extend `rekeyMenuLTexts` / `rekeyCommandLTexts`.
- `editor/src/lib/i18nMigration.ts` — extend `migrateStepsI18n` to lift `show_title` strings.
- `editor/src/state/accountStore.ts` — extend `allocStepLTexts`, `gcStepLTexts`, `gcDialogLTexts`, every send_message clone walker.
- `editor/src/features/canvas/properties/ActionEditor.tsx` — add `ShowTitleEditor` form and route.
- `editor/src/features/export/transform.ts` — add `serializeAction` case + extend the `walkActions` key-collector at the bottom.
- `editor/src/features/export/validate.ts` — extend the referenced-keys walker.
- `editor/src/locales/en.ts` and `editor/src/locales/fr.ts` — add `actionEditor.showTitle*` keys.

**Editor (TypeScript) — tests modified:**

- `editor/src/lib/i18nKeys.test.ts` — assert key helpers + rekey walker on `show_title`.
- `editor/src/features/export/transform.test.ts` — assert YAML emission of `show_title`.
- `editor/src/features/export/validate.test.ts` — assert validation finds dangling `show_title` LText keys.
- `editor/src/state/accountStore.test.ts` — assert `addElementStep` allocates `show_title` keys with the right naming scheme.

**No backend changes.** The backend just stores and serves the YAML; new fields pass through.

---

## Data shape (locked-in)

YAML emitted by the editor (snake_case, mirroring existing actions):

```yaml
- type: show_title
  title: "{i18n:menus.shop.elements.btn.default.click.left.show_title}"
  subtitle: "{i18n:menus.shop.elements.btn.default.click.left.show_subtitle}"   # optional
  fade_in: 10     # optional, ticks, default 10
  stay: 70        # optional, ticks, default 70
  fade_out: 20    # optional, ticks, default 20
```

Editor in-memory shape:

```ts
| { type: "show_title"; title: LText; subtitle?: LText; fadeIn?: number; stay?: number; fadeOut?: number }
```

Plugin in-memory shape:

```kotlin
data class ShowTitle(
    val title:    String,        // raw MiniMessage / i18n ref — resolved by resolveText()
    val subtitle: String? = null,
    val fadeIn:   Int = 10,      // ticks
    val stay:     Int = 70,
    val fadeOut:  Int = 20,
) : Action()
```

i18n key naming (parallel to `messageKeyAt`):

```ts
showTitleKeyAt(prefix, idx)    // idx 0 → `${prefix}.show_title`,    idx > 0 → `${prefix}.show_title_${idx}`
showSubtitleKeyAt(prefix, idx) // idx 0 → `${prefix}.show_subtitle`, idx > 0 → `${prefix}.show_subtitle_${idx}`
```

Counter shared with `messageKeyAt`? **No** — each action keeps its own counter so adding a `show_title` doesn't renumber neighboring messages. The walker increments three independent counters (`messageCounter`, `showTitleCounter`, `showSubtitleCounter`).

---

## Task 1: Plugin — `Action.ShowTitle` data class

**Files:**
- Modify: `plugin/src/main/kotlin/net/artisanmc/plugin/engine/Action.kt`

- [ ] **Step 1: Add the `ShowTitle` data class to the sealed hierarchy**

Edit `Action.kt`. Insert just after `data class Broadcast(val text: String) : Action()` (around line 23):

```kotlin
    data class ShowTitle(
        val title:    String,
        val subtitle: String? = null,
        val fadeIn:   Int = 10,
        val stay:     Int = 70,
        val fadeOut:  Int = 20,
    ) : Action()
```

- [ ] **Step 2: Compile to verify no breakage**

Run: `cd plugin; ./gradlew compileKotlin`
Expected: BUILD SUCCESSFUL. Existing `when (action)` branches in `ActionExecutor.executeOne` will still compile because the new case is unhandled but the `when` isn't exhaustive on `Action` (sealed-class `when` over a value used as a statement compiles without all branches).

- [ ] **Step 3: Commit**

```bash
rtk git add plugin/src/main/kotlin/net/artisanmc/plugin/engine/Action.kt
rtk git commit -m "feat(plugin): add Action.ShowTitle data class"
```

---

## Task 2: Plugin — `ActionParser` "show_title" branch (TDD)

**Files:**
- Modify: `plugin/src/main/kotlin/net/artisanmc/plugin/engine/ActionParser.kt`
- Modify: `plugin/src/test/kotlin/net/artisanmc/plugin/ActionParserTest.kt`

- [ ] **Step 1: Write the failing tests**

Add to `ActionParserTest.kt` after the `parse broadcast` test (around line 84):

```kotlin
    @Test
    fun `parse show_title minimal`() {
        val a = ActionParser.parse(mapOf("type" to "show_title", "title" to "<green>Hello"))
        assertEquals(Action.ShowTitle(title = "<green>Hello"), a)
    }

    @Test
    fun `parse show_title with subtitle and timings`() {
        val a = ActionParser.parse(mapOf(
            "type" to "show_title",
            "title" to "<gold>Welcome",
            "subtitle" to "<gray>to the shop",
            "fade_in" to 5,
            "stay" to 40,
            "fade_out" to 15,
        ))
        assertEquals(
            Action.ShowTitle(title = "<gold>Welcome", subtitle = "<gray>to the shop", fadeIn = 5, stay = 40, fadeOut = 15),
            a,
        )
    }

    @Test
    fun `parse show_title accepts numeric ticks as Number`() {
        // YAML deserialization can hand us Long or Int — both must work.
        val a = ActionParser.parse(mapOf(
            "type" to "show_title",
            "title" to "x",
            "fade_in" to 5L,
            "stay" to 40L,
            "fade_out" to 15L,
        ))
        assertEquals(Action.ShowTitle(title = "x", fadeIn = 5, stay = 40, fadeOut = 15), a)
    }

    @Test
    fun `parse show_title missing title throws`() {
        assertFailsWith<IllegalArgumentException> {
            ActionParser.parse(mapOf("type" to "show_title"))
        }
    }
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd plugin; ./gradlew test --tests "net.artisanmc.plugin.ActionParserTest"`
Expected: 4 new failures with messages like "Unknown action type: show_title".

- [ ] **Step 3: Add the parser branch**

Edit `ActionParser.kt`. Insert the `"show_title"` branch between `"broadcast"` (line 33) and `"play_sound"` (line 34):

```kotlin
            "show_title"     -> Action.ShowTitle(
                title    = str(raw, "title"),
                subtitle = raw["subtitle"] as? String,
                fadeIn   = (raw["fade_in"]  as? Number)?.toInt() ?: 10,
                stay     = (raw["stay"]     as? Number)?.toInt() ?: 70,
                fadeOut  = (raw["fade_out"] as? Number)?.toInt() ?: 20,
            )
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `cd plugin; ./gradlew test --tests "net.artisanmc.plugin.ActionParserTest"`
Expected: all `ActionParserTest` tests PASS.

- [ ] **Step 5: Commit**

```bash
rtk git add plugin/src/main/kotlin/net/artisanmc/plugin/engine/ActionParser.kt plugin/src/test/kotlin/net/artisanmc/plugin/ActionParserTest.kt
rtk git commit -m "feat(plugin): parse show_title action from YAML"
```

---

## Task 3: Plugin — `ActionExecutor.executeOne` branch (TDD)

**Files:**
- Modify: `plugin/src/main/kotlin/net/artisanmc/plugin/engine/ActionExecutor.kt`
- Modify: `plugin/src/test/kotlin/net/artisanmc/plugin/ActionExecutorTest.kt`

The plugin uses Adventure (Paper bundles it via Kyori). `Player` implements `Audience`, which has `showTitle(Title)`. We build a `Title` from `Component`s parsed via MiniMessage and `Title.Times.times(...)`.

- [ ] **Step 1: Write the failing test**

Add to `ActionExecutorTest.kt`, before the closing brace of the class (after the existing tests, before the final `}`):

```kotlin
    @Test fun `executeOne show_title sends Adventure title to player`() {
        val p = player()
        val action = Action.ShowTitle(
            title    = "<gold>Welcome",
            subtitle = "<gray>traveler",
            fadeIn   = 5,
            stay     = 40,
            fadeOut  = 15,
        )
        // No exception — MockBukkit's player accepts Adventure showTitle calls.
        executor().execute(listOf(action), ctx(p))
    }

    @Test fun `executeOne show_title resolves i18n in title and subtitle`() {
        val p = player()
        val langMap = mapOf("k_title" to "<gold>Hello", "k_sub" to "<gray>world")
        val context = ExecutionContext(p, lang = "en", langMap = langMap)
        val action = Action.ShowTitle(
            title    = "{i18n:k_title}",
            subtitle = "{i18n:k_sub}",
        )
        executor().execute(listOf(action), context)
        // Smoke test: no exception thrown by resolveText/MiniMessage on i18n refs.
    }

    @Test fun `executeOne show_title with null subtitle does not throw`() {
        val p = player()
        executor().execute(listOf(Action.ShowTitle(title = "<red>x")), ctx(p))
    }
```

- [ ] **Step 2: Run tests and confirm they fail**

Run: `cd plugin; ./gradlew test --tests "net.artisanmc.plugin.ActionExecutorTest"`
Expected: 3 new failures (`when` is non-exhaustive over `Action.ShowTitle`, so it falls through with no behavior — but the test still passes-by-accident on the third one). To make this strictly TDD, expect the compiler/IDE to also flag the `when` as non-exhaustive once we make it exhaustive in step 3. For now, the first two tests are smoke tests that pass trivially; what we really need is to wire the executor up.

(Practical note: if all three "passes by doing nothing" because the `when` is non-exhaustive, that's fine — Step 3 makes the wiring real, and Step 4 verifies still-pass plus exercises the new code path under a debugger / by reading the executor diff.)

- [ ] **Step 3: Add the `ShowTitle` branch in `executeOne`**

Edit `ActionExecutor.kt`. Add Adventure imports near the top (lines 4–5, after `import net.kyori.adventure.text.minimessage.MiniMessage`):

```kotlin
import net.kyori.adventure.title.Title
import java.time.Duration
```

Insert the branch in the `when (action)` block of `executeOne` (around line 110, between `is Action.Broadcast` and `is Action.PlaySound`):

```kotlin
            is Action.ShowTitle -> {
                val titleComponent    = mm.deserialize(resolveText(action.title, ctx))
                val subtitleComponent = action.subtitle?.let { mm.deserialize(resolveText(it, ctx)) }
                                            ?: net.kyori.adventure.text.Component.empty()
                val times = Title.Times.times(
                    Duration.ofMillis(action.fadeIn  * 50L),  // 1 tick = 50ms
                    Duration.ofMillis(action.stay    * 50L),
                    Duration.ofMillis(action.fadeOut * 50L),
                )
                player.showTitle(Title.title(titleComponent, subtitleComponent, times))
            }
```

- [ ] **Step 4: Run tests and confirm they pass**

Run: `cd plugin; ./gradlew test --tests "net.artisanmc.plugin.ActionExecutorTest"`
Expected: all `ActionExecutorTest` tests PASS, including the 3 new ones.

- [ ] **Step 5: Run the full plugin test suite to catch regressions**

Run: `cd plugin; ./gradlew test`
Expected: all tests PASS (~206 + 3 new = ~209).

- [ ] **Step 6: Commit**

```bash
rtk git add plugin/src/main/kotlin/net/artisanmc/plugin/engine/ActionExecutor.kt plugin/src/test/kotlin/net/artisanmc/plugin/ActionExecutorTest.kt
rtk git commit -m "feat(plugin): execute show_title via Adventure showTitle(Title)"
```

---

## Task 4: Editor — extend `Action` discriminated union

**Files:**
- Modify: `editor/src/domain/types.ts`

- [ ] **Step 1: Add the new union member**

Edit `editor/src/domain/types.ts`. Insert after the `send_message` line (line 215):

```ts
  /**
   * Display a Minecraft HUD title (and optional subtitle) to the
   * triggering player. Mirrors Adventure's `Audience.showTitle(Title)`.
   * `title` and `subtitle` are LText refs so they translate per-player;
   * timings are ticks (50ms each). Defaults match Adventure: 10/70/20.
   */
  | {
      type: "show_title";
      title: LText;
      subtitle?: LText;
      fadeIn?: number;
      stay?: number;
      fadeOut?: number;
    }
```

- [ ] **Step 2: Type-check the project to see every site that needs a new branch**

Run: `cd editor; rtk tsc --noEmit`
Expected: errors for non-exhaustive `switch` on `action.type` in:
- `editor/src/features/canvas/properties/ActionEditor.tsx` (`ActionEditor` switch)
- `editor/src/features/flow/labels.ts` (`actionTypeLabel`)
- `editor/src/features/flow/defaults.ts` (`defaultAction`)
- `editor/src/features/flow/PseudocodeView.tsx` (`actionSummaryArgs`)
- `editor/src/features/export/transform.ts` (`serializeAction`)

Don't fix those yet — Tasks 5–9 fix them one by one, each in its own commit. The compile errors guide which sites need a branch.

- [ ] **Step 3: Commit the type change only**

```bash
rtk git add editor/src/domain/types.ts
rtk git commit -m "feat(editor): add show_title to Action discriminated union"
```

---

## Task 5: Editor — `defaultAction` + `ACTION_TYPES` entry (TDD)

**Files:**
- Modify: `editor/src/features/flow/defaults.ts`
- Modify: `editor/src/features/flow/labels.ts`

`UNALLOCATED_LTEXT_KEY` (the `""` sentinel) lives in `defaults.ts` and is used by `allocStepLTexts` (Task 7) to recognize freshly-seeded LTexts and replace them with a real key. We reuse it here so the same flow works for `show_title`.

- [ ] **Step 1: Add `show_title` to `defaultAction` and `ACTION_TYPES`**

Edit `editor/src/features/flow/defaults.ts`. Insert a new case in the `switch (type)` after `case "send_message"` (around line 23):

```ts
    case "show_title":
      return { type: "show_title", title: { key: UNALLOCATED_LTEXT_KEY } };
```

And add `"show_title"` to the `ACTION_TYPES` array, immediately after `"send_message"`:

```ts
export const ACTION_TYPES: Action["type"][] = [
  "open_menu",
  "close_menu",
  "run_command",
  "send_message",
  "show_title",
  "give_item",
  "take_money",
  "paginate",
  "set_arg",
  "set_arg_cycle_next",
  "set_arg_cycle_prev",
  "open_dialog",
  "close_dialog",
];
```

Rationale: list order drives the dropdown order in the action picker (`PseudocodeView.tsx` line 869) — place `show_title` next to `send_message` since they're conceptually related.

- [ ] **Step 2: Add the label**

Edit `editor/src/features/flow/labels.ts`. Insert in `actionTypeLabel`'s switch, after `case "send_message"` (around line 13):

```ts
    case "show_title":
      return "title";
```

- [ ] **Step 3: Type-check**

Run: `cd editor; rtk tsc --noEmit`
Expected: errors in `ActionEditor.tsx`, `PseudocodeView.tsx`, `transform.ts` remain — those are fixed in later tasks.

- [ ] **Step 4: Commit**

```bash
rtk git add editor/src/features/flow/defaults.ts editor/src/features/flow/labels.ts
rtk git commit -m "feat(editor): register show_title in action picker + label table"
```

---

## Task 6: Editor — pseudocode summary case (TDD)

**Files:**
- Modify: `editor/src/features/flow/PseudocodeView.tsx`

- [ ] **Step 1: Add the `show_title` case to `actionSummaryArgs`**

Edit `editor/src/features/flow/PseudocodeView.tsx`. Insert in `actionSummaryArgs`'s switch (around line 1019), after `case "send_message"` (line 1026):

```ts
    case "show_title": {
      const title = getText(action.title);
      const sub = action.subtitle ? getText(action.subtitle) : null;
      return sub ? `"${title}" / "${sub}"` : `"${title}"`;
    }
```

- [ ] **Step 2: Type-check**

Run: `cd editor; rtk tsc --noEmit`
Expected: `PseudocodeView.tsx`'s exhaustiveness error is gone (remaining errors are in `ActionEditor.tsx` + `transform.ts`).

- [ ] **Step 3: Commit**

```bash
rtk git add editor/src/features/flow/PseudocodeView.tsx
rtk git commit -m "feat(editor): summarize show_title in pseudocode view"
```

---

## Task 7: Editor — i18n key helpers + alloc/gc walkers (TDD)

**Files:**
- Modify: `editor/src/lib/i18nKeys.ts`
- Modify: `editor/src/lib/i18nKeys.test.ts`
- Modify: `editor/src/state/accountStore.ts`
- Modify: `editor/src/lib/i18nMigration.ts`

This is the heart of the i18n wiring. `send_message` uses a single counter on `messageKeyAt`. For `show_title` we add two parallel counters (title + subtitle).

- [ ] **Step 1: Write failing tests for the new key helpers**

Add to `editor/src/lib/i18nKeys.test.ts` (use the existing import block — confirm `showTitleKeyAt` and `showSubtitleKeyAt` are added to the named imports):

```ts
  it("showTitleKeyAt index 0 omits suffix", () => {
    expect(showTitleKeyAt("commands.heal", 0)).toBe("commands.heal.show_title");
  });

  it("showTitleKeyAt index > 0 appends counter", () => {
    expect(showTitleKeyAt("commands.heal", 1)).toBe("commands.heal.show_title_1");
    expect(showTitleKeyAt("commands.heal", 2)).toBe("commands.heal.show_title_2");
  });

  it("showSubtitleKeyAt index 0 omits suffix", () => {
    expect(showSubtitleKeyAt("commands.heal", 0)).toBe("commands.heal.show_subtitle");
  });

  it("showSubtitleKeyAt index > 0 appends counter", () => {
    expect(showSubtitleKeyAt("commands.heal", 1)).toBe("commands.heal.show_subtitle_1");
  });
```

Add the imports at the top of the test file:

```ts
import {
  // ... existing imports
  showSubtitleKeyAt,
  showTitleKeyAt,
} from "./i18nKeys";
```

- [ ] **Step 2: Run tests, confirm they fail**

Run: `cd editor; npx vitest run src/lib/i18nKeys.test.ts`
Expected: 4 new failures — "showTitleKeyAt is not a function" or import errors.

- [ ] **Step 3: Add the helpers in `i18nKeys.ts`**

Edit `editor/src/lib/i18nKeys.ts`. Just after `messageKeyAt` (line 26–27), add:

```ts
export const showTitleKeyAt = (prefix: string, idx: number): I18nKey =>
  (idx === 0 ? `${prefix}.show_title` : `${prefix}.show_title_${idx}`) as I18nKey;

export const showSubtitleKeyAt = (prefix: string, idx: number): I18nKey =>
  (idx === 0 ? `${prefix}.show_subtitle` : `${prefix}.show_subtitle_${idx}`) as I18nKey;
```

- [ ] **Step 4: Run helper tests, confirm they pass**

Run: `cd editor; npx vitest run src/lib/i18nKeys.test.ts`
Expected: PASS (helpers PASS; existing rekey tests still PASS — we haven't changed `rekeyMenuLTexts` yet).

- [ ] **Step 5: Write failing test for `rekeyMenuLTexts` and `rekeyCommandLTexts` on `show_title`**

Add to `editor/src/lib/i18nKeys.test.ts` (use existing fixtures — pattern off the `send_message` tests already in the file):

```ts
  it("rekeyCommandLTexts assigns canonical show_title and show_subtitle keys", () => {
    const pack: Pack = makePackWithCommand([
      {
        kind: "action",
        action: {
          type: "show_title",
          title:    { key: "stale.title" as I18nKey },
          subtitle: { key: "stale.subtitle" as I18nKey },
        },
      },
    ], "heal");
    pack.i18nKeys = {
      "stale.title" as I18nKey: { en: "Hi" },
      "stale.subtitle" as I18nKey: { en: "subhi" },
    };
    rekeyCommandLTexts(pack, pack.commands[0]!);
    // Title moved
    const action = (pack.commands[0]!.steps[0] as { kind: "action"; action: { type: "show_title"; title: LText; subtitle?: LText } }).action;
    expect(action.title.key).toBe("commands.heal.show_title");
    expect(action.subtitle!.key).toBe("commands.heal.show_subtitle");
    expect(pack.i18nKeys["commands.heal.show_title" as I18nKey]).toEqual({ en: "Hi" });
    expect(pack.i18nKeys["commands.heal.show_subtitle" as I18nKey]).toEqual({ en: "subhi" });
  });

  it("rekeyCommandLTexts counts show_title and send_message independently", () => {
    const pack: Pack = makePackWithCommand([
      { kind: "action", action: { type: "send_message", text: { key: "a" as I18nKey } } },
      { kind: "action", action: { type: "show_title",   title: { key: "b" as I18nKey } } },
      { kind: "action", action: { type: "send_message", text: { key: "c" as I18nKey } } },
      { kind: "action", action: { type: "show_title",   title: { key: "d" as I18nKey } } },
    ], "x");
    pack.i18nKeys = {
      "a" as I18nKey: { en: "" },
      "b" as I18nKey: { en: "" },
      "c" as I18nKey: { en: "" },
      "d" as I18nKey: { en: "" },
    };
    rekeyCommandLTexts(pack, pack.commands[0]!);
    const steps = pack.commands[0]!.steps;
    expect((steps[0] as any).action.text.key).toBe("commands.x.message");
    expect((steps[1] as any).action.title.key).toBe("commands.x.show_title");
    expect((steps[2] as any).action.text.key).toBe("commands.x.message_1");
    expect((steps[3] as any).action.title.key).toBe("commands.x.show_title_1");
  });
```

(Use whatever `makePackWithCommand` helper the existing tests already use — pattern off the existing `rekeyCommandLTexts assigns canonical message keys` test.)

- [ ] **Step 6: Run tests, confirm they fail**

Run: `cd editor; npx vitest run src/lib/i18nKeys.test.ts`
Expected: the 2 new rekey tests FAIL — `rekeyCommandLTexts` doesn't yet touch `show_title`.

- [ ] **Step 7: Extend `rekeyMenuLTexts` and `rekeyCommandLTexts` to handle `show_title`**

Edit `editor/src/lib/i18nKeys.ts`. In `rekeyMenuLTexts` (the click handler loop, around lines 58–66), change the body of the `for (const action of walkActions(handler.steps))` loop:

```ts
            let msgIdx = 0;
            let titleIdx = 0;
            let subtitleIdx = 0;
            for (const action of walkActions(handler.steps)) {
              const prefix = clickHandlerKeyPrefix(menu.id, el.id, appIdx, clickType);
              if (action.type === "send_message") {
                moveLTextKey(pack, action.text, messageKeyAt(prefix, msgIdx));
                msgIdx++;
              } else if (action.type === "show_title") {
                moveLTextKey(pack, action.title, showTitleKeyAt(prefix, titleIdx));
                titleIdx++;
                if (action.subtitle) {
                  moveLTextKey(pack, action.subtitle, showSubtitleKeyAt(prefix, subtitleIdx));
                  subtitleIdx++;
                }
              }
            }
```

And similarly in `rekeyCommandLTexts` (around line 80):

```ts
  const prefix = commandKeyPrefix(cmd.id);
  let msgIdx = 0;
  let titleIdx = 0;
  let subtitleIdx = 0;
  for (const action of walkActions(cmd.steps)) {
    if (action.type === "send_message") {
      moveLTextKey(pack, action.text, messageKeyAt(prefix, msgIdx));
      msgIdx++;
    } else if (action.type === "show_title") {
      moveLTextKey(pack, action.title, showTitleKeyAt(prefix, titleIdx));
      titleIdx++;
      if (action.subtitle) {
        moveLTextKey(pack, action.subtitle, showSubtitleKeyAt(prefix, subtitleIdx));
        subtitleIdx++;
      }
    }
  }
```

- [ ] **Step 8: Run tests, confirm they pass**

Run: `cd editor; npx vitest run src/lib/i18nKeys.test.ts`
Expected: all tests PASS.

- [ ] **Step 9: Extend `allocStepLTexts` and `gcStepLTexts` in `accountStore.ts`**

Edit `editor/src/state/accountStore.ts`. Add the imports near the top (around line 51, where `messageKeyAt` is already imported):

```ts
import {
  // ... existing
  messageKeyAt,
  showSubtitleKeyAt,
  showTitleKeyAt,
  // ...
} from "@/lib/i18nKeys";
```

Then replace `allocStepLTexts` (around lines 599–609):

```ts
function allocStepLTexts(pack: Pack, steps: Step[], lang: string, keyPrefix: string): void {
  let msgCounter = 0;
  let titleCounter = 0;
  let subtitleCounter = 0;
  for (const action of walkActions(steps)) {
    if (action.type === "send_message") {
      if (action.text.key === "") {
        action.text = createLTextAt(pack, messageKeyAt(keyPrefix, msgCounter), "", lang);
      }
      msgCounter++;
    } else if (action.type === "show_title") {
      if (action.title.key === "") {
        action.title = createLTextAt(pack, showTitleKeyAt(keyPrefix, titleCounter), "", lang);
      }
      titleCounter++;
      if (action.subtitle && action.subtitle.key === "") {
        action.subtitle = createLTextAt(pack, showSubtitleKeyAt(keyPrefix, subtitleCounter), "", lang);
        subtitleCounter++;
      } else if (action.subtitle) {
        subtitleCounter++;
      }
    }
  }
}
```

And replace `gcStepLTexts` (lines 610–614):

```ts
function gcStepLTexts(pack: Pack, steps: Step[]): void {
  for (const action of walkActions(steps)) {
    if (action.type === "send_message") {
      deleteLText(pack, action.text);
    } else if (action.type === "show_title") {
      deleteLText(pack, action.title);
      if (action.subtitle) deleteLText(pack, action.subtitle);
    }
  }
}
```

- [ ] **Step 10: Update every other `send_message` walker in `accountStore.ts` to also handle `show_title`**

There are five clone-style walkers that special-case `send_message` for cross-pack clones / paste / import. Each must be extended. Locations (lookup by `if (action.type === "send_message")` in `accountStore.ts` — 8 sites total; 2 are already covered by the alloc/gc rewrite above):

1. **Line ~612** (covered in Step 9: `gcStepLTexts`).
2. **Line ~659** (`gcDialogLTexts`):

```ts
    for (const action of walkActions(btn.steps)) {
      if (action.type === "send_message") keys.add(action.text.key);
      else if (action.type === "show_title") {
        keys.add(action.title.key);
        if (action.subtitle) keys.add(action.subtitle.key);
      }
    }
```

3. **Line ~696** (`updateDialogLTextKey` — the inner loop). Following the same `else if` pattern:

```ts
    for (const action of walkActions(btn.steps)) {
      if (action.type === "send_message" && action.text.key === oldKey) {
        action.text.key = newKey;
        return;
      }
      if (action.type === "show_title") {
        if (action.title.key === oldKey) { action.title.key = newKey; return; }
        if (action.subtitle?.key === oldKey) { action.subtitle.key = newKey; return; }
      }
    }
```

4. **Line ~1130** (`removeDialogButton` — i18nKeys cleanup on button removal):

```ts
                for (const action of walkActions(btn.steps)) {
                  if (action.type === "send_message") delete pack!.i18nKeys[action.text.key];
                  else if (action.type === "show_title") {
                    delete pack!.i18nKeys[action.title.key];
                    if (action.subtitle) delete pack!.i18nKeys[action.subtitle.key];
                  }
                }
```

5. **Line ~2603** (element clone — duplicates the LText so the cloned element has its own i18n keys):

```ts
                      for (const action of walkActions(handler.steps)) {
                        if (action.type === "send_message") {
                          const src = pack.i18nKeys[action.text.key];
                          action.text = createLText(pack, "", pack.defaultLang);
                          if (src) pack.i18nKeys[action.text.key] = { ...src };
                        } else if (action.type === "show_title") {
                          const srcT = pack.i18nKeys[action.title.key];
                          action.title = createLText(pack, "", pack.defaultLang);
                          if (srcT) pack.i18nKeys[action.title.key] = { ...srcT };
                          if (action.subtitle) {
                            const srcS = pack.i18nKeys[action.subtitle.key];
                            action.subtitle = createLText(pack, "", pack.defaultLang);
                            if (srcS) pack.i18nKeys[action.subtitle.key] = { ...srcS };
                          }
                        }
                      }
```

6. **Line ~2750** (paste-menu walker — same shape as above):

```ts
                  for (const action of walkActions(handler.steps)) {
                    if (action.type === "send_message") {
                      const src = pack.i18nKeys[action.text.key];
                      action.text = createLText(pack, "", pack.defaultLang);
                      if (src) pack.i18nKeys[action.text.key] = { ...src };
                    } else if (action.type === "show_title") {
                      const srcT = pack.i18nKeys[action.title.key];
                      action.title = createLText(pack, "", pack.defaultLang);
                      if (srcT) pack.i18nKeys[action.title.key] = { ...srcT };
                      if (action.subtitle) {
                        const srcS = pack.i18nKeys[action.subtitle.key];
                        action.subtitle = createLText(pack, "", pack.defaultLang);
                        if (srcS) pack.i18nKeys[action.subtitle.key] = { ...srcS };
                      }
                    }
                  }
```

7. **Line ~2787** (paste-command walker — same shape):

```ts
              for (const action of walkActions(stamped.steps)) {
                if (action.type === "send_message") {
                  const src = pack.i18nKeys[action.text.key];
                  action.text = createLText(pack, "", pack.defaultLang);
                  if (src) pack.i18nKeys[action.text.key] = { ...src };
                } else if (action.type === "show_title") {
                  const srcT = pack.i18nKeys[action.title.key];
                  action.title = createLText(pack, "", pack.defaultLang);
                  if (srcT) pack.i18nKeys[action.title.key] = { ...srcT };
                  if (action.subtitle) {
                    const srcS = pack.i18nKeys[action.subtitle.key];
                    action.subtitle = createLText(pack, "", pack.defaultLang);
                    if (srcS) pack.i18nKeys[action.subtitle.key] = { ...srcS };
                  }
                }
              }
```

- [ ] **Step 11: Extend `migrateStepsI18n` in `i18nMigration.ts`**

Edit `editor/src/lib/i18nMigration.ts`. Replace the action-handling block (lines 83–86):

```ts
    if (s.kind === "action" && s.action) {
      const a = s.action as { type?: string; text?: unknown; title?: unknown; subtitle?: unknown };
      if (a.type === "send_message" && typeof a.text === "string") {
        a.text = lift(a.text);
      } else if (a.type === "show_title") {
        if (typeof a.title === "string") a.title = lift(a.title);
        if (typeof a.subtitle === "string") a.subtitle = lift(a.subtitle);
      }
    } else if (s.kind === "if") {
```

(Indent matches the existing `else if (s.kind === "if")`.)

- [ ] **Step 12: Write a failing test for `addElementStep` alloc on `show_title` in accountStore.test.ts**

Add to the existing "addElementStep" describe block in `editor/src/state/accountStore.test.ts` (pattern off the `allocates semantic key for send_message` test at line ~974):

```ts
    it("addElementStep allocates semantic keys for show_title (title + subtitle)", () => {
      useAccountStore.getState().addElementStep({
        packId: PERSONAL,
        menuId: SHOP_MAIN,
        elementId: PROFILE_BTN,
        appearanceIndex: 0,
        clickType: "left",
        frames: [],
        index: -1,
        step: {
          kind: "action",
          action: {
            type: "show_title",
            title:    { key: "" as I18nKey },
            subtitle: { key: "" as I18nKey },
          },
        },
        lang: "en",
      });
      const pack = useAccountStore.getState().account.packs.find((p) => p.id === PERSONAL)!;
      const el = pack.menus.find((m) => m.id === SHOP_MAIN)!.layers[0]!.elements.find((e) => e.id === PROFILE_BTN)!;
      const steps = el.appearances[0]!.click!.left!.steps;
      const last = steps[steps.length - 1]!;
      if (last.kind !== "action" || last.action.type !== "show_title") throw new Error();
      const expectedPrefix = `menus.${SHOP_MAIN}.elements.${PROFILE_BTN}.default.click.left`;
      expect(last.action.title.key).toBe(`${expectedPrefix}.show_title`);
      expect(last.action.subtitle!.key).toBe(`${expectedPrefix}.show_subtitle`);
    });
```

- [ ] **Step 13: Run the editor test suite**

Run: `cd editor; npx vitest run`
Expected: all tests PASS (~706 + new ones).

- [ ] **Step 14: Commit**

```bash
rtk git add editor/src/lib/i18nKeys.ts editor/src/lib/i18nKeys.test.ts editor/src/state/accountStore.ts editor/src/state/accountStore.test.ts editor/src/lib/i18nMigration.ts
rtk git commit -m "feat(editor): allocate, rekey, gc, migrate and clone i18n keys for show_title"
```

---

## Task 8: Editor — `ShowTitleEditor` form UI (TDD)

**Files:**
- Modify: `editor/src/features/canvas/properties/ActionEditor.tsx`
- Modify: `editor/src/locales/en.ts`
- Modify: `editor/src/locales/fr.ts`

The component mirrors `SendMessageEditor` for text routing — use `setI18nValue` so the LText ref stays stable across edits (preserves translations in other languages). Timings are local numeric state on the action.

- [ ] **Step 1: Add the new i18n keys to `en.ts`**

Edit `editor/src/locales/en.ts`. Inside the `actionEditor` object (around line 200, just before the closing `},`), insert:

```ts
    showTitleTitleLabel: "title (MiniMessage) [{{lang}}]",
    showTitleTitleLabelFallback: "title (MiniMessage) [{{lang}} — fallback]",
    showTitleTitlePlaceholder: "<gold>Welcome!</gold>",
    showTitleSubtitleLabel: "subtitle (MiniMessage) [{{lang}}]",
    showTitleSubtitleLabelFallback: "subtitle (MiniMessage) [{{lang}} — fallback]",
    showTitleSubtitlePlaceholder: "<gray>to the shop",
    showTitleSubtitleEnable: "+ Add subtitle",
    showTitleSubtitleRemove: "Remove subtitle",
    showTitleFadeInLabel: "fade in (ticks)",
    showTitleStayLabel: "stay (ticks)",
    showTitleFadeOutLabel: "fade out (ticks)",
    showTitleTicksHint: "20 ticks = 1 second. Leave empty to use vanilla defaults (10/70/20).",
```

- [ ] **Step 2: Add the matching FR keys to `fr.ts`**

Same shape, in `editor/src/locales/fr.ts` inside `actionEditor`:

```ts
    showTitleTitleLabel: "titre (MiniMessage) [{{lang}}]",
    showTitleTitleLabelFallback: "titre (MiniMessage) [{{lang}} — fallback]",
    showTitleTitlePlaceholder: "<gold>Bienvenue !</gold>",
    showTitleSubtitleLabel: "sous-titre (MiniMessage) [{{lang}}]",
    showTitleSubtitleLabelFallback: "sous-titre (MiniMessage) [{{lang}} — fallback]",
    showTitleSubtitlePlaceholder: "<gray>dans la boutique",
    showTitleSubtitleEnable: "+ Ajouter un sous-titre",
    showTitleSubtitleRemove: "Supprimer le sous-titre",
    showTitleFadeInLabel: "fade in (ticks)",
    showTitleStayLabel: "durée (ticks)",
    showTitleFadeOutLabel: "fade out (ticks)",
    showTitleTicksHint: "20 ticks = 1 seconde. Laissez vide pour utiliser les valeurs par défaut (10/70/20).",
```

- [ ] **Step 3: Add the editor route in `ActionEditor.tsx`**

Edit `editor/src/features/canvas/properties/ActionEditor.tsx`. In the `switch (action.type)` of `ActionEditor` (around line 101), add the route after `case "send_message"`:

```tsx
    case "show_title":
      return <ShowTitleEditor packId={packId} action={action} onChange={onChange} />;
```

- [ ] **Step 4: Add the `ShowTitleEditor` component**

Insert `ShowTitleEditor` just after `SendMessageEditor` in the same file (after line ~357). The pattern matches: pull `setI18nValue` from the store, use `useTextEdit` for the active-lang value, route changes via `setI18nValue` so the LText ref is stable. Timings are local action props (no i18n).

```tsx
function ShowTitleEditor({
  packId,
  action,
  onChange,
}: {
  packId: PackId;
  action: Extract<Action, { type: "show_title" }>;
  onChange: (a: Action) => void;
}) {
  const { t } = useTranslation();
  const setI18nValue = useAccountStore((s) => s.setI18nValue);
  const titleEdit = useTextEdit(packId, action.title);
  const subtitleEdit = useTextEdit(packId, action.subtitle ?? { key: "" as never });
  const hasSubtitle = !!action.subtitle;

  const onTitleChange = (value: string) =>
    setI18nValue({ packId, lt: action.title, lang: titleEdit.lang, value });
  const onSubtitleChange = (value: string) => {
    if (!action.subtitle) return;
    setI18nValue({ packId, lt: action.subtitle, lang: subtitleEdit.lang, value });
  };

  const enableSubtitle = () => {
    // Seed with the unallocated sentinel so the next store mutation that
    // routes through allocStepLTexts (e.g. the user clicking somewhere
    // else, or the next addElementStep) materializes a real key. For now
    // we allocate inline via createLText so the UI immediately has a
    // place to write to.
    onChange({ ...action, subtitle: { key: "" as never } });
  };
  const removeSubtitle = () => onChange({ ...action, subtitle: undefined });

  const setNumberField = (field: "fadeIn" | "stay" | "fadeOut", raw: string) => {
    const trimmed = raw.trim();
    if (trimmed === "") {
      const next = { ...action };
      delete next[field];
      onChange(next);
      return;
    }
    const n = Number(trimmed);
    if (Number.isFinite(n) && n >= 0) onChange({ ...action, [field]: Math.floor(n) });
  };

  return (
    <div className="flex flex-col gap-3">
      <div>
        <FieldLabel>
          {titleEdit.isFallback
            ? t("actionEditor.showTitleTitleLabelFallback", { lang: titleEdit.lang })
            : t("actionEditor.showTitleTitleLabel", { lang: titleEdit.lang })}
        </FieldLabel>
        <textarea
          className="w-full rounded border border-zinc-800 bg-zinc-900 p-2 font-mono text-xs"
          rows={2}
          placeholder={t("actionEditor.showTitleTitlePlaceholder")}
          value={titleEdit.value}
          onChange={(e) => onTitleChange(e.target.value)}
        />
        <ArgInsertBar onInsert={(name) => onTitleChange(`${titleEdit.value}{${name}}`)} />
        {looksLikeMiniMessage(titleEdit.value) ? (
          <div className="mt-1 rounded border border-zinc-800 bg-[var(--color-bg)] px-2 py-1">
            <span className="mr-2 text-[9px] uppercase text-zinc-600">
              {t("menuProperties.preview")}
            </span>
            <MiniMessageInline source={titleEdit.value} className="font-mono text-xs" />
          </div>
        ) : null}
      </div>

      {hasSubtitle ? (
        <div>
          <FieldLabel>
            {subtitleEdit.isFallback
              ? t("actionEditor.showTitleSubtitleLabelFallback", { lang: subtitleEdit.lang })
              : t("actionEditor.showTitleSubtitleLabel", { lang: subtitleEdit.lang })}
          </FieldLabel>
          <textarea
            className="w-full rounded border border-zinc-800 bg-zinc-900 p-2 font-mono text-xs"
            rows={2}
            placeholder={t("actionEditor.showTitleSubtitlePlaceholder")}
            value={subtitleEdit.value}
            onChange={(e) => onSubtitleChange(e.target.value)}
          />
          <ArgInsertBar onInsert={(name) => onSubtitleChange(`${subtitleEdit.value}{${name}}`)} />
          {looksLikeMiniMessage(subtitleEdit.value) ? (
            <div className="mt-1 rounded border border-zinc-800 bg-[var(--color-bg)] px-2 py-1">
              <span className="mr-2 text-[9px] uppercase text-zinc-600">
                {t("menuProperties.preview")}
              </span>
              <MiniMessageInline source={subtitleEdit.value} className="font-mono text-xs" />
            </div>
          ) : null}
          <button
            type="button"
            onClick={removeSubtitle}
            className="mt-1 text-[10px] text-zinc-500 hover:text-rose-400"
          >
            {t("actionEditor.showTitleSubtitleRemove")}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={enableSubtitle}
          className="self-start rounded border border-dashed border-zinc-700 px-2 py-1 text-[11px] text-zinc-400 hover:border-emerald-500 hover:text-emerald-200"
        >
          {t("actionEditor.showTitleSubtitleEnable")}
        </button>
      )}

      <div className="grid grid-cols-3 gap-2">
        <div>
          <FieldLabel>{t("actionEditor.showTitleFadeInLabel")}</FieldLabel>
          <Input
            type="number"
            min={0}
            placeholder="10"
            value={action.fadeIn ?? ""}
            onChange={(e) => setNumberField("fadeIn", e.target.value)}
          />
        </div>
        <div>
          <FieldLabel>{t("actionEditor.showTitleStayLabel")}</FieldLabel>
          <Input
            type="number"
            min={0}
            placeholder="70"
            value={action.stay ?? ""}
            onChange={(e) => setNumberField("stay", e.target.value)}
          />
        </div>
        <div>
          <FieldLabel>{t("actionEditor.showTitleFadeOutLabel")}</FieldLabel>
          <Input
            type="number"
            min={0}
            placeholder="20"
            value={action.fadeOut ?? ""}
            onChange={(e) => setNumberField("fadeOut", e.target.value)}
          />
        </div>
      </div>
      <div className="text-[10px] text-zinc-500">{t("actionEditor.showTitleTicksHint")}</div>
    </div>
  );
}
```

**Note on `subtitle: { key: "" as never }`** — when the user clicks "+ Add subtitle", we seed an unallocated LText. The next store mutation that routes the step through `allocStepLTexts` (Task 7's walker) will materialize a real key. If the user types into the subtitle textarea before that happens, `setI18nValue` writes to the empty key — that's a transient state cleared on the next `allocStepLTexts` call. For correctness, the alternative is to expose a store mutator that allocates inline; but the simpler seed-then-realloc shape matches what `send_message` already does on insert and we keep behavioral parity here.

If you want the cleaner path: after the existing `addElementStep` / `replaceElementStep` / `addCommandStep` calls already re-run `allocStepLTexts`, simply calling `onChange({ ...action, subtitle: { key: UNALLOCATED_LTEXT_KEY } })` here is enough — the parent (`StepEditor`) forwards through one of those mutators on its next `onChange`, which re-runs the walker. Import `UNALLOCATED_LTEXT_KEY` from `@/features/flow/defaults` and use it instead of `{ key: "" as never }` for clarity.

- [ ] **Step 5: Type-check**

Run: `cd editor; rtk tsc --noEmit`
Expected: error in `transform.ts` is the only remaining one (fixed in Task 9).

- [ ] **Step 6: Build the editor and verify in the UI**

Run: `cd editor; npm run dev` (background)
Use `/browse` to open `http://localhost:5173/`, navigate to a menu's element with a click handler, add a `show_title` action, type a title, toggle a subtitle, edit timings. Verify:
- Title text persists on language switch.
- Subtitle toggle button works (add/remove).
- Timing inputs are blank by default, accept integers.
- The pseudocode view shows `title: "<your text>"` on the action row.

- [ ] **Step 7: Run editor test suite (regression)**

Run: `cd editor; npx vitest run`
Expected: all tests PASS.

- [ ] **Step 8: Commit**

```bash
rtk git add editor/src/features/canvas/properties/ActionEditor.tsx editor/src/locales/en.ts editor/src/locales/fr.ts
rtk git commit -m "feat(editor): add ShowTitleEditor form with i18n title + optional subtitle + timings"
```

---

## Task 9: Editor — YAML serializer + validate walker (TDD)

**Files:**
- Modify: `editor/src/features/export/transform.ts`
- Modify: `editor/src/features/export/transform.test.ts`
- Modify: `editor/src/features/export/validate.ts`
- Modify: `editor/src/features/export/validate.test.ts`

- [ ] **Step 1: Write the failing serializer test**

Add to `editor/src/features/export/transform.test.ts`. Use the existing `serializes send_message …` test (around line 174) as a template — model an element whose left-click has both a `send_message` and a `show_title` step, then assert the serialized YAML:

```ts
  it("serializes show_title with i18n refs, optional subtitle, and timing fields", () => {
    const pack = makePack({
      menus: [
        {
          id: "shop",
          layers: [{ elements: [{
            id: "btn",
            appearances: [{
              click: {
                left: {
                  steps: [
                    {
                      kind: "action",
                      action: {
                        type: "show_title",
                        title:    { key: "menus.shop.elements.btn.default.click.left.show_title" as I18nKey },
                        subtitle: { key: "menus.shop.elements.btn.default.click.left.show_subtitle" as I18nKey },
                        fadeIn: 5,
                        stay: 40,
                        fadeOut: 15,
                      },
                    },
                  ],
                },
              },
            }],
          }] }],
        },
      ],
    });
    pack.i18nKeys["menus.shop.elements.btn.default.click.left.show_title" as I18nKey] = { en: "Hi" };
    pack.i18nKeys["menus.shop.elements.btn.default.click.left.show_subtitle" as I18nKey] = { en: "sub" };
    const yaml = transformPackToYaml(pack);  // or whatever the existing helper is
    const action = yaml.menus[0].layers[0].elements[0].appearances[0].click.left.steps[0].action;
    expect(action.type).toBe("show_title");
    expect(action.title).toBe("{i18n:menus.shop.elements.btn.default.click.left.show_title}");
    expect(action.subtitle).toBe("{i18n:menus.shop.elements.btn.default.click.left.show_subtitle}");
    expect(action.fade_in).toBe(5);
    expect(action.stay).toBe(40);
    expect(action.fade_out).toBe(15);
  });

  it("omits show_title subtitle and timing fields when undefined", () => {
    const pack = makePack({
      menus: [{
        id: "shop",
        layers: [{ elements: [{
          id: "btn",
          appearances: [{
            click: {
              left: { steps: [{
                kind: "action",
                action: { type: "show_title", title: { key: "k" as I18nKey } },
              }] },
            },
          }],
        }] }],
      }],
    });
    pack.i18nKeys["k" as I18nKey] = { en: "Hi" };
    const yaml = transformPackToYaml(pack);
    const action = yaml.menus[0].layers[0].elements[0].appearances[0].click.left.steps[0].action;
    expect(action.title).toBe("{i18n:k}");
    expect(action).not.toHaveProperty("subtitle");
    expect(action).not.toHaveProperty("fade_in");
    expect(action).not.toHaveProperty("stay");
    expect(action).not.toHaveProperty("fade_out");
  });
```

(Use the actual existing helper name — check the top of `transform.test.ts` for `makePack` and the existing export function name.)

- [ ] **Step 2: Run tests, confirm they fail**

Run: `cd editor; npx vitest run src/features/export/transform.test.ts`
Expected: 2 new failures — `serializeAction` doesn't yet handle `show_title`.

- [ ] **Step 3: Add the `show_title` case in `serializeAction`**

Edit `editor/src/features/export/transform.ts`. In `serializeAction` (around line 54), insert after the `case "send_message"` block:

```ts
    case "show_title": {
      const out: Record<string, unknown> = { type: "show_title", title: i18nRef(action.title.key) };
      if (action.subtitle) out.subtitle = i18nRef(action.subtitle.key);
      if (action.fadeIn  !== undefined) out.fade_in  = action.fadeIn;
      if (action.stay    !== undefined) out.stay     = action.stay;
      if (action.fadeOut !== undefined) out.fade_out = action.fadeOut;
      return out;
    }
```

- [ ] **Step 4: Extend the LText key collector at the bottom of `transform.ts`**

The function around lines 460–500 walks the pack to collect referenced LText keys for the lang YAML emit. Extend the three `if (action.type === "send_message")` branches (lines 468, 478, 495):

```ts
                if (action.type === "send_message") keys.add(action.text.key);
                else if (action.type === "show_title") {
                  keys.add(action.title.key);
                  if (action.subtitle) keys.add(action.subtitle.key);
                }
```

(Apply to all three sites in this file: element click handlers, commands, dialog buttons.)

- [ ] **Step 5: Run transform tests, confirm they pass**

Run: `cd editor; npx vitest run src/features/export/transform.test.ts`
Expected: PASS.

- [ ] **Step 6: Write failing test for `validate.ts`**

Add to `editor/src/features/export/validate.test.ts` (pattern off `validates send_message keys in element click handlers` at line ~97):

```ts
  it("validates show_title title and subtitle keys in element click handlers", () => {
    const pack = makePack({
      menus: [{
        id: "shop",
        layers: [{ elements: [{
          id: "btn",
          appearances: [{
            click: {
              left: { steps: [{
                kind: "action",
                action: {
                  type: "show_title",
                  title:    { key: "menus.shop.elements.btn.default.click.left.show_title" as I18nKey },
                  subtitle: { key: "menus.shop.elements.btn.default.click.left.show_subtitle" as I18nKey },
                },
              }] },
            },
          }],
        }] }],
      }],
    });
    // Intentionally omit the keys from i18nKeys to trigger the validation error.
    const result = validateForExport(pack);  // or whatever the existing helper is named
    expect(result.errors.some((e) => e.includes("menus.shop.elements.btn.default.click.left.show_title"))).toBe(true);
    expect(result.errors.some((e) => e.includes("menus.shop.elements.btn.default.click.left.show_subtitle"))).toBe(true);
  });
```

- [ ] **Step 7: Extend `validate.ts` walker**

Edit `editor/src/features/export/validate.ts`. Replace each `if (action.type === "send_message") referencedKeys.add(action.text.key);` line (3 sites — element handlers, command steps, dialog buttons) with:

```ts
                if (action.type === "send_message") referencedKeys.add(action.text.key);
                else if (action.type === "show_title") {
                  referencedKeys.add(action.title.key);
                  if (action.subtitle) referencedKeys.add(action.subtitle.key);
                }
```

- [ ] **Step 8: Run validate tests, confirm they pass**

Run: `cd editor; npx vitest run src/features/export/validate.test.ts`
Expected: PASS.

- [ ] **Step 9: Type-check + full editor test suite**

Run: `cd editor; rtk tsc --noEmit`
Expected: no errors.

Run: `cd editor; npx vitest run`
Expected: all tests PASS.

- [ ] **Step 10: Commit**

```bash
rtk git add editor/src/features/export/transform.ts editor/src/features/export/transform.test.ts editor/src/features/export/validate.ts editor/src/features/export/validate.test.ts
rtk git commit -m "feat(editor): serialize show_title to YAML and validate its LText keys"
```

---

## Task 10: End-to-end smoke check (manual)

This is a sanity check, not a TDD step. The plugin and editor are now wired; this verifies the YAML round-trip works against the live stack.

**Files:** none modified.

- [ ] **Step 1: Build both sides**

Run: `cd plugin; ./gradlew test shadowJar`
Expected: BUILD SUCCESSFUL, `plugin/build/libs/artisan-plugin-1.0.0-SNAPSHOT-all.jar` exists.

Run: `cd editor; npm run build`
Expected: clean build, no TS errors.

- [ ] **Step 2: Boot the Docker stack**

Run: `docker compose up -d`
Wait for backend, editor, minecraft to be ready (check `docker compose logs minecraft` for "Done").

- [ ] **Step 3: Edit a menu with `/browse`, add a `show_title` action on click, publish**

Open the editor at `http://localhost:5173/`. On any menu element, add a `show_title` step on `left` click:
- Title: `<gold>Test title from editor`
- Subtitle: `<gray>and a subtitle`
- fadeIn 5, stay 40, fadeOut 10.

Save / publish via the existing flow.

- [ ] **Step 4: Trigger in-game**

Connect to the Minecraft server at `localhost:25565`, open the menu, click the slot. Confirm the title and subtitle render with the right timings and that MiniMessage formatting (`<gold>` etc.) is applied.

- [ ] **Step 5: Verify language switching**

Change the player's selected lang via whatever mechanism exists in the project (or set a non-default `defaultLang` in the pack), re-trigger the click, and confirm the title text follows the active language (or falls back to `defaultLang`).

- [ ] **Step 6: Update `CLAUDE.md` test counts and the "Plan" entry**

The new tests bump:
- Plugin: ~352 → ~356 (4 new — 4 parser + 3 executor minus the one that was a smoke test? Recount actual passing tests after Task 3 Step 5 and use that.)
- Editor: 706 → 706 + (new tests written across Tasks 7–9; recount).

Edit the "Tests — ce qui est couvert" table in `CLAUDE.md` accordingly.

- [ ] **Step 7: Commit the docs bump**

```bash
rtk git add CLAUDE.md
rtk git commit -m "docs(claude.md): bump test counts after show_title action"
```

---

## Test Coverage Summary

| Layer | New tests |
|---|---|
| `ActionParserTest.kt` | 4 (`parse show_title` minimal / with subtitle + timings / numeric Long ticks / missing title throws) |
| `ActionExecutorTest.kt` | 3 (`executeOne show_title` basic / resolves i18n / null subtitle) |
| `i18nKeys.test.ts` | 6 (`showTitleKeyAt`/`showSubtitleKeyAt` index 0 + > 0; `rekeyCommandLTexts` on show_title; independent counters) |
| `accountStore.test.ts` | 1 (`addElementStep` allocates show_title + show_subtitle) |
| `transform.test.ts` | 2 (serializer with full fields; serializer omits optional fields) |
| `validate.test.ts` | 1 (dangling show_title keys flagged) |

Total: 17 new tests.

---

## Out of scope (do not include in this plan)

- **Title fonts / per-line layouts.** The MC HUD title is a single-line component; multi-line composition (like the menu-title composer) is not in scope.
- **`broadcast_title`** (server-wide). If needed later, mirror this design with `audience = Bukkit.getServer()`.
- **`clear_title` / `reset_title` actions.** Adventure exposes `clearTitle()` and `resetTitle()`; not requested.
- **PAPI placeholders in timing fields.** Timings are static integers; expression DSL on timings is not in scope.
- **YAML migration of legacy hand-written packs.** `migrateStepsI18n` (Task 7 Step 11) covers the case where someone hand-wrote `show_title` with plain strings, but auto-formatting / linting older packs to add timings is out of scope.
