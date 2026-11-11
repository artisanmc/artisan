import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * **The last known version** of a module Config screen (Catalogue,
 * Settings…), to show it without waiting for the server.
 *
 * Same reason as for Projects: the content lives on the server's disk, each
 * open needed three round trips (declared models, table, sibling model) and
 * the screen stayed empty meanwhile — for content almost always identical to
 * the previous visit.
 *
 * And the same rule, non-negotiable here too: **what comes from the cache is
 * announced, and is NOT EDITABLE.** A Config screen edits the server's files
 * live (ADR `module-config-screens`), and saving compares what it expects on
 * disk. Writing from a dated copy would send a compare-and-swap on a wrong
 * base: at best a conflict, at worst an overwrite. Show, wait for
 * revalidation, then open.
 */
export interface CachedScreen {
  /** The table's files, as the server returned them. */
  files: { path: string; content: string }[];
  /** The server's declared models at the same moment — without them, the form would open untyped. */
  models: unknown[];
  fetchedAt: string;
}

export function screenCacheKey(serverId: string, screenId: string): string {
  return `${serverId}/${screenId}`;
}

interface ScreenCacheState {
  entries: Record<string, CachedScreen>;
  put: (key: string, entry: CachedScreen) => void;
  get: (key: string) => CachedScreen | undefined;
  forget: (key: string) => void;
}

export const useScreenCacheStore = create<ScreenCacheState>()(
  persist(
    (set, get) => ({
      entries: {},
      put: (key, entry) => set((s) => ({ entries: { ...s.entries, [key]: entry } })),
      get: (key) => get().entries[key],
      forget: (key) =>
        set((s) => {
          const { [key]: _dropped, ...rest } = s.entries;
          return { entries: rest };
        }),
    }),
    { name: "artisan.screen-cache" },
  ),
);
