import { newAssetId, newElementId, newLayerId, newPackId } from "@/domain/ids";
import { assertPackHermetic } from "@/domain/invariants";
import type {
  Account,
  Action,
  ClickType,
  Command,
  CommandId,
  Element,
  ElementId,
  Layer,
  Menu,
  MenuId,
  PackId,
} from "@/domain/types";
import {
  addPosition,
  formatPositions,
  parsePositions,
  positionsContains,
  removePosition,
} from "@/lib/positions";
import { mockAccount } from "@/mock/fixtures";
import { produce } from "immer";
import { temporal } from "zundo";
import { create } from "zustand";
import { persist } from "zustand/middleware";

type MenuRows = 1 | 2 | 3 | 4 | 5 | 6;

interface AccountState {
  account: Account;
  createPack: (input: { name: string; description?: string }) => void;
  reorderPacks: (newOrder: PackId[]) => void;
  moveMenuToPack: (input: { menuId: MenuId; fromPackId: PackId; toPackId: PackId }) => void;
  setCanvasPosition: (input: { packId: PackId; nodeId: string; x: number; y: number }) => void;
  deleteFromPack: (input: { packId: PackId; nodeIds: string[] }) => void;
  setPackField: (input: { packId: PackId; field: "name" | "description"; value: string }) => void;
  setMenuField: (input: {
    packId: PackId;
    menuId: MenuId;
    field: "title" | "permission" | "rows";
    value: string | MenuRows;
  }) => void;
  setCommandField: (input: {
    packId: PackId;
    commandId: CommandId;
    field: "name" | "permission" | "description";
    value: string;
  }) => void;
  setSlotMaterial: (input: {
    packId: PackId;
    menuId: MenuId;
    position: number;
    material: string;
  }) => void;
  /** Removes the element at the given position from the menu's first layer. */
  clearSlot: (input: { packId: PackId; menuId: MenuId; position: number }) => void;
  /** Update a scalar field on the element's appearance at the given index (default 0). */
  setAppearanceField: (input: {
    packId: PackId;
    menuId: MenuId;
    elementId: ElementId;
    appearanceIndex?: number;
    field: "title" | "count";
    value: string | number;
  }) => void;
  /** Replace the element's appearance lore lines at the given index (default 0). */
  setAppearanceLore: (input: {
    packId: PackId;
    menuId: MenuId;
    elementId: ElementId;
    appearanceIndex?: number;
    lines: string[];
  }) => void;
  /** Replace the element's positions string (e.g. "0-8,17,26"). */
  setElementPositions: (input: {
    packId: PackId;
    menuId: MenuId;
    elementId: ElementId;
    positions: string;
  }) => void;
  /**
   * Move one position of an element to another slot — atomically replaces
   * `fromPosition` with `toPosition` in the element's positions list, and
   * removes `toPosition` from any other element that might have owned it
   * (positions are unique across elements within a menu).
   */
  moveElementPosition: (input: {
    packId: PackId;
    menuId: MenuId;
    elementId: ElementId;
    fromPosition: number;
    toPosition: number;
  }) => void;
  /**
   * Add a position to an element's list (Alt+drag duplicate). If another
   * element already owns the position, it loses it.
   */
  addElementPosition: (input: {
    packId: PackId;
    menuId: MenuId;
    elementId: ElementId;
    position: number;
  }) => void;
  /** Remove an element from its menu, regardless of how many positions it has. */
  deleteElement: (input: { packId: PackId; menuId: MenuId; elementId: ElementId }) => void;
  /**
   * Replace one action inside a click handler (or its fallback) with a new
   * Action object. The new action's `type` may differ from the old one — the
   * caller is responsible for shape correctness.
   */
  setElementAction: (input: {
    packId: PackId;
    menuId: MenuId;
    elementId: ElementId;
    appearanceIndex: number;
    clickType: ClickType;
    fallback: boolean;
    actionIndex: number;
    action: Action;
  }) => void;
  /**
   * Replace one action inside a command's action chain.
   */
  setCommandAction: (input: {
    packId: PackId;
    commandId: CommandId;
    actionIndex: number;
    action: Action;
  }) => void;
  /**
   * Insert a fully-formed element (already given a fresh id) into a menu's
   * first layer. Any positions claimed by the new element are stripped from
   * sibling elements (positions are unique within a menu).
   */
  addElement: (input: { packId: PackId; menuId: MenuId; element: Element }) => void;
  /**
   * Shift every position of every element in `elementIds` by (dCol, dRow)
   * within the menu's grid. Throws if any new position would fall outside
   * the menu. Positions claimed by the move are stripped from non-target
   * elements (takeover semantics, matching addElementPosition).
   */
  moveSelectionByDelta: (input: {
    packId: PackId;
    menuId: MenuId;
    elementIds: ElementId[];
    dCol: number;
    dRow: number;
  }) => void;
  /**
   * Set (or clear) a menu's background image. When `dataUrl` is provided we
   * also create a new Asset on the pack with the given metadata. When null, the
   * background is detached (the asset stays in the pack so other menus can
   * still reference it).
   */
  setMenuBackground: (input: {
    packId: PackId;
    menuId: MenuId;
    asset: { name: string; dataUrl: string; width: number; height: number } | null;
  }) => void;
  /** Paste already-cloned-and-id-rewritten entities into a pack at an offset. */
  pasteEntities: (input: {
    packId: PackId;
    menus: Menu[];
    commands: Command[];
    offset: { x: number; y: number };
  }) => void;
}

/**
 * Middleware order: temporal(persist(stateCreator)).
 *
 * `temporal` wraps the persisted state creator so undo/redo replays the
 * `account` slice. Action functions are stable refs, so excluding them via
 * `partialize` keeps the diff narrow.
 *
 * Account-level mutations (createPack, reorderPacks) clear the temporal
 * stack themselves so they don't tangle with pack-internal edits in the
 * undo history. Pack-internal mutations (slot material, field edits, canvas
 * position, deleteFromPack, moveMenuToPack) are undoable.
 */
const clearTemporal = () => useAccountStore.temporal.getState().clear();

export const useAccountStore = create<AccountState>()(
  temporal(
    persist(
      (set, get) => ({
        account: mockAccount(),
        createPack: ({ name, description }) => {
          set(
            produce((draft: AccountState) => {
              const id = newPackId();
              draft.account.packs.push({
                id,
                name,
                description,
                source: "user_created",
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                menus: [],
                commands: [],
                templates: [],
                assets: [],
                i18nKeys: {},
                defaultLang: "en",
                canvasLayout: {},
              });
              draft.account.packOrder.push(id);
            }),
          );
          clearTemporal();
        },
        reorderPacks: (newOrder) => {
          set(
            produce((draft: AccountState) => {
              draft.account.packOrder = [...newOrder];
            }),
          );
          clearTemporal();
        },
        moveMenuToPack: ({ menuId: mId, fromPackId, toPackId }) => {
          const next = produce(get().account, (draft) => {
            const from = draft.packs.find((p) => p.id === fromPackId);
            const to = draft.packs.find((p) => p.id === toPackId);
            if (!from || !to) throw new Error("pack not found");
            const idx = from.menus.findIndex((m) => m.id === mId);
            if (idx === -1) throw new Error("menu not found in source pack");
            const [moved] = from.menus.splice(idx, 1);
            if (!moved) return;
            moved.packId = toPackId;
            to.menus.push(moved);
          });
          const fromAfter = next.packs.find((p) => p.id === fromPackId)!;
          const toAfter = next.packs.find((p) => p.id === toPackId)!;
          assertPackHermetic(fromAfter);
          assertPackHermetic(toAfter);
          set({ account: next });
        },
        setCanvasPosition: ({ packId: pId, nodeId, x, y }) =>
          set(
            produce((draft: AccountState) => {
              const pack = draft.account.packs.find((p) => p.id === pId);
              if (!pack) return;
              (pack.canvasLayout as Record<string, { x: number; y: number }>)[nodeId] = { x, y };
            }),
          ),
        setPackField: ({ packId: pId, field, value }) =>
          set(
            produce((draft: AccountState) => {
              const pack = draft.account.packs.find((p) => p.id === pId);
              if (!pack) return;
              if (field === "name") pack.name = value;
              else if (field === "description") pack.description = value || undefined;
              pack.updatedAt = new Date().toISOString();
            }),
          ),
        setMenuField: ({ packId: pId, menuId: mId, field, value }) => {
          const next = produce(get().account, (draft) => {
            const pack = draft.packs.find((p) => p.id === pId);
            if (!pack) return;
            const menu = pack.menus.find((m) => m.id === mId);
            if (!menu) return;
            if (field === "title") {
              if (typeof value !== "string") return;
              menu.title = value;
            } else if (field === "permission") {
              if (typeof value !== "string") return;
              menu.permission = value || undefined;
            } else if (field === "rows") {
              if (typeof value !== "number") return;
              const maxPos = value * 9 - 1;
              const overflow = menu.layers.some((l) =>
                l.elements.some((el) => parsePositions(el.positions).some((p) => p > maxPos)),
              );
              if (overflow) {
                throw new Error(
                  `cannot shrink to ${value} rows: elements exist past position ${maxPos}`,
                );
              }
              menu.rows = value;
            }
            pack.updatedAt = new Date().toISOString();
          });
          const after = next.packs.find((p) => p.id === pId);
          if (after) assertPackHermetic(after);
          set({ account: next });
        },
        setCommandField: ({ packId: pId, commandId: cId, field, value }) =>
          set(
            produce((draft: AccountState) => {
              const pack = draft.account.packs.find((p) => p.id === pId);
              if (!pack) return;
              const cmd = pack.commands.find((c) => c.id === cId);
              if (!cmd) return;
              if (field === "name") cmd.name = value;
              else if (field === "permission") cmd.permission = value || undefined;
              else if (field === "description") cmd.description = value || undefined;
              pack.updatedAt = new Date().toISOString();
            }),
          ),
        setSlotMaterial: ({ packId: pId, menuId: mId, position, material }) =>
          set(
            produce((draft: AccountState) => {
              const pack = draft.account.packs.find((p) => p.id === pId);
              if (!pack) return;
              const menu = pack.menus.find((m) => m.id === mId);
              if (!menu) return;
              // Find the element that currently owns this position (single OR
              // multi-pos), update its material — preserves title/lore/count.
              for (const layer of menu.layers) {
                for (const el of layer.elements) {
                  if (!positionsContains(el.positions, position)) continue;
                  const appearance = el.appearances[0];
                  if (appearance) appearance.material = material;
                  pack.updatedAt = new Date().toISOString();
                  return;
                }
              }
              let firstLayer: Layer | undefined = menu.layers[0];
              if (!firstLayer) {
                firstLayer = { id: newLayerId(), name: "default", elements: [] };
                menu.layers.push(firstLayer);
              }
              firstLayer.elements.push({
                id: newElementId(),
                positions: String(position),
                appearances: [{ material }],
              });
              pack.updatedAt = new Date().toISOString();
            }),
          ),
        setAppearanceField: ({
          packId: pId,
          menuId: mId,
          elementId,
          appearanceIndex = 0,
          field,
          value,
        }) =>
          set(
            produce((draft: AccountState) => {
              const pack = draft.account.packs.find((p) => p.id === pId);
              if (!pack) return;
              const menu = pack.menus.find((m) => m.id === mId);
              if (!menu) return;
              for (const layer of menu.layers) {
                for (const el of layer.elements) {
                  if (el.id !== elementId) continue;
                  const appearance = el.appearances[appearanceIndex];
                  if (!appearance) return;
                  if (field === "title") {
                    if (typeof value !== "string") return;
                    appearance.title = value || undefined;
                  } else if (field === "count") {
                    const n = typeof value === "number" ? value : Number(value);
                    if (Number.isNaN(n) || n < 1 || n > 64) return;
                    appearance.count = n === 1 ? undefined : n;
                  }
                  pack.updatedAt = new Date().toISOString();
                  return;
                }
              }
            }),
          ),
        setElementPositions: ({ packId: pId, menuId: mId, elementId, positions }) =>
          set(
            produce((draft: AccountState) => {
              const pack = draft.account.packs.find((p) => p.id === pId);
              if (!pack) return;
              const menu = pack.menus.find((m) => m.id === mId);
              if (!menu) return;
              for (const layer of menu.layers) {
                for (const el of layer.elements) {
                  if (el.id !== elementId) continue;
                  el.positions = positions;
                  pack.updatedAt = new Date().toISOString();
                  return;
                }
              }
            }),
          ),
        moveElementPosition: ({ packId: pId, menuId: mId, elementId, fromPosition, toPosition }) =>
          set(
            produce((draft: AccountState) => {
              const pack = draft.account.packs.find((p) => p.id === pId);
              if (!pack) return;
              const menu = pack.menus.find((m) => m.id === mId);
              if (!menu) return;
              // First, strip toPosition from any element that owns it.
              for (const layer of menu.layers) {
                for (const otherEl of layer.elements) {
                  if (otherEl.id === elementId) continue;
                  if (positionsContains(otherEl.positions, toPosition)) {
                    otherEl.positions = removePosition(otherEl.positions, toPosition);
                  }
                }
                layer.elements = layer.elements.filter((el) => el.positions !== "");
              }
              // Then update the source element: remove from, add to.
              for (const layer of menu.layers) {
                for (const el of layer.elements) {
                  if (el.id !== elementId) continue;
                  el.positions = addPosition(
                    removePosition(el.positions, fromPosition),
                    toPosition,
                  );
                  pack.updatedAt = new Date().toISOString();
                  return;
                }
              }
            }),
          ),
        addElementPosition: ({ packId: pId, menuId: mId, elementId, position }) =>
          set(
            produce((draft: AccountState) => {
              const pack = draft.account.packs.find((p) => p.id === pId);
              if (!pack) return;
              const menu = pack.menus.find((m) => m.id === mId);
              if (!menu) return;
              for (const layer of menu.layers) {
                for (const otherEl of layer.elements) {
                  if (otherEl.id === elementId) continue;
                  if (positionsContains(otherEl.positions, position)) {
                    otherEl.positions = removePosition(otherEl.positions, position);
                  }
                }
                layer.elements = layer.elements.filter((el) => el.positions !== "");
              }
              for (const layer of menu.layers) {
                for (const el of layer.elements) {
                  if (el.id !== elementId) continue;
                  el.positions = addPosition(el.positions, position);
                  pack.updatedAt = new Date().toISOString();
                  return;
                }
              }
            }),
          ),
        deleteElement: ({ packId: pId, menuId: mId, elementId }) =>
          set(
            produce((draft: AccountState) => {
              const pack = draft.account.packs.find((p) => p.id === pId);
              if (!pack) return;
              const menu = pack.menus.find((m) => m.id === mId);
              if (!menu) return;
              for (const layer of menu.layers) {
                const idx = layer.elements.findIndex((el) => el.id === elementId);
                if (idx !== -1) {
                  layer.elements.splice(idx, 1);
                  pack.updatedAt = new Date().toISOString();
                  return;
                }
              }
            }),
          ),
        setElementAction: ({
          packId: pId,
          menuId: mId,
          elementId,
          appearanceIndex,
          clickType,
          fallback,
          actionIndex,
          action,
        }) =>
          set(
            produce((draft: AccountState) => {
              const pack = draft.account.packs.find((p) => p.id === pId);
              if (!pack) return;
              const menu = pack.menus.find((m) => m.id === mId);
              if (!menu) return;
              for (const layer of menu.layers) {
                for (const el of layer.elements) {
                  if (el.id !== elementId) continue;
                  const appearance = el.appearances[appearanceIndex];
                  if (!appearance?.click) return;
                  const handler = appearance.click[clickType];
                  if (!handler) return;
                  const list = fallback ? handler.fallback : handler.actions;
                  if (!list || actionIndex < 0 || actionIndex >= list.length) return;
                  list[actionIndex] = action;
                  pack.updatedAt = new Date().toISOString();
                  return;
                }
              }
            }),
          ),
        setCommandAction: ({ packId: pId, commandId: cId, actionIndex, action }) =>
          set(
            produce((draft: AccountState) => {
              const pack = draft.account.packs.find((p) => p.id === pId);
              if (!pack) return;
              const cmd = pack.commands.find((c) => c.id === cId);
              if (!cmd) return;
              if (actionIndex < 0 || actionIndex >= cmd.actions.length) return;
              cmd.actions[actionIndex] = action;
              pack.updatedAt = new Date().toISOString();
            }),
          ),
        addElement: ({ packId: pId, menuId: mId, element }) =>
          set(
            produce((draft: AccountState) => {
              const pack = draft.account.packs.find((p) => p.id === pId);
              if (!pack) return;
              const menu = pack.menus.find((m) => m.id === mId);
              if (!menu) return;
              const newPositions = parsePositions(element.positions);
              for (const layer of menu.layers) {
                for (const otherEl of layer.elements) {
                  for (const p of newPositions) {
                    if (positionsContains(otherEl.positions, p)) {
                      otherEl.positions = removePosition(otherEl.positions, p);
                    }
                  }
                }
                layer.elements = layer.elements.filter((el) => el.positions !== "");
              }
              let firstLayer: Layer | undefined = menu.layers[0];
              if (!firstLayer) {
                firstLayer = { id: newLayerId(), name: "default", elements: [] };
                menu.layers.push(firstLayer);
              }
              firstLayer.elements.push({ ...element, positions: formatPositions(newPositions) });
              pack.updatedAt = new Date().toISOString();
            }),
          ),
        moveSelectionByDelta: ({ packId: pId, menuId: mId, elementIds, dCol, dRow }) => {
          const next = produce(get().account, (draft) => {
            const pack = draft.packs.find((p) => p.id === pId);
            if (!pack) return;
            const menu = pack.menus.find((m) => m.id === mId);
            if (!menu) return;
            const targetSet = new Set(elementIds);
            // First pass: compute new positions and validate bounds.
            const plans = new Map<ElementId, number[]>();
            for (const layer of menu.layers) {
              for (const el of layer.elements) {
                if (!targetSet.has(el.id)) continue;
                const newPositions: number[] = [];
                for (const p of parsePositions(el.positions)) {
                  const newCol = (p % 9) + dCol;
                  const newRow = Math.floor(p / 9) + dRow;
                  if (newCol < 0 || newCol >= 9 || newRow < 0 || newRow >= menu.rows) {
                    throw new Error("selection drag would land outside the menu");
                  }
                  newPositions.push(newRow * 9 + newCol);
                }
                plans.set(el.id, newPositions);
              }
            }
            if (plans.size === 0) return;
            // Strip new positions from non-target elements (takeover).
            const claimed = new Set<number>();
            for (const ps of plans.values()) for (const p of ps) claimed.add(p);
            for (const layer of menu.layers) {
              for (const otherEl of layer.elements) {
                if (targetSet.has(otherEl.id)) continue;
                const filtered = parsePositions(otherEl.positions).filter((p) => !claimed.has(p));
                otherEl.positions = formatPositions(filtered);
              }
              layer.elements = layer.elements.filter((el) => el.positions !== "");
            }
            // Apply new positions to target elements.
            for (const layer of menu.layers) {
              for (const el of layer.elements) {
                const plan = plans.get(el.id);
                if (plan) el.positions = formatPositions(plan);
              }
            }
            pack.updatedAt = new Date().toISOString();
          });
          set({ account: next });
        },
        setAppearanceLore: ({ packId: pId, menuId: mId, elementId, appearanceIndex = 0, lines }) =>
          set(
            produce((draft: AccountState) => {
              const pack = draft.account.packs.find((p) => p.id === pId);
              if (!pack) return;
              const menu = pack.menus.find((m) => m.id === mId);
              if (!menu) return;
              for (const layer of menu.layers) {
                for (const el of layer.elements) {
                  if (el.id !== elementId) continue;
                  const appearance = el.appearances[appearanceIndex];
                  if (!appearance) return;
                  appearance.lore = lines.length > 0 ? lines : undefined;
                  pack.updatedAt = new Date().toISOString();
                  return;
                }
              }
            }),
          ),
        clearSlot: ({ packId: pId, menuId: mId, position }) =>
          set(
            produce((draft: AccountState) => {
              const pack = draft.account.packs.find((p) => p.id === pId);
              if (!pack) return;
              const menu = pack.menus.find((m) => m.id === mId);
              if (!menu) return;
              for (const layer of menu.layers) {
                const idx = layer.elements.findIndex((el) =>
                  positionsContains(el.positions, position),
                );
                if (idx === -1) continue;
                const el = layer.elements[idx]!;
                const remaining = removePosition(el.positions, position);
                if (remaining === "") {
                  // Last position — drop the element entirely.
                  layer.elements.splice(idx, 1);
                } else {
                  el.positions = remaining;
                }
                pack.updatedAt = new Date().toISOString();
                return;
              }
            }),
          ),
        setMenuBackground: ({ packId: pId, menuId: mId, asset }) =>
          set(
            produce((draft: AccountState) => {
              const pack = draft.account.packs.find((p) => p.id === pId);
              if (!pack) return;
              const menu = pack.menus.find((m) => m.id === mId);
              if (!menu) return;
              if (asset === null) {
                menu.background = undefined;
              } else {
                const id = newAssetId();
                pack.assets.push({
                  id,
                  packId: pId,
                  name: asset.name,
                  url: asset.dataUrl,
                  width: asset.width,
                  height: asset.height,
                });
                menu.background = { assetId: id };
              }
              pack.updatedAt = new Date().toISOString();
            }),
          ),
        pasteEntities: ({ packId: pId, menus, commands, offset }) => {
          const next = produce(get().account, (draft) => {
            const pack = draft.packs.find((p) => p.id === pId);
            if (!pack) return;
            for (const m of menus) {
              const stamped: Menu = { ...m, packId: pId };
              pack.menus.push(stamped);
              (pack.canvasLayout as Record<string, { x: number; y: number }>)[stamped.id] = {
                x: offset.x,
                y: offset.y,
              };
              offset.x += 24;
              offset.y += 24;
            }
            for (const c of commands) {
              const stamped: Command = { ...c, packId: pId };
              pack.commands.push(stamped);
              (pack.canvasLayout as Record<string, { x: number; y: number }>)[stamped.id] = {
                x: offset.x,
                y: offset.y,
              };
              offset.x += 24;
              offset.y += 24;
            }
          });
          const after = next.packs.find((p) => p.id === pId);
          if (!after) return;
          assertPackHermetic(after);
          set({ account: next });
        },
        deleteFromPack: ({ packId: pId, nodeIds }) => {
          const ids = new Set(nodeIds);
          const next = produce(get().account, (draft) => {
            const pack = draft.packs.find((p) => p.id === pId);
            if (!pack) return;
            pack.menus = pack.menus.filter((m) => !ids.has(m.id));
            pack.commands = pack.commands.filter((c) => !ids.has(c.id));
            for (const id of ids) {
              delete (pack.canvasLayout as Record<string, { x: number; y: number }>)[id];
            }
          });
          const after = next.packs.find((p) => p.id === pId);
          if (!after) return;
          assertPackHermetic(after);
          set({ account: next });
        },
      }),
      { name: "interfaze:account" },
    ),
    {
      // Track only the account slice so action references aren't diffed.
      partialize: (state) => ({ account: state.account }),
      // Drop the very-frequent canvasPosition writes from history when the
      // user is just dragging menus around (otherwise undo replays each px).
      // Equality lets temporal collapse identical states.
      equality: (a, b) => a.account === b.account,
      limit: 100,
    },
  ),
);
