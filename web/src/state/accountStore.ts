import { newAssetId, newElementId, newLayerId, newPackId } from "@/domain/ids";
import { assertPackHermetic } from "@/domain/invariants";
import { type StepFrame, type StepPath, resolveParentMut } from "@/domain/stepPath";
import type {
  Account,
  ClickType,
  Command,
  CommandId,
  Condition,
  Element,
  ElementId,
  Layer,
  Menu,
  MenuId,
  PackId,
  Step,
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
    field: "title" | "count" | "material";
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
  /** Replace one step inside a click handler's step tree at the given path. */
  setElementStep: (input: {
    packId: PackId;
    menuId: MenuId;
    elementId: ElementId;
    appearanceIndex: number;
    clickType: ClickType;
    path: StepPath;
    step: Step;
  }) => void;
  /**
   * Insert a step into a click handler's step tree. `frames` describes how
   * to descend through if-steps; `index` is the position in the resolved
   * Step[] (negative or out-of-range → append).
   */
  addElementStep: (input: {
    packId: PackId;
    menuId: MenuId;
    elementId: ElementId;
    appearanceIndex: number;
    clickType: ClickType;
    frames: StepFrame[];
    index: number;
    step: Step;
  }) => void;
  removeElementStep: (input: {
    packId: PackId;
    menuId: MenuId;
    elementId: ElementId;
    appearanceIndex: number;
    clickType: ClickType;
    path: StepPath;
  }) => void;
  /** Reorder steps within the same Step[] (same parent). */
  moveElementStep: (input: {
    packId: PackId;
    menuId: MenuId;
    elementId: ElementId;
    appearanceIndex: number;
    clickType: ClickType;
    frames: StepFrame[];
    fromIndex: number;
    toIndex: number;
  }) => void;
  /** Add a new case to an if-step. */
  addIfCase: (input: {
    packId: PackId;
    menuId: MenuId;
    elementId: ElementId;
    appearanceIndex: number;
    clickType: ClickType;
    frames: StepFrame[];
    ifStepIndex: number;
  }) => void;
  /** Remove a case from an if-step. */
  removeIfCase: (input: {
    packId: PackId;
    menuId: MenuId;
    elementId: ElementId;
    appearanceIndex: number;
    clickType: ClickType;
    frames: StepFrame[];
    ifStepIndex: number;
    caseIndex: number;
  }) => void;
  /** Replace the conditions for one case of an if-step. */
  setIfCaseConditions: (input: {
    packId: PackId;
    menuId: MenuId;
    elementId: ElementId;
    appearanceIndex: number;
    clickType: ClickType;
    frames: StepFrame[];
    ifStepIndex: number;
    caseIndex: number;
    conditions: Condition[];
  }) => void;
  /** Set the operator for one joiner inside a case (between conditions[i] and [i+1]). */
  setIfCaseJoin: (input: {
    packId: PackId;
    menuId: MenuId;
    elementId: ElementId;
    appearanceIndex: number;
    clickType: ClickType;
    frames: StepFrame[];
    ifStepIndex: number;
    caseIndex: number;
    joinIndex: number;
    op: "and" | "or";
  }) => void;
  /** Toggle the else-branch of an if-step on or off. */
  toggleIfElse: (input: {
    packId: PackId;
    menuId: MenuId;
    elementId: ElementId;
    appearanceIndex: number;
    clickType: ClickType;
    frames: StepFrame[];
    ifStepIndex: number;
    enabled: boolean;
  }) => void;
  /**
   * Add an empty click handler at clickType on the given appearance. No-op
   * if a handler already exists there.
   */
  addElementClickHandler: (input: {
    packId: PackId;
    menuId: MenuId;
    elementId: ElementId;
    appearanceIndex: number;
    clickType: ClickType;
  }) => void;
  /** Remove the click handler at clickType (with its actions and fallback). */
  removeElementClickHandler: (input: {
    packId: PackId;
    menuId: MenuId;
    elementId: ElementId;
    appearanceIndex: number;
    clickType: ClickType;
  }) => void;
  /**
   * Append a new appearance to an element. Seeds with a placeholder permission
   * condition so the new state is clearly "conditional" and doesn't shadow the
   * default state (which has no `if`).
   */
  addAppearance: (input: { packId: PackId; menuId: MenuId; elementId: ElementId }) => void;
  /** Remove the appearance at the given index. The element must keep at least one. */
  removeAppearance: (input: {
    packId: PackId;
    menuId: MenuId;
    elementId: ElementId;
    appearanceIndex: number;
  }) => void;
  /** Reorder an element's appearances (priority = position in the array). */
  moveAppearance: (input: {
    packId: PackId;
    menuId: MenuId;
    elementId: ElementId;
    fromIndex: number;
    toIndex: number;
  }) => void;
  /**
   * Replace the entire visibility condition list (`if`) for an appearance.
   * Empty list → unconditional (default state).
   */
  setAppearanceConditions: (input: {
    packId: PackId;
    menuId: MenuId;
    elementId: ElementId;
    appearanceIndex: number;
    conditions: Condition[];
  }) => void;
  /** Set the operator for one joiner between if-conditions on an appearance. */
  setAppearanceJoin: (input: {
    packId: PackId;
    menuId: MenuId;
    elementId: ElementId;
    appearanceIndex: number;
    joinIndex: number;
    op: "and" | "or";
  }) => void;
  /** Replace one step inside a command's step tree at the given path. */
  setCommandStep: (input: {
    packId: PackId;
    commandId: CommandId;
    path: StepPath;
    step: Step;
  }) => void;
  /** Insert a step into a command's step tree. */
  addCommandStep: (input: {
    packId: PackId;
    commandId: CommandId;
    frames: StepFrame[];
    index: number;
    step: Step;
  }) => void;
  removeCommandStep: (input: {
    packId: PackId;
    commandId: CommandId;
    path: StepPath;
  }) => void;
  moveCommandStep: (input: {
    packId: PackId;
    commandId: CommandId;
    frames: StepFrame[];
    fromIndex: number;
    toIndex: number;
  }) => void;
  addCommandIfCase: (input: {
    packId: PackId;
    commandId: CommandId;
    frames: StepFrame[];
    ifStepIndex: number;
  }) => void;
  removeCommandIfCase: (input: {
    packId: PackId;
    commandId: CommandId;
    frames: StepFrame[];
    ifStepIndex: number;
    caseIndex: number;
  }) => void;
  setCommandIfCaseConditions: (input: {
    packId: PackId;
    commandId: CommandId;
    frames: StepFrame[];
    ifStepIndex: number;
    caseIndex: number;
    conditions: Condition[];
  }) => void;
  setCommandIfCaseJoin: (input: {
    packId: PackId;
    commandId: CommandId;
    frames: StepFrame[];
    ifStepIndex: number;
    caseIndex: number;
    joinIndex: number;
    op: "and" | "or";
  }) => void;
  toggleCommandIfElse: (input: {
    packId: PackId;
    commandId: CommandId;
    frames: StepFrame[];
    ifStepIndex: number;
    enabled: boolean;
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
 * Tiny helpers shared by the step-tree mutations. They walk the immer
 * draft and return live references so callers can splice in place.
 */
function findElementHandler(
  draft: AccountState,
  packId: PackId,
  menuId: MenuId,
  elementId: ElementId,
  appearanceIndex: number,
  clickType: ClickType,
) {
  const pack = draft.account.packs.find((p) => p.id === packId);
  if (!pack) return null;
  const menu = pack.menus.find((m) => m.id === menuId);
  if (!menu) return null;
  for (const layer of menu.layers) {
    for (const el of layer.elements) {
      if (el.id !== elementId) continue;
      const handler = el.appearances[appearanceIndex]?.click?.[clickType];
      return handler ?? null;
    }
  }
  return null;
}

function findCommand(draft: AccountState, packId: PackId, commandId: CommandId) {
  const pack = draft.account.packs.find((p) => p.id === packId);
  if (!pack) return null;
  return pack.commands.find((c) => c.id === commandId) ?? null;
}

function touch(draft: AccountState, packId: PackId) {
  const pack = draft.account.packs.find((p) => p.id === packId);
  if (pack) pack.updatedAt = new Date().toISOString();
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
                  } else if (field === "material") {
                    if (typeof value !== "string") return;
                    appearance.material = value || undefined;
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
        setElementStep: ({
          packId: pId,
          menuId: mId,
          elementId,
          appearanceIndex,
          clickType,
          path,
          step,
        }) =>
          set(
            produce((draft: AccountState) => {
              const handler = findElementHandler(
                draft,
                pId,
                mId,
                elementId,
                appearanceIndex,
                clickType,
              );
              if (!handler) return;
              const parent = resolveParentMut(handler.steps, path.frames);
              if (!parent || path.index < 0 || path.index >= parent.length) return;
              parent[path.index] = step;
              touch(draft, pId);
            }),
          ),
        addElementStep: ({
          packId: pId,
          menuId: mId,
          elementId,
          appearanceIndex,
          clickType,
          frames,
          index,
          step,
        }) =>
          set(
            produce((draft: AccountState) => {
              const handler = findElementHandler(
                draft,
                pId,
                mId,
                elementId,
                appearanceIndex,
                clickType,
              );
              if (!handler) return;
              const parent = resolveParentMut(handler.steps, frames);
              if (!parent) return;
              const at = index < 0 || index > parent.length ? parent.length : index;
              parent.splice(at, 0, step);
              touch(draft, pId);
            }),
          ),
        removeElementStep: ({
          packId: pId,
          menuId: mId,
          elementId,
          appearanceIndex,
          clickType,
          path,
        }) =>
          set(
            produce((draft: AccountState) => {
              const handler = findElementHandler(
                draft,
                pId,
                mId,
                elementId,
                appearanceIndex,
                clickType,
              );
              if (!handler) return;
              const parent = resolveParentMut(handler.steps, path.frames);
              if (!parent || path.index < 0 || path.index >= parent.length) return;
              parent.splice(path.index, 1);
              touch(draft, pId);
            }),
          ),
        moveElementStep: ({
          packId: pId,
          menuId: mId,
          elementId,
          appearanceIndex,
          clickType,
          frames,
          fromIndex,
          toIndex,
        }) =>
          set(
            produce((draft: AccountState) => {
              const handler = findElementHandler(
                draft,
                pId,
                mId,
                elementId,
                appearanceIndex,
                clickType,
              );
              if (!handler) return;
              const parent = resolveParentMut(handler.steps, frames);
              if (!parent) return;
              if (fromIndex < 0 || fromIndex >= parent.length) return;
              if (toIndex < 0 || toIndex >= parent.length) return;
              const [moved] = parent.splice(fromIndex, 1);
              if (moved) parent.splice(toIndex, 0, moved);
              touch(draft, pId);
            }),
          ),
        addIfCase: ({
          packId: pId,
          menuId: mId,
          elementId,
          appearanceIndex,
          clickType,
          frames,
          ifStepIndex,
        }) =>
          set(
            produce((draft: AccountState) => {
              const handler = findElementHandler(
                draft,
                pId,
                mId,
                elementId,
                appearanceIndex,
                clickType,
              );
              if (!handler) return;
              const parent = resolveParentMut(handler.steps, frames);
              const ifStep = parent?.[ifStepIndex];
              if (!ifStep || ifStep.kind !== "if") return;
              ifStep.cases.push({ conditions: [], steps: [] });
              touch(draft, pId);
            }),
          ),
        removeIfCase: ({
          packId: pId,
          menuId: mId,
          elementId,
          appearanceIndex,
          clickType,
          frames,
          ifStepIndex,
          caseIndex,
        }) =>
          set(
            produce((draft: AccountState) => {
              const handler = findElementHandler(
                draft,
                pId,
                mId,
                elementId,
                appearanceIndex,
                clickType,
              );
              if (!handler) return;
              const parent = resolveParentMut(handler.steps, frames);
              const ifStep = parent?.[ifStepIndex];
              if (!ifStep || ifStep.kind !== "if") return;
              if (caseIndex < 0 || caseIndex >= ifStep.cases.length) return;
              ifStep.cases.splice(caseIndex, 1);
              touch(draft, pId);
            }),
          ),
        setIfCaseConditions: ({
          packId: pId,
          menuId: mId,
          elementId,
          appearanceIndex,
          clickType,
          frames,
          ifStepIndex,
          caseIndex,
          conditions,
        }) =>
          set(
            produce((draft: AccountState) => {
              const handler = findElementHandler(
                draft,
                pId,
                mId,
                elementId,
                appearanceIndex,
                clickType,
              );
              if (!handler) return;
              const parent = resolveParentMut(handler.steps, frames);
              const ifStep = parent?.[ifStepIndex];
              if (!ifStep || ifStep.kind !== "if") return;
              const c = ifStep.cases[caseIndex];
              if (!c) return;
              c.conditions = conditions;
              touch(draft, pId);
            }),
          ),
        setIfCaseJoin: ({
          packId: pId,
          menuId: mId,
          elementId,
          appearanceIndex,
          clickType,
          frames,
          ifStepIndex,
          caseIndex,
          joinIndex,
          op,
        }) =>
          set(
            produce((draft: AccountState) => {
              const handler = findElementHandler(
                draft,
                pId,
                mId,
                elementId,
                appearanceIndex,
                clickType,
              );
              if (!handler) return;
              const parent = resolveParentMut(handler.steps, frames);
              const ifStep = parent?.[ifStepIndex];
              if (!ifStep || ifStep.kind !== "if") return;
              const c = ifStep.cases[caseIndex];
              if (!c) return;
              const max = Math.max(0, c.conditions.length - 1);
              if (joinIndex < 0 || joinIndex >= max) return;
              if (!c.joins) c.joins = Array(max).fill("and");
              while (c.joins.length < max) c.joins.push("and");
              c.joins[joinIndex] = op;
              touch(draft, pId);
            }),
          ),
        toggleIfElse: ({
          packId: pId,
          menuId: mId,
          elementId,
          appearanceIndex,
          clickType,
          frames,
          ifStepIndex,
          enabled,
        }) =>
          set(
            produce((draft: AccountState) => {
              const handler = findElementHandler(
                draft,
                pId,
                mId,
                elementId,
                appearanceIndex,
                clickType,
              );
              if (!handler) return;
              const parent = resolveParentMut(handler.steps, frames);
              const ifStep = parent?.[ifStepIndex];
              if (!ifStep || ifStep.kind !== "if") return;
              if (enabled) {
                if (!ifStep.else) ifStep.else = [];
              } else {
                ifStep.else = undefined;
              }
              touch(draft, pId);
            }),
          ),
        addElementClickHandler: ({
          packId: pId,
          menuId: mId,
          elementId,
          appearanceIndex,
          clickType,
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
                  if (!appearance.click) appearance.click = {};
                  if (!appearance.click[clickType]) {
                    appearance.click[clickType] = { steps: [] };
                    pack.updatedAt = new Date().toISOString();
                  }
                  return;
                }
              }
            }),
          ),
        removeElementClickHandler: ({
          packId: pId,
          menuId: mId,
          elementId,
          appearanceIndex,
          clickType,
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
                  delete appearance.click[clickType];
                  pack.updatedAt = new Date().toISOString();
                  return;
                }
              }
            }),
          ),
        addAppearance: ({ packId: pId, menuId: mId, elementId }) =>
          set(
            produce((draft: AccountState) => {
              const pack = draft.account.packs.find((p) => p.id === pId);
              if (!pack) return;
              const menu = pack.menus.find((m) => m.id === mId);
              if (!menu) return;
              for (const layer of menu.layers) {
                for (const el of layer.elements) {
                  if (el.id !== elementId) continue;
                  // Seed with a placeholder permission condition so the new
                  // state is clearly conditional and doesn't shadow the
                  // default state (which is the one with no `if`).
                  el.appearances.push({ if: [{ type: "has_permission", perm: "" }] });
                  pack.updatedAt = new Date().toISOString();
                  return;
                }
              }
            }),
          ),
        removeAppearance: ({ packId: pId, menuId: mId, elementId, appearanceIndex }) =>
          set(
            produce((draft: AccountState) => {
              const pack = draft.account.packs.find((p) => p.id === pId);
              if (!pack) return;
              const menu = pack.menus.find((m) => m.id === mId);
              if (!menu) return;
              for (const layer of menu.layers) {
                for (const el of layer.elements) {
                  if (el.id !== elementId) continue;
                  if (el.appearances.length <= 1) return; // keep at least one
                  if (appearanceIndex < 0 || appearanceIndex >= el.appearances.length) return;
                  el.appearances.splice(appearanceIndex, 1);
                  pack.updatedAt = new Date().toISOString();
                  return;
                }
              }
            }),
          ),
        moveAppearance: ({ packId: pId, menuId: mId, elementId, fromIndex, toIndex }) =>
          set(
            produce((draft: AccountState) => {
              const pack = draft.account.packs.find((p) => p.id === pId);
              if (!pack) return;
              const menu = pack.menus.find((m) => m.id === mId);
              if (!menu) return;
              for (const layer of menu.layers) {
                for (const el of layer.elements) {
                  if (el.id !== elementId) continue;
                  if (
                    fromIndex < 0 ||
                    fromIndex >= el.appearances.length ||
                    toIndex < 0 ||
                    toIndex >= el.appearances.length
                  )
                    return;
                  const [moved] = el.appearances.splice(fromIndex, 1);
                  if (moved) el.appearances.splice(toIndex, 0, moved);
                  pack.updatedAt = new Date().toISOString();
                  return;
                }
              }
            }),
          ),
        setAppearanceConditions: ({
          packId: pId,
          menuId: mId,
          elementId,
          appearanceIndex,
          conditions,
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
                  appearance.if = conditions.length > 0 ? conditions : undefined;
                  // Trim joins past the new conditions length so the array
                  // doesn't carry stale entries when conditions shrink.
                  const maxJoins = Math.max(0, conditions.length - 1);
                  if (appearance.ifJoins) {
                    if (maxJoins === 0) appearance.ifJoins = undefined;
                    else if (appearance.ifJoins.length > maxJoins)
                      appearance.ifJoins.length = maxJoins;
                  }
                  pack.updatedAt = new Date().toISOString();
                  return;
                }
              }
            }),
          ),
        setAppearanceJoin: ({
          packId: pId,
          menuId: mId,
          elementId,
          appearanceIndex,
          joinIndex,
          op,
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
                  const max = Math.max(0, (appearance.if?.length ?? 0) - 1);
                  if (joinIndex < 0 || joinIndex >= max) return;
                  if (!appearance.ifJoins) appearance.ifJoins = Array(max).fill("and");
                  while (appearance.ifJoins.length < max) appearance.ifJoins.push("and");
                  appearance.ifJoins[joinIndex] = op;
                  pack.updatedAt = new Date().toISOString();
                  return;
                }
              }
            }),
          ),
        setCommandStep: ({ packId: pId, commandId: cId, path, step }) =>
          set(
            produce((draft: AccountState) => {
              const cmd = findCommand(draft, pId, cId);
              if (!cmd) return;
              const parent = resolveParentMut(cmd.steps, path.frames);
              if (!parent || path.index < 0 || path.index >= parent.length) return;
              parent[path.index] = step;
              touch(draft, pId);
            }),
          ),
        addCommandStep: ({ packId: pId, commandId: cId, frames, index, step }) =>
          set(
            produce((draft: AccountState) => {
              const cmd = findCommand(draft, pId, cId);
              if (!cmd) return;
              const parent = resolveParentMut(cmd.steps, frames);
              if (!parent) return;
              const at = index < 0 || index > parent.length ? parent.length : index;
              parent.splice(at, 0, step);
              touch(draft, pId);
            }),
          ),
        removeCommandStep: ({ packId: pId, commandId: cId, path }) =>
          set(
            produce((draft: AccountState) => {
              const cmd = findCommand(draft, pId, cId);
              if (!cmd) return;
              const parent = resolveParentMut(cmd.steps, path.frames);
              if (!parent || path.index < 0 || path.index >= parent.length) return;
              parent.splice(path.index, 1);
              touch(draft, pId);
            }),
          ),
        moveCommandStep: ({ packId: pId, commandId: cId, frames, fromIndex, toIndex }) =>
          set(
            produce((draft: AccountState) => {
              const cmd = findCommand(draft, pId, cId);
              if (!cmd) return;
              const parent = resolveParentMut(cmd.steps, frames);
              if (!parent) return;
              if (fromIndex < 0 || fromIndex >= parent.length) return;
              if (toIndex < 0 || toIndex >= parent.length) return;
              const [moved] = parent.splice(fromIndex, 1);
              if (moved) parent.splice(toIndex, 0, moved);
              touch(draft, pId);
            }),
          ),
        addCommandIfCase: ({ packId: pId, commandId: cId, frames, ifStepIndex }) =>
          set(
            produce((draft: AccountState) => {
              const cmd = findCommand(draft, pId, cId);
              if (!cmd) return;
              const parent = resolveParentMut(cmd.steps, frames);
              const ifStep = parent?.[ifStepIndex];
              if (!ifStep || ifStep.kind !== "if") return;
              ifStep.cases.push({ conditions: [], steps: [] });
              touch(draft, pId);
            }),
          ),
        removeCommandIfCase: ({ packId: pId, commandId: cId, frames, ifStepIndex, caseIndex }) =>
          set(
            produce((draft: AccountState) => {
              const cmd = findCommand(draft, pId, cId);
              if (!cmd) return;
              const parent = resolveParentMut(cmd.steps, frames);
              const ifStep = parent?.[ifStepIndex];
              if (!ifStep || ifStep.kind !== "if") return;
              if (caseIndex < 0 || caseIndex >= ifStep.cases.length) return;
              ifStep.cases.splice(caseIndex, 1);
              touch(draft, pId);
            }),
          ),
        setCommandIfCaseConditions: ({
          packId: pId,
          commandId: cId,
          frames,
          ifStepIndex,
          caseIndex,
          conditions,
        }) =>
          set(
            produce((draft: AccountState) => {
              const cmd = findCommand(draft, pId, cId);
              if (!cmd) return;
              const parent = resolveParentMut(cmd.steps, frames);
              const ifStep = parent?.[ifStepIndex];
              if (!ifStep || ifStep.kind !== "if") return;
              const c = ifStep.cases[caseIndex];
              if (!c) return;
              c.conditions = conditions;
              touch(draft, pId);
            }),
          ),
        setCommandIfCaseJoin: ({
          packId: pId,
          commandId: cId,
          frames,
          ifStepIndex,
          caseIndex,
          joinIndex,
          op,
        }) =>
          set(
            produce((draft: AccountState) => {
              const cmd = findCommand(draft, pId, cId);
              if (!cmd) return;
              const parent = resolveParentMut(cmd.steps, frames);
              const ifStep = parent?.[ifStepIndex];
              if (!ifStep || ifStep.kind !== "if") return;
              const c = ifStep.cases[caseIndex];
              if (!c) return;
              const max = Math.max(0, c.conditions.length - 1);
              if (joinIndex < 0 || joinIndex >= max) return;
              if (!c.joins) c.joins = Array(max).fill("and");
              while (c.joins.length < max) c.joins.push("and");
              c.joins[joinIndex] = op;
              touch(draft, pId);
            }),
          ),
        toggleCommandIfElse: ({ packId: pId, commandId: cId, frames, ifStepIndex, enabled }) =>
          set(
            produce((draft: AccountState) => {
              const cmd = findCommand(draft, pId, cId);
              if (!cmd) return;
              const parent = resolveParentMut(cmd.steps, frames);
              const ifStep = parent?.[ifStepIndex];
              if (!ifStep || ifStep.kind !== "if") return;
              if (enabled) {
                if (!ifStep.else) ifStep.else = [];
              } else {
                ifStep.else = undefined;
              }
              touch(draft, pId);
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
      {
        name: "interfaze:account",
        version: 2,
        migrate: (persisted, version) => {
          if (version >= 2) return persisted;
          return migrateV1ToV2(persisted);
        },
      },
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

// ────────────────────────────────────────────────────────────────────────────
// v1 → v2 migration. v1 had ClickHandler.{requirements?, actions, fallback?}
// and Command.actions; v2 has ClickHandler.steps and Command.steps with the
// recursive Step tree. Wrap the old flat lists; if requirements/fallback are
// present, fold them into a single outer if-step.
//
// We accept `unknown` because zustand's migrate only knows the shape from the
// schema version stored in localStorage — not the current types.
// ────────────────────────────────────────────────────────────────────────────
type V1Action = { type: string; [k: string]: unknown };
type V1ClickHandler = {
  requirements?: unknown[];
  actions: V1Action[];
  fallback?: V1Action[];
};
type V1Command = { actions: V1Action[]; steps?: never; [k: string]: unknown };

const wrapV1Actions = (actions: V1Action[]) =>
  actions.map((action) => ({ kind: "action" as const, action }));

const migrateClickHandler = (h: V1ClickHandler) => {
  const wrappedActions = wrapV1Actions(h.actions ?? []);
  const wrappedFallback = h.fallback ? wrapV1Actions(h.fallback) : undefined;
  const conditions = (h.requirements ?? []) as Condition[];
  if (conditions.length === 0 && !wrappedFallback) {
    return { steps: wrappedActions };
  }
  // Fold gate + chain + fallback into a single outer if-step.
  const ifStep = {
    kind: "if" as const,
    cases: [{ conditions, steps: wrappedActions }],
    else: wrappedFallback,
  };
  return { steps: [ifStep] };
};

const migrateV1ToV2 = (persisted: unknown): unknown => {
  if (!persisted || typeof persisted !== "object") return persisted;
  // biome-ignore lint/suspicious/noExplicitAny: legacy v1 shape — we don't model it in TS
  const account = (persisted as any).account;
  if (!account) return persisted;
  for (const pack of account.packs ?? []) {
    for (const menu of pack.menus ?? []) {
      for (const layer of menu.layers ?? []) {
        for (const el of layer.elements ?? []) {
          for (const appearance of el.appearances ?? []) {
            const clickMap = appearance.click;
            if (!clickMap) continue;
            for (const key of Object.keys(clickMap)) {
              const handler = clickMap[key];
              if (handler && "actions" in handler) {
                clickMap[key] = migrateClickHandler(handler);
              }
            }
          }
        }
      }
    }
    for (const cmd of pack.commands ?? []) {
      const v1 = cmd as V1Command;
      if (Array.isArray(v1.actions)) {
        cmd.steps = wrapV1Actions(v1.actions);
        cmd.actions = undefined;
      }
    }
  }
  return persisted;
};
