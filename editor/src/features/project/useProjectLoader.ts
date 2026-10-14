import { injectDeclaredModels, normalizeDataSources } from "@/domain/dataModels";
import type { Project, ProjectId } from "@/domain/types";
import { hasDraftChanges } from "@/features/project/draft";
import { fetchServerDeclaredModels } from "@/lib/api/dataSources";
import type { FailedDocument } from "@/lib/api/projectFiles";
import { loadUserProject } from "@/lib/api/userProjects";
import { projectClient } from "@/lib/projectClient";
import { useProjectPrincipalId } from "@/lib/projectPrincipal";
import { projectFromFiles } from "@/schema/projectFromFiles";
import { useAccountStore } from "@/state/accountStore";
import { useProjectBaselineStore } from "@/state/projectBaselineStore";
import { projectCacheKey, useProjectCacheStore } from "@/state/projectCacheStore";
import { useProjectDraftStore } from "@/state/projectDraftStore";
import { projectRuntime, useProjectRuntimeStore } from "@/state/projectRuntimeStore";
import { useServersStore } from "@/state/serversStore";
import { listModules } from "@artisan/editor-sdk";
import { useEffect, useRef, useState } from "react";
import { flushDraftEdits } from "./draftFlush";
import { loadPersistedDrafts } from "./persistedDrafts";

export interface ProjectLoadResult {
  project: Project | null;
  urlId: string | null;
  error: string | null;
  /** The owning server is unreachable — the Project cannot be opened. */
  offline: boolean;
  /**
   * Documents present on the server that it did **not** manage to load. They
   * can be edited normally (their text is there) but do not run.
   */
  failed: FailedDocument[];
  /** The displayed state comes from a local draft, not from the server. */
  fromDraft: boolean;
  /**
   * The screen shows the **last known version** (cache) while the server read
   * is in flight. Dated, so announced: the server's disk stays the truth, and
   * the display must not claim to be it.
   */
  stale: boolean;
  /**
   * Server off, Project opened from the hub's copy: the date of that Snapshot
   * (ADR `snapshot-mirror-and-backend-history`, decision 7).
   */
  offlineSince: string | null;
  /** Never published (Server not linked): the content lives entirely in the draft. */
  unpublished: boolean;
}

/** Select working edits only after the project has passed its opening check. */
function treeToShow(
  projectId: string,
  fallback: Record<string, string>,
): { tree: Record<string, string>; fromDraft: boolean } {
  const draft = useProjectDraftStore.getState().get(projectId);
  const resumable = draft && (draft.remote || hasDraftChanges(draft));
  return resumable ? { tree: draft.tree, fromDraft: true } : { tree: fallback, fromDraft: false };
}

/** The last declared models reported by the server — stored with the known
 *  version so the next visit has nothing to wait for. */
let lastDeclaredModels: unknown[] | undefined;

/** Parse the current working tree after resolving contextual models. */
async function buildProject(
  res: Awaited<ReturnType<typeof loadUserProject>>,
  diskId: string,
  tree: Record<string, string>,
  declaredModels?: unknown[],
): Promise<Project> {
  const serverId = res.project.serverKeyId ?? res.serverKeyId;
  let models = declaredModels;
  if (!models && serverId && projectRuntime(res).capabilities.liveData) {
    models = await fetchServerDeclaredModels(serverId).catch(() => []);
    lastDeclaredModels = models;
  }
  flushDraftEdits();
  const currentTree = treeToShow(res.project.id, tree).tree;
  const canonical: Record<string, string> = {};
  for (const [rel, content] of Object.entries(currentTree)) {
    canonical[`plugins/Artisan/projects/${diskId}/${rel}`] = content;
  }
  const loaded: Project = projectFromFiles(res.project.id as ProjectId, canonical, {
    name: res.project.name,
    diskId: res.project.externalId ?? undefined,
    serverKeyId: res.project.serverKeyId ?? res.serverKeyId ?? undefined,
  });
  if (models) injectDeclaredModels(loaded, models as never);
  // Accepted reset (ADR project-sources-and-data-models).
  normalizeDataSources(loaded);
  for (const module of listModules()) module.migrateProject?.(loaded);

  return loaded;
}

/** Install a project only from the currently authorized, uncancelled load. */
function mirrorIntoAccount(loaded: Project): void {
  // PRESERVING the existing order — overwriting it moved the visited project to
  // the top of the sidebar.
  const current = useAccountStore.getState().account;
  const idx = current.projects.findIndex((p) => p.id === loaded.id);
  const loadedId = loaded.id as ProjectId;
  useAccountStore.getState().setAccount({
    id: current.id,
    projects:
      idx === -1
        ? [...current.projects, loaded]
        : current.projects.map((p, i) => (i === idx ? loaded : p)),
    projectOrder: current.projectOrder.includes(loadedId)
      ? current.projectOrder
      : [...current.projectOrder, loadedId],
  });
}

export function useProjectLoader(projectId: string, serverRef?: string | null): ProjectLoadResult {
  const ownerId = useProjectPrincipalId(projectId);
  const reloadToken = useProjectCacheStore((s) => s.reloadToken);
  const opened = useRef<string | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [resolvedUrl, setResolvedUrl] = useState<{ scope: string; id: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [failed, setFailed] = useState<FailedDocument[]>([]);
  const [fromDraft, setFromDraft] = useState(false);
  const [stale, setStale] = useState(false);
  const [offlineSince, setOfflineSince] = useState<string | null>(null);
  const [unpublished, setUnpublished] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadToken restarts the read on Refresh.
  useEffect(() => {
    const scope = JSON.stringify([ownerId, serverRef, projectId]);
    useProjectRuntimeStore.getState().set(null);
    useServersStore.getState().setActiveServerId(null);
    if (opened.current !== scope) setProject(null);
    setError(null);
    setOffline(false);
    setFailed([]);
    setFromDraft(false);
    setStale(false);
    if (!ownerId) {
      setError("Not authenticated");
      return;
    }
    useProjectDraftStore.getState().setOwner(ownerId);
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const cacheKey = projectCacheKey(projectId, serverRef, ownerId);
    const cached = useProjectCacheStore.getState().get(cacheKey);

    const refresh = () => {
      flushDraftEdits();
      let retry = false;
      let validated = false;
      // Server off but the hub has a copy: open, dated, and re-checked.
      const settle = (since: string | undefined, neverPublished = false) => {
        setUnpublished(neverPublished);
        if (since) {
          setOffline(true);
          setStale(true);
          setOfflineSince(since);
          retry = true;
          return;
        }
        setOfflineSince(null);
        setStale(false);
        validated = true;
      };
      return loadUserProject(projectId, serverRef)
        .then(async (res) => {
          if (cancelled) return;
          // The content comes from the server's DISK, never from the hub (ADR
          // `server-disk-only-storage`): the response above only provides the
          // identity (name, slug, owning server, network).
          const diskId = res.project.externalId ?? res.project.id;
          setResolvedUrl({ scope, id: diskId });
          const ownerServerId = res.project.serverKeyId ?? res.serverKeyId;
          const runtime = projectRuntime(res);
          useProjectRuntimeStore.getState().set(runtime);
          useServersStore.getState().setActiveServerId(runtime.serverId);
          // Announce the fingerprint we hold: if the server has the same one, it
          // sends nothing and our copy has just been revalidated.
          const disk = await projectClient(res.project.id).read(cached?.hash);
          if (cancelled) return;
          if (!disk.ok) {
            const unreachable =
              disk.error === "server_offline" ||
              disk.error === "network_error" ||
              disk.error === "fetch_timeout";
            retry = unreachable;
            if (unreachable && opened.current === scope) {
              setOffline(true);
              setStale(true);
              return;
            }
            setProject(null);
            setOffline(unreachable);
            setError(disk.error);
            return;
          }
          await loadPersistedDrafts(res.project.id, ownerId);
          if (cancelled) return;
          const binaries = disk.unchanged ? (cached?.binaries ?? []) : (disk.binaries ?? []);
          useProjectBaselineStore
            .getState()
            .setBinaries(
              res.project.id,
              Object.fromEntries(binaries.map(({ path, hash, size }) => [path, { hash, size }])),
            );
          if (disk.unchanged) {
            // Revalidated: what is shown IS what the server holds. Nothing to rebuild,
            // nothing to carry again — only the flag drops.
            if (cached) {
              const draft = useProjectDraftStore.getState().get(res.project.id);
              useProjectBaselineStore
                .getState()
                .set(
                  res.project.id,
                  draft && (draft.remote || hasDraftChanges(draft)) ? draft.baseline : cached.tree,
                );
              useProjectCacheStore.getState().put(cacheKey, {
                ...cached,
                hash: disk.hash ?? cached.hash,
                fetchedAt: new Date().toISOString(),
              });
              const shown = treeToShow(res.project.id, cached.tree);
              const built = await buildProject(res, diskId, shown.tree);
              if (cancelled) return;
              setFromDraft(shown.fromDraft);
              mirrorIntoAccount(built);
              opened.current = scope;
              setProject(built);
              setFailed(cached.failed ?? []);
              settle(disk.offlineSince, disk.unpublished);
              return;
            }
            // No cache but an "unchanged": we do not know what it refers to. Ask again
            // without a fingerprint rather than showing nothing.
            const full = await projectClient(res.project.id).read();
            if (cancelled) return;
            if (!full.ok || full.unchanged) {
              setError("read_error");
              return;
            }
            useProjectBaselineStore
              .getState()
              .setBinaries(
                res.project.id,
                Object.fromEntries(
                  (full.binaries ?? []).map(({ path, hash, size }) => [path, { hash, size }]),
                ),
              );
            useProjectCacheStore.getState().put(cacheKey, {
              identity: res,
              diskId,
              serverKeyId: ownerServerId ?? null,
              tree: full.files,
              binaries: full.binaries,
              failed: full.failed,
              hash: full.hash ?? null,
              declaredModels: lastDeclaredModels,
              fetchedAt: new Date().toISOString(),
            });
            const shown = treeToShow(res.project.id, full.files);
            const recovered = useProjectDraftStore.getState().get(res.project.id);
            useProjectBaselineStore
              .getState()
              .set(res.project.id, shown.fromDraft && recovered ? recovered.baseline : full.files);
            const built = await buildProject(res, diskId, shown.tree);
            if (cancelled) return;
            mirrorIntoAccount(built);
            opened.current = scope;
            setProject(built);
            setFromDraft(shown.fromDraft);
            setFailed(full.failed);
            settle(full.offlineSince, full.unpublished);
            return;
          }
          setFailed(disk.failed);
          // A draft with unsaved work is RESUMED: reopening brings your work back, as
          // in any editor. What keeps you from confusing it with the server's state is
          // no longer a banner but the topbar state: Save is only enabled when there is
          // something to save, and Cancel goes back to it in one click.
          const draft = useProjectDraftStore.getState().get(res.project.id);
          const resumable = draft && (draft.remote || hasDraftChanges(draft)) ? draft : null;
          if (draft && !resumable) useProjectDraftStore.getState().clear(res.project.id);

          // The compare-and-swap base: what the disk held on open.
          useProjectBaselineStore.getState().set(res.project.id, resumable?.baseline ?? disk.files);

          // The base stays the SERVER's: it is what the compare-and-swap must present,
          // otherwise changes made since would be overwritten unknowingly. Only the
          // displayed tree comes from the draft.
          useProjectCacheStore.getState().put(cacheKey, {
            identity: res,
            diskId,
            serverKeyId: ownerServerId ?? null,
            tree: disk.files,
            binaries: disk.binaries,
            failed: disk.failed,
            hash: disk.hash ?? null,
            declaredModels: lastDeclaredModels,
            fetchedAt: new Date().toISOString(),
          });
          const built = await buildProject(res, diskId, resumable?.tree ?? disk.files);
          if (cancelled) return;
          mirrorIntoAccount(built);
          opened.current = scope;
          setProject(built);
          setFromDraft(resumable !== null);
          settle(disk.offlineSince, disk.unpublished);
        })
        .catch((e) => {
          if (cancelled) return;
          retry =
            e instanceof TypeError ||
            (e instanceof Error &&
              ["network_error", "fetch_timeout", "server_offline"].includes(e.message));
          if (retry) {
            setOffline(true);
            setStale(opened.current === scope);
            if (opened.current === scope) return;
          }
          setError((e as Error).message);
        })
        .finally(() => {
          if (cancelled) return;
          if (validated) {
            setOffline(false);
            setError(null);
          }
          if (retry) retryTimer = setTimeout(refresh, 15_000);
        });
    };
    void refresh();
    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
    };
  }, [projectId, serverRef, ownerId, reloadToken]);

  const currentScope = JSON.stringify([ownerId, serverRef, projectId]);
  return {
    project: opened.current === currentScope ? project : null,
    urlId: resolvedUrl?.scope === currentScope ? resolvedUrl.id : null,
    error,
    offline,
    failed,
    fromDraft,
    stale,
    offlineSince,
    unpublished,
  };
}
