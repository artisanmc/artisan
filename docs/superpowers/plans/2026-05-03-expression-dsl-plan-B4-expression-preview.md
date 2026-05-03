# Expression DSL — Plan B4: Expression preview

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a small "preview" line under the expression condition's editor (both form and freetext modes) that shows whether the current expression parses successfully, and — when parseable — its evaluated result against an empty scope. This gives admins immediate syntax feedback while typing, without yet wiring the full Menu.sampleContext-driven preview (deferred to a later plan).

**Architecture:** A new `<ExpressionPreview>` component takes the expression string and renders one of three states:
1. Empty input → render nothing (don't badger the user before they've typed anything)
2. Parse error → red "syntax error: <message>" line
3. Valid → green "→ <result>" line (eval with empty Scope, undefined identifiers acceptable)

Mounted inside `ExpressionConditionField` (built in Plan B2), as a sibling under both the form-mode wrapper and freetext-mode wrapper.

**Tech Stack:** React 19, existing DSL parser (`web/src/lib/expr/parser.ts`), evaluator (`web/src/lib/expr/evaluator.ts`), coercion (`web/src/lib/expr/coercion.ts`), Scope (`web/src/lib/expr/scope.ts`). No new dependencies.

**Spec reference:** `docs/superpowers/specs/2026-05-03-expression-dsl-design.md` §4.4 (Live preview + sample context). This plan covers the parse-validation slice only; lore/title live-preview using `renderTemplate` with full scope inference is deferred.

**Out of scope (subsequent plans):**
- Live preview of LText fields (lore, title, send_message text) using `renderTemplate`
- Scope inference from Menu.contextInputs + Element.iterates
- Multi-iteration preview (3 instances side-by-side)
- Autocomplete on `{` / `.` / `%`
- Plain-language error messages (current errors are passable but technical)

---

## File Structure

```
web/src/features/canvas/properties/
├── ExpressionPreview.tsx            # NEW — the small preview line
├── ExpressionPreview.test.ts        # NEW — unit tests on the eval-and-format helper
└── ExpressionConditionField.tsx     # Modify — render <ExpressionPreview> under form + freetext

web/src/locales/
├── en.ts                            # New keys: conditions.exprPreviewValid, exprPreviewParseError
└── fr.ts                            # Same keys, French
```

---

## Task 1: ExpressionPreview component + tests

**Files:**
- Create: `web/src/features/canvas/properties/ExpressionPreview.tsx`
- Create: `web/src/features/canvas/properties/ExpressionPreview.test.ts`

- [ ] **Step 1: Write failing tests for the format helper**

```typescript
// web/src/features/canvas/properties/ExpressionPreview.test.ts
import { describe, expect, it } from "vitest";
import { computeExpressionPreview } from "./ExpressionPreview";

describe("computeExpressionPreview", () => {
  it("returns null for empty input", () => {
    expect(computeExpressionPreview("")).toBeNull();
    expect(computeExpressionPreview("   ")).toBeNull();
  });

  it("returns parse-error state on invalid syntax", () => {
    expect(computeExpressionPreview("a !! b")).toEqual({
      kind: "parseError",
      message: expect.stringContaining("Unexpected token"),
    });
  });

  it("returns ok state with the evaluated string for a literal", () => {
    expect(computeExpressionPreview("42")).toEqual({ kind: "ok", display: "42" });
  });

  it("returns ok state with quotes preserved for string literals", () => {
    expect(computeExpressionPreview('"hello"')).toEqual({ kind: "ok", display: "hello" });
  });

  it("evaluates ternary against empty scope", () => {
    expect(computeExpressionPreview("true ? 1 : 2")).toEqual({ kind: "ok", display: "1" });
  });

  it("renders undefined identifiers as empty string", () => {
    // x is unbound in empty scope → undefined → toStringValue → ""
    expect(computeExpressionPreview("x")).toEqual({ kind: "ok", display: "" });
  });

  it("evaluates a comparison to its boolean result", () => {
    expect(computeExpressionPreview("5 > 3")).toEqual({ kind: "ok", display: "true" });
  });

  it("evaluates list method calls if the operand resolves", () => {
    // xs unbound → null → .length on null → 0 (per coercion rules)
    expect(computeExpressionPreview("xs.length()")).toEqual({ kind: "ok", display: "0" });
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
cd web && npm test -- ExpressionPreview.test --run
```

Expected: import errors.

- [ ] **Step 3: Implement the component + helper**

```typescript
// web/src/features/canvas/properties/ExpressionPreview.tsx
import { toStringValue } from "@/lib/expr/coercion";
import { ParseError } from "@/lib/expr/errors";
import { evaluate } from "@/lib/expr/evaluator";
import { parse } from "@/lib/expr/parser";
import { Scope } from "@/lib/expr/scope";
import { useTranslation } from "react-i18next";

export type PreviewState =
  | { kind: "ok"; display: string }
  | { kind: "parseError"; message: string };

/**
 * Pure helper exposed for testing. Returns null for empty/whitespace
 * input (caller should render nothing). Otherwise returns either an
 * "ok" state with the evaluated value as a display string, or a
 * "parseError" with the parser's message.
 *
 * Evaluation runs against an empty Scope — unbound identifiers resolve
 * to undefined and propagate per the coercion rules. This lets the user
 * see syntax-level feedback without us having to plumb the menu's full
 * sampleContext + contextInputs through (deferred to a later plan).
 */
export function computeExpressionPreview(expr: string): PreviewState | null {
  const trimmed = expr.trim();
  if (trimmed === "") return null;
  try {
    const ast = parse(trimmed);
    const value = evaluate(ast, new Scope({}));
    return { kind: "ok", display: toStringValue(value) };
  } catch (e) {
    if (e instanceof ParseError) {
      return { kind: "parseError", message: e.message };
    }
    return { kind: "parseError", message: (e as Error).message };
  }
}

interface ExpressionPreviewProps {
  expr: string;
}

export function ExpressionPreview({ expr }: ExpressionPreviewProps) {
  const { t } = useTranslation();
  const state = computeExpressionPreview(expr);
  if (state === null) return null;
  if (state.kind === "parseError") {
    return (
      <div className="text-[10px] text-rose-300">
        {t("conditions.exprPreviewParseError", { message: state.message })}
      </div>
    );
  }
  return (
    <div className="font-mono text-[10px] text-emerald-300">
      {t("conditions.exprPreviewValid", { display: state.display || '""' })}
    </div>
  );
}
```

- [ ] **Step 4: Run tests, all pass**

```bash
cd web && npm test -- ExpressionPreview.test --run
```

- [ ] **Step 5: Biome + commit**

```bash
cd web && ./node_modules/.bin/biome check src/features/canvas/properties/ExpressionPreview.tsx src/features/canvas/properties/ExpressionPreview.test.ts
git add web/src/features/canvas/properties/ExpressionPreview.tsx web/src/features/canvas/properties/ExpressionPreview.test.ts
git commit -m "feat(editor): add ExpressionPreview component with parse status and result"
```

---

## Task 2: i18n keys

**Files:**
- Modify: `web/src/locales/en.ts`
- Modify: `web/src/locales/fr.ts`

- [ ] **Step 1: Add keys in en.ts**

In the `conditions:` block, after the existing `exprFormModeShort` key (added in Plan B2), append:

```typescript
    exprPreviewValid: "→ {{display}}",
    exprPreviewParseError: "syntax: {{message}}",
```

- [ ] **Step 2: Add keys in fr.ts**

```typescript
    exprPreviewValid: "→ {{display}}",
    exprPreviewParseError: "syntaxe : {{message}}",
```

- [ ] **Step 3: Verify and commit**

```bash
cd web && npx tsc --noEmit
cd web && ./node_modules/.bin/biome check src/locales/en.ts src/locales/fr.ts
git add web/src/locales/en.ts web/src/locales/fr.ts
git commit -m "feat(editor): add i18n keys for ExpressionPreview"
```

---

## Task 3: Wire ExpressionPreview into ExpressionConditionField

**Files:**
- Modify: `web/src/features/canvas/properties/ExpressionConditionField.tsx`

- [ ] **Step 1: Add the import at the top of the file**

```typescript
import { ExpressionPreview } from "./ExpressionPreview";
```

- [ ] **Step 2: Wrap freetext mode return**

The current freetext-mode return is a single `<div className="flex items-center gap-1">` with the input + toggle button. Wrap it in a fragment with the preview underneath:

Replace:

```typescript
  if (mode === "freetext") {
    return (
      <div className="flex items-center gap-1">
        <Input ... />
        <button ... />
      </div>
    );
  }
```

with:

```typescript
  if (mode === "freetext") {
    return (
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-1">
          <Input
            placeholder={t("conditions.exprPlaceholder")}
            value={expr}
            onChange={(e) => onChange(e.target.value)}
            className="h-6 w-[200px] px-1.5 py-0 font-mono text-[11px]"
          />
          <button
            type="button"
            onClick={switchToForm}
            title={t("conditions.exprFormMode")}
            className="rounded px-1 text-[9px] uppercase text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
          >
            {t("conditions.exprFormModeShort")}
          </button>
        </div>
        <ExpressionPreview expr={expr} />
      </div>
    );
  }
```

- [ ] **Step 3: Wrap form mode return**

Same shape — wrap the existing form return in a column flex with the preview underneath:

Replace the form-mode return body with:

```typescript
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1">
        <Input
          placeholder={t("conditions.exprFormLeftPlaceholder")}
          value={parts.left}
          onChange={(e) => updateParts({ ...parts, left: e.target.value })}
          className="h-6 w-[100px] px-1.5 py-0 font-mono text-[11px]"
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-200 hover:bg-zinc-700"
            >
              {parts.op}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="border-zinc-700 bg-zinc-900 text-zinc-200">
            {COMPARISON_OPS.map((op) => (
              <DropdownMenuItem
                key={op}
                onSelect={() => updateParts({ ...parts, op: op as ComparisonOp })}
                className="cursor-pointer font-mono text-[11px] focus:bg-zinc-800"
              >
                {op}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <Input
          placeholder={t("conditions.exprFormRightPlaceholder")}
          value={parts.right}
          onChange={(e) => updateParts({ ...parts, right: e.target.value })}
          className="h-6 w-[100px] px-1.5 py-0 font-mono text-[11px]"
        />
        <button
          type="button"
          onClick={switchToFreetext}
          title={t("conditions.exprFreeTextMode")}
          className="rounded px-1 text-[9px] uppercase text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
        >
          {t("conditions.exprFreeTextModeShort")}
        </button>
      </div>
      <ExpressionPreview expr={expr} />
    </div>
  );
```

- [ ] **Step 4: Verify TS, tests, biome**

```bash
cd web && npx tsc --noEmit
cd web && npm test -- --run 2>&1 | tail -5
cd web && ./node_modules/.bin/biome check src/features/canvas/properties/ExpressionConditionField.tsx
```

Expected: 272 + 8 (Task 1's tests) = 280 tests pass.

- [ ] **Step 5: Commit**

```bash
git add web/src/features/canvas/properties/ExpressionConditionField.tsx
git commit -m "feat(editor): show ExpressionPreview under ExpressionConditionField"
```

---

## Task 4: Manual smoke test

- [ ] **Step 1: Start dev server**

```bash
cd web && npm run dev
```

- [ ] **Step 2: Add an expression condition, observe preview**

Pick a menu → element → conditions chip area. Add an expression condition. Type `5 > 3` in the form. Below the form should appear `→ true` in green monospace.

- [ ] **Step 3: Test parse error feedback**

Type `5 ?? 3` (invalid). Below should appear `syntax: <message>` in red.

- [ ] **Step 4: Test empty state**

Clear all parts. Verify the preview line disappears.

- [ ] **Step 5: Test freetext mode**

Switch to freetext mode. Type `quest.tag == "weapon"`. Preview shows `→ false` (because `quest.tag` is unbound → undefined; `looseEq(undefined, "weapon")` is false).

- [ ] **Step 6: Stop dev server**

`Ctrl+C`.

---

## What ships at the end of Plan B4

- A small green/red preview line under expression condition editors showing parse status and (when valid) the evaluated result against an empty scope
- 8 new unit tests on the parse+eval+format helper
- Localized en/fr

## What does NOT ship (subsequent plans)

- Live preview of LText fields (lore, title) — needs scope inference + renderTemplate wiring
- Live preview that uses Menu.sampleContext + contextInputs — needs default-data-unification work first
- Multi-iteration preview
- Autocomplete on `{` / `.` / `%`
