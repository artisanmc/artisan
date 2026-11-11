import type { DeclaredAction } from "@/lib/api/declaredActions";
import type { FailedDocument } from "@/lib/api/projectFiles";
import { create } from "zustand";
import { type StateStorage, createJSONStorage, persist } from "zustand/middleware";

/**
 * **The last known version** of a Project: the tree the server returned last
 * time, with what is needed to rebuild it without network.
 *
 * Why it exists: the content lives on the server's disk (ADR
 * `server-disk-only-storage`), so opening it takes round trips through the
 * tunnel — about a second, for content almost always identical to the
 * previous visit. What we had is shown right away (`useProjectLoader`), and
 * revalidated behind; the server index fills it for the server's other
 * Projects, so a Project never opened opens just as fast.
 *
 * What this cache is NOT, and must never become:
 *
 * - **a truth** — the server's disk is. What comes from here is shown marked
 *   (`stale`), never passed off as fresh. Same rule as drafts, for the same
 *   reason: a dated state presented as current makes the admin work on what
 *   they do not see.
 * - **a draft** — a draft holds MY unsaved changes (`projectDraftStore`); this
 *   cache holds what THE SERVER had. Both coexist: there can be a cache
 *   without a draft (Project only viewed), and the draft keeps its own
 *   compare-and-swap base.
 *
 * It never serves as the compare-and-swap base: that stays what the server
 * returned on open (`projectBaselineStore`). Saving from a stale cache would
 * overwrite what changed meanwhile.
 */
export interface CachedProject {
  /** The identity returned by the hub — enough to rebuild the Project offline. */
  identity: unknown;
  /** The folder id on the server's disk. */
  diskId: string;
  /**
   * The owning server, by its INTERNAL id.
   *
   * The entry key carries what the URL shows (a slug, sometimes an id): it
   * cannot be used to recognise a Project announced by the plugin, which only
   * knows ids. Hence this field.
   */
  serverKeyId?: string | null;
  /** The rel-keyed tree, as the server returned it. */
  tree: Record<string, string>;
  binaries?: { path: string; hash: string; size: number }[];
  /**
   * The models declared by the server's modules, as they were.
   *
   * They come from the server, not from the files — but storing them here is
   * what allows showing the known version WITHOUT any round trip. The next
   * visit refreshes them; meanwhile, yesterday's model beats a waiting screen.
   */
  declaredModels?: unknown[];
  /** The actions declared by the server's modules, kept for the same reason as the models. */
  declaredActions?: DeclaredAction[];
  /** Documents the server could not load, shown again as is. */
  failed?: FailedDocument[];
  /**
   * The fingerprint the server returned with this tree. It is given back on the
   * next visit (`if_hash`): if the server holds the same one, it sends nothing.
   * Computed by the plugin only — we just keep it.
   */
  hash?: string | null;
  /** When — a cache without a date cannot announce itself as dated. */
  fetchedAt: string;
}

/**
 * An entry's key. The URL may carry a slug OR an id, and the same name may
 * exist on two servers: the key therefore carries both, as they come, without
 * resolution.
 */
export function projectCacheKey(
  projectId: string,
  serverRef?: string | null,
  ownerId?: string | null,
): string {
  return JSON.stringify([ownerId, serverRef, projectId]);
}

/**
 * `localStorage` holds a few megabytes per origin; a whole server's Projects can go
 * over. A full storage must never fail an open (`put` would throw from inside the
 * load): the oldest versions are left out of what is persisted until the rest fits,
 * and stay in memory for this session.
 */
const boundedStorage: StateStorage = {
  getItem: (name) => localStorage.getItem(name),
  removeItem: (name) => localStorage.removeItem(name),
  setItem: (name, value) => {
    try {
      localStorage.setItem(name, value);
      return;
    } catch {
      // Quota: trimmed below.
    }
    const stored = JSON.parse(value) as { state: { entries: Record<string, CachedProject> } };
    const byAge = Object.entries(stored.state.entries).sort(([, a], [, b]) =>
      a.fetchedAt.localeCompare(b.fetchedAt),
    );
    while (byAge.length > 0) {
      byAge.splice(0, Math.max(1, Math.floor(byAge.length / 4)));
      stored.state.entries = Object.fromEntries(byAge);
      try {
        localStorage.setItem(name, JSON.stringify(stored));
        return;
      } catch {
        // Still too big: drop more.
      }
    }
    localStorage.removeItem(name);
  },
};

interface ProjectCacheState {
  entries: Record<string, CachedProject>;
  /**
   * Bumped by the "Refresh" gesture. The loader depends on it, so re-reading it
   * triggers a real disk read — the only way for the admin to explicitly ask
   * for the server's version (hand edits on the disk are only picked up on the
   * plugin's reload).
   */
  reloadToken: number;
  requestReload: () => void;
  put: (key: string, entry: CachedProject) => void;
  get: (key: string) => CachedProject | undefined;
  forget: (key: string) => void;
}

export const useProjectCacheStore = create<ProjectCacheState>()(
  persist(
    (set, get) => ({
      entries: {},
      reloadToken: 0,
      requestReload: () => set((s) => ({ reloadToken: s.reloadToken + 1 })),
      put: (key, entry) => set((s) => ({ entries: { ...s.entries, [key]: entry } })),
      get: (key) => get().entries[key],
      forget: (key) =>
        set((s) => {
          const { [key]: _dropped, ...rest } = s.entries;
          return { entries: rest };
        }),
    }),
    {
      name: "artisan.project-cache",
      storage: createJSONStorage(() => boundedStorage),
      // The refresh token is a gesture, not a state: persisting it would trigger a
      // re-read on the next start for a stale reason.
      partialize: (s) => ({ entries: s.entries }),
    },
  ),
);
