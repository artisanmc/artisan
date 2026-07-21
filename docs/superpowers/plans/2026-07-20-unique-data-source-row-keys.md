# Unique Data-source Row Keys Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate a unique Row key for every new Project table row and reject empty or duplicate manual Row-key edits with an inline error.

**Architecture:** A focused domain module owns Row-key type lookup, normalization, uniqueness, and next-value generation. The Zustand store invokes it before mutations and returns a typed validation result; the table renders the Row-key field through a draft-based editor that commits on blur or Enter, while all other value cells retain their current eager updates.

**Tech Stack:** React 19, TypeScript, Zustand + Immer, Vitest, Testing Library, i18next.

## Global Constraints

- Preserve unrelated dirty-worktree changes; inspect staged hunks before every commit.
- Follow red-green-refactor: production code changes only after the corresponding test fails for the expected reason.
- Numeric Row keys generate the first free positive integer: `1`, `2`, `3`, and so on, reusing gaps.
- String Row keys generate the first free `row_n` value and are stored after `trim().toLowerCase()`.
- Empty and duplicate Row-key edits leave the row and all translations unchanged.
- Existing invalid imported rows are not silently renamed; the positional i18n fallback remains defensive only.
- Never run `npm run lint` for scoped validation because it checks the entire dirty editor tree; invoke the local Biome executable with explicit paths.

---

### Task 1: Row-key domain rules

**Files:**
- Create: `editor/src/domain/dataSourceRowKeys.ts`
- Create: `editor/src/domain/dataSourceRowKeys.test.ts`

**Interfaces:**
- Consumes: `Project`, table-shaped `DataSource`, and the active model's top-level Row-key field.
- Produces: `SourceRowKeyValidation`, `validateSourceRowKey(...)`, and `nextAvailableSourceRowKey(...)`.

- [ ] **Step 1: Write failing domain tests**

Create fixtures for a string-keyed table and a numeric-keyed table, then cover normalization, collisions, and gap reuse:

```ts
import { describe, expect, it } from "vitest";
import type { DataSource, Project } from "./types";
import {
  nextAvailableSourceRowKey,
  validateSourceRowKey,
} from "./dataSourceRowKeys";

type TableSource = Extract<DataSource, { shape: "table" }>;

function makeTable({
  keyType,
  rows,
}: {
  keyType: "string" | "number" | "integer";
  rows: Record<string, unknown>[];
}): { pack: Project; source: TableSource } {
  const source = {
    id: "ds_grades",
    name: "grades",
    shape: "table",
    modelId: "model_grade",
    rows,
  } as TableSource;
  const pack = {
    id: "p1",
    dataModels: [
      {
        id: "model_grade",
        name: "grade",
        keyField: "id",
        fields: [{ name: "id", type: { kind: keyType } }],
      },
    ],
    dataSources: [source],
  } as unknown as Project;
  return { pack, source };
}

describe("data source Row keys", () => {
  it("generates the first free lowercase row_n key for a string field", () => {
    const { pack, source } = makeTable({
      keyType: "string",
      rows: [{ id: "row_1" }, { id: "row_3" }],
    });
    expect(nextAvailableSourceRowKey(pack, source)).toBe("row_2");
  });

  it("generates the first free positive integer for a numeric field", () => {
    const { pack, source } = makeTable({
      keyType: "integer",
      rows: [{ id: 1 }, { id: 3 }],
    });
    expect(nextAvailableSourceRowKey(pack, source)).toBe(2);
  });

  it("normalizes string keys and rejects case-insensitive duplicates", () => {
    const { pack, source } = makeTable({
      keyType: "string",
      rows: [{ id: "vip" }, { id: "member" }],
    });
    expect(validateSourceRowKey(pack, source, 1, " VIP ")).toEqual({
      ok: false,
      reason: "duplicate",
    });
    expect(validateSourceRowKey(pack, source, 1, " Elite ")).toEqual({
      ok: true,
      value: "elite",
    });
  });

  it("rejects an empty string key", () => {
    const { pack, source } = makeTable({ keyType: "string", rows: [{ id: "vip" }] });
    expect(validateSourceRowKey(pack, source, 0, "   ")).toEqual({
      ok: false,
      reason: "required",
    });
  });
});
```

- [ ] **Step 2: Run the domain test and verify the expected failure**

Run:

```powershell
cd editor
npm.cmd test -- --run src/domain/dataSourceRowKeys.test.ts
```

Expected: FAIL because `./dataSourceRowKeys` does not exist.

- [ ] **Step 3: Implement the domain module**

Create the following public contract:

```ts
import type { DataSource, ModelField, Project } from "./types";

type TableSource = Extract<DataSource, { shape: "table" }>;

export type SourceRowKeyValidation =
  | { ok: true; value: string | number }
  | { ok: false; reason: "required" | "duplicate" };

function rowKeyField(pack: Project, source: TableSource): ModelField | undefined {
  const model = (pack.dataModels ?? []).find((candidate) => candidate.id === source.modelId);
  return model?.fields.find((field) => field.name === model.keyField);
}

export function validateSourceRowKey(
  pack: Project,
  source: TableSource,
  rowIndex: number,
  candidate: unknown,
): SourceRowKeyValidation {
  const field = rowKeyField(pack, source);
  if (!field) throw new Error("Table source has no Row-key field");

  let value: string | number;
  if (field.type.kind === "string") {
    value = typeof candidate === "string" ? candidate.trim().toLowerCase() : "";
    if (value === "") return { ok: false, reason: "required" };
  } else if (field.type.kind === "number" || field.type.kind === "integer") {
    if (candidate === "" || candidate === null || candidate === undefined)
      return { ok: false, reason: "required" };
    const parsed = Number(candidate);
    if (!Number.isFinite(parsed)) return { ok: false, reason: "required" };
    value = field.type.kind === "integer" ? Math.round(parsed) : parsed;
  } else {
    throw new Error(`Unsupported Row-key type: ${field.type.kind}`);
  }

  const duplicate = source.rows.some((row, index) => {
    if (index === rowIndex) return false;
    const existing = row[field.name];
    if (field.type.kind === "string") {
      return typeof existing === "string" && existing.trim().toLowerCase() === value;
    }
    return Number.isFinite(Number(existing)) && Number(existing) === value;
  });
  return duplicate ? { ok: false, reason: "duplicate" } : { ok: true, value };
}

export function nextAvailableSourceRowKey(pack: Project, source: TableSource): string | number {
  const field = rowKeyField(pack, source);
  if (!field) throw new Error("Table source has no Row-key field");
  const numeric = field.type.kind === "number" || field.type.kind === "integer";
  for (let index = 1; ; index++) {
    const candidate = numeric ? index : `row_${index}`;
    const validation = validateSourceRowKey(pack, source, -1, candidate);
    if (validation.ok) return validation.value;
  }
}
```

Keep the scan deterministic and local; do not mutate `pack` or `source` in this module.

- [ ] **Step 4: Run the domain tests and targeted lint**

Run:

```powershell
cd editor
npm.cmd test -- --run src/domain/dataSourceRowKeys.test.ts
.\node_modules\.bin\biome.cmd lint src/domain/dataSourceRowKeys.ts src/domain/dataSourceRowKeys.test.ts --diagnostic-level=error
```

Expected: all domain tests pass and Biome reports no new lint errors.

- [ ] **Step 5: Commit the isolated domain change**

Inspect the staged patch before committing:

```powershell
git add -- editor/src/domain/dataSourceRowKeys.ts editor/src/domain/dataSourceRowKeys.test.ts
git diff --cached --check
git diff --cached
git commit -m "feat: define unique data source row keys"
```

Expected: the commit contains only the new domain module and its tests.

### Task 2: Store generation and rejection invariant

**Files:**
- Modify: `editor/src/state/accountStore.ts`
- Modify: `editor/src/state/accountStore.test.ts`

**Interfaces:**
- Consumes: `nextAvailableSourceRowKey(pack, source)` and `validateSourceRowKey(pack, source, rowIndex, candidate)` from Task 1.
- Produces: `setSourceValue(...): SourceValueUpdateResult`, where the result is `{ ok: true }` or `{ ok: false; reason: "required_row_key" | "duplicate_row_key" }`.

- [ ] **Step 1: Write failing store tests for generated keys**

Extend the existing `describe("DataSource reducers")` block. Add these local helpers at its beginning; they deliberately use the public store actions so tests exercise the real mutation path:

```ts
const sourcePack = () =>
  useAccountStore.getState().account.projects.find((project) => project.id === PERSONAL)!;

const firstTableSource = () => {
  const source = sourcePack().dataSources[0]!;
  if (source.shape !== "table") throw new Error("expected table");
  return source;
};

function createGradesSource(): ReturnType<typeof firstTableSource> {
  useAccountStore.getState().addProjectDataSource({ projectId: PERSONAL });
  const source = firstTableSource();
  useAccountStore.getState().renameProjectDataSource({
    projectId: PERSONAL,
    id: source.id,
    newName: "grades",
  });
  useAccountStore.getState().editSourceField({
    projectId: PERSONAL,
    target: { kind: "model", modelId: source.modelId },
    edit: { op: "add", path: [], field: { name: "lore", type: { kind: "ltext" } } },
  });
  return firstTableSource();
}

function seedGradeRows(ids: string[]): void {
  const source = createGradesSource();
  for (const [index, id] of ids.entries()) {
    useAccountStore.getState().addSourceRow({ projectId: PERSONAL, sourceId: source.id });
    useAccountStore.getState().setSourceValue({
      projectId: PERSONAL,
      sourceId: source.id,
      row: index,
      path: ["id"],
      value: id,
    });
  }
}
```

Then add separate string and numeric cases:

```ts
it("assigns sequential unique string Row keys before minting translations", () => {
  const source = createGradesSource();
  useAccountStore.getState().addSourceRow({ projectId: PERSONAL, sourceId: source.id });
  useAccountStore.getState().addSourceRow({ projectId: PERSONAL, sourceId: source.id });

  const rows = firstTableSource().rows;
  expect(rows.slice(-2).map((row) => row.id)).toEqual(["row_1", "row_2"]);
  expect((rows.at(-1)!.lore as LText).key).toBe("sources.grades.row_2.lore");
});

it("fills the first free positive integer for a numeric Row key", () => {
  useAccountStore.getState().addProjectDataSource({ projectId: PERSONAL });
  const source = firstTableSource();
  useAccountStore.getState().editSourceField({
    projectId: PERSONAL,
    target: { kind: "model", modelId: source.modelId },
    edit: { op: "retype", path: [], name: "id", newType: { kind: "integer" } },
  });
  useAccountStore.setState((state) =>
    produce(state, (draft) => {
      const table = draft.account.projects.find((project) => project.id === PERSONAL)!
        .dataSources[0]!;
      if (table.shape !== "table") throw new Error("expected table");
      table.rows = [{ id: 1 }, { id: 3 }];
    }),
  );
  useAccountStore.getState().addSourceRow({ projectId: PERSONAL, sourceId: source.id });
  expect(firstTableSource().rows.at(-1)!.id).toBe(2);
});
```

- [ ] **Step 2: Write failing store tests for rejected and valid edits**

```ts
it("rejects duplicate Row-key edits without changing data or translations", () => {
  seedGradeRows(["vip", "member"]);
  const beforeKeys = structuredClone(currentPack().i18nKeys);
  const source = firstTableSource();
  const result = useAccountStore.getState().setSourceValue({
    projectId: PERSONAL,
    sourceId: source.id,
    row: 1,
    path: ["id"],
    value: " VIP ",
  });

  expect(result).toEqual({ ok: false, reason: "duplicate_row_key" });
  expect(firstTableSource().rows[1]!.id).toBe("member");
  expect(currentPack().i18nKeys).toEqual(beforeKeys);
});

it("normalizes a valid Row-key edit and preserves every translation while rekeying", () => {
  seedGradeRows(["vip"]);
  const source = firstTableSource();
  const result = useAccountStore.getState().setSourceValue({
    projectId: PERSONAL,
    sourceId: source.id,
    row: 0,
    path: ["id"],
    value: " ELITE ",
  });

  expect(result).toEqual({ ok: true });
  expect(firstTableSource().rows[0]!.id).toBe("elite");
  expect(currentPack().i18nKeys["sources.grades.elite.lore" as I18nKey]).toEqual({
    en: "Elite",
    fr: "Élite",
  });
});
```

Add the matching required-value case:

```ts
it("rejects an empty Row-key edit", () => {
  seedGradeRows(["vip"]);
  const source = firstTableSource();
  const result = useAccountStore.getState().setSourceValue({
    projectId: PERSONAL,
    sourceId: source.id,
    row: 0,
    path: ["id"],
    value: "   ",
  });

  expect(result).toEqual({ ok: false, reason: "required_row_key" });
  expect(firstTableSource().rows[0]!.id).toBe("vip");
});
```

- [ ] **Step 3: Run the store tests and verify the failures**

Run:

```powershell
cd editor
npm.cmd test -- --run src/state/accountStore.test.ts
```

Expected: generated rows still have the default empty key, and `setSourceValue` returns `undefined` while accepting duplicates.

- [ ] **Step 4: Implement generation and validation in the store**

Add the result type beside `AccountState`:

```ts
export type SourceValueUpdateResult =
  | { ok: true }
  | { ok: false; reason: "required_row_key" | "duplicate_row_key" };
```

Change the action signature to return `SourceValueUpdateResult`. In `addSourceRow`, assign the generated key before pushing and minting:

```ts
const model = (pack.dataModels ?? []).find((candidate) => candidate.id === ds.modelId);
if (!model) return;
row[model.keyField] = nextAvailableSourceRowKey(pack, ds);
ds.rows.push(row);
mintSourceLTexts(pack);
```

In `setSourceValue`, detect exactly `ds.shape === "table"`, `row !== null`, `path.length === 1`, and `path[0] === model.keyField`. Validate before `set(...)`; translate `required`/`duplicate` into the public store reasons and return without mutation on failure. On success, store `validation.value`, call `rekeyDataSource`, and return `{ ok: true }`. Existing config and non-key edits still mutate and return `{ ok: true }`.

- [ ] **Step 5: Run store/domain regression tests and targeted lint**

Run:

```powershell
cd editor
npm.cmd test -- --run src/domain/dataSourceRowKeys.test.ts src/domain/i18nSites.test.ts src/state/accountStore.test.ts
.\node_modules\.bin\biome.cmd lint src/domain/dataSourceRowKeys.ts src/state/accountStore.ts --diagnostic-level=error
```

Expected: all selected tests pass; no new production lint errors.

- [ ] **Step 6: Commit only reviewed store hunks**

Because both store files are already dirty, stage only this task's hunks and inspect them before committing:

```powershell
git add -p -- editor/src/state/accountStore.ts editor/src/state/accountStore.test.ts
git diff --cached --check
git diff --cached
git commit -m "feat: enforce unique data source row keys"
```

Expected: no unrelated pre-existing hunks are staged.

### Task 3: Inline Row-key validation UI

**Files:**
- Modify: `editor/src/features/data/SourceValueEditor.tsx`
- Modify: `editor/src/features/data/SourceValueEditor.test.tsx`
- Modify: `editor/src/locales/en.ts`
- Modify: `editor/src/locales/fr.ts`

**Interfaces:**
- Consumes: `setSourceValue(...): SourceValueUpdateResult` from Task 2.
- Produces: a private `RowKeyEditor` that commits a local draft on blur or Enter and renders localized required/duplicate errors.

- [ ] **Step 1: Write failing UI tests**

Seed two rows (`vip`, `member`) and add the following cases:

```tsx
it("rejects a duplicate Row key with an inline error and restores the stored value", () => {
  seedRows(["vip", "member"]);
  render(<SourceRowsTable projectId={PID} pack={pack()} source={tableSource()} />);

  const ids = screen.getAllByLabelText("id");
  fireEvent.change(ids[1]!, { target: { value: " VIP " } });
  fireEvent.blur(ids[1]!);

  expect(screen.getByText("Une ligne porte déjà cet ID.")).toBeInTheDocument();
  expect(tableSource().rows[1]!.id).toBe("member");
  expect(ids[1]).toHaveValue("member");
});

it("commits a normalized unique Row key on Enter", () => {
  seedRows(["vip"]);
  render(<SourceRowsTable projectId={PID} pack={pack()} source={tableSource()} />);

  const id = screen.getByLabelText("id");
  fireEvent.change(id, { target: { value: " ELITE " } });
  fireEvent.keyDown(id, { key: "Enter" });

  expect(tableSource().rows[0]!.id).toBe("elite");
  expect(id).toHaveValue("elite");
});
```

Also update the existing add/remove test to assert the generated second row has `id: "row_1"` and its minted localized key is `sources.ranks.row_1.name`.

- [ ] **Step 2: Run the UI test and verify the expected failure**

Run:

```powershell
cd editor
npm.cmd test -- --run src/features/data/SourceValueEditor.test.tsx
```

Expected: duplicate input is accepted immediately, no inline error exists, and new rows still render an empty ID.

- [ ] **Step 3: Implement the draft-based Row-key cell**

Add a private component in `SourceValueEditor.tsx`:

```tsx
interface RowKeyEditorProps {
  projectId: Project["id"];
  sourceId: DataSource["id"];
  row: number;
  fieldName: string;
  type: "string" | "number" | "integer";
  value: unknown;
}

function RowKeyEditor({ projectId, sourceId, row, fieldName, type, value }: RowKeyEditorProps) {
  const { t } = useTranslation();
  const setSourceValue = useAccountStore((state) => state.setSourceValue);
  const [draft, setDraft] = useState(String(value ?? ""));
  const [error, setError] = useState<"required" | "duplicate" | null>(null);

  useEffect(() => setDraft(String(value ?? "")), [value]);

  const commit = () => {
    const result = setSourceValue({
      projectId,
      sourceId,
      row,
      path: [fieldName],
      value: draft,
    });
    if (!result.ok) {
      setError(result.reason === "duplicate_row_key" ? "duplicate" : "required");
      setDraft(String(value ?? ""));
      return;
    }
    setError(null);
  };

  return (
    <div>
      <Input
        type={type === "string" ? "text" : "number"}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          setError(null);
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
        aria-label={fieldName}
        aria-invalid={error !== null}
      />
      {error ? (
        <p className="text-[10px] text-[var(--danger)]">
          {t(error === "duplicate" ? "dataSources.rowKeyDuplicate" : "dataSources.rowKeyRequired")}
        </p>
      ) : null}
    </div>
  );
}
```

Resolve the active model once in `SourceRowsTable`. When `f.name === model.keyField`, render `RowKeyEditor`; otherwise render the existing `ValueEditor`. Add locale entries:

```ts
// en.ts
rowKeyRequired: "The row ID is required.",
rowKeyDuplicate: "Another row already uses this ID.",

// fr.ts
rowKeyRequired: "L’ID de la ligne est obligatoire.",
rowKeyDuplicate: "Une ligne porte déjà cet ID.",
```

- [ ] **Step 4: Run UI/store regression tests and targeted lint**

Run:

```powershell
cd editor
npm.cmd test -- --run src/features/data/SourceValueEditor.test.tsx src/state/accountStore.test.ts src/domain/i18nSites.test.ts
.\node_modules\.bin\biome.cmd lint src/features/data/SourceValueEditor.tsx src/locales/en.ts src/locales/fr.ts --diagnostic-level=error
```

Expected: UI and store tests pass; Biome reports no new production lint errors.

- [ ] **Step 5: Commit only reviewed UI hunks**

```powershell
git add -p -- editor/src/features/data/SourceValueEditor.tsx editor/src/features/data/SourceValueEditor.test.tsx editor/src/locales/en.ts editor/src/locales/fr.ts
git diff --cached --check
git diff --cached
git commit -m "feat: report duplicate data source row IDs"
```

Expected: no unrelated pre-existing UI or locale hunks are staged.

### Task 4: Documentation and complete verification

**Files:**
- Modify: `docs/architecture/editor-internals.md`
- Modify: `docs/decisions/project-sources-and-data-models.md`
- Modify: `docs-site/src/content/docs/editor/data-sources.md`

**Interfaces:**
- Documents the generated Row-key policy, store-level uniqueness invariant, inline rejection, and defensive-only positional fallback.

- [ ] **Step 1: Update architecture and user documentation**

Document these exact behaviors:

```markdown
- New rows receive the first free positive integer when the Row key is numeric,
  or the first free `row_n` identifier when it is textual.
- Textual Row keys are stored lowercase after trimming and are unique
  case-insensitively within one source.
- Empty or duplicate edits are rejected inline without changing translations.
- `sources.<source>.<row-key>.<field>` uses the validated Row key; positional
  fallback exists only for legacy/imported invalid rows.
```

Keep the architecture detail in `editor-internals.md` and the ADR; phrase the docs-site paragraph for editor users.

- [ ] **Step 2: Run all focused tests**

Run:

```powershell
cd editor
npm.cmd test -- --run src/domain/dataSourceRowKeys.test.ts src/domain/i18nSites.test.ts src/state/accountStore.test.ts src/features/data/SourceValueEditor.test.tsx
```

Expected: all selected files and tests pass.

- [ ] **Step 3: Run the complete editor suite**

Run:

```powershell
cd editor
npm.cmd test -- --run
```

Expected: all editor test files pass; existing TanStack route-file and jsdom `scrollTo()` warnings may remain.

- [ ] **Step 4: Run the production build**

Run:

```powershell
cd editor
npm.cmd run build
```

Expected: TypeScript and Vite build successfully; existing dynamic-import and large-chunk warnings may remain.

- [ ] **Step 5: Check scoped lint and whitespace**

Run:

```powershell
cd editor
.\node_modules\.bin\biome.cmd lint src/domain/dataSourceRowKeys.ts src/state/accountStore.ts src/features/data/SourceValueEditor.tsx src/locales/en.ts src/locales/fr.ts --diagnostic-level=error
cd ..
git diff --check -- editor/src/domain/dataSourceRowKeys.ts editor/src/domain/dataSourceRowKeys.test.ts editor/src/state/accountStore.ts editor/src/state/accountStore.test.ts editor/src/features/data/SourceValueEditor.tsx editor/src/features/data/SourceValueEditor.test.tsx editor/src/locales/en.ts editor/src/locales/fr.ts docs/architecture/editor-internals.md docs/decisions/project-sources-and-data-models.md docs-site/src/content/docs/editor/data-sources.md
```

Expected: no new production lint errors or whitespace errors.

- [ ] **Step 6: Commit the reviewed documentation and any remaining feature hunks**

```powershell
git add -p -- docs/architecture/editor-internals.md docs/decisions/project-sources-and-data-models.md docs-site/src/content/docs/editor/data-sources.md
git diff --cached --check
git diff --cached
git commit -m "docs: document unique data source row keys"
```

Expected: documentation matches the verified behavior and unrelated dirty hunks remain unstaged.
