import { type ServerDocumentKind, fetchServerDocumentKinds } from "@/lib/api/documentKinds";
import { create } from "zustand";

interface KindsSource {
  serverId: string;
}

function sourceKey(source: KindsSource): string {
  return `u:${source.serverId}`;
}

interface ServerDocumentKindsState {
  kinds: ServerDocumentKind[];
  status: "idle" | "loading" | "ready";
  loadedKey: string | null;
  load: (source: KindsSource) => Promise<void>;
}

/**
 * Document kinds registered on the active server (ADR `extensible-document-kinds`, W6).
 * The editor's own kind registry says what it can edit; this store says what the server
 * will read back. A kind here and not there is flagged before it is written
 * (`isKindSyncedOn`).
 */
export const useServerDocumentKindsStore = create<ServerDocumentKindsState>((set, get) => ({
  kinds: [],
  status: "idle",
  loadedKey: null,
  async load(source: KindsSource) {
    const key = sourceKey(source);
    const { loadedKey, status } = get();
    if (loadedKey === key && status !== "idle") return;
    set({ status: "loading", loadedKey: key });
    try {
      const kinds = await fetchServerDocumentKinds(source.serverId);
      if (get().loadedKey !== key) return;
      set({ kinds, status: "ready", loadedKey: key });
    } catch {
      if (get().loadedKey !== key) return;
      set({ status: "idle", loadedKey: null });
    }
  },
}));

/**
 * Whether the active server reads Documents of `kind`. Unknown (store not ready, or a
 * server whose plugin predates `document_kinds`) counts as synchronised: the warning is
 * for a server that answered and left the kind out, never for a missing answer.
 */
export function isKindSyncedOn(state: ServerDocumentKindsState, kind: string): boolean {
  if (state.status !== "ready" || state.kinds.length === 0) return true;
  return state.kinds.some((k) => k.kind === kind);
}
