# Menu inventory types (chest / hopper / dropper) — Design

> Spec brainstormed on 2026-06-14. Lets a GUI menu use a container type other than the chest. **V1 scope: display grids only — Chest, Hopper, Dropper/Dispenser.** Functional types (furnace, crafting table, anvil…) are out of scope (slots with special behavior). Source of truth for the implementation plan.

**Status** — Spec validated in brainstorming, to be turned into an implementation plan.

---

## 1. Goal & scope

Today a menu = **always a chest**: `Menu.rows: 1|2|3|4|5|6`, **9-column** grid, `generic_54.png` background, `size = rows×9` (9–54). We want to choose the **inventory type**.

**V1 — "display grid" types only** (clickable slots, no special behavior):

| Type | Columns | Rows | Slots | GUI texture | Bukkit `InventoryType` |
|---|---|---|---|---|---|
| `chest` (default) | 9 | 1–6 (variable) | rows×9 (9–54) | `generic_54.png` (existing) | `CHEST` (via size) |
| `hopper` | 5 | 1 (fixed) | 5 | `hopper.png` (to add) | `HOPPER` |
| `dropper` | 3 | 3 (fixed) | 9 | `dispenser.png` (to add) | `DROPPER` (or `DISPENSER`) |

**Out of scope (V2+)**: furnace/`FURNACE`, crafting table/`WORKBENCH`, anvil/`ANVIL`, brewing, enchanting… — their slots are functional (smelting/crafting, result slots, item consumption) and do not behave like static menus. Decided in brainstorm.

## 2. Principle: a single geometry table

All the logic (editor, plugin, validation, export) derives from **a single table** describing each type. On the editor side (`editor/src/features/canvas/inventoryTypes.ts`, new):

```ts
export type InventoryType = "chest" | "hopper" | "dropper";

interface InventoryGeometry {
  cols: number;                       // grid columns
  fixedRows?: number;                 // fixed rows (hopper=1, dropper=3); chest = variable
  slotsFor: (rows: number) => number; // chest: rows*9 ; hopper: 5 ; dropper: 9
  textureKey: string;                 // GUI background asset
}

export const INVENTORY_TYPES: Record<InventoryType, InventoryGeometry> = {
  chest:   { cols: 9, slotsFor: (r) => r * 9, textureKey: "generic_54" },
  hopper:  { cols: 5, fixedRows: 1, slotsFor: () => 5, textureKey: "hopper" },
  dropper: { cols: 3, fixedRows: 3, slotsFor: () => 9, textureKey: "dispenser" },
};
```

Derived helpers: `colsFor(type)`, `rowsFor(type, menu.rows)` (= `fixedRows ?? rows`), `slotCount(type, rows)`, `slotXY(i, type)` (uses `cols`). On the plugin side, a mirror table `type → InventoryType`.

## 3. Data model

### 3.1 Domain (`editor/src/domain/types.ts`)
- Add `Menu.inventoryType?: InventoryType` (optional, defaults to `"chest"` on read). `rows` stays, **meaningful for chest only**; for hopper/dropper it is ignored (fixed rows via the table).
- `Element.positions` (string "0-8") **unchanged**: still 0-based indices, simply bounded by `slotCount(type, rows)`.

### 3.2 `menu/v1` schema (`docs/schema/menu/v1/schema.json`)
- **Addition of an OPTIONAL field** `inventory_type` (enum `["chest","hopper","dropper"]`, default `chest`). **Backward-compatible additive change**: an existing menu without the field = chest, stays valid. → stays in **menu/v1** (no v2; the "new version = new folder" rule targets *breaking* changes, which this is not).
- `size` (slot count) **kept** but the enum is widened: `[5, 9, 18, 27, 36, 45, 54]` (5 = hopper, 9 = dropper *or* 1-row chest).
- **Cross validation** `inventory_type` ↔ `size` (ajv + `validateMenuV1`): `chest` ⇒ size ∈ {9,18,27,36,45,54}; `hopper` ⇒ size = 5; `dropper` ⇒ size = 9. Update the fixtures/examples + `docs/architecture/schemas-codegen.md`.

## 4. Editor — geometry & rendering

### 4.1 `menuLayout.ts`
Today `COLS = 9` is constant and `slotXY(i)` does `i % 9` / `i / 9`; `menuBoxSize(rows)` and the texture crops are chest-only. Parameterize by type:
- `COLS` → `colsFor(type)`.
- `slotXY(i, type)` → `col = i % cols`, `row = floor(i / cols)`.
- `menuBoxSize(type, rows)` → width/height according to the type's texture (chest 176px; hopper/dropper narrower).
- Texture slicing (`topPieceCrop`/`bottomPieceCrop`, specific to `generic_54.png`) → selection by `textureKey`; each type has its own background dimensions. Hopper/dropper have a fixed background (no slicing by rows).
- `nodeBox(pack, id, layout)` (used by Edges/GhostChips) → accounts for the type for the menu size on the board.

### 4.2 Textures
Add the vanilla **hopper** and **dispenser** GUI backgrounds to the editor asset pipeline (next to `generic_54.png`). Source: vanilla Minecraft GUI textures (the same ones already fetched by `gen-items`/MC assets). Document in `editor-internals.md`.

### 4.3 Rendering (`MenuGroup` + `SoloMenuStage`)
`MenuGroup` reads `menu.inventoryType`, chooses the background texture + the slot geometry via the table. The **same** component renders the 3 types (no fork). Title composer: all these containers have a title bar — title rendering applies. ⚠️ **Notable complexity**: the title composer's pixel-offsets pipeline assumes the chest width (`contentWidth`/176). Hopper/dropper are narrower → pass a **content width per type** to the composer. (The title works in all cases; only the pixel-perfect offsets depend on the width.)

## 5. Editor — UX

### 5.1 Type selector (`MenuProperties`)
Add an **"Inventory type"** selector (Chest / Hopper / Dropper), via the design system (`components/ui` — Select/SegmentedControl or DropdownMenu). When `chest` → show the existing **rows (1–6)** selector; otherwise hide it (fixed rows).

### 5.2 Type change with out-of-bounds items
Going from a big type to a smaller one (e.g. chest 54 → hopper 5) can leave elements whose `positions` exceed the new `slotCount`. **Behavior: keep the data + show a warning** ("N elements outside the inventory" chip) in `MenuProperties`; **do not delete** silently. (Rejected alternative: auto-drop.) The canvas rendering only shows the in-range slots; the export already filters out-of-bounds positions on the plugin side (`parsePositions … filter { it in 0 until size }`).

### 5.3 Creation
`NewMenuDialog` creates a **chest** by default; the type is changed afterwards in `MenuProperties` (simple creation, no extra picker at creation).

## 6. Plugin (Kotlin)

- `MenuYaml` (`PackBundle.kt`): add `@JsonProperty("inventory_type") val inventoryType: String = "chest"`.
- `MenuRenderer.kt`: if `inventoryType != "chest"`, create via `Bukkit.createInventory(holder, InventoryType.HOPPER|DROPPER, title)`; otherwise keep the size-based call (`createInventory(holder, size, title)`). `type → InventoryType` table on the plugin side. The legacy fallback (`String` title) is kept for both paths.
- Slot population **unchanged**: `parsePositions(positions, size)` already bounds to `0 until size`; for hopper `size=5`, dropper `size=9`.
- Plugin tests: opening a hopper/dropper creates the right `InventoryType` + size; a menu without `inventory_type` stays a chest.

## 7. Export / import / migration

- `transform.ts` `serializeMenuToV1`: emit `inventory_type` **only if ≠ chest** (clean backward compat); `size = slotCount(type, rows)` (chest rows×9, hopper 5, dropper 9).
- `menuV1ToDomain.ts`: read `inventory_type` (default `chest`); for chest, `rows = size/9` (unchanged); for hopper/dropper, `rows` is irrelevant (the table fixes the geometry).
- **Migration**: no data migration — an existing menu without `inventory_type` is treated as chest everywhere (default). Packs on disk stay valid.

## 8. Tests

| Layer | Coverage |
|---|---|
| `inventoryTypes.ts` | table + `colsFor`/`slotCount`/`slotXY` per type (hopper 5×1, dropper 3×3, chest 9×rows). |
| `menuLayout` | `slotXY(i, type)` correct per type; `menuBoxSize` per type. |
| Schema | `validateMenuV1`: cross validation size↔type (hopper⇒5, dropper⇒9, chest⇒multiple of 9); menu without `inventory_type` = valid (chest). |
| Export/import | domain→v1→domain round-trip for the 3 types; back-compat (v1 without the field → chest). |
| Editor UX | type selector; rows hidden outside chest; out-of-bounds items warning on switch. |
| Plugin | `MenuRenderer` creates the right `InventoryType`/size; menu without the field = chest; out-of-bounds slots ignored. |

## 9. Non-goals (V1)

- Functional types (furnace, crafting, anvil, brewing, enchanting, beacon, grindstone…) — slots with special behavior, postponed.
- Custom layouts / arbitrary columns outside real Minecraft types.
- Editing the type at creation (creation = chest; change in properties).
- Advanced pixel-perfect title composer on hopper/dropper: the per-type width is wired, but if a title feature turns out to be too coupled to the chest width, it may be gated chest-only in V1 (to confirm at implementation).
