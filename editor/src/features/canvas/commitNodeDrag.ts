import { findDocumentByKey } from "@/domain/documents";
import type { ProjectId } from "@/domain/types";
import { systemDocuments } from "@/lib/systemDocuments";
import { useModulesStore } from "@/state/modulesStore";
import { useProjectTemplatesStore } from "@/state/projectTemplatesStore";
import { useProjectsStore } from "@/state/projectsStore";
import type Konva from "konva";
import { projectBoard } from "./autoLayout";
import { folderAt } from "./folderFilter";

/**
 * Ends the drag of a Document's node (`nodeId`: its `docKey`). Dropped on the frame of
 * another folder, it is filed there and laid out inside that frame; anywhere else it
 * stays where it was put, in its own folder (whose frame grows to keep it). A module's
 * system element never changes folder.
 */
export function commitNodeDrag(projectId: ProjectId, nodeId: string, node: Konva.Node): void {
  const store = useProjectsStore.getState();
  const project = store.openProjects.projects.find((p) => p.id === projectId);
  const stage = node.getStage();
  // Only the board draws frames (its `groups` layer); the focus view has none to drop on.
  const at = stage?.findOne(".groups") ? stage.getRelativePointerPosition() : null;
  const target = project && at ? folderAt(projectBoard(project).groups, at) : undefined;
  if (project && target) {
    const current = findDocumentByKey(project, nodeId)?.doc.folder?.split("/")[0];
    const origins = useProjectTemplatesStore.getState().entries[project.id]?.origins;
    const system =
      !!origins && systemDocuments(project, useModulesStore.getState().active, origins).has(nodeId);
    if (target !== current && !system) {
      store.moveToFolder({ projectId, nodeIds: [nodeId], folder: target });
      return;
    }
  }
  store.setCanvasPosition({ projectId, nodeId, x: node.x(), y: node.y() });
}
