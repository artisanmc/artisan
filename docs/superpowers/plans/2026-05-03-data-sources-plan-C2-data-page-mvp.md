# Data Sources Redesign — Plan C2 (MVP): Data sources page

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Data sources page MVP — a 2-column layout where admins create reusable lists/objects on the pack, then reference them from menus via `ContextInput { kind: "sourceRef", ref: "pack:<id>" }`. MVP scope: schema is one of "list of string", "list of flat-object" (1 level deep), or "flat object" (1 level deep) — no recursive nesting. The full recursive schema editor is a follow-up plan (C2.1).

**Architecture:** TanStack Router route `/pack/$packId/data` with a 2-column layout. Sidebar lists `pack.dataSources[]` with sections for admin-made and connectors (read-only display). Right panel shows the selected source's schema (limited form chooser) and values (table-style). Reducers for add/remove/rename/setValue/setSchema added to accountStore. No connector import workflow — that's Plan C3.

**Tech Stack:** React 19, TanStack Router (existing), Zustand + immer (existing), shadcn `<Input>`, `<DropdownMenu>`. No new dependencies.

**Spec reference:** `docs/superpowers/specs/2026-05-03-data-sources-redesign-design.md` §2 (Page Data Sources UX). MVP-restricted to flat (1 level deep) shapes; recursive nesting deferred.

**Out of scope (follow-up plans):**
- Recursive nesting (object-in-object, list-in-object, list-in-list) → C2.1
- Connector import workflow → C3
- Live source resolution in MenuGroup preview (currently sourceRef inputs skipped) → C2.2

---

## File Structure

```
web/src/features/data/
├── DataSourcesPage.tsx              # NEW — top-level page (route component)
├── DataSourcesSidebar.tsx           # NEW — left column: list of sources + connectors
├── DataSourceEditor.tsx             # NEW — right column: schema + value editor
├── SchemaEditor.tsx                 # NEW — top of right panel: pick schema kind
├── ValueEditor.tsx                  # NEW — bottom of right panel: edit values
└── helpers.ts                       # NEW — defaultValueForSchema, isValidValue, etc.

web/src/routes/pack.$packId.data.tsx  # NEW — TanStack Router route file

web/src/state/accountStore.ts        # Modify — new reducers
web/src/state/accountStore.test.ts   # Modify — tests for new reducers

web/src/routes/pack.$packId.tsx      # Modify — add nav button to /pack/<id>/data
web/src/locales/{en,fr}.ts           # Modify — new dataSources.* keys
```

---

## Task 1: Reducers for DataSource CRUD

**Files:**
- Modify: `web/src/state/accountStore.ts`
- Modify: `web/src/state/accountStore.test.ts`

- [ ] **Step 1: Add reducer methods to the store interface**

In `accountStore.ts`, find where `setMenuContextInput` is declared in the `AccountStore` interface. Add nearby:

```typescript
addPackDataSource: (args: { packId: PackId; kind: "list" | "object" }) => void;
removePackDataSource: (args: { packId: PackId; id: DataSourceId }) => void;
renamePackDataSource: (args: { packId: PackId; id: DataSourceId; newName: string }) => void;
setPackDataSourceValue: (args: { packId: PackId; id: DataSourceId; value: unknown }) => void;
setPackDataSourceSchema: (args: { packId: PackId; id: DataSourceId; type: FieldType }) => void;
```

(Add `FieldType` and `DataSourceId` to the imports at the top of the file from `@/domain/types`.)

- [ ] **Step 2: Implement the reducers**

In the `AccountStore` slice (where other reducers are implemented with `produce`), add:

```typescript
addPackDataSource: ({ packId, kind }) =>
  set((state) =>
    produce(state, (draft) => {
      const pack = draft.account.packs.find((p) => p.id === packId);
      if (!pack) return;
      const id = generateDataSourceId();
      const baseName = kind === "list" ? "new_list" : "new_object";
      const name = nextAvailableName(pack.dataSources, baseName);
      const type: FieldType =
        kind === "list" ? { kind: "list", of: { kind: "string" } } : { kind: "object", fields: [] };
      const value: unknown = kind === "list" ? [] : {};
      pack.dataSources.push({ id, name, type, value });
    }),
  ),

removePackDataSource: ({ packId, id }) =>
  set((state) =>
    produce(state, (draft) => {
      const pack = draft.account.packs.find((p) => p.id === packId);
      if (!pack) return;
      pack.dataSources = pack.dataSources.filter((d) => d.id !== id);
    }),
  ),

renamePackDataSource: ({ packId, id, newName }) =>
  set((state) =>
    produce(state, (draft) => {
      const pack = draft.account.packs.find((p) => p.id === packId);
      if (!pack) return;
      const ds = pack.dataSources.find((d) => d.id === id);
      if (ds) ds.name = newName;
    }),
  ),

setPackDataSourceValue: ({ packId, id, value }) =>
  set((state) =>
    produce(state, (draft) => {
      const pack = draft.account.packs.find((p) => p.id === packId);
      if (!pack) return;
      const ds = pack.dataSources.find((d) => d.id === id);
      if (ds) ds.value = value;
    }),
  ),

setPackDataSourceSchema: ({ packId, id, type }) =>
  set((state) =>
    produce(state, (draft) => {
      const pack = draft.account.packs.find((p) => p.id === packId);
      if (!pack) return;
      const ds = pack.dataSources.find((d) => d.id === id);
      if (!ds) return;
      ds.type = type;
      // Reset value to a default that matches the new schema (best-effort coerce).
      ds.value = defaultValueForFieldType(type);
    }),
  ),
```

Add helpers near the top of `accountStore.ts` (above the slice definition, or in a small util file imported here):

```typescript
function generateDataSourceId(): DataSourceId {
  return `ds_${Math.random().toString(36).slice(2, 10)}` as DataSourceId;
}

function nextAvailableName(existing: DataSource[], base: string): string {
  if (!existing.some((d) => d.name === base)) return base;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base}_${n}`;
    if (!existing.some((d) => d.name === candidate)) return candidate;
  }
  return `${base}_${Date.now()}`;
}

function defaultValueForFieldType(type: FieldType): unknown {
  switch (type.kind) {
    case "string":
      return "";
    case "number":
    case "integer":
      return 0;
    case "boolean":
      return false;
    case "list":
      return [];
    case "object": {
      const obj: Record<string, unknown> = {};
      for (const f of type.fields) obj[f.name] = defaultValueForFieldType(f.type);
      return obj;
    }
  }
}
```

(Import `DataSource` from `@/domain/types`.)

- [ ] **Step 3: Add tests**

In `accountStore.test.ts`, append:

```typescript
describe("DataSource reducers", () => {
  it("adds a list data source with default name and shape", () => {
    const store = createTestStore();
    const packId = createTestPack(store);
    store.getState().addPackDataSource({ packId, kind: "list" });
    const pack = store.getState().account.packs.find((p) => p.id === packId)!;
    expect(pack.dataSources).toHaveLength(1);
    expect(pack.dataSources[0]!.name).toBe("new_list");
    expect(pack.dataSources[0]!.type).toEqual({ kind: "list", of: { kind: "string" } });
    expect(pack.dataSources[0]!.value).toEqual([]);
  });

  it("adds an object data source", () => {
    const store = createTestStore();
    const packId = createTestPack(store);
    store.getState().addPackDataSource({ packId, kind: "object" });
    const pack = store.getState().account.packs.find((p) => p.id === packId)!;
    expect(pack.dataSources[0]!.name).toBe("new_object");
    expect(pack.dataSources[0]!.type).toEqual({ kind: "object", fields: [] });
    expect(pack.dataSources[0]!.value).toEqual({});
  });

  it("disambiguates duplicate names", () => {
    const store = createTestStore();
    const packId = createTestPack(store);
    store.getState().addPackDataSource({ packId, kind: "list" });
    store.getState().addPackDataSource({ packId, kind: "list" });
    const pack = store.getState().account.packs.find((p) => p.id === packId)!;
    expect(pack.dataSources[0]!.name).toBe("new_list");
    expect(pack.dataSources[1]!.name).toBe("new_list_2");
  });

  it("removes a data source by id", () => {
    const store = createTestStore();
    const packId = createTestPack(store);
    store.getState().addPackDataSource({ packId, kind: "list" });
    const id = store.getState().account.packs.find((p) => p.id === packId)!.dataSources[0]!.id;
    store.getState().removePackDataSource({ packId, id });
    expect(store.getState().account.packs.find((p) => p.id === packId)!.dataSources).toHaveLength(0);
  });

  it("renames a data source", () => {
    const store = createTestStore();
    const packId = createTestPack(store);
    store.getState().addPackDataSource({ packId, kind: "list" });
    const id = store.getState().account.packs.find((p) => p.id === packId)!.dataSources[0]!.id;
    store.getState().renamePackDataSource({ packId, id, newName: "categories" });
    expect(store.getState().account.packs.find((p) => p.id === packId)!.dataSources[0]!.name).toBe(
      "categories",
    );
  });

  it("setValue writes the value", () => {
    const store = createTestStore();
    const packId = createTestPack(store);
    store.getState().addPackDataSource({ packId, kind: "list" });
    const id = store.getState().account.packs.find((p) => p.id === packId)!.dataSources[0]!.id;
    store.getState().setPackDataSourceValue({ packId, id, value: ["weapon", "armor"] });
    expect(store.getState().account.packs.find((p) => p.id === packId)!.dataSources[0]!.value).toEqual(
      ["weapon", "armor"],
    );
  });

  it("setSchema resets value to schema default", () => {
    const store = createTestStore();
    const packId = createTestPack(store);
    store.getState().addPackDataSource({ packId, kind: "list" });
    const id = store.getState().account.packs.find((p) => p.id === packId)!.dataSources[0]!.id;
    store.getState().setPackDataSourceValue({ packId, id, value: ["x", "y"] });
    store.getState().setPackDataSourceSchema({
      packId,
      id,
      type: { kind: "object", fields: [{ name: "title", type: { kind: "string" } }] },
    });
    expect(store.getState().account.packs.find((p) => p.id === packId)!.dataSources[0]!.value).toEqual(
      { title: "" },
    );
  });
});
```

(Use existing test helpers `createTestStore` and `createTestPack` if they exist, otherwise lift the patterns from neighboring tests in the same file.)

- [ ] **Step 4: Verify and commit**

```bash
cd web && npx tsc --noEmit 2>&1 | tail -5
cd web && npm test -- accountStore.test --run 2>&1 | tail -5
cd web && ./node_modules/.bin/biome check src/state/accountStore.ts src/state/accountStore.test.ts
git add web/src/state/accountStore.ts web/src/state/accountStore.test.ts
git commit -m "feat(state): add DataSource CRUD reducers"
```

---

## Task 2: Route + page shell

**Files:**
- Create: `web/src/routes/pack.$packId.data.tsx`
- Create: `web/src/features/data/DataSourcesPage.tsx`
- Create: `web/src/features/data/helpers.ts`

- [ ] **Step 1: Create the route file**

```typescript
// web/src/routes/pack.$packId.data.tsx
import { DataSourcesPage } from "@/features/data/DataSourcesPage";
import { createFileRoute, useParams } from "@tanstack/react-router";
import type { PackId } from "@/domain/types";

export const Route = createFileRoute("/pack/$packId/data")({
  component: DataPageRoute,
});

function DataPageRoute() {
  const { packId } = useParams({ from: "/pack/$packId/data" });
  return <DataSourcesPage packId={packId as PackId} />;
}
```

- [ ] **Step 2: Create the page shell**

```typescript
// web/src/features/data/DataSourcesPage.tsx
import type { DataSourceId, PackId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { DataSourceEditor } from "./DataSourceEditor";
import { DataSourcesSidebar } from "./DataSourcesSidebar";

interface DataSourcesPageProps {
  packId: PackId;
}

export function DataSourcesPage({ packId }: DataSourcesPageProps) {
  const { t } = useTranslation();
  const pack = useAccountStore((s) => s.account.packs.find((p) => p.id === packId));
  const [selectedId, setSelectedId] = useState<DataSourceId | null>(null);

  if (!pack) {
    return <div className="p-4 text-zinc-400">{t("dataSources.packNotFound")}</div>;
  }

  const selected = selectedId ? pack.dataSources.find((d) => d.id === selectedId) : null;

  return (
    <div className="flex h-full bg-zinc-950 text-zinc-100">
      <DataSourcesSidebar
        pack={pack}
        selectedId={selectedId}
        onSelect={setSelectedId}
      />
      <div className="flex-1 overflow-y-auto p-4">
        {selected ? (
          <DataSourceEditor packId={packId} source={selected} />
        ) : (
          <div className="text-zinc-500">{t("dataSources.selectHint")}</div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create helpers**

```typescript
// web/src/features/data/helpers.ts
import type { FieldType } from "@/domain/types";

export function defaultValueForFieldType(type: FieldType): unknown {
  switch (type.kind) {
    case "string":
      return "";
    case "number":
    case "integer":
      return 0;
    case "boolean":
      return false;
    case "list":
      return [];
    case "object": {
      const obj: Record<string, unknown> = {};
      for (const f of type.fields) obj[f.name] = defaultValueForFieldType(f.type);
      return obj;
    }
  }
}

/**
 * Render-friendly summary of a FieldType — used in source pickers and
 * sidebar tooltips. "list of string", "object with 3 fields", etc.
 */
export function summarizeFieldType(type: FieldType): string {
  switch (type.kind) {
    case "string":
      return "string";
    case "number":
      return "number";
    case "integer":
      return "integer";
    case "boolean":
      return "boolean";
    case "list":
      return `list of ${summarizeFieldType(type.of)}`;
    case "object":
      return type.fields.length === 0
        ? "object (no fields)"
        : `object with ${type.fields.length} field${type.fields.length === 1 ? "" : "s"}`;
  }
}
```

- [ ] **Step 4: Stub Sidebar and Editor (will be filled in next tasks)**

Create `web/src/features/data/DataSourcesSidebar.tsx`:

```typescript
import type { DataSourceId, Pack } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useTranslation } from "react-i18next";
import { summarizeFieldType } from "./helpers";

interface DataSourcesSidebarProps {
  pack: Pack;
  selectedId: DataSourceId | null;
  onSelect: (id: DataSourceId | null) => void;
}

export function DataSourcesSidebar({ pack, selectedId, onSelect }: DataSourcesSidebarProps) {
  const { t } = useTranslation();
  const addPackDataSource = useAccountStore((s) => s.addPackDataSource);

  return (
    <div className="flex w-64 flex-col gap-4 border-r border-zinc-800 bg-zinc-950 p-3">
      <section>
        <div className="mb-2 font-mono text-[10px] uppercase tracking-wide text-zinc-500">
          {t("dataSources.sectionPack")}
        </div>
        <ul className="flex flex-col gap-1">
          {pack.dataSources.map((d) => (
            <li key={d.id}>
              <button
                type="button"
                onClick={() => onSelect(d.id)}
                className={
                  selectedId === d.id
                    ? "flex w-full items-center gap-1 rounded bg-zinc-800 px-2 py-1 text-left text-[12px]"
                    : "flex w-full items-center gap-1 rounded px-2 py-1 text-left text-[12px] text-zinc-300 hover:bg-zinc-900"
                }
              >
                <span>{d.type.kind === "list" ? "🗂" : "📦"}</span>
                <span className="truncate">{d.name}</span>
                <span className="ml-auto text-[9px] text-zinc-500">{summarizeFieldType(d.type)}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-2 flex gap-1.5">
          <button
            type="button"
            onClick={() => addPackDataSource({ packId: pack.id, kind: "list" })}
            className="flex-1 rounded border border-zinc-700 border-dashed px-2 py-1 text-[11px] text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
          >
            {t("dataSources.addList")}
          </button>
          <button
            type="button"
            onClick={() => addPackDataSource({ packId: pack.id, kind: "object" })}
            className="flex-1 rounded border border-zinc-700 border-dashed px-2 py-1 text-[11px] text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
          >
            {t("dataSources.addObject")}
          </button>
        </div>
      </section>

      <section>
        <div className="mb-2 font-mono text-[10px] uppercase tracking-wide text-zinc-500">
          {t("dataSources.sectionConnectors")}
        </div>
        {pack.importedConnectors.length === 0 ? (
          <div className="rounded border border-zinc-800 border-dashed bg-zinc-900/40 px-2 py-2 text-[11px] text-zinc-500">
            {t("dataSources.noConnectors")}
          </div>
        ) : (
          <ul className="flex flex-col gap-1">
            {pack.importedConnectors.map((c) => (
              <li key={c.ref}>
                <div className="flex items-center gap-1 px-2 py-1 text-[12px] text-zinc-400">
                  <span>🔌</span>
                  <span className="truncate font-mono">{c.ref}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
```

Create stub `web/src/features/data/DataSourceEditor.tsx`:

```typescript
import type { DataSource, PackId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useTranslation } from "react-i18next";

interface DataSourceEditorProps {
  packId: PackId;
  source: DataSource;
}

export function DataSourceEditor({ packId, source }: DataSourceEditorProps) {
  const { t } = useTranslation();
  const renameDataSource = useAccountStore((s) => s.renamePackDataSource);
  const removeDataSource = useAccountStore((s) => s.removePackDataSource);

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <input
          type="text"
          value={source.name}
          onChange={(e) =>
            renameDataSource({ packId, id: source.id, newName: e.target.value })
          }
          className="bg-transparent text-lg font-semibold text-zinc-100 outline-none focus:border-b focus:border-zinc-500"
        />
        <button
          type="button"
          onClick={() => removeDataSource({ packId, id: source.id })}
          className="rounded px-2 py-1 text-[11px] text-zinc-500 hover:bg-zinc-800 hover:text-rose-300"
        >
          {t("dataSources.remove")}
        </button>
      </header>
      <p className="text-[11px] text-zinc-500">
        {t("dataSources.editorPlaceholder")}
      </p>
    </div>
  );
}
```

- [ ] **Step 5: Auto-generate route tree**

```bash
cd web && npm run generate-routes 2>&1 | tail -3
```

This updates `routeTree.gen.ts` to include the new `/pack/$packId/data` route.

- [ ] **Step 6: Verify and commit**

```bash
cd web && npx tsc --noEmit 2>&1 | tail -5
cd web && npm test -- --run 2>&1 | tail -5
cd web && ./node_modules/.bin/biome check src/features/data/ src/routes/
git add web/src/features/data/ web/src/routes/pack.$packId.data.tsx web/src/routeTree.gen.ts
git commit -m "feat(data): add DataSourcesPage shell with sidebar"
```

---

## Task 3: SchemaEditor + ValueEditor (MVP shapes)

**Files:**
- Create: `web/src/features/data/SchemaEditor.tsx`
- Create: `web/src/features/data/ValueEditor.tsx`
- Modify: `web/src/features/data/DataSourceEditor.tsx`

For MVP we support 3 schemas:
- `{ kind: "list", of: { kind: "string" } }`  (a)
- `{ kind: "list", of: { kind: "object", fields: [...flat] } }`  (b)
- `{ kind: "object", fields: [...flat] }`  (c)

Where "flat" means each field's type is a primitive (`kind: "string" | "number" | "integer" | "boolean"`).

- [ ] **Step 1: Write `SchemaEditor.tsx`**

```typescript
import type { DataSource, FieldType, PackId } from "@/domain/types";
import { Input } from "@/components/ui/input";
import { useAccountStore } from "@/state/accountStore";
import { useTranslation } from "react-i18next";

interface SchemaEditorProps {
  packId: PackId;
  source: DataSource;
}

const PRIMITIVE_KINDS = ["string", "number", "integer", "boolean"] as const;
type PrimitiveKind = (typeof PRIMITIVE_KINDS)[number];

export function SchemaEditor({ packId, source }: SchemaEditorProps) {
  const { t } = useTranslation();
  const setSchema = useAccountStore((s) => s.setPackDataSourceSchema);

  // For MVP, derive a "shape" from the type:
  //  - list-of-primitive
  //  - list-of-object
  //  - object
  // Anything else is "advanced" and shown read-only with a fallback message.
  const shape = detectMvpShape(source.type);

  if (shape === "advanced") {
    return (
      <div className="rounded border border-amber-500/40 bg-amber-500/10 p-3 text-[11px] text-amber-200">
        {t("dataSources.advancedSchemaNotice")}
      </div>
    );
  }

  if (shape === "list-of-primitive") {
    const innerKind = (source.type as Extract<FieldType, { kind: "list" }>).of.kind;
    return (
      <div className="rounded border border-zinc-800 bg-zinc-900 p-3 text-[11px]">
        <div className="mb-2 font-mono text-[10px] uppercase text-zinc-500">
          {t("dataSources.schema")}
        </div>
        <div className="flex items-center gap-2">
          <span>{t("dataSources.listOf")}</span>
          <select
            value={innerKind}
            onChange={(e) =>
              setSchema({
                packId,
                id: source.id,
                type: { kind: "list", of: { kind: e.target.value as PrimitiveKind } },
              })
            }
            className="rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5"
          >
            {PRIMITIVE_KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
            <option value="__object">{t("dataSources.object")}</option>
          </select>
        </div>
      </div>
    );
  }

  if (shape === "list-of-object") {
    const objType = (source.type as Extract<FieldType, { kind: "list" }>).of as Extract<
      FieldType,
      { kind: "object" }
    >;
    return (
      <div className="rounded border border-zinc-800 bg-zinc-900 p-3 text-[11px]">
        <div className="mb-2 font-mono text-[10px] uppercase text-zinc-500">
          {t("dataSources.schema")}: {t("dataSources.listOfObjectWith")} {objType.fields.length}{" "}
          {t("dataSources.fields")}
        </div>
        <FieldsEditor
          fields={objType.fields}
          onChange={(fields) =>
            setSchema({
              packId,
              id: source.id,
              type: { kind: "list", of: { kind: "object", fields } },
            })
          }
        />
      </div>
    );
  }

  // shape === "object"
  const objType = source.type as Extract<FieldType, { kind: "object" }>;
  return (
    <div className="rounded border border-zinc-800 bg-zinc-900 p-3 text-[11px]">
      <div className="mb-2 font-mono text-[10px] uppercase text-zinc-500">
        {t("dataSources.schema")}: {t("dataSources.objectWith")} {objType.fields.length}{" "}
        {t("dataSources.fields")}
      </div>
      <FieldsEditor
        fields={objType.fields}
        onChange={(fields) => setSchema({ packId, id: source.id, type: { kind: "object", fields } })}
      />
    </div>
  );
}

function FieldsEditor({
  fields,
  onChange,
}: {
  fields: { name: string; type: FieldType }[];
  onChange: (next: { name: string; type: FieldType }[]) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-1">
      {fields.map((f, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <Input
            value={f.name}
            onChange={(e) => {
              const next = fields.slice();
              next[i] = { ...f, name: e.target.value };
              onChange(next);
            }}
            placeholder={t("dataSources.fieldName")}
            className="h-7 w-32 px-1.5 py-0 font-mono text-[11px]"
          />
          <select
            value={f.type.kind}
            onChange={(e) => {
              const next = fields.slice();
              next[i] = { ...f, type: { kind: e.target.value as PrimitiveKind } };
              onChange(next);
            }}
            className="h-7 rounded border border-zinc-700 bg-zinc-900 px-1 text-[11px]"
          >
            {PRIMITIVE_KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => onChange(fields.filter((_, idx) => idx !== i))}
            className="ml-auto h-6 w-6 text-zinc-500 hover:text-rose-300"
          >
            ×
          </button>
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

function detectMvpShape(
  type: FieldType,
): "list-of-primitive" | "list-of-object" | "object" | "advanced" {
  if (type.kind === "object") {
    if (type.fields.every((f) => isPrimitiveKind(f.type.kind))) return "object";
    return "advanced";
  }
  if (type.kind === "list") {
    if (isPrimitiveKind(type.of.kind)) return "list-of-primitive";
    if (type.of.kind === "object" && type.of.fields.every((f) => isPrimitiveKind(f.type.kind)))
      return "list-of-object";
    return "advanced";
  }
  return "advanced";
}

function isPrimitiveKind(kind: FieldType["kind"]): kind is PrimitiveKind {
  return kind === "string" || kind === "number" || kind === "integer" || kind === "boolean";
}
```

- [ ] **Step 2: Write `ValueEditor.tsx`**

```typescript
import type { DataSource, FieldType, PackId } from "@/domain/types";
import { Input } from "@/components/ui/input";
import { useAccountStore } from "@/state/accountStore";
import { useTranslation } from "react-i18next";

interface ValueEditorProps {
  packId: PackId;
  source: DataSource;
}

export function ValueEditor({ packId, source }: ValueEditorProps) {
  const { t } = useTranslation();
  const setValue = useAccountStore((s) => s.setPackDataSourceValue);

  if (source.type.kind === "list" && isPrimitiveKind(source.type.of.kind)) {
    const items = Array.isArray(source.value) ? (source.value as unknown[]) : [];
    const inner = source.type.of.kind;
    const update = (next: unknown[]) => setValue({ packId, id: source.id, value: next });
    return (
      <div className="space-y-1">
        {items.map((v, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <PrimitiveInput
              kind={inner}
              value={v}
              onChange={(nv) => {
                const next = items.slice();
                next[i] = nv;
                update(next);
              }}
            />
            <button
              type="button"
              onClick={() => update(items.filter((_, idx) => idx !== i))}
              className="h-6 w-6 text-zinc-500 hover:text-rose-300"
            >
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => update([...items, defaultPrimitive(inner)])}
          className="self-start rounded border border-zinc-700 border-dashed px-2 py-1 text-[11px] text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
        >
          {t("dataSources.addItem")}
        </button>
      </div>
    );
  }

  if (
    source.type.kind === "list" &&
    source.type.of.kind === "object" &&
    source.type.of.fields.every((f) => isPrimitiveKind(f.type.kind))
  ) {
    const objType = source.type.of;
    const items = Array.isArray(source.value) ? (source.value as Record<string, unknown>[]) : [];
    const update = (next: Record<string, unknown>[]) =>
      setValue({ packId, id: source.id, value: next });
    return (
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-left text-zinc-500">
            {objType.fields.map((f) => (
              <th key={f.name} className="border-b border-zinc-800 px-2 py-1 font-mono">
                {f.name} <span className="text-zinc-600">({f.type.kind})</span>
              </th>
            ))}
            <th className="border-b border-zinc-800 px-2 py-1" />
          </tr>
        </thead>
        <tbody>
          {items.map((row, i) => (
            <tr key={i}>
              {objType.fields.map((f) => (
                <td key={f.name} className="border-b border-zinc-900 px-2 py-1">
                  <PrimitiveInput
                    kind={f.type.kind as Exclude<FieldType["kind"], "list" | "object">}
                    value={row[f.name]}
                    onChange={(nv) => {
                      const next = items.slice();
                      next[i] = { ...row, [f.name]: nv };
                      update(next);
                    }}
                  />
                </td>
              ))}
              <td className="border-b border-zinc-900 px-2 py-1">
                <button
                  type="button"
                  onClick={() => update(items.filter((_, idx) => idx !== i))}
                  className="h-6 w-6 text-zinc-500 hover:text-rose-300"
                >
                  ×
                </button>
              </td>
            </tr>
          ))}
          <tr>
            <td colSpan={objType.fields.length + 1} className="px-2 py-2">
              <button
                type="button"
                onClick={() => {
                  const newRow: Record<string, unknown> = {};
                  for (const f of objType.fields) newRow[f.name] = defaultPrimitive(f.type.kind);
                  update([...items, newRow]);
                }}
                className="rounded border border-zinc-700 border-dashed px-2 py-1 text-[11px] text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
              >
                {t("dataSources.addRow")}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    );
  }

  if (source.type.kind === "object" && source.type.fields.every((f) => isPrimitiveKind(f.type.kind))) {
    const obj = (source.value as Record<string, unknown> | undefined) ?? {};
    const update = (next: Record<string, unknown>) =>
      setValue({ packId, id: source.id, value: next });
    return (
      <div className="space-y-1">
        {source.type.fields.map((f) => (
          <div key={f.name} className="flex items-center gap-2">
            <span className="w-24 font-mono text-[11px] text-zinc-400">{f.name}</span>
            <PrimitiveInput
              kind={f.type.kind as Exclude<FieldType["kind"], "list" | "object">}
              value={obj[f.name]}
              onChange={(nv) => update({ ...obj, [f.name]: nv })}
            />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="rounded border border-amber-500/40 bg-amber-500/10 p-3 text-[11px] text-amber-200">
      {t("dataSources.advancedValueNotice")}
    </div>
  );
}

function isPrimitiveKind(
  kind: FieldType["kind"],
): kind is "string" | "number" | "integer" | "boolean" {
  return kind === "string" || kind === "number" || kind === "integer" || kind === "boolean";
}

function defaultPrimitive(kind: "string" | "number" | "integer" | "boolean"): unknown {
  switch (kind) {
    case "string":
      return "";
    case "number":
    case "integer":
      return 0;
    case "boolean":
      return false;
  }
}

function PrimitiveInput({
  kind,
  value,
  onChange,
}: {
  kind: "string" | "number" | "integer" | "boolean";
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  if (kind === "boolean") {
    return (
      <input
        type="checkbox"
        checked={value === true}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-emerald-500"
      />
    );
  }
  if (kind === "integer" || kind === "number") {
    return (
      <Input
        type="number"
        value={typeof value === "number" ? String(value) : ""}
        onChange={(e) => {
          const n = Number(e.target.value);
          onChange(Number.isFinite(n) ? n : 0);
        }}
        className="h-7 w-24 px-2 py-0 font-mono text-[11px]"
      />
    );
  }
  // string
  return (
    <Input
      value={typeof value === "string" ? value : ""}
      onChange={(e) => onChange(e.target.value)}
      className="h-7 w-32 px-2 py-0 font-mono text-[11px]"
    />
  );
}
```

- [ ] **Step 3: Wire SchemaEditor + ValueEditor into DataSourceEditor**

Replace the body of `DataSourceEditor.tsx`:

```typescript
import type { DataSource, PackId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useTranslation } from "react-i18next";
import { SchemaEditor } from "./SchemaEditor";
import { ValueEditor } from "./ValueEditor";

interface DataSourceEditorProps {
  packId: PackId;
  source: DataSource;
}

export function DataSourceEditor({ packId, source }: DataSourceEditorProps) {
  const { t } = useTranslation();
  const renameDataSource = useAccountStore((s) => s.renamePackDataSource);
  const removeDataSource = useAccountStore((s) => s.removePackDataSource);

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <input
          type="text"
          value={source.name}
          onChange={(e) =>
            renameDataSource({ packId, id: source.id, newName: e.target.value })
          }
          className="bg-transparent text-lg font-semibold text-zinc-100 outline-none focus:border-b focus:border-zinc-500"
        />
        <button
          type="button"
          onClick={() => removeDataSource({ packId, id: source.id })}
          className="rounded px-2 py-1 text-[11px] text-zinc-500 hover:bg-zinc-800 hover:text-rose-300"
        >
          {t("dataSources.remove")}
        </button>
      </header>
      <SchemaEditor packId={packId} source={source} />
      <div>
        <div className="mb-2 font-mono text-[10px] uppercase text-zinc-500">
          {t("dataSources.values")}
        </div>
        <ValueEditor packId={packId} source={source} />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verify and commit**

```bash
cd web && npx tsc --noEmit 2>&1 | tail -5
cd web && npm test -- --run 2>&1 | tail -5
cd web && ./node_modules/.bin/biome check src/features/data/
git add web/src/features/data/SchemaEditor.tsx web/src/features/data/ValueEditor.tsx web/src/features/data/DataSourceEditor.tsx
git commit -m "feat(data): add SchemaEditor and ValueEditor for MVP shapes"
```

---

## Task 4: Top-bar trigger + i18n

**Files:**
- Modify: `web/src/routes/pack.$packId.tsx`
- Modify: `web/src/locales/en.ts`
- Modify: `web/src/locales/fr.ts`

- [ ] **Step 1: Add navigation button in pack top-bar**

In `web/src/routes/pack.$packId.tsx`, add `Database` to the lucide imports:

```typescript
import { BookOpen, Boxes, Database, Download, Globe, Languages, Redo2, Undo2, Upload } from "lucide-react";
```

Find the top-bar buttons (near the BookOpen patterns gallery button added in Plan B3). Add an icon button that navigates to `/pack/<id>/data`. Use `useNavigate` from `@tanstack/react-router`:

Add the import at the top:

```typescript
import { useNavigate } from "@tanstack/react-router";
```

Inside `PackCanvasPage`:

```typescript
  const navigate = useNavigate();
```

Insert next to the patterns gallery button:

```typescript
            <button
              type="button"
              onClick={() => navigate({ to: "/pack/$packId/data", params: { packId } })}
              title={t("dataSources.title")}
              className="flex h-8 w-8 items-center justify-center rounded text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
            >
              <Database className="h-4 w-4" />
            </button>
```

(Match the className style of sibling icon buttons.)

- [ ] **Step 2: Add i18n keys**

In `web/src/locales/en.ts`, add a top-level `dataSources:` block:

```typescript
  dataSources: {
    title: "Data sources",
    packNotFound: "Pack not found.",
    selectHint: "Pick a data source from the sidebar, or create one.",
    sectionPack: "Pack data",
    sectionConnectors: "Connectors",
    noConnectors: "No connectors imported.",
    addList: "+ List",
    addObject: "+ Object",
    remove: "Remove",
    schema: "Schema",
    values: "Values",
    listOf: "List of",
    listOfObjectWith: "List of objects with",
    object: "object",
    objectWith: "Object with",
    fields: "fields",
    fieldName: "field name",
    addField: "+ Add field",
    addItem: "+ Add item",
    addRow: "+ Add row",
    advancedSchemaNotice: "This source has an advanced (nested) schema. Editing requires the full schema editor (Plan C2.1).",
    advancedValueNotice: "Values for this schema shape will be editable when the full schema editor lands (Plan C2.1).",
    editorPlaceholder: "Select a source to edit it.",
  },
```

In `web/src/locales/fr.ts`:

```typescript
  dataSources: {
    title: "Sources de données",
    packNotFound: "Pack introuvable.",
    selectHint: "Choisis une source dans la sidebar, ou crée-en une.",
    sectionPack: "Données du pack",
    sectionConnectors: "Connecteurs",
    noConnectors: "Aucun connecteur importé.",
    addList: "+ Liste",
    addObject: "+ Objet",
    remove: "Supprimer",
    schema: "Schema",
    values: "Valeurs",
    listOf: "Liste de",
    listOfObjectWith: "Liste d'objets avec",
    object: "objet",
    objectWith: "Objet avec",
    fields: "champs",
    fieldName: "nom du champ",
    addField: "+ Ajouter un champ",
    addItem: "+ Ajouter un item",
    addRow: "+ Ajouter une ligne",
    advancedSchemaNotice: "Cette source a un schema avancé (imbriqué). L'édition viendra avec le schema editor complet (Plan C2.1).",
    advancedValueNotice: "Les valeurs pour cette shape seront éditables avec le schema editor complet (Plan C2.1).",
    editorPlaceholder: "Sélectionne une source pour l'éditer.",
  },
```

- [ ] **Step 3: Verify, biome, commit**

```bash
cd web && npx tsc --noEmit 2>&1 | tail -5
cd web && npm test -- --run 2>&1 | tail -5
cd web && ./node_modules/.bin/biome check src/locales/ src/routes/pack.$packId.tsx
git add web/src/routes/pack.$packId.tsx web/src/locales/en.ts web/src/locales/fr.ts
git commit -m "feat(data): mount Data sources nav in pack top-bar"
```

---

## Task 5: Manual smoke test

- [ ] **Step 1: Start dev server**

```bash
cd web && npm run dev
```

- [ ] **Step 2: Navigate to pack → click Database icon**

Open `http://localhost:5173/`, enter a pack, click the Database icon in the top-bar. You should land on `/pack/<id>/data` with the 2-column layout.

- [ ] **Step 3: Create a list source**

Click "+ List" in the sidebar. Select the new entry "new_list". Verify the right panel shows schema (list of string ▾) and a value editor with "+ Add item". Add a couple of strings.

- [ ] **Step 4: Create an object source**

Click "+ Object". Verify the schema editor shows "Object with 0 fields", click "+ Add field" a couple times, name them and pick types. Verify the value editor shows form rows. Type values.

- [ ] **Step 5: Try a list-of-object via schema**

In a list source, change the inner kind dropdown to "object". Verify the schema editor switches to object mode (FieldsEditor visible) and the value editor switches to a table.

- [ ] **Step 6: Stop dev server**

`Ctrl+C`.

---

## What ships at end of Plan C2 MVP

- Route `/pack/$packId/data` with a 2-column layout
- Sidebar listing pack.dataSources + connectors (read-only display)
- Schema editor for 3 shapes: list-of-primitive, list-of-flat-object, flat-object
- Value editor for those 3 shapes (input, table, form)
- DataSource CRUD reducers + 7 unit tests
- Top-bar nav button
- i18n keys

## What does NOT ship (Plan C2.1+)

- Recursive nesting (object-in-object, list-in-list, etc.) — current schema editor falls back to a "advanced shape — coming later" message
- Connector import workflow (Plan C3)
- Resolution of sourceRef inputs in the menu preview
- Source picker in the menu's ContextInputsEditor (will be added when sourceRef inputs become first-class)
