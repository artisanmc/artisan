import { create } from "zustand";
import { previewDataSource } from "@/lib/api/dataSources";

/**
 * Last-known snapshots of live server data sources, keyed by ref. Fetched via the
 * data-source preview path (`fetcher(null)`) and cached in-session so the canvas
 * can render real rows (both pagination and placement modes) and the placement
 * palette can enumerate rows. The live source wins; this is the editor's cache.
 */
interface ServerSnapshotsState {
  rowsByRef: Record<string, Record<string, unknown>[]>;
  setSnapshot: (ref: string, rows: Record<string, unknown>[]) => void;
  loadSnapshot: (a: {
    serverId: string;
    ref: string;
    /** Passed through to the fetcher — notably `player` for per-player sources. */
    params?: Record<string, string>;
  }) => Promise<void>;
  /** Drop every cached snapshot (and the dedupe) — call after a deploy so the
   *  next render refetches fresh server rows. */
  clear: () => void;
}

// Requests currently in flight, so a burst of renders sends one fetch.
const inflight = new Set<string>();

/**
 * Which params the cached rows of a ref were fetched with.
 *
 * `rowsByRef` is keyed by ref alone (every consumer reads `snapshots[ref]`), but a
 * fetch is identified by ref **and** params — preview the same source as two
 * players and the second result overwrites the first. Without this signature the
 * dedupe would then refuse to refetch the first, leaving the wrong player's rows
 * on screen for good.
 */
const signatureByRef = new Map<string, string>();

export const useServerSnapshotsStore = create<ServerSnapshotsState>((set) => ({
  rowsByRef: {},
  setSnapshot(ref, rows) {
    set((s) => ({ rowsByRef: { ...s.rowsByRef, [ref]: rows } }));
  },
  clear() {
    inflight.clear();
    signatureByRef.clear();
    set({ rowsByRef: {} });
  },
  async loadSnapshot({ serverId, ref, params }) {
    if (ref.startsWith("pack:")) return; // project-owned; not a live server source
    // Params are part of the identity: the same ref previewed as two players is
    // two different result sets.
    const signature = JSON.stringify(params ?? {});
    const key = `${serverId}/${ref}/${signature}`;
    if (inflight.has(key)) return;
    // Cached rows already answer these exact params — nothing to do.
    if (signatureByRef.get(ref) === signature) return;
    inflight.add(key);
    const res = await previewDataSource(serverId, { ref, ...(params ? { params } : {}) });
    inflight.delete(key); // always: a transient failure must not block a retry
    if (res.ok) {
      signatureByRef.set(ref, signature);
      set((s) => ({ rowsByRef: { ...s.rowsByRef, [ref]: res.rows } }));
    }
  },
}));
