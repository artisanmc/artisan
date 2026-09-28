import type { Project } from "@/domain/types";
import { projectBoard } from "@/features/canvas/autoLayout";
import { COMMAND_BOX, menuBoxSize } from "@/features/canvas/menuLayout";
import { useTranslation } from "react-i18next";

interface ProjectMiniPreviewProps {
  project: Project;
}

const VIEW_W = 200;
const VIEW_H = 100;
const PADDING = 6;

/**
 * Cheap SVG snapshot of a project's canvas: each menu/command is a filled rect at
 * its canvasLayout position, scaled uniformly to fit the viewBox. No edges, no
 * text, no interactivity — just visual recognition. Reads the same autoLayout
 * fallback as the live canvas so projects the user hasn't manually positioned
 * still render.
 */
export function ProjectMiniPreview({ project }: ProjectMiniPreviewProps) {
  const { t } = useTranslation();
  const board = projectBoard(project);
  const layout = board.layout;
  const boxes = [
    ...(project.menus ?? []).filter((m) => layout[m.id]).map((m) => ({
      pos: layout[m.id] ?? { x: 0, y: 0 },
      size: menuBoxSize(m.inventoryType ?? "chest", m.rows),
      kind: "menu" as const,
    })),
    ...(project.commands ?? []).filter((c) => layout[c.id]).map((c) => ({
      pos: layout[c.id] ?? { x: 0, y: 0 },
      size: COMMAND_BOX,
      kind: "command" as const,
    })),
  ];

  if (boxes.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center text-[10px] text-[var(--text-faint)]">
        {t("projectMini.emptyPreview")}
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
      aria-label={`Preview of ${project.name}`}
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
          fill={b.kind === "menu" ? "var(--surface-raised-2)" : "var(--warning-soft)"}
          stroke={b.kind === "menu" ? "var(--border)" : "var(--warning)"}
          strokeWidth={0.5}
        />
      ))}
    </svg>
  );
}
