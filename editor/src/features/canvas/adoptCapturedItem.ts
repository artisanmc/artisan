import type { CapturedItem, ProjectId } from "@/domain/types";
import { useProjectsStore } from "@/state/projectsStore";

/**
 * The `item:<id>` ref of another project's captured item, in `projectId`. The
 * item is copied in on first use and keeps its id (already unique); an item
 * already there, by id or by identical stack, is reused as it is. The copy is a
 * snapshot: changing the original later changes nothing here.
 */
export function adoptCapturedItem(projectId: ProjectId, item: CapturedItem): string {
  const project = useProjectsStore
    .getState()
    .openProjects.projects.find((entry) => entry.id === projectId);
  const here = project?.capturedItems ?? [];
  const same =
    here.find((entry) => entry.id === item.id) ??
    here.find((entry) => entry.stackYaml === item.stackYaml);
  if (same) return `item:${same.id}`;
  useProjectsStore.getState().addCapturedItem({ projectId, item: structuredClone(item) });
  return `item:${item.id}`;
}
