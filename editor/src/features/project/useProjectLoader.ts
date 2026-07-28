import { useEffect, useState } from "react";
import { useAuthStore } from "@/state/authStore";
import { useAccountStore } from "@/state/accountStore";
import { loadUserProject } from "@/lib/api/userProjects";
import { injectDeclaredModels, normalizeDataSources } from "@/domain/dataModels";
import { fetchServerDeclaredModels } from "@/lib/api/dataSources";
import { projectFromFiles } from "@/schema/projectFromFiles";
import { useDivergenceStore } from "@/state/divergenceStore";
import type { Account, Project, ProjectId } from "@/domain/types";

export interface ProjectLoadResult {
  pack: Project | null;
  networkId: string | null;
  error: string | null;
}

export function useProjectLoader(projectId: string, serverRef?: string | null): ProjectLoadResult {
  const user = useAuthStore((s) => s.currentUser);
  const [pack, setProject] = useState<Project | null>(null);
  const [networkId, setNetworkId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    if (!user) {
      setError("Not authenticated");
      return;
    }
    loadUserProject(projectId, serverRef)
      .then(async (res) => {
        // Files-first (ADR files-first-source-of-truth): the file tree IS the
        // Project — parse it client-side. A fresh project has files={} and
        // parses to an empty workspace.
        const loaded: Project = projectFromFiles(res.project.id as ProjectId, res.files, {
          name: res.project.name,
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
        // Files-first P3c: surface a pending disk↔web divergence to the banner.
        useDivergenceStore.getState().set(projectId, res.divergence);
        // Accepted reset (ADR project-sources-and-data-models): legacy
        // schemaless sources are dropped at the load boundary, never migrated.
        normalizeDataSources(loaded);
        setProject(loaded);
        setNetworkId(res.networkId);
        // Mirror into accountStore so descendants (FlowCanvas, EditorPane,
        // ProjectProperties, …) that read from useAccountStore.account.projects
        // can find it. We MUST preserve the existing projects array + projectOrder
        // — overwriting them clobbered the sidebar's sort, which made every
        // workspace click yank the visited pack to position 0.
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

  return { pack, networkId, error };
}
