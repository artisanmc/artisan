import type { ProjectId } from "@/domain/types";
import type { ProjectTarget } from "@/lib/api/projectFiles";
import { useProjectBaselineStore } from "@/state/projectBaselineStore";
import { useProjectRuntime } from "@/state/projectRuntimeStore";
import {
  type ProjectTemplatesEntry,
  useProjectTemplatesStore,
} from "@/state/projectTemplatesStore";
import { useProjectsStore } from "@/state/projectsStore";
import { useEffect, useMemo } from "react";

/**
 * The origins the server recorded for the open module `projectId` (`projectTemplatesStore`),
 * read once when nothing read them yet and `wanted`: the module's tree reads them when it is
 * shown, the Resources read them here. `target` names the module on its server; `null` while
 * the module is not known.
 */
export function useProjectOrigins(
  projectId: ProjectId,
  wanted = true,
): { entry: ProjectTemplatesEntry | undefined; target: ProjectTarget | null } {
  const project = useProjectsStore((s) => s.openProjects.projects.find((p) => p.id === projectId));
  const serverId = useProjectRuntime(projectId)?.serverId ?? project?.serverKeyId ?? null;
  const diskId = project ? (project.diskId ?? project.id) : null;
  const target = useMemo(
    () => (serverId && diskId ? { serverId, diskId } : null),
    [serverId, diskId],
  );
  const entry = useProjectTemplatesStore((s) => s.entries[projectId]);
  const baseline = useProjectBaselineStore((s) => s.baselines[projectId]);
  const unread = !entry;
  useEffect(() => {
    if (!wanted || !target || !baseline || !unread) return;
    void useProjectTemplatesStore.getState().load(projectId, target, baseline);
  }, [wanted, projectId, target, baseline, unread]);
  return { entry, target };
}
