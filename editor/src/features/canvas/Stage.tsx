import { EmptyState } from "@/components/ui/empty-state";
import type { MenuId, ProjectId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useHoverStore } from "@/state/hoverStore";
import { useEdgeSelectionStore } from "@/state/edgeSelectionStore";
import { useSelectionStore } from "@/state/selectionStore";
import { useUiStore } from "@/state/uiStore";
import Konva from "konva";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// Only the primary (left) button drags Konva nodes / the stage. This frees the
// middle button for panning (handled manually via useMiddleClickPan) without it
// accidentally starting a node drag when pressed over a menu.
Konva.dragButtons = [0];
import { useTranslation } from "react-i18next";
import { Stage as KonvaStage, Layer } from "react-konva";
import { toast } from "sonner";
import { AlignmentGuides } from "./AlignmentGuidesOverlay";
import { ArmedBanner } from "./ArmedBanner";
import { CanvasToolbar } from "./CanvasToolbar";
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
import { autoLayout } from "./autoLayout";
import { hitTestSlot, screenToWorld } from "./hitTest";
import { setStageDropTarget, setStageSlotHitTest } from "./stageDropTarget";
import { setStageGeometryProvider } from "./stageGeometry";
import { canvasClipboardActions, useCanvasKeyboard } from "./useCanvasKeyboard";
import { useMarqueeSelection } from "./useMarqueeSelection";
import { useMiddleClickPan } from "./useMiddleClickPan";
import { usePanZoom } from "./usePanZoom";
import { useStageContextMenu } from "./useStageContextMenu";
import { useStageTouch } from "./useStageTouch";

interface StageProps {
  projectId: ProjectId;
}

export function Stage({ projectId }: StageProps) {
  const { t } = useTranslation();
  const pack = useAccountStore((s) => s.account.projects.find((p) => p.id === projectId));
  const wrapperRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  // Restore the saved pan/zoom for this pack so leaving the board (single
  // element view) and returning lands on the same spot + zoom. Read once at
  // mount (non-reactive); persisted back via the effect below.
  const { viewport, setViewport, onWheel, onTouchMove, onTouchEnd } = usePanZoom(
    useUiStore.getState().canvasViewports[projectId],
  );
  const canvasMode = useUiStore((s) => s.canvasMode);
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
      if (e.code === "Space" && !isEditable(e.target)) { e.preventDefault(); setSpaceHeld(true); }
      if (e.key === "Alt" && !isEditable(e.target)) { e.preventDefault(); setAltHeld(true); }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpaceHeld(false);
      if (e.key === "Alt") setAltHeld(false);
    };
    const onBlur = () => { setSpaceHeld(false); setAltHeld(false); };
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

  // Konva's native stage-drag (single-finger pan) mutates the stage's x/y
  // directly without going through React. Without this sync, the next
  // re-render snaps the canvas back to the stale `viewport` prop, which
  // also drifts every DOM overlay (TextEditor, ArmedBanner) and every
  // pointer-to-world conversion (tap-to-place).
  const syncViewportFromStage = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    setViewport({ x: stage.x(), y: stage.y(), scale: stage.scaleX() });
  }, [setViewport]);

  useEffect(() => {
    if (!wrapperRef.current) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setSize({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    ro.observe(wrapperRef.current);
    return () => ro.disconnect();
  }, []);

  // Persist pan/zoom per pack so it survives leaving/returning to the board.
  useEffect(() => {
    useUiStore.getState().setCanvasViewport(projectId, viewport);
  }, [projectId, viewport]);

  const layout = useMemo(() => (pack ? autoLayout(pack) : {}), [pack]);

  const marquee = useMarqueeSelection({
    stageRef,
    viewport,
    pack,
    layout,
    active: canvasMode === "select" && !spaceHeld && !altHeld,
  });

  // Middle-button pans regardless of mode/target (document capture listener).
  const middlePan = useMiddleClickPan({ containerRef: wrapperRef, viewport, setViewport });

  // Empty-stage click clears selection. Konva fires `click` on the Stage when
  // the user clicks an area not occupied by any listening child.
  // Also: if a material is "armed" from the Library (touch placement flow),
  // a click on a slot places it. Hit-test in world coords.
  // suppressClick: if a marquee drag just completed, the follow-up stage click
  // must not clear the selection the marquee just made.
  const onStageClick = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
      const armed = useUiStore.getState().armedMaterial;
      if (armed && pack) {
        const stage = e.target.getStage();
        const pointer = stage?.getPointerPosition();
        if (pointer) {
          const world = screenToWorld(pointer, viewport);
          const hit = hitTestSlot(pack, layout, world.x, world.y);
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
        useSelectionStore.getState().clear();
        useEdgeSelectionStore.getState().select(null);
        useUiStore.getState().setSelectedLayerKey(null);
      }
    },
    [pack, layout, viewport, projectId, marquee.shouldConsumeClick],
  );

  const [pendingMenuPos, setPendingMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [pendingCommandPos, setPendingCommandPos] = useState<{ x: number; y: number } | null>(null);
  const [pendingDialogPos, setPendingDialogPos] = useState<{ x: number; y: number } | null>(null);

  const { ctxMenu, openContextMenuAt, onStageContextMenu, closeCtxMenu } = useStageContextMenu({
    pack,
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

  // Cross-platform Library drop: the top-level DndContext (in the pack
  // route) calls this with the release coords + material. We hit-test the
  // slot and place. Returns true if placed, so the route can decide
  // whether to do anything else.
  useEffect(() => {
    setStageDropTarget((clientX, clientY, material) => {
      const wrapper = wrapperRef.current;
      if (!wrapper || !pack) return false;
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
      const hit = hitTestSlot(pack, layout, world.x, world.y);
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
  }, [pack, layout, viewport, projectId]);

  // Placement-mode row drops: resolve release coords to a menu/slot (the route's
  // onDragEnd pins the row). Same wrapper-rect → world → hit-test as above.
  useEffect(() => {
    setStageSlotHitTest((clientX, clientY) => {
      const wrapper = wrapperRef.current;
      if (!wrapper || !pack) return null;
      const rect = wrapper.getBoundingClientRect();
      if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
        return null;
      }
      const stagePoint = { x: clientX - rect.left, y: clientY - rect.top };
      const world = screenToWorld(stagePoint, viewport);
      return hitTestSlot(pack, layout, world.x, world.y);
    });
    return () => setStageSlotHitTest(null);
  }, [pack, layout, viewport]);

  // Expose the live wrapper rect + viewport so the 3rd-column LayersPanel can
  // convert drag-end client coords into canvas coords (cursor-based new-layer
  // attach in P1.11). The provider reads refs at call time, so consumers
  // always see the current pan/scale + bounding box.
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

  useCanvasKeyboard({
    projectId,
    onError: (msg) => toast.error(msg),
  });

  const onWrapperMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    useHoverStore.getState().setCursor(e.clientX, e.clientY);
  }, []);

  const onWrapperMouseLeave = useCallback(() => {
    // Clear hover when the cursor leaves the canvas entirely (Konva
    // mouseleave on a slot doesn't fire if we exit the whole stage at speed).
    useHoverStore.getState().setElement(null);
  }, []);

  if (!pack) return <div className="p-8 text-[var(--text-mut)]">Project not found.</div>;

  const entityIds = ctxMenu.target.kind === "entity" ? ctxMenu.target.selectedIds : [];

  return (
    <div
      ref={wrapperRef}
      className="stage-bg-dots relative h-full w-full"
      style={{
        cursor:
          middlePan.panning || stageDragging ? "grabbing" : panMode ? "grab" : "default",
      }}
      onMouseMove={onWrapperMouseMove}
      onMouseLeave={onWrapperMouseLeave}
    >
      <div aria-hidden className="stage-bg-glow pointer-events-none absolute inset-0" />
      {Object.keys(layout).length === 0 && (
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
                {pack.menus.length + pack.commands.length + pack.dialogs.length > 0 && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => useAccountStore.getState().arrangeAllOnBoard({ projectId })}
                  >
                    {t("projectPanel.arrangeAll")}
                  </button>
                )}
              </div>
            }
          />
        </div>
      )}
      <ArmedBanner />
      <CanvasToolbar />
      <KonvaStage
        ref={stageRef}
        width={size.w}
        height={size.h}
        x={viewport.x}
        y={viewport.y}
        scaleX={viewport.scale}
        scaleY={viewport.scale}
        draggable={panMode}
        onWheel={onWheel}
        onClick={onStageClick}
        onTap={onStageClick}
        onMouseDown={marquee.onMouseDown}
        onMouseMove={marquee.onMouseMove}
        onMouseUp={marquee.onMouseUp}
        onContextMenu={onStageContextMenu}
        onTouchStart={onStageTouchStart}
        onTouchMove={onStageTouchMove}
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
        <Layer name="edges">
          <Edges pack={pack} layout={layout} />
        </Layer>
        <Layer name="menus" imageSmoothingEnabled={false}>
          {pack.menus.filter((menu) => layout[menu.id]).map((menu) => (
            <MenuGroup
              key={menu.id}
              projectId={projectId}
              menu={menu}
              position={layout[menu.id]!}
              layout={layout}
            />
          ))}
        </Layer>
        {/* Commands and dialogs render above the menus layer so they always
            take click priority, even after a menu calls moveToTop() during drag. */}
        <Layer name="commands" imageSmoothingEnabled={false}>
          {pack.commands.filter((command) => layout[command.id]).map((command) => (
            <CommandGroup
              key={command.id}
              projectId={projectId}
              command={command}
              position={layout[command.id]!}
            />
          ))}
          {pack.dialogs.filter((dialog) => layout[dialog.id]).map((dialog) => (
            <DialogGroup
              key={dialog.id}
              projectId={projectId}
              dialog={dialog}
              position={layout[dialog.id]!}
            />
          ))}
          <GhostChips pack={pack} layout={layout} projectId={projectId} />
        </Layer>
        <Layer name="overlay">
          <Selection stageRef={stageRef} />
          <MarqueeRect rect={marquee.rect} />
          <AlignmentGuides />
        </Layer>
      </KonvaStage>
      <ItemTooltip projectId={projectId} />
      <EdgeTooltip pack={pack} />
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
        onDuplicate={() => {
          canvasClipboardActions.duplicateSelection(projectId, entityIds, (m) => toast.error(m));
          closeCtxMenu();
        }}
        onDelete={() => {
          if (entityIds.length === 0) return;
          try {
            useAccountStore.getState().deleteFromProject({ projectId, nodeIds: entityIds });
            useSelectionStore.getState().clear();
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "delete failed");
          }
          closeCtxMenu();
        }}
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
        onCreateMenuAt={(world) => {
          closeCtxMenu();
          setPendingMenuPos(world);
        }}
        onCreateCommandAt={(world) => {
          setPendingCommandPos(world);
          closeCtxMenu();
        }}
        onCreateDialogAt={(world) => {
          closeCtxMenu();
          setPendingDialogPos(world);
        }}
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
