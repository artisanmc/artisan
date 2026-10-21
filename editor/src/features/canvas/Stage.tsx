import { liveDocumentIds } from "@/domain/canvasGroups";
import type { ElementId, MenuId, ProjectId } from "@/domain/types";
import { useCssVar } from "@/lib/themeColors";
import { useEdgeSelectionStore } from "@/state/edgeSelectionStore";
import { useProjectsStore } from "@/state/projectsStore";
import { useUiStore } from "@/state/uiStore";
import Konva from "konva";
import { useCallback, useRef, useState } from "react";

// Only the primary (left) button drags Konva nodes / the stage. This frees the
// middle button for panning (handled manually via useMiddleClickPan) without it
// accidentally starting a node drag when pressed over a menu.
Konva.dragButtons = [0];
import { CORE_DOCUMENT_KINDS } from "@/domain/documentKinds";
import { allDocuments, commandsOf, dialogsOf, menusOf } from "@/domain/documents";
import { dismissInspector } from "@/features/project/projectSettings";
import { useTranslation } from "react-i18next";
import { Stage as KonvaStage, Layer, Text } from "react-konva";
import { toast } from "sonner";
import { AlignmentGuides } from "./AlignmentGuidesOverlay";
import { ArmedBanner } from "./ArmedBanner";
import {
  BoardChrome,
  BoardCreationDialogs,
  BoardGroupsLayer,
  useBoardCreation,
} from "./BoardChrome";
import type { GroupDialogState } from "./BoardGroupControls";
import { CanvasToolbar } from "./CanvasToolbar";
import { CommandGroup } from "./CommandGroup";
import { DialogGroup } from "./DialogGroup";
import { DocumentGroup } from "./DocumentGroup";
import { DocumentItemTooltip } from "./DocumentItemTooltip";
import { EdgeTooltip } from "./EdgeTooltip";
import { Edges } from "./Edges";
import { GhostChips } from "./GhostChips";
import { ItemTooltip } from "./ItemTooltip";
import { MarqueeRect } from "./MarqueeRect";
import { MenuGroup } from "./MenuGroup";
import { ModuleCommandGroup } from "./ModuleCommandGroup";
import { Selection } from "./Selection";
import { StageContextMenu } from "./StageContextMenu";
import { dispatchOpenElement } from "./canvasEvents";
import { activeBoardFolder } from "./folderFilter";
import { hitTestSlot, screenToWorld } from "./hitTest";
import { useCanvasKeyboard } from "./useCanvasKeyboard";
import { useFolderFraming } from "./useFolderFraming";
import { useHeldPanKeys } from "./useHeldPanKeys";
import { useMarqueeSelection } from "./useMarqueeSelection";
import { useMiddleClickPan } from "./useMiddleClickPan";
import { useModuleCommands } from "./useModuleCommands";
import { usePrimaryButtonOnly } from "./usePrimaryButtonOnly";
import { useStageBoard } from "./useStageBoard";
import { useStageContextMenu } from "./useStageContextMenu";
import { useStageDropTargets } from "./useStageDropTargets";
import { useElementSize, useStageFraming } from "./useStageFraming";
import { useStageTouch } from "./useStageTouch";

const CORE_KINDS = new Set(CORE_DOCUMENT_KINDS.map((k) => k.kind));

interface StageProps {
  projectId: ProjectId;
  /**
   * Focus view: the stage only shows this Document, whatever its board
   * membership. All the remaining chrome (edges, chips, selection, item drop,
   * keyboard) is the board's — one implementation, two framings. What only the
   * board has lives in `BoardChrome`.
   */
  focus?: ElementId;
}

export function Stage({ projectId, focus }: StageProps) {
  return (
    <StageCanvas
      key={`${projectId}:${focus ? "focus" : "board"}`}
      projectId={projectId}
      focus={focus}
    />
  );
}

function StageCanvas({ projectId, focus }: StageProps) {
  const focusMode = focus != null;
  const { t } = useTranslation();
  const project = useProjectsStore((s) => s.openProjects.projects.find((p) => p.id === projectId));
  // The board also draws the commands the folder's module declares: `boardProject` is
  // what it reads, `project` what is edited and saved.
  const { nodes: moduleCommands, boardProject } = useModuleCommands(project);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const size = useElementSize(wrapperRef);
  const folder = activeBoardFolder(
    project,
    useUiStore((s) => s.boardFolders[projectId]),
  );
  const { board, layout, setGroupDrag } = useStageBoard(
    boardProject,
    focus,
    focusMode ? undefined : folder,
  );
  const {
    viewport,
    setViewport,
    onWheel,
    onTouchMove,
    onTouchEnd,
    markTouched,
    syncViewportFromStage,
    refitFocus,
  } = useStageFraming({ projectId, focus, project: boardProject, layout, size, stageRef });
  useFolderFraming({ folder, project, layout, size, setViewport });
  const canvasMode = useUiStore((s) => s.canvasMode);
  const { spaceHeld, altHeld } = useHeldPanKeys();
  const panMode = canvasMode === "hand" || spaceHeld || altHeld;
  // True while a stage-drag pan is in progress (hand/Space/Alt left-drag) — so
  // the cursor can switch from open hand (grab) to closed hand (grabbing).
  const [stageDragging, setStageDragging] = useState(false);
  // Pan cursor only over EMPTY canvas: entities (menus/slots/commands…) keep
  // their own affordances — the grab hand over an item read as incoherent.
  const [overEmpty, setOverEmpty] = useState(true);

  const gutterColor = useCssVar("--text-mut");
  const [groupDialog, setGroupDialog] = useState<GroupDialogState>(null);
  const creation = useBoardCreation();

  const marquee = useMarqueeSelection({
    stageRef,
    viewport,
    project,
    layout,
    active: canvasMode === "select" && !spaceHeld && !altHeld,
  });

  // Middle-button pans regardless of mode/target (document capture listener).
  const middlePan = useMiddleClickPan({ containerRef: wrapperRef, viewport, setViewport });
  usePrimaryButtonOnly(wrapperRef);

  // Empty-stage click clears selection. Konva fires `click` on the Stage when
  // the user clicks an area not occupied by any listening child.
  // Also: if a material is "armed" from the Library (touch placement flow),
  // a click on a slot places it. Hit-test in world coords.
  // suppressClick: if a marquee drag just completed, the follow-up stage click
  // must not clear the selection the marquee just made.
  const onStageClick = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
      const armed = useUiStore.getState().armedMaterial;
      if (armed && project) {
        const stage = e.target.getStage();
        const pointer = stage?.getPointerPosition();
        if (pointer) {
          const world = screenToWorld(pointer, viewport);
          const hit = hitTestSlot(project, layout, world.x, world.y);
          if (hit) {
            try {
              useProjectsStore.getState().setSlotMaterial({
                projectId,
                menuId: hit.menuId as MenuId,
                position: hit.position,
                material: armed,
              });
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "place failed");
            }
            return;
          }
        }
      }
      // Click (not drag) on empty space clears the selection — in every mode,
      // including hand/space/alt pan (a real pan fires dragend, not click, so it
      // won't clear). suppressed = a marquee drag just finished.
      const suppressed = marquee.shouldConsumeClick();
      if (!suppressed && e.target === e.target.getStage()) {
        // Clicking the background means "I'm done": it clears the selection AND
        // closes the project settings, which are not a selection.
        dismissInspector();
        useEdgeSelectionStore.getState().select(null);
        useUiStore.getState().setSelectedLayerKey(null);
      }
    },
    [project, layout, viewport, projectId, marquee.shouldConsumeClick],
  );

  const { ctxMenu, openContextMenuAt, onStageContextMenu, closeCtxMenu } = useStageContextMenu({
    project,
    layout,
    viewport,
    wrapperRef,
    stageRef,
  });

  const {
    onTouchStart: onStageTouchStart,
    onTouchMoveLocal: onStageTouchMove,
    onTouchEndLocal: onStageTouchEnd,
  } = useStageTouch({
    openContextMenuAt,
    onTouchMove,
    onTouchEnd,
  });

  const { getPasteAnchor, onWrapperMouseMove, onWrapperMouseLeave } = useStageDropTargets({
    wrapperRef,
    projectId,
    project,
    layout,
    viewport,
  });

  useCanvasKeyboard({
    projectId,
    onError: (msg) => toast.error(msg),
    getPasteAnchor,
  });

  if (!project) return <div className="p-8 text-[var(--text-mut)]">Project not found.</div>;

  const entityIds = ctxMenu.target.kind === "entity" ? ctxMenu.target.selectedIds : [];
  const groupableIds = new Set(liveDocumentIds(project));

  return (
    <div
      ref={wrapperRef}
      className="stage-bg-dots relative h-full w-full"
      style={{
        cursor:
          middlePan.panning || stageDragging
            ? "grabbing"
            : panMode && overEmpty
              ? "grab"
              : "default",
      }}
      onMouseMove={onWrapperMouseMove}
      onMouseLeave={() => {
        setOverEmpty(true);
        onWrapperMouseLeave();
      }}
    >
      <div aria-hidden className="stage-bg-glow pointer-events-none absolute inset-0" />
      <ArmedBanner />
      {!focusMode && (
        <BoardChrome
          project={project}
          board={board}
          layout={layout}
          size={size}
          viewport={viewport}
          onNavigate={setViewport}
          groupDialog={groupDialog}
          onGroupDialogChange={setGroupDialog}
          onCreateAt={creation.createAt}
          folder={folder}
        />
      )}
      <CanvasToolbar
        onRearrange={
          focusMode
            ? undefined
            : (mode) => useProjectsStore.getState().releaseBoardPositions({ projectId, mode })
        }
        rearrangeDisabled={
          !project ||
          (Object.keys(project.canvasLayout).length === 0 &&
            Object.keys(project.canvasEdges ?? {}).length === 0 &&
            !Object.values(project.folders ?? {}).some((f) => f.position))
        }
      />
      <KonvaStage
        ref={stageRef}
        width={size.w}
        height={size.h}
        x={viewport.x}
        y={viewport.y}
        scaleX={viewport.scale}
        scaleY={viewport.scale}
        draggable={panMode}
        onWheel={(e) => {
          markTouched();
          onWheel(e);
        }}
        onClick={onStageClick}
        onDblClick={(e) => {
          // Focus escape hatch: double-clicking the background reframes.
          if (e.target === e.target.getStage()) refitFocus();
        }}
        onTap={onStageClick}
        onMouseDown={marquee.onMouseDown}
        onMouseMove={(e) => {
          setOverEmpty(e.target === e.target.getStage());
          marquee.onMouseMove();
        }}
        onMouseUp={marquee.onMouseUp}
        onContextMenu={onStageContextMenu}
        onTouchStart={onStageTouchStart}
        onTouchMove={(e) => {
          markTouched();
          onStageTouchMove(e);
        }}
        onTouchEnd={onStageTouchEnd}
        onDragStart={(e) => {
          if (e.target === e.target.getStage()) setStageDragging(true);
        }}
        onDragMove={(e) => {
          // Only sync when the drag target is the Stage itself (not a
          // child Group like a menu or a slot, which fire dragmove too).
          if (e.target === e.target.getStage()) syncViewportFromStage();
        }}
        onDragEnd={(e) => {
          if (e.target === e.target.getStage()) {
            syncViewportFromStage();
            setStageDragging(false);
          }
        }}
      >
        {!focusMode && (
          <BoardGroupsLayer
            projectId={projectId}
            board={board}
            onManage={setGroupDialog}
            onDrag={setGroupDrag}
          />
        )}
        <Layer name="edges">
          <Edges
            project={boardProject ?? project}
            layout={layout}
            representatives={board?.representatives}
          />
          {board?.gutter && (
            <Text
              x={board.gutter.x}
              y={board.gutter.y}
              text={t("canvas.gutter")}
              fontSize={14}
              fill={gutterColor}
              listening={false}
            />
          )}
        </Layer>
        <Layer name="menus" imageSmoothingEnabled={false}>
          {menusOf(project)
            .filter((menu) => layout[menu.id])
            .map((menu) => (
              <MenuGroup
                key={menu.id}
                projectId={projectId}
                menu={menu}
                position={layout[menu.id]!}
                layout={layout}
                solo={focusMode}
              />
            ))}
        </Layer>
        {/* Commands and dialogs render above the menus layer so they always
            take click priority, even after a menu calls moveToTop() during drag. */}
        <Layer name="commands" imageSmoothingEnabled={false}>
          {commandsOf(project)
            .filter((command) => layout[command.id])
            .map((command) => (
              <CommandGroup
                key={command.id}
                projectId={projectId}
                command={command}
                position={layout[command.id]!}
              />
            ))}
          {moduleCommands
            .filter((node) => layout[node.id])
            .map((node) => (
              <ModuleCommandGroup
                key={node.id}
                projectId={projectId}
                node={node}
                position={layout[node.id]!}
              />
            ))}
          {dialogsOf(project)
            .filter((dialog) => layout[dialog.id])
            .map((dialog) => (
              <DialogGroup
                key={dialog.id}
                projectId={projectId}
                dialog={dialog}
                position={layout[dialog.id]!}
              />
            ))}
          {allDocuments(project)
            .filter(({ kind, doc }) => !CORE_KINDS.has(kind) && layout[doc.id])
            .map(({ kind, doc }) => (
              <DocumentGroup
                key={doc.id}
                project={project}
                kind={kind}
                doc={doc}
                position={layout[doc.id]!}
                solo={focusMode}
              />
            ))}
          <GhostChips
            project={boardProject ?? project}
            layout={layout}
            representatives={board?.representatives}
            // In focus, every link of the Document is off-board: the chip becomes the
            // way to move from Document to Document, instead of populating a board
            // nobody is looking at.
            onOpen={focusMode ? dispatchOpenElement : undefined}
          />
        </Layer>
        <Layer name="overlay">
          <Selection stageRef={stageRef} />
          <MarqueeRect rect={marquee.rect} />
          <AlignmentGuides />
        </Layer>
      </KonvaStage>
      <ItemTooltip projectId={projectId} />
      <DocumentItemTooltip />
      <EdgeTooltip project={boardProject ?? project} groups={board?.groups} />
      <StageContextMenu
        projectId={projectId}
        state={ctxMenu}
        onClose={closeCtxMenu}
        onGroup={
          !focusMode && entityIds.length >= 2 && entityIds.every((id) => groupableIds.has(id))
            ? (nodeIds) => setGroupDialog({ nodeIds })
            : undefined
        }
        // Creating "here" sets a board position: without a board the entry makes
        // no sense and disappears from the context menu.
        onCreateAt={focusMode ? undefined : creation.createAt}
      />
      {!focusMode && <BoardCreationDialogs projectId={projectId} creation={creation} />}
    </div>
  );
}
