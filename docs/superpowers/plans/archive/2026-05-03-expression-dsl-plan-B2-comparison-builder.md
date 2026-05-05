# Expression DSL — Plan B2: Comparison form builder for expression conditions

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the raw `<Input>` editor for `expression` conditions (shipped in Plan B1) with a structured `<ExpressionComparisonBuilder>` form (left operand + operator dropdown + right operand). For non-comparison expressions (ternary, method calls, &&/||, etc.) the form falls back to a raw text input — gated by a "Free text" toggle and chosen automatically when round-trip parsing detects the expression doesn't fit the form shape.

**Architecture:** Build on top of the existing DSL parser and AST shipped in Plan A. A new helper `tryParseAsComparison(expr) → { left, op, right } | null` walks the parsed AST: if the root node is a `BinaryOp` with one of the 6 comparison operators (`==`, `!=`, `<`, `<=`, `>`, `>=`) and both sides serialize to single-line strings, return the parts; otherwise return null. The form builder serializes back to a string on every edit (`${left} ${op} ${right}`). When `null` is returned the form auto-switches to "Free text" mode showing the raw input we shipped in B1. This avoids any new parser/evaluator code — purely UI on top of the existing engine.

**Tech Stack:** React 19, existing shadcn primitives (`<Input>`, `<DropdownMenu>`), DSL parser at `web/src/lib/expr/parser.ts`, AST types at `web/src/lib/expr/ast.ts`. No new dependencies.

**Spec reference:** `docs/superpowers/specs/2026-05-03-expression-dsl-design.md` §4.10 (form-only Expression fields). This plan covers comparison builders only — ternary builder, AND/OR composition, method-call picker are deferred to subsequent plans (B2.x or later).

**Out of scope:**
- Ternary builder (`a ? b : c`)
- AND/OR composition (`a && b || c`)
- Method-call picker (`xs.join(", ")`, `xs.length()`, etc.)
- Wiring into `set_arg.value` / `set_arg_cycle_*.list` (those still use raw inputs from Plan B1; can reuse the same builder later)
- Patterns gallery, toolbar buttons, autocomplete, live preview (Plans B3-B5)

---

## File Structure

```
web/src/features/canvas/properties/
├── ConditionListEditor.tsx          # Replace expression case in ConditionInline with ExpressionConditionField
└── ExpressionConditionField.tsx     # NEW — wraps form vs free-text modes; uses tryParseAsComparison

web/src/lib/expr/
└── tryParseAsComparison.ts          # NEW — AST shape detector + serializer helpers
└── tryParseAsComparison.test.ts     # NEW — unit tests for round-trip detection

web/src/locales/
├── en.ts                            # New keys: conditions.exprForm{Left,Op,Right}Placeholder, conditions.exprFreeTextMode, conditions.exprFormMode
└── fr.ts                            # Same keys, French
```

No changes to the DSL parser/evaluator — pure UI consumer.

---

## Task 1: tryParseAsComparison helper

**Files:**
- Create: `web/src/lib/expr/tryParseAsComparison.ts`
- Create: `web/src/lib/expr/tryParseAsComparison.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// web/src/lib/expr/tryParseAsComparison.test.ts
import { describe, expect, it } from "vitest";
import {
  COMPARISON_OPS,
  serializeComparison,
  tryParseAsComparison,
} from "./tryParseAsComparison";

describe("tryParseAsComparison", () => {
  it("detects a simple == comparison between identifiers", () => {
    expect(tryParseAsComparison("quest.tag == \"weapon\"")).toEqual({
      left: "quest.tag",
      op: "==",
      right: '"weapon"',
    });
  });

  it("detects each of the 6 comparison operators", () => {
    for (const op of ["==", "!=", "<", "<=", ">", ">="] as const) {
      expect(tryParseAsComparison(`a ${op} b`)).toEqual({ left: "a", op, right: "b" });
    }
  });

  it("returns null for ternary expressions", () => {
    expect(tryParseAsComparison("a > b ? 1 : 2")).toBeNull();
  });

  it("returns null for &&/|| expressions", () => {
    expect(tryParseAsComparison("a > b && c < d")).toBeNull();
  });

  it("returns null for arithmetic-only expressions (no compare op at root)", () => {
    expect(tryParseAsComparison("a + b")).toBeNull();
  });

  it("returns null for unparseable / empty input", () => {
    expect(tryParseAsComparison("")).toBeNull();
    expect(tryParseAsComparison("not !valid syntax @@")).toBeNull();
  });

  it("handles paths with dots and method calls on either side", () => {
    expect(tryParseAsComparison("quest.tags.length() > 0")).toEqual({
      left: "quest.tags.length()",
      op: ">",
      right: "0",
    });
  });

  it("preserves quoted-string literals in the right operand", () => {
    expect(tryParseAsComparison(`%player_world% == "lobby"`)).toEqual({
      left: "%player_world%",
      op: "==",
      right: '"lobby"',
    });
  });
});

describe("serializeComparison", () => {
  it("joins parts with spaces around the operator", () => {
    expect(serializeComparison({ left: "a", op: "==", right: "b" })).toBe("a == b");
  });

  it("returns empty string when any part is empty (caller's job to validate before save)", () => {
    expect(serializeComparison({ left: "", op: "==", right: "b" })).toBe("");
    expect(serializeComparison({ left: "a", op: "==", right: "" })).toBe("");
  });
});

describe("COMPARISON_OPS constant", () => {
  it("lists all 6 comparison operators", () => {
    expect(COMPARISON_OPS).toEqual(["==", "!=", "<", "<=", ">", ">="]);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
cd web && npm test -- tryParseAsComparison.test --run
```

Expected: all fail with import errors.

- [ ] **Step 3: Implement the helper**

```typescript
// web/src/lib/expr/tryParseAsComparison.ts
import type { AstNode } from "./ast";
import { parse } from "./parser";

export const COMPARISON_OPS = ["==", "!=", "<", "<=", ">", ">="] as const;
export type ComparisonOp = (typeof COMPARISON_OPS)[number];

export interface Comparison {
  left: string;
  op: ComparisonOp;
  right: string;
}

const isComparisonOp = (op: string): op is ComparisonOp =>
  (COMPARISON_OPS as readonly string[]).includes(op);

/**
 * Walk a node and reproduce its source-text representation. Used to
 * convert each side of a comparison back to a string for the form
 * builder. We don't preserve the original source spans (ASTs strip
 * whitespace), so we re-emit canonical formatting.
 *
 * Limited to shapes that round-trip cleanly. If a shape isn't covered,
 * returns null and the caller falls back to free-text mode.
 */
function serializeNode(node: AstNode): string | null {
  switch (node.kind) {
    case "literal":
      if (node.value === null) return "null";
      if (typeof node.value === "string") return `"${node.value.replace(/"/g, '\\"')}"`;
      return String(node.value);
    case "identifier":
      return node.name;
    case "papi":
      return `%${node.placeholder}%`;
    case "path": {
      const target = serializeNode(node.target);
      return target === null ? null : `${target}.${node.field}`;
    }
    case "index": {
      const target = serializeNode(node.target);
      const index = serializeNode(node.index);
      return target === null || index === null ? null : `${target}[${index}]`;
    }
    case "method": {
      const target = serializeNode(node.target);
      if (target === null) return null;
      const args: string[] = [];
      for (const a of node.args) {
        const s = serializeNode(a);
        if (s === null) return null;
        args.push(s);
      }
      return `${target}.${node.method}(${args.join(", ")})`;
    }
    // ternary / unary / nested binary: too complex for the form, bail
    default:
      return null;
  }
}

/**
 * Try to interpret `expr` as a top-level comparison `<left> <op> <right>`.
 * Returns null when the expression is empty, unparseable, or shaped
 * differently (ternary, AND/OR, raw arithmetic, etc.).
 *
 * Both sides must serialize cleanly via serializeNode — this guarantees
 * the form will round-trip the user's input without losing information.
 */
export function tryParseAsComparison(expr: string): Comparison | null {
  const trimmed = expr.trim();
  if (trimmed === "") return null;
  let ast: AstNode;
  try {
    ast = parse(trimmed);
  } catch {
    return null;
  }
  if (ast.kind !== "binary") return null;
  if (!isComparisonOp(ast.op)) return null;
  const left = serializeNode(ast.left);
  const right = serializeNode(ast.right);
  if (left === null || right === null) return null;
  return { left, op: ast.op, right };
}

export function serializeComparison(c: Comparison): string {
  if (c.left.trim() === "" || c.right.trim() === "") return "";
  return `${c.left} ${c.op} ${c.right}`;
}
```

- [ ] **Step 4: Run tests, verify all pass**

```bash
cd web && npm test -- tryParseAsComparison.test --run
```

- [ ] **Step 5: Biome + commit**

```bash
cd web && ./node_modules/.bin/biome check src/lib/expr/tryParseAsComparison.ts src/lib/expr/tryParseAsComparison.test.ts
git add web/src/lib/expr/tryParseAsComparison.ts web/src/lib/expr/tryParseAsComparison.test.ts
git commit -m "feat(expr): add tryParseAsComparison roundtrip detector"
```

---

## Task 2: ExpressionConditionField component

**Files:**
- Create: `web/src/features/canvas/properties/ExpressionConditionField.tsx`

- [ ] **Step 1: Write the component**

```typescript
// web/src/features/canvas/properties/ExpressionConditionField.tsx
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  COMPARISON_OPS,
  type Comparison,
  type ComparisonOp,
  serializeComparison,
  tryParseAsComparison,
} from "@/lib/expr/tryParseAsComparison";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

interface ExpressionConditionFieldProps {
  expr: string;
  onChange: (expr: string) => void;
}

type Mode = "form" | "freetext";

/**
 * Inline editor for an `expression` condition's `expr` field. Two modes:
 *
 *  - "form"     : 3 inputs (left / op dropdown / right). Default when
 *                 the current `expr` parses cleanly as a comparison.
 *                 Edits serialize back to a string immediately.
 *  - "freetext" : a single monospace input (same UX as Plan B1). Used
 *                 when the user picks complex shapes (ternary, &&, etc.)
 *                 or explicitly toggles. Auto-detected from `expr`.
 *
 * The mode toggle is a small button rendered next to the form. Switching
 * mode never destroys content — going from form to freetext keeps the
 * serialized comparison; going from freetext to form re-runs detection
 * and falls back to form's empty defaults if the freetext doesn't fit.
 */
export function ExpressionConditionField({ expr, onChange }: ExpressionConditionFieldProps) {
  const { t } = useTranslation();
  const detected = tryParseAsComparison(expr);
  const [mode, setMode] = useState<Mode>(detected ? "form" : "freetext");
  const [parts, setParts] = useState<Comparison>(
    detected ?? { left: "", op: "==", right: "" },
  );

  // When the upstream `expr` changes (e.g. another field edit somewhere
  // updates the parent state), re-detect and reset our local form parts.
  useEffect(() => {
    const d = tryParseAsComparison(expr);
    if (d && mode === "form") setParts(d);
  }, [expr, mode]);

  const updateParts = (next: Comparison) => {
    setParts(next);
    onChange(serializeComparison(next));
  };

  const switchToFreetext = () => setMode("freetext");
  const switchToForm = () => {
    const d = tryParseAsComparison(expr);
    if (d) setParts(d);
    else setParts({ left: "", op: "==", right: "" });
    setMode("form");
    if (!d) onChange("");
  };

  if (mode === "freetext") {
    return (
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
    );
  }

  return (
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
  );
}
```

- [ ] **Step 2: Verify TS, biome (no tests for this component — covered by smoke test in Task 5)**

```bash
cd web && npx tsc --noEmit
cd web && ./node_modules/.bin/biome check src/features/canvas/properties/ExpressionConditionField.tsx
```

- [ ] **Step 3: Commit**

```bash
git add web/src/features/canvas/properties/ExpressionConditionField.tsx
git commit -m "feat(editor): add ExpressionConditionField with form/freetext modes"
```

---

## Task 3: Add i18n keys

**Files:**
- Modify: `web/src/locales/en.ts`
- Modify: `web/src/locales/fr.ts`

- [ ] **Step 1: Add keys in en.ts**

In `web/src/locales/en.ts`, find the `conditions:` block. The `exprPlaceholder` key was added in Plan B1. After it, insert:

```typescript
    exprFormLeftPlaceholder: "quest.tag",
    exprFormRightPlaceholder: "\"weapon\"",
    exprFreeTextMode: "Switch to free text",
    exprFreeTextModeShort: "raw",
    exprFormMode: "Switch to form",
    exprFormModeShort: "form",
```

- [ ] **Step 2: Add keys in fr.ts**

```typescript
    exprFormLeftPlaceholder: "quest.tag",
    exprFormRightPlaceholder: "\"weapon\"",
    exprFreeTextMode: "Passer en mode libre",
    exprFreeTextModeShort: "libre",
    exprFormMode: "Passer en mode form",
    exprFormModeShort: "form",
```

- [ ] **Step 3: Verify and commit**

```bash
cd web && npx tsc --noEmit
cd web && ./node_modules/.bin/biome check src/locales/
git add web/src/locales/en.ts web/src/locales/fr.ts
git commit -m "feat(editor): add i18n keys for ExpressionConditionField"
```

---

## Task 4: Wire into ConditionListEditor

**Files:**
- Modify: `web/src/features/canvas/properties/ConditionListEditor.tsx`

- [ ] **Step 1: Replace the expression case in ConditionInline**

Find the `case "expression":` branch in the `ConditionInline` function (added in Plan B1, around line 344). Replace its body with:

```typescript
    case "expression":
      return (
        <ExpressionConditionField
          expr={condition.expr}
          onChange={(expr) => onChange({ ...condition, expr })}
        />
      );
```

- [ ] **Step 2: Add the import at the top of the file**

Find the existing imports at the top of `ConditionListEditor.tsx`. Add:

```typescript
import { ExpressionConditionField } from "./ExpressionConditionField";
```

- [ ] **Step 3: Verify TS, tests, biome**

```bash
cd web && npx tsc --noEmit
cd web && npm test -- --run
cd web && ./node_modules/.bin/biome check src/features/canvas/properties/ConditionListEditor.tsx
```

Expected: 257+ tests pass (Task 1's unit tests added some — should be 262-265).

- [ ] **Step 4: Commit**

```bash
git add web/src/features/canvas/properties/ConditionListEditor.tsx
git commit -m "feat(editor): use ExpressionConditionField in ConditionListEditor"
```

---

## Task 5: Manual smoke test

**Files:** None modified.

- [ ] **Step 1: Start the dev server**

```bash
cd web && npm run dev
```

Open `http://localhost:5173/` in a browser.

- [ ] **Step 2: Test new condition (form mode default)**

Navigate to a menu → Element → conditions area. Click `+ Add` and select **expression (advanced)**. Verify the chip shows the new form: `[empty input] [== ▾] [empty input]`. Verify each part is editable.

- [ ] **Step 3: Test mode switching**

Click the `raw` button at the right of the form. Verify it switches to a single text input showing the serialized expression (e.g., `quest.tag == "weapon"` if you typed values). Click `form` to switch back. Verify the form re-populates from the text.

- [ ] **Step 4: Test fallback for complex expressions**

In free-text mode, type a ternary like `quest.gold > 1000 ? "rich" : "poor"`. Click `form`. Verify the form goes empty (no comparison shape detected) and resets `expr` to `""`. The user keeps the option to type back.

- [ ] **Step 5: Test that existing conditions auto-detect**

Re-open the menu (close + reopen, or refresh the page). The condition you saved should auto-detect: simple comparisons show the form, complex shapes show free-text.

- [ ] **Step 6: Test all 6 operators**

In form mode, click the `==` op badge. Verify a dropdown appears with `== / != / < / <= / > / >=`. Pick each one in turn — verify the displayed badge updates and the serialized expression updates.

- [ ] **Step 7: Stop the dev server, commit any fixes**

`Ctrl+C` to stop. If the smoke test surfaced any bugs, fix and commit them. Otherwise no commit needed.

---

## What ships at the end of Plan B2

- Expression conditions edit through a structured form by default (left + op dropdown + right)
- Power users can swap to free-text mode with one click
- Existing simple `a OP b` conditions auto-detect and show as form on next open
- 8 new unit tests on the round-trip detector

## What does NOT ship (subsequent plans)

- Form builder for ternary (`a ? b : c`)
- AND/OR composition builder
- Method-call / list-method picker
- Form builder for `set_arg.value` and `set_arg_cycle_*.list` (still raw inputs from B1 — same component can later be reused)
- Toolbar buttons in template fields (Plan B3)
- Patterns gallery (Plan B3)
- Live preview, autocomplete (Plan B4)
