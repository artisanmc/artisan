import { getMe, patchMe } from "@/lib/api/auth";
import { useAuthStore } from "@/state/authStore";
import { useSyncExternalStore } from "react";
import { type EditorTourIdentity, createEditorTourController } from "./editorTourController";
import { createEditorTourStorage } from "./editorTourStorage";

const storage = createEditorTourStorage(
  () => localStorage,
  () => sessionStorage,
);
export const editorTourController = createEditorTourController({
  readGuest: storage.readGuest,
  writeGuest: storage.writeGuest,
  readTransfer: storage.readTransfer,
  clearTransfer: storage.clearTransfer,
  readAccount: (accountId) => {
    if (useAuthStore.getState().currentUser?.id !== accountId) return Promise.resolve(null);
    return getMe();
  },
  writeAccount: (accountId, action) => {
    if (useAuthStore.getState().currentUser?.id !== accountId)
      return Promise.resolve({ error: "session_changed" });
    return patchMe({ editor_tour: action });
  },
});

function currentAuthReturn(): string | null {
  if (window.location.pathname === "/login")
    return new URLSearchParams(window.location.search).get("next");
  return window.location.pathname;
}

let accountId = useAuthStore.getState().currentUser?.id ?? null;
if (accountId) storage.bindTransfer(accountId, currentAuthReturn());
useAuthStore.subscribe((state) => {
  const nextId = state.currentUser?.id ?? null;
  if (nextId !== accountId) {
    accountId = nextId;
    if (nextId) storage.bindTransfer(nextId, currentAuthReturn());
    editorTourController.deactivate();
  }
});

export function useEditorTourState() {
  return useSyncExternalStore(editorTourController.subscribe, editorTourController.getSnapshot);
}

export function mountEditorTour(identity: EditorTourIdentity): () => void {
  let mounted = true;
  let activated = false;
  queueMicrotask(() => {
    if (!mounted) return;
    activated = true;
    void editorTourController.activate(identity);
  });
  return () => {
    mounted = false;
    if (activated) editorTourController.deactivate();
  };
}
