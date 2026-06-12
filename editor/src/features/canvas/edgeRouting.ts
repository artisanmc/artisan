import type { AnchorSide, EdgeAnchor } from "@/domain/types";
import type { Edge } from "./deriveEdges";

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Outward unit normal of each side. */
export const OUT_NORMAL: Record<AnchorSide, Point> = {
  top: { x: 0, y: -1 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

export function anchorPoint(box: Box, a: EdgeAnchor): Point {
  const t = clamp01(a.t);
  switch (a.side) {
    case "top":
      return { x: box.x + box.width * t, y: box.y };
    case "bottom":
      return { x: box.x + box.width * t, y: box.y + box.height };
    case "left":
      return { x: box.x, y: box.y + box.height * t };
    case "right":
      return { x: box.x + box.width, y: box.y + box.height * t };
  }
}

/** Nearest border position for an arbitrary point (used to snap handle drags). */
export function closestAnchorOnBox(box: Box, p: Point): EdgeAnchor {
  const dTop = Math.abs(p.y - box.y);
  const dBottom = Math.abs(p.y - (box.y + box.height));
  const dLeft = Math.abs(p.x - box.x);
  const dRight = Math.abs(p.x - (box.x + box.width));
  const tx = clamp01((p.x - box.x) / box.width);
  const ty = clamp01((p.y - box.y) / box.height);
  const min = Math.min(dTop, dBottom, dLeft, dRight);
  if (min === dTop) return { side: "top", t: tx };
  if (min === dBottom) return { side: "bottom", t: tx };
  if (min === dLeft) return { side: "left", t: ty };
  return { side: "right", t: ty };
}

/** Side of `from` facing `to`, by dominant axis between centers. */
export function autoSide(from: Box, to: Box): AnchorSide {
  const dx = to.x + to.width / 2 - (from.x + from.width / 2);
  const dy = to.y + to.height / 2 - (from.y + from.height / 2);
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "right" : "left";
  return dy >= 0 ? "bottom" : "top";
}

export interface RoutedEdge {
  edge: Edge;
  from: Point & { side: AnchorSide };
  to: Point & { side: AnchorSide };
  /** Cubic bezier: [x0,y0, cx1,cy1, cx2,cy2, x1,y1] — feed Konva Arrow with bezier. */
  points: number[];
}

interface Endpoint {
  edgeIndex: number;
  end: "from" | "to";
  nodeId: string;
  side: AnchorSide;
  /** Set when the user overrode this endpoint — t is final. */
  fixedT?: number;
  /** Sort key for autos: opposite node center projected along the side axis. */
  sortKey: number;
}

function sortKeyFor(box: Box, side: AnchorSide, opposite: Box): number {
  const ocx = opposite.x + opposite.width / 2;
  const ocy = opposite.y + opposite.height / 2;
  // Vertical sides order by the opposite's y, horizontal sides by its x.
  // Unclamped on purpose: far-away nodes still order correctly vs fixed t in [0,1].
  if (side === "left" || side === "right") return (ocy - box.y) / box.height;
  return (ocx - box.x) / box.width;
}

const CTRL_MIN = 24;
const CTRL_MAX = 160;
const CTRL_RATIO = 0.4;

export function routeEdges(args: {
  edges: Edge[];
  boxes: Record<string, Box>;
  overrides?: Record<string, { from?: EdgeAnchor; to?: EdgeAnchor }>;
}): RoutedEdge[] {
  const { edges, boxes, overrides = {} } = args;

  const pairs: ({ fromEp: Endpoint; toEp: Endpoint } | null)[] = edges.map((e, edgeIndex) => {
    const src = boxes[e.source];
    const tgt = boxes[e.target];
    if (!src || !tgt) return null;
    const ov = overrides[e.id];
    const fromSide = ov?.from?.side ?? autoSide(src, tgt);
    const toSide = ov?.to?.side ?? autoSide(tgt, src);
    const fromEp: Endpoint = {
      edgeIndex,
      end: "from",
      nodeId: e.source,
      side: fromSide,
      fixedT: ov?.from ? clamp01(ov.from.t) : undefined,
      sortKey: sortKeyFor(src, fromSide, tgt),
    };
    const toEp: Endpoint = {
      edgeIndex,
      end: "to",
      nodeId: e.target,
      side: toSide,
      fixedT: ov?.to ? clamp01(ov.to.t) : undefined,
      sortKey: sortKeyFor(tgt, toSide, src),
    };
    return { fromEp, toEp };
  });

  // Group endpoints per (node, side), sort, distribute t slots. Overridden
  // endpoints keep their exact t but still occupy a position in the ordering.
  const groups = new Map<string, Endpoint[]>();
  for (const pair of pairs) {
    if (!pair) continue;
    for (const ep of [pair.fromEp, pair.toEp]) {
      const key = `${ep.nodeId}|${ep.side}`;
      const group = groups.get(key);
      if (group) group.push(ep);
      else groups.set(key, [ep]);
    }
  }
  const tOf = new Map<Endpoint, number>();
  for (const group of groups.values()) {
    group.sort(
      (a, b) =>
        (a.fixedT ?? a.sortKey) - (b.fixedT ?? b.sortKey) ||
        a.edgeIndex - b.edgeIndex ||
        (a.end === "from" ? -1 : 1) - (b.end === "from" ? -1 : 1),
    );
    group.forEach((ep, i) => {
      tOf.set(ep, ep.fixedT ?? (i + 1) / (group.length + 1));
    });
  }

  const out: RoutedEdge[] = [];
  edges.forEach((e, i) => {
    const pair = pairs[i];
    if (!pair) return;
    const src = boxes[e.source]!;
    const tgt = boxes[e.target]!;
    const p0 = anchorPoint(src, { side: pair.fromEp.side, t: tOf.get(pair.fromEp)! });
    const p3 = anchorPoint(tgt, { side: pair.toEp.side, t: tOf.get(pair.toEp)! });
    const dist = Math.hypot(p3.x - p0.x, p3.y - p0.y);
    const len = Math.min(CTRL_MAX, Math.max(CTRL_MIN, dist * CTRL_RATIO));
    const n0 = OUT_NORMAL[pair.fromEp.side];
    const n3 = OUT_NORMAL[pair.toEp.side];
    out.push({
      edge: e,
      from: { ...p0, side: pair.fromEp.side },
      to: { ...p3, side: pair.toEp.side },
      points: [
        p0.x,
        p0.y,
        p0.x + n0.x * len,
        p0.y + n0.y * len,
        p3.x + n3.x * len,
        p3.y + n3.y * len,
        p3.x,
        p3.y,
      ],
    });
  });
  return out;
}
