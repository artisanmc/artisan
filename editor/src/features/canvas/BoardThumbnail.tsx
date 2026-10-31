import type { Project } from "@/domain/types";
import { kindAppearance } from "@/lib/documentKindAppearance";
import { useMemo } from "react";
import { projectBoard } from "./autoLayout";
import { boardGraph, deriveServerGraph } from "./serverGraph";

/** Room around the board, in board units, so the outer nodes do not touch the edge. */
const PADDING = 40;

/**
 * A still picture of a project's board, for the module's home: each Document where the
 * board places it, in its kind's colour, the links between them and the folder frames.
 * Built from the same arrangement as the board (`projectBoard`), so it looks like it.
 * Not interactive: the block that holds it opens the board.
 */
export function BoardThumbnail({ project, className }: { project: Project; className?: string }) {
  const picture = useMemo(() => {
    let graph: ReturnType<typeof boardGraph>;
    let board: ReturnType<typeof projectBoard>;
    try {
      graph = boardGraph(deriveServerGraph([project]));
      board = projectBoard(project);
    } catch {
      // A Document the arrangement cannot place (a menu without a size…) costs the
      // picture, never the home: the board itself reports it.
      return null;
    }
    const boxes = new Map(
      graph.nodes.flatMap((n) => {
        const p = board.layout[n.docKey];
        return p ? [[n.key, { x: p.x, y: p.y, w: n.width, h: n.height, kind: n.kind }]] : [];
      }),
    );
    if (boxes.size === 0) return null;
    const frames = board.groups.filter((g) => g.kind === "group");
    const all = [
      ...[...boxes.values()],
      ...frames.map((f) => ({ x: f.x, y: f.y, w: f.width, h: f.height })),
    ];
    const left = Math.min(...all.map((b) => b.x)) - PADDING;
    const top = Math.min(...all.map((b) => b.y)) - PADDING;
    const right = Math.max(...all.map((b) => b.x + b.w)) + PADDING;
    const bottom = Math.max(...all.map((b) => b.y + b.h)) + PADDING;
    const edges = graph.edges.flatMap((e) => {
      const from = boxes.get(e.source);
      const to = boxes.get(e.target);
      return from && to && from !== to ? [{ id: e.id, from, to }] : [];
    });
    return {
      viewBox: `${left} ${top} ${right - left} ${bottom - top}`,
      // Lines and corners keep a readable size whatever the board's extent.
      unit: Math.max(right - left, bottom - top) / 240,
      boxes: [...boxes.entries()],
      frames,
      edges,
    };
  }, [project]);

  if (!picture) return null;
  const { unit } = picture;
  return (
    <svg
      viewBox={picture.viewBox}
      preserveAspectRatio="xMidYMid meet"
      className={className}
      aria-hidden="true"
      data-testid="board-thumbnail"
    >
      {picture.frames.map((f) => (
        <rect
          key={f.key}
          x={f.x}
          y={f.y}
          width={f.width}
          height={f.height}
          rx={unit * 4}
          fill={f.color ?? "var(--text-faint)"}
          fillOpacity={0.12}
          stroke={f.color ?? "var(--border)"}
          strokeOpacity={0.6}
          strokeWidth={unit}
        />
      ))}
      {picture.edges.map(({ id, from, to }) => (
        <line
          key={id}
          x1={from.x + from.w}
          y1={from.y + from.h / 2}
          x2={to.x}
          y2={to.y + to.h / 2}
          stroke="var(--border-strong)"
          strokeWidth={unit}
        />
      ))}
      {picture.boxes.map(([key, b]) => {
        const look = kindAppearance(b.kind);
        return (
          <rect
            key={key}
            x={b.x}
            y={b.y}
            width={b.w}
            height={b.h}
            rx={unit * 3}
            fill={look.soft}
            stroke={look.fg}
            strokeWidth={unit}
          />
        );
      })}
    </svg>
  );
}
