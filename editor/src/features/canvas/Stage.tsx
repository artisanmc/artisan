import { EmptyState } from "@/components/ui/empty-state";
import type { MenuId, PackId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useHoverStore } from "@/state/hoverStore";
import { useEdgeSelectionStore } from "@/state/edgeSelectionStore";
import { useSelectionStore } from "@/state/selectionStore";
import { useUiStore } from "@/state/uiStore";
import type Konva from "konva";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Stage as KonvaStage, Layer } from "react-konva";
import { toast } from "sonner";
import { ArmedBanner } from "./ArmedBanner";
import { CanvasToolbar } from "./CanvasToolbar";
import { CommandGroup } from "./CommandGroup";
import { ContextMenu } from "./ContextMenu";
import { DialogGroup } from "./DialogGroup";
import { EdgeTooltip } from "./EdgeTooltip";
import { Edges } from "./Edges";
import { GhostChips } from "./GhostChips";
import { ItemTooltip } from "./ItemTooltip";
import { MenuGroup } from "./MenuGroup";
import { NewCommandDialog } from "./NewCommandDialog";
import { NewDialogDialog } from "./NewDialogDialog";
import { NewMenuDialog } from "./NewMenuDialog";
import { Selection } from "./Selection";
import { autoLayout } from "./autoLayout";
import { hitTestSlot, screenToWorld } from "./hitTest";
import { setStageDropTarget } from "./stageDropTarget";
import { setStageGeometryProvider } from "./stageGeometry";
import { canvasClipboardActions, useCanvasKeyboard } from "./useCanvasKeyboard";
import { usePanZoom } from "./usePanZoom";
import { useStageContextMenu } from "./useStageContextMenu";
import { useStageTouch } from "./useStageTouch";

interface StageProps {
  packId: PackId;
}

export function Stage({ packId }: StageProps) {
  const { t } = useTranslation();
  const pack = useAccountStore((s) => s.account.packs.find((p) => p.id === packId));
  const wrapperRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const { viewport, setViewport, onWheel, onTouchMove, onTouchEnd } = usePanZoom();

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

  const layout = useMemo(() => (pack ? autoLayout(pack) : {}), [pack]);

  // Empty-stage click clears selection. Konva fires `click` on the Stage when
  // the user clicks an area not occupied by any listening child.
  // Also: if a material is "armed" from the Library (touch placement flow),
  // a click on a slot places it. Hit-test in world coords.
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
                packId,
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
      if (e.target === e.target.getStage()) {
        useSelectionStore.getState().clear();
        useEdgeSelectionStore.getState().select(null);
        useUiStore.getState().setSelectedLayerKey(null);
      }
    },
    [pack, layout, viewport, packId],
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
          packId,
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
  }, [pack, layout, viewport, packId]);

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
    packId,
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

  if (!pack) return <div className="p-8 text-[var(--text-mut)]">Pack not found.</div>;

  const entityIds = ctxMenu.target.kind === "entity" ? ctxMenu.target.selectedIds : [];

  return (
    <div
      ref={wrapperRef}
      className="stage-bg-dots relative h-full w-full"
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
            title={t("workspacePanel.empty")}
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
                    onClick={() => useAccountStore.getState().arrangeAllOnBoard({ packId })}
                  >
                    {t("workspacePanel.arrangeAll")}
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
        draggable
        onWheel={onWheel}
        onClick={onStageClick}
        onTap={onStageClick}
        onContextMenu={onStageContextMenu}
        onTouchStart={onStageTouchStart}
        onTouchMove={onStageTouchMove}
        onTouchEnd={onStageTouchEnd}
        onDragMove={(e) => {
          // Only sync when the drag target is the Stage itself (not a
          // child Group like a menu or a slot, which fire dragmove too).
          if (e.target === e.target.getStage()) syncViewportFromStage();
        }}
        onDragEnd={(e) => {
          if (e.target === e.target.getStage()) syncViewportFromStage();
        }}
      >
        <Layer name="edges">
          <Edges pack={pack} layout={layout} />
        </Layer>
        <Layer name="menus" imageSmoothingEnabled={false}>
          {pack.menus.filter((menu) => layout[menu.id]).map((menu) => (
            <MenuGroup
              key={menu.id}
              packId={packId}
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
              packId={packId}
              command={command}
              position={layout[command.id]!}
            />
          ))}
          {pack.dialogs.filter((dialog) => layout[dialog.id]).map((dialog) => (
            <DialogGroup
              key={dialog.id}
              packId={packId}
              dialog={dialog}
              position={layout[dialog.id]!}
            />
          ))}
          <GhostChips pack={pack} layout={layout} packId={packId} />
        </Layer>
        <Layer name="overlay">
          <Selection stageRef={stageRef} />
        </Layer>
      </KonvaStage>
      <ItemTooltip packId={packId} />
      <EdgeTooltip pack={pack} />
      <ContextMenu
        packId={packId}
        state={ctxMenu}
        onClose={closeCtxMenu}
        onCopy={() => {
          void canvasClipboardActions.copySelection(packId, entityIds, (m) => toast.error(m));
          closeCtxMenu();
        }}
        onPaste={() => {
          void canvasClipboardActions.pasteFromClipboard(packId, (m) => toast.error(m));
          closeCtxMenu();
        }}
        onDuplicate={() => {
          canvasClipboardActions.duplicateSelection(packId, entityIds, (m) => toast.error(m));
          closeCtxMenu();
        }}
        onDelete={() => {
          if (entityIds.length === 0) return;
          try {
            useAccountStore.getState().deleteFromPack({ packId, nodeIds: entityIds });
            useSelectionStore.getState().clear();
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "delete failed");
          }
          closeCtxMenu();
        }}
        onMoveTo={(toPackId) => {
          if (entityIds.length !== 1) return;
          try {
            useAccountStore.getState().moveMenuToPack({
              menuId: entityIds[0]! as MenuId,
              fromPackId: packId,
              toPackId,
            });
            toast.success(`Moved to ${toPackId}`);
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
        packId={packId}
        open={pendingMenuPos !== null}
        position={pendingMenuPos ?? undefined}
        onOpenChange={(o) => {
          if (!o) setPendingMenuPos(null);
        }}
      />
      <NewCommandDialog
        packId={packId}
        open={pendingCommandPos !== null}
        position={pendingCommandPos ?? undefined}
        onOpenChange={(o) => {
          if (!o) setPendingCommandPos(null);
        }}
      />
      <NewDialogDialog
        packId={packId}
        open={pendingDialogPos !== null}
        position={pendingDialogPos ?? undefined}
        onOpenChange={(o) => {
          if (!o) setPendingDialogPos(null);
        }}
      />
    </div>
  );
}
