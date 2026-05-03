# Expression DSL — Plan B5: Plain-language parse errors

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the raw parser error message rendered by `<ExpressionPreview>` with admin-friendly plain-language alternatives. The parser today emits messages like `Unexpected character '@' at column 5` — technical and not very actionable. This plan pattern-matches the ~5 common parser-error shapes and rewrites each into a friendlier i18n-keyed message.

**Architecture:** A new helper `formatParseError(message: string): { key: string; params: Record<string, string> }` examines the raw error message via regexes (parser messages have a stable shape), and returns an i18n key + interpolation params. ExpressionPreview consumes the pair via `t(key, params)`. Unknown messages fall back to a generic "syntax error: <raw>" key — guarantees we never lose information, even when the message shape evolves.

**Tech Stack:** Pure TypeScript helper, react-i18next for the lookup, vitest for tests. No new dependencies.

**Spec reference:** `docs/superpowers/specs/2026-05-03-expression-dsl-design.md` §4.8 (Plain-language error messages). This plan covers parse errors only; identifier-suggestion / type-error rewrites need scope inference (not yet implemented), so deferred.

**Out of scope (subsequent plans):**
- "Did you mean ...?" suggestions for unknown identifiers (needs scope inference + Levenshtein)
- Type-aware errors (e.g. `.join on number is not allowed`) — needs type-checking pass
- i18n cycle / depth-exceeded plain-language translation in render output (those are runtime errors of the renderer, not the parser; out of scope for now)
- Mobile adaptation (no toolbar/autocomplete shipped yet to adapt)

---

## File Structure

```
web/src/lib/expr/
├── formatParseError.ts              # NEW — pattern matcher + key+params return
└── formatParseError.test.ts         # NEW — unit tests on each known pattern + fallback

web/src/features/canvas/properties/
└── ExpressionPreview.tsx            # Modify — call formatParseError, then t() with key+params

web/src/locales/
├── en.ts                            # New keys: conditions.parseError.*
└── fr.ts                            # Same keys, French
```

---

## Task 1: formatParseError helper + tests

**Files:**
- Create: `web/src/lib/expr/formatParseError.ts`
- Create: `web/src/lib/expr/formatParseError.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// web/src/lib/expr/formatParseError.test.ts
import { describe, expect, it } from "vitest";
import { formatParseError } from "./formatParseError";

describe("formatParseError", () => {
  it("rewrites 'Unexpected character X at column N'", () => {
    expect(formatParseError("Unexpected character '@' at column 5")).toEqual({
      key: "conditions.parseError.unexpectedChar",
      params: { char: "@", col: "5" },
    });
  });

  it("rewrites 'Unterminated string starting at column N'", () => {
    expect(formatParseError("Unterminated string starting at column 4")).toEqual({
      key: "conditions.parseError.unterminatedString",
      params: { col: "4" },
    });
  });

  it("rewrites 'Unterminated PAPI placeholder starting at column N'", () => {
    expect(formatParseError("Unterminated PAPI placeholder starting at column 0")).toEqual({
      key: "conditions.parseError.unterminatedPapi",
      params: { col: "0" },
    });
  });

  it("rewrites 'Invalid PAPI placeholder at column N — expected ...'", () => {
    expect(
      formatParseError(
        "Invalid PAPI placeholder at column 0 — expected lowercase letter or underscore after %",
      ),
    ).toEqual({
      key: "conditions.parseError.invalidPapi",
      params: { col: "0" },
    });
  });

  it("rewrites 'Expected X but got Y at column N'", () => {
    expect(
      formatParseError("Expected ')' but got 'eof' at column 12"),
    ).toEqual({
      key: "conditions.parseError.expected",
      params: { expected: "')'", got: "'eof'", col: "12" },
    });
  });

  it("rewrites 'Unexpected token X at column N'", () => {
    expect(formatParseError("Unexpected token '!=' at column 7")).toEqual({
      key: "conditions.parseError.unexpectedToken",
      params: { token: "'!='", col: "7" },
    });
  });

  it("rewrites 'Empty expression'", () => {
    expect(formatParseError("Empty expression")).toEqual({
      key: "conditions.parseError.empty",
      params: {},
    });
  });

  it("falls back to raw message for unknown shapes", () => {
    expect(formatParseError("Some new error shape we didn't anticipate")).toEqual({
      key: "conditions.parseError.raw",
      params: { message: "Some new error shape we didn't anticipate" },
    });
  });
});
```

- [ ] **Step 2: Verify failing**

```bash
cd web && npm test -- formatParseError.test --run
```

- [ ] **Step 3: Implement**

```typescript
// web/src/lib/expr/formatParseError.ts
/**
 * Convert a raw ParseError message into an i18n key + interpolation
 * params. Patterns mirror the messages thrown from `lexer.ts` and
 * `parser.ts`. Unknown shapes fall back to a generic "raw" key so
 * users still see something useful.
 *
 * Caller pattern (in a React component):
 *   const { key, params } = formatParseError(err.message);
 *   t(key, params);
 */

export interface FormattedError {
  key: string;
  params: Record<string, string>;
}

const PATTERNS: Array<{ re: RegExp; key: string; map: (m: RegExpMatchArray) => Record<string, string> }> = [
  {
    re: /^Unexpected character '(.+)' at column (\d+)$/,
    key: "conditions.parseError.unexpectedChar",
    map: (m) => ({ char: m[1] ?? "", col: m[2] ?? "" }),
  },
  {
    re: /^Unterminated string starting at column (\d+)$/,
    key: "conditions.parseError.unterminatedString",
    map: (m) => ({ col: m[1] ?? "" }),
  },
  {
    re: /^Unterminated PAPI placeholder starting at column (\d+)$/,
    key: "conditions.parseError.unterminatedPapi",
    map: (m) => ({ col: m[1] ?? "" }),
  },
  {
    re: /^Invalid PAPI placeholder at column (\d+)/,
    key: "conditions.parseError.invalidPapi",
    map: (m) => ({ col: m[1] ?? "" }),
  },
  {
    re: /^Expected (.+) but got (.+) at column (\d+)$/,
    key: "conditions.parseError.expected",
    map: (m) => ({ expected: m[1] ?? "", got: m[2] ?? "", col: m[3] ?? "" }),
  },
  {
    re: /^Unexpected token (.+) at column (\d+)$/,
    key: "conditions.parseError.unexpectedToken",
    map: (m) => ({ token: m[1] ?? "", col: m[2] ?? "" }),
  },
  {
    re: /^Empty expression$/,
    key: "conditions.parseError.empty",
    map: () => ({}),
  },
];

export function formatParseError(message: string): FormattedError {
  for (const { re, key, map } of PATTERNS) {
    const m = message.match(re);
    if (m) return { key, params: map(m) };
  }
  return { key: "conditions.parseError.raw", params: { message } };
}
```

- [ ] **Step 4: Run tests, all pass**

- [ ] **Step 5: Biome + commit**

```bash
cd web && ./node_modules/.bin/biome check src/lib/expr/formatParseError.ts src/lib/expr/formatParseError.test.ts
git add web/src/lib/expr/formatParseError.ts web/src/lib/expr/formatParseError.test.ts
git commit -m "feat(expr): add formatParseError helper with pattern-based rewrites"
```

---

## Task 2: i18n keys

**Files:**
- Modify: `web/src/locales/en.ts`
- Modify: `web/src/locales/fr.ts`

- [ ] **Step 1: Add keys in en.ts**

In the `conditions:` block, find the `exprPreviewParseError` key (added in Plan B4). Replace its value with a generic-purpose template, and add the new `parseError:` sub-block with one entry per pattern. The result should look like:

```typescript
    exprPreviewValid: "→ {{display}}",
    exprPreviewParseError: "syntax: {{message}}",
    parseError: {
      unexpectedChar: "Unexpected character '{{char}}' at column {{col}} — did you forget a quote or operator?",
      unterminatedString: "Missing closing quote — string started at column {{col}} and never ends.",
      unterminatedPapi: "PAPI placeholder must end with %. Unclosed % starting at column {{col}}.",
      invalidPapi: "PAPI placeholder must start with a lowercase letter or underscore (column {{col}}).",
      expected: "Expected {{expected}} but got {{got}} at column {{col}}.",
      unexpectedToken: "Unexpected {{token}} at column {{col}}.",
      empty: "Type an expression to see the result.",
      raw: "{{message}}",
    },
```

- [ ] **Step 2: Add keys in fr.ts**

Same shape, French strings:

```typescript
    exprPreviewValid: "→ {{display}}",
    exprPreviewParseError: "syntaxe : {{message}}",
    parseError: {
      unexpectedChar: "Caractère inattendu '{{char}}' à la colonne {{col}} — il manque peut-être un guillemet ou un opérateur.",
      unterminatedString: "Guillemet fermant manquant — la chaîne commence à la colonne {{col}} et ne finit pas.",
      unterminatedPapi: "Un placeholder PAPI doit se terminer par %. Caractère % non fermé à la colonne {{col}}.",
      invalidPapi: "Un placeholder PAPI doit commencer par une lettre minuscule ou un underscore (colonne {{col}}).",
      expected: "Attendu {{expected}} mais trouvé {{got}} à la colonne {{col}}.",
      unexpectedToken: "Token inattendu {{token}} à la colonne {{col}}.",
      empty: "Tape une expression pour voir le résultat.",
      raw: "{{message}}",
    },
```

- [ ] **Step 3: Verify and commit**

```bash
cd web && npx tsc --noEmit
cd web && ./node_modules/.bin/biome check src/locales/en.ts src/locales/fr.ts
git add web/src/locales/en.ts web/src/locales/fr.ts
git commit -m "feat(editor): add plain-language parseError i18n keys"
```

---

## Task 3: Wire into ExpressionPreview

**Files:**
- Modify: `web/src/features/canvas/properties/ExpressionPreview.tsx`

- [ ] **Step 1: Add the import**

At the top of `ExpressionPreview.tsx`, alongside the existing imports from `@/lib/expr/...`:

```typescript
import { formatParseError } from "@/lib/expr/formatParseError";
```

- [ ] **Step 2: Replace the parse-error render branch**

Find the existing branch for the `parseError` state in the `ExpressionPreview` function:

```typescript
  if (state.kind === "parseError") {
    return (
      <div className="text-[10px] text-rose-300">
        {t("conditions.exprPreviewParseError", { message: state.message })}
      </div>
    );
  }
```

Replace with:

```typescript
  if (state.kind === "parseError") {
    const { key, params } = formatParseError(state.message);
    return <div className="text-[10px] text-rose-300">{t(key, params)}</div>;
  }
```

- [ ] **Step 3: Verify TS, tests, biome**

```bash
cd web && npx tsc --noEmit
cd web && npm test -- --run 2>&1 | tail -5
cd web && ./node_modules/.bin/biome check src/features/canvas/properties/ExpressionPreview.tsx
```

Expected: 280 + 8 = 288 tests pass.

- [ ] **Step 4: Commit**

```bash
git add web/src/features/canvas/properties/ExpressionPreview.tsx
git commit -m "feat(editor): use formatParseError for plain-language preview errors"
```

---

## Task 4: Manual smoke test

- [ ] **Step 1: Start dev server**

```bash
cd web && npm run dev
```

- [ ] **Step 2: Trigger each pattern**

In an expression condition, type each of these and verify the preview line shows the friendly message in the active language:

| Input | Expected message kind |
|---|---|
| `5 @ 6` | "Unexpected character '@' at column 2 — did you forget…" |
| `"hello` | "Missing closing quote — string started at column 0 and never ends." |
| `%foo` | "PAPI placeholder must end with %." |
| `(5 + 3` | "Expected ')' but got 'eof' at column 6." |
| `5 5` | "Unexpected '5' at column 2." (or similar) |

- [ ] **Step 3: Stop dev server**

`Ctrl+C`.

---

## What ships at the end of Plan B5

- 7 plain-language parse-error templates + a raw fallback, localized en/fr
- 8 unit tests on the pattern matcher
- ExpressionPreview surfaces friendly errors instead of raw parser messages

## What does NOT ship (subsequent plans)

- "Did you mean ...?" identifier suggestions (needs scope inference)
- Type-aware errors (`.join on number`, etc. — needs type checker)
- i18n cycle / depth-exceeded plain-language wording in render output (renderer-side, separate concern)
- Mobile adaptation (no toolbar/autocomplete shipped yet to adapt)
