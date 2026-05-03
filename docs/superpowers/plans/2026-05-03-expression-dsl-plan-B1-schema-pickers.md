# Expression DSL — Plan B1: Schema picker integration

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the three new schema types (`expression` Condition, `set_arg`, `set_arg_cycle_next`, `set_arg_cycle_prev` Actions) usable in the editor by extending the existing `ConditionListEditor` and `ActionEditor` with simple form inputs. No toolbar enhancements, no patterns gallery, no autocomplete — those come in subsequent plans.

**Architecture:** Add the new condition variant to the dropdown picker and provide an inline `<Input>` for the `expr` string. Add three case branches to `ActionEditor`'s switch — each renders a small form (arg name + value/list expression input). Expression-typed fields are plain monospace `<Input>` for V1 — power users type directly, form builders are deferred to Plan B2.

**Tech Stack:** React 19 + TanStack Router, existing shadcn primitives (`<Input>`, `<DropdownMenu>`), react-i18next for labels, biome+vitest. No new dependencies.

**Spec reference:** `docs/superpowers/specs/2026-05-03-expression-dsl-design.md` §4.6 (Conditions UI) and §4.7 (Action picker). The full spec calls for form-only Expression fields; this plan ships a simpler text input as MVP. Form builders are explicitly deferred to Plan B2.

**Out of scope (subsequent plans):**
- Plan B2 — Form-only Expression builders (visual cond/op/value, AND/OR, ternary, method calls)
- Plan B3 — Template editor toolbar (Placeholder dropdown, Conditional inserter, List join inserter, Patterns gallery)
- Plan B4 — Live preview using `renderTemplate` + scope inference + autocomplete
- Plan B5 — Plain-language errors, mobile adaptation, multi-iter preview

---

## File Structure

Modifications only — no new files (V1 reuses existing editors):

```
web/src/features/canvas/properties/
├── ConditionListEditor.tsx          # add `expression` to TYPES + ConditionInline switch
└── ActionEditor.tsx                 # add SetArgEditor + SetArgCycleEditor + 3 switch cases

web/src/locales/
├── en.ts                            # new keys: conditions.exprPlaceholder, actionEditor.{argLabel,valueLabel,listLabel,...}
└── fr.ts                            # same keys, French
```

No new tests — these are plain React form components that proxy to props.onChange. Existing test files (`web/src/features/canvas/properties/*` has no test file currently; sticking with that convention). The full vitest suite will catch any TypeScript regressions.

---

## Task 1: Add `expression` to ConditionListEditor

**Files:**
- Modify: `web/src/features/canvas/properties/ConditionListEditor.tsx`
- Modify: `web/src/locales/en.ts`
- Modify: `web/src/locales/fr.ts`

- [ ] **Step 1: Add `expression` to the TYPES array**

Open `web/src/features/canvas/properties/ConditionListEditor.tsx`. Find the `TYPES` array (currently lines 47-55) and append a new entry:

```typescript
const TYPES: Array<{ value: Condition["type"]; label: string; chip: string }> = [
  { value: "has_permission", label: "has permission", chip: "perm" },
  { value: "has_money", label: "has money", chip: "$" },
  { value: "placeholder_equals", label: "placeholder = value", chip: "= value" },
  { value: "placeholder_match", label: "placeholder ~ regex", chip: "~ regex" },
  { value: "not", label: "NOT (…)", chip: "NOT" },
  { value: "and", label: "AND group", chip: "AND" },
  { value: "or", label: "OR group", chip: "OR" },
  { value: "expression", label: "expression (advanced)", chip: "expr" },
];
```

- [ ] **Step 2: Add a case branch in `ConditionInline`**

Find the `ConditionInline` function (around lines 240-347). Add a new `case "expression":` branch BEFORE the closing brace of the switch:

```typescript
    case "expression":
      return (
        <Input
          placeholder={t("conditions.exprPlaceholder")}
          value={condition.expr}
          onChange={(e) => onChange({ ...condition, expr: e.target.value })}
          className="h-6 w-[200px] px-1.5 py-0 font-mono text-[11px]"
        />
      );
```

- [ ] **Step 3: Add the i18n key in en.ts**

Open `web/src/locales/en.ts`. Find the `conditions:` block (around line 254) and append `exprPlaceholder` after the existing placeholder keys. Look for the line `placeholderRegexPlaceholder: "^Diamond.*",` and add right after:

```typescript
    exprPlaceholder: "quest.gold > 1000",
```

- [ ] **Step 4: Add the i18n key in fr.ts**

Open `web/src/locales/fr.ts`. Find the same `conditions:` block. Add the same key with a French value:

```typescript
    exprPlaceholder: "quest.gold > 1000",
```

(The placeholder string is a code example — same in both languages.)

- [ ] **Step 5: Verify TypeScript and tests still pass**

Run from `web/`:

```bash
cd web && npx tsc --noEmit
cd web && npm test -- --run
```

Expected: no new TS errors, 257+ tests still pass.

- [ ] **Step 6: Verify Biome clean**

```bash
cd web && ./node_modules/.bin/biome check src/features/canvas/properties/ConditionListEditor.tsx src/locales/en.ts src/locales/fr.ts
```

If any issues, run `./node_modules/.bin/biome check --write <files>` to autofix.

- [ ] **Step 7: Commit**

```bash
git add web/src/features/canvas/properties/ConditionListEditor.tsx web/src/locales/en.ts web/src/locales/fr.ts
git commit -m "feat(editor): expose expression condition in ConditionListEditor"
```

---

## Task 2: SetArgEditor in ActionEditor

**Files:**
- Modify: `web/src/features/canvas/properties/ActionEditor.tsx`
- Modify: `web/src/locales/en.ts`
- Modify: `web/src/locales/fr.ts`

- [ ] **Step 1: Add the `set_arg` case in the `ActionEditor` switch**

Open `web/src/features/canvas/properties/ActionEditor.tsx`. Find the `ActionEditor` function (around lines 98-116). After the `case "paginate":` line and BEFORE the closing brace, insert:

```typescript
    case "set_arg":
      return <SetArgEditor action={action} onChange={onChange} />;
```

- [ ] **Step 2: Add the `SetArgEditor` component**

At the bottom of the same file (after the existing helper components like `PaginateEditor`), add:

```typescript
function SetArgEditor({
  action,
  onChange,
}: {
  action: Extract<Action, { type: "set_arg" }>;
  onChange: (action: Action) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      <div>
        <FieldLabel>{t("actionEditor.setArgArgLabel")}</FieldLabel>
        <Input
          value={action.arg}
          placeholder={t("actionEditor.setArgArgPlaceholder")}
          onChange={(e) => onChange({ ...action, arg: e.target.value })}
          className="h-7 text-[11px] font-mono"
        />
      </div>
      <div>
        <FieldLabel>{t("actionEditor.setArgValueLabel")}</FieldLabel>
        <Input
          value={action.value}
          placeholder={t("actionEditor.setArgValuePlaceholder")}
          onChange={(e) => onChange({ ...action, value: e.target.value })}
          className="h-7 text-[11px] font-mono"
        />
        <div className="mt-1 text-[10px] text-zinc-500">
          {t("actionEditor.setArgValueHint")}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add i18n keys in en.ts**

In `web/src/locales/en.ts`, inside the `actionEditor:` block (around line 154), append:

```typescript
    setArgArgLabel: "context input to set",
    setArgArgPlaceholder: "current_tag",
    setArgValueLabel: "new value (expression)",
    setArgValuePlaceholder: "\"weapon\"",
    setArgValueHint: "An expression — strings need quotes (e.g. \"weapon\"), numbers don't (e.g. 5).",
```

- [ ] **Step 4: Add i18n keys in fr.ts**

In `web/src/locales/fr.ts`, inside the `actionEditor:` block, append:

```typescript
    setArgArgLabel: "input de contexte à modifier",
    setArgArgPlaceholder: "current_tag",
    setArgValueLabel: "nouvelle valeur (expression)",
    setArgValuePlaceholder: "\"weapon\"",
    setArgValueHint: "Une expression — les strings ont besoin de guillemets (ex. \"weapon\"), les nombres non (ex. 5).",
```

- [ ] **Step 5: Verify TS, tests, lint**

```bash
cd web && npx tsc --noEmit
cd web && npm test -- --run
cd web && ./node_modules/.bin/biome check src/features/canvas/properties/ActionEditor.tsx src/locales/en.ts src/locales/fr.ts
```

Autofix lint if needed.

- [ ] **Step 6: Commit**

```bash
git add web/src/features/canvas/properties/ActionEditor.tsx web/src/locales/en.ts web/src/locales/fr.ts
git commit -m "feat(editor): add set_arg form to ActionEditor"
```

---

## Task 3: SetArgCycleEditor for both directions

**Files:**
- Modify: `web/src/features/canvas/properties/ActionEditor.tsx`
- Modify: `web/src/locales/en.ts`
- Modify: `web/src/locales/fr.ts`

- [ ] **Step 1: Add the two cases in `ActionEditor`'s switch**

After the `case "set_arg":` line just added, insert:

```typescript
    case "set_arg_cycle_next":
    case "set_arg_cycle_prev":
      return <SetArgCycleEditor action={action} onChange={onChange} />;
```

- [ ] **Step 2: Add the `SetArgCycleEditor` component**

At the bottom of `ActionEditor.tsx` (after `SetArgEditor`), add:

```typescript
function SetArgCycleEditor({
  action,
  onChange,
}: {
  action: Extract<Action, { type: "set_arg_cycle_next" | "set_arg_cycle_prev" }>;
  onChange: (action: Action) => void;
}) {
  const { t } = useTranslation();
  const directionKey =
    action.type === "set_arg_cycle_next"
      ? "actionEditor.setArgCycleDirectionNext"
      : "actionEditor.setArgCycleDirectionPrev";
  return (
    <div className="space-y-2">
      <div className="text-[10px] uppercase text-zinc-500">{t(directionKey)}</div>
      <div>
        <FieldLabel>{t("actionEditor.setArgArgLabel")}</FieldLabel>
        <Input
          value={action.arg}
          placeholder={t("actionEditor.setArgArgPlaceholder")}
          onChange={(e) => onChange({ ...action, arg: e.target.value })}
          className="h-7 text-[11px] font-mono"
        />
      </div>
      <div>
        <FieldLabel>{t("actionEditor.setArgCycleListLabel")}</FieldLabel>
        <Input
          value={action.list}
          placeholder={t("actionEditor.setArgCycleListPlaceholder")}
          onChange={(e) => onChange({ ...action, list: e.target.value })}
          className="h-7 text-[11px] font-mono"
        />
        <div className="mt-1 text-[10px] text-zinc-500">
          {t("actionEditor.setArgCycleListHint")}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add i18n keys in en.ts**

Inside the `actionEditor:` block, append after the `setArg*` keys from Task 2:

```typescript
    setArgCycleDirectionNext: "Cycle to next value",
    setArgCycleDirectionPrev: "Cycle to previous value",
    setArgCycleListLabel: "list to cycle through (expression)",
    setArgCycleListPlaceholder: "categories",
    setArgCycleListHint: "Expression evaluating to a list — typically a context input name like categories or quest.tags.",
```

- [ ] **Step 4: Add i18n keys in fr.ts**

```typescript
    setArgCycleDirectionNext: "Cycler vers la valeur suivante",
    setArgCycleDirectionPrev: "Cycler vers la valeur précédente",
    setArgCycleListLabel: "liste à cycler (expression)",
    setArgCycleListPlaceholder: "categories",
    setArgCycleListHint: "Expression qui évalue à une liste — typiquement un nom d'input de contexte comme categories ou quest.tags.",
```

- [ ] **Step 5: Verify TS, tests, lint**

```bash
cd web && npx tsc --noEmit
cd web && npm test -- --run
cd web && ./node_modules/.bin/biome check src/features/canvas/properties/ActionEditor.tsx src/locales/en.ts src/locales/fr.ts
```

- [ ] **Step 6: Commit**

```bash
git add web/src/features/canvas/properties/ActionEditor.tsx web/src/locales/en.ts web/src/locales/fr.ts
git commit -m "feat(editor): add set_arg_cycle_next/prev forms to ActionEditor"
```

---

## Task 4: Manual smoke test in the dev server

**Files:** None modified. Manual verification only.

- [ ] **Step 1: Start the dev server**

```bash
cd web && npm run dev
```

A URL like `http://localhost:5173/` should print. Open it in a browser.

- [ ] **Step 2: Test condition picker**

Navigate to a pack → menu → an Element with conditions on its appearance. In the visibility/conditions chip area, click `+ Add` and select **expression (advanced)**. Verify a chip appears with an input where you can type an expression like `quest.gold > 1000`. Verify typing updates the chip's stored value (open another chip then come back — value persists).

- [ ] **Step 3: Test set_arg action**

In a click handler somewhere (e.g., an Element's `left` click), click `+ Add step` and select **set_arg**. Verify a form appears with two fields: "context input to set" and "new value (expression)". Type values, switch away from the action and back, verify they persisted.

- [ ] **Step 4: Test set_arg_cycle_next and set_arg_cycle_prev**

Add a `set_arg_cycle_next` action. Verify the form shows the direction label "Cycle to next value", an arg input, and a list input. Same for `set_arg_cycle_prev` — direction label should say "Cycle to previous value".

- [ ] **Step 5: Save (toggle pack tabs / let auto-save run)**

Verify the new actions/conditions persist across reloads (the editor uses immer + zundo + localStorage by default — opening a different pack and coming back should preserve the values).

- [ ] **Step 6: Stop the dev server**

`Ctrl+C` in the terminal running `npm run dev`.

- [ ] **Step 7: If any issues found, file them**

If the smoke test surfaced bugs, document them in commit messages and fix in additional commits before claiming the plan complete. Don't suppress issues.

- [ ] **Step 8: Final lint + test pass**

```bash
cd web && npm test -- --run
cd web && ./node_modules/.bin/biome check src/features/canvas/properties/ src/locales/
cd web && npx tsc --noEmit
```

All clean.

- [ ] **Step 9: Final commit if needed**

If steps 2-8 produced any small fixes, commit them:

```bash
git add -A
git commit -m "fix(editor): smoke-test fixes for new schema pickers"
```

(Skip this step if no fixes were needed.)

---

## What ships at the end of Plan B1

- The 3 new condition/action types are creatable through existing pickers
- Each renders a simple form with text inputs (monospace for expression fields)
- i18n keys added to en/fr
- No regressions: 257 tests still pass

## What does NOT ship (Plan B2+)

- Form-only Expression builders (visual cond/op/value forms, AND/OR composition, ternary, method picker) — admins type expressions manually for now
- Toolbar buttons in template editors (Placeholder picker, conditional inserter, list-join inserter, patterns gallery)
- Live preview powered by `renderTemplate`
- Autocomplete on `{` / `.` / `%`
- Plain-language error messages
- Multi-iter preview
- Mobile adaptation specifics (existing patterns inherited)
