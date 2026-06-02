import { useEffect, useRef, useState } from "react";
import { Layer, Stage as KonvaStage } from "react-konva";
import type { Menu, Pack } from "@/domain/types";
import { MenuGroup } from "@/features/canvas/MenuGroup";
import { menuBoxSize } from "@/features/canvas/menuLayout";

interface Props {
  pack: Pack;
  menu: Menu;
}

/**
 * Minimal Konva host that renders a single `MenuGroup` centered and
 * scaled-to-fit within its container. Owns the ResizeObserver and all the
 * centering / scale math — `MenuGroup` cannot render without a Konva `<Stage>`
 * ancestor, so this component is the bridge.
 *
 * The stage is only mounted once the container has non-zero dimensions to
 * prevent NaN scales on the initial render.
 *
 * Scale is clamped to [0.1, 4] — vanilla MC textures get crunchy above 4×.
 */
export function SingleMenuStage({ pack, menu }: Props) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    if (!wrapperRef.current) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setSize({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    ro.observe(wrapperRef.current);
    return () => ro.disconnect();
  }, []);

  const box = menuBoxSize(menu.rows);
  // Center + scale-to-fit with 24px padding around the menu box.
  const scaleX = (size.w - 48) / box.width;
  const scaleY = (size.h - 48) / box.height;
  const scale = Math.max(0.1, Math.min(scaleX, scaleY, 4));
  const tx = (size.w - box.width * scale) / 2;
  const ty = (size.h - box.height * scale) / 2;

  return (
    <div ref={wrapperRef} className="h-full w-full">
      {size.w > 0 && size.h > 0 && (
        <KonvaStage width={size.w} height={size.h} x={tx} y={ty} scaleX={scale} scaleY={scale}>
          <Layer>
            <MenuGroup
              packId={pack.id}
              menu={menu}
              position={{ x: 0, y: 0 }}
              layout={{}}
            />
          </Layer>
        </KonvaStage>
      )}
    </div>
  );
}
