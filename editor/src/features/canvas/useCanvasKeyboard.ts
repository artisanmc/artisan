import type { Command, Element, ElementId, Menu, MenuId, PackId } from "@/domain/types";
import { formatPositions, parsePositions } from "@/lib/positions";
import { slotCount } from "./inventoryTypes";
import { useAccountStore } from "@/state/accountStore";
import { useFlowSelectionStore } from "@/state/flowSelectionStore";
import { useSelectionStore } from "@/state/selectionStore";
import { useEffect } from "react";
import {
  CLIPBOARD_VERSION,
  type ElementCopy,
  readClipboard,
  rewriteIds,
  writeClipboard,
} from "./clipboard";

/**
 * Locate an element by id within a pack and return enough context
 * (the owning menu) to call element-scoped actions on it.
 */
const findElement = (packId: PackId, elementId: ElementId): { menuId: MenuId } | null => {
  const account = useAccountStore.getState().account;
  const pack = account.packs.find((p) => p.id === packId);
  if (!pack) return null;
  for (const menu of pack.menus) {
    for (const layer of menu.layers) {
      if (layer.elements.some((el) => el.id === elementId)) {
        return { menuId: menu.id };
      }
    }
  }
  return null;
};

const isEditableTarget = (target: EventTarget | null) => {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable;
};

const findSelectedEntities = (packId: PackId, ids: string[]) => {
  const account = useAccountStore.getState().account;
  const pack = account.packs.find((p) => p.id === packId);
  if (!pack)
    return { menus: [] as Menu[], commands: [] as Command[], elements: [] as ElementCopy[] };
  const idSet = new Set(ids);
  const elements: ElementCopy[] = [];
  for (const menu of pack.menus) {
    for (const layer of menu.layers) {
      for (const el of layer.elements) {
        if (idSet.has(el.id)) elements.push({ sourceMenuId: menu.id, element: el });
      }
    }
  }
  return {
    menus: pack.menus.filter((m) => idSet.has(m.id)),
    commands: pack.commands.filter((c) => idSet.has(c.id)),
    elements,
  };
};

/**
 * Pick the menu we should drop pasted elements into. Priority:
 *   1. A menu that is currently selected
 *   2. The menu that owns the currently selected element
 *   3. The clipboard's source menu (if it still exists in this pack)
 *   4. The first menu in the pack
 */
const resolveTargetMenu = (packId: PackId, elements: ElementCopy[]): MenuId | null => {
  const account = useAccountStore.getState().account;
  const pack = account.packs.find((p) => p.id === packId);
  if (!pack) return null;
  const sel = [...useSelectionStore.getState().ids];
  for (const id of sel) {
    if (pack.menus.some((m) => m.id === id)) return id as MenuId;
  }
  for (const id of sel) {
    for (const m of pack.menus) {
      if (m.layers.some((l) => l.elements.some((el) => el.id === id))) return m.id;
    }
  }
  for (const ec of elements) {
    if (pack.menus.some((m) => m.id === ec.sourceMenuId)) return ec.sourceMenuId;
  }
  return pack.menus[0]?.id ?? null;
};

/**
 * Find the smallest non-negative linear delta `d` such that every position
 * in `original` shifted by `d` is within bounds AND not in `occupied`.
 * Returns null when nothing fits.
 */
const findFreePositions = (
  menu: Menu,
  original: number[],
  occupiedExtra?: ReadonlySet<number>,
): number[] | null => {
  const occupied = new Set<number>(occupiedExtra ?? []);
  for (const layer of menu.layers) {
    for (const el of layer.elements) {
      for (const p of parsePositions(el.positions)) occupied.add(p);
    }
  }
  const max = slotCount(menu.inventoryType ?? "chest", menu.rows);
  for (let delta = 0; delta < max; delta++) {
    const shifted = original.map((p) => p + delta);
    if (shifted.every((p) => p < max && !occupied.has(p))) return shifted;
  }
  return null;
};

const placeElements = (
  packId: PackId,
  menuId: MenuId,
  elements: ElementCopy[],
  options: { skipSourcePositions: boolean },
  onError?: (m: string) => void,
) => {
  const account = useAccountStore.getState().account;
  const pack = account.packs.find((p) => p.id === packId);
  const menu = pack?.menus.find((m) => m.id === menuId);
  if (!menu) {
    onError?.("Target menu not found");
    return;
  }
  // We accumulate `extra` as we place elements so two clipboard items don't
  // land on top of each other.
  const extra = new Set<number>();
  for (const ec of elements) {
    const original = parsePositions(ec.element.positions);
    if (original.length === 0) continue;
    const initialOccupied = options.skipSourcePositions
      ? new Set([...extra, ...original])
      : new Set(extra);
    const fit = findFreePositions(menu, original, initialOccupied);
    if (!fit) {
      onError?.(`No room in menu ${menu.id} for the pasted button`);
      continue;
    }
    for (const p of fit) extra.add(p);
    const placed: Element = { ...ec.element, positions: formatPositions(fit) };
    try {
      useAccountStore.getState().addElement({ packId, menuId, element: placed });
    } catch (e) {
      onError?.(e instanceof Error ? e.message : "paste failed");
    }
  }
};

const copySelection = async (packId: PackId, ids: string[], onError?: (m: string) => void) => {
  if (ids.length === 0) return;
  const { menus, commands, elements } = findSelectedEntities(packId, ids);
  if (menus.length === 0 && commands.length === 0 && elements.length === 0) return;
  try {
    await writeClipboard({
      kind: "artisan.clipboard",
      version: CLIPBOARD_VERSION,
      menus,
      commands,
      elements,
    });
  } catch (e) {
    onError?.(e instanceof Error ? e.message : "copy failed");
  }
};

const pasteFromClipboard = async (packId: PackId, onError?: (m: string) => void) => {
  const payload = await readClipboard();
  if (!payload) {
    onError?.("Clipboard is empty");
    return;
  }
  const rewritten = rewriteIds({
    menus: payload.menus,
    commands: payload.commands,
    elements: payload.elements,
  });
  try {
    if (rewritten.menus.length > 0 || rewritten.commands.length > 0) {
      useAccountStore.getState().pasteEntities({
        packId,
        menus: rewritten.menus,
        commands: rewritten.commands,
        offset: { x: 80, y: 80 },
      });
    }
    if (rewritten.elements.length > 0) {
      const targetMenu = resolveTargetMenu(packId, rewritten.elements);
      if (!targetMenu) {
        onError?.("No target menu — select a menu before pasting");
      } else {
        placeElements(
          packId,
          targetMenu,
          rewritten.elements,
          { skipSourcePositions: false },
          onError,
        );
      }
    }
  } catch (e) {
    onError?.(e instanceof Error ? e.message : "paste failed");
  }
};

const duplicateSelection = (packId: PackId, ids: string[], onError?: (m: string) => void) => {
  if (ids.length === 0) return;
  const { menus, commands, elements } = findSelectedEntities(packId, ids);
  if (menus.length === 0 && commands.length === 0 && elements.length === 0) return;
  const rewritten = rewriteIds({ menus, commands, elements });
  try {
    if (rewritten.menus.length > 0 || rewritten.commands.length > 0) {
      useAccountStore.getState().pasteEntities({
        packId,
        menus: rewritten.menus,
        commands: rewritten.commands,
        offset: { x: 24, y: 24 },
      });
    }
    // Group element duplicates by their source menu so each lands in its own
    // menu. skipSourcePositions=true forces a non-zero shift so the duplicate
    // doesn't land on top of the original.
    const byMenu = new Map<MenuId, ElementCopy[]>();
    for (const ec of rewritten.elements) {
      const list = byMenu.get(ec.sourceMenuId) ?? [];
      list.push(ec);
      byMenu.set(ec.sourceMenuId, list);
    }
    for (const [menuId, list] of byMenu) {
      placeElements(packId, menuId, list, { skipSourcePositions: true }, onError);
    }
  } catch (e) {
    onError?.(e instanceof Error ? e.message : "duplicate failed");
  }
};

interface UseCanvasKeyboardArgs {
  packId: PackId;
  onError?: (message: string) => void;
}

export function useCanvasKeyboard({ packId, onError }: UseCanvasKeyboardArgs): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;

      const cmdOrCtrl = e.ctrlKey || e.metaKey;

      if (cmdOrCtrl && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        useAccountStore.temporal.getState().undo();
        return;
      }
      if (cmdOrCtrl && ((e.key === "z" && e.shiftKey) || e.key === "y")) {
        e.preventDefault();
        useAccountStore.temporal.getState().redo();
        return;
      }
      if (cmdOrCtrl && e.key === "c") {
        // Let the browser handle it when the user has plain text selected.
        if (document.getSelection()?.toString()) return;
        e.preventDefault();
        const ids = [...useSelectionStore.getState().ids];
        void copySelection(packId, ids, onError);
        return;
      }
      if (cmdOrCtrl && e.key === "v") {
        e.preventDefault();
        void pasteFromClipboard(packId, onError);
        return;
      }
      if (cmdOrCtrl && e.key === "d") {
        e.preventDefault();
        const ids = [...useSelectionStore.getState().ids];
        duplicateSelection(packId, ids, onError);
        return;
      }

      if (e.key === "Delete" || e.key === "Backspace") {
        const sel = useSelectionStore.getState();
        const flow = useFlowSelectionStore.getState();
        const ids = [...sel.ids];

        // Flow sub-selection takes priority: if the user is editing a
        // specific state or step, Delete should remove that node rather
        // than the whole entity.
        if (flow.sub) {
          e.preventDefault();
          try {
            if (flow.sub.kind === "step" && ids.length === 1) {
              const id = ids[0]!;
              if (flow.sub.clickType !== undefined && flow.sub.stateIndex !== undefined) {
                const candidate = findElement(packId, id as ElementId);
                if (candidate) {
                  useAccountStore.getState().removeElementStep({
                    packId,
                    menuId: candidate.menuId,
                    elementId: id as ElementId,
                    appearanceIndex: flow.sub.stateIndex,
                    clickType: flow.sub.clickType,
                    path: flow.sub.path,
                  });
                  flow.clear();
                  return;
                }
              }
              // Command step (no clickType / stateIndex on the sub).
              useAccountStore.getState().removeCommandStep({
                packId,
                commandId: id as never,
                path: flow.sub.path,
              });
              flow.clear();
              return;
            }
            if (flow.sub.kind === "state" && ids.length === 1) {
              const candidate = findElement(packId, ids[0]! as ElementId);
              if (candidate && flow.sub.stateIndex > 0) {
                // Default state (index 0) is protected.
                useAccountStore.getState().removeAppearance({
                  packId,
                  menuId: candidate.menuId,
                  elementId: ids[0]! as ElementId,
                  appearanceIndex: flow.sub.stateIndex,
                });
                flow.clear();
                return;
              }
            }
          } catch (err) {
            onError?.(err instanceof Error ? err.message : "delete failed");
            return;
          }
        }

        if (ids.length === 0) return;
        e.preventDefault();
        try {
          // If the lone selection is an element, honour the selection mode:
          //   instance mode (focusedSlot set) → drop only that position
          //   button mode (focusedSlot null)  → delete the whole element
          if (ids.length === 1) {
            const candidate = findElement(packId, ids[0]! as ElementId);
            if (candidate) {
              const elementId = ids[0]! as ElementId;
              if (sel.focusedSlot != null) {
                useAccountStore.getState().clearSlot({
                  packId,
                  menuId: candidate.menuId,
                  position: sel.focusedSlot,
                });
              } else {
                useAccountStore.getState().deleteElement({
                  packId,
                  menuId: candidate.menuId,
                  elementId,
                });
              }
              useSelectionStore.getState().clear();
              return;
            }
          }
          useAccountStore.getState().deleteFromPack({ packId, nodeIds: ids });
          useSelectionStore.getState().clear();
        } catch (err) {
          onError?.(err instanceof Error ? err.message : "delete failed");
        }
      }

      if (e.key === "Escape") {
        // Esc clears the deepest selection first (flow → entity).
        const flow = useFlowSelectionStore.getState();
        if (flow.sub) {
          flow.clear();
          return;
        }
        useSelectionStore.getState().clear();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [packId, onError]);
}

export const canvasClipboardActions = {
  copySelection,
  pasteFromClipboard,
  duplicateSelection,
};
