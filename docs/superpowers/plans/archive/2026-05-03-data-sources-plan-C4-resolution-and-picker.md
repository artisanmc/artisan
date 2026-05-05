# Data Sources Redesign — Plan C4: Source resolution + picker

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire sourceRef inputs into the live preview by resolving `pack:<id>` → `pack.dataSources[id].value` and `<plugin>:<name>` → `pack.importedConnectors[ref].sample`. Replace the raw text input on `ContextInput { kind: "sourceRef" }` with a dropdown picker listing available sources. Both pieces close the loop on Plans C1-C3 — sourceRef inputs become visible in preview and easy to set up.

**Architecture:** A new `resolveSourceRef(ref, pack)` helper in `web/src/features/canvas/menuPreviewScope.ts` returns the resolved value or undefined. `MenuGroup.tsx` and `ItemTooltip.tsx` use it to populate preview scopes for sourceRef inputs (today: skipped). `MenuProperties.tsx`'s `SourceRefInputRow` swaps its raw `<Input>` for a `<DropdownMenu>` listing the pack's dataSources and importedConnectors, with a "custom ref..." escape hatch (still typeable) for refs that aren't yet present.

**Tech Stack:** React 19, existing shadcn `<DropdownMenu>`, no new deps.

**Spec reference:** `docs/superpowers/specs/2026-05-03-data-sources-redesign-design.md` §1.4 (live references), §3.5 (resolution algorithm), §2.7 (referencing from menu).

**Out of scope:** Recursive schema/value editors (C2.1).

---

## File Structure

```
web/src/features/canvas/
├── menuPreviewScope.ts                 # NEW — resolveSourceRef + buildPreviewScope helpers
├── menuPreviewScope.test.ts            # NEW
├── MenuGroup.tsx                       # Modify — use buildPreviewScope
└── ItemTooltip.tsx                     # Modify — use buildPreviewScope (if it duplicates the logic)

web/src/features/canvas/properties/
└── MenuProperties.tsx                  # Modify — SourceRefInputRow gets a dropdown picker

web/src/locales/{en,fr}.ts              # Modify — keys for picker labels
```

---

## Task 1: resolveSourceRef + buildPreviewScope

**Files:**
- Create: `web/src/features/canvas/menuPreviewScope.ts`
- Create: `web/src/features/canvas/menuPreviewScope.test.ts`

- [ ] **Step 1: Write tests**

```typescript
// web/src/features/canvas/menuPreviewScope.test.ts
import type { ContextInput, DataSource, DataSourceId, Menu, Pack, SourceRef } from "@/domain/types";
import { describe, expect, it } from "vitest";
import { buildPreviewScope, resolveSourceRef } from "./menuPreviewScope";

const stubPack = (overrides: Partial<Pack> = {}): Pack =>
  ({
    id: "p1" as Pack["id"],
    name: "Test pack",
    source: "user_created",
    createdAt: "",
    updatedAt: "",
    menus: [],
    commands: [],
    templates: [],
    assets: [],
    dataSources: [],
    importedConnectors: [],
    i18nKeys: {},
    defaultLang: "en",
    canvasLayout: {},
    ...overrides,
  }) as Pack;

const stubMenu = (inputs: ContextInput[] = []): Menu =>
  ({
    id: "m1" as Menu["id"],
    packId: "p1" as Menu["packId"],
    title: { key: "k" } as Menu["title"],
    rows: 6,
    layers: [],
    contextInputs: inputs,
  }) as Menu;

describe("resolveSourceRef", () => {
  it("returns the dataSource value for a pack:<id> ref", () => {
    const ds: DataSource = {
      id: "categories" as DataSourceId,
      name: "Categories",
      type: { kind: "list", of: { kind: "string" } },
      value: ["weapon", "armor"],
    };
    const pack = stubPack({ dataSources: [ds] });
    expect(resolveSourceRef("pack:categories" as SourceRef, pack)).toEqual(["weapon", "armor"]);
  });

  it("returns the connector sample for a <plugin>:<source> ref", () => {
    const pack = stubPack({
      importedConnectors: [
        { ref: "chestshop:items", type: { kind: "list", of: { kind: "string" } }, sample: ["a"] },
      ],
    });
    expect(resolveSourceRef("chestshop:items" as SourceRef, pack)).toEqual(["a"]);
  });

  it("returns undefined for unknown pack ref", () => {
    expect(resolveSourceRef("pack:missing" as SourceRef, stubPack())).toBeUndefined();
  });

  it("returns undefined for unknown connector ref", () => {
    expect(resolveSourceRef("chestshop:bogus" as SourceRef, stubPack())).toBeUndefined();
  });

  it("returns undefined for empty / malformed ref", () => {
    expect(resolveSourceRef("" as SourceRef, stubPack())).toBeUndefined();
    expect(resolveSourceRef("no_colon" as SourceRef, stubPack())).toBeUndefined();
  });
});

describe("buildPreviewScope", () => {
  it("builds an empty scope for a menu with no inputs", () => {
    expect(buildPreviewScope(stubMenu(), stubPack())).toEqual({});
  });

  it("includes primitive input default coerced to its type", () => {
    const menu = stubMenu([
      { kind: "primitive", name: "category", type: "string", default: "weapons" },
      { kind: "primitive", name: "page", type: "integer", default: "3" },
    ]);
    const scope = buildPreviewScope(menu, stubPack());
    expect(scope.category).toBe("weapons");
    expect(scope.page).toBe(3);
  });

  it("resolves a sourceRef input to the dataSource value", () => {
    const ds: DataSource = {
      id: "categories" as DataSourceId,
      name: "Categories",
      type: { kind: "list", of: { kind: "string" } },
      value: ["weapon", "armor"],
    };
    const pack = stubPack({ dataSources: [ds] });
    const menu = stubMenu([
      { kind: "sourceRef", name: "categories", ref: "pack:categories" as SourceRef },
    ]);
    expect(buildPreviewScope(menu, pack)).toEqual({ categories: ["weapon", "armor"] });
  });

  it("falls back to undefined for unresolvable sourceRef inputs", () => {
    const menu = stubMenu([
      { kind: "sourceRef", name: "x", ref: "pack:missing" as SourceRef },
    ]);
    expect(buildPreviewScope(menu, stubPack())).toEqual({ x: undefined });
  });
});
```

- [ ] **Step 2: Implement**

```typescript
// web/src/features/canvas/menuPreviewScope.ts
import type { Menu, Pack, SourceRef } from "@/domain/types";

/**
 * Resolve a SourceRef against a pack:
 *  - "pack:<id>" → pack.dataSources[id].value
 *  - "<plugin>:<source>" → pack.importedConnectors[ref].sample
 *  - unknown / malformed → undefined
 *
 * Cf. spec §3.5.
 */
export function resolveSourceRef(ref: SourceRef, pack: Pack): unknown {
  const r = String(ref);
  if (r === "" || !r.includes(":")) return undefined;
  if (r.startsWith("pack:")) {
    const id = r.slice("pack:".length);
    const ds = pack.dataSources.find((d) => d.id === (id as Pack["dataSources"][number]["id"]));
    return ds?.value;
  }
  const c = pack.importedConnectors.find((x) => x.ref === r);
  return c?.sample;
}

/**
 * Build the preview scope for a menu by walking its contextInputs:
 *  - primitive → coerce default to its declared type
 *  - sourceRef → resolveSourceRef
 *
 * Used by MenuGroup and ItemTooltip preview rendering. Replaces the
 * pre-Plan-C1 sampleContext blob.
 */
export function buildPreviewScope(menu: Menu, pack: Pack): Record<string, unknown> {
  const scope: Record<string, unknown> = {};
  for (const input of menu.contextInputs ?? []) {
    if (input.kind === "primitive") {
      scope[input.name] = coerceDefault(input.default, input.type);
    } else {
      scope[input.name] = resolveSourceRef(input.ref, pack);
    }
  }
  return scope;
}

function coerceDefault(
  value: string | undefined,
  type: "player" | "string" | "integer" | "number" | "boolean",
): unknown {
  if (value === undefined || value === "") {
    switch (type) {
      case "player":
      case "string":
        return "";
      case "integer":
      case "number":
        return 0;
      case "boolean":
        return false;
    }
  }
  switch (type) {
    case "integer":
    case "number": {
      const n = Number(value);
      return Number.isFinite(n) ? n : 0;
    }
    case "boolean":
      return value === "true";
    case "player":
    case "string":
    default:
      return value;
  }
}
```

- [ ] **Step 3: Run, biome, commit**

```bash
cd web && npm test -- menuPreviewScope.test --run
cd web && ./node_modules/.bin/biome check src/features/canvas/menuPreviewScope.ts src/features/canvas/menuPreviewScope.test.ts
git add web/src/features/canvas/menuPreviewScope.ts web/src/features/canvas/menuPreviewScope.test.ts
git commit -m "feat(canvas): add menuPreviewScope helper resolving sourceRefs"
```

---

## Task 2: Use buildPreviewScope in MenuGroup + ItemTooltip

**Files:**
- Modify: `web/src/features/canvas/MenuGroup.tsx`
- Modify: `web/src/features/canvas/ItemTooltip.tsx`

- [ ] **Step 1: Refactor MenuGroup.tsx**

In `web/src/features/canvas/MenuGroup.tsx`, find the inline `coerceDefault` helper added during Plan C1 and the per-input scope-building loop. Remove them — they live in `menuPreviewScope.ts` now.

At the top, add the import:

```typescript
import { buildPreviewScope } from "./menuPreviewScope";
```

The component receives `menu` and probably has access to the pack — check whether `pack` is in scope. If not, add a `useAccountStore` selector:

```typescript
const pack = useAccountStore((s) => s.account.packs.find((p) => p.id === menu.packId));
```

Replace the existing scope-building (the for-loop over contextInputs that builds `sampleCtx`) with:

```typescript
const sampleCtx = pack ? buildPreviewScope(menu, pack) : {};
```

Drop the `coerceDefault` local helper if no other code uses it.

- [ ] **Step 2: Refactor ItemTooltip.tsx**

Same pattern as MenuGroup — replace its local `coerceDefault` + loop with `buildPreviewScope(menu, pack)`.

- [ ] **Step 3: Verify TS, tests, biome**

```bash
cd web && npx tsc --noEmit 2>&1 | tail -5
cd web && npm test -- --run 2>&1 | tail -5
cd web && ./node_modules/.bin/biome check src/features/canvas/MenuGroup.tsx src/features/canvas/ItemTooltip.tsx
```

Tests should still pass. iteration on a sourceRef input should now find items via `pack.dataSources` / `pack.importedConnectors`.

- [ ] **Step 4: Commit**

```bash
git add web/src/features/canvas/MenuGroup.tsx web/src/features/canvas/ItemTooltip.tsx
git commit -m "refactor(canvas): use buildPreviewScope for sourceRef resolution"
```

---

## Task 3: Source picker in MenuProperties

**Files:**
- Modify: `web/src/features/canvas/properties/MenuProperties.tsx`
- Modify: `web/src/locales/en.ts`
- Modify: `web/src/locales/fr.ts`

- [ ] **Step 1: Replace raw input with dropdown in SourceRefInputRow**

Find the `SourceRefInputRow` component in `MenuProperties.tsx` (added in Plan C1). Currently the `ref` field is a raw `<Input>`. Replace with a `<DropdownMenu>` showing available sources.

Add to the imports if not already:

```typescript
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAccountStore } from "@/state/accountStore";
import type { ContextInput, Pack, SourceRef } from "@/domain/types";
import { summarizeFieldType } from "@/features/data/helpers";
```

Replace `SourceRefInputRow`:

```typescript
function SourceRefInputRow({
  packId,
  input,
  onChange,
  onRemove,
}: {
  packId: PackId;
  input: Extract<ContextInput, { kind: "sourceRef" }>;
  onChange: (patch: Partial<Extract<ContextInput, { kind: "sourceRef" }>>) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const pack = useAccountStore((s) => s.account.packs.find((p) => p.id === packId));
  return (
    <div className="flex items-center gap-1.5">
      <Input
        value={input.name}
        placeholder={t("menuProperties.inputName")}
        onChange={(e) => onChange({ name: e.target.value })}
        className="h-8 w-28 px-2 py-0 font-mono text-xs"
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex h-8 flex-1 items-center justify-between gap-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-0 font-mono text-xs text-zinc-200 hover:bg-zinc-800"
          >
            <span className="truncate">
              {input.ref || t("menuProperties.refPickPlaceholder")}
            </span>
            <span className="text-zinc-500">▾</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="border-zinc-700 bg-zinc-900 text-zinc-200">
          {pack ? <SourcePickerOptions pack={pack} onPick={(ref) => onChange({ ref })} /> : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <button
        type="button"
        title={t("menuProperties.removeInput")}
        onClick={onRemove}
        className="ml-auto flex h-7 w-7 items-center justify-center rounded text-[14px] text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
      >
        ×
      </button>
    </div>
  );
}

function SourcePickerOptions({
  pack,
  onPick,
}: {
  pack: Pack;
  onPick: (ref: SourceRef) => void;
}) {
  const { t } = useTranslation();
  const hasPackData = pack.dataSources.length > 0;
  const hasConnectors = pack.importedConnectors.length > 0;
  return (
    <>
      {hasPackData ? (
        <>
          <DropdownMenuLabel className="text-[9px] uppercase text-zinc-500">
            {t("menuProperties.refSectionPackData")}
          </DropdownMenuLabel>
          {pack.dataSources.map((d) => (
            <DropdownMenuItem
              key={d.id}
              onSelect={() => onPick(`pack:${d.id}` as SourceRef)}
              title={summarizeFieldType(d.type)}
              className="cursor-pointer text-[11px] focus:bg-zinc-800"
            >
              <span className="mr-1">{d.type.kind === "list" ? "🗂" : "📦"}</span>
              <span className="font-mono">{d.name}</span>
              <span className="ml-auto text-[9px] text-zinc-500">
                {summarizeFieldType(d.type)}
              </span>
            </DropdownMenuItem>
          ))}
        </>
      ) : null}
      {hasPackData && hasConnectors ? <DropdownMenuSeparator /> : null}
      {hasConnectors ? (
        <>
          <DropdownMenuLabel className="text-[9px] uppercase text-zinc-500">
            {t("menuProperties.refSectionConnectors")}
          </DropdownMenuLabel>
          {pack.importedConnectors.map((c) => (
            <DropdownMenuItem
              key={c.ref}
              onSelect={() => onPick(c.ref as SourceRef)}
              title={summarizeFieldType(c.type)}
              className="cursor-pointer text-[11px] focus:bg-zinc-800"
            >
              <span className="mr-1">🔌</span>
              <span className="font-mono">{c.ref}</span>
              <span className="ml-auto text-[9px] text-zinc-500">{summarizeFieldType(c.type)}</span>
            </DropdownMenuItem>
          ))}
        </>
      ) : null}
      {!hasPackData && !hasConnectors ? (
        <DropdownMenuItem disabled className="cursor-not-allowed text-[11px] text-zinc-500">
          {t("menuProperties.refNoSources")}
        </DropdownMenuItem>
      ) : null}
    </>
  );
}
```

The caller passes the new `packId` prop:

```typescript
{input.kind === "primitive" ? (
  <PrimitiveInputRow input={input} ... />
) : (
  <SourceRefInputRow packId={packId} input={input} ... />
)}
```

- [ ] **Step 2: Add i18n keys**

In `en.ts`'s `menuProperties:` block:

```typescript
    refPickPlaceholder: "Pick a source…",
    refSectionPackData: "Pack data",
    refSectionConnectors: "Connectors",
    refNoSources: "No sources defined yet — create one in the Data sources page.",
```

In `fr.ts`:

```typescript
    refPickPlaceholder: "Choisis une source…",
    refSectionPackData: "Données du pack",
    refSectionConnectors: "Connecteurs",
    refNoSources: "Aucune source — crée-en une dans la page Sources de données.",
```

- [ ] **Step 3: Verify, biome, commit**

```bash
cd web && npx tsc --noEmit 2>&1 | tail -5
cd web && npm test -- --run 2>&1 | tail -5
cd web && ./node_modules/.bin/biome check src/features/canvas/properties/MenuProperties.tsx src/locales/
git add web/src/features/canvas/properties/MenuProperties.tsx src/locales/en.ts src/locales/fr.ts
git commit -m "feat(menu): replace raw ref input with source picker dropdown"
```

(Adjust paths — `web/src/locales/en.ts`.)

---

## Task 4: Manual smoke test

- [ ] **Step 1**: Start dev server. Create a pack data source `categories` (list of string, values `["weapon", "armor"]`).
- [ ] **Step 2**: Go to a menu's properties. Add a sourceRef input; click the dropdown and pick `categories`. Verify the ref reads `pack:<id>`.
- [ ] **Step 3**: On a slot, set up an Element that iterates on this input. Verify the canvas preview now shows multiple slots, one per category — not the empty / undefined state from before.
- [ ] **Step 4**: Import a fake connector via the Data sources page (any valid YAML). Re-open the menu's input picker. Verify the connector appears in the Connectors section of the dropdown.
- [ ] **Step 5**: Stop dev server.

---

## What ships at end of Plan C4

- `resolveSourceRef(ref, pack)` and `buildPreviewScope(menu, pack)` helpers + 9 unit tests
- MenuGroup + ItemTooltip use the new helpers; sourceRef inputs now render in preview
- Source picker dropdown in MenuProperties (replaces raw text input for `ref`)
- Localized en/fr

## What does NOT ship (C2.1)

- Recursive schema/value editors (current "advanced shape" notice still shown for nested types)
