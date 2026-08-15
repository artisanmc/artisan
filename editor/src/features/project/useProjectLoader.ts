import { useEffect, useState } from "react";
import { useAuthStore } from "@/state/authStore";
import { useAccountStore } from "@/state/accountStore";
import { loadUserProject } from "@/lib/api/userProjects";
import { injectDeclaredModels, normalizeDataSources } from "@/domain/dataModels";
import { fetchServerDeclaredModels } from "@/lib/api/dataSources";
import { projectFromFiles } from "@/schema/projectFromFiles";
import { readProjectFiles, type FailedDocument } from "@/lib/api/projectFiles";
import { isDirty, type ProjectDraft } from "@/features/project/draft";
import { useProjectDraftStore } from "@/state/projectDraftStore";
import { adoptDiskIntoProject } from "@/features/project/saveProjectToDisk";
import { useProjectBaselineStore } from "@/state/projectBaselineStore";
import type { Account, Project, ProjectId } from "@/domain/types";

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
  /**
   * Un brouillon local contient du travail non enregistré, et l'éditeur affiche
   * l'état du **serveur**. À proposer — jamais à appliquer en silence.
   */
  pendingDraft: ProjectDraft | null;
  /** Remplace l'état affiché par le brouillon. */
  restoreDraft: () => void;
  /** Le Project affiché vient du brouillon, faute de serveur joignable. */
  fromDraft: boolean;
}

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
  if (serverId && res.networkId) {
    const docs = await fetchServerDeclaredModels(res.networkId, serverId).catch(() => []);
    injectDeclaredModels(loaded, docs);
  }
  // Accepted reset (ADR project-sources-and-data-models).
  normalizeDataSources(loaded);

  // Mirror into accountStore so descendants can find it, EN PRÉSERVANT l'ordre
  // existant — l'écraser remontait le project visité en tête de sidebar.
  const current = useAccountStore.getState().account;
  const idx = current.projects.findIndex((p) => p.id === loaded.id);
  const loadedId = loaded.id as ProjectId;
  useAccountStore.getState().setAccount({
    id: res.networkId as Account["id"],
    projects:
      idx === -1 ? [...current.projects, loaded] : current.projects.map((p, i) => (i === idx ? loaded : p)),
    projectOrder: current.projectOrder.includes(loadedId)
      ? current.projectOrder
      : [...current.projectOrder, loadedId],
  });
  return loaded;
}

export function useProjectLoader(projectId: string, serverRef?: string | null): ProjectLoadResult {
  const user = useAuthStore((s) => s.currentUser);
  const [project, setProject] = useState<Project | null>(null);
  const [networkId, setNetworkId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [failed, setFailed] = useState<FailedDocument[]>([]);
  const [pendingDraft, setPendingDraft] = useState<ProjectDraft | null>(null);
  const [fromDraft, setFromDraft] = useState(false);

  useEffect(() => {
    setError(null);
    setOffline(false);
    setFailed([]);
    setPendingDraft(null);
    setFromDraft(false);
    if (!user) {
      setError("Not authenticated");
      return;
    }
    loadUserProject(projectId, serverRef)
      .then(async (res) => {
        // Le contenu vient du DISQUE du serveur, jamais du backend (ADR
        // `server-disk-only-storage`) : la réponse ci-dessus ne sert plus qu'à
        // l'identité (nom, slug, serveur propriétaire, network).
        const diskId = res.project.externalId ?? res.project.id;
        const ownerServerId = res.project.serverKeyId ?? res.serverKeyId;
        const disk = await readProjectFiles(res.networkId, ownerServerId, diskId);
        if (!disk.ok) {
          const unreachable = disk.error === "server_offline" || disk.error === "network_error";
          // Serveur injoignable : on ouvre le brouillon plutôt que de refuser
          // l'accès (décision 7 révisée). C'est un état DATÉ, pas la vérité —
          // l'appelant l'annonce, et Enregistrer reste hors de portée.
          const draft = unreachable
            ? useProjectDraftStore.getState().get(res.project.id)
            : undefined;
          if (draft) {
            useProjectBaselineStore.getState().set(res.project.id, draft.baseline);
            setProject(await buildProject(res, diskId, draft.tree));
            setNetworkId(res.networkId);
            setFromDraft(true);
            setOffline(true);
            return;
          }
          setOffline(unreachable);
          setError(disk.error);
          return;
        }
        setFailed(disk.failed);
        // Un brouillon avec du travail non enregistré ne s'applique JAMAIS en
        // silence : l'éditeur montre ce que le serveur exécute, et on propose.
        // L'afficher sans le dire recréerait la confusion que la sémantique de
        // reload a supprimée.
        const draft = useProjectDraftStore.getState().get(res.project.id);
        if (draft && isDirty(draft.baseline, draft.tree)) setPendingDraft(draft);
        else if (draft) useProjectDraftStore.getState().clear(res.project.id);

        // La base du compare-and-swap : ce que le disque contenait à l'ouverture.
        useProjectBaselineStore.getState().set(res.project.id, disk.files);

        setProject(await buildProject(res, diskId, disk.files));
        setNetworkId(res.networkId);
      })
      .catch((e) => setError((e as Error).message));
  }, [projectId, serverRef, user]);

  const restoreDraft = () => {
    const draft = pendingDraft;
    if (!draft || !project) return;
    // La base reste celle du brouillon : c'est elle que le compare-and-swap doit
    // présenter au serveur, sinon on écraserait sans le savoir ce qui a changé
    // depuis que ce travail a commencé.
    useProjectBaselineStore.getState().set(project.id, draft.baseline);
    useAccountStore.getState().replaceProject(
      adoptDiskIntoProject(project, draft.tree, []),
    );
    setPendingDraft(null);
    setFromDraft(true);
  };

  return { project, networkId, error, offline, failed, pendingDraft, restoreDraft, fromDraft };
}
