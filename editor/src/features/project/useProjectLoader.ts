import { injectDeclaredModels, normalizeDataSources } from "@/domain/dataModels";
import type { Account, Project, ProjectId } from "@/domain/types";
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
  networkId: string | null;
  error: string | null;
  /** Le serveur propriétaire est injoignable — le Project n'est pas ouvrable. */
  offline: boolean;
  /**
   * Documents présents sur le serveur mais que celui-ci n'a **pas** réussi à
   * charger. Ils s'éditent normalement (leur texte est là) mais ne tournent pas.
   */
  failed: FailedDocument[];
  /** L'état affiché vient d'un brouillon local, pas du serveur. */
  fromDraft: boolean;
  /**
   * L'écran montre la **dernière version connue** (cache) pendant que la
   * lecture du serveur est en vol. Daté, donc annoncé : le disque du serveur
   * reste la vérité, et l'affichage ne doit pas prétendre l'être.
   */
  stale: boolean;
  /**
   * Serveur éteint, Project ouvert depuis la copie du backend : la date de ce
   * Snapshot (ADR `snapshot-mirror-and-backend-history`, décision 7).
   */
  offlineSince: string | null;
  /** Jamais publié (Server non relié) : le contenu vit tout entier dans le brouillon. */
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

/** Les derniers modèles déclarés rapportés par le serveur — rangés avec la
 *  version connue pour que la visite suivante n'ait rien à attendre. */
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
  if (!models && serverId && res.networkId && projectRuntime(res).capabilities.liveData) {
    models = await fetchServerDeclaredModels(res.networkId, serverId).catch(() => []);
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
function mirrorIntoAccount(loaded: Project, networkId: string | null): void {
  // EN PRÉSERVANT l'ordre existant — l'écraser remontait le project visité en
  // tête de sidebar.
  const current = useAccountStore.getState().account;
  const idx = current.projects.findIndex((p) => p.id === loaded.id);
  const loadedId = loaded.id as ProjectId;
  useAccountStore.getState().setAccount({
    id: (networkId ?? "") as Account["id"],
    projects:
      idx === -1
        ? [...current.projects, loaded]
        : current.projects.map((p, i) => (i === idx ? loaded : p)),
    projectOrder: current.projectOrder.includes(loadedId)
      ? current.projectOrder
      : [...current.projectOrder, loadedId],
  });
}

export function useProjectLoader(projectId: string, serverRef?: string | null, networkRef?: string | null): ProjectLoadResult {
  const ownerId = useProjectPrincipalId(projectId);
  const reloadToken = useProjectCacheStore((s) => s.reloadToken);
  const opened = useRef<string | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [resolvedUrl, setResolvedUrl] = useState<{ scope: string; id: string } | null>(null);
  const [networkId, setNetworkId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [failed, setFailed] = useState<FailedDocument[]>([]);
  const [fromDraft, setFromDraft] = useState(false);
  const [stale, setStale] = useState(false);
  const [offlineSince, setOfflineSince] = useState<string | null>(null);
  const [unpublished, setUnpublished] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadToken relance la lecture sur Actualiser.
  useEffect(() => {
    const scope = JSON.stringify([ownerId, networkRef, serverRef, projectId]);
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
    const cacheKey = projectCacheKey(projectId, serverRef, networkRef, ownerId);
    const cached = useProjectCacheStore.getState().get(cacheKey);

    const refresh = () => {
      flushDraftEdits();
      let retry = false;
      let validated = false;
      // Serveur éteint mais copie du backend : ouvert, daté, et on revérifie.
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
      return loadUserProject(projectId, serverRef, networkRef)
        .then(async (res) => {
          if (cancelled) return;
          // Le contenu vient du DISQUE du serveur, jamais du backend (ADR
          // `server-disk-only-storage`) : la réponse ci-dessus ne sert plus qu'à
          // l'identité (nom, slug, serveur propriétaire, network).
          const diskId = res.project.externalId ?? res.project.id;
          setResolvedUrl({ scope, id: diskId });
          const ownerServerId = res.project.serverKeyId ?? res.serverKeyId;
          const runtime = projectRuntime(res);
          useProjectRuntimeStore.getState().set(runtime);
          useServersStore.getState().setActiveServerId(runtime.serverId);
          // On annonce l'empreinte qu'on détient : si le serveur porte la même, il
          // ne renvoie rien et notre copie vient d'être revalidée.
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
            // Revalidé : ce qu'on affiche EST ce que le serveur porte. Rien à
            // reconstruire, rien à retransporter — seul le drapeau tombe.
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
              mirrorIntoAccount(built, res.networkId);
              opened.current = scope;
              setProject(built);
              setNetworkId(res.networkId);
              setFailed(cached.failed ?? []);
              settle(disk.offlineSince, disk.unpublished);
              return;
            }
            // Pas de cache mais un « inchangé » : on ne sait pas de quoi il parle.
            // On redemande sans empreinte plutôt que d'afficher du vide.
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
            mirrorIntoAccount(built, res.networkId);
            opened.current = scope;
            setProject(built);
            setFromDraft(shown.fromDraft);
            setNetworkId(res.networkId);
            setFailed(full.failed);
            settle(full.offlineSince, full.unpublished);
            return;
          }
          setFailed(disk.failed);
          // Un brouillon avec du travail non enregistré est REPRIS : tu retrouves
          // ton travail en rouvrant, comme dans n'importe quel éditeur. Ce qui
          // t'évite de le confondre avec l'état du serveur, ce n'est plus un
          // bandeau mais l'état de la topbar : Enregistrer n'est actif que s'il y
          // a quelque chose à enregistrer, et Annuler y revient d'un clic.
          const draft = useProjectDraftStore.getState().get(res.project.id);
          const resumable = draft && (draft.remote || hasDraftChanges(draft)) ? draft : null;
          if (draft && !resumable) useProjectDraftStore.getState().clear(res.project.id);

          // La base du compare-and-swap : ce que le disque contenait à l'ouverture.
          useProjectBaselineStore.getState().set(res.project.id, resumable?.baseline ?? disk.files);

          // La base reste celle du SERVEUR : c'est elle que le compare-and-swap
          // doit présenter, sinon on écraserait sans le savoir ce qui a changé
          // depuis. Seul l'arbre affiché vient du brouillon.
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
          mirrorIntoAccount(built, res.networkId);
          opened.current = scope;
          setProject(built);
          setNetworkId(res.networkId);
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
  }, [projectId, serverRef, networkRef, ownerId, reloadToken]);

  const currentScope = JSON.stringify([ownerId, networkRef, serverRef, projectId]);
  return { project: opened.current === currentScope ? project : null, urlId: resolvedUrl?.scope === currentScope ? resolvedUrl.id : null, networkId, error, offline, failed, fromDraft, stale, offlineSince, unpublished };
}
