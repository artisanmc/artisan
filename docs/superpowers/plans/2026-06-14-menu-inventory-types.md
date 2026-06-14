# Menu Inventory Types (chest / hopper / dropper) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a menu render and open as a Chest (current default), a Hopper (5×1), or a Dropper/Dispenser (3×3), driven by one geometry table shared across editor, schema, export/import, and plugin.

**Architecture:** A single source-of-truth geometry table (`INVENTORY_TYPES`) lives in the editor and is mirrored on the plugin. The `menu/v1` schema gains an **optional additive** `inventory_type` field (absent = chest) plus a relaxed `size` enum with cross-validation — so it stays in `menu/v1` (no breaking change, no v2 folder). All chest-grid assumptions (`COLS = 9`, `size = rows*9`, `slotXY`) are parameterized by type. Existing menus with no `inventory_type` behave exactly as today.

**Tech Stack:** TypeScript / React 19 / Konva (editor), Ajv 2020 (schema validation), Kotlin / Paper Bukkit `InventoryType` (plugin), Vitest (editor tests), JUnit + MockBukkit (plugin tests).

**Key simplification discovered during planning:** All three vanilla container GUI textures (`generic_54.png`, `hopper.png`, `dispenser.png`) are **176 MC-px wide** with the title drawn at `(x=8, y=6)`. The title bar is identical across types, so the title composer (`TitleRender.tsx`) needs **no width parameterization** — only the **box height** and the **slot-grid geometry** differ. This makes spec §4.3's "title width per type" concern moot for V1.

**Vanilla geometry (MC pixels), confirmed against the in-repo textures (all 256×256, GUI in top-left):**

| Type | cols | rows | slot 0 (x,y) | GUI box (w×h) | texture | Bukkit |
|---|---|---|---|---|---|---|
| chest | 9 | variable 1–6 | (7, 17) | 176 × (17 + rows·18 + 97) | `generic_54` (sliced) | `CHEST` (by size) |
| hopper | 5 | 1 fixed | (44, 20) | 176 × 133 | `hopper` (single) | `HOPPER` |
| dropper | 3 | 3 fixed | (62, 17) | 176 × 166 | `dispenser` (single) | `DROPPER` |

(Slot stride is 18 MC-px for every type. Chest box height keeps the existing `MC_TITLE_H(17) + rows·MC_SLOT_STRIDE(18) + MC_BOTTOM_H(97)` formula.)

---

## File Structure

**Editor — created:**
- `editor/src/features/canvas/inventoryTypes.ts` — pure geometry table + helpers (MC pixels, no scale).
- `editor/src/features/canvas/inventoryTypes.test.ts` — table/helper unit tests.

**Editor — modified:**
- `editor/src/domain/types.ts` — add `InventoryType` union + `Menu.inventoryType?`.
- `editor/src/features/canvas/menuLayout.ts` — parameterize `menuBoxSize`, `slotXY`, `nodeBox`, background plan; add texture-URL map.
- `editor/src/features/canvas/MenuGroup.tsx` — type-aware texture + slot grid + slot count.
- `editor/src/features/canvas/title/composer/TitleRender.tsx` — `titleRenderHeight` uses type-aware box height (background spill only).
- `editor/src/features/canvas/properties/MenuProperties.tsx` — type selector, rows hidden off-chest, out-of-range warning chip.
- `editor/src/state/accountStore.ts` — `setMenuField` accepts `"inventoryType"` (keep+warn, never throws).
- `editor/src/features/export/transform.ts` — `serializeMenuToV1` emits `inventory_type` (if ≠ chest) + `size = slotCount(...)`.
- `editor/src/schema/menuV1ToDomain.ts` — read `inventory_type`, default chest; compute `rows` per type.
- `editor/src/i18n/en.ts`, `editor/src/i18n/fr.ts` — new `menuProperties.*` keys.

**Schema — modified:**
- `docs/schema/menu/v1/schema.json` — add `inventory_type`, relax `size` enum, add `allOf` cross-validation.

**Editor tests — modified:**
- `editor/src/schema/validateMenuV1.test.ts`, `menuV1ToDomain.test.ts`, `menuV1ToDomain.roundtrip.test.ts`.

**Editor assets — created:**
- `editor/src/assets/minecraft/hopper.png`, `editor/src/assets/minecraft/dispenser.png` (copied from in-repo vanilla assets).

**Plugin — modified:**
- `plugin/.../model/PackBundle.kt` — `MenuYaml.inventoryType`.
- `plugin/.../render/MenuRenderer.kt` — create inventory via `InventoryType` for non-chest.

**Plugin tests — created/modified:**
- `plugin/src/test/.../MenuYamlParsingTest.kt` — parse `inventory_type`.
- `plugin/src/test/.../MenuRendererInventoryTypeTest.kt` (new) — correct `InventoryType` + size.

**Docs — modified:**
- `docs/architecture/schemas-codegen.md`, `docs/architecture/editor-internals.md`, `CHANGELOG.md`.

> **Where TypeScript files import each other:** `inventoryTypes.ts` imports the `InventoryType` *type* from `@/domain/types` (not the reverse) to avoid a `domain → features` cycle. `menuLayout.ts` imports the geometry table + helpers from `inventoryTypes.ts` and applies `TEX_SCALE`. `transform.ts` / `menuV1ToDomain.ts` / `MenuProperties.tsx` import `slotCount` from `inventoryTypes.ts`.

---

## Task 1: Geometry table + helpers (`inventoryTypes.ts`)

**Files:**
- Create: `editor/src/features/canvas/inventoryTypes.ts`
- Create: `editor/src/features/canvas/inventoryTypes.test.ts`
- Modify: `editor/src/domain/types.ts` (add `InventoryType` + `Menu.inventoryType?`)

- [ ] **Step 1: Add the type union + menu field to the domain**

In `editor/src/domain/types.ts`, immediately above `export interface Menu {` (line ~115) add:

```ts
/** Container shape of a menu. Absent in stored data = "chest" (back-compat). */
export type InventoryType = "chest" | "hopper" | "dropper";
```

Then inside `interface Menu`, right after the `rows:` line (line ~119) add:

```ts
  /**
   * Container shape. Absent = "chest" everywhere (back-compat). `rows` is only
   * meaningful for chest; hopper/dropper have fixed geometry (see INVENTORY_TYPES).
   */
  inventoryType?: InventoryType;
```

- [ ] **Step 2: Write the failing test for the geometry helpers**

Create `editor/src/features/canvas/inventoryTypes.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { INVENTORY_TYPES, colsFor, rowsFor, slotCount, slotMcXY } from "./inventoryTypes";

describe("inventoryTypes geometry table", () => {
  it("chest: 9 columns, rows variable, slotCount = rows*9", () => {
    expect(colsFor("chest")).toBe(9);
    expect(rowsFor("chest", 3)).toBe(3);
    expect(slotCount("chest", 3)).toBe(27);
    expect(slotCount("chest", 6)).toBe(54);
  });

  it("hopper: 5×1 fixed, 5 slots regardless of chestRows", () => {
    expect(colsFor("hopper")).toBe(5);
    expect(rowsFor("hopper", 6)).toBe(1);
    expect(slotCount("hopper", 6)).toBe(5);
  });

  it("dropper: 3×3 fixed, 9 slots regardless of chestRows", () => {
    expect(colsFor("dropper")).toBe(3);
    expect(rowsFor("dropper", 1)).toBe(3);
    expect(slotCount("dropper", 1)).toBe(9);
  });

  it("slotMcXY walks columns then rows, in MC pixels from the type origin", () => {
    // chest slot 0 = (7,17); slot 9 (second row, first col) = (7, 35)
    expect(slotMcXY(0, "chest")).toEqual({ x: 7, y: 17 });
    expect(slotMcXY(9, "chest")).toEqual({ x: 7, y: 35 });
    // hopper slot 0 = (44,20); slot 4 = (44+4*18, 20) = (116,20)
    expect(slotMcXY(0, "hopper")).toEqual({ x: 44, y: 20 });
    expect(slotMcXY(4, "hopper")).toEqual({ x: 116, y: 20 });
    // dropper slot 0 = (62,17); slot 4 (center) = (62+1*18, 17+1*18) = (80,35)
    expect(slotMcXY(0, "dropper")).toEqual({ x: 62, y: 17 });
    expect(slotMcXY(4, "dropper")).toEqual({ x: 80, y: 35 });
  });

  it("every type entry has a textureKey and a bukkitType", () => {
    expect(INVENTORY_TYPES.chest.textureKey).toBe("generic_54");
    expect(INVENTORY_TYPES.hopper.bukkitType).toBe("HOPPER");
    expect(INVENTORY_TYPES.dropper.bukkitType).toBe("DROPPER");
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd editor && npx vitest run src/features/canvas/inventoryTypes.test.ts`
Expected: FAIL — `Cannot find module './inventoryTypes'`.

- [ ] **Step 4: Implement the geometry table**

Create `editor/src/features/canvas/inventoryTypes.ts`:

```ts
import type { InventoryType } from "@/domain/types";

/** Slot-to-slot stride in MC pixels — constant across every container type. */
export const MC_SLOT_STRIDE = 18;

export interface InventoryGeometry {
  /** Columns in the slot grid. */
  cols: number;
  /** Fixed row count (hopper=1, dropper=3). `null` = variable (chest, uses menu.rows). */
  rows: number | null;
  /** MC-pixel x of slot 0's outer cell, relative to the GUI origin. */
  firstSlotX: number;
  /** MC-pixel y of slot 0's outer cell. */
  firstSlotY: number;
  /** Full GUI box height in MC pixels. `null` = computed from rows (chest). */
  boxHeight: number | null;
  /** Editor background texture key (see TEXTURE_URLS in menuLayout). */
  textureKey: "generic_54" | "hopper" | "dispenser";
  /** Bukkit InventoryType name used by the plugin. */
  bukkitType: "CHEST" | "HOPPER" | "DROPPER";
}

/** Single source of truth for every type-specific geometry attribute. */
export const INVENTORY_TYPES: Record<InventoryType, InventoryGeometry> = {
  chest:   { cols: 9, rows: null, firstSlotX: 7,  firstSlotY: 17, boxHeight: null, textureKey: "generic_54", bukkitType: "CHEST" },
  hopper:  { cols: 5, rows: 1,    firstSlotX: 44, firstSlotY: 20, boxHeight: 133,  textureKey: "hopper",     bukkitType: "HOPPER" },
  dropper: { cols: 3, rows: 3,    firstSlotX: 62, firstSlotY: 17, boxHeight: 166,  textureKey: "dispenser",  bukkitType: "DROPPER" },
};

export const colsFor = (type: InventoryType): number => INVENTORY_TYPES[type].cols;

/** Effective row count: the type's fixed rows, or the chest's `menu.rows`. */
export const rowsFor = (type: InventoryType, chestRows: number): number =>
  INVENTORY_TYPES[type].rows ?? chestRows;

/** Total slot count for the type (chest = rows·9, hopper = 5, dropper = 9). */
export const slotCount = (type: InventoryType, chestRows: number): number =>
  colsFor(type) * rowsFor(type, chestRows);

/** Top-left of slot `i`'s outer cell in MC pixels, relative to the GUI origin. */
export const slotMcXY = (i: number, type: InventoryType): { x: number; y: number } => {
  const g = INVENTORY_TYPES[type];
  return {
    x: g.firstSlotX + (i % g.cols) * MC_SLOT_STRIDE,
    y: g.firstSlotY + Math.floor(i / g.cols) * MC_SLOT_STRIDE,
  };
};
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd editor && npx vitest run src/features/canvas/inventoryTypes.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Verify the domain type change compiles**

Run: `cd editor && npx tsc --noEmit`
Expected: no new errors referencing `InventoryType` or `Menu.inventoryType`.

- [ ] **Step 7: Commit**

```bash
git add editor/src/features/canvas/inventoryTypes.ts editor/src/features/canvas/inventoryTypes.test.ts editor/src/domain/types.ts
git commit -m "feat(editor): inventory-type geometry table + domain field"
```

---

## Task 2: `menuLayout.ts` parameterized by type

**Files:**
- Modify: `editor/src/features/canvas/menuLayout.ts`
- Modify: `editor/src/features/canvas/title/composer/TitleRender.tsx` (`titleRenderHeight`)

- [ ] **Step 1: Add the textures + parameterized geometry to `menuLayout.ts`**

In `editor/src/features/canvas/menuLayout.ts`:

a) After the existing `import vanillaChestTextureUrl ...` (line 2) add the two new texture imports and the geometry import:

```ts
import hopperTextureUrl from "@/assets/minecraft/hopper.png";
import dispenserTextureUrl from "@/assets/minecraft/dispenser.png";
import type { InventoryType } from "@/domain/types";
import { INVENTORY_TYPES, slotCount, slotMcXY } from "./inventoryTypes";
```

b) After the `TEX_*` constant block (after line 43), add a texture-key → URL map:

```ts
/** Editor GUI background by texture key (matches INVENTORY_TYPES[type].textureKey). */
export const TEXTURE_URLS: Record<"generic_54" | "hopper" | "dispenser", string> = {
  generic_54: vanillaChestTextureUrl,
  hopper: hopperTextureUrl,
  dispenser: dispenserTextureUrl,
};
```

c) Replace `menuBoxSize` (lines 50-53) with a type-aware version (keep the chest formula identical):

```ts
export const menuBoxSize = (type: InventoryType, rows: number) => {
  const fixedH = INVENTORY_TYPES[type].boxHeight;
  return {
    width: TEX_W,
    height:
      fixedH != null
        ? fixedH * TEX_SCALE
        : TEX_TITLE_H + rows * TEX_SLOT_STRIDE + TEX_BOTTOM_H,
  };
};
```

d) In `nodeBox` (line ~68) change the menu branch from `menuBoxSize(menu.rows)` to:

```ts
  if (menu) return { ...pos, ...menuBoxSize(menu.inventoryType ?? "chest", menu.rows) };
```

e) Replace `slotXY` (lines 77-84) with the type-aware version (scales the pure MC-pixel helper):

```ts
/** Top-left corner of slot `i`'s outer cell (canvas px), relative to menu origin. */
export const slotXY = (i: number, type: InventoryType) => {
  const { x, y } = slotMcXY(i, type);
  return { x: x * TEX_SCALE, y: y * TEX_SCALE };
};
```

f) Add a single-image background helper just after `bottomPieceCrop` (after line 100). Chest stays sliced (callers use `topPieceCrop`/`bottomPieceCrop`); hopper/dropper crop the whole GUI box:

```ts
/** Whether this type renders a single fixed background image (vs. chest's 2 slices). */
export const usesSingleBackground = (type: InventoryType): boolean =>
  INVENTORY_TYPES[type].boxHeight != null;

/** Source crop (MC pixels) for a single-image background (hopper/dropper). */
export const singleBackgroundCrop = (type: InventoryType) => ({
  x: 0,
  y: 0,
  width: MC_W,
  height: INVENTORY_TYPES[type].boxHeight ?? MC_BOTTOM_Y,
});
```

g) Re-export `slotCount` for callers that import it via menuLayout (avoids touching unrelated import sites):

```ts
export { slotCount } from "./inventoryTypes";
```

> Note: `COLS` (line 45) stays exported for any legacy reference, but new code uses `colsFor(type)`. Do not remove it in this task.

- [ ] **Step 2: Update `titleRenderHeight` for background spill (type-aware height)**

In `editor/src/features/canvas/title/composer/TitleRender.tsx`, replace `titleRenderHeight` (lines 632-639). It must reflect the real box height per type so a background-glyph preview isn't clipped:

```ts
import { menuBoxSize } from "../../menuLayout";
import type { InventoryType } from "@/domain/types";
// ...
export function titleRenderHeight(
  menu: { rows: number; inventoryType?: InventoryType; title: MenuTitleLayer[] },
  scale: number,
): number {
  const hasBackground = menu.title.some((l) => l.kind === "background");
  if (!hasBackground) return MC_TITLE_H * scale;
  // Full GUI box height for the type, expressed at the requested scale.
  return menuBoxSize(menu.inventoryType ?? "chest", menu.rows).height * (scale / 2);
}
```

> `menuBoxSize` already bakes in `TEX_SCALE` (=2). `titleRenderHeight` takes an arbitrary `scale`, so divide by 2 to re-express. The `MC_BOTTOM_H` / `MC_SLOT_STRIDE` imports at the top of TitleRender become unused — remove them from the import on line 12 if the linter flags them (keep `MC_TITLE_H`).

- [ ] **Step 3: Type-check**

Run: `cd editor && npx tsc --noEmit 2>&1 | head -40`
Expected: errors ONLY at the remaining call sites of `menuBoxSize(...)` / `slotXY(...)` that still pass the old signature (fixed in Tasks 3-4). No errors inside `menuLayout.ts` or `inventoryTypes.ts` themselves.

- [ ] **Step 4: Commit**

```bash
git add editor/src/features/canvas/menuLayout.ts editor/src/features/canvas/title/composer/TitleRender.tsx
git commit -m "feat(editor): parameterize menuLayout geometry by inventory type"
```

---

## Task 3: Copy vanilla hopper + dispenser textures into the editor

**Files:**
- Create: `editor/src/assets/minecraft/hopper.png`
- Create: `editor/src/assets/minecraft/dispenser.png`

- [ ] **Step 1: Copy the two GUI textures from the in-repo MC assets**

The vanilla 256×256 GUI textures already exist in the repo. Copy them next to `generic_54.png`:

```bash
cp backend/data/mc-assets/1.21.4/textures/gui/container/hopper.png editor/src/assets/minecraft/hopper.png
cp backend/data/mc-assets/1.21.4/textures/gui/container/dispenser.png editor/src/assets/minecraft/dispenser.png
```

- [ ] **Step 2: Verify they landed and are 256×256**

```bash
python -c "import struct;[print(f, *struct.unpack('>II', open(f,'rb').read()[16:24])) for f in ['editor/src/assets/minecraft/hopper.png','editor/src/assets/minecraft/dispenser.png']]"
```
Expected: each prints `... 256 256`.

- [ ] **Step 3: Commit**

```bash
git add editor/src/assets/minecraft/hopper.png editor/src/assets/minecraft/dispenser.png
git commit -m "feat(editor): add vanilla hopper + dispenser GUI textures"
```

---

## Task 4: Render the right container in `MenuGroup` + `SoloMenuStage`

**Files:**
- Modify: `editor/src/features/canvas/MenuGroup.tsx`

> `SoloMenuStage.tsx` already centers using `TEX_W` (176·2), which is correct for all three types (all 176 wide) — no change needed there.

- [ ] **Step 1: Swap chest-only imports for type-aware ones**

In `editor/src/features/canvas/MenuGroup.tsx`, replace the `menuLayout` import block (lines 24-35) with:

```ts
import {
  TEX_SCALE,
  TEX_SLOT_INNER,
  TEX_SLOT_INNER_OFFSET,
  TEXTURE_URLS,
  bottomPieceCrop,
  bottomPieceY,
  menuBoxSize,
  singleBackgroundCrop,
  slotXY,
  topPieceCrop,
  usesSingleBackground,
} from "./menuLayout";
import { INVENTORY_TYPES, slotCount } from "./inventoryTypes";
```

(`COLS` and `TEX_URL` are no longer imported here.)

- [ ] **Step 2: Resolve the type, texture, box and slot count from the menu**

Replace the texture + box lines (lines 90-92):

```ts
  const type = menu.inventoryType ?? "chest";
  const [tex] = useImage(TEXTURE_URLS[INVENTORY_TYPES[type].textureKey]);
  const box = menuBoxSize(type, menu.rows);
  const single = usesSingleBackground(type);
```

Then replace the slot-count + crop block (lines 263-266):

```ts
  const total = slotCount(type, menu.rows);
  const top = topPieceCrop(menu.rows);
  const bottom = bottomPieceCrop();
  const bottomY = bottomPieceY(menu.rows);
  const fullCrop = singleBackgroundCrop(type);
```

- [ ] **Step 3: Render single-image background for non-chest, sliced for chest**

Replace the background `{vanillaTex ? (...) : (...)}` JSX (lines 286-309) with a type branch:

```tsx
      {tex ? (
        single ? (
          <KonvaImage
            image={tex}
            x={0}
            y={0}
            width={fullCrop.width * TEX_SCALE}
            height={fullCrop.height * TEX_SCALE}
            crop={fullCrop}
            perfectDrawEnabled={false}
          />
        ) : (
          <>
            <KonvaImage
              image={tex}
              x={0}
              y={0}
              width={top.width * TEX_SCALE}
              height={top.height * TEX_SCALE}
              crop={top}
              perfectDrawEnabled={false}
            />
            <KonvaImage
              image={tex}
              x={0}
              y={bottomY}
              width={bottom.width * TEX_SCALE}
              height={bottom.height * TEX_SCALE}
              crop={bottom}
              perfectDrawEnabled={false}
            />
          </>
        )
      ) : (
        <Rect width={box.width} height={box.height} fill="#c6c6c6" perfectDrawEnabled={false} />
      )}
```

- [ ] **Step 4: Use `total` + `slotXY(i, type)` at all three slot-coordinate sites**

1. Slot-overlay loop header (line 344): change `Array.from({ length: slotCount }, (_, i) => {` to `Array.from({ length: total }, (_, i) => {` and the next line `const { x, y } = slotXY(i);` to `const { x, y } = slotXY(i, type);`.
2. Alt-drag duplicate ghost (line 557): `const { x, y } = slotXY(dragState.sourcePosition);` → `slotXY(dragState.sourcePosition, type);`.
3. Selection-drag ghosts (line 575): `const { x, y } = slotXY(sib.position);` → `slotXY(sib.position, type);`.

> `slotCount` was previously a local `const slotCount = menu.rows * COLS;` — it is now the imported helper, renamed to `total` here to avoid shadowing the import. Make sure the old `const slotCount = ...` line (263) is gone.

- [ ] **Step 5: Type-check + run the existing canvas tests**

Run: `cd editor && npx tsc --noEmit 2>&1 | head -40`
Expected: no errors in `MenuGroup.tsx`.

Run: `cd editor && npx vitest run src/features/canvas`
Expected: PASS (no regressions; existing chest tests still pass — chest path is byte-identical to before).

- [ ] **Step 6: Commit**

```bash
git add editor/src/features/canvas/MenuGroup.tsx
git commit -m "feat(editor): render hopper/dropper containers in MenuGroup"
```

---

## Task 5: Store mutation — `setMenuField` accepts `inventoryType` (keep + warn)

**Files:**
- Modify: `editor/src/state/accountStore.ts`

- [ ] **Step 1: Write the failing test**

Create `editor/src/state/setMenuInventoryType.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { useAccountStore } from "./accountStore";

function freshPackWithMenu() {
  const store = useAccountStore.getState();
  // Reset to a single empty account/pack/menu — mirror the helper used by
  // sibling accountStore tests; if a `__resetForTest` exists, prefer it.
  const packId = store.account.packs[0]?.id;
  return packId;
}

describe("setMenuField inventoryType", () => {
  beforeEach(() => {
    // Ensure at least one pack + menu exists for the test.
    const s = useAccountStore.getState();
    if (s.account.packs.length === 0) return;
  });

  it("switching to hopper sets inventoryType and never throws on out-of-range items", () => {
    const s = useAccountStore.getState();
    const pack = s.account.packs[0];
    if (!pack) return; // guarded — relies on the default seeded account
    const menuId = s.createMenu({ packId: pack.id, id: "menu_inv_test" });
    // Place an element at position 30 (valid for chest, out of range for hopper=5)
    s.setSlotMaterial({ packId: pack.id, menuId, position: 30, material: "STONE" });

    expect(() =>
      s.setMenuField({ packId: pack.id, menuId, field: "inventoryType", value: "hopper" }),
    ).not.toThrow();

    const updated = useAccountStore
      .getState()
      .account.packs.find((p) => p.id === pack.id)!
      .menus.find((m) => m.id === menuId)!;
    expect(updated.inventoryType).toBe("hopper");
    // The out-of-range element is KEPT, not dropped.
    const totalElements = updated.layers.reduce((n, l) => n + l.elements.length, 0);
    expect(totalElements).toBeGreaterThan(0);
  });

  it("switching back to chest clears the field (absent = chest)", () => {
    const s = useAccountStore.getState();
    const pack = s.account.packs[0];
    if (!pack) return;
    const menuId = s.createMenu({ packId: pack.id, id: "menu_inv_test2" });
    s.setMenuField({ packId: pack.id, menuId, field: "inventoryType", value: "dropper" });
    s.setMenuField({ packId: pack.id, menuId, field: "inventoryType", value: "chest" });
    const updated = useAccountStore
      .getState()
      .account.packs.find((p) => p.id === pack.id)!
      .menus.find((m) => m.id === menuId)!;
    expect(updated.inventoryType).toBeUndefined();
  });
});
```

> If sibling tests in `editor/src/state/` use a specific reset/seed helper (grep `useAccountStore.setState` in `editor/src/state/*.test.ts`), copy that exact setup instead of the guarded `if (!pack) return` shim so the asserts actually run.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd editor && npx vitest run src/state/setMenuInventoryType.test.ts`
Expected: FAIL — `setMenuField` rejects the unknown `field` value (no branch), so `inventoryType` stays undefined after the hopper call.

- [ ] **Step 3: Extend the field union + reducer**

In `editor/src/state/accountStore.ts`:

a) Update the `setMenuField` signature (lines 172-177):

```ts
  setMenuField: (input: {
    packId: PackId;
    menuId: MenuId;
    field: "permission" | "rows" | "inventoryType";
    value: string | MenuRows;
  }) => void;
```

b) Add an import for the type if not present (top of file, near `MenuRows`):

```ts
import type { InventoryType } from "@/domain/types";
```

c) In the reducer (after the `else if (field === "rows")` block, before `pack.updatedAt = ...`, line ~1622) add:

```ts
            } else if (field === "inventoryType") {
              if (typeof value !== "string") return;
              // Keep+warn semantics: never throw on out-of-range elements; the
              // UI surfaces a count and the canvas/export already clamp to the
              // new slotCount. Store undefined for chest so "absent = chest".
              menu.inventoryType = value === "chest" ? undefined : (value as InventoryType);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd editor && npx vitest run src/state/setMenuInventoryType.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add editor/src/state/accountStore.ts editor/src/state/setMenuInventoryType.test.ts
git commit -m "feat(editor): setMenuField inventoryType (keep+warn, no throw)"
```

---

## Task 6: `MenuProperties` — type selector, rows gating, out-of-range chip

**Files:**
- Modify: `editor/src/features/canvas/properties/MenuProperties.tsx`
- Modify: `editor/src/i18n/en.ts`, `editor/src/i18n/fr.ts`

- [ ] **Step 1: Add i18n keys (both languages, same commit)**

In `editor/src/i18n/en.ts`, inside the `menuProperties` object add:

```ts
    inventoryType: "Inventory type",
    typeChest: "Chest",
    typeHopper: "Hopper",
    typeDropper: "Dropper",
    outOfRange_one: "{{count}} element outside the inventory",
    outOfRange_other: "{{count}} elements outside the inventory",
```

In `editor/src/i18n/fr.ts`, the same keys:

```ts
    inventoryType: "Type d'inventaire",
    typeChest: "Coffre",
    typeHopper: "Entonnoir",
    typeDropper: "Distributeur",
    outOfRange_one: "{{count}} élément hors de l'inventaire",
    outOfRange_other: "{{count}} éléments hors de l'inventaire",
```

> If the project's i18next is not configured with the `_one`/`_other` plural suffixes, use a single `outOfRange: "{{count}} element(s) outside the inventory"` key in both files instead — grep `_other` in `editor/src/i18n/en.ts` to confirm which convention is in use.

- [ ] **Step 2: Add the type selector + warning + rows gating to `MenuProperties`**

In `editor/src/features/canvas/properties/MenuProperties.tsx`:

a) Add imports near the top:

```ts
import type { InventoryType } from "@/domain/types";
import { slotCount } from "@/features/canvas/inventoryTypes";
import { parsePositions } from "@/lib/positions";
```

b) Add a constant beside `ROWS_OPTIONS` (line 25):

```ts
const INVENTORY_TYPE_OPTIONS: InventoryType[] = ["chest", "hopper", "dropper"];
```

c) Inside the component (after `const elementCount = ...`, line 40) compute the current type, capacity and out-of-range count:

```ts
  const type = menu.inventoryType ?? "chest";
  const capacity = slotCount(type, menu.rows);
  const outOfRange = menu.layers.reduce(
    (n, l) =>
      n + l.elements.filter((el) => parsePositions(el.positions).some((p) => p >= capacity)).length,
    0,
  );
  const onTypeChange = (next: InventoryType) =>
    setMenuField({ packId, menuId: menu.id, field: "inventoryType", value: next });
```

d) Add the type selector + warning block immediately before the rows `<div>` (line 82), using design-system tokens (mirror the rows button styling):

```tsx
      <div>
        <div className="mb-1 text-[10px] uppercase text-[var(--text-faint)]">
          {t("menuProperties.inventoryType")}
        </div>
        <div className="flex gap-1">
          {INVENTORY_TYPE_OPTIONS.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => onTypeChange(opt)}
              className={
                opt === type
                  ? "rounded border border-[var(--brand)] bg-[var(--brand-soft)] px-2 py-1 text-xs"
                  : "rounded border border-[var(--border)] px-2 py-1 text-xs hover:border-[var(--border-strong)]"
              }
            >
              {t(`menuProperties.type${opt[0]!.toUpperCase()}${opt.slice(1)}`)}
            </button>
          ))}
        </div>
        {outOfRange > 0 ? (
          <div className="mt-1.5 rounded border border-[var(--warning)]/50 bg-[var(--warning-soft,transparent)] px-2 py-1 text-[10px] text-[var(--warning)]">
            {t("menuProperties.outOfRange", { count: outOfRange })}
          </div>
        ) : null}
      </div>
```

e) Gate the rows selector — wrap the existing rows `<div>` (lines 82-101) so it only renders for chest:

```tsx
      {type === "chest" ? (
        <div>
          {/* ...existing rows selector unchanged... */}
        </div>
      ) : null}
```

> If `--warning-soft` isn't a defined token, drop the `bg-...` class (the bordered text chip is enough). Confirm `--warning` exists (it is already used by `MenuGroup` via `useCssVar("--warning")`).

- [ ] **Step 3: Verify the design-system rule**

These buttons reuse the exact rows-selector token classes already present in this file — no new ad-hoc component needed. Confirm there is no raw hex/rgba added (only `var(--token)`).

- [ ] **Step 4: Type-check + run editor tests touching properties**

Run: `cd editor && npx tsc --noEmit 2>&1 | head -20`
Expected: no errors in `MenuProperties.tsx`.

Run: `cd editor && npx vitest run src/features/canvas/properties`
Expected: PASS (or no such test dir → run `npx vitest run src/features/canvas`).

- [ ] **Step 5: Commit**

```bash
git add editor/src/features/canvas/properties/MenuProperties.tsx editor/src/i18n/en.ts editor/src/i18n/fr.ts
git commit -m "feat(editor): inventory-type selector + out-of-range warning in MenuProperties"
```

---

## Task 7: Schema — additive `inventory_type` + relaxed `size` + cross-validation

**Files:**
- Modify: `docs/schema/menu/v1/schema.json`
- Modify: `editor/src/schema/validateMenuV1.test.ts`

- [ ] **Step 1: Write the failing validation tests**

In `editor/src/schema/validateMenuV1.test.ts`, add a describe block (reuse the file's existing helper for a minimal valid menu; if none, build inline as below):

```ts
import { describe, expect, it } from "vitest";
import { validateMenuV1 } from "./validateMenuV1";

const base = {
  schema: "menu/v1",
  id: "m",
  title: [],
  layers: [{ id: "l", name: "L", elements: [{ id: "e", positions: "0", appearances: [{ material: "STONE" }] }] }],
};

describe("validateMenuV1 inventory_type cross-validation", () => {
  it("accepts a chest menu with no inventory_type (back-compat)", () => {
    expect(validateMenuV1({ ...base, size: 27 }).valid).toBe(true);
  });
  it("accepts inventory_type=chest with a multiple-of-9 size", () => {
    expect(validateMenuV1({ ...base, inventory_type: "chest", size: 54 }).valid).toBe(true);
  });
  it("accepts inventory_type=hopper with size 5", () => {
    expect(validateMenuV1({ ...base, inventory_type: "hopper", size: 5 }).valid).toBe(true);
  });
  it("accepts inventory_type=dropper with size 9", () => {
    expect(validateMenuV1({ ...base, inventory_type: "dropper", size: 9 }).valid).toBe(true);
  });
  it("rejects hopper with size 9 (must be 5)", () => {
    expect(validateMenuV1({ ...base, inventory_type: "hopper", size: 9 }).valid).toBe(false);
  });
  it("rejects dropper with size 5", () => {
    expect(validateMenuV1({ ...base, inventory_type: "dropper", size: 5 }).valid).toBe(false);
  });
  it("rejects chest with size 5 (5 only valid for hopper)", () => {
    expect(validateMenuV1({ ...base, size: 5 }).valid).toBe(false);
  });
  it("rejects an unknown inventory_type", () => {
    expect(validateMenuV1({ ...base, inventory_type: "furnace", size: 9 }).valid).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd editor && npx vitest run src/schema/validateMenuV1.test.ts`
Expected: FAIL — `inventory_type` is rejected by `additionalProperties: false`, and `size: 5` is rejected by the current enum.

- [ ] **Step 3: Edit the schema**

In `docs/schema/menu/v1/schema.json`:

a) Relax the `size` enum (line 26) to include 5:

```json
    "size": {
      "type": "integer",
      "enum": [5, 9, 18, 27, 36, 45, 54],
      "description": "Taille de l'inventaire en nombre de positions. chest = multiple de 9 (max 54) ; hopper = 5 ; dropper = 9. Validation croisée avec inventory_type."
    },
```

b) Add the `inventory_type` property right after `size` (before `permission`, line 29):

```json
    "inventory_type": {
      "type": "string",
      "enum": ["chest", "hopper", "dropper"],
      "default": "chest",
      "description": "Type de conteneur. Absent = chest (rétro-compatible). chest = grille 9×rows ; hopper = 5×1 ; dropper = 3×3."
    },
```

c) Add an `allOf` cross-validation block at the top-level object. Insert it right after the `"required": [...]` line (line 8), as a sibling of `properties`:

```json
  "allOf": [
    {
      "if": { "required": ["inventory_type"], "properties": { "inventory_type": { "const": "hopper" } } },
      "then": { "properties": { "size": { "const": 5 } } }
    },
    {
      "if": { "required": ["inventory_type"], "properties": { "inventory_type": { "const": "dropper" } } },
      "then": { "properties": { "size": { "const": 9 } } }
    },
    {
      "if": { "not": { "required": ["inventory_type"], "properties": { "inventory_type": { "enum": ["hopper", "dropper"] } } } },
      "then": { "properties": { "size": { "enum": [9, 18, 27, 36, 45, 54] } } }
    }
  ],
```

> The third clause covers both "chest" and "absent": when the type is not hopper/dropper, `size` must be a multiple of 9 (so `size: 5` is rejected for chest). `additionalProperties: false` at the root already rejects unknown `inventory_type` values via the property enum.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd editor && npx vitest run src/schema/validateMenuV1.test.ts`
Expected: PASS (all cross-validation cases).

- [ ] **Step 5: Commit**

```bash
git add docs/schema/menu/v1/schema.json editor/src/schema/validateMenuV1.test.ts
git commit -m "feat(schema): menu/v1 additive inventory_type + size cross-validation"
```

---

## Task 8: Export — `serializeMenuToV1` emits `inventory_type` + computed size

**Files:**
- Modify: `editor/src/features/export/transform.ts`
- Modify: `editor/src/schema/menuV1ToDomain.roundtrip.test.ts` (or the export test that covers `serializeMenuToV1`)

- [ ] **Step 1: Write the failing test**

In `editor/src/schema/menuV1ToDomain.roundtrip.test.ts` (it already imports `serializeMenuToV1` and `menuV1ToDomain` — confirm; if not, add the import), add:

```ts
import { serializeMenuToV1 } from "@/features/export/transform";

describe("serializeMenuToV1 inventory_type", () => {
  const pack = { id: "p", i18nKeys: {}, defaultLang: "en", menus: [], commands: [], dialogs: [] } as any;

  it("omits inventory_type for chest and uses size = rows*9", () => {
    const menu = { id: "m", packId: "p", title: [], rows: 3, layers: [] } as any;
    const out = serializeMenuToV1(menu, pack);
    expect(out.inventory_type).toBeUndefined();
    expect(out.size).toBe(27);
  });

  it("emits inventory_type=hopper with size 5", () => {
    const menu = { id: "m", packId: "p", title: [], rows: 1, inventoryType: "hopper", layers: [] } as any;
    const out = serializeMenuToV1(menu, pack);
    expect(out.inventory_type).toBe("hopper");
    expect(out.size).toBe(5);
  });

  it("emits inventory_type=dropper with size 9", () => {
    const menu = { id: "m", packId: "p", title: [], rows: 3, inventoryType: "dropper", layers: [] } as any;
    const out = serializeMenuToV1(menu, pack);
    expect(out.inventory_type).toBe("dropper");
    expect(out.size).toBe(9);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd editor && npx vitest run src/schema/menuV1ToDomain.roundtrip.test.ts`
Expected: FAIL — `out.inventory_type` is `undefined` for hopper, `out.size` is `1*9=9` not `5`.

- [ ] **Step 3: Edit `serializeMenuToV1`**

In `editor/src/features/export/transform.ts`:

a) Add the import near the top (after the existing `@/domain/...` imports):

```ts
import { slotCount } from "@/features/canvas/inventoryTypes";
```

b) In `serializeMenuToV1` (lines 411-433) replace the `size:` line and emit the type. Change the `out` initializer and add the conditional:

```ts
export function serializeMenuToV1(menu: Menu, pack: Pack): { id: string } & Record<string, unknown> {
  const type = menu.inventoryType ?? "chest";
  const out: Record<string, unknown> = {
    schema: "menu/v1",
    id: menu.id,
    title: menu.title.map(serializeTitleLayer),
    size: slotCount(type, menu.rows),
    layers: menu.layers.map((l) => serializeLayer(l, pack)),
  };
  if (type !== "chest") out.inventory_type = type;
  // ...rest unchanged (permission, notes, context_inputs)...
```

> Keep the existing `permission` / `notes` / `context_inputs` block exactly as-is below this.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd editor && npx vitest run src/schema/menuV1ToDomain.roundtrip.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add editor/src/features/export/transform.ts editor/src/schema/menuV1ToDomain.roundtrip.test.ts
git commit -m "feat(editor): export inventory_type + computed size in serializeMenuToV1"
```

---

## Task 9: Import — `menuV1ToDomain` reads `inventory_type`

**Files:**
- Modify: `editor/src/schema/menuV1ToDomain.ts`
- Modify: `editor/src/schema/menuV1ToDomain.test.ts`

- [ ] **Step 1: Write the failing test**

In `editor/src/schema/menuV1ToDomain.test.ts` add:

```ts
describe("menuV1ToDomain inventory_type", () => {
  const opts = { packId: "p" as any, lang: "en" };

  it("defaults to chest (undefined) when inventory_type is absent; rows = size/9", () => {
    const { menu } = menuV1ToDomain(
      { schema: "menu/v1", id: "m", title: [], size: 27, layers: [{ id: "l", name: "L", elements: [] }] },
      opts,
    );
    expect(menu.inventoryType).toBeUndefined();
    expect(menu.rows).toBe(3);
  });

  it("reads inventory_type=hopper; rows defaults to 1", () => {
    const { menu } = menuV1ToDomain(
      { schema: "menu/v1", id: "m", title: [], inventory_type: "hopper", size: 5, layers: [{ id: "l", name: "L", elements: [] }] },
      opts,
    );
    expect(menu.inventoryType).toBe("hopper");
    expect(menu.rows).toBe(1);
  });

  it("reads inventory_type=dropper; rows defaults to 3", () => {
    const { menu } = menuV1ToDomain(
      { schema: "menu/v1", id: "m", title: [], inventory_type: "dropper", size: 9, layers: [{ id: "l", name: "L", elements: [] }] },
      opts,
    );
    expect(menu.inventoryType).toBe("dropper");
    expect(menu.rows).toBe(3);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd editor && npx vitest run src/schema/menuV1ToDomain.test.ts`
Expected: FAIL — `menu.inventoryType` is `undefined` for hopper, and `rows = 5/9 = 0` (NaN-ish) instead of 1.

- [ ] **Step 3: Edit `menuV1ToDomain`**

In `editor/src/schema/menuV1ToDomain.ts`:

a) Add the import:

```ts
import { INVENTORY_TYPES } from "@/features/canvas/inventoryTypes";
import type { InventoryType } from "@/domain/types";
```

b) Replace the `rows` computation (line 193) and the menu assembly (lines 196-205). Compute the type first, then derive `rows`:

```ts
  const rawType = (src.inventory_type ?? "chest") as string;
  const inventoryType: InventoryType =
    rawType === "hopper" || rawType === "dropper" ? rawType : "chest";
  // Chest: rows = size/9. Hopper/dropper: rows is irrelevant to geometry; store
  // the type's fixed row count (1 / 3) so a later switch-to-chest is sane.
  const rows = (
    inventoryType === "chest"
      ? src.size / 9
      : (INVENTORY_TYPES[inventoryType].rows ?? 1)
  ) as 1 | 2 | 3 | 4 | 5 | 6;
```

c) In the `const menu: DomainMenu = { ... }` object, add the field (only when non-chest, to keep "absent = chest"):

```ts
  const menu: DomainMenu = {
    id: src.id as MenuId,
    packId: opts.packId,
    title,
    rows,
    ...(inventoryType !== "chest" ? { inventoryType } : {}),
    layers: (src.layers as Json[]).map(layer),
    ...(src.permission ? { permission: src.permission } : {}),
    ...(typeof src.notes === "string" && src.notes ? { notes: src.notes } : {}),
    ...(contextInputs && contextInputs.length > 0 ? { contextInputs } : {}),
  };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd editor && npx vitest run src/schema/menuV1ToDomain.test.ts`
Expected: PASS.

- [ ] **Step 5: Add a full round-trip test**

In `editor/src/schema/menuV1ToDomain.roundtrip.test.ts` add:

```ts
describe("inventory_type round-trip (domain → v1 → domain)", () => {
  const pack = { id: "p", i18nKeys: {}, defaultLang: "en", menus: [], commands: [], dialogs: [] } as any;
  for (const [type, rows, size] of [["hopper", 1, 5], ["dropper", 3, 9], ["chest", 4, 36]] as const) {
    it(`stable for ${type}`, () => {
      const menu = {
        id: "m", packId: "p", title: [], rows,
        ...(type !== "chest" ? { inventoryType: type } : {}),
        layers: [{ id: "l", name: "L", elements: [] }],
      } as any;
      const v1 = serializeMenuToV1(menu, pack);
      expect(v1.size).toBe(size);
      const back = menuV1ToDomain(v1 as any, { packId: "p" as any, lang: "en" }).menu;
      expect(back.inventoryType).toBe(type === "chest" ? undefined : type);
      expect(back.rows).toBe(rows);
    });
  }
});
```

- [ ] **Step 6: Run the round-trip test**

Run: `cd editor && npx vitest run src/schema/menuV1ToDomain.roundtrip.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add editor/src/schema/menuV1ToDomain.ts editor/src/schema/menuV1ToDomain.test.ts editor/src/schema/menuV1ToDomain.roundtrip.test.ts
git commit -m "feat(editor): import inventory_type in menuV1ToDomain + round-trip"
```

---

## Task 10: Plugin — `MenuYaml.inventoryType` parsing

**Files:**
- Modify: `plugin/src/main/kotlin/net/artisanmc/plugin/model/PackBundle.kt`
- Modify: `plugin/src/test/kotlin/net/artisanmc/plugin/MenuYamlParsingTest.kt`

- [ ] **Step 1: Write the failing test**

In `plugin/src/test/kotlin/net/artisanmc/plugin/MenuYamlParsingTest.kt` add:

```kotlin
    @Test
    fun `parses inventory_type, defaulting to chest`() {
        val hopper = mapper.readValue<MenuYaml>(
            """
            schema: menu/v1
            id: h
            title: []
            inventory_type: hopper
            size: 5
            layers:
              - id: l
                name: L
                elements:
                  - id: e
                    positions: "0"
                    appearances:
                      - material: STONE
            """.trimIndent(),
        )
        assertEquals("hopper", hopper.inventoryType)

        val chest = mapper.readValue<MenuYaml>(
            """
            schema: menu/v1
            id: c
            size: 9
            layers:
              - id: l
                name: L
                elements:
                  - id: e
                    positions: "0"
                    appearances:
                      - material: STONE
            """.trimIndent(),
        )
        assertEquals("chest", chest.inventoryType)
    }
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd plugin && ./gradlew test --tests "net.artisanmc.plugin.MenuYamlParsingTest"`
Expected: FAIL — `MenuYaml` has no `inventoryType` property (compile error).

- [ ] **Step 3: Add the field to `MenuYaml`**

In `plugin/src/main/kotlin/net/artisanmc/plugin/model/PackBundle.kt`, inside `data class MenuYaml(` (after the `val size: Int = 27,` line, line 55) add:

```kotlin
    @JsonProperty("inventory_type") val inventoryType: String = "chest",
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd plugin && ./gradlew test --tests "net.artisanmc.plugin.MenuYamlParsingTest"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugin/src/main/kotlin/net/artisanmc/plugin/model/PackBundle.kt plugin/src/test/kotlin/net/artisanmc/plugin/MenuYamlParsingTest.kt
git commit -m "feat(plugin): parse inventory_type in MenuYaml (default chest)"
```

---

## Task 11: Plugin — `MenuRenderer` creates the right `InventoryType`

**Files:**
- Modify: `plugin/src/main/kotlin/net/artisanmc/plugin/render/MenuRenderer.kt`
- Create: `plugin/src/test/kotlin/net/artisanmc/plugin/MenuRendererInventoryTypeTest.kt`

- [ ] **Step 1: Write the failing test**

Create `plugin/src/test/kotlin/net/artisanmc/plugin/MenuRendererInventoryTypeTest.kt`:

```kotlin
package net.artisanmc.plugin

import be.seeseemelk.mockbukkit.MockBukkit
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory
import com.fasterxml.jackson.module.kotlin.readValue
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import net.artisanmc.plugin.engine.*
import net.artisanmc.plugin.model.MenuYaml
import net.artisanmc.plugin.render.MenuRenderer
import org.bukkit.event.inventory.InventoryType
import kotlin.test.*

class MenuRendererInventoryTypeTest {
    @BeforeTest fun setup() { MockBukkit.mock() }
    @AfterTest fun teardown() { MockBukkit.unmock() }

    private val mapper = ObjectMapper(YAMLFactory()).registerKotlinModule()
    private fun player() = MockBukkit.getMock()!!.addPlayer()

    private fun menuYaml(type: String?, size: Int): MenuYaml = mapper.readValue(
        """
        schema: menu/v1
        id: m
        title: []
        ${if (type != null) "inventory_type: $type" else ""}
        size: $size
        layers:
          - id: l
            name: L
            elements:
              - id: e
                positions: "0"
                appearances:
                  - material: STONE
        """.trimIndent(),
    )

    private fun openType(type: String?, size: Int): InventoryType {
        val p = player()
        val menu = BundleCompiler.compile(menuYaml(type, size), emptyMap())
        MenuRenderer.open(p, menu, "en", ExecutionContext(p))
        return p.openInventory.topInventory.type
    }

    @Test fun `hopper menu opens a HOPPER inventory`() {
        assertEquals(InventoryType.HOPPER, openType("hopper", 5))
    }

    @Test fun `dropper menu opens a DROPPER inventory`() {
        assertEquals(InventoryType.DROPPER, openType("dropper", 9))
    }

    @Test fun `menu without inventory_type opens a CHEST`() {
        assertEquals(InventoryType.CHEST, openType(null, 27))
    }

    @Test fun `dropper top inventory has 9 slots`() {
        val p = player()
        val menu = BundleCompiler.compile(menuYaml("dropper", 9), emptyMap())
        MenuRenderer.open(p, menu, "en", ExecutionContext(p))
        assertEquals(9, p.openInventory.topInventory.size)
        // the element at slot 0 is populated
        assertNotNull(p.openInventory.topInventory.getItem(0))
    }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd plugin && ./gradlew test --tests "net.artisanmc.plugin.MenuRendererInventoryTypeTest"`
Expected: FAIL — `openType("hopper", 5)` returns `CHEST` (renderer always uses size-based `createInventory`).

- [ ] **Step 3: Add the InventoryType branch to `MenuRenderer.open`**

In `plugin/src/main/kotlin/net/artisanmc/plugin/render/MenuRenderer.kt`:

a) Add the import (after line 14 `import org.bukkit.inventory.Inventory`):

```kotlin
import org.bukkit.event.inventory.InventoryType
```

b) Add a type map inside `object MenuRenderer {` (after the `private val noItalic = ...` line, line 26):

```kotlin
    private val INVENTORY_TYPES: Map<String, InventoryType> = mapOf(
        "hopper" to InventoryType.HOPPER,
        "dropper" to InventoryType.DROPPER,
    )
```

c) Replace the inventory creation block (lines 80-86) — branch on the type, keeping the existing Component→legacy fallback on both paths (MockBukkit lacks the Component overload):

```kotlin
        val invType = INVENTORY_TYPES[menu.yaml.inventoryType]
        val inv = if (invType != null) {
            runCatching { Bukkit.createInventory(ArtisanMenuHolder(), invType, title) }
                .getOrElse {
                    Bukkit.createInventory(
                        ArtisanMenuHolder(), invType,
                        LegacyComponentSerializer.legacySection().serialize(title),
                    )
                }
        } else {
            runCatching { Bukkit.createInventory(ArtisanMenuHolder(), menu.yaml.size, title) }
                .getOrElse {
                    Bukkit.createInventory(
                        ArtisanMenuHolder(), menu.yaml.size,
                        LegacyComponentSerializer.legacySection().serialize(title),
                    )
                }
        }
```

> Slot population below is unchanged: `parsePositions(element.positions, menu.yaml.size)` already clamps to `0 until size`, so hopper (size 5) / dropper (size 9) drop out-of-range positions automatically.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd plugin && ./gradlew test --tests "net.artisanmc.plugin.MenuRendererInventoryTypeTest"`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add plugin/src/main/kotlin/net/artisanmc/plugin/render/MenuRenderer.kt plugin/src/test/kotlin/net/artisanmc/plugin/MenuRendererInventoryTypeTest.kt
git commit -m "feat(plugin): open hopper/dropper inventories by InventoryType"
```

---

## Task 12: Full suite green + docs

**Files:**
- Modify: `docs/architecture/schemas-codegen.md`
- Modify: `docs/architecture/editor-internals.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Run the full editor suite**

Run: `cd editor && npm test`
Expected: PASS — all files (≥126 + the new tests). Investigate any regression before continuing.

- [ ] **Step 2: Run the full plugin suite**

Run: `cd plugin && ./gradlew test`
Expected: BUILD SUCCESSFUL.

- [ ] **Step 3: Update `schemas-codegen.md`**

In `docs/architecture/schemas-codegen.md` document, in prose matching the file's style: the `menu/v1` `inventory_type` additive optional field (absent = chest), the relaxed `size` enum `[5,9,18,27,36,45,54]`, the `allOf` cross-validation rule (hopper⇒5, dropper⇒9, chest⇒multiple of 9), and that this stayed in `menu/v1` (additive, non-breaking — no v2 folder). Note the hand-aligned types: `editor/src/domain/types.ts` (`InventoryType`), `editor/src/features/canvas/inventoryTypes.ts` (geometry table), `plugin .../MenuYaml.inventoryType`.

- [ ] **Step 4: Update `editor-internals.md`**

In `docs/architecture/editor-internals.md`, in the canvas/rendering section, document: the `INVENTORY_TYPES` geometry table as the single source of truth; that all three vanilla container GUIs are 176 px wide so the title composer is width-agnostic (only box height + slot grid vary); the chest two-slice vs hopper/dropper single-image background paths in `MenuGroup`; and the keep+warn behavior on type switch (`MenuProperties` out-of-range chip).

- [ ] **Step 5: Update `CHANGELOG.md`**

In `CHANGELOG.md` under `[Unreleased]` → `Added`:

```md
- Menu inventory types: menus can now be Chest (default), Hopper (5×1), or Dropper (3×3). `menu/v1` gains an optional `inventory_type` field (absent = chest, fully back-compat).
```

- [ ] **Step 6: Commit**

```bash
git add docs/architecture/schemas-codegen.md docs/architecture/editor-internals.md CHANGELOG.md
git commit -m "docs: menu inventory types (schema, editor internals, changelog)"
```

---

## Self-Review

**Spec coverage** (against `docs/superpowers/specs/2026-06-14-menu-inventory-types-design.md`):
- §2 geometry table → Task 1. §3.1 domain field → Task 1. §3.2 schema additive + size enum + cross-validation → Task 7.
- §4.1 menuLayout parameterization → Task 2. §4.2 textures → Task 3. §4.3 rendering → Task 4 (title width parameterization **dropped** — all GUIs are 176 px wide, documented above & in Task 12 §4).
- §5.1 type selector → Task 6. §5.2 keep+warn → Tasks 5 (store) + 6 (chip). §5.3 creation defaults chest → no change needed (`createMenu` omits the field = chest); verified, no task required.
- §6 plugin mapping → Tasks 10–11. §7 export/import/migration → Tasks 8–9 (no data migration: absent field = chest everywhere). §8 tests → every task is TDD. §9 non-goals → honored (only chest/hopper/dropper).

**Placeholder scan:** No TBD/"add validation"/"similar to" — every code step shows full content.

**Type consistency:** `InventoryType` (domain) used everywhere; helpers `colsFor`/`rowsFor`/`slotCount`/`slotMcXY` named identically across tasks; `slotXY(i, type)` and `menuBoxSize(type, rows)` signatures consistent between `menuLayout.ts` (Task 2) and call sites (Tasks 4, 6); `INVENTORY_TYPES[type].textureKey` ↔ `TEXTURE_URLS` keys ↔ `bukkitType` ↔ plugin `INVENTORY_TYPES` map all use the same `"hopper"`/`"dropper"`/`"chest"` literals.

**Open verification points for the implementer:**
1. Confirm `editor/src/i18n/` plural convention (`_one`/`_other` vs single key) before Task 6 §1.
2. Confirm the accountStore test seed/reset helper before Task 5 §1 (so asserts run, not skip).
3. Confirm `serializeMenuToV1` is already imported in `menuV1ToDomain.roundtrip.test.ts` (Task 8 §1) — add the import if absent.
