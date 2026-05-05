# Data Sources Redesign — Plan C2.1: Recursive schema/value editors

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the "advanced shape" fallback in SchemaEditor and ValueEditor with truly recursive components that handle nesting at any depth (object inside object, list inside list, list inside object, etc.). Closes the last MVP limitation from Plan C2.

**Architecture:** Two recursive React components. `<FieldTypeBuilder>` handles editing any FieldType (recursing for list.of and object.fields[].type). `<ValueInput>` handles editing values for any FieldType (recursing for list items and object field values). Both already exist as flat-shape variants in `SchemaEditor.tsx` and `ValueEditor.tsx`; this plan generalizes them.

**Tech Stack:** React 19, existing primitives. No new deps.

**Spec reference:** `docs/superpowers/specs/2026-05-03-data-sources-redesign-design.md` §2.4-2.6.

---

## File Structure

```
web/src/features/data/
├── FieldTypeBuilder.tsx                # NEW — recursive type editor
├── ValueInput.tsx                      # NEW — recursive value editor
├── SchemaEditor.tsx                    # Modify — delegate to FieldTypeBuilder
└── ValueEditor.tsx                     # Modify — delegate to ValueInput
```

---

## Task 1: FieldTypeBuilder (recursive)

**File:** Create `web/src/features/data/FieldTypeBuilder.tsx`.

```typescript
import { Input } from "@/components/ui/input";
import type { FieldType } from "@/domain/types";
import { useTranslation } from "react-i18next";

const PRIMITIVE_KINDS = ["string", "number", "integer", "boolean"] as const;
type PrimitiveKind = (typeof PRIMITIVE_KINDS)[number];

interface FieldTypeBuilderProps {
  type: FieldType;
  onChange: (next: FieldType) => void;
  /** Indent level for visual nesting; defaults to 0. */
  depth?: number;
}

/**
 * Recursive FieldType editor. The user picks a kind; for compound kinds
 * (list, object) sub-editors are inlined for the inner type / fields.
 *
 * Used by SchemaEditor at the top level and by FieldsEditor for each
 * field's type.
 */
export function FieldTypeBuilder({ type, onChange, depth = 0 }: FieldTypeBuilderProps) {
  const { t } = useTranslation();
  const indent = { paddingLeft: `${depth * 12}px` };

  const setKind = (kind: FieldType["kind"]) => {
    switch (kind) {
      case "string":
      case "number":
      case "integer":
      case "boolean":
        onChange({ kind } as FieldType);
        return;
      case "list":
        onChange({ kind: "list", of: { kind: "string" } });
        return;
      case "object":
        onChange({ kind: "object", fields: [] });
        return;
    }
  };

  return (
    <div className="flex flex-col gap-1" style={indent}>
      <select
        value={type.kind}
        onChange={(e) => setKind(e.target.value as FieldType["kind"])}
        className="h-7 w-32 rounded border border-zinc-700 bg-zinc-900 px-1 text-[11px]"
      >
        {PRIMITIVE_KINDS.map((k) => (
          <option key={k} value={k}>
            {k}
          </option>
        ))}
        <option value="list">list</option>
        <option value="object">object</option>
      </select>
      {type.kind === "list" ? (
        <div className="rounded border border-zinc-800 bg-zinc-950/50 p-2">
          <div className="mb-1 font-mono text-[10px] uppercase text-zinc-500">
            {t("dataSources.listOf")}
          </div>
          <FieldTypeBuilder
            type={type.of}
            onChange={(of) => onChange({ kind: "list", of })}
            depth={depth + 1}
          />
        </div>
      ) : null}
      {type.kind === "object" ? (
        <div className="rounded border border-zinc-800 bg-zinc-950/50 p-2">
          <div className="mb-1 font-mono text-[10px] uppercase text-zinc-500">
            {t("dataSources.objectFields")}
          </div>
          <FieldsEditor
            fields={type.fields}
            onChange={(fields) => onChange({ kind: "object", fields })}
            depth={depth + 1}
          />
        </div>
      ) : null}
    </div>
  );
}

function FieldsEditor({
  fields,
  onChange,
  depth,
}: {
  fields: { name: string; type: FieldType }[];
  onChange: (next: { name: string; type: FieldType }[]) => void;
  depth: number;
}) {
  const { t } = useTranslation();
  const updateAt = (i: number, patch: Partial<{ name: string; type: FieldType }>) => {
    const next = fields.slice();
    const current = next[i];
    if (!current) return;
    next[i] = { ...current, ...patch };
    onChange(next);
  };
  return (
    <div className="flex flex-col gap-2">
      {fields.map((f, i) => (
        <div key={i} className="flex flex-col gap-1 rounded border border-zinc-800 bg-zinc-900 p-1.5">
          <div className="flex items-center gap-1.5">
            <Input
              value={f.name}
              onChange={(e) => updateAt(i, { name: e.target.value })}
              placeholder={t("dataSources.fieldName")}
              className="h-7 w-32 px-1.5 py-0 font-mono text-[11px]"
            />
            <button
              type="button"
              onClick={() => onChange(fields.filter((_, idx) => idx !== i))}
              className="ml-auto h-6 w-6 text-zinc-500 hover:text-rose-300"
            >
              ×
            </button>
          </div>
          <FieldTypeBuilder
            type={f.type}
            onChange={(type) => updateAt(i, { type })}
            depth={depth}
          />
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...fields, { name: "", type: { kind: "string" } }])}
        className="self-start rounded border border-zinc-700 border-dashed px-2 py-1 text-[11px] text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
      >
        {t("dataSources.addField")}
      </button>
    </div>
  );
}
```

Commit: `feat(data): add recursive FieldTypeBuilder component`

---

## Task 2: ValueInput (recursive)

**File:** Create `web/src/features/data/ValueInput.tsx`.

```typescript
import { Input } from "@/components/ui/input";
import type { FieldType } from "@/domain/types";
import { useTranslation } from "react-i18next";
import { defaultValueForFieldType } from "./helpers";

interface ValueInputProps {
  type: FieldType;
  value: unknown;
  onChange: (next: unknown) => void;
  depth?: number;
}

/**
 * Recursive value editor driven by a FieldType. Flat primitives render
 * as inputs / checkboxes. List values render as repeated rows. Object
 * values render as labeled sub-forms. Both list and object recurse via
 * <ValueInput> for inner shapes.
 */
export function ValueInput({ type, value, onChange, depth = 0 }: ValueInputProps) {
  const { t } = useTranslation();

  switch (type.kind) {
    case "string":
      return (
        <Input
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          className="h-7 w-40 px-2 py-0 font-mono text-[11px]"
        />
      );
    case "number":
    case "integer":
      return (
        <Input
          type="number"
          value={typeof value === "number" ? String(value) : ""}
          onChange={(e) => {
            const n = Number(e.target.value);
            onChange(Number.isFinite(n) ? n : 0);
          }}
          className="h-7 w-32 px-2 py-0 font-mono text-[11px]"
        />
      );
    case "boolean":
      return (
        <input
          type="checkbox"
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
          className="h-4 w-4 accent-emerald-500"
        />
      );
    case "list": {
      const items = Array.isArray(value) ? (value as unknown[]) : [];
      return (
        <div className="flex flex-col gap-1">
          {items.map((item, i) => (
            <div
              key={i}
              className="flex items-start gap-1.5 rounded border border-zinc-800 bg-zinc-900 p-1"
            >
              <ValueInput
                type={type.of}
                value={item}
                onChange={(nv) => {
                  const next = items.slice();
                  next[i] = nv;
                  onChange(next);
                }}
                depth={depth + 1}
              />
              <button
                type="button"
                onClick={() => onChange(items.filter((_, idx) => idx !== i))}
                className="ml-auto h-6 w-6 text-zinc-500 hover:text-rose-300"
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => onChange([...items, defaultValueForFieldType(type.of)])}
            className="self-start rounded border border-zinc-700 border-dashed px-2 py-1 text-[11px] text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
          >
            {t("dataSources.addItem")}
          </button>
        </div>
      );
    }
    case "object": {
      const obj =
        value !== null && typeof value === "object" && !Array.isArray(value)
          ? (value as Record<string, unknown>)
          : {};
      return (
        <div className="flex flex-col gap-1.5">
          {type.fields.map((f) => (
            <div key={f.name} className="flex items-start gap-2">
              <span className="w-24 shrink-0 pt-1 font-mono text-[11px] text-zinc-400">
                {f.name}
              </span>
              <div className="flex-1">
                <ValueInput
                  type={f.type}
                  value={obj[f.name]}
                  onChange={(nv) => onChange({ ...obj, [f.name]: nv })}
                  depth={depth + 1}
                />
              </div>
            </div>
          ))}
        </div>
      );
    }
  }
}
```

Commit: `feat(data): add recursive ValueInput component`

---

## Task 3: Wire into SchemaEditor + ValueEditor (drop "advanced" fallbacks)

**Files:**
- Modify: `web/src/features/data/SchemaEditor.tsx`
- Modify: `web/src/features/data/ValueEditor.tsx`

For SchemaEditor: replace the entire body (the `detectMvpShape` switch + 3 sub-editors + advanced fallback) with a single `<FieldTypeBuilder>` invocation:

```typescript
import type { DataSource, PackId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useTranslation } from "react-i18next";
import { FieldTypeBuilder } from "./FieldTypeBuilder";

interface SchemaEditorProps {
  packId: PackId;
  source: DataSource;
}

export function SchemaEditor({ packId, source }: SchemaEditorProps) {
  const { t } = useTranslation();
  const setSchema = useAccountStore((s) => s.setPackDataSourceSchema);
  return (
    <div className="rounded border border-zinc-800 bg-zinc-900 p-3 text-[11px]">
      <div className="mb-2 font-mono text-[10px] uppercase text-zinc-500">
        {t("dataSources.schema")}
      </div>
      <FieldTypeBuilder
        type={source.type}
        onChange={(type) => setSchema({ packId, id: source.id, type })}
      />
    </div>
  );
}
```

Drop the `PRIMITIVE_KINDS`, `detectMvpShape`, `isPrimitiveKind`, and `FieldsEditor` from SchemaEditor.tsx — they live in FieldTypeBuilder now.

For ValueEditor: replace its whole body with `<ValueInput>`:

```typescript
import type { DataSource, PackId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { ValueInput } from "./ValueInput";

interface ValueEditorProps {
  packId: PackId;
  source: DataSource;
}

export function ValueEditor({ packId, source }: ValueEditorProps) {
  const setValue = useAccountStore((s) => s.setPackDataSourceValue);
  return (
    <ValueInput
      type={source.type}
      value={source.value}
      onChange={(value) => setValue({ packId, id: source.id, value })}
    />
  );
}
```

Drop `PrimitiveInput`, `defaultPrimitive`, `isPrimitiveKind` from ValueEditor — they're in ValueInput now (ValueInput inlines what it needs; PrimitiveInput's logic is folded into the switch arms).

Add a couple of new i18n keys if not present:

```typescript
// en.ts dataSources block
objectFields: "Fields",
// fr.ts
objectFields: "Champs",
```

Final verification:

```bash
cd web && npx tsc --noEmit 2>&1 | tail -5
cd web && npm test -- --run 2>&1 | tail -5
cd web && ./node_modules/.bin/biome check src/features/data/
cd web && npm run build 2>&1 | tail -5
```

Tests should still be 320 (no test changes). Build OK.

Commit: `feat(data): use recursive editors in SchemaEditor and ValueEditor`

---

## What ships at end of Plan C2.1

- `<FieldTypeBuilder>` component handling all FieldType shapes recursively
- `<ValueInput>` component handling all FieldType values recursively
- SchemaEditor + ValueEditor delegate fully — "advanced shape" notice gone
- Admin can now create deeply nested data sources (object containing list of object containing string, etc.)
