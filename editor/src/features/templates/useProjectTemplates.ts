import { isDirty } from "@/features/project/draft";
import type { ProjectTarget } from "@/lib/api/projectFiles";
import { useModulesStore } from "@/state/modulesStore";
import { useProjectBaselineStore } from "@/state/projectBaselineStore";
import { useProjectCacheStore } from "@/state/projectCacheStore";
import { useProjectDraftStore } from "@/state/projectDraftStore";
import { useProjectRuntime } from "@/state/projectRuntimeStore";
import { useProjectTemplatesStore } from "@/state/projectTemplatesStore";
import { useProjectsStore } from "@/state/projectsStore";
import { useEffect, useMemo } from "react";
import {
  type TemplateFileState,
  type TemplateState,
  announcedTemplates,
  templateState,
} from "./templateStates";

export interface ProjectTemplates {
  /** The Project's server and folder; null while it is not open on a server. */
  target: (ProjectTarget & object) | null;
  serverId: string | null;
  status: "none" | "loading" | "ready" | "unsupported" | "error";
  /** One entry per template the server's modules announce. */
  states: TemplateState[];
  /** A copied file's template and state, by path. */
  byPath: Record<string, { template: TemplateState; file: TemplateFileState }>;
  /** Unpublished changes: a copy (written by the server) would not reach the draft. */
  dirty: boolean;
  /** Re-reads the Project from disk after a copy, then its origins. */
  refresh: () => void;
}

/**
 * The module templates seen from an open Project (ADR `module-templates`): which ones its
 * server offers, and the state of each file it copied, against its published files.
 */
export function useProjectTemplates(projectId: string): ProjectTemplates {
  const project = useProjectsStore((s) => s.openProjects.projects.find((p) => p.id === projectId));
  const serverId = useProjectRuntime(projectId)?.serverId ?? project?.serverKeyId ?? null;
  const diskId = project ? (project.diskId ?? project.id) : null;
  const baseline = useProjectBaselineStore((s) => s.baselines[projectId]);
  const modules = useModulesStore((s) => s.active);
  const entry = useProjectTemplatesStore((s) => s.entries[projectId]);
  const draft = useProjectDraftStore((s) => s.drafts[projectId]);
  const dirty = draft ? isDirty(draft.initialTree, draft.tree) : false;
  const announced = useMemo(() => announcedTemplates(modules), [modules]);
  const target = useMemo(
    () => (serverId && diskId ? { serverId, diskId } : null),
    [serverId, diskId],
  );

  // Only when the server offers a template: an older one has no origins to read.
  useEffect(() => {
    if (!target || !baseline || announced.length === 0) return;
    void useProjectTemplatesStore.getState().load(projectId, target, baseline);
  }, [projectId, target, baseline, announced.length]);

  const states = useMemo(
    () =>
      entry?.status === "ready"
        ? announced.map((a) => templateState(a.moduleId, a.template, entry.origins, entry.hashes))
        : [],
    [announced, entry],
  );
  const byPath = useMemo(() => {
    const out: ProjectTemplates["byPath"] = {};
    for (const template of states) {
      for (const file of template.files) {
        if (file.status === "absent" || file.status === "occupied") continue;
        out[file.path] = { template, file };
      }
    }
    return out;
  }, [states]);

  return {
    target,
    serverId,
    status: announced.length === 0 ? "none" : (entry?.status ?? "loading"),
    states,
    byPath,
    dirty,
    refresh: () => {
      // Nothing unpublished (a copy requires it): the re-read loses nothing.
      useProjectDraftStore.getState().clear(projectId);
      useProjectCacheStore.getState().requestReload();
    },
  };
}
