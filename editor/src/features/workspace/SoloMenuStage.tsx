import { useEffect, useRef, useState } from "react";
import { Stage as KonvaStage, Layer } from "react-konva";
import type { MenuId, PackId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { MenuGroup } from "@/features/canvas/MenuGroup";

export function SoloMenuStage({ packId, menuId }: { packId: PackId; menuId: MenuId }) {
  const pack = useAccountStore((s) => s.account.packs.find((p) => p.id === packId));
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
      <KonvaStage width={size.w} height={size.h} x={Math.max(40, size.w / 2 - 180)} y={40}>
        <Layer name="solo-menu" imageSmoothingEnabled={false}>
          <MenuGroup packId={packId} menu={menu} position={{ x: 0, y: 0 }} layout={{}} solo />
        </Layer>
      </KonvaStage>
    </div>
  );
}
