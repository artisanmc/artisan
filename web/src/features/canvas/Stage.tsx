import type { MenuId, PackId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useSelectionStore } from "@/state/selectionStore";
import type Konva from "konva";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Stage as KonvaStage, Layer } from "react-konva";
import { CommandGroup } from "./CommandGroup";
import { Edges } from "./Edges";
import { MATERIAL_DRAG_MIME } from "./MaterialPalette";
import { MenuGroup } from "./MenuGroup";
import { Selection } from "./Selection";
import { TextEditor } from "./TextEditor";
import { autoLayout } from "./autoLayout";
import { hitTestSlot, screenToWorld } from "./hitTest";
import { useCanvasKeyboard } from "./useCanvasKeyboard";
import { usePanZoom } from "./usePanZoom";

interface StageProps {
  packId: PackId;
}

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

  useCanvasKeyboard({
    packId,
    onError: (msg) => console.error(msg), // toasts wired in Task 9
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
        console.error(err);
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
      >
        <Layer name="edges">
          <Edges pack={pack} layout={layout} />
        </Layer>
        <Layer name="menus">
          {pack.menus.map((menu) => (
            <MenuGroup
              key={menu.id}
              packId={packId}
              menu={menu}
              position={layout[menu.id] ?? { x: 0, y: 0 }}
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
    </div>
  );
}
