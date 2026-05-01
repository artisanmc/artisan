import type { MenuId, PackId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useSelectionStore } from "@/state/selectionStore";
import type Konva from "konva";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Stage as KonvaStage, Layer } from "react-konva";
import { toast } from "sonner";
import { CommandGroup } from "./CommandGroup";
import { ContextMenu, type ContextMenuState, type ContextMenuTarget } from "./ContextMenu";
import { Edges } from "./Edges";
import { MATERIAL_DRAG_MIME } from "./Library";
import { MenuGroup } from "./MenuGroup";
import { Selection } from "./Selection";
import { TextEditor } from "./TextEditor";
import { autoLayout } from "./autoLayout";
import { hitTestSlot, screenToWorld } from "./hitTest";
import { canvasClipboardActions, useCanvasKeyboard } from "./useCanvasKeyboard";
import { usePanZoom } from "./usePanZoom";

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
  const { viewport, onWheel } = usePanZoom();

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
  const onStageClick = useCallback((e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    if (e.target === e.target.getStage()) {
      useSelectionStore.getState().clear();
    }
  }, []);

  const [ctxMenu, setCtxMenu] = useState<ContextMenuState>({
    open: false,
    x: 0,
    y: 0,
    target: emptyTarget,
  });

  const onStageContextMenu = useCallback(
    (e: Konva.KonvaEventObject<PointerEvent>) => {
      e.evt.preventDefault();
      if (!pack) return;

      // Slot path: manual hit-test in world coords (slots have listening=false
      // so Konva's own target won't surface them).
      const stage = e.target.getStage();
      const pointer = stage?.getPointerPosition();
      if (pointer) {
        const wrapper = wrapperRef.current;
        if (wrapper) {
          const world = screenToWorld(pointer, viewport);
          const slotHit = hitTestSlot(pack, layout, world.x, world.y);
          if (slotHit) {
            setCtxMenu({
              open: true,
              x: e.evt.clientX,
              y: e.evt.clientY,
              target: {
                kind: "slot",
                menuId: slotHit.menuId,
                position: slotHit.position,
                filled: slotIsFilled(pack, slotHit.menuId, slotHit.position),
              },
            });
            return;
          }
        }
      }

      // Entity path: nearest Group ancestor (menu or command).
      const target = e.target;
      const id = target === target.getStage() ? null : target.findAncestor("Group", true)?.id();
      const ids = id ? [id] : [];
      if (ids.length > 0 && !useSelectionStore.getState().ids.has(ids[0]!)) {
        useSelectionStore.getState().set(ids);
      }
      setCtxMenu({
        open: true,
        x: e.evt.clientX,
        y: e.evt.clientY,
        target: {
          kind: "entity",
          selectedIds: ids.length > 0 ? ids : [...useSelectionStore.getState().ids],
        },
      });
    },
    [pack, layout, viewport],
  );

  const closeCtx = useCallback(() => setCtxMenu((s) => ({ ...s, open: false })), []);

  useCanvasKeyboard({
    packId,
    onError: (msg) => toast.error(msg),
  });

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      const material = e.dataTransfer.getData(MATERIAL_DRAG_MIME);
      if (!material || !pack) return;
      e.preventDefault();
      const wrapper = wrapperRef.current;
      if (!wrapper) return;
      const rect = wrapper.getBoundingClientRect();
      const stagePoint = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const world = screenToWorld(stagePoint, viewport);
      const hit = hitTestSlot(pack, layout, world.x, world.y);
      if (!hit) return;
      try {
        useAccountStore.getState().setSlotMaterial({
          packId,
          menuId: hit.menuId as MenuId,
          position: hit.position,
          material,
        });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "drop failed");
      }
    },
    [pack, layout, packId, viewport],
  );

  const onDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (e.dataTransfer.types.includes(MATERIAL_DRAG_MIME)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
  }, []);

  if (!pack) return <div className="p-8 text-zinc-500">Pack not found.</div>;

  const entityIds = ctxMenu.target.kind === "entity" ? ctxMenu.target.selectedIds : [];

  return (
    <div
      ref={wrapperRef}
      className="relative h-full w-full bg-[var(--color-bg)]"
      onDrop={onDrop}
      onDragOver={onDragOver}
    >
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
          {pack.commands.map((command) => (
            <CommandGroup
              key={command.id}
              packId={packId}
              command={command}
              position={layout[command.id] ?? { x: 0, y: 0 }}
            />
          ))}
        </Layer>
        <Layer name="overlay">
          <Selection stageRef={stageRef} />
        </Layer>
      </KonvaStage>
      <TextEditor packId={packId} layout={layout} viewport={viewport} />
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
      />
    </div>
  );
}
