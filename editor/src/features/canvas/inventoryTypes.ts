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
