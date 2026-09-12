import { Button } from "@/components/ui/button";
import { useUiStore } from "@/state/uiStore";
import { X } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Box } from "./edgeRouting";
import type { ViewportState } from "./usePanZoom";

interface Props {
  boxes: (Box & { id: string })[];
  size: { w: number; h: number };
  viewport: ViewportState;
  onNavigate: (viewport: ViewportState) => void;
}

export function CanvasMinimap({ boxes, size, viewport, onNavigate }: Props) {
  const { t } = useTranslation();
  const drag = useRef<{
    pointerId: number;
    clientX: number;
    clientY: number;
    viewport: ViewportState;
    factorX: number;
    factorY: number;
  } | null>(null);
  const [frozen, setFrozen] = useState<{ x: number; y: number; scale: number } | null>(null);
  const visible = {
    x: -viewport.x / viewport.scale,
    y: -viewport.y / viewport.scale,
    width: size.w / viewport.scale,
    height: size.h / viewport.scale,
  };
  const bounds = [...boxes, visible];
  const left = Math.min(...bounds.map((b) => b.x)) - 40;
  const top = Math.min(...bounds.map((b) => b.y)) - 40;
  const width = Math.max(...bounds.map((b) => b.x + b.width)) + 40 - left;
  const height = Math.max(...bounds.map((b) => b.y + b.height)) + 40 - top;
  const scale = frozen?.scale ?? Math.min(220 / width, 140 / height);
  const x = frozen?.x ?? left - (220 / scale - width) / 2;
  const y = frozen?.y ?? top - (140 / scale - height) / 2;
  const stopDrag = () => {
    drag.current = null;
    setFrozen(null);
  };
  return (
    <div
      role="application"
      aria-label={t("canvas.minimap")}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: The interactive map supports arrow-key navigation.
      tabIndex={0}
      className="absolute right-2 bottom-2 z-20 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] shadow-md"
      style={{
        width: 220,
        aspectRatio: "11 / 7",
        touchAction: "none",
        cursor: frozen ? "grabbing" : "grab",
        maxWidth: "calc(100% - 32px)",
      }}
      onPointerDown={(event) => {
        if (event.button !== 0 || drag.current) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.focus();
        const rect = event.currentTarget.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        const worldX = x + ((event.clientX - rect.left) * 220) / rect.width / scale;
        const worldY = y + ((event.clientY - rect.top) * 140) / rect.height / scale;
        const inside =
          worldX >= visible.x &&
          worldX <= visible.x + visible.width &&
          worldY >= visible.y &&
          worldY <= visible.y + visible.height;
        const next = inside
          ? viewport
          : {
              x: size.w / 2 - worldX * viewport.scale,
              y: size.h / 2 - worldY * viewport.scale,
              scale: viewport.scale,
            };
        drag.current = {
          pointerId: event.pointerId,
          clientX: event.clientX,
          clientY: event.clientY,
          viewport: next,
          factorX: (220 / rect.width / scale) * viewport.scale,
          factorY: (140 / rect.height / scale) * viewport.scale,
        };
        setFrozen({ x, y, scale });
        event.currentTarget.setPointerCapture?.(event.pointerId);
        if (!inside) onNavigate(next);
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        if (!start || start.pointerId !== event.pointerId) return;
        onNavigate({
          ...start.viewport,
          x: start.viewport.x - (event.clientX - start.clientX) * start.factorX,
          y: start.viewport.y - (event.clientY - start.clientY) * start.factorY,
        });
      }}
      onPointerUp={stopDrag}
      onPointerCancel={stopDrag}
      onLostPointerCapture={stopDrag}
      onBlur={stopDrag}
      onKeyDown={(event) => {
        const directions: Record<string, readonly [number, number]> = {
          ArrowLeft: [1, 0],
          ArrowRight: [-1, 0],
          ArrowUp: [0, 1],
          ArrowDown: [0, -1],
        };
        const delta = directions[event.key];
        if (!delta) return;
        event.preventDefault();
        event.stopPropagation();
        onNavigate({
          ...viewport,
          x: viewport.x + (delta[0] * size.w) / 10,
          y: viewport.y + (delta[1] * size.h) / 10,
        });
      }}
    >
      <Button
        variant="ghost"
        size="icon"
        className="absolute top-1 right-1 z-10 size-6 bg-[var(--surface-raised)]"
        aria-label={t("canvas.closeMinimap")}
        title={t("canvas.closeMinimap")}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          useUiStore.getState().setMinimapVisible(false);
        }}
      >
        <X className="size-3.5" />
      </Button>
      <svg
        width="100%"
        height="100%"
        viewBox={`${x} ${y} ${220 / scale} ${140 / scale}`}
        aria-hidden="true"
      >
        {boxes.map((box) => (
          <rect
            key={box.id}
            x={box.x}
            y={box.y}
            width={box.width}
            height={box.height}
            fill="var(--text-faint)"
          />
        ))}
        <rect
          x={visible.x}
          y={visible.y}
          width={visible.width}
          height={visible.height}
          fill="var(--brand-soft)"
          fillOpacity={0.5}
          stroke="var(--brand)"
          strokeWidth={2 / scale}
        />
      </svg>
    </div>
  );
}
