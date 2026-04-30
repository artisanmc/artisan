import type { PackId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useEffect, useRef, useState } from "react";
import { Stage as KonvaStage, Layer } from "react-konva";
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
        <Layer name="menus" />
        <Layer name="overlay" />
      </KonvaStage>
    </div>
  );
}
