import type { InventoryType, PlayerInventoryMode } from "@/domain/types";

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
  /** MC-pixel y of the first player inventory row's outer cell. `null` = after the chest rows. */
  playerInvY: number | null;
  /** Editor background texture key (resolved to a URL via TEXTURE_URLS in menuLayout). */
  textureKey: "generic_54" | "hopper" | "dispenser";
  /** Bukkit InventoryType name used by the plugin. */
  bukkitType: "CHEST" | "HOPPER" | "DROPPER";
}

/** Single source of truth for every type-specific geometry attribute. */
export const INVENTORY_TYPES: Record<InventoryType, InventoryGeometry> = {
  // `firstSlotX/Y` = the top-left of slot 0's 18×18 *graphic* cell in the texture
  // (NOT the inner 16×16 item area — the +1px MC_SLOT_INNER_OFFSET handles that).
  // Same convention as chest's (7,17). Values verified against the actual
  // hopper/dispenser GUI textures (hopper grid at 43,19; dispenser grid at 61,16).
  chest: {
    cols: 9,
    rows: null,
    firstSlotX: 7,
    firstSlotY: 17,
    boxHeight: null,
    playerInvY: null,
    textureKey: "generic_54",
    bukkitType: "CHEST",
  },
  hopper: {
    cols: 5,
    rows: 1,
    firstSlotX: 43,
    firstSlotY: 19,
    boxHeight: 133,
    playerInvY: 50,
    textureKey: "hopper",
    bukkitType: "HOPPER",
  },
  dropper: {
    cols: 3,
    rows: 3,
    firstSlotX: 61,
    firstSlotY: 16,
    boxHeight: 166,
    playerInvY: 83,
    textureKey: "dispenser",
    bukkitType: "DROPPER",
  },
};

export const colsFor = (type: InventoryType): number => INVENTORY_TYPES[type].cols;

/** Effective row count: the type's fixed rows, or the chest's `menu.rows`. */
export const rowsFor = (type: InventoryType, chestRows: number): number =>
  INVENTORY_TYPES[type].rows ?? chestRows;

/** Total slot count for the type (chest = rows·9, hopper = 5, dropper = 9). */
export const slotCount = (type: InventoryType, chestRows: number): number =>
  colsFor(type) * rowsFor(type, chestRows);

/** Player inventory part of the window: 27 main slots then the 9 hotbar slots. */
export const PLAYER_SLOTS = 36;
const PLAYER_COLS = 9;
/** Gap between the main inventory rows and the hotbar, in MC pixels. */
const HOTBAR_GAP = 4;

/** Addressable positions: the menu, plus the player slots when the bottom is hidden. */
export const positionCount = (
  type: InventoryType,
  chestRows: number,
  playerInventory: PlayerInventoryMode | undefined,
): number => slotCount(type, chestRows) + (playerInventory === "hidden" ? PLAYER_SLOTS : 0);

/**
 * Top-left of position `i`'s outer cell in MC pixels, relative to the GUI
 * origin. Positions past the menu (`≥ slotCount`) are protocol raw slots of the
 * player inventory, drawn on the vanilla cells below the menu.
 */
export const slotMcXY = (
  i: number,
  type: InventoryType,
  chestRows = 6,
): { x: number; y: number } => {
  const g = INVENTORY_TYPES[type];
  const size = slotCount(type, chestRows);
  if (i >= size) {
    const j = i - size;
    const row = Math.floor(j / PLAYER_COLS);
    const top = g.playerInvY ?? g.firstSlotY + rowsFor(type, chestRows) * MC_SLOT_STRIDE + 13;
    return {
      x: 7 + (j % PLAYER_COLS) * MC_SLOT_STRIDE,
      y: top + row * MC_SLOT_STRIDE + (row === 3 ? HOTBAR_GAP : 0),
    };
  }
  return {
    x: g.firstSlotX + (i % g.cols) * MC_SLOT_STRIDE,
    y: g.firstSlotY + Math.floor(i / g.cols) * MC_SLOT_STRIDE,
  };
};

/**
 * Visual grid cell of a position: the menu rows, then the 4 player rows below
 * (9 columns whatever the container). Used to move selections by a delta.
 */
export const positionToCell = (
  i: number,
  type: InventoryType,
  chestRows: number,
): { col: number; row: number } => {
  const size = slotCount(type, chestRows);
  if (i < size) return { col: i % colsFor(type), row: Math.floor(i / colsFor(type)) };
  const j = i - size;
  return { col: j % PLAYER_COLS, row: rowsFor(type, chestRows) + Math.floor(j / PLAYER_COLS) };
};

/** Inverse of [positionToCell]; `null` outside the addressable positions. */
export const cellToPosition = (
  cell: { col: number; row: number },
  type: InventoryType,
  chestRows: number,
  playerInventory: PlayerInventoryMode | undefined,
): number | null => {
  const rows = rowsFor(type, chestRows);
  const { col, row } = cell;
  if (col < 0 || row < 0) return null;
  if (row < rows) return col < colsFor(type) ? row * colsFor(type) + col : null;
  if (playerInventory !== "hidden" || col >= PLAYER_COLS || row >= rows + 4) return null;
  return slotCount(type, chestRows) + (row - rows) * PLAYER_COLS + col;
};
