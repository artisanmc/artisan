# Data Sources Redesign — Plan C3: Connector import workflow

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add manual import of connector YAML files (Plan free workflow). The Java plugin generates `plugins/Artisan/connectors/<plugin>-<source>.yaml` files; the admin downloads them and drops them into the editor via a file picker. The editor parses, validates, and stores them in `pack.importedConnectors[]`. WS push for plan paid is out of scope (deferred to a later phase tied to the WS infrastructure).

**Architecture:** A pure parser `parseConnectorYaml(text: string): ConnectorSpec | ParseError` lives at `web/src/lib/connectors/parser.ts`. A small reducer set on accountStore manages `pack.importedConnectors` (add/replace by ref, remove). The Sidebar's "+ Importer" button opens a `<input type="file" multiple accept=".yaml,.yml">` and runs each file through the parser.

**Tech Stack:** Existing `yaml` npm dep (already used for SampleContextEditor pre-Plan-C1; still in `package.json`). Vitest for parser tests. No new dependencies.

**Spec reference:** `docs/superpowers/specs/2026-05-03-data-sources-redesign-design.md` §3 (Connectors).

**Out of scope:**
- WS push (plan paid auto-import) — separate plan once WS infra exists
- Live data fetch (replacing sample with real data) — V2
- Source picker UI in MenuProperties (will be added when sourceRef inputs become first-class with autocomplete)

---

## File Structure

```
web/src/lib/connectors/
├── parser.ts                        # NEW — parseConnectorYaml + ParseError type
├── parser.test.ts                   # NEW — fixture-driven tests on the parser

web/src/features/data/
└── DataSourcesSidebar.tsx           # Modify — add "+ Importer" button + file picker

web/src/state/
├── accountStore.ts                  # Modify — add 3 reducers for importedConnectors
└── accountStore.test.ts             # Modify — add tests

web/src/locales/{en,fr}.ts           # Modify — add connector import keys
```

---

## Task 1: parseConnectorYaml + tests

**Files:**
- Create: `web/src/lib/connectors/parser.ts`
- Create: `web/src/lib/connectors/parser.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// web/src/lib/connectors/parser.test.ts
import { describe, expect, it } from "vitest";
import { parseConnectorYaml } from "./parser";

describe("parseConnectorYaml", () => {
  it("parses a simple list-of-string connector", () => {
    const yaml = `
ref: example:tags
schema:
  kind: list
  of:
    kind: string
sample:
  - foo
  - bar
`;
    const result = parseConnectorYaml(yaml);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.spec.ref).toBe("example:tags");
      expect(result.spec.type).toEqual({ kind: "list", of: { kind: "string" } });
      expect(result.spec.sample).toEqual(["foo", "bar"]);
    }
  });

  it("parses a list-of-object connector with all field types", () => {
    const yaml = `
ref: chestshop:items
schema:
  kind: list
  of:
    kind: object
    fields:
      - { name: id, type: { kind: string } }
      - { name: price, type: { kind: number } }
      - { name: stock, type: { kind: integer } }
      - { name: enabled, type: { kind: boolean } }
sample:
  - { id: diamond, price: 100, stock: 5, enabled: true }
`;
    const result = parseConnectorYaml(yaml);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.spec.ref).toBe("chestshop:items");
      expect((result.spec.type as { kind: "list" }).kind).toBe("list");
    }
  });

  it("parses a recursively nested schema", () => {
    const yaml = `
ref: deep:thing
schema:
  kind: list
  of:
    kind: object
    fields:
      - { name: tags, type: { kind: list, of: { kind: string } } }
sample:
  - { tags: [a, b] }
`;
    const result = parseConnectorYaml(yaml);
    expect(result.ok).toBe(true);
  });

  it("rejects empty input", () => {
    const result = parseConnectorYaml("");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("empty");
  });

  it("rejects malformed YAML", () => {
    const result = parseConnectorYaml("ref: chestshop:items\nschema: [unclosed");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.length).toBeGreaterThan(0);
  });

  it("rejects when ref is missing", () => {
    const result = parseConnectorYaml(`schema: { kind: string }\nsample: x`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("ref");
  });

  it("rejects when ref is not a string", () => {
    const result = parseConnectorYaml(`ref: 42\nschema: { kind: string }\nsample: x`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("ref");
  });

  it("rejects when schema is missing", () => {
    const result = parseConnectorYaml(`ref: x:y\nsample: hi`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("schema");
  });

  it("rejects when schema kind is unknown", () => {
    const result = parseConnectorYaml(`ref: x:y\nschema: { kind: foo }\nsample: hi`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("kind");
  });

  it("rejects when sample doesn't match schema", () => {
    const result = parseConnectorYaml(`
ref: x:y
schema: { kind: list, of: { kind: string } }
sample: not-an-array
`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.toLowerCase()).toContain("sample");
  });

  it("rejects when object schema field name is missing", () => {
    const result = parseConnectorYaml(`
ref: x:y
schema: { kind: object, fields: [{ type: { kind: string } }] }
sample: {}
`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run failing**

```bash
cd web && npm test -- parser.test --run
```

- [ ] **Step 3: Implement**

```typescript
// web/src/lib/connectors/parser.ts
import type { ConnectorSpec, FieldType } from "@/domain/types";
import { parse as parseYamlText } from "yaml";

export type ParseResult =
  | { ok: true; spec: ConnectorSpec }
  | { ok: false; error: string };

/**
 * Parse a YAML connector spec into a runtime ConnectorSpec. Validates
 * the schema shape recursively and verifies the sample matches the
 * declared schema. Returns a discriminated union — never throws.
 *
 * Format expected (cf. spec §3.1):
 *
 *   ref: chestshop:items
 *   schema:
 *     kind: list
 *     of: { kind: object, fields: [...] }
 *   sample:
 *     - ...
 */
export function parseConnectorYaml(text: string): ParseResult {
  const trimmed = text.trim();
  if (trimmed === "") return { ok: false, error: "input is empty" };

  let raw: unknown;
  try {
    raw = parseYamlText(text);
  } catch (e) {
    return { ok: false, error: `YAML parse failed: ${(e as Error).message}` };
  }

  if (raw === null || typeof raw !== "object") {
    return { ok: false, error: "top-level must be an object with ref/schema/sample" };
  }
  const obj = raw as Record<string, unknown>;

  if (typeof obj.ref !== "string" || obj.ref === "") {
    return { ok: false, error: "ref must be a non-empty string" };
  }
  if (obj.schema === undefined) {
    return { ok: false, error: "schema is required" };
  }

  const schemaResult = parseFieldType(obj.schema);
  if (!schemaResult.ok) return schemaResult;

  // sample is allowed to be missing — empty is fine for editor preview, but
  // when present we validate it against the schema.
  const sample = obj.sample;
  if (sample !== undefined) {
    const sampleErr = validateAgainst(sample, schemaResult.type, "sample");
    if (sampleErr !== null) return { ok: false, error: sampleErr };
  }

  return {
    ok: true,
    spec: {
      ref: obj.ref,
      type: schemaResult.type,
      sample: sample ?? defaultSampleFor(schemaResult.type),
    },
  };
}

type FieldTypeResult = { ok: true; type: FieldType } | { ok: false; error: string };

function parseFieldType(raw: unknown, path = "schema"): FieldTypeResult {
  if (raw === null || typeof raw !== "object") {
    return { ok: false, error: `${path} must be an object with kind` };
  }
  const obj = raw as Record<string, unknown>;
  const kind = obj.kind;
  if (typeof kind !== "string") {
    return { ok: false, error: `${path}.kind must be a string` };
  }
  switch (kind) {
    case "string":
    case "number":
    case "integer":
    case "boolean":
      return { ok: true, type: { kind } as FieldType };
    case "list": {
      if (obj.of === undefined) return { ok: false, error: `${path}.of is required for list` };
      const inner = parseFieldType(obj.of, `${path}.of`);
      if (!inner.ok) return inner;
      return { ok: true, type: { kind: "list", of: inner.type } };
    }
    case "object": {
      if (!Array.isArray(obj.fields)) {
        return { ok: false, error: `${path}.fields must be an array` };
      }
      const fields: { name: string; type: FieldType }[] = [];
      for (let i = 0; i < obj.fields.length; i++) {
        const f = obj.fields[i];
        if (f === null || typeof f !== "object") {
          return { ok: false, error: `${path}.fields[${i}] must be an object` };
        }
        const fobj = f as Record<string, unknown>;
        if (typeof fobj.name !== "string" || fobj.name === "") {
          return { ok: false, error: `${path}.fields[${i}].name must be a non-empty string` };
        }
        const inner = parseFieldType(fobj.type, `${path}.fields[${i}].type`);
        if (!inner.ok) return inner;
        fields.push({ name: fobj.name, type: inner.type });
      }
      return { ok: true, type: { kind: "object", fields } };
    }
    default:
      return { ok: false, error: `${path}.kind unknown: '${kind}'` };
  }
}

/**
 * Best-effort validation that `value` matches `type`. Returns null when
 * OK, or an error message string. Loose — tolerates missing fields on
 * objects (some plugins ship partial samples) but rejects gross
 * mismatches (string-vs-array, etc.).
 */
function validateAgainst(value: unknown, type: FieldType, path: string): string | null {
  switch (type.kind) {
    case "string":
      return typeof value === "string" ? null : `${path} must be a string`;
    case "number":
      return typeof value === "number" ? null : `${path} must be a number`;
    case "integer":
      return typeof value === "number" && Number.isInteger(value)
        ? null
        : `${path} must be an integer`;
    case "boolean":
      return typeof value === "boolean" ? null : `${path} must be a boolean`;
    case "list": {
      if (!Array.isArray(value)) return `${path} must be an array`;
      for (let i = 0; i < value.length; i++) {
        const e = validateAgainst(value[i], type.of, `${path}[${i}]`);
        if (e !== null) return e;
      }
      return null;
    }
    case "object": {
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        return `${path} must be an object`;
      }
      const obj = value as Record<string, unknown>;
      for (const f of type.fields) {
        if (f.name in obj) {
          const e = validateAgainst(obj[f.name], f.type, `${path}.${f.name}`);
          if (e !== null) return e;
        }
        // missing fields tolerated
      }
      return null;
    }
  }
}

function defaultSampleFor(type: FieldType): unknown {
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
      for (const f of type.fields) obj[f.name] = defaultSampleFor(f.type);
      return obj;
    }
  }
}
```

- [ ] **Step 4: Run, biome, commit**

```bash
cd web && npm test -- parser.test --run
cd web && ./node_modules/.bin/biome check src/lib/connectors/
git add web/src/lib/connectors/parser.ts web/src/lib/connectors/parser.test.ts
git commit -m "feat(connectors): add parseConnectorYaml with schema validation"
```

---

## Task 2: Reducers for importedConnectors

**Files:**
- Modify: `web/src/state/accountStore.ts`
- Modify: `web/src/state/accountStore.test.ts`

- [ ] **Step 1: Add reducer methods**

In the AccountStore interface, near the `setPackDataSourceSchema` declaration, add:

```typescript
addImportedConnector: (args: { packId: PackId; spec: ConnectorSpec }) => void;
removeImportedConnector: (args: { packId: PackId; ref: string }) => void;
```

Import `ConnectorSpec` if not already.

- [ ] **Step 2: Implement**

```typescript
addImportedConnector: ({ packId, spec }) =>
  set((state) =>
    produce(state, (draft) => {
      const pack = draft.account.packs.find((p) => p.id === packId);
      if (!pack) return;
      pack.importedConnectors ??= [];
      const idx = pack.importedConnectors.findIndex((c) => c.ref === spec.ref);
      if (idx >= 0) pack.importedConnectors[idx] = spec;
      else pack.importedConnectors.push(spec);
    }),
  ),

removeImportedConnector: ({ packId, ref }) =>
  set((state) =>
    produce(state, (draft) => {
      const pack = draft.account.packs.find((p) => p.id === packId);
      if (!pack) return;
      pack.importedConnectors = pack.importedConnectors.filter((c) => c.ref !== ref);
    }),
  ),
```

- [ ] **Step 3: Add tests**

Append to `accountStore.test.ts`:

```typescript
describe("Connector reducers", () => {
  it("adds an imported connector", () => {
    const store = createTestStore();
    const packId = createTestPack(store);
    store.getState().addImportedConnector({
      packId,
      spec: {
        ref: "chestshop:items",
        type: { kind: "list", of: { kind: "string" } },
        sample: ["a"],
      },
    });
    const pack = store.getState().account.packs.find((p) => p.id === packId)!;
    expect(pack.importedConnectors).toHaveLength(1);
    expect(pack.importedConnectors[0]!.ref).toBe("chestshop:items");
  });

  it("replaces existing connector by ref", () => {
    const store = createTestStore();
    const packId = createTestPack(store);
    const spec1 = {
      ref: "x:y",
      type: { kind: "string" } as const,
      sample: "first",
    };
    const spec2 = {
      ref: "x:y",
      type: { kind: "string" } as const,
      sample: "second",
    };
    store.getState().addImportedConnector({ packId, spec: spec1 });
    store.getState().addImportedConnector({ packId, spec: spec2 });
    const pack = store.getState().account.packs.find((p) => p.id === packId)!;
    expect(pack.importedConnectors).toHaveLength(1);
    expect(pack.importedConnectors[0]!.sample).toBe("second");
  });

  it("removes a connector by ref", () => {
    const store = createTestStore();
    const packId = createTestPack(store);
    store.getState().addImportedConnector({
      packId,
      spec: { ref: "x:y", type: { kind: "string" }, sample: "s" },
    });
    store.getState().removeImportedConnector({ packId, ref: "x:y" });
    expect(
      store.getState().account.packs.find((p) => p.id === packId)!.importedConnectors,
    ).toHaveLength(0);
  });
});
```

- [ ] **Step 4: Verify and commit**

```bash
cd web && npx tsc --noEmit 2>&1 | tail -5
cd web && npm test -- accountStore.test --run 2>&1 | tail -5
cd web && ./node_modules/.bin/biome check src/state/
git add web/src/state/accountStore.ts web/src/state/accountStore.test.ts
git commit -m "feat(state): add importedConnectors reducers"
```

---

## Task 3: UI — Importer button + file picker in DataSourcesSidebar

**Files:**
- Modify: `web/src/features/data/DataSourcesSidebar.tsx`
- Modify: `web/src/locales/en.ts`
- Modify: `web/src/locales/fr.ts`

- [ ] **Step 1: Add the import button + picker logic**

In `web/src/features/data/DataSourcesSidebar.tsx`, add at the top:

```typescript
import { parseConnectorYaml } from "@/lib/connectors/parser";
import { toast } from "sonner";
import { useRef } from "react";
```

Inside the component body (near the existing `addPackDataSource` selector), add:

```typescript
  const addImportedConnector = useAccountStore((s) => s.addImportedConnector);
  const removeImportedConnector = useAccountStore((s) => s.removeImportedConnector);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleFiles = async (files: FileList | null) => {
    if (!files) return;
    let added = 0;
    let failed = 0;
    for (const file of Array.from(files)) {
      const text = await file.text();
      const result = parseConnectorYaml(text);
      if (result.ok) {
        addImportedConnector({ packId: pack.id, spec: result.spec });
        added++;
      } else {
        failed++;
        toast.error(t("dataSources.importError", { file: file.name, error: result.error }));
      }
    }
    if (added > 0) {
      toast.success(t("dataSources.importSuccess", { count: added }));
    }
  };
```

In the JSX, in the Connectors section (after the `<ul>` of imported connectors), add the import button + hidden file input:

```typescript
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="mt-2 self-start rounded border border-zinc-700 border-dashed px-2 py-1 text-[11px] text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
        >
          {t("dataSources.importConnectors")}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".yaml,.yml"
          className="hidden"
          onChange={(e) => {
            handleFiles(e.target.files);
            // reset so the same file can be re-imported
            e.target.value = "";
          }}
        />
```

Also, for each imported connector entry in the list, add a small remove button (hover-only on desktop, always visible on mobile):

Replace the existing `<li>` body for connectors with:

```typescript
              <li key={c.ref} className="group flex items-center gap-1 px-2 py-1 text-[12px] text-zinc-400">
                <span>🔌</span>
                <span className="flex-1 truncate font-mono">{c.ref}</span>
                <button
                  type="button"
                  onClick={() => removeImportedConnector({ packId: pack.id, ref: c.ref })}
                  title={t("dataSources.removeConnector")}
                  className="flex h-5 w-5 items-center justify-center rounded text-[12px] text-zinc-500 opacity-100 hover:bg-zinc-800 hover:text-rose-300 lg:opacity-0 lg:group-hover:opacity-100"
                >
                  ×
                </button>
              </li>
```

- [ ] **Step 2: Add i18n keys**

In `en.ts` `dataSources:` block, add:

```typescript
    importConnectors: "📥 Import connectors",
    importSuccess: "Imported {{count}} connector(s).",
    importError: "{{file}}: {{error}}",
    removeConnector: "Remove this connector",
```

In `fr.ts`:

```typescript
    importConnectors: "📥 Importer des connecteurs",
    importSuccess: "{{count}} connecteur(s) importé(s).",
    importError: "{{file}} : {{error}}",
    removeConnector: "Supprimer ce connecteur",
```

- [ ] **Step 3: Verify and commit**

```bash
cd web && npx tsc --noEmit 2>&1 | tail -5
cd web && npm test -- --run 2>&1 | tail -5
cd web && ./node_modules/.bin/biome check src/features/data/ src/locales/
git add web/src/features/data/DataSourcesSidebar.tsx web/src/locales/en.ts web/src/locales/fr.ts
git commit -m "feat(connectors): add importer button + file picker"
```

---

## Task 4: Manual smoke test

- [ ] **Step 1: Start dev server**

```bash
cd web && npm run dev
```

- [ ] **Step 2: Create a test YAML file**

In any text editor, create a file `test-connector.yaml`:

```yaml
ref: example:items
schema:
  kind: list
  of:
    kind: object
    fields:
      - { name: id, type: { kind: string } }
      - { name: price, type: { kind: number } }
sample:
  - { id: diamond, price: 100 }
  - { id: gold, price: 50 }
```

- [ ] **Step 3: Import it**

In the editor, navigate to a pack → Database icon → Data sources page. In the Connectors section sidebar, click "📥 Import connectors". Select the test YAML file. Verify a success toast appears and the connector shows up in the list.

- [ ] **Step 4: Try a malformed file**

Create `bad.yaml`:

```yaml
ref: not-namespaced
schema: { kind: bogus }
```

Import it. Verify an error toast shows the validation message.

- [ ] **Step 5: Re-import same file**

Re-select `test-connector.yaml`. Verify the connector is replaced (not duplicated).

- [ ] **Step 6: Remove a connector**

Hover the connector entry, click the × button. Verify it disappears from the list.

- [ ] **Step 7: Stop dev server**

`Ctrl+C`.

---

## What ships at end of Plan C3

- `parseConnectorYaml(text) → ConnectorSpec | error`, with 11 unit tests covering happy + error paths
- 2 reducers: `addImportedConnector` (insert/replace by ref), `removeImportedConnector` (by ref) + 3 unit tests
- "📥 Import connectors" button in DataSourcesSidebar opening a multi-select file picker
- Toasts for success / per-file error
- Connector list shows remove button on hover
- en/fr localized

## What does NOT ship (later plans)

- WS auto-push from plan paid (separate plan, requires WS infra)
- Live data fetch overriding sample (V2)
- Source picker in MenuProperties' ContextInputsEditor (still requires the user to manually type `pack:<id>` or `chestshop:items`)
- Recursive schema editor for advanced shapes (deferred to C2.1)
