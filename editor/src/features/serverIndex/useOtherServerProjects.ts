import { projectNamespace } from "@/domain/docRef";
import type { Project } from "@/domain/types";
import { useProjectsStore } from "@/state/projectsStore";
import { useMemo } from "react";
import { useServerIndexStore } from "./serverIndexStore";

/**
 * The server's other projects (published state, server index), without the
 * edited project: that one is read live from the projects store, never twice.
 */
export function useOtherServerProjects(projectId: string): Project[] {
  const namespace = useProjectsStore((s) => {
    const edited = s.openProjects.projects.find((p) => p.id === projectId);
    return edited ? projectNamespace(edited) : projectId;
  });
  const projects = useServerIndexStore((s) => s.projects);
  return useMemo(
    () => projects.filter((p) => projectNamespace(p) !== namespace),
    [projects, namespace],
  );
}
