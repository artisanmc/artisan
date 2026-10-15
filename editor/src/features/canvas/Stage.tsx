import { EmptyState } from "@/components/ui/empty-state";
import { liveDocumentIds } from "@/domain/canvasGroups";
import type { ElementId, MenuId, ProjectId } from "@/domain/types";
import { useCssVar } from "@/lib/themeColors";
import { useAccountStore } from "@/state/accountStore";
import { useEdgeSelectionStore } from "@/state/edgeSelectionStore";
import { useHoverStore } from "@/state/hoverStore";
import { useSelectionStore } from "@/state/selectionStore";
import { useUiStore } from "@/state/uiStore";
import Konva from "konva";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// Only the primary (left) button drags Konva nodes / the stage. This frees the
// middle button for panning (handled manually via useMiddleClickPan) without it
// accidentally starting a node drag when pressed over a menu.
Konva.dragButtons = [0];
import { useTranslation } from "react-i18next";
import { Stage as KonvaStage, Layer, Text } from "react-konva";
import { toast } from "sonner";
import { AlignmentGuides } from "./AlignmentGuidesOverlay";
import { ArmedBanner } from "./ArmedBanner";
import { CanvasToolbar } from "./CanvasToolbar";
import { BoardGroupControls, type GroupDialogState } from "./BoardGroupControls";
import { BoardGroupFrames, type GroupDrag } from "./BoardGroupFrames";
import { CanvasMinimap } from "./CanvasMinimap";
import { CommandGroup } from "./CommandGroup";
import { ContextMenu } from "./ContextMenu";
import { DialogGroup } from "./DialogGroup";
import { EdgeTooltip } from "./EdgeTooltip";
import { Edges } from "./Edges";
import { GhostChips } from "./GhostChips";
import { ItemTooltip } from "./ItemTooltip";
import { MarqueeRect } from "./MarqueeRect";
import { MenuGroup } from "./MenuGroup";
import { NewCommandDialog } from "./NewCommandDialog";
import { NewDialogDialog } from "./NewDialogDialog";
import { NewMenuDialog } from "./NewMenuDialog";
import { Selection } from "./Selection";
import { projectBoard } from "./autoLayout";
import { dismissInspector, openProjectSettings } from "@/features/project/projectSettings";
import { dispatchOpenElement } from "./canvasEvents";
import { viewportForCenterRequest } from "./centerRequest";
import { fitViewport } from "./focusViewport";
import { hitTestSlot, screenToWorld } from "./hitTest";
import { menuBoxSize, nodeBox } from "./menuLayout";
import { setStageDropTarget, setStageSlotHitTest } from "./stageDropTarget";
import { setStageGeometryProvider } from "./stageGeometry";
import { type PasteAnchor, canvasClipboardActions, useCanvasKeyboard } from "./useCanvasKeyboard";
import { useMarqueeSelection } from "./useMarqueeSelection";
import { useMiddleClickPan } from "./useMiddleClickPan";
import { usePrimaryButtonOnly } from "./usePrimaryButtonOnly";
import { usePanZoom } from "./usePanZoom";
import { useStageContextMenu } from "./useStageContextMenu";
import { useStageTouch } from "./useStageTouch";
import { commandsOf, dialogsOf, menusOf } from "@/domain/documents";

interface StageProps {
  projectId: ProjectId;
  /**
   * Focus view: the stage only shows this Document, whatever its board
   * membership. All the remaining chrome (edges, chips, selection, item drop,
   * keyboard) is the board's — one implementation, two framings.
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
  const project = useAccountStore((s) => s.account.projects.find((p) => p.id === projectId));
  const wrapperRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  // Restore the saved pan/zoom for this project so leaving the board and
  // returning lands on the same spot + zoom. Read once at mount (non-reactive);
  // persisted back via the effect below.
  // Focus has its own framing, shared by every Document (moving from one to
  // another keeps the view where the user put it) and persisted; the board
  // keeps its own, persisted per project.
  const savedFocusViewport = useUiStore.getState().documentViewport;
  const { viewport, setViewport, onWheel, onTouchMove, onTouchEnd } = usePanZoom(
    focusMode
      ? (savedFocusViewport ?? { x: 0, y: 0, scale: 1 })
      : useUiStore.getState().canvasViewports[projectId],
  );
  // In focus, the view is framed on open and then stops fighting the user:
  // once they have navigated, it stays where they put it.
  const touchedRef = useRef(!focusMode || savedFocusViewport !== null);
  const markTouched = useCallback(() => {
    touchedRef.current = true;
  }, []);
  const canvasMode = useUiStore((s) => s.canvasMode);
  const minimapVisible = useUiStore((s) => s.minimapVisible);
  const [spaceHeld, setSpaceHeld] = useState(false);
  // Alt held = temporary pan (like Space), so you can navigate without leaving
  // select mode. Alt during a *node* drag still means "free move / no snap"
  // (useNodeAlignment) — different target, no conflict.
  const [altHeld, setAltHeld] = useState(false);
  useEffect(() => {
    const isEditable = (el: EventTarget | null) => {
      const n = el as HTMLElement | null;
      const tag = n?.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || !!n?.isContentEditable;
    };
    const down = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.code === "Space" && !isEditable(e.target)) {
        e.preventDefault();
        setSpaceHeld(true);
      }
      if (e.key === "Alt" && !isEditable(e.target)) {
        e.preventDefault();
        setAltHeld(true);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpaceHeld(false);
      if (e.key === "Alt") setAltHeld(false);
    };
    const onBlur = () => {
      setSpaceHeld(false);
      setAltHeld(false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", onBlur);
    };
  }, []);
  const panMode = canvasMode === "hand" || spaceHeld || altHeld;
  // True while a stage-drag pan is in progress (hand/Space/Alt left-drag) — so
  // the cursor can switch from open hand (grab) to closed hand (grabbing).
  const [stageDragging, setStageDragging] = useState(false);
  // Pan cursor only over EMPTY canvas: entities (menus/slots/commands…) keep
  // their own affordances — the grab hand over an item read as incoherent.
  const [overEmpty, setOverEmpty] = useState(true);

  // Konva's native stage-drag (single-finger pan) mutates the stage's x/y
  // directly without going through React. Without this sync, the next
  // re-render snaps the canvas back to the stale `viewport` prop, which
  // also drifts every DOM overlay (TextEditor, ArmedBanner) and every
  // pointer-to-world conversion (tap-to-place).
  const syncViewportFromStage = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    markTouched();
    setViewport({ x: stage.x(), y: stage.y(), scale: stage.scaleX() });
  }, [setViewport, markTouched]);

  useEffect(() => {
    if (!wrapperRef.current) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setSize({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    ro.observe(wrapperRef.current);
    return () => ro.disconnect();
  }, []);

  // Persist pan/zoom per project so it survives leaving/returning to the board.
  useEffect(() => {
    if (focusMode) {
      if (touchedRef.current) useUiStore.getState().setDocumentViewport(viewport);
      return;
    }
    useUiStore.getState().setCanvasViewport(projectId, viewport);
  }, [projectId, viewport, focusMode]);

  /**
   * The whole board / focus difference lives here. The board shows every
   * Document, arranged (`projectBoard`), `canvasLayout` keeping only the
   * positions set by hand; focus builds a synthetic board of a single Document
   * placed at the origin. Everything that follows — edges, off-board chips,
   * marquee, hit-test, drop — consumes this table and follows unknowingly.
   */
  const gutterColor = useCssVar("--text-mut");
  const [groupDialog, setGroupDialog] = useState<GroupDialogState>(null);
  const [groupDrag, setGroupDrag] = useState<GroupDrag | null>(null);
  const baseBoard = useMemo(() => {
    if (focus || !project) return null;
    const arrangement = projectBoard(project);
    return { ...arrangement, groups: arrangement.groups.filter((group) => group.kind === "group") };
  }, [project, focus]);
  const board = useMemo(() => {
    if (!baseBoard || !groupDrag) return baseBoard;
    const group = baseBoard.groups.find((g) => g.key === groupDrag.key);
    if (!group) return baseBoard;
    const members = new Set(group.members);
    const shift = (p: { x: number; y: number }) => ({
      x: p.x + groupDrag.dx,
      y: p.y + groupDrag.dy,
    });
    return {
      ...baseBoard,
      layout: Object.fromEntries(
        Object.entries(baseBoard.layout).map(([id, p]) => [id, members.has(id) ? shift(p) : p]),
      ),
      groups: baseBoard.groups.map((g) =>
        group.kind === "project" || g.key === group.key ? { ...g, ...shift(g) } : g,
      ),
    };
  }, [baseBoard, groupDrag]);
  const layout = useMemo(
    () => (focus ? { [focus]: { x: 0, y: 0 } } : (board?.layout ?? {})),
    [board, focus],
  );

  // Initial framing of the focused Document: centred, shrunk only if it does
  // not fit — never enlarged.
  const focusBox = useMemo(() => {
    if (!focus) return null;
    // `focus` is a Document id (the umbrella); `menu.id` is a MenuId. Nominal
    // brands do not overlap, so the comparison is textual.
    const menu = menusOf(project).find((m) => (m.id as string) === (focus as string));
    return menu ? menuBoxSize(menu.inventoryType ?? "chest", menu.rows) : null;
  }, [project, focus]);
  useEffect(() => {
    if (touchedRef.current || size.w === 0 || !focusBox) return;
    setViewport(fitViewport(size, focusBox));
  }, [size, focusBox, setViewport]);

  // `goToDocument`: centre the board on a Document. The request waits for the
  // board to have a size and the Document to be placed, then is consumed.
  const centerRequest = useUiStore((s) => s.centerRequest);
  useEffect(() => {
    if (focusMode || !centerRequest) return;
    const centred = viewportForCenterRequest(centerRequest, projectId, project, layout, size);
    if (!centred) return;
    setViewport(centred);
    useUiStore.getState().clearCenterRequest(centerRequest.nonce);
  }, [centerRequest, focusMode, projectId, project, layout, size, setViewport]);

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
              useAccountStore.getState().setSlotMaterial({
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

  const [pendingMenuPos, setPendingMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [pendingCommandPos, setPendingCommandPos] = useState<{ x: number; y: number } | null>(null);
  const [pendingDialogPos, setPendingDialogPos] = useState<{ x: number; y: number } | null>(null);

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

  // Cross-platform Library drop: the top-level DndContext (in the project
  // route) calls this with the release coords + material. We hit-test the
  // slot and place. Returns true if placed, so the route can decide
  // whether to do anything else.
  useEffect(() => {
    setStageDropTarget((clientX, clientY, material) => {
      const wrapper = wrapperRef.current;
      if (!wrapper || !project) return false;
      const rect = wrapper.getBoundingClientRect();
      if (
        clientX < rect.left ||
        clientX > rect.right ||
        clientY < rect.top ||
        clientY > rect.bottom
      ) {
        return false;
      }
      const stagePoint = { x: clientX - rect.left, y: clientY - rect.top };
      const world = screenToWorld(stagePoint, viewport);
      const hit = hitTestSlot(project, layout, world.x, world.y);
      if (!hit) return false;
      try {
        useAccountStore.getState().setSlotMaterial({
          projectId,
          menuId: hit.menuId as MenuId,
          position: hit.position,
          material,
        });
        return true;
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "place failed");
        return false;
      }
    });
    return () => setStageDropTarget(null);
  }, [project, layout, viewport, projectId]);

  // Placement-mode row drops: resolve release coords to a menu/slot (the route's
  // onDragEnd pins the row). Same wrapper-rect → world → hit-test as above.
  useEffect(() => {
    setStageSlotHitTest((clientX, clientY) => {
      const wrapper = wrapperRef.current;
      if (!wrapper || !project) return null;
      const rect = wrapper.getBoundingClientRect();
      if (
        clientX < rect.left ||
        clientX > rect.right ||
        clientY < rect.top ||
        clientY > rect.bottom
      ) {
        return null;
      }
      const stagePoint = { x: clientX - rect.left, y: clientY - rect.top };
      const world = screenToWorld(stagePoint, viewport);
      return hitTestSlot(project, layout, world.x, world.y);
    });
    return () => setStageSlotHitTest(null);
  }, [project, layout, viewport]);

  // Expose the live wrapper rect + viewport so the LayersPanel can convert
  // drag-end client coords into canvas coords (cursor-based new-layer attach).
  // The provider reads refs at call time, so consumers always see the current
  // pan/scale + bounding box.
  useEffect(() => {
    setStageGeometryProvider(() => {
      const wrapper = wrapperRef.current;
      if (!wrapper) return null;
      const rect = wrapper.getBoundingClientRect();
      return {
        wrapperRect: {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
        },
        viewport,
      };
    });
    return () => setStageGeometryProvider(null);
  }, [viewport]);

  // Last cursor position over the canvas (null once it leaves): Ctrl+V pastes
  // items into the slot under it.
  const pointerRef = useRef<{ clientX: number; clientY: number } | null>(null);
  const getPasteAnchor = useCallback((): PasteAnchor | null => {
    const wrapper = wrapperRef.current;
    const pointer = pointerRef.current;
    if (!wrapper || !pointer || !project) return null;
    const rect = wrapper.getBoundingClientRect();
    const world = screenToWorld(
      { x: pointer.clientX - rect.left, y: pointer.clientY - rect.top },
      viewport,
    );
    const hit = hitTestSlot(project, layout, world.x, world.y);
    return hit ? { menuId: hit.menuId as MenuId, position: hit.position } : null;
  }, [project, layout, viewport]);

  useCanvasKeyboard({
    projectId,
    onError: (msg) => toast.error(msg),
    getPasteAnchor,
  });

  const onWrapperMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    pointerRef.current = { clientX: e.clientX, clientY: e.clientY };
    useHoverStore.getState().setCursor(e.clientX, e.clientY);
  }, []);

  const onWrapperMouseLeave = useCallback(() => {
    pointerRef.current = null;
    // Clear hover when the cursor leaves the canvas entirely (Konva
    // mouseleave on a slot doesn't fire if we exit the whole stage at speed).
    useHoverStore.getState().setElement(null);
  }, []);

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
      {!focusMode && Object.keys(layout).length === 0 && !board?.groups?.length && (
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
                  onClick={() => setPendingMenuPos({ x: 40, y: 40 })}
                >
                  {t("canvas.newMenu")}
                </button>
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={() => setPendingCommandPos({ x: 40, y: 40 })}
                >
                  {t("canvas.newCommand")}
                </button>
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={() => setPendingDialogPos({ x: 40, y: 40 })}
                >
                  {t("canvas.newDialog")}
                </button>
              </div>
            }
          />
        </div>
      )}
      <ArmedBanner />
      {!focusMode && (
        <BoardGroupControls
          project={project}
          dialog={groupDialog}
          onDialogChange={setGroupDialog}
        />
      )}
      <CanvasToolbar
        onRearrange={
          focusMode
            ? undefined
            : (mode) => useAccountStore.getState().releaseBoardPositions({ projectId, mode })
        }
        rearrangeDisabled={
          !project ||
          (Object.keys(project.canvasLayout).length === 0 &&
            Object.keys(project.canvasEdges ?? {}).length === 0 &&
            !project.canvasGroups?.some((g) => g.position))
        }
      />
      {!focusMode && minimapVisible && size.w > 0 && size.h > 0 && (
        <CanvasMinimap
          boxes={[
            ...Object.keys(layout).flatMap((id) => {
              const box = nodeBox(project, id, layout);
              return box ? [{ ...box, id }] : [];
            }),
          ]}
          size={size}
          viewport={viewport}
          onNavigate={setViewport}
        />
      )}
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
          if (!focusBox || e.target !== e.target.getStage()) return;
          const fitted = fitViewport(size, focusBox);
          touchedRef.current = false;
          setViewport(fitted);
          useUiStore.getState().setDocumentViewport(fitted);
          touchedRef.current = true;
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
          <Layer name="groups">
            <BoardGroupFrames
              groups={board?.groups ?? []}
              onManage={(group) => {
                if (group.kind === "group") setGroupDialog({ groupId: group.id });
              }}
              onDrag={setGroupDrag}
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
        )}
        <Layer name="edges">
          <Edges project={project} layout={layout} representatives={board?.representatives} />
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
          <GhostChips
            project={project}
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
      <EdgeTooltip project={project} groups={board?.groups} />
      <ContextMenu
        projectId={projectId}
        state={ctxMenu}
        onClose={closeCtxMenu}
        onCopy={() => {
          void canvasClipboardActions.copySelection(projectId, entityIds, (m) => toast.error(m));
          closeCtxMenu();
        }}
        onPaste={() => {
          void canvasClipboardActions.pasteFromClipboard(projectId, (m) => toast.error(m));
          closeCtxMenu();
        }}
        onPasteAt={(anchor) => {
          void canvasClipboardActions.pasteFromClipboard(projectId, (m) => toast.error(m), anchor);
          closeCtxMenu();
        }}
        onDuplicate={() => {
          canvasClipboardActions.duplicateSelection(projectId, entityIds, (m) => toast.error(m));
          closeCtxMenu();
        }}
        onDelete={() => {
          if (entityIds.length === 0) return;
          try {
            canvasClipboardActions.deleteSelection(projectId, entityIds);
            useSelectionStore.getState().clear();
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "delete failed");
          }
          closeCtxMenu();
        }}
        onOpenProjectSettings={() => {
          closeCtxMenu();
          openProjectSettings();
        }}
        onGroup={
          !focusMode && entityIds.length >= 2 && entityIds.every((id) => groupableIds.has(id))
            ? () => {
                setGroupDialog({ nodeIds: entityIds });
                closeCtxMenu();
              }
            : undefined
        }
        onMoveTo={(toProjectId) => {
          if (entityIds.length !== 1) return;
          try {
            useAccountStore.getState().moveMenuToProject({
              menuId: entityIds[0]! as MenuId,
              fromProjectId: projectId,
              toProjectId,
            });
            toast.success(`Moved to ${toProjectId}`);
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "move failed");
          }
          closeCtxMenu();
        }}
        // Creating "here" sets a board position: without a board the entry makes
        // no sense and disappears from the context menu.
        onCreateMenuAt={
          focusMode
            ? undefined
            : (world) => {
                closeCtxMenu();
                setPendingMenuPos(world);
              }
        }
        onCreateCommandAt={
          focusMode
            ? undefined
            : (world) => {
                setPendingCommandPos(world);
                closeCtxMenu();
              }
        }
        onCreateDialogAt={
          focusMode
            ? undefined
            : (world) => {
                closeCtxMenu();
                setPendingDialogPos(world);
              }
        }
      />
      <NewMenuDialog
        projectId={projectId}
        open={pendingMenuPos !== null}
        position={pendingMenuPos ?? undefined}
        onOpenChange={(o) => {
          if (!o) setPendingMenuPos(null);
        }}
      />
      <NewCommandDialog
        projectId={projectId}
        open={pendingCommandPos !== null}
        position={pendingCommandPos ?? undefined}
        onOpenChange={(o) => {
          if (!o) setPendingCommandPos(null);
        }}
      />
      <NewDialogDialog
        projectId={projectId}
        open={pendingDialogPos !== null}
        position={pendingDialogPos ?? undefined}
        onOpenChange={(o) => {
          if (!o) setPendingDialogPos(null);
        }}
      />
    </div>
  );
}
