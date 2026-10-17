import { injectDeclaredModels, normalizeDataSources } from "@/domain/dataModels";
import { adoptProjectActionTexts } from "@/domain/i18nSites";
import type { Project, ProjectId } from "@/domain/types";
import { hasDraftChanges } from "@/features/project/draft";
import { coreActionOf } from "@/lib/actions/coreActions";
import { fetchServerDeclaredModels } from "@/lib/api/dataSources";
import { fetchServerDeclaredActions } from "@/lib/api/declaredActions";
import type { FailedDocument } from "@/lib/api/projectFiles";
import { loadUserProject } from "@/lib/api/userProjects";
import { projectClient } from "@/lib/projectClient";
import { useProjectPrincipalId } from "@/lib/projectPrincipal";
import { adoptLateDocuments, projectFromFiles } from "@/schema/projectFromFiles";
import { useProjectBaselineStore } from "@/state/projectBaselineStore";
import { projectCacheKey, useProjectCacheStore } from "@/state/projectCacheStore";
import { useProjectDraftStore } from "@/state/projectDraftStore";
import { projectRuntime, useProjectRuntimeStore } from "@/state/projectRuntimeStore";
import { useProjectsStore } from "@/state/projectsStore";
import { useServersStore } from "@/state/serversStore";
import { listModules } from "@artisan/editor-sdk";
import { useEffect, useReducer, useRef } from "react";
import { flushDraftEdits } from "./draftFlush";
import { loadPersistedDrafts } from "./persistedDrafts";
import {
  type ProjectLoadEvent,
  initialProjectLoadState,
  projectLoadReducer,
} from "./projectLoadState";

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
  // A module action's texts are sites once its declaration is known: the server's
  // declared actions (fetched here like the models) or Artisan's own table.
  if (serverId && projectRuntime(res).capabilities.liveData) {
    const declared = await fetchServerDeclaredActions(serverId).catch(() => []);
    adoptProjectActionTexts(
      loaded,
      (name) => coreActionOf(name) ?? declared.find((a) => a.name === name),
    );
  } else {
    adoptProjectActionTexts(loaded);
  }
  // Accepted reset (ADR project-sources-and-data-models).
  normalizeDataSources(loaded);
  for (const module of listModules()) module.migrateProject?.(loaded);

  return loaded;
}

/** Install a project only from the currently authorized, uncancelled load. */
function mirrorIntoStore(loaded: Project): void {
  // A module's kind may have been registered after its files were read (the build awaits
  // the server's declared actions; the module's view arrives meanwhile): `__root` only
  // adopts on the modules' transition to ready, which this Project missed.
  adoptLateDocuments(loaded);
  // PRESERVING the existing order — overwriting it moved the visited project to
  // the top of the sidebar.
  const current = useProjectsStore.getState().openProjects;
  const idx = current.projects.findIndex((p) => p.id === loaded.id);
  const loadedId = loaded.id as ProjectId;
  useProjectsStore.getState().setOpenProjects({
    projects:
      idx === -1
        ? [...current.projects, loaded]
        : current.projects.map((p, i) => (i === idx ? loaded : p)),
    projectOrder: current.projectOrder.includes(loadedId)
      ? current.projectOrder
      : [...current.projectOrder, loadedId],
  });
}

interface LoadContext {
  projectId: string;
  serverRef: string | null | undefined;
  ownerId: string;
  /** `[ownerId, serverRef, projectId]`: the location the load is for. */
  scope: string;
  cacheKey: string;
  cached: ReturnType<ReturnType<typeof useProjectCacheStore.getState>["get"]>;
  /** This scope is already shown (a Refresh or a retry, not a first open). */
  isOpen: () => boolean;
  /** The Project is installed: from now on, `isOpen()`. */
  markOpen: () => void;
  isCancelled: () => boolean;
  dispatch: (event: ProjectLoadEvent) => void;
}

/** How a read ended: `retry` = the server is unreachable, ask again later. */
interface ReadOutcome {
  retry: boolean;
  validated: boolean;
}

const UNREACHABLE = ["network_error", "fetch_timeout", "server_offline"];

/**
 * One read of the Project: identity from the hub, content from the server's
 * disk (ADR `server-disk-only-storage`), the draft resumed over it. Every state
 * change goes through `ctx.dispatch`; nothing is dispatched once cancelled.
 */
async function readFromHub(ctx: LoadContext): Promise<ReadOutcome> {
  const outcome: ReadOutcome = { retry: false, validated: false };
  try {
    await readAndOpen(ctx, outcome);
  } catch (e) {
    if (ctx.isCancelled()) return outcome;
    outcome.retry =
      e instanceof TypeError || (e instanceof Error && UNREACHABLE.includes(e.message));
    if (outcome.retry && ctx.isOpen()) ctx.dispatch({ type: "connectionLost" });
    else ctx.dispatch({ type: "loadFailed", error: (e as Error).message, retrying: outcome.retry });
  }
  return outcome;
}

/**
 * Server off but the hub has a copy: open, dated, and re-checked. Otherwise the
 * display IS the server's state.
 */
function settleOffline(
  ctx: LoadContext,
  outcome: ReadOutcome,
  since: string | undefined,
  neverPublished = false,
): void {
  ctx.dispatch({ type: "settled", since, unpublished: neverPublished });
  if (since) outcome.retry = true;
  else outcome.validated = true;
}

/** Shows the built Project, keeping the projects store's copy in step. */
function install(ctx: LoadContext, built: Project, fromDraft: boolean, failed?: FailedDocument[]) {
  mirrorIntoStore(built);
  ctx.markOpen();
  ctx.dispatch({ type: "opened", project: built, fromDraft, failed });
}

async function readAndOpen(ctx: LoadContext, outcome: ReadOutcome): Promise<void> {
  const { cached, cacheKey } = ctx;
  const res = await loadUserProject(ctx.projectId, ctx.serverRef);
  if (ctx.isCancelled()) return;
  // The content comes from the server's DISK, never from the hub (ADR
  // `server-disk-only-storage`): the response above only provides the
  // identity (name, slug, owning server, network).
  const diskId = res.project.externalId ?? res.project.id;
  ctx.dispatch({ type: "located", scope: ctx.scope, id: diskId });
  const ownerServerId = res.project.serverKeyId ?? res.serverKeyId;
  const runtime = projectRuntime(res);
  useProjectRuntimeStore.getState().set(runtime);
  useServersStore.getState().setActiveServerId(runtime.serverId);
  // Announce the fingerprint we hold: if the server has the same one, it
  // sends nothing and our copy has just been revalidated.
  const disk = await projectClient(res.project.id).read(cached?.hash);
  if (ctx.isCancelled()) return;
  if (!disk.ok) {
    const unreachable = UNREACHABLE.includes(disk.error);
    outcome.retry = unreachable;
    if (unreachable && ctx.isOpen()) {
      ctx.dispatch({ type: "connectionLost" });
      return;
    }
    ctx.dispatch({ type: "readFailed", error: disk.error, offline: unreachable });
    return;
  }
  await loadPersistedDrafts(res.project.id, ctx.ownerId);
  if (ctx.isCancelled()) return;
  const binaries = disk.unchanged ? (cached?.binaries ?? []) : (disk.binaries ?? []);
  setBinaryBaseline(res.project.id, binaries);
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
      if (ctx.isCancelled()) return;
      install(ctx, built, shown.fromDraft, cached.failed ?? []);
      settleOffline(ctx, outcome, disk.offlineSince, disk.unpublished);
      return;
    }
    // No cache but an "unchanged": we do not know what it refers to. Ask again
    // without a fingerprint rather than showing nothing.
    const full = await projectClient(res.project.id).read();
    if (ctx.isCancelled()) return;
    if (!full.ok || full.unchanged) {
      ctx.dispatch({ type: "loadFailed", error: "read_error", retrying: false });
      return;
    }
    setBinaryBaseline(res.project.id, full.binaries ?? []);
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
    if (ctx.isCancelled()) return;
    install(ctx, built, shown.fromDraft, full.failed);
    settleOffline(ctx, outcome, full.offlineSince, full.unpublished);
    return;
  }
  ctx.dispatch({ type: "documentsFailed", failed: disk.failed });
  const resumable = resumeDraft(res.project.id);

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
  if (ctx.isCancelled()) return;
  install(ctx, built, resumable !== null);
  settleOffline(ctx, outcome, disk.offlineSince, disk.unpublished);
}

function setBinaryBaseline(
  projectId: string,
  binaries: { path: string; hash: string; size: number }[],
): void {
  useProjectBaselineStore
    .getState()
    .setBinaries(
      projectId,
      Object.fromEntries(binaries.map(({ path, hash, size }) => [path, { hash, size }])),
    );
}

/**
 * A draft with unsaved work is RESUMED: reopening brings your work back, as in
 * any editor. What keeps you from confusing it with the server's state is no
 * longer a banner but the topbar state: Save is only enabled when there is
 * something to save, and Cancel goes back to it in one click. A draft with
 * nothing in it is dropped.
 */
function resumeDraft(projectId: string) {
  const draft = useProjectDraftStore.getState().get(projectId);
  const resumable = draft && (draft.remote || hasDraftChanges(draft)) ? draft : null;
  if (draft && !resumable) useProjectDraftStore.getState().clear(projectId);
  return resumable;
}

export function useProjectLoader(projectId: string, serverRef?: string | null): ProjectLoadResult {
  const ownerId = useProjectPrincipalId(projectId);
  const reloadToken = useProjectCacheStore((s) => s.reloadToken);
  const opened = useRef<string | null>(null);
  const [state, dispatch] = useReducer(projectLoadReducer, initialProjectLoadState);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadToken restarts the read on Refresh.
  useEffect(() => {
    const scope = JSON.stringify([ownerId, serverRef, projectId]);
    useProjectRuntimeStore.getState().set(null);
    useServersStore.getState().setActiveServerId(null);
    dispatch({ type: "started", keepProject: opened.current === scope });
    if (!ownerId) {
      dispatch({ type: "unauthenticated" });
      return;
    }
    useProjectDraftStore.getState().setOwner(ownerId);
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const cacheKey = projectCacheKey(projectId, serverRef, ownerId);
    const ctx: LoadContext = {
      projectId,
      serverRef,
      ownerId,
      scope,
      cacheKey,
      cached: useProjectCacheStore.getState().get(cacheKey),
      isOpen: () => opened.current === scope,
      markOpen: () => {
        opened.current = scope;
      },
      isCancelled: () => cancelled,
      dispatch,
    };

    const refresh = async () => {
      flushDraftEdits();
      const { retry, validated } = await readFromHub(ctx);
      if (cancelled) return;
      if (validated) dispatch({ type: "validated" });
      if (retry) retryTimer = setTimeout(refresh, 15_000);
    };
    void refresh();
    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
    };
  }, [projectId, serverRef, ownerId, reloadToken]);

  const currentScope = JSON.stringify([ownerId, serverRef, projectId]);
  const { project, resolvedUrl, ...rest } = state;
  return {
    ...rest,
    project: opened.current === currentScope ? project : null,
    urlId: resolvedUrl?.scope === currentScope ? resolvedUrl.id : null,
  };
}
