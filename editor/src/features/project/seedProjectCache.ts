import type { IndexedRead } from "@/features/serverIndex/serverIndexLoader";
import { useServerIndexStore } from "@/features/serverIndex/serverIndexStore";
import { type UserProjectLoadResult, loadUserProject } from "@/lib/api/userProjects";
import { projectUrlId } from "@/lib/projectUrlId";
import { useAuthStore } from "@/state/authStore";
import {
  type CachedProject,
  projectCacheKey,
  useProjectCacheStore,
} from "@/state/projectCacheStore";
import { useProjectRuntimeStore } from "@/state/projectRuntimeStore";
import { useEffect, useState } from "react";
import { PROJECTS_RELOADED_EVENT } from "./onProjectsReloaded";

/**
 * Feeds the server index's reads into the open-cache while a server's workspace is
 * on screen. Returns a counter for `useServerIndexLoader`: bumped on a reload the
 * plugin announces, so the index (and with it the known versions) is read again.
 */
export function useKnownVersionsFromIndex(serverRef: string | undefined): number {
  const ownerId = useAuthStore((s) => s.currentUser?.id ?? null);
  const reads = useServerIndexStore((s) => s.reads);
  const [rereads, setRereads] = useState(0);
  useEffect(() => {
    // Any server's reload: the event names it by its internal id, the URL may carry
    // its slug. Re-reading an unchanged server costs only fingerprints.
    const reread = () => setRereads((n) => n + 1);
    window.addEventListener(PROJECTS_RELOADED_EVENT, reread);
    return () => window.removeEventListener(PROJECTS_RELOADED_EVENT, reread);
  }, []);
  useEffect(() => {
    if (!serverRef || !ownerId || reads.length === 0) return;
    void seedProjectCache(serverRef, ownerId, reads).catch(() => {});
  }, [serverRef, ownerId, reads]);
  return rereads;
}

/**
 * Turns the server index's background reads into **known versions** of the
 * server's Projects, so that opening one never opened before shows at once
 * (`useProjectLoader` revalidates it behind, as for any known version).
 *
 * Nothing new is read from the server's disk: the index already has each tree.
 * Only the hub's identity of a Project never opened is asked for (one cheap
 * request each, all at once). The keys are the ones navigation produces: the
 * Project's URL id and the server as the URL names it.
 *
 * An entry is only written when the index holds a different version: a
 * revalidated entry keeps its identity and gains the newer tree with its hash,
 * which keeps tree and fingerprint consistent for the `if_hash` read. The open
 * Project's entry is left to its loader: a newer hash here would hide from
 * `onProjectsReloaded` that the screen needs a re-read.
 */
export async function seedProjectCache(
  serverRef: string,
  ownerId: string,
  reads: IndexedRead[],
): Promise<void> {
  const cache = useProjectCacheStore.getState();
  const known = Object.values(cache.entries);
  const open = useProjectRuntimeStore.getState().current?.projectId;
  const missing: { key: string; ref: string; read: IndexedRead }[] = [];
  for (const read of reads) {
    const ref = projectUrlId(read.summary);
    const key = projectCacheKey(ref, serverRef, ownerId);
    const entry = cache.get(key);
    if (entry?.hash === read.hash) continue;
    if (open && (entry?.identity as UserProjectLoadResult | undefined)?.project?.id === open)
      continue;
    if (entry) cache.put(key, { ...entry, ...treeOf(read) });
    else missing.push({ key, ref, read });
  }
  if (missing.length === 0) return;
  await Promise.all(
    missing.map(async ({ key, ref, read }) => {
      const identity = await loadUserProject(ref, serverRef).catch(() => null);
      // Opened meanwhile: the loader's entry is fresher than this one.
      if (!identity || identity.project.id === open || useProjectCacheStore.getState().get(key))
        return;
      const serverKeyId = identity.project.serverKeyId ?? identity.serverKeyId ?? null;
      // The declarations are the server's, not the Project's: any known version on
      // the same server carries them.
      const sibling = known.find((e) => e.serverKeyId === serverKeyId && e.declaredModels);
      useProjectCacheStore.getState().put(key, {
        identity,
        diskId: identity.project.externalId ?? identity.project.id,
        serverKeyId,
        declaredModels: sibling?.declaredModels,
        declaredActions: sibling?.declaredActions,
        ...treeOf(read),
      });
    }),
  );
}

function treeOf(
  read: IndexedRead,
): Pick<CachedProject, "tree" | "binaries" | "failed" | "hash" | "fetchedAt"> {
  return {
    tree: read.files,
    binaries: read.binaries,
    failed: read.failed,
    hash: read.hash,
    fetchedAt: new Date().toISOString(),
  };
}
