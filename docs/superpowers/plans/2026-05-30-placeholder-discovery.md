# Placeholder Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a `{`-triggered inline autocomplete for placeholder discovery in the editor's LText fields (title / lore / action text / dialog title), backed by a pure `PlaceholderCatalog`.

**Architecture:** Three units. (1) **`PlaceholderCatalog`** is a pure module: given a `Pack` and a `FieldLocation`, returns a flat list of `PlaceholderEntry` (name + type + sample + origin). (2) **`PlaceholderInput`** is a React wrapper around `<input>` / `<textarea>` that opens a caret-anchored popup on `{`, filters as the user types, and inserts the chosen entry. (3) **Adoption** replaces existing text inputs in 5 well-defined call sites.

**Tech Stack:** React 19 + Vite + Vitest, Zustand stores (accountStore for `pack`), TanStack Router for the workspace route, existing `buildPreviewScope` / `resolveSourceRef` / `coerceDefault` in `editor/src/features/canvas/menuPreviewScope.ts`. Tailwind v4 with Atelier tokens.

**Spec:** `docs/superpowers/specs/2026-05-30-placeholder-discovery-design.md`

---

## File structure

### Created

| File | Responsibility |
|---|---|
| `editor/src/lib/placeholderCatalog/types.ts` | `PlaceholderEntry`, `FieldLocation` type definitions |
| `editor/src/lib/placeholderCatalog/compute.ts` | `compute(pack, location)` — pure resolution |
| `editor/src/lib/placeholderCatalog/sample.ts` | Sample value derivation (re-uses `buildPreviewScope`) |
| `editor/src/lib/placeholderCatalog/index.ts` | Barrel export |
| `editor/src/lib/placeholderCatalog/compute.test.ts` | Catalog unit tests |
| `editor/src/lib/caretCoordinates.ts` | Pure DOM helper: caret pixel coordinates in `<input>` / `<textarea>` |
| `editor/src/components/PlaceholderInput.tsx` | The React wrapper component |
| `editor/src/components/PlaceholderInput.test.tsx` | Component integration tests |

### Modified

| File | What changes |
|---|---|
| `editor/src/locales/fr.ts` + `en.ts` | Add `placeholderInput.hint`, `.empty`, `.emptyNoContext` keys |
| `editor/src/features/flow/FlowCanvas.tsx` | Swap title `<input>` + lore `<textarea>` for `PlaceholderInput` |
| `editor/src/features/canvas/properties/ActionEditor.tsx` | Swap send_message + show_title + show_title.subtitle text inputs |
| `editor/src/features/canvas/title/composer/LayerEditForm.tsx` | Swap text layer + textarea layer text inputs |
| `editor/src/features/canvas/title/composer/PlainTitleForm.tsx` | Swap plain title input |
| `editor/src/features/canvas/title/composer/TextareaLayerForm.tsx` | Swap textarea input |
| Dialog editor file (locate during Task 22) | Swap dialog title + button send_message inputs |

---

## Phase A — `PlaceholderCatalog` (pure)

### Task 1: Define the type surface

**Files:**
- Create: `editor/src/lib/placeholderCatalog/types.ts`

- [ ] **Step 1: Write the type definitions**

```ts
// editor/src/lib/placeholderCatalog/types.ts
import type { ClickType, DialogId, ElementId, MenuId } from "@/domain/types";

/**
 * Locates a text field within the pack so the catalog knows which
 * placeholders are in scope. Tied to the domain entity layout (menu →
 * element → action; dialog → dialog-action).
 */
export type FieldLocation =
  | { kind: "menu"; menuId: MenuId }
  | { kind: "element"; menuId: MenuId; elementId: ElementId }
  | { kind: "action"; menuId: MenuId; elementId: ElementId; clickType: ClickType }
  | { kind: "dialog"; dialogId: DialogId }
  | { kind: "dialog-action"; dialogId: DialogId; buttonId: string };

export type PlaceholderType =
  | "player"
  | "string"
  | "integer"
  | "number"
  | "boolean"
  | "list"
  | "object";

export type PlaceholderOrigin = "context" | "iteration" | "pagination" | "source";

/**
 * One row in the autocomplete dropdown. Already flattened — an
 * `object`-typed source becomes one entry per leaf path.
 */
export interface PlaceholderEntry {
  /** Path to insert (no braces). E.g. "player", "quest.name", "pagination.page". */
  path: string;
  type: PlaceholderType;
  /** Rendered preview value. null when the sample can't be computed. */
  sample: string | null;
  origin: PlaceholderOrigin;
}
```

- [ ] **Step 2: Commit**

```bash
git add editor/src/lib/placeholderCatalog/types.ts
git commit -m "feat(catalog): define FieldLocation + PlaceholderEntry types"
```

---

### Task 2: Catalog skeleton + empty cases

**Files:**
- Create: `editor/src/lib/placeholderCatalog/compute.ts`
- Create: `editor/src/lib/placeholderCatalog/index.ts`
- Create: `editor/src/lib/placeholderCatalog/compute.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// editor/src/lib/placeholderCatalog/compute.test.ts
import { describe, expect, it } from "vitest";
import type { MenuId, Pack } from "@/domain/types";
import { compute } from "./compute";

const emptyPack = (): Pack => ({
  id: "p1" as Pack["id"],
  name: "p1",
  source: "user_created",
  createdAt: "2026-05-30",
  updatedAt: "2026-05-30",
  menus: [],
  commands: [],
  templates: [],
  assets: [],
  dataSources: [],
  importedConnectors: [],
  i18nKeys: {},
  defaultLang: "en",
  dialogs: [],
  canvasLayout: {},
});

describe("PlaceholderCatalog.compute", () => {
  it("returns [] for a menu location when the menu id is unknown", () => {
    const pack = emptyPack();
    const result = compute(pack, { kind: "menu", menuId: "missing" as MenuId });
    expect(result).toEqual([]);
  });

  it("returns [] for a menu with no contextInputs", () => {
    const pack = emptyPack();
    pack.menus.push({
      id: "m1" as MenuId,
      packId: pack.id,
      title: [],
      rows: 3,
      layers: [],
      contextInputs: [],
    });
    const result = compute(pack, { kind: "menu", menuId: "m1" as MenuId });
    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `cd editor && npx vitest run src/lib/placeholderCatalog/compute.test.ts`
Expected: FAIL with "Cannot find module './compute'".

- [ ] **Step 3: Minimal implementation**

```ts
// editor/src/lib/placeholderCatalog/compute.ts
import type { Pack } from "@/domain/types";
import type { FieldLocation, PlaceholderEntry } from "./types";

/**
 * Walk the pack and the requested location to produce a flat list of
 * placeholder entries the user can insert in this field. Pure — no
 * side effects, safe to call from useMemo.
 */
export function compute(pack: Pack, location: FieldLocation): PlaceholderEntry[] {
  switch (location.kind) {
    case "menu":
    case "element":
    case "action": {
      const menu = pack.menus.find((m) => m.id === location.menuId);
      if (!menu) return [];
      return [];
    }
    case "dialog":
    case "dialog-action":
      return [];
  }
}
```

```ts
// editor/src/lib/placeholderCatalog/index.ts
export { compute } from "./compute";
export type {
  FieldLocation,
  PlaceholderEntry,
  PlaceholderOrigin,
  PlaceholderType,
} from "./types";
```

- [ ] **Step 4: Run tests and verify they pass**

Run: `cd editor && npx vitest run src/lib/placeholderCatalog/compute.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add editor/src/lib/placeholderCatalog
git commit -m "feat(catalog): empty-case skeleton + first tests"
```

---

### Task 3: Primitive contextInputs → entries at menu / element / action scope

**Files:**
- Modify: `editor/src/lib/placeholderCatalog/compute.ts`
- Create: `editor/src/lib/placeholderCatalog/sample.ts`
- Modify: `editor/src/lib/placeholderCatalog/compute.test.ts`

- [ ] **Step 1: Add the failing test**

Append to `compute.test.ts`:

```ts
import type { ElementId } from "@/domain/types";

it("emits a primitive contextInput as a single entry with coerced sample", () => {
  const pack = emptyPack();
  pack.menus.push({
    id: "m1" as MenuId,
    packId: pack.id,
    title: [],
    rows: 3,
    layers: [],
    contextInputs: [
      { kind: "primitive", name: "player", type: "player", default: "Steve" },
      { kind: "primitive", name: "rank", type: "integer", default: "5" },
      { kind: "primitive", name: "active", type: "boolean", default: "true" },
    ],
  });
  const out = compute(pack, { kind: "menu", menuId: "m1" as MenuId });
  expect(out).toEqual([
    { path: "player", type: "player", sample: "Steve", origin: "context" },
    { path: "rank", type: "integer", sample: "5", origin: "context" },
    { path: "active", type: "boolean", sample: "true", origin: "context" },
  ]);
});

it("emits the same primitive entries when locating an element inside the menu", () => {
  const pack = emptyPack();
  pack.menus.push({
    id: "m1" as MenuId,
    packId: pack.id,
    title: [],
    rows: 3,
    layers: [
      {
        id: "l1" as Pack["menus"][number]["layers"][number]["id"],
        name: "default",
        elements: [
          { id: "e1" as ElementId, positions: "0", appearances: [] },
        ],
      },
    ],
    contextInputs: [
      { kind: "primitive", name: "player", type: "player", default: "Steve" },
    ],
  });
  const out = compute(pack, {
    kind: "element",
    menuId: "m1" as MenuId,
    elementId: "e1" as ElementId,
  });
  expect(out.map((e) => e.path)).toContain("player");
});
```

- [ ] **Step 2: Run and verify fail**

Run: `cd editor && npx vitest run src/lib/placeholderCatalog/compute.test.ts`
Expected: 2 new tests FAIL with empty array mismatch.

- [ ] **Step 3: Implementation**

```ts
// editor/src/lib/placeholderCatalog/sample.ts
import type { Pack } from "@/domain/types";
import { buildPreviewScope } from "@/features/canvas/menuPreviewScope";

/**
 * Render a sample value at `path` against the menu's preview scope. Returns
 * null when the path isn't resolvable or yields an unrenderable value.
 */
export function sampleForPath(
  pack: Pack,
  menuId: string,
  path: string,
): string | null {
  const menu = pack.menus.find((m) => m.id === menuId);
  if (!menu) return null;
  const scope = buildPreviewScope(menu, pack);
  const value = walkPath(scope, path);
  return renderSample(value);
}

function walkPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const part of path.split(".")) {
    if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function renderSample(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  // Objects / arrays don't render usefully inline — let the caller fall back.
  return null;
}
```

Update `compute.ts`:

```ts
// editor/src/lib/placeholderCatalog/compute.ts
import type { Menu, Pack } from "@/domain/types";
import { sampleForPath } from "./sample";
import type {
  FieldLocation,
  PlaceholderEntry,
  PlaceholderType,
} from "./types";

export function compute(pack: Pack, location: FieldLocation): PlaceholderEntry[] {
  switch (location.kind) {
    case "menu":
    case "element":
    case "action": {
      const menu = pack.menus.find((m) => m.id === location.menuId);
      if (!menu) return [];
      const out: PlaceholderEntry[] = [];
      collectMenuContextInputs(menu, pack, out);
      return out;
    }
    case "dialog":
    case "dialog-action":
      return [];
  }
}

function collectMenuContextInputs(
  menu: Menu,
  pack: Pack,
  out: PlaceholderEntry[],
): void {
  for (const input of menu.contextInputs ?? []) {
    if (input.kind === "primitive") {
      const type = input.type as PlaceholderType;
      out.push({
        path: input.name,
        type,
        sample: sampleForPath(pack, menu.id, input.name),
        origin: "context",
      });
    }
    // sourceRef branch comes in Task 4.
  }
}
```

- [ ] **Step 4: Run tests and verify pass**

Run: `cd editor && npx vitest run src/lib/placeholderCatalog/compute.test.ts`
Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add editor/src/lib/placeholderCatalog
git commit -m "feat(catalog): primitive contextInputs → entries with sample"
```

---

### Task 4: `sourceRef` contextInputs — flatten object types, omit lists at menu scope

**Files:**
- Modify: `editor/src/lib/placeholderCatalog/compute.ts`
- Modify: `editor/src/lib/placeholderCatalog/compute.test.ts`

- [ ] **Step 1: Add failing tests**

```ts
import type { DataSourceId, SourceRef } from "@/domain/types";

it("flattens an object-typed dataSource into one entry per leaf", () => {
  const pack = emptyPack();
  pack.dataSources.push({
    id: "ds1" as DataSourceId,
    name: "currentQuest",
    type: {
      kind: "object",
      fields: [
        { name: "name", type: { kind: "string" } },
        { name: "reward", type: { kind: "integer" } },
      ],
    },
    value: { name: "Tuer 10 zombies", reward: 500 },
  });
  pack.menus.push({
    id: "m1" as MenuId,
    packId: pack.id,
    title: [],
    rows: 3,
    layers: [],
    contextInputs: [
      { kind: "sourceRef", name: "quest", ref: "pack:ds1" as SourceRef },
    ],
  });
  const out = compute(pack, { kind: "menu", menuId: "m1" as MenuId });
  expect(out).toEqual([
    { path: "quest.name", type: "string", sample: "Tuer 10 zombies", origin: "context" },
    { path: "quest.reward", type: "integer", sample: "500", origin: "context" },
  ]);
});

it("omits list-typed contextInputs at menu scope (no useful single-value placement)", () => {
  const pack = emptyPack();
  pack.dataSources.push({
    id: "ds2" as DataSourceId,
    name: "questList",
    type: { kind: "list", of: { kind: "object", fields: [{ name: "name", type: { kind: "string" } }] } },
    value: [],
  });
  pack.menus.push({
    id: "m1" as MenuId,
    packId: pack.id,
    title: [],
    rows: 3,
    layers: [],
    contextInputs: [
      { kind: "sourceRef", name: "quests", ref: "pack:ds2" as SourceRef },
    ],
  });
  const out = compute(pack, { kind: "menu", menuId: "m1" as MenuId });
  expect(out).toEqual([]);
});
```

- [ ] **Step 2: Run and verify fail**

Run: `cd editor && npx vitest run src/lib/placeholderCatalog/compute.test.ts`
Expected: 2 new tests FAIL.

- [ ] **Step 3: Implementation — extend `compute.ts`**

Add to `collectMenuContextInputs`:

```ts
// editor/src/lib/placeholderCatalog/compute.ts (extending Task 3)
import type { FieldType } from "@/domain/types";
import { resolveSourceRef } from "@/features/canvas/menuPreviewScope";

function collectMenuContextInputs(menu, pack, out) {
  for (const input of menu.contextInputs ?? []) {
    if (input.kind === "primitive") {
      // …existing primitive path…
      continue;
    }
    // sourceRef
    const resolvedType = typeOfSourceRef(input.ref, pack);
    if (!resolvedType) continue; // deleted target — covered in Task 8
    if (resolvedType.kind === "list") {
      // Not directly usable at menu scope. Iteration alias will expose the
      // leaves later when an element wraps it in `iterates`.
      continue;
    }
    if (resolvedType.kind === "object") {
      for (const field of resolvedType.fields) {
        const path = `${input.name}.${field.name}`;
        out.push({
          path,
          type: fieldTypeToPlaceholderType(field.type),
          sample: sampleForPath(pack, menu.id, path),
          origin: "context",
        });
      }
      continue;
    }
    // primitive leaf (string / integer / number / boolean)
    out.push({
      path: input.name,
      type: fieldTypeToPlaceholderType(resolvedType),
      sample: sampleForPath(pack, menu.id, input.name),
      origin: "context",
    });
  }
}

function typeOfSourceRef(ref: string, pack: Pack): FieldType | null {
  const r = String(ref);
  if (r.startsWith("pack:")) {
    const id = r.slice("pack:".length);
    const ds = pack.dataSources.find((d) => d.id === id);
    return ds?.type ?? null;
  }
  const c = pack.importedConnectors.find((x) => x.ref === r);
  return c?.type ?? null;
}

function fieldTypeToPlaceholderType(t: FieldType): PlaceholderType {
  switch (t.kind) {
    case "string": return "string";
    case "integer": return "integer";
    case "number": return "number";
    case "boolean": return "boolean";
    case "list": return "list";
    case "object": return "object";
  }
}
```

- [ ] **Step 4: Run tests and verify pass**

Run: `cd editor && npx vitest run src/lib/placeholderCatalog/compute.test.ts`
Expected: 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add editor/src/lib/placeholderCatalog
git commit -m "feat(catalog): flatten sourceRef objects, omit lists at menu scope"
```

---

### Task 5: Element iteration alias + pagination entries

**Files:**
- Modify: `editor/src/lib/placeholderCatalog/compute.ts`
- Modify: `editor/src/lib/placeholderCatalog/compute.test.ts`

- [ ] **Step 1: Add failing tests**

```ts
it("emits iteration alias leaves + pagination when the element iterates over a list of objects", () => {
  const pack = emptyPack();
  pack.dataSources.push({
    id: "ds3" as DataSourceId,
    name: "quests",
    type: {
      kind: "list",
      of: {
        kind: "object",
        fields: [
          { name: "name", type: { kind: "string" } },
          { name: "reward", type: { kind: "integer" } },
        ],
      },
    },
    value: [{ name: "Q1", reward: 100 }],
  });
  pack.menus.push({
    id: "m1" as MenuId,
    packId: pack.id,
    title: [],
    rows: 3,
    layers: [
      {
        id: "l1" as Pack["menus"][number]["layers"][number]["id"],
        name: "default",
        elements: [
          {
            id: "e1" as ElementId,
            positions: "0,1,2",
            appearances: [],
            iterates: { source: "quests", alias: "quest" },
          },
        ],
      },
    ],
    contextInputs: [
      { kind: "sourceRef", name: "quests", ref: "pack:ds3" as SourceRef },
    ],
  });
  const out = compute(pack, {
    kind: "element",
    menuId: "m1" as MenuId,
    elementId: "e1" as ElementId,
  });
  expect(out).toEqual([
    { path: "quest.name", type: "string", sample: "Q1", origin: "iteration" },
    { path: "quest.reward", type: "integer", sample: "100", origin: "iteration" },
    { path: "pagination.page", type: "integer", sample: "1", origin: "pagination" },
    { path: "pagination.totalPages", type: "integer", sample: "1", origin: "pagination" },
  ]);
});

it("does not emit iteration / pagination entries when the element does not iterate", () => {
  const pack = emptyPack();
  pack.menus.push({
    id: "m1" as MenuId,
    packId: pack.id,
    title: [],
    rows: 3,
    layers: [
      {
        id: "l1" as Pack["menus"][number]["layers"][number]["id"],
        name: "default",
        elements: [
          { id: "e1" as ElementId, positions: "0", appearances: [] },
        ],
      },
    ],
    contextInputs: [],
  });
  const out = compute(pack, {
    kind: "element",
    menuId: "m1" as MenuId,
    elementId: "e1" as ElementId,
  });
  expect(out.filter((e) => e.origin === "iteration" || e.origin === "pagination")).toEqual([]);
});

it("action location returns the same scope as the parent element", () => {
  const pack = emptyPack();
  pack.menus.push({
    id: "m1" as MenuId,
    packId: pack.id,
    title: [],
    rows: 3,
    layers: [
      {
        id: "l1" as Pack["menus"][number]["layers"][number]["id"],
        name: "default",
        elements: [
          { id: "e1" as ElementId, positions: "0", appearances: [], iterates: { source: "list", alias: "item" } },
        ],
      },
    ],
    contextInputs: [],
  });
  const elementOut = compute(pack, {
    kind: "element",
    menuId: "m1" as MenuId,
    elementId: "e1" as ElementId,
  });
  const actionOut = compute(pack, {
    kind: "action",
    menuId: "m1" as MenuId,
    elementId: "e1" as ElementId,
    clickType: "left",
  });
  expect(actionOut.map((e) => e.path)).toEqual(elementOut.map((e) => e.path));
});
```

- [ ] **Step 2: Run and verify fail**

Run: `cd editor && npx vitest run src/lib/placeholderCatalog/compute.test.ts`
Expected: 3 new tests FAIL.

- [ ] **Step 3: Implementation — collect iteration + pagination**

```ts
// editor/src/lib/placeholderCatalog/compute.ts (add to compute)

case "element":
case "action": {
  const menu = pack.menus.find((m) => m.id === location.menuId);
  if (!menu) return [];
  const out: PlaceholderEntry[] = [];
  collectMenuContextInputs(menu, pack, out);
  const element = findElement(menu, location.elementId);
  if (element?.iterates) {
    collectIterationLeaves(element.iterates.source, element.iterates.alias, pack, menu.id, out);
    collectPagination(out);
  }
  return out;
}
```

Add the helpers:

```ts
function findElement(menu: Menu, elementId: string) {
  for (const layer of menu.layers) {
    for (const el of layer.elements) if (el.id === elementId) return el;
  }
  return undefined;
}

function collectIterationLeaves(
  sourcePath: string,
  alias: string,
  pack: Pack,
  menuId: string,
  out: PlaceholderEntry[],
): void {
  // Walk menu.contextInputs to find the FieldType of the iterated source.
  const menu = pack.menus.find((m) => m.id === menuId);
  if (!menu) return;
  const sourceInput = (menu.contextInputs ?? []).find(
    (i) => i.kind === "sourceRef" && i.name === sourcePath,
  );
  if (!sourceInput || sourceInput.kind !== "sourceRef") return;
  const type = typeOfSourceRef(sourceInput.ref, pack);
  if (!type || type.kind !== "list") return;
  const itemType = type.of;
  if (itemType.kind === "object") {
    for (const field of itemType.fields) {
      const leafPath = `${alias}.${field.name}`;
      out.push({
        path: leafPath,
        type: fieldTypeToPlaceholderType(field.type),
        sample: iterationSample(pack, menuId, sourcePath, alias, leafPath),
        origin: "iteration",
      });
    }
  } else {
    out.push({
      path: alias,
      type: fieldTypeToPlaceholderType(itemType),
      sample: iterationSample(pack, menuId, sourcePath, alias, alias),
      origin: "iteration",
    });
  }
}

function iterationSample(
  pack: Pack,
  menuId: string,
  sourcePath: string,
  alias: string,
  fullPath: string,
): string | null {
  const menu = pack.menus.find((m) => m.id === menuId);
  if (!menu) return null;
  const scope = buildPreviewScope(menu, pack);
  const list = walkPath(scope, sourcePath);
  if (!Array.isArray(list) || list.length === 0) return null;
  const enriched: Record<string, unknown> = { ...(scope as Record<string, unknown>), [alias]: list[0] };
  return renderSample(walkPath(enriched, fullPath));
}

function collectPagination(out: PlaceholderEntry[]): void {
  out.push({ path: "pagination.page", type: "integer", sample: "1", origin: "pagination" });
  out.push({ path: "pagination.totalPages", type: "integer", sample: "1", origin: "pagination" });
}
```

You'll also need to expose `walkPath` from `sample.ts`:

```ts
// editor/src/lib/placeholderCatalog/sample.ts — add export
export function walkPath(obj: unknown, path: string): unknown { /* (unchanged body from Task 3) */ }
export function renderSample(v: unknown): string | null { /* (unchanged) */ }
```

…and update the imports in `compute.ts`:

```ts
import { renderSample, sampleForPath, walkPath } from "./sample";
import { buildPreviewScope } from "@/features/canvas/menuPreviewScope";
```

- [ ] **Step 4: Run tests and verify pass**

Run: `cd editor && npx vitest run src/lib/placeholderCatalog/compute.test.ts`
Expected: 9 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add editor/src/lib/placeholderCatalog
git commit -m "feat(catalog): iteration alias leaves + pagination entries"
```

---

### Task 6: Dialog scope (empty for v1, branch present)

**Files:**
- Modify: `editor/src/lib/placeholderCatalog/compute.test.ts`

- [ ] **Step 1: Add tests asserting empty for both dialog kinds**

```ts
import type { DialogId } from "@/domain/types";

it("returns [] for dialog scope in v1 (dialog contextInputs not yet modeled)", () => {
  const pack = emptyPack();
  const out = compute(pack, { kind: "dialog", dialogId: "d1" as DialogId });
  expect(out).toEqual([]);
});

it("returns [] for dialog-action scope in v1", () => {
  const pack = emptyPack();
  const out = compute(pack, {
    kind: "dialog-action",
    dialogId: "d1" as DialogId,
    buttonId: "btn_confirm",
  });
  expect(out).toEqual([]);
});
```

- [ ] **Step 2: Run and verify they pass already**

Run: `cd editor && npx vitest run src/lib/placeholderCatalog/compute.test.ts`
Expected: PASS (the `compute` switch already returns `[]` for these cases — this task locks the behavior into the test contract).

- [ ] **Step 3: Commit**

```bash
git add editor/src/lib/placeholderCatalog/compute.test.ts
git commit -m "test(catalog): assert dialog scopes return [] in v1"
```

---

### Task 7: Deleted dataSource emits warn, omits entry

**Files:**
- Modify: `editor/src/lib/placeholderCatalog/compute.ts`
- Modify: `editor/src/lib/placeholderCatalog/compute.test.ts`

- [ ] **Step 1: Add failing test**

```ts
it("omits sourceRef inputs whose dataSource was deleted, and warns once per render", () => {
  const pack = emptyPack();
  pack.menus.push({
    id: "m1" as MenuId,
    packId: pack.id,
    title: [],
    rows: 3,
    layers: [],
    contextInputs: [
      { kind: "sourceRef", name: "ghost", ref: "pack:deleted" as SourceRef },
    ],
  });
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const out = compute(pack, { kind: "menu", menuId: "m1" as MenuId });
  expect(out).toEqual([]);
  expect(warn).toHaveBeenCalledTimes(1);
  expect(warn.mock.calls[0]![0]).toMatch(/deleted/);
  warn.mockRestore();
});
```

Add `import { vi } from "vitest";` to the top of `compute.test.ts` if not already.

- [ ] **Step 2: Run and verify fail**

Run: `cd editor && npx vitest run src/lib/placeholderCatalog/compute.test.ts`
Expected: FAIL (`console.warn` was not called).

- [ ] **Step 3: Implementation — warn in collectMenuContextInputs sourceRef branch**

Inside the sourceRef branch of `collectMenuContextInputs`:

```ts
const resolvedType = typeOfSourceRef(input.ref, pack);
if (!resolvedType) {
  console.warn(
    `[placeholderCatalog] menu "${menu.id}" contextInput "${input.name}" → sourceRef "${input.ref}" points at a deleted dataSource/connector. Omitted.`,
  );
  continue;
}
```

- [ ] **Step 4: Run and verify pass**

Run: `cd editor && npx vitest run src/lib/placeholderCatalog/compute.test.ts`
Expected: 10 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add editor/src/lib/placeholderCatalog
git commit -m "feat(catalog): warn + omit when sourceRef target is deleted"
```

---

### Task 8: Stable sort by origin → path

**Files:**
- Modify: `editor/src/lib/placeholderCatalog/compute.ts`
- Modify: `editor/src/lib/placeholderCatalog/compute.test.ts`

- [ ] **Step 1: Add failing test**

```ts
it("sorts entries by origin (context → iteration → pagination → source) then alpha by path", () => {
  const pack = emptyPack();
  pack.dataSources.push({
    id: "ds4" as DataSourceId,
    name: "quests",
    type: { kind: "list", of: { kind: "object", fields: [{ name: "name", type: { kind: "string" } }] } },
    value: [{ name: "Q1" }],
  });
  pack.menus.push({
    id: "m1" as MenuId,
    packId: pack.id,
    title: [],
    rows: 3,
    layers: [
      {
        id: "l1" as Pack["menus"][number]["layers"][number]["id"],
        name: "default",
        elements: [
          {
            id: "e1" as ElementId,
            positions: "0",
            appearances: [],
            iterates: { source: "quests", alias: "quest" },
          },
        ],
      },
    ],
    contextInputs: [
      { kind: "primitive", name: "zoo", type: "string" },
      { kind: "primitive", name: "alpha", type: "string" },
      { kind: "sourceRef", name: "quests", ref: "pack:ds4" as SourceRef },
    ],
  });
  const out = compute(pack, {
    kind: "element",
    menuId: "m1" as MenuId,
    elementId: "e1" as ElementId,
  });
  expect(out.map((e) => `${e.origin}:${e.path}`)).toEqual([
    "context:alpha",
    "context:zoo",
    "iteration:quest.name",
    "pagination:pagination.page",
    "pagination:pagination.totalPages",
  ]);
});
```

- [ ] **Step 2: Run and verify fail**

Run: `cd editor && npx vitest run src/lib/placeholderCatalog/compute.test.ts`
Expected: FAIL on ordering.

- [ ] **Step 3: Implementation — sort at the end of compute**

In `compute.ts`, after building the `out` array, before returning:

```ts
const ORDER: Record<PlaceholderEntry["origin"], number> = {
  context: 0,
  iteration: 1,
  pagination: 2,
  source: 3,
};
out.sort((a, b) => {
  if (ORDER[a.origin] !== ORDER[b.origin]) return ORDER[a.origin] - ORDER[b.origin];
  return a.path.localeCompare(b.path);
});
return out;
```

Apply this at both return sites for the menu/element/action branch.

- [ ] **Step 4: Run and verify pass**

Run: `cd editor && npx vitest run src/lib/placeholderCatalog/compute.test.ts`
Expected: 11 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add editor/src/lib/placeholderCatalog
git commit -m "feat(catalog): stable sort by origin then alpha path"
```

---

## Phase B — `PlaceholderInput` component

### Task 9: Caret coordinates helper

**Files:**
- Create: `editor/src/lib/caretCoordinates.ts`
- Create: `editor/src/lib/caretCoordinates.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// editor/src/lib/caretCoordinates.test.ts
import { describe, expect, it } from "vitest";
import { getCaretCoordinates } from "./caretCoordinates";

describe("getCaretCoordinates", () => {
  it("returns x, y, height for an input element (jsdom returns 0 sensibly)", () => {
    const input = document.createElement("input");
    input.value = "hello";
    document.body.appendChild(input);
    const c = getCaretCoordinates(input, 3);
    expect(typeof c.left).toBe("number");
    expect(typeof c.top).toBe("number");
    expect(c.height).toBeGreaterThanOrEqual(0);
    document.body.removeChild(input);
  });

  it("returns a sensible value for a textarea at end of text", () => {
    const ta = document.createElement("textarea");
    ta.value = "line1\nline2";
    document.body.appendChild(ta);
    const c = getCaretCoordinates(ta, ta.value.length);
    expect(typeof c.left).toBe("number");
    expect(typeof c.top).toBe("number");
    document.body.removeChild(ta);
  });
});
```

- [ ] **Step 2: Run and verify fail**

Run: `cd editor && npx vitest run src/lib/caretCoordinates.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implementation — mirror-div approach**

```ts
// editor/src/lib/caretCoordinates.ts

/**
 * Compute the pixel coordinates of the caret inside an <input> or
 * <textarea>, relative to the element's top-left. Uses the canonical
 * "mirror div" technique: create an off-screen div with the same text
 * + styles, drop a marker at the caret position, read its
 * `offsetTop`/`offsetLeft`. Cheap and accurate.
 *
 * Returns { left: 0, top: 0, height: 0 } in jsdom where layout is unavailable —
 * tests use role queries, not screen positions.
 */
export interface CaretCoords {
  left: number;
  top: number;
  height: number;
}

const COPIED_STYLES: (keyof CSSStyleDeclaration)[] = [
  "boxSizing",
  "width",
  "height",
  "overflowX",
  "overflowY",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "borderStyle",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "fontStyle",
  "fontVariant",
  "fontWeight",
  "fontStretch",
  "fontSize",
  "fontSizeAdjust",
  "lineHeight",
  "fontFamily",
  "textAlign",
  "textTransform",
  "textIndent",
  "textDecoration",
  "letterSpacing",
  "wordSpacing",
  "tabSize",
  "whiteSpace",
  "wordWrap",
  "wordBreak",
];

export function getCaretCoordinates(
  el: HTMLInputElement | HTMLTextAreaElement,
  position: number,
): CaretCoords {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return { left: 0, top: 0, height: 0 };
  }
  const isInput = el.nodeName === "INPUT";
  const mirror = document.createElement("div");
  mirror.id = "placeholder-input-mirror";
  document.body.appendChild(mirror);
  try {
    const style = mirror.style;
    style.whiteSpace = "pre-wrap";
    if (!isInput) style.wordWrap = "break-word";
    style.position = "absolute";
    style.visibility = "hidden";
    const computed = window.getComputedStyle(el);
    for (const key of COPIED_STYLES) {
      // jsdom may return "" for some — fall through, the mirror just becomes 0.
      (style as Record<string, unknown>)[key as string] = computed[key as string];
    }
    mirror.textContent = el.value.substring(0, position);
    if (isInput) mirror.textContent = mirror.textContent.replace(/\s/g, " ");
    const span = document.createElement("span");
    span.textContent = el.value.substring(position) || ".";
    mirror.appendChild(span);
    return {
      top: span.offsetTop,
      left: span.offsetLeft,
      height: parseInt(computed.lineHeight, 10) || parseInt(computed.fontSize, 10) || 16,
    };
  } finally {
    document.body.removeChild(mirror);
  }
}
```

- [ ] **Step 4: Run and verify pass**

Run: `cd editor && npx vitest run src/lib/caretCoordinates.test.ts`
Expected: 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add editor/src/lib/caretCoordinates.ts editor/src/lib/caretCoordinates.test.ts
git commit -m "feat: getCaretCoordinates helper for caret-anchored UI"
```

---

### Task 10: `PlaceholderInput` skeleton — open popup on `{`

**Files:**
- Create: `editor/src/components/PlaceholderInput.tsx`
- Create: `editor/src/components/PlaceholderInput.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// editor/src/components/PlaceholderInput.test.tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PlaceholderInput } from "./PlaceholderInput";
import type { PlaceholderEntry } from "@/lib/placeholderCatalog";

const entries: PlaceholderEntry[] = [
  { path: "player", type: "player", sample: "Steve", origin: "context" },
  { path: "quest.name", type: "string", sample: "Q1", origin: "iteration" },
];

describe("PlaceholderInput", () => {
  it("opens the popup when the user types {", () => {
    render(<PlaceholderInput value="" onChange={() => {}} entries={entries} />);
    const input = screen.getByRole("combobox");
    fireEvent.input(input, { target: { value: "{" } });
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(screen.getByText("player")).toBeInTheDocument();
    expect(screen.getByText("quest.name")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run and verify fail**

Run: `cd editor && npx vitest run src/components/PlaceholderInput.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implementation — skeleton**

```tsx
// editor/src/components/PlaceholderInput.tsx
import { useRef, useState } from "react";
import type { PlaceholderEntry } from "@/lib/placeholderCatalog";

interface Props {
  value: string;
  onChange: (v: string) => void;
  /** Pre-computed entries — the caller passes `compute(pack, location)`. */
  entries: PlaceholderEntry[];
  multiline?: boolean;
  placeholder?: string;
  showHint?: boolean;
}

/**
 * Text input with `{`-triggered placeholder autocomplete. The caller owns
 * the pack→entries computation (via the PlaceholderCatalog) so this stays
 * domain-agnostic and reusable.
 */
export function PlaceholderInput({ value, onChange, entries, multiline }: Props) {
  const ref = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const filtered = entries.filter((e) =>
    e.path.toLowerCase().includes(query.toLowerCase()),
  );

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const next = e.target.value;
    onChange(next);
    // Open whenever the last typed char is "{" and the popup wasn't already open.
    if (!open && next.length > value.length && next[next.length - 1] === "{") {
      setOpen(true);
      setQuery("");
      setHighlight(0);
    } else if (open) {
      // Track query as the user keeps typing after `{`.
      const lastBrace = next.lastIndexOf("{");
      if (lastBrace === -1) setOpen(false);
      else setQuery(next.slice(lastBrace + 1));
    }
  };

  const commonProps = {
    value,
    onChange: handleChange,
    role: "combobox" as const,
    "aria-expanded": open,
    "aria-controls": "placeholder-listbox",
  };

  return (
    <div style={{ position: "relative" }}>
      {multiline ? (
        <textarea ref={ref as React.RefObject<HTMLTextAreaElement>} {...commonProps} />
      ) : (
        <input ref={ref as React.RefObject<HTMLInputElement>} {...commonProps} />
      )}
      {open && (
        <ul role="listbox" id="placeholder-listbox">
          {filtered.map((e, i) => (
            <li key={e.path} aria-selected={i === highlight}>
              {e.path}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run and verify pass**

Run: `cd editor && npx vitest run src/components/PlaceholderInput.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add editor/src/components/PlaceholderInput.tsx editor/src/components/PlaceholderInput.test.tsx
git commit -m "feat(PlaceholderInput): skeleton opens popup on {"
```

---

### Task 11: Filter as user types, render type + sample columns

**Files:**
- Modify: `editor/src/components/PlaceholderInput.tsx`
- Modify: `editor/src/components/PlaceholderInput.test.tsx`

- [ ] **Step 1: Add failing tests**

```tsx
it("filters entries by query substring", () => {
  render(<PlaceholderInput value="" onChange={() => {}} entries={entries} />);
  const input = screen.getByRole("combobox");
  fireEvent.input(input, { target: { value: "{qu" } });
  expect(screen.queryByText("player")).not.toBeInTheDocument();
  expect(screen.getByText("quest.name")).toBeInTheDocument();
});

it("renders type + sample alongside the path", () => {
  render(<PlaceholderInput value="" onChange={() => {}} entries={entries} />);
  fireEvent.input(screen.getByRole("combobox"), { target: { value: "{" } });
  expect(screen.getByText("player")).toBeInTheDocument();
  expect(screen.getByText("Steve")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run and verify fail**

Expected: second test FAIL (sample not rendered).

- [ ] **Step 3: Implementation — extend the list row**

Replace the `<li>` body with:

```tsx
<li
  key={e.path}
  id={`placeholder-row-${e.path}`}
  role="option"
  aria-selected={i === highlight}
>
  <span className="name">{e.path}</span>
  <span className="type">{e.type}</span>
  {e.sample !== null ? <span className="sample">{e.sample}</span> : <span className="sample">—</span>}
  <span className="origin">{e.origin}</span>
</li>
```

- [ ] **Step 4: Run and verify pass**

Run: `cd editor && npx vitest run src/components/PlaceholderInput.test.tsx`
Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add editor/src/components/PlaceholderInput.tsx editor/src/components/PlaceholderInput.test.tsx
git commit -m "feat(PlaceholderInput): filter by query + render type/sample columns"
```

---

### Task 12: Keyboard navigation + Tab/Enter insert

**Files:**
- Modify: `editor/src/components/PlaceholderInput.tsx`
- Modify: `editor/src/components/PlaceholderInput.test.tsx`

- [ ] **Step 1: Add failing tests**

```tsx
it("Tab inserts the highlighted entry and closes the popup", () => {
  const calls: string[] = [];
  const { rerender } = render(
    <PlaceholderInput value="" onChange={(v) => calls.push(v)} entries={entries} />,
  );
  const input = screen.getByRole("combobox");
  fireEvent.input(input, { target: { value: "{" } });
  rerender(<PlaceholderInput value="{" onChange={(v) => calls.push(v)} entries={entries} />);
  fireEvent.keyDown(input, { key: "Tab" });
  expect(calls).toContain("{player}");
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
});

it("ArrowDown moves the highlight, Enter inserts the second entry", () => {
  const calls: string[] = [];
  const { rerender } = render(
    <PlaceholderInput value="" onChange={(v) => calls.push(v)} entries={entries} />,
  );
  const input = screen.getByRole("combobox");
  fireEvent.input(input, { target: { value: "{" } });
  rerender(<PlaceholderInput value="{" onChange={(v) => calls.push(v)} entries={entries} />);
  fireEvent.keyDown(input, { key: "ArrowDown" });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(calls).toContain("{quest.name}");
});
```

- [ ] **Step 2: Run and verify fail**

Expected: FAIL.

- [ ] **Step 3: Implementation — keyDown handler**

Add to the component:

```tsx
const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
  if (!open) return;
  if (e.key === "ArrowDown") {
    e.preventDefault();
    setHighlight((h) => Math.min(filtered.length - 1, h + 1));
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    setHighlight((h) => Math.max(0, h - 1));
  } else if (e.key === "Tab" || e.key === "Enter") {
    e.preventDefault();
    const pick = filtered[highlight];
    if (!pick) {
      setOpen(false);
      return;
    }
    insertAtCaret(pick.path);
  }
};

const insertAtCaret = (path: string) => {
  const el = ref.current;
  if (!el) return;
  // Replace from the most recent `{` (and any partial query already typed) up
  // to the caret with `{path}`. Then close.
  const caret = el.selectionStart ?? value.length;
  const head = value.slice(0, caret);
  const lastBrace = head.lastIndexOf("{");
  if (lastBrace === -1) return;
  const newValue = value.slice(0, lastBrace) + `{${path}}` + value.slice(caret);
  onChange(newValue);
  setOpen(false);
  setQuery("");
};
```

Then wire it on the input/textarea: `onKeyDown={handleKeyDown}`.

- [ ] **Step 4: Run and verify pass**

Run: `cd editor && npx vitest run src/components/PlaceholderInput.test.tsx`
Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add editor/src/components/PlaceholderInput.tsx editor/src/components/PlaceholderInput.test.tsx
git commit -m "feat(PlaceholderInput): keyboard navigation + Tab/Enter inserts"
```

---

### Task 13: Esc, space, `}`, click-outside close behaviors

**Files:**
- Modify: `editor/src/components/PlaceholderInput.tsx`
- Modify: `editor/src/components/PlaceholderInput.test.tsx`

- [ ] **Step 1: Add failing tests**

```tsx
it("Esc closes the popup without insertion (the { stays)", () => {
  const calls: string[] = [];
  render(<PlaceholderInput value="" onChange={(v) => calls.push(v)} entries={entries} />);
  const input = screen.getByRole("combobox");
  fireEvent.input(input, { target: { value: "{" } });
  fireEvent.keyDown(input, { key: "Escape" });
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  expect(calls.at(-1)).toBe("{");
});

it("typing } closes the popup without auto-insertion", () => {
  const { rerender } = render(<PlaceholderInput value="" onChange={() => {}} entries={entries} />);
  const input = screen.getByRole("combobox");
  fireEvent.input(input, { target: { value: "{" } });
  rerender(<PlaceholderInput value="{" onChange={() => {}} entries={entries} />);
  fireEvent.input(input, { target: { value: "{}" } });
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
});

it("backspacing past the original { closes the popup", () => {
  const { rerender } = render(<PlaceholderInput value="" onChange={() => {}} entries={entries} />);
  const input = screen.getByRole("combobox");
  fireEvent.input(input, { target: { value: "{" } });
  rerender(<PlaceholderInput value="{" onChange={() => {}} entries={entries} />);
  fireEvent.input(input, { target: { value: "" } });
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run and verify fail**

Expected: FAIL.

- [ ] **Step 3: Implementation — extend `handleKeyDown` and `handleChange`**

In `handleKeyDown`, before the navigation block:

```tsx
if (e.key === "Escape") {
  e.preventDefault();
  setOpen(false);
  setQuery("");
  return;
}
```

In `handleChange`, when `open` is true, broaden the close conditions:

```tsx
} else if (open) {
  const lastBrace = next.lastIndexOf("{");
  if (lastBrace === -1) {
    setOpen(false);
    return;
  }
  const tail = next.slice(lastBrace + 1);
  // Close if the user added a closing brace, a space, or a newline.
  if (/[}\s]/.test(tail)) {
    setOpen(false);
    return;
  }
  setQuery(tail);
}
```

- [ ] **Step 4: Run and verify pass**

Run: `cd editor && npx vitest run src/components/PlaceholderInput.test.tsx`
Expected: 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add editor/src/components/PlaceholderInput.tsx editor/src/components/PlaceholderInput.test.tsx
git commit -m "feat(PlaceholderInput): Esc / } / space / backspace close behaviors"
```

---

### Task 14: Empty state + hint line

**Files:**
- Modify: `editor/src/components/PlaceholderInput.tsx`
- Modify: `editor/src/components/PlaceholderInput.test.tsx`
- Modify: `editor/src/locales/fr.ts`
- Modify: `editor/src/locales/en.ts`

- [ ] **Step 1: Add i18n keys**

Append inside the existing top-level object of `fr.ts`:

```ts
  placeholderInput: {
    hint: "Tape « { » pour insérer une variable",
    emptyMatch: "Aucune variable ne matche « {{query}} »",
    emptyContext: "Aucune variable disponible dans ce contexte",
  },
```

And the English equivalents in `en.ts`:

```ts
  placeholderInput: {
    hint: 'Type "{" to insert a variable',
    emptyMatch: 'No variable matches "{{query}}"',
    emptyContext: "No variable available in this context",
  },
```

- [ ] **Step 2: Add failing tests**

```tsx
it("shows the empty-match row when query filters all out", () => {
  render(<PlaceholderInput value="" onChange={() => {}} entries={entries} />);
  const input = screen.getByRole("combobox");
  fireEvent.input(input, { target: { value: "{xyz" } });
  expect(screen.getByText(/xyz/)).toBeInTheDocument();
});

it("shows the no-context message when there are zero entries to begin with", () => {
  render(<PlaceholderInput value="" onChange={() => {}} entries={[]} />);
  const input = screen.getByRole("combobox");
  fireEvent.input(input, { target: { value: "{" } });
  expect(screen.getByText(/disponible|available/i)).toBeInTheDocument();
});

it("renders the hint below the input when entries is non-empty and the popup is closed", () => {
  render(<PlaceholderInput value="" onChange={() => {}} entries={entries} />);
  expect(screen.getByText(/inserer|insert/i)).toBeInTheDocument();
});

it("hides the hint while the popup is open", () => {
  render(<PlaceholderInput value="" onChange={() => {}} entries={entries} />);
  fireEvent.input(screen.getByRole("combobox"), { target: { value: "{" } });
  // The popup is open; the hint should disappear so we don't show both at once.
  expect(screen.queryAllByText(/inserer|insert/i)).toHaveLength(0);
});

it("does not render the hint when entries is empty", () => {
  render(<PlaceholderInput value="" onChange={() => {}} entries={[]} />);
  expect(screen.queryByText(/inserer|insert/i)).not.toBeInTheDocument();
});
```

Top of the test file, ensure i18n is initialized:

```ts
import "@/i18n";
```

- [ ] **Step 3: Run and verify fail**

Run: `cd editor && npx vitest run src/components/PlaceholderInput.test.tsx`
Expected: FAIL.

- [ ] **Step 4: Implementation — empty rows + hint**

```tsx
import { useTranslation } from "react-i18next";

export function PlaceholderInput({ value, onChange, entries, multiline, showHint = true }: Props) {
  const { t } = useTranslation();
  // …existing state…

  return (
    <div style={{ position: "relative" }}>
      {/* …input or textarea… */}
      {open && (
        <ul role="listbox" id="placeholder-listbox" className="placeholder-popup">
          {filtered.length === 0 ? (
            <li className="empty" role="option" aria-selected={false}>
              {entries.length === 0
                ? t("placeholderInput.emptyContext")
                : t("placeholderInput.emptyMatch", { query })}
            </li>
          ) : (
            filtered.map((e, i) => (/* …existing row… */))
          )}
        </ul>
      )}
      {showHint && !open && entries.length > 0 && (
        <p className="placeholder-hint text-[11px] text-[var(--ink-faint)]">
          {t("placeholderInput.hint")}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run and verify pass**

Run: `cd editor && npx vitest run src/components/PlaceholderInput.test.tsx`
Expected: 13 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add editor/src/components/PlaceholderInput.tsx \
         editor/src/components/PlaceholderInput.test.tsx \
         editor/src/locales/fr.ts editor/src/locales/en.ts
git commit -m "feat(PlaceholderInput): empty-state rows + inline hint i18n'd"
```

---

### Task 15: Atelier styling + caret-anchored positioning

**Files:**
- Modify: `editor/src/components/PlaceholderInput.tsx`
- Modify: `editor/src/styles/globals.css`

- [ ] **Step 1: Add the CSS classes**

Append to `editor/src/styles/globals.css`:

```css
/* Placeholder autocomplete ------------------------------------------------- */
.placeholder-popup {
  position: absolute;
  z-index: 30;
  min-width: 260px;
  max-height: 220px;
  overflow-y: auto;
  margin: 4px 0 0;
  padding: 4px;
  list-style: none;
  background: var(--card-surface);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  box-shadow: var(--sh-2);
}
.placeholder-popup li {
  display: grid;
  grid-template-columns: 1fr auto auto auto;
  gap: 8px;
  align-items: baseline;
  padding: 4px 8px;
  border-radius: 6px;
  cursor: pointer;
  font-family: var(--font-mono);
  font-size: 11.5px;
}
.placeholder-popup li[aria-selected="true"] { background: var(--hover); }
.placeholder-popup li .name { color: var(--terra); }
.placeholder-popup li .type { color: var(--ink-faint); font-size: 10px; }
.placeholder-popup li .sample { color: var(--ink-mut); font-size: 10px; }
.placeholder-popup li .origin {
  color: var(--ink-faint); font-size: 9px; text-transform: uppercase;
  letter-spacing: .08em;
}
.placeholder-popup li.empty {
  grid-template-columns: 1fr;
  color: var(--ink-mut);
  font-style: italic;
  cursor: default;
}
.placeholder-hint {
  margin: 4px 0 0;
  font-family: var(--font-mono);
}
.placeholder-hint code {
  background: var(--inset);
  padding: 0 4px;
  border-radius: 4px;
  color: var(--sand);
}
```

- [ ] **Step 2: Apply caret positioning in the component**

In `PlaceholderInput.tsx`:

```tsx
import { getCaretCoordinates } from "@/lib/caretCoordinates";

const [popupPos, setPopupPos] = useState({ left: 0, top: 0 });

// In handleChange, when opening:
if (!open && next.length > value.length && next[next.length - 1] === "{") {
  setOpen(true);
  setQuery("");
  setHighlight(0);
  // Anchor the popup to the caret.
  requestAnimationFrame(() => {
    const el = ref.current;
    if (!el) return;
    const c = getCaretCoordinates(el, el.selectionStart ?? next.length);
    setPopupPos({ left: c.left, top: c.top + c.height + 2 });
  });
}
```

And the `<ul>` style:

```tsx
<ul
  role="listbox"
  id="placeholder-listbox"
  className="placeholder-popup"
  style={{ left: popupPos.left, top: popupPos.top }}
>
```

- [ ] **Step 3: Run the existing tests + ensure nothing regresses**

Run: `cd editor && npx vitest run src/components/PlaceholderInput.test.tsx`
Expected: 13 tests PASS.

- [ ] **Step 4: Commit**

```bash
git add editor/src/components/PlaceholderInput.tsx editor/src/styles/globals.css
git commit -m "feat(PlaceholderInput): Atelier styling + caret-anchored popup"
```

---

### Task 16: Click-outside closes the popup

**Files:**
- Modify: `editor/src/components/PlaceholderInput.tsx`
- Modify: `editor/src/components/PlaceholderInput.test.tsx`

- [ ] **Step 1: Add failing test**

```tsx
it("clicking outside closes the popup", () => {
  render(
    <>
      <PlaceholderInput value="" onChange={() => {}} entries={entries} />
      <div data-testid="outside">outside</div>
    </>,
  );
  fireEvent.input(screen.getByRole("combobox"), { target: { value: "{" } });
  fireEvent.mouseDown(screen.getByTestId("outside"));
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run and verify fail**

Expected: FAIL.

- [ ] **Step 3: Implementation — outside-click hook**

```tsx
import { useEffect, useRef } from "react";

// In the component body:
const wrapperRef = useRef<HTMLDivElement>(null);
useEffect(() => {
  if (!open) return;
  const handler = (e: MouseEvent) => {
    if (!wrapperRef.current) return;
    if (wrapperRef.current.contains(e.target as Node)) return;
    setOpen(false);
  };
  document.addEventListener("mousedown", handler);
  return () => document.removeEventListener("mousedown", handler);
}, [open]);

// Wrap the root in the ref:
return <div ref={wrapperRef} style={{ position: "relative" }}>{/* … */}</div>;
```

- [ ] **Step 4: Run and verify pass**

Run: `cd editor && npx vitest run src/components/PlaceholderInput.test.tsx`
Expected: 14 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add editor/src/components/PlaceholderInput.tsx editor/src/components/PlaceholderInput.test.tsx
git commit -m "feat(PlaceholderInput): outside-click closes the popup"
```

---

## Phase C — Adoption

### Task 17: Helper to compute entries from `(pack, location)` in components

**Files:**
- Create: `editor/src/components/usePlaceholderEntries.ts`

- [ ] **Step 1: Write the hook**

```ts
// editor/src/components/usePlaceholderEntries.ts
import { useMemo } from "react";
import { useAccountStore } from "@/state/accountStore";
import { compute, type FieldLocation, type PlaceholderEntry } from "@/lib/placeholderCatalog";
import type { PackId } from "@/domain/types";

/**
 * Subscribe to the active pack and recompute the placeholder catalog when
 * either the pack ref or the field location changes. Callers pass the
 * resulting `entries` array into `<PlaceholderInput entries={...} />`.
 */
export function usePlaceholderEntries(
  packId: PackId,
  location: FieldLocation,
): PlaceholderEntry[] {
  const pack = useAccountStore((s) => s.account.packs.find((p) => p.id === packId));
  return useMemo(() => (pack ? compute(pack, location) : []), [pack, location]);
}
```

- [ ] **Step 2: Commit**

```bash
git add editor/src/components/usePlaceholderEntries.ts
git commit -m "feat: usePlaceholderEntries hook (subscribe + memoize)"
```

---

### Task 18: Adopt in ElementEditor — title field

**Files:**
- Modify: `editor/src/features/flow/FlowCanvas.tsx`

- [ ] **Step 1: Locate the title `<input>` in the element editor**

Run: `grep -n "title.*onChange\|Title.*onChange\|setText.*title" editor/src/features/flow/FlowCanvas.tsx | head`

Identify the line where the title text input renders — it's the `<input>` near `t("flow.titleLabel"…)` inside the element/appearance editor block.

- [ ] **Step 2: Swap to `PlaceholderInput`**

Replace the title `<input>` with:

```tsx
<PlaceholderInput
  value={titleDraft}
  onChange={(v) => { setTitleDraft(v); updateTitle(v); }}
  entries={usePlaceholderEntries(packId, {
    kind: "element",
    menuId: menu.id,
    elementId: element.id,
  })}
  placeholder={t("flow.titlePlaceholder")}
/>
```

Imports:

```tsx
import { PlaceholderInput } from "@/components/PlaceholderInput";
import { usePlaceholderEntries } from "@/components/usePlaceholderEntries";
```

- [ ] **Step 3: Run the existing FlowCanvas tests**

Run: `cd editor && npx vitest run src/features/flow`
Expected: All existing tests PASS (no behavior regression).

- [ ] **Step 4: Commit**

```bash
git add editor/src/features/flow/FlowCanvas.tsx
git commit -m "feat(ElementEditor): title field uses PlaceholderInput"
```

---

### Task 19: Adopt in ElementEditor — lore textarea

**Files:**
- Modify: `editor/src/features/flow/FlowCanvas.tsx`

- [ ] **Step 1: Swap the lore `<textarea>`**

Same as Task 18 but with `multiline`:

```tsx
<PlaceholderInput
  multiline
  value={loreDraft}
  onChange={(v) => { setLoreDraft(v); updateLore(v.replace(/\n+$/, "")); }}
  entries={usePlaceholderEntries(packId, {
    kind: "element",
    menuId: menu.id,
    elementId: element.id,
  })}
  placeholder={t("flow.lorePlaceholder")}
/>
```

Preserve the existing `onFocus` / `onBlur` semantics — wrap `PlaceholderInput` if needed, or extend `Props` to forward them in a follow-up. For v1 if the focus/blur logic touches selectionStore (`setSub({ kind: "state", stateIndex })`), forward `onFocus` and `onBlur` via Props and call the textarea handlers internally.

(If `onFocus`/`onBlur` aren't already in `PlaceholderInput`'s `Props`, add them now and forward them to the inner element.)

- [ ] **Step 2: Run tests**

Run: `cd editor && npx vitest run src/features/flow`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add editor/src/features/flow/FlowCanvas.tsx editor/src/components/PlaceholderInput.tsx
git commit -m "feat(ElementEditor): lore textarea uses PlaceholderInput"
```

---

### Task 20: Adopt in ActionEditor — send_message text

**Files:**
- Modify: `editor/src/features/canvas/properties/ActionEditor.tsx`

- [ ] **Step 1: Find the send_message text input**

Run: `grep -n "send_message\|setText.*action" editor/src/features/canvas/properties/ActionEditor.tsx | head`

- [ ] **Step 2: Swap**

```tsx
<PlaceholderInput
  value={action.text.value ?? ""}
  onChange={(v) => onChange({ ...action, text: { ...action.text, value: v } })}
  entries={usePlaceholderEntries(packId, location)}
/>
```

`location` is `{ kind: "action", menuId, elementId, clickType }` — wire it from the parent component's props.

- [ ] **Step 3: Run tests**

Run: `cd editor && npx vitest run src/features/canvas/properties`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add editor/src/features/canvas/properties/ActionEditor.tsx
git commit -m "feat(ActionEditor): send_message text uses PlaceholderInput"
```

---

### Task 21: Adopt in ActionEditor — show_title title + subtitle

**Files:**
- Modify: `editor/src/features/canvas/properties/ActionEditor.tsx`

- [ ] **Step 1: Find the show_title fields**

Run: `grep -n "show_title\|action.title\|action.subtitle" editor/src/features/canvas/properties/ActionEditor.tsx`

- [ ] **Step 2: Swap both inputs** (same pattern as Task 20).

- [ ] **Step 3: Run tests**

Run: `cd editor && npx vitest run src/features/canvas/properties`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add editor/src/features/canvas/properties/ActionEditor.tsx
git commit -m "feat(ActionEditor): show_title fields use PlaceholderInput"
```

---

### Task 22: Adopt in MenuTitleComposer — text + plain + textarea layers

**Files:**
- Modify: `editor/src/features/canvas/title/composer/LayerEditForm.tsx`
- Modify: `editor/src/features/canvas/title/composer/PlainTitleForm.tsx`
- Modify: `editor/src/features/canvas/title/composer/TextareaLayerForm.tsx`

- [ ] **Step 1: Swap the text inputs in each form**

Pattern for each:

```tsx
<PlaceholderInput
  value={lTextValue(layer.value, activeLang)}
  onChange={(v) => updateText(v)}
  entries={usePlaceholderEntries(packId, { kind: "menu", menuId: menu.id })}
  multiline={isTextareaLayer}
/>
```

Note: menu title fields use `{ kind: "menu" }` (no element scope) since the title resolves with menu.contextInputs only.

- [ ] **Step 2: Run tests**

Run: `cd editor && npx vitest run src/features/canvas/title/composer`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add editor/src/features/canvas/title/composer
git commit -m "feat(TitleComposer): text/plain/textarea layers use PlaceholderInput"
```

---

### Task 23: Adopt in dialog editor (title + button send_message)

**Files:**
- Locate via `grep -rn "DialogEditor\|dialog.title\|button.label" editor/src/features` and modify the discovered editor file.

- [ ] **Step 1: Swap dialog title and dialog button send_message text inputs**

Use `{ kind: "dialog", dialogId }` for dialog title, `{ kind: "dialog-action", dialogId, buttonId }` for button actions. In v1 these return `[]` — the field still shows the hint (gracefully hidden because `entries.length === 0`).

- [ ] **Step 2: Run tests**

Run: `cd editor && npx vitest run src/features` and any dialog-related test files.
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add editor/src/features
git commit -m "feat(DialogEditor): title + button actions use PlaceholderInput"
```

---

### Task 24: Full regression + manual verification

- [ ] **Step 1: Run the whole suite**

Run: `cd editor && npx vitest run --no-coverage`
Expected: All tests PASS (existing 876 + new tests from Phase A & B).

- [ ] **Step 2: Manual verification (per spec)**

```bash
cd /path/to/Artisan && docker compose restart editor
```

Then in the browser at `http://localhost:5173`:

1. Open a workspace.
2. Click an element with an editable title.
3. Type `{` — dropdown appears anchored at the caret.
4. Type `pl` — entries filter to those containing "pl".
5. ↓ then Tab — entry inserted, popup closes.
6. Add a `contextInput` to the menu via the menu editor — re-trigger `{` — new entry appears.
7. Toggle `iterates` on the element with `{source: "quests", alias: "quest"}` — re-trigger `{` — `quest.<leaf>` + `pagination.*` entries appear.
8. Delete the data source referenced by a `sourceRef` contextInput — re-trigger — entry is omitted; `console.warn` shows once.

- [ ] **Step 3: Final commit if any tweaks needed**

```bash
git add -A && git commit -m "chore(placeholder): polish after manual smoke"
# (skip if nothing changed)
```

---

## Self-review checklist (already done while writing)

- **Spec coverage** — all 8 spec sections map to tasks: types & catalog (T1–T8), `getCaretCoordinates` (T9), `PlaceholderInput` lifecycle (T10–T16), adoption per call site (T17–T23), regression (T24). ✓
- **No placeholders** — every step has full code blocks; no "TBD" / "add appropriate handling". ✓
- **Type consistency** — `PlaceholderEntry.path` used uniformly; `FieldLocation.kind` enum matches catalog dispatch; `compute(pack, location)` signature stable across tasks. ✓
