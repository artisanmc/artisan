import { useEffect, useState } from "react";
import { useAuthStore } from "@/state/authStore";
import { useAccountStore } from "@/state/accountStore";
import { loadUserProject } from "@/lib/api/userProjects";
import { injectDeclaredModels, normalizeDataSources } from "@/domain/dataModels";
import { fetchServerDeclaredModels } from "@/lib/api/dataSources";
import { projectFromFiles } from "@/schema/projectFromFiles";
import { readProjectFiles, type FailedDocument } from "@/lib/api/projectFiles";
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
}

export function useProjectLoader(projectId: string, serverRef?: string | null): ProjectLoadResult {
  const user = useAuthStore((s) => s.currentUser);
  const [project, setProject] = useState<Project | null>(null);
  const [networkId, setNetworkId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [failed, setFailed] = useState<FailedDocument[]>([]);

  useEffect(() => {
    setError(null);
    setOffline(false);
    setFailed([]);
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
          // Pas de repli sur une copie périmée : il n'y en a pas, et en inventer
          // une ferait éditer un état qui n'existe nulle part.
          setOffline(disk.error === "server_offline" || disk.error === "network_error");
          setError(disk.error);
          return;
        }
        setFailed(disk.failed);
        // La base du compare-and-swap : ce que le disque contenait à l'ouverture.
        useProjectBaselineStore.getState().set(res.project.id, disk.files);

        // Files-first (ADR files-first-source-of-truth): the file tree IS the
        // Project — parse it client-side. A fresh project has files={} and
        // parses to an empty workspace. Les chemins disque sont relatifs au
        // project ; `projectFromFiles` attend la forme canonique.
        const canonical: Record<string, string> = {};
        for (const [rel, content] of Object.entries(disk.files)) {
          canonical[`plugins/Artisan/projects/${diskId}/${rel}`] = content;
        }
        const loaded: Project = projectFromFiles(res.project.id as ProjectId, canonical, {
          name: res.project.name,
          diskId: res.project.externalId ?? undefined,
          slug: res.project.slug ?? undefined,
          serverKeyId: res.project.serverKeyId ?? res.serverKeyId ?? undefined,
        });
        // Module-declared models (ADR composable-data-models §4/§5): inject
        // the bound server's declarations (read-only shapes) and run pending
        // declarative migrations; the result materializes at the next save.
        const serverId = res.project.serverKeyId ?? res.serverKeyId;
        if (serverId && res.networkId) {
          const docs = await fetchServerDeclaredModels(res.networkId, serverId);
          injectDeclaredModels(loaded, docs);
        }
        // Accepted reset (ADR project-sources-and-data-models): legacy
        // schemaless sources are dropped at the load boundary, never migrated.
        normalizeDataSources(loaded);
        setProject(loaded);
        setNetworkId(res.networkId);
        // Mirror into accountStore so descendants (FlowCanvas, EditorPane,
        // ProjectProperties, …) that read from useAccountStore.account.projects
        // can find it. We MUST preserve the existing projects array + projectOrder
        // — overwriting them clobbered the sidebar's sort, which made every
        // workspace click yank the visited project to position 0.
        const current = useAccountStore.getState().account;
        const idx = current.projects.findIndex((p) => p.id === loaded.id);
        const nextProjects =
          idx === -1
            ? [...current.projects, loaded]
            : current.projects.map((p, i) => (i === idx ? loaded : p));
        const loadedId = loaded.id as ProjectId;
        const nextOrder = current.projectOrder.includes(loadedId)
          ? current.projectOrder
          : [...current.projectOrder, loadedId];
        useAccountStore.getState().setAccount({
          id: res.networkId as Account["id"],
          projects: nextProjects,
          projectOrder: nextOrder,
        });
      })
      .catch((e) => setError((e as Error).message));
  }, [projectId, serverRef, user]);

  return { project, networkId, error, offline, failed };
}
