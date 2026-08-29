import { injectDeclaredModels, normalizeDataSources } from "@/domain/dataModels";
import type { Account, Project, ProjectId } from "@/domain/types";
import { isDirty } from "@/features/project/draft";
import { fetchServerDeclaredModels } from "@/lib/api/dataSources";
import { type FailedDocument, readProjectFiles } from "@/lib/api/projectFiles";
import { loadUserProject } from "@/lib/api/userProjects";
import { projectFromFiles } from "@/schema/projectFromFiles";
import { useAccountStore } from "@/state/accountStore";
import { useAuthStore } from "@/state/authStore";
import { useProjectBaselineStore } from "@/state/projectBaselineStore";
import { projectCacheKey, useProjectCacheStore } from "@/state/projectCacheStore";
import { useProjectDraftStore } from "@/state/projectDraftStore";
import { useEffect, useState } from "react";

export interface ProjectLoadResult {
  project: Project | null;
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
}

/** Les derniers modèles déclarés rapportés par le serveur — rangés avec la
 *  version connue pour que la visite suivante n'ait rien à attendre. */
let lastDeclaredModels: unknown[] | undefined;

/**
 * Construit le Project depuis un arbre rel-keyed et l'installe dans les stores.
 *
 * Deux appelants, deux provenances : l'arbre lu sur le serveur, ou celui d'un
 * brouillon quand le serveur est injoignable. Le chemin est le même — c'est ce
 * qui garantit qu'un brouillon n'est pas un objet de seconde classe.
 */
async function buildProject(
  res: Awaited<ReturnType<typeof loadUserProject>>,
  diskId: string,
  tree: Record<string, string>,
  /**
   * Les modèles déclarés, quand on les a déjà.
   *
   * Sans ça, l'affichage de la version connue attendait un aller-retour REST
   * avant de rendre le moindre pixel — donc « Lecture des fichiers du
   * serveur… » à chaque visite, alors que tout était là. Un cache qui attend
   * le réseau n'est pas un cache. Le passage suivant, celui du serveur, les
   * rafraîchit de toute façon.
   */
  declaredModels?: unknown[],
): Promise<Project> {
  // Files-first (ADR files-first-source-of-truth): the file tree IS the Project
  // — parse it client-side. Les chemins sont relatifs au project ;
  // `projectFromFiles` attend la forme canonique.
  const canonical: Record<string, string> = {};
  for (const [rel, content] of Object.entries(tree)) {
    canonical[`plugins/Artisan/projects/${diskId}/${rel}`] = content;
  }
  const loaded: Project = projectFromFiles(res.project.id as ProjectId, canonical, {
    name: res.project.name,
    diskId: res.project.externalId ?? undefined,
    slug: res.project.slug ?? undefined,
    serverKeyId: res.project.serverKeyId ?? res.serverKeyId ?? undefined,
  });
  // Module-declared models (ADR composable-data-models §4/§5).
  const serverId = res.project.serverKeyId ?? res.serverKeyId;
  if (declaredModels) {
    injectDeclaredModels(loaded, declaredModels as never);
  } else if (serverId && res.networkId) {
    const docs = await fetchServerDeclaredModels(res.networkId, serverId).catch(() => []);
    injectDeclaredModels(loaded, docs);
    lastDeclaredModels = docs;
  }
  // Accepted reset (ADR project-sources-and-data-models).
  normalizeDataSources(loaded);

  return loaded;
}

/**
 * Installe le Project dans le store que lit tout le canvas.
 *
 * Séparé de la construction, et ce n'est pas cosmétique : deux constructions
 * coexistent (la version connue, affichée tout de suite, et celle du serveur),
 * elles attendent chacune un aller-retour réseau, et rien ne garantit leur
 * ordre d'arrivée. Quand le miroir vivait DANS la construction, celle du cache
 * pouvait finir en dernier et écraser la fraîche — l'écran montrait alors la
 * visite précédente en croyant montrer le serveur.
 *
 * Le miroir appartient donc à l'appelant, qui seul sait qui a gagné.
 */
function mirrorIntoAccount(loaded: Project, networkId: string): void {
  // EN PRÉSERVANT l'ordre existant — l'écraser remontait le project visité en
  // tête de sidebar.
  const current = useAccountStore.getState().account;
  const idx = current.projects.findIndex((p) => p.id === loaded.id);
  const loadedId = loaded.id as ProjectId;
  useAccountStore.getState().setAccount({
    id: networkId as Account["id"],
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
  const user = useAuthStore((s) => s.currentUser);
  const reloadToken = useProjectCacheStore((s) => s.reloadToken);
  const [project, setProject] = useState<Project | null>(null);
  const [networkId, setNetworkId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [failed, setFailed] = useState<FailedDocument[]>([]);
  const [fromDraft, setFromDraft] = useState(false);
  const [stale, setStale] = useState(false);

  useEffect(() => {
    setError(null);
    setOffline(false);
    setFailed([]);
    setFromDraft(false);
    setStale(false);
    if (!user) {
      setError("Not authenticated");
      return;
    }
    // La dernière version connue s'affiche TOUT DE SUITE, pendant que la vraie
    // lecture part. Sans elle, l'écran attend un aller-retour jusqu'au disque du
    // serveur — plusieurs secondes — pour afficher, neuf fois sur dix, la même
    // chose qu'à la visite précédente.
    let fresh = false;
    const cacheKey = projectCacheKey(projectId, serverRef);
    const cached = useProjectCacheStore.getState().get(cacheKey);
    if (cached) {
      buildProject(
        cached.identity as never,
        cached.diskId,
        cached.tree,
        cached.declaredModels ?? [],
      )
        .then((p) => {
          // La réponse du serveur a pu arriver entre-temps : elle gagne,
          // toujours — y compris pour le store que lit le canvas, d'où le
          // miroir posé ICI et pas dans la construction.
          if (fresh) return;
          mirrorIntoAccount(p, (cached.identity as { networkId?: string }).networkId ?? "");
          setProject(p);
          setFailed(cached.failed ?? []);
          setStale(true);
        })
        .catch(() => {
          // Un cache illisible (format d'une version précédente) ne casse rien :
          // on l'oublie et on attend le serveur, comme avant.
          useProjectCacheStore.getState().forget(cacheKey);
        });
    }

    loadUserProject(projectId, serverRef)
      .then(async (res) => {
        // Le contenu vient du DISQUE du serveur, jamais du backend (ADR
        // `server-disk-only-storage`) : la réponse ci-dessus ne sert plus qu'à
        // l'identité (nom, slug, serveur propriétaire, network).
        const diskId = res.project.externalId ?? res.project.id;
        const ownerServerId = res.project.serverKeyId ?? res.serverKeyId;
        // On annonce l'empreinte qu'on détient : si le serveur porte la même, il
        // ne renvoie rien et notre copie vient d'être revalidée.
        const disk = await readProjectFiles(res.networkId, ownerServerId, diskId, cached?.hash);
        if (!disk.ok) {
          const unreachable = disk.error === "server_offline" || disk.error === "network_error";
          // Serveur injoignable : on ouvre le brouillon plutôt que de refuser
          // l'accès (décision 7 révisée). C'est un état DATÉ, pas la vérité —
          // l'appelant l'annonce, et Enregistrer reste hors de portée.
          const draft = unreachable
            ? useProjectDraftStore.getState().get(res.project.id)
            : undefined;
          if (draft) {
            fresh = true;
            useProjectBaselineStore.getState().set(res.project.id, draft.baseline);
            const built = await buildProject(res, diskId, draft.tree);
            mirrorIntoAccount(built, res.networkId);
            setProject(built);
            setNetworkId(res.networkId);
            setFromDraft(true);
            setOffline(true);
            return;
          }
          fresh = true;
          if (unreachable && cached) {
            // Serveur injoignable, mais on sait ce qu'il avait : on le montre,
            // daté, plutôt qu'un écran d'erreur. Enregistrer reste hors de portée.
            const built = await buildProject(cached.identity as never, cached.diskId, cached.tree);
            mirrorIntoAccount(built, res.networkId);
            setProject(built);
            setNetworkId(res.networkId);
            setStale(true);
            setOffline(true);
            return;
          }
          setOffline(unreachable);
          setError(disk.error);
          return;
        }
        if (disk.unchanged) {
          // Revalidé : ce qu'on affiche EST ce que le serveur porte. Rien à
          // reconstruire, rien à retransporter — seul le drapeau tombe.
          fresh = true;
          if (cached) {
            useProjectBaselineStore.getState().set(res.project.id, cached.tree);
            useProjectCacheStore.getState().put(cacheKey, {
              ...cached,
              hash: disk.hash ?? cached.hash,
              fetchedAt: new Date().toISOString(),
            });
            const built = await buildProject(res, diskId, cached.tree);
            mirrorIntoAccount(built, res.networkId);
            if (!project) setProject(built);
            setNetworkId(res.networkId);
            setFailed(cached.failed ?? []);
            setStale(false);
            return;
          }
          // Pas de cache mais un « inchangé » : on ne sait pas de quoi il parle.
          // On redemande sans empreinte plutôt que d'afficher du vide.
          const full = await readProjectFiles(res.networkId, ownerServerId, diskId);
          if (!full.ok || full.unchanged) {
            setError("read_error");
            return;
          }
          fresh = true;
          useProjectCacheStore.getState().put(cacheKey, {
            identity: res,
            diskId,
            serverKeyId: ownerServerId ?? null,
            tree: full.files,
            failed: full.failed,
            hash: full.hash ?? null,
            declaredModels: lastDeclaredModels,
            fetchedAt: new Date().toISOString(),
          });
          useProjectBaselineStore.getState().set(res.project.id, full.files);
          const built = await buildProject(res, diskId, full.files);
          mirrorIntoAccount(built, res.networkId);
          setProject(built);
          setNetworkId(res.networkId);
          setFailed(full.failed);
          setStale(false);
          return;
        }
        setFailed(disk.failed);
        // Un brouillon avec du travail non enregistré est REPRIS : tu retrouves
        // ton travail en rouvrant, comme dans n'importe quel éditeur. Ce qui
        // t'évite de le confondre avec l'état du serveur, ce n'est plus un
        // bandeau mais l'état de la topbar : Enregistrer n'est actif que s'il y
        // a quelque chose à enregistrer, et Annuler y revient d'un clic.
        const draft = useProjectDraftStore.getState().get(res.project.id);
        const resumable = draft && isDirty(draft.initialTree, draft.tree) ? draft : null;
        if (draft && !resumable) useProjectDraftStore.getState().clear(res.project.id);

        // La base du compare-and-swap : ce que le disque contenait à l'ouverture.
        useProjectBaselineStore.getState().set(res.project.id, disk.files);

        // La base reste celle du SERVEUR : c'est elle que le compare-and-swap
        // doit présenter, sinon on écraserait sans le savoir ce qui a changé
        // depuis. Seul l'arbre affiché vient du brouillon.
        fresh = true;
        useProjectCacheStore.getState().put(cacheKey, {
          identity: res,
          diskId,
          serverKeyId: ownerServerId ?? null,
          tree: disk.files,
          failed: disk.failed,
          hash: disk.hash ?? null,
          declaredModels: lastDeclaredModels,
          fetchedAt: new Date().toISOString(),
        });
        const built = await buildProject(res, diskId, resumable?.tree ?? disk.files);
        mirrorIntoAccount(built, res.networkId);
        setProject(built);
        setNetworkId(res.networkId);
        setFromDraft(resumable !== null);
        setStale(false);
      })
      .catch((e) => setError((e as Error).message));
  }, [projectId, serverRef, user, reloadToken]);

  return { project, networkId, error, offline, failed, fromDraft, stale };
}
