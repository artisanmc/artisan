import type { MenuId, PackId } from "@/domain/types";
import { NewMenuDialog } from "./NewMenuDialog";
import { NewCommandDialog } from "./NewCommandDialog";
import { NewDialogDialog } from "./NewDialogDialog";
import { DialogGroup } from "./DialogGroup";
import { useAccountStore } from "@/state/accountStore";
import { useHoverStore } from "@/state/hoverStore";
import { useSelectionStore } from "@/state/selectionStore";
import { useUiStore } from "@/state/uiStore";
import type Konva from "konva";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Stage as KonvaStage, Layer } from "react-konva";
import { toast } from "sonner";
import { CommandGroup } from "./CommandGroup";
import { ContextMenu, type ContextMenuState, type ContextMenuTarget } from "./ContextMenu";
import { Edges } from "./Edges";
import { EdgeTooltip } from "./EdgeTooltip";
import { ItemTooltip } from "./ItemTooltip";
import { MenuGroup } from "./MenuGroup";
import { Selection } from "./Selection";
import { autoLayout } from "./autoLayout";
import { hitTestSlot, screenToWorld } from "./hitTest";
import { useTextureUrl } from "./textureStore";
import { setStageDropTarget } from "./stageDropTarget";
import { setStageGeometryProvider } from "./stageGeometry";
import { canvasClipboardActions, useCanvasKeyboard } from "./useCanvasKeyboard";
import { usePanZoom } from "./usePanZoom";

const LONG_PRESS_MS = 500;
const LONG_PRESS_MOVE_TOLERANCE = 8;

interface StageProps {
  packId: PackId;
}

const slotIsFilled = (
  pack: ReturnType<typeof useAccountStore.getState>["account"]["packs"][number],
  menuId: string,
  position: number,
): boolean => {
  const menu = pack.menus.find((m) => m.id === menuId);
  if (!menu) return false;
  const positionStr = String(position);
  return menu.layers.some((l) =>
    l.elements.some((el) => el.positions === positionStr && el.appearances[0]?.material),
  );
};

const emptyTarget: ContextMenuTarget = { kind: "entity", selectedIds: [] };

export function Stage({ packId }: StageProps) {
  const pack = useAccountStore((s) => s.account.packs.find((p) => p.id === packId));
  const wrapperRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const { viewport, setViewport, onWheel, onTouchMove, onTouchEnd } = usePanZoom();
  // Long-press timer + start position (for touch-driven context menu).
  const longPressTimerRef = useRef<number | null>(null);
  const longPressStartRef = useRef<{ x: number; y: number } | null>(null);

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
        useUiStore.getState().setSelectedLayerKey(null);
      }
    },
    [pack, layout, viewport, packId],
  );

  const [pendingMenuPos, setPendingMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [pendingCommandPos, setPendingCommandPos] = useState<{ x: number; y: number } | null>(null);
  const [pendingDialogPos, setPendingDialogPos] = useState<{ x: number; y: number } | null>(null);

  const [ctxMenu, setCtxMenu] = useState<ContextMenuState>({
    open: false,
    x: 0,
    y: 0,
    target: emptyTarget,
  });

  /**
   * Open the context menu at a screen position, hit-testing through the
   * stage to figure out whether it's a slot or entity context. Used by
   * both right-click (mouse) and long-press (touch).
   */
  const openContextMenuAt = useCallback(
    (clientX: number, clientY: number, konvaTarget?: Konva.Node) => {
      if (!pack) return;
      const wrapper = wrapperRef.current;
      const stage = stageRef.current;
      if (!wrapper || !stage) return;
      const rect = wrapper.getBoundingClientRect();
      const stagePoint = { x: clientX - rect.left, y: clientY - rect.top };
      const world = screenToWorld(stagePoint, viewport);

      // Slot path: manual hit-test in world coords (slots have listening=false
      // so Konva's own target won't surface them).
      const slotHit = hitTestSlot(pack, layout, world.x, world.y);
      if (slotHit) {
        setCtxMenu({
          open: true,
          x: clientX,
          y: clientY,
          target: {
            kind: "slot",
            menuId: slotHit.menuId,
            position: slotHit.position,
            filled: slotIsFilled(pack, slotHit.menuId, slotHit.position),
          },
        });
        return;
      }

      // Entity path: nearest Group ancestor (menu or command).
      let id: string | undefined;
      if (konvaTarget && konvaTarget !== stage) {
        id = konvaTarget.findAncestor("Group", true)?.id();
      }
      const ids = id ? [id] : [];
      if (ids.length > 0 && !useSelectionStore.getState().ids.has(ids[0]!)) {
        useSelectionStore.getState().set(ids);
      }
      const currentSelection = [...useSelectionStore.getState().ids];
      const effectiveSelection = ids.length > 0 ? ids : currentSelection;

      // Truly empty area + nothing selected → "create here" affordances.
      if (effectiveSelection.length === 0) {
        setCtxMenu({
          open: true,
          x: clientX,
          y: clientY,
          target: { kind: "empty", world },
        });
        return;
      }

      setCtxMenu({
        open: true,
        x: clientX,
        y: clientY,
        target: { kind: "entity", selectedIds: effectiveSelection },
      });
    },
    [pack, layout, viewport],
  );

  const onStageContextMenu = useCallback(
    (e: Konva.KonvaEventObject<PointerEvent>) => {
      e.evt.preventDefault();
      openContextMenuAt(e.evt.clientX, e.evt.clientY, e.target);
    },
    [openContextMenuAt],
  );

  const closeCtx = useCallback(() => setCtxMenu((s) => ({ ...s, open: false })), []);

  // ── Touch handling: long-press for context menu, pinch via usePanZoom ──
  const cancelLongPress = useCallback(() => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    longPressStartRef.current = null;
  }, []);

  const onStageTouchStart = useCallback(
    (e: Konva.KonvaEventObject<TouchEvent>) => {
      if (e.evt.touches.length !== 1) {
        cancelLongPress();
        return;
      }
      const touch = e.evt.touches[0]!;
      const startX = touch.clientX;
      const startY = touch.clientY;
      const target = e.target;
      longPressStartRef.current = { x: startX, y: startY };
      longPressTimerRef.current = window.setTimeout(() => {
        longPressTimerRef.current = null;
        longPressStartRef.current = null;
        openContextMenuAt(startX, startY, target);
      }, LONG_PRESS_MS);
    },
    [cancelLongPress, openContextMenuAt],
  );

  const onStageTouchMove = useCallback(
    (e: Konva.KonvaEventObject<TouchEvent>) => {
      // Cancel long-press if touch moves too far or a second finger lands.
      if (longPressStartRef.current && e.evt.touches.length === 1) {
        const touch = e.evt.touches[0]!;
        const dx = touch.clientX - longPressStartRef.current.x;
        const dy = touch.clientY - longPressStartRef.current.y;
        if (Math.hypot(dx, dy) > LONG_PRESS_MOVE_TOLERANCE) cancelLongPress();
      } else if (e.evt.touches.length > 1) {
        cancelLongPress();
      }
      onTouchMove(e);
    },
    [cancelLongPress, onTouchMove],
  );

  const onStageTouchEnd = useCallback(() => {
    cancelLongPress();
    onTouchEnd();
  }, [cancelLongPress, onTouchEnd]);

  useEffect(() => () => cancelLongPress(), [cancelLongPress]);

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

  if (!pack) return <div className="p-8 text-zinc-500">Pack not found.</div>;

  const entityIds = ctxMenu.target.kind === "entity" ? ctxMenu.target.selectedIds : [];

  return (
    <div
      ref={wrapperRef}
      className="relative h-full w-full bg-[var(--color-bg)]"
      onMouseMove={onWrapperMouseMove}
      onMouseLeave={onWrapperMouseLeave}
    >
      <ArmedBanner />
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
          {pack.menus.map((menu) => (
            <MenuGroup
              key={menu.id}
              packId={packId}
              menu={menu}
              position={layout[menu.id] ?? { x: 0, y: 0 }}
              layout={layout}
            />
          ))}
        </Layer>
        {/* Commands and dialogs render above the menus layer so they always
            take click priority, even after a menu calls moveToTop() during drag. */}
        <Layer name="commands" imageSmoothingEnabled={false}>
          {pack.commands.map((command) => (
            <CommandGroup
              key={command.id}
              packId={packId}
              command={command}
              position={layout[command.id] ?? { x: 0, y: 0 }}
            />
          ))}
          {pack.dialogs.map((dialog) => (
            <DialogGroup
              key={dialog.id}
              packId={packId}
              dialog={dialog}
              position={layout[dialog.id] ?? { x: 0, y: 0 }}
            />
          ))}
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
        onClose={closeCtx}
        onCopy={() => {
          void canvasClipboardActions.copySelection(packId, entityIds, (m) => toast.error(m));
          closeCtx();
        }}
        onPaste={() => {
          void canvasClipboardActions.pasteFromClipboard(packId, (m) => toast.error(m));
          closeCtx();
        }}
        onDuplicate={() => {
          canvasClipboardActions.duplicateSelection(packId, entityIds, (m) => toast.error(m));
          closeCtx();
        }}
        onDelete={() => {
          if (entityIds.length === 0) return;
          try {
            useAccountStore.getState().deleteFromPack({ packId, nodeIds: entityIds });
            useSelectionStore.getState().clear();
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "delete failed");
          }
          closeCtx();
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
          closeCtx();
        }}
        onCreateMenuAt={(world) => {
          closeCtx();
          setPendingMenuPos(world);
        }}
        onCreateCommandAt={(world) => {
          setPendingCommandPos(world);
          closeCtx();
        }}
        onCreateDialogAt={(world) => {
          closeCtx();
          setPendingDialogPos(world);
        }}
      />
      <NewMenuDialog
        packId={packId}
        open={pendingMenuPos !== null}
        position={pendingMenuPos ?? undefined}
        onOpenChange={(o) => { if (!o) setPendingMenuPos(null); }}
      />
      <NewCommandDialog
        packId={packId}
        open={pendingCommandPos !== null}
        position={pendingCommandPos ?? undefined}
        onOpenChange={(o) => { if (!o) setPendingCommandPos(null); }}
      />
      <NewDialogDialog
        packId={packId}
        open={pendingDialogPos !== null}
        position={pendingDialogPos ?? undefined}
        onOpenChange={(o) => { if (!o) setPendingDialogPos(null); }}
      />
    </div>
  );
}

/**
 * Floating pill at the top of the Stage that shows when a Library item is
 * "armed" (touch flow), with a × to cancel. The next slot tap on the stage
 * places the armed material — see `onStageClick` above.
 */
function ArmedBanner() {
  const armed = useUiStore((s) => s.armedMaterial);
  const setArmed = useUiStore((s) => s.setArmedMaterial);
  const url = useTextureUrl(armed ?? "");
  if (!armed) return null;
  return (
    <div className="-translate-x-1/2 absolute top-2 left-1/2 z-20 flex items-center gap-2 rounded-full border border-emerald-500/60 bg-emerald-500/10 px-3 py-1.5 text-emerald-200 shadow-lg backdrop-blur">
      {url ? (
        <img
          src={url}
          alt={armed}
          className="h-5 w-5 object-contain"
          style={{ imageRendering: "pixelated" }}
        />
      ) : null}
      <span className="font-mono text-[12px]">tap a slot to place {armed}</span>
      <button
        type="button"
        onClick={() => setArmed(null)}
        title="Cancel"
        className="flex h-7 w-7 items-center justify-center rounded text-[14px] text-emerald-200/80 hover:bg-emerald-500/20 hover:text-emerald-100"
      >
        ×
      </button>
    </div>
  );
}
