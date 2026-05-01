import type { Command, ElementId, Menu, MenuId, PackId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useSelectionStore } from "@/state/selectionStore";
import { useEffect } from "react";
import { readClipboard, rewriteIds, writeClipboard } from "./clipboard";

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
  if (!pack) return { menus: [] as Menu[], commands: [] as Command[] };
  const idSet = new Set(ids);
  return {
    menus: pack.menus.filter((m) => idSet.has(m.id)),
    commands: pack.commands.filter((c) => idSet.has(c.id)),
  };
};

const copySelection = async (packId: PackId, ids: string[], onError?: (m: string) => void) => {
  if (ids.length === 0) return;
  const { menus, commands } = findSelectedEntities(packId, ids);
  if (menus.length === 0 && commands.length === 0) return;
  try {
    await writeClipboard({ kind: "interfaze.clipboard", version: 1, menus, commands });
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
  const rewritten = rewriteIds({ menus: payload.menus, commands: payload.commands });
  try {
    useAccountStore.getState().pasteEntities({
      packId,
      menus: rewritten.menus,
      commands: rewritten.commands,
      offset: { x: 80, y: 80 },
    });
  } catch (e) {
    onError?.(e instanceof Error ? e.message : "paste failed");
  }
};

const duplicateSelection = (packId: PackId, ids: string[], onError?: (m: string) => void) => {
  if (ids.length === 0) return;
  const { menus, commands } = findSelectedEntities(packId, ids);
  if (menus.length === 0 && commands.length === 0) return;
  const rewritten = rewriteIds({ menus, commands });
  try {
    useAccountStore.getState().pasteEntities({
      packId,
      menus: rewritten.menus,
      commands: rewritten.commands,
      offset: { x: 24, y: 24 },
    });
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
        const ids = [...sel.ids];
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
