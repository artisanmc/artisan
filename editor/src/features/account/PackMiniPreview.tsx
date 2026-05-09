import type { Pack } from "@/domain/types";
import { autoLayout } from "@/features/canvas/autoLayout";
import { COMMAND_BOX, menuBoxSize } from "@/features/canvas/menuLayout";

interface PackMiniPreviewProps {
  pack: Pack;
}

const VIEW_W = 200;
const VIEW_H = 100;
const PADDING = 6;

/**
 * Cheap SVG snapshot of a pack's canvas: each menu/command is a filled rect at
 * its canvasLayout position, scaled uniformly to fit the viewBox. No edges, no
 * text, no interactivity — just visual recognition. Reads the same autoLayout
 * fallback as the live canvas so packs the user hasn't manually positioned
 * still render.
 */
export function PackMiniPreview({ pack }: PackMiniPreviewProps) {
  const layout = autoLayout(pack);
  const boxes = [
    ...(pack.menus ?? []).map((m) => ({
      pos: layout[m.id] ?? { x: 0, y: 0 },
      size: menuBoxSize(m.rows),
      kind: "menu" as const,
    })),
    ...(pack.commands ?? []).map((c) => ({
      pos: layout[c.id] ?? { x: 0, y: 0 },
      size: COMMAND_BOX,
      kind: "command" as const,
    })),
  ];

  if (boxes.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center text-[10px] text-zinc-600">
        empty
      </div>
    );
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const { pos, size } of boxes) {
    if (pos.x < minX) minX = pos.x;
    if (pos.y < minY) minY = pos.y;
    if (pos.x + size.width > maxX) maxX = pos.x + size.width;
    if (pos.y + size.height > maxY) maxY = pos.y + size.height;
  }
  const contentW = Math.max(1, maxX - minX);
  const contentH = Math.max(1, maxY - minY);
  const scale = Math.min((VIEW_W - PADDING * 2) / contentW, (VIEW_H - PADDING * 2) / contentH);
  const offsetX = PADDING + (VIEW_W - PADDING * 2 - contentW * scale) / 2 - minX * scale;
  const offsetY = PADDING + (VIEW_H - PADDING * 2 - contentH * scale) / 2 - minY * scale;

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      className="h-full w-full"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={`Preview of ${pack.name}`}
    >
      {boxes.map((b, i) => (
        <rect
          // biome-ignore lint/suspicious/noArrayIndexKey: order is stable for one render
          key={i}
          x={b.pos.x * scale + offsetX}
          y={b.pos.y * scale + offsetY}
          width={Math.max(2, b.size.width * scale)}
          height={Math.max(2, b.size.height * scale)}
          rx={1}
          fill={b.kind === "menu" ? "#27272a" : "#422006"}
          stroke={b.kind === "menu" ? "#3a3a3f" : "#a16207"}
          strokeWidth={0.5}
        />
      ))}
    </svg>
  );
}
