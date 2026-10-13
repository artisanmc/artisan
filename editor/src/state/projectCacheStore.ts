import type { FailedDocument } from "@/lib/api/projectFiles";
import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * **The last known version** of a Project: the tree the server returned last
 * time, with what is needed to rebuild it without network.
 *
 * Why it exists: the content lives on the server's disk (ADR
 * `server-disk-only-storage`), so opening it takes a round trip to the
 * plugin — several seconds, for content almost always identical to the
 * previous visit. What we had is shown right away, and revalidated behind.
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
  /** L'arbre rel-keyed, tel que le serveur l'a rendu. */
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
 * resolution — resolving would need the network we are trying to avoid.
 */
export function projectCacheKey(projectId: string, serverRef?: string | null, networkRef?: string | null, ownerId?: string | null): string {
  return JSON.stringify([ownerId, networkRef, serverRef, projectId]);
}

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
      // The refresh token is a gesture, not a state: persisting it would trigger a
      // re-read on the next start for a stale reason.
      partialize: (s) => ({ entries: s.entries }),
    },
  ),
);
