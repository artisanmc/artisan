/**
 * What only the board has, around the stage it shares with the focus view
 * (`Stage`): the empty state, the group controls and frames, the minimap, and
 * creating a Document "here". The focus view mounts none of it.
 */
import { EmptyState } from "@/components/ui/empty-state";
import type { Project, ProjectId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useUiStore } from "@/state/uiStore";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Layer } from "react-konva";
import { BoardGroupControls, type GroupDialogState } from "./BoardGroupControls";
import { BoardGroupFrames, type GroupDrag } from "./BoardGroupFrames";
import { CanvasMinimap } from "./CanvasMinimap";
import { NewCommandDialog } from "./NewCommandDialog";
import { NewDialogDialog } from "./NewDialogDialog";
import { NewMenuDialog } from "./NewMenuDialog";
import type { ProjectBoard } from "./autoLayout";
import { nodeBox } from "./menuLayout";
import type { ViewportState } from "./usePanZoom";

type Point = { x: number; y: number };
export type CreatableKind = "menu" | "command" | "dialog";

/** The board position a new Document of each core kind is about to take. */
export function useBoardCreation() {
  const [pending, setPending] = useState<{ kind: CreatableKind; at: Point } | null>(null);
  return {
    pending,
    createAt: (kind: CreatableKind, at: Point) => setPending({ kind, at }),
    close: () => setPending(null),
  };
}

export function BoardCreationDialogs({
  projectId,
  creation,
}: {
  projectId: ProjectId;
  creation: ReturnType<typeof useBoardCreation>;
}) {
  const { pending, close } = creation;
  const props = (kind: CreatableKind) => ({
    projectId,
    open: pending?.kind === kind,
    position: pending?.kind === kind ? pending.at : undefined,
    onOpenChange: (o: boolean) => {
      if (!o && pending?.kind === kind) close();
    },
  });
  return (
    <>
      <NewMenuDialog {...props("menu")} />
      <NewCommandDialog {...props("command")} />
      <NewDialogDialog {...props("dialog")} />
    </>
  );
}

/** The board's DOM overlays: the empty state, the group controls and the minimap. */
export function BoardChrome({
  project,
  board,
  layout,
  size,
  viewport,
  onNavigate,
  groupDialog,
  onGroupDialogChange,
  onCreateAt,
}: {
  project: Project;
  board: ProjectBoard | null;
  layout: Record<string, Point>;
  size: { w: number; h: number };
  viewport: ViewportState;
  onNavigate: (viewport: ViewportState) => void;
  groupDialog: GroupDialogState;
  onGroupDialogChange: (dialog: GroupDialogState) => void;
  onCreateAt: (kind: CreatableKind, at: Point) => void;
}) {
  const { t } = useTranslation();
  const minimapVisible = useUiStore((s) => s.minimapVisible);
  const origin = { x: 40, y: 40 };
  return (
    <>
      {Object.keys(layout).length === 0 && !board?.groups?.length && (
        // pointer-events-none lets right-click / drag fall through to the Konva
        // stage below (so the create context-menu still works); only the action
        // buttons opt back into pointer events.
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <EmptyState
            title={t("projectPanel.empty")}
            action={
              <div className="pointer-events-auto flex flex-wrap items-center justify-center gap-2">
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => onCreateAt("menu", origin)}
                >
                  {t("canvas.newMenu")}
                </button>
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={() => onCreateAt("command", origin)}
                >
                  {t("canvas.newCommand")}
                </button>
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={() => onCreateAt("dialog", origin)}
                >
                  {t("canvas.newDialog")}
                </button>
              </div>
            }
          />
        </div>
      )}
      <BoardGroupControls
        project={project}
        dialog={groupDialog}
        onDialogChange={onGroupDialogChange}
      />
      {minimapVisible && size.w > 0 && size.h > 0 && (
        <CanvasMinimap
          boxes={[
            ...Object.keys(layout).flatMap((id) => {
              const box = nodeBox(project, id, layout);
              return box ? [{ ...box, id }] : [];
            }),
          ]}
          size={size}
          viewport={viewport}
          onNavigate={onNavigate}
        />
      )}
    </>
  );
}

/** The manual group frames, under every other layer. */
export function BoardGroupsLayer({
  projectId,
  board,
  onManage,
  onDrag,
}: {
  projectId: ProjectId;
  board: ProjectBoard | null;
  onManage: (dialog: GroupDialogState) => void;
  onDrag: (drag: GroupDrag | null) => void;
}) {
  return (
    <Layer name="groups">
      <BoardGroupFrames
        groups={board?.groups ?? []}
        onManage={(group) => {
          if (group.kind === "group") onManage({ groupId: group.id });
        }}
        onDrag={onDrag}
        onMove={(group, dx, dy) =>
          useAccountStore.getState().moveCanvasGroup({
            projectId,
            groupId: group.kind === "project" ? null : group.id,
            dx,
            dy,
          })
        }
      />
    </Layer>
  );
}
