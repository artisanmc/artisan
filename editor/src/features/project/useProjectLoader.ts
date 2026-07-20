import { useEffect, useState } from "react";
import { useAuthStore } from "@/state/authStore";
import { useAccountStore } from "@/state/accountStore";
import { loadUserProject } from "@/lib/api/userProjects";
import { normalizeDataSources } from "@/domain/dataModels";
import type { Account, Project, ProjectId } from "@/domain/types";

/**
 * A fresh pack created via POST /api/v1/networks/:id/projects has editorJson=null
 * server-side, so loadUserProject returns editor=null. The editor expects a
 * valid Project shape — fall back to this empty default so the canvas renders
 * an empty workspace instead of crashing into a black screen.
 */
function emptyProject(id: string, name: string): Project {
  const now = new Date().toISOString();
  return {
    id: id as ProjectId,
    name,
    source: "user_created",
    createdAt: now,
    updatedAt: now,
    menus: [],
    commands: [],
    templates: [],
    assets: [],
    dataSources: [],
    i18nKeys: {},
    defaultLang: "en",
    dialogs: [],
    canvasLayout: {},
  };
}

export interface ProjectLoadResult {
  pack: Project | null;
  networkId: string | null;
  error: string | null;
}

export function useProjectLoader(projectId: string): ProjectLoadResult {
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
    loadUserProject(projectId)
      .then((res) => {
        // loadUserProject returns { project, files, editor, networkId }; editor is the full Project JSON.
        // Fresh projects have editor=null server-side — fall back to an empty Project shape.
        const loaded = (res.editor as Project | null) ?? emptyProject(res.project.id, res.project.name);
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
  }, [projectId, user]);

  return { pack, networkId, error };
}
