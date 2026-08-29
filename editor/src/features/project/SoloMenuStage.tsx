import type { MenuId, ProjectId } from "@/domain/types";
import { ItemTooltip } from "@/features/canvas/ItemTooltip";
import { MenuGroup } from "@/features/canvas/MenuGroup";
import { menuBoxSize } from "@/features/canvas/menuLayout";
import { usePanZoom } from "@/features/canvas/usePanZoom";
import { useAccountStore } from "@/state/accountStore";
import { useHoverStore } from "@/state/hoverStore";
import { useUiStore } from "@/state/uiStore";
import { useEffect, useRef, useState } from "react";
import { Stage as KonvaStage, Layer } from "react-konva";
import { fitViewport } from "./soloViewport";

/**
 * One menu, alone on its stage — with the board's navigation: wheel zooms at
 * the cursor, drag pans, two fingers pinch. The menu has no board position here
 * so it is not draggable: a drag starting anywhere but a filled slot pans, and
 * Konva picks the deepest draggable so moving an item still wins.
 */
export function SoloMenuStage({ projectId, menuId }: { projectId: ProjectId; menuId: MenuId }) {
  const project = useAccountStore((s) => s.account.projects.find((p) => p.id === projectId));
  const menu = project?.menus.find((m) => m.id === menuId);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  // Le cadrage est partagé par tous les documents : passer d'un menu à un
  // autre garde la vue là où l'utilisateur l'a mise.
  const saved = useUiStore.getState().documentViewport;
  const setDocumentViewport = useUiStore((s) => s.setDocumentViewport);
  const { viewport, setViewport, onWheel, onTouchMove, onTouchEnd } = usePanZoom(
    saved ?? { x: 0, y: 0, scale: 1 },
  );
  // The view is fitted on open, but never fights the user afterwards: once
  // they have panned or zoomed, it stays where they put it.
  const touchedRef = useRef(saved !== null);

  useEffect(() => {
    if (!wrapperRef.current) return;
    const ro = new ResizeObserver(([e]) => {
      if (e) setSize({ w: e.contentRect.width, h: e.contentRect.height });
    });
    ro.observe(wrapperRef.current);
    return () => ro.disconnect();
  }, []);

  // Persist whatever the user is looking at — for every document, not just
  // this one.
  useEffect(() => {
    if (!touchedRef.current) return;
    setDocumentViewport(viewport);
  }, [viewport, setDocumentViewport]);

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
    <div
      ref={wrapperRef}
      className="stage-bg-dots relative h-full w-full"
      // L'infobulle est du DOM posé en `fixed` : sans ces coordonnées, elle
      // s'affichait au coin haut-gauche de l'écran au lieu de suivre le
      // curseur. Le canvas général les fournissait déjà ; la vue unique, non.
      onMouseMove={(e) => useHoverStore.getState().setCursor(e.clientX, e.clientY)}
      // Sortir de la vue d'un geste rapide ne déclenche pas toujours le
      // `mouseleave` d'un slot Konva : on éteint le survol ici aussi.
      onMouseLeave={() => useHoverStore.getState().setElement(null)}
    >
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
        onDblClick={(e) => {
          // Échappatoire : un double-clic sur le fond recadre sur le document.
          if (e.target !== e.target.getStage()) return;
          touchedRef.current = false;
          const fitted = fitViewport(size, { width: boxW, height: boxH });
          setViewport(fitted);
          setDocumentViewport(fitted);
          touchedRef.current = true;
        }}
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
      {/* Le survol d'un item est du DOM, hors du canvas Konva : sans ce montage,
          la vue unique ne réagissait pas du tout au survol, alors que le canvas
          général, lui, montrait l'infobulle (constaté en prod le 2026-08-17). */}
      <ItemTooltip projectId={projectId} />
    </div>
  );
}
