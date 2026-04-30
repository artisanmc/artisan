import type { PackId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useEffect, useMemo, useRef, useState } from "react";
import { Stage as KonvaStage, Layer } from "react-konva";
import { CommandGroup } from "./CommandGroup";
import { MenuGroup } from "./MenuGroup";
import { autoLayout } from "./autoLayout";
import { usePanZoom } from "./usePanZoom";

interface StageProps {
  packId: PackId;
}

export function Stage({ packId }: StageProps) {
  const pack = useAccountStore((s) => s.account.packs.find((p) => p.id === packId));
  const wrapperRef = useRef<HTMLDivElement>(null);
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

  if (!pack) return <div className="p-8 text-zinc-500">Pack not found.</div>;

  return (
    <div ref={wrapperRef} className="h-full w-full bg-[var(--color-bg)]">
      <KonvaStage
        width={size.w}
        height={size.h}
        x={viewport.x}
        y={viewport.y}
        scaleX={viewport.scale}
        scaleY={viewport.scale}
        draggable
        onWheel={onWheel}
      >
        <Layer name="edges" />
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
        <Layer name="overlay" />
      </KonvaStage>
    </div>
  );
}
