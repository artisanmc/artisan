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
  loadSnapshot: (a: { networkId: string; serverId: string; ref: string }) => Promise<void>;
  /** Drop every cached snapshot (and the dedupe) — call after a deploy so the
   *  next render refetches fresh server rows. */
  clear: () => void;
}

// Module-level dedupe: load each (network/server/ref) at most once per session
// (success caches permanently; an error is evicted so a later render can retry).
const inflight = new Set<string>();

export const useServerSnapshotsStore = create<ServerSnapshotsState>((set) => ({
  rowsByRef: {},
  setSnapshot(ref, rows) {
    set((s) => ({ rowsByRef: { ...s.rowsByRef, [ref]: rows } }));
  },
  clear() {
    inflight.clear();
    set({ rowsByRef: {} });
  },
  async loadSnapshot({ networkId, serverId, ref }) {
    if (ref.startsWith("pack:")) return; // project-owned; not a live server source
    const key = `${networkId}/${serverId}/${ref}`;
    if (inflight.has(key)) return;
    inflight.add(key);
    const res = await previewDataSource(networkId, serverId, { ref });
    if (res.ok) {
      set((s) => ({ rowsByRef: { ...s.rowsByRef, [ref]: res.rows } }));
    } else {
      inflight.delete(key); // allow retry after a transient failure (offline, timeout)
    }
  },
}));
