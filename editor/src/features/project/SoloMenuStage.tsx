import { useEffect, useRef, useState } from "react";
import { Stage as KonvaStage, Layer } from "react-konva";
import type { MenuId, ProjectId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { MenuGroup } from "@/features/canvas/MenuGroup";
import { TEX_W } from "@/features/canvas/menuLayout";

export function SoloMenuStage({ projectId, menuId }: { projectId: ProjectId; menuId: MenuId }) {
  const pack = useAccountStore((s) => s.account.projects.find((p) => p.id === projectId));
  const menu = pack?.menus.find((m) => m.id === menuId);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    if (!wrapperRef.current) return;
    const ro = new ResizeObserver(([e]) => { if (e) setSize({ w: e.contentRect.width, h: e.contentRect.height }); });
    ro.observe(wrapperRef.current);
    return () => ro.disconnect();
  }, []);
  if (!menu) return null;
  return (
    <div ref={wrapperRef} className="stage-bg-dots relative h-full w-full">
      <KonvaStage width={size.w} height={size.h} x={Math.max(40, size.w / 2 - TEX_W / 2)} y={40}>
        <Layer name="solo-menu" imageSmoothingEnabled={false}>
          <MenuGroup projectId={projectId} menu={menu} position={{ x: 0, y: 0 }} layout={{}} solo />
        </Layer>
      </KonvaStage>
    </div>
  );
}
