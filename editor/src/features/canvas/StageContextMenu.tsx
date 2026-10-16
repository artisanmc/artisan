import type { MenuId, ProjectId } from "@/domain/types";
import { openProjectSettings } from "@/features/project/projectSettings";
import { useProjectsStore } from "@/state/projectsStore";
import { useSelectionStore } from "@/state/selectionStore";
import type { ComponentProps } from "react";
import { toast } from "sonner";
import type { CreatableKind } from "./BoardChrome";
import { ContextMenu } from "./ContextMenu";
import { canvasClipboardActions } from "./useCanvasKeyboard";

type Point = { x: number; y: number };

/**
 * The stage's right-click menu wired to the canvas commands (clipboard,
 * delete, move, group). `onGroup` / `onCreateAt` are absent in focus view:
 * grouping and creating "here" need a board.
 */
export function StageContextMenu({
  projectId,
  state,
  onClose,
  onGroup,
  onCreateAt,
}: {
  projectId: ProjectId;
  state: ComponentProps<typeof ContextMenu>["state"];
  onClose: () => void;
  /** Called with the selected Documents when they can be grouped. */
  onGroup?: (ids: string[]) => void;
  onCreateAt?: (kind: CreatableKind, world: Point) => void;
}) {
  const entityIds = state.target.kind === "entity" ? state.target.selectedIds : [];
  const onError = (m: string) => toast.error(m);
  const createAt = (kind: CreatableKind) =>
    onCreateAt
      ? (world: Point) => {
          onClose();
          onCreateAt(kind, world);
        }
      : undefined;
  return (
    <ContextMenu
      projectId={projectId}
      state={state}
      onClose={onClose}
      onCopy={() => {
        void canvasClipboardActions.copySelection(projectId, entityIds, onError);
        onClose();
      }}
      onPaste={() => {
        void canvasClipboardActions.pasteFromClipboard(projectId, onError);
        onClose();
      }}
      onPasteAt={(anchor) => {
        void canvasClipboardActions.pasteFromClipboard(projectId, onError, anchor);
        onClose();
      }}
      onDuplicate={() => {
        canvasClipboardActions.duplicateSelection(projectId, entityIds, onError);
        onClose();
      }}
      onDelete={() => {
        if (entityIds.length === 0) return;
        try {
          canvasClipboardActions.deleteSelection(projectId, entityIds);
          useSelectionStore.getState().clear();
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "delete failed");
        }
        onClose();
      }}
      onOpenProjectSettings={() => {
        onClose();
        openProjectSettings();
      }}
      onGroup={
        onGroup
          ? () => {
              onGroup(entityIds);
              onClose();
            }
          : undefined
      }
      onMoveTo={(toProjectId) => {
        if (entityIds.length !== 1) return;
        try {
          useProjectsStore.getState().moveMenuToProject({
            menuId: entityIds[0]! as MenuId,
            fromProjectId: projectId,
            toProjectId,
          });
          toast.success(`Moved to ${toProjectId}`);
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "move failed");
        }
        onClose();
      }}
      onCreateMenuAt={createAt("menu")}
      onCreateCommandAt={createAt("command")}
      onCreateDialogAt={createAt("dialog")}
    />
  );
}
