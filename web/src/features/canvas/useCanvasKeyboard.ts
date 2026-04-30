import type { Command, Menu, PackId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useSelectionStore } from "@/state/selectionStore";
import { useEffect } from "react";
import { readClipboard, rewriteIds, writeClipboard } from "./clipboard";

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
        const ids = [...useSelectionStore.getState().ids];
        if (ids.length === 0) return;
        e.preventDefault();
        try {
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
