import { useEffect, useState } from "react";
import { useAuthStore } from "@/state/authStore";
import { useAccountStore } from "@/state/accountStore";
import { loadUserProject } from "@/lib/api/userProjects";
import { injectDeclaredModels, normalizeDataSources } from "@/domain/dataModels";
import { fetchServerDeclaredModels } from "@/lib/api/dataSources";
import { projectFromFiles } from "@/schema/projectFromFiles";
import { readProjectFiles, type FailedDocument } from "@/lib/api/projectFiles";
import { isDirty } from "@/features/project/draft";
import { useProjectDraftStore } from "@/state/projectDraftStore";
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
  /** L'état affiché vient d'un brouillon local, pas du serveur. */
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
  const [fromDraft, setFromDraft] = useState(false);

  useEffect(() => {
    setError(null);
    setOffline(false);
    setFailed([]);
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
        // Un brouillon avec du travail non enregistré est REPRIS : tu retrouves
        // ton travail en rouvrant, comme dans n'importe quel éditeur. Ce qui
        // t'évite de le confondre avec l'état du serveur, ce n'est plus un
        // bandeau mais l'indicateur permanent « non enregistré » de la topbar,
        // et le bouton Annuler qui y revient d'un clic.
        const draft = useProjectDraftStore.getState().get(res.project.id);
        const resumable = draft && isDirty(draft.initialTree, draft.tree) ? draft : null;
        if (draft && !resumable) useProjectDraftStore.getState().clear(res.project.id);

        // La base du compare-and-swap : ce que le disque contenait à l'ouverture.
        useProjectBaselineStore.getState().set(res.project.id, disk.files);

        // La base reste celle du SERVEUR : c'est elle que le compare-and-swap
        // doit présenter, sinon on écraserait sans le savoir ce qui a changé
        // depuis. Seul l'arbre affiché vient du brouillon.
        setProject(await buildProject(res, diskId, resumable?.tree ?? disk.files));
        setNetworkId(res.networkId);
        setFromDraft(resumable !== null);
      })
      .catch((e) => setError((e as Error).message));
  }, [projectId, serverRef, user]);

  return { project, networkId, error, offline, failed, fromDraft };
}
