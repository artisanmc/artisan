import { useEffect, useRef, useState } from "react";
import { Stage as KonvaStage, Layer } from "react-konva";
import type { MenuId, ProjectId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useUiStore } from "@/state/uiStore";
import { MenuGroup } from "@/features/canvas/MenuGroup";
import { menuBoxSize } from "@/features/canvas/menuLayout";
import { usePanZoom } from "@/features/canvas/usePanZoom";
import { fitViewport } from "./soloViewport";

/**
 * One menu, alone on its stage — with the board's navigation: wheel zooms at
 * the cursor, drag pans, two fingers pinch. The menu has no board position here
 * so it is not draggable: a drag starting anywhere but a filled slot pans, and
 * Konva picks the deepest draggable so moving an item still wins.
 */
export function SoloMenuStage({ projectId, menuId }: { projectId: ProjectId; menuId: MenuId }) {
  const pack = useAccountStore((s) => s.account.projects.find((p) => p.id === projectId));
  const menu = pack?.menus.find((m) => m.id === menuId);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  // Restaurée en revenant sur ce document : on ne re-cadre que la première fois.
  const viewKey = `${projectId}:${menuId}`;
  const saved = useUiStore.getState().documentViewports[viewKey];
  const setDocumentViewport = useUiStore((s) => s.setDocumentViewport);
  const { viewport, setViewport, onWheel, onTouchMove, onTouchEnd } = usePanZoom(
    saved ?? { x: 0, y: 0, scale: 1 },
  );
  // The view is fitted on open, but never fights the user afterwards: once
  // they have panned or zoomed, it stays where they put it.
  const touchedRef = useRef(saved !== undefined);

  useEffect(() => {
    if (!wrapperRef.current) return;
    const ro = new ResizeObserver(([e]) => {
      if (e) setSize({ w: e.contentRect.width, h: e.contentRect.height });
    });
    ro.observe(wrapperRef.current);
    return () => ro.disconnect();
  }, []);

  // Another menu is another subject — fit it again, unless we have been there.
  useEffect(() => {
    touchedRef.current = useUiStore.getState().documentViewports[viewKey] !== undefined;
  }, [viewKey]);

  // Persist whatever the user is looking at, so leaving and coming back lands
  // on the same spot.
  useEffect(() => {
    if (!touchedRef.current) return;
    setDocumentViewport(viewKey, viewport);
  }, [viewKey, viewport, setDocumentViewport]);

  const boxW = menu ? menuBoxSize(menu.inventoryType ?? "chest", menu.rows).width : 0;
  const boxH = menu ? menuBoxSize(menu.inventoryType ?? "chest", menu.rows).height : 0;
  useEffect(() => {
    if (touchedRef.current || size.w === 0 || boxW === 0) return;
    setViewport(fitViewport(size, { width: boxW, height: boxH }));
  }, [size, boxW, boxH, setViewport]);

  const touched = () => {
    touchedRef.current = true;
  };

  if (!menu) return null;

  return (
    <div ref={wrapperRef} className="stage-bg-dots relative h-full w-full">
      <KonvaStage
        width={size.w}
        height={size.h}
        x={viewport.x}
        y={viewport.y}
        scaleX={viewport.scale}
        scaleY={viewport.scale}
        draggable
        onWheel={(e) => {
          touched();
          onWheel(e);
        }}
        onTouchMove={(e) => {
          touched();
          onTouchMove(e);
        }}
        onTouchEnd={onTouchEnd}
        onDragEnd={(e) => {
          const stage = e.target.getStage();
          // Only a stage drag is a pan — dragging an item must not move the view.
          if (!stage || e.target !== stage) return;
          touched();
          setViewport({ x: stage.x(), y: stage.y(), scale: stage.scaleX() });
        }}
      >
        <Layer name="solo-menu" imageSmoothingEnabled={false}>
          <MenuGroup projectId={projectId} menu={menu} position={{ x: 0, y: 0 }} layout={{}} solo />
        </Layer>
      </KonvaStage>
    </div>
  );
}
