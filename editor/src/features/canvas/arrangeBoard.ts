import { graphlib, layout } from "@dagrejs/dagre";
import type { DocumentKind } from "./serverGraph";

/**
 * Arrangement strategy:
 * - `columns`: dagre LR layers, one rank = one column (original mode).
 * - `wrap`: same, but a column that is too tall folds into sub-columns.
 * - `auto`: `wrap` in LR or TB depending on the board's ratio.
 * - `cluster`: a parent's children are packed as a grid block to its right.
 * - `force`: deterministic springs + repulsion, organic clusters.
 */
export type ArrangeMode = "columns" | "wrap" | "auto" | "cluster" | "force" | "structured";

export interface ArrangeNode {
  key: string;
  kind: DocumentKind;
  width: number;
  height: number;
}

export interface ArrangeEdge {
  source: string;
  target: string;
}

type Point = { x: number; y: number };

export interface Arrangement {
  /** Top-left corners, as `Stage` and `nodeBox` expect them. */
  positions: Record<string, Point>;
  /** Anchor of the gutter's label; `null` if no Document is isolated. */
  gutter: Point | null;
}

export const BOARD_MARGIN = 40;
const RANKSEP = 160;
const NODESEP = 48;
const COMPONENT_GAP = 120;
const ROW_WIDTH = 2400;
const GUTTER_GAP = 160;
export const GUTTER_LABEL_HEIGHT = 36;
const GUTTER_CELL_GAP = 48;
const GUTTER_KIND_ORDER: Record<DocumentKind, number> = { menu: 0, dialog: 1, command: 2 };

/** Height (wrap) or width (TB) budget of a sub-column before folding. */
const WRAP_STACK_MAX = 1500;
/** Maximum number of nodes stacked in a sub-column. */
const WRAP_ROWS_MAX = 5;
/** Height budget of a parent's children block (cluster mode). */
const CLUSTER_STACK_MAX = 1200;
/** Target ratio (width / height) aimed at by auto mode. */
const AUTO_TARGET_RATIO = 16 / 9;

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

interface Placed {
  positions: Record<string, Point>;
  width: number;
  height: number;
}

/** Connected components ignoring edge direction, sorted. */
function components(keys: string[], edges: ArrangeEdge[]): string[][] {
  const parent = new Map(keys.map((k) => [k, k]));
  const find = (k: string): string => {
    let root = k;
    while (parent.get(root) !== root) root = parent.get(root)!;
    parent.set(k, root);
    return root;
  };
  for (const e of edges) {
    const a = find(e.source);
    const b = find(e.target);
    if (a !== b) parent.set(compare(a, b) < 0 ? b : a, compare(a, b) < 0 ? a : b);
  }
  const groups = new Map<string, string[]>();
  for (const k of keys) groups.set(find(k), [...(groups.get(find(k)) ?? []), k]);
  return [...groups.values()]
    .map((g) => g.sort(compare))
    .sort((a, b) => b.length - a.length || compare(a[0]!, b[0]!));
}

/**
 * Back edges of a component: DFS from the nodes nothing targets. An edge to a
 * node still on the stack closes a cycle; it is left out of the layering so a
 * "back to the main menu" does not push the main menu down a layer.
 */
function forwardEdges(keys: string[], edges: ArrangeEdge[], preferredRoots: string[] = []): ArrangeEdge[] {
  const out = new Map<string, string[]>(keys.map((k) => [k, []]));
  const indegree = new Map<string, number>(keys.map((k) => [k, 0]));
  for (const e of edges) {
    out.get(e.source)!.push(e.target);
    indegree.set(e.target, indegree.get(e.target)! + 1);
  }
  for (const targets of out.values()) targets.sort(compare);

  const state = new Map<string, "open" | "done">();
  const back = new Set<string>();
  const visit = (root: string) => {
    state.set(root, "open");
    const stack: { key: string; next: number }[] = [{ key: root, next: 0 }];
    while (stack.length > 0) {
      const top = stack[stack.length - 1]!;
      const targets = out.get(top.key)!;
      if (top.next === targets.length) {
        state.set(top.key, "done");
        stack.pop();
        continue;
      }
      const target = targets[top.next++]!;
      const seen = state.get(target);
      if (seen === "open") back.add(`${top.key}->${target}`);
      else if (!seen) {
        state.set(target, "open");
        stack.push({ key: target, next: 0 });
      }
    }
  };
  // Entry points first by what they open: the one leading to the biggest hub
  // (a main menu) is explored first, so its submenus' "back" links close the
  // cycles — not the alphabetical order of the commands.
  const hub = (k: string) => Math.max(0, ...out.get(k)!.map((t) => out.get(t)!.length));
  const roots = keys
    .filter((k) => indegree.get(k) === 0)
    .sort((a, b) => hub(b) - hub(a) || out.get(b)!.length - out.get(a)!.length || compare(a, b));
  for (const k of preferredRoots) if (out.has(k) && !state.has(k)) visit(k);
  for (const k of roots) if (!state.has(k)) visit(k);
  for (const k of keys) if (!state.has(k)) visit(k);
  return edges.filter((e) => !back.has(`${e.source}->${e.target}`));
}

/**
 * Centres each entry point (node nothing targets: a command) on the Document
 * it opens — the median if it opens several. dagre balances four alignments
 * and often leaves a command halfway. If the spot is taken, the nearest free
 * position: never overlap another node, and never move further than the
 * target Document's height.
 */
function alignEntryPoints(
  nodes: ArrangeNode[],
  edges: ArrangeEdge[],
  centers: Map<string, Point>,
): void {
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  const targeted = new Set(edges.map((e) => e.target));
  const box = (n: ArrangeNode, c: Point) => ({
    left: c.x - n.width / 2,
    right: c.x + n.width / 2,
    top: c.y - n.height / 2,
    bottom: c.y + n.height / 2,
  });
  for (const n of [...nodes].sort((a, b) => compare(a.key, b.key))) {
    if (targeted.has(n.key)) continue;
    const ys = edges
      .filter((e) => e.source === n.key)
      .map((e) => centers.get(e.target)!.y)
      .sort((a, b) => a - b);
    if (ys.length === 0) continue;
    const c = centers.get(n.key)!;
    const targets = edges.filter((e) => e.source === n.key).map((e) => e.target);
    const target = ys[Math.floor((ys.length - 1) / 2)]!;
    const reach = Math.max(...targets.map((k) => byKey.get(k)!.height)) / 2;
    const free = (y: number) => {
      const moved = box(n, { x: c.x, y });
      return nodes.every((o) => {
        if (o.key === n.key) return true;
        const b = box(o, centers.get(o.key)!);
        return (
          moved.right + NODESEP <= b.left ||
          b.right + NODESEP <= moved.left ||
          moved.bottom + NODESEP <= b.top ||
          b.bottom + NODESEP <= moved.top
        );
      });
    };
    for (let d = 0; d <= reach; d += 4) {
      const y = [target - d, target + d].find(free);
      if (y !== undefined) {
        c.y = y;
        break;
      }
    }
  }
}

function layoutComponent(nodes: ArrangeNode[], edges: ArrangeEdge[]): Placed {
  const g = new graphlib.Graph();
  g.setGraph({
    rankdir: "LR",
    ranker: "network-simplex",
    ranksep: RANKSEP,
    nodesep: NODESEP,
    marginx: 0,
    marginy: 0,
  });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodes) g.setNode(n.key, { width: n.width, height: n.height });
  for (const e of edges) g.setEdge(e.source, e.target);
  layout(g);
  const centers = new Map(nodes.map((n) => [n.key, { ...(g.node(n.key) as Point) }]));
  alignEntryPoints(nodes, edges, centers);

  const positions: Record<string, Point> = {};
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  for (const n of nodes) {
    const c = centers.get(n.key)!;
    const p = { x: c.x - n.width / 2, y: c.y - n.height / 2 };
    positions[n.key] = p;
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
  }
  let width = 0;
  let height = 0;
  for (const n of nodes) {
    const p = positions[n.key]!;
    p.x -= minX;
    p.y -= minY;
    width = Math.max(width, p.x + n.width);
    height = Math.max(height, p.y + n.height);
  }
  return { positions, width, height };
}

/**
 * Full arrangement of a board: a layered graph (dagre) per connected
 * component, one component per row, unlinked Documents in the gutter.
 * Deterministic: input order has no effect.
 */
function arrangeFree(
  input: { nodes: ArrangeNode[]; edges: ArrangeEdge[]; preferredRoots?: string[] },
  place: PlaceFn,
): Arrangement {
  const nodes = [...input.nodes].sort((a, b) => compare(a.key, b.key));
  if (nodes.length === 0) return { positions: {}, gutter: null };
  const byKey = new Map(nodes.map((n) => [n.key, n]));

  const seen = new Set<string>();
  const edges: ArrangeEdge[] = [];
  for (const e of input.edges) {
    const id = `${e.source}->${e.target}`;
    if (e.source === e.target || !byKey.has(e.source) || !byKey.has(e.target) || seen.has(id))
      continue;
    seen.add(id);
    edges.push({ source: e.source, target: e.target });
  }
  edges.sort((a, b) => compare(a.source, b.source) || compare(a.target, b.target));

  const linked = new Set(edges.flatMap((e) => [e.source, e.target]));
  const positions: Record<string, Point> = {};

  // One linked group per row: each row is a path read from left to right,
  // starting at its entry point.
  let y = BOARD_MARGIN;
  const groups = components(
    nodes.filter((n) => linked.has(n.key)).map((n) => n.key),
    edges,
  );
  for (const keys of groups) {
    const inGroup = new Set(keys);
    const groupEdges = edges.filter((e) => inGroup.has(e.source));
    const placed = place(
      keys.map((k) => byKey.get(k)!),
      forwardEdges(keys, groupEdges, input.preferredRoots),
      input.preferredRoots ?? [],
    );
    for (const [key, p] of Object.entries(placed.positions))
      positions[key] = { x: BOARD_MARGIN + p.x, y: y + p.y };
    y += placed.height + COMPONENT_GAP;
  }

  const orphans = nodes
    .filter((n) => !linked.has(n.key))
    .sort((a, b) => GUTTER_KIND_ORDER[a.kind] - GUTTER_KIND_ORDER[b.kind] || compare(a.key, b.key));
  if (orphans.length === 0) return { positions, gutter: null };

  const gutter = {
    x: BOARD_MARGIN,
    y: groups.length > 0 ? y - COMPONENT_GAP + GUTTER_GAP : BOARD_MARGIN,
  };
  let gx = BOARD_MARGIN;
  let gy = gutter.y + GUTTER_LABEL_HEIGHT;
  let gRow = 0;
  for (const n of orphans) {
    if (gx > BOARD_MARGIN && gx + n.width > BOARD_MARGIN + ROW_WIDTH) {
      gx = BOARD_MARGIN;
      gy += gRow + GUTTER_CELL_GAP;
      gRow = 0;
    }
    positions[n.key] = { x: gx, y: gy };
    gx += n.width + GUTTER_CELL_GAP;
    gRow = Math.max(gRow, n.height);
  }
  return { positions, gutter };
}

type Rect = Point & { width: number; height: number };
const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

type PlaceFn = (
  nodes: ArrangeNode[],
  forward: ArrangeEdge[],
  preferredRoots: string[],
) => Placed;

interface Sized {
  w: number;
  h: number;
}
interface Packed {
  width: number;
  height: number;
  pos: Point[];
}

/**
 * Splits a component's nodes into layers (dagre) then folds each layer into
 * sub-columns (LR) or sub-rows (TB) as soon as the stack exceeds a budget.
 * Reading order stays left→right, siblings of a layer stay neighbours.
 */
function layoutWrapped(
  nodes: ArrangeNode[],
  edges: ArrangeEdge[],
  _preferredRoots: string[],
  axis: "lr" | "tb",
): Placed {
  if (nodes.length === 0) return { positions: {}, width: 0, height: 0 };
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  const g = new graphlib.Graph();
  g.setGraph({
    rankdir: axis === "lr" ? "LR" : "TB",
    ranker: "network-simplex",
    ranksep: RANKSEP,
    nodesep: NODESEP,
    marginx: 0,
    marginy: 0,
  });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodes) g.setNode(n.key, { width: n.width, height: n.height });
  for (const e of edges) g.setEdge(e.source, e.target);
  layout(g);

  const rankAxisKey = axis === "lr" ? "x" : "y";
  const stackAxisKey = axis === "lr" ? "y" : "x";
  const rankCoord = (key: string) => Math.round((g.node(key) as Point)[rankAxisKey]);
  const stackCoord = (key: string) => Math.round((g.node(key) as Point)[stackAxisKey]);
  const stackSize = (key: string) =>
    axis === "lr" ? byKey.get(key)!.height : byKey.get(key)!.width;
  const rankSize = (key: string) =>
    axis === "lr" ? byKey.get(key)!.width : byKey.get(key)!.height;

  const ranks = [...new Set(nodes.map((n) => rankCoord(n.key)))].sort((a, b) => a - b);
  const rankIndex = new Map(ranks.map((r, i) => [r, i]));
  const buckets: string[][] = ranks.map(() => []);
  for (const n of nodes) buckets[rankIndex.get(rankCoord(n.key))!]!.push(n.key);
  for (const bucket of buckets)
    bucket.sort((a, b) => stackCoord(a) - stackCoord(b) || compare(a, b));

  const rankPos: Record<string, number> = {};
  const stackPos: Record<string, number> = {};
  let rankCursor = 0;
  for (const bucket of buckets) {
    const bands: string[][] = [];
    let cur: string[] = [];
    let curStack = 0;
    for (const key of bucket) {
      const gap = cur.length ? NODESEP : 0;
      if (
        cur.length &&
        (curStack + gap + stackSize(key) > WRAP_STACK_MAX || cur.length >= WRAP_ROWS_MAX)
      ) {
        bands.push(cur);
        cur = [];
        curStack = 0;
      }
      cur.push(key);
      curStack += (cur.length > 1 ? NODESEP : 0) + stackSize(key);
    }
    if (cur.length) bands.push(cur);

    let bandCursor = rankCursor;
    let bandRankExtent = 0;
    for (const band of bands) {
      let stack = 0;
      let bandSelfRank = 0;
      for (const key of band) {
        rankPos[key] = bandCursor;
        stackPos[key] = stack;
        stack += stackSize(key) + NODESEP;
        bandSelfRank = Math.max(bandSelfRank, rankSize(key));
      }
      bandCursor += bandSelfRank + RANKSEP;
      bandRankExtent = bandCursor - rankCursor - RANKSEP;
    }
    rankCursor += bandRankExtent + RANKSEP;
  }

  const positions: Record<string, Point> = {};
  let minRank = Number.POSITIVE_INFINITY;
  let minStack = Number.POSITIVE_INFINITY;
  for (const n of nodes) {
    minRank = Math.min(minRank, rankPos[n.key]!);
    minStack = Math.min(minStack, stackPos[n.key]!);
  }
  let width = 0;
  let height = 0;
  for (const n of nodes) {
    const r = rankPos[n.key]! - minRank;
    const s = stackPos[n.key]! - minStack;
    const p = axis === "lr" ? { x: r, y: s } : { x: s, y: r };
    positions[n.key] = p;
    width = Math.max(width, p.x + n.width);
    height = Math.max(height, p.y + n.height);
  }
  return { positions, width, height };
}

/** Stacks child blocks into columns, folded past a height budget. */
function packBlocks(items: Sized[], maxStack: number, gap: number): Packed {
  const columns: number[][] = [];
  let cur: number[] = [];
  let curStack = 0;
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    if (cur.length && curStack + gap + item.h > maxStack) {
      columns.push(cur);
      cur = [];
      curStack = 0;
    }
    cur.push(i);
    curStack += (cur.length > 1 ? gap : 0) + item.h;
  }
  if (cur.length) columns.push(cur);

  const pos: Point[] = new Array(items.length);
  let x = 0;
  let height = 0;
  for (const column of columns) {
    let y = 0;
    let colWidth = 0;
    for (const i of column) {
      pos[i] = { x, y };
      y += items[i]!.h + gap;
      colWidth = Math.max(colWidth, items[i]!.w);
    }
    height = Math.max(height, y - gap);
    x += colWidth + gap;
  }
  return { width: Math.max(0, x - gap), height, pos };
}

/**
 * The parent on the left, its children packed as a grid block to its right.
 * Tree approximation: a node with several parents only appears under the
 * first one (deterministic order). This is the mode that materialises the
 * logical grouping.
 */
function layoutClustered(
  nodes: ArrangeNode[],
  edges: ArrangeEdge[],
  preferredRoots: string[],
): Placed {
  if (nodes.length === 0) return { positions: {}, width: 0, height: 0 };
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  const keys = nodes.map((n) => n.key);
  const children = new Map<string, string[]>(keys.map((k) => [k, []]));
  const hasParent = new Set<string>();
  const ordered = [...edges].sort(
    (a, b) => compare(a.source, b.source) || compare(a.target, b.target),
  );
  for (const e of ordered) {
    if (hasParent.has(e.target) || !byKey.has(e.source)) continue;
    hasParent.add(e.target);
    children.get(e.source)!.push(e.target);
  }
  for (const list of children.values()) list.sort(compare);
  const pref = new Map(preferredRoots.map((k, i) => [k, i]));
  const roots = keys
    .filter((k) => !hasParent.has(k))
    .sort(
      (a, b) =>
        (pref.get(a) ?? Number.MAX_SAFE_INTEGER) - (pref.get(b) ?? Number.MAX_SAFE_INTEGER) ||
        compare(a, b),
    );

  const sizes = new Map<string, Sized>();
  const packed = new Map<string, Packed>();
  const measure = (key: string): Sized => {
    const cached = sizes.get(key);
    if (cached) return cached;
    const n = byKey.get(key)!;
    const kids = children.get(key)!;
    let size: Sized = { w: n.width, h: n.height };
    if (kids.length) {
      const block = packBlocks(kids.map(measure), CLUSTER_STACK_MAX, NODESEP);
      packed.set(key, block);
      size = { w: n.width + RANKSEP + block.width, h: Math.max(n.height, block.height) };
    }
    sizes.set(key, size);
    return size;
  };

  const positions: Record<string, Point> = {};
  const place = (key: string, x: number, yTop: number) => {
    const n = byKey.get(key)!;
    const size = sizes.get(key)!;
    positions[key] = { x, y: yTop + (size.h - n.height) / 2 };
    const kids = children.get(key)!;
    if (!kids.length) return;
    const block = packed.get(key)!;
    const childX = x + n.width + RANKSEP;
    const childY = yTop + (size.h - block.height) / 2;
    kids.forEach((k, i) => place(k, childX + block.pos[i]!.x, childY + block.pos[i]!.y));
  };

  let y = 0;
  let width = 0;
  for (const root of roots) {
    const size = measure(root);
    place(root, 0, y);
    y += size.h + COMPONENT_GAP;
    width = Math.max(width, size.w);
  }
  return { positions, width, height: Math.max(0, y - COMPONENT_GAP) };
}

/** Calibrated on a seed position, scaled by pushing overlaps apart. */
function separate(rects: Rect[], gap: number): void {
  for (let iter = 0; iter < 80; iter++) {
    let moved = false;
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i]!;
        const b = rects[j]!;
        const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
        const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
        if (overlapX <= 0 || overlapY <= 0) continue;
        moved = true;
        // Push along the axis of least overlap, half each, plus the margin.
        if (overlapX < overlapY) {
          const push = (overlapX + gap) / 2;
          const dir = a.x <= b.x ? 1 : -1;
          a.x -= push * dir;
          b.x += push * dir;
        } else {
          const push = (overlapY + gap) / 2;
          const dir = a.y <= b.y ? 1 : -1;
          a.y -= push * dir;
          b.y += push * dir;
        }
      }
    }
    if (!moved) return;
  }
}

/** Centre-to-centre distance along (ux,uy) at which two rectangles touch. */
function contactDistance(na: ArrangeNode, nb: ArrangeNode, ux: number, uy: number): number {
  return (
    (Math.abs(ux) * na.width + Math.abs(uy) * na.height) / 2 +
    (Math.abs(ux) * nb.width + Math.abs(uy) * nb.height) / 2
  );
}

/** Mean centre of a set of keys. */
function centroid(keys: string[], points: Map<string, Point>): Point {
  let x = 0;
  let y = 0;
  for (const key of keys) {
    const p = points.get(key)!;
    x += p.x;
    y += p.y;
  }
  return { x: x / keys.length, y: y / keys.length };
}

/**
 * Compacts a group: springs at contact distance + rectangle collision, with no
 * far field. Returns top-left corners (not normalised).
 */
function packBySprings(
  nodes: ArrangeNode[],
  links: ArrangeEdge[],
  seedCenters: Map<string, Point>,
  edgeGap: number,
  packGap: number,
): Map<string, Point> {
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  const keys = nodes.map((n) => n.key);
  const centers = new Map<string, Point>(
    keys.map((key) => [key, { ...seedCenters.get(key)! }]),
  );
  const toRects = () =>
    keys.map((key) => {
      const n = byKey.get(key)!;
      const c = centers.get(key)!;
      return {
        key,
        rect: { x: c.x - n.width / 2, y: c.y - n.height / 2, width: n.width, height: n.height },
      };
    });
  if (nodes.length > 1) {
    for (let round = 0; round < 6; round++) {
      for (let it = 0; it < 40; it++) {
        for (const e of links) {
          const na = byKey.get(e.source)!;
          const nb = byKey.get(e.target)!;
          const ca = centers.get(e.source)!;
          const cb = centers.get(e.target)!;
          let dx = cb.x - ca.x;
          let dy = cb.y - ca.y;
          let dist = Math.hypot(dx, dy);
          if (dist < 0.001) {
            dx = 0.001;
            dy = 0;
            dist = 0.001;
          }
          const ux = dx / dist;
          const uy = dy / dist;
          const rest = contactDistance(na, nb, ux, uy) + edgeGap;
          const move = (dist - rest) * 0.25;
          ca.x += ux * move;
          ca.y += uy * move;
          cb.x -= ux * move;
          cb.y -= uy * move;
        }
      }
      const entries = toRects();
      separate(
        entries.map((e) => e.rect),
        packGap,
      );
      for (const { key, rect } of entries) {
        const n = byKey.get(key)!;
        centers.set(key, { x: rect.x + n.width / 2, y: rect.y + n.height / 2 });
      }
    }
  }
  const out = new Map<string, Point>();
  for (const n of nodes) {
    const c = centers.get(n.key)!;
    out.set(n.key, { x: c.x - n.width / 2, y: c.y - n.height / 2 });
  }
  return out;
}

/** Fruchterman-Reingold positions (pulls links together, pushes the rest apart). */
function frCenters(nodes: ArrangeNode[], links: ArrangeEdge[], seed: Placed): Map<string, Point> {
  const keys = nodes.map((n) => n.key);
  const centers = new Map<string, Point>();
  for (const n of nodes) {
    const p = seed.positions[n.key]!;
    centers.set(n.key, { x: p.x + n.width / 2, y: p.y + n.height / 2 });
  }
  const count = keys.length;
  if (count < 2) return centers;
  const avg = nodes.reduce((sum, n) => sum + Math.max(n.width, n.height), 0) / count;
  const k = avg * 2.2;
  const disp = new Map<string, Point>(keys.map((key) => [key, { x: 0, y: 0 }]));
  let temp = k * 2;
  for (let it = 0; it < 160; it++) {
    for (const key of keys) disp.set(key, { x: 0, y: 0 });
    for (let i = 0; i < count; i++) {
      for (let j = i + 1; j < count; j++) {
        const a = keys[i]!;
        const b = keys[j]!;
        const ca = centers.get(a)!;
        const cb = centers.get(b)!;
        let dx = ca.x - cb.x;
        let dy = ca.y - cb.y;
        let dist = Math.hypot(dx, dy);
        if (dist < 0.01) {
          dx = (i - j) * 0.01 + 0.01;
          dy = 0.01;
          dist = Math.hypot(dx, dy);
        }
        const force = (k * k) / dist;
        const ux = dx / dist;
        const uy = dy / dist;
        const da = disp.get(a)!;
        const db = disp.get(b)!;
        da.x += ux * force;
        da.y += uy * force;
        db.x -= ux * force;
        db.y -= uy * force;
      }
    }
    for (const e of links) {
      const ca = centers.get(e.source)!;
      const cb = centers.get(e.target)!;
      const dx = ca.x - cb.x;
      const dy = ca.y - cb.y;
      const dist = Math.hypot(dx, dy) || 0.01;
      const force = (dist * dist) / k;
      const ux = dx / dist;
      const uy = dy / dist;
      const da = disp.get(e.source)!;
      const db = disp.get(e.target)!;
      da.x -= ux * force;
      da.y -= uy * force;
      db.x += ux * force;
      db.y += uy * force;
    }
    for (const key of keys) {
      const c = centers.get(key)!;
      const d = disp.get(key)!;
      const len = Math.hypot(d.x, d.y) || 0.01;
      const step = Math.min(len, temp);
      c.x += (d.x / len) * step;
      c.y += (d.y / len) * step;
    }
    temp = Math.max(0.5, temp * 0.97);
  }
  return centers;
}

/**
 * Detects communities: bridge links between groups stretch under repulsion,
 * those longer than `mean + standard deviation` are cut, then the connected
 * components of the remaining graph are taken.
 */
function detectCommunities(
  keys: string[],
  links: ArrangeEdge[],
  base: Map<string, Point>,
): string[][] {
  if (links.length <= 1) return components(keys, links);
  const lengths = links.map((e) => {
    const a = base.get(e.source)!;
    const b = base.get(e.target)!;
    return Math.hypot(a.x - b.x, a.y - b.y);
  });
  const mean = lengths.reduce((sum, v) => sum + v, 0) / lengths.length;
  const sd = Math.sqrt(
    lengths.reduce((sum, v) => sum + (v - mean) * (v - mean), 0) / lengths.length,
  );
  const threshold = mean + sd;
  const kept = links.filter((_, i) => lengths[i]! <= threshold);
  return components(keys, kept.length ? kept : links);
}

/**
 * Two-level organic layout. A force pass detects the groups (bridge links
 * between communities stretch and are cut past the mean). Each group is then
 * compacted to contact, and the groups are placed at the force positions with
 * a real gap between them: readable groups, without the internal spread of a
 * global repulsion. Deterministic.
 */
function layoutForced(
  nodes: ArrangeNode[],
  edges: ArrangeEdge[],
  preferredRoots: string[],
): Placed {
  if (nodes.length === 0) return { positions: {}, width: 0, height: 0 };
  const seed = layoutWrapped(nodes, edges, preferredRoots, "lr");
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  const keys = nodes.map((n) => n.key);
  const links = edges.filter(
    (e) => e.source !== e.target && byKey.has(e.source) && byKey.has(e.target),
  );
  const base = frCenters(nodes, links, seed);
  const clusters = detectCommunities(keys, links, base);

  const EDGE_GAP = 40;
  const PACK_GAP = 24;
  const positions = new Map<string, Point>();
  const boxes: { members: string[]; placed: Rect; rect: Rect }[] = [];
  for (const members of clusters) {
    const set = new Set(members);
    const memberNodes = members.map((key) => byKey.get(key)!);
    const inner = links.filter((e) => set.has(e.source) && set.has(e.target));
    const seedSub = new Map(members.map((key) => [key, base.get(key)!]));
    const local = packBySprings(memberNodes, inner, seedSub, EDGE_GAP, PACK_GAP);
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const n of memberNodes) {
      const p = local.get(n.key)!;
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x + n.width);
      maxY = Math.max(maxY, p.y + n.height);
    }
    const anchor = centroid(members, base);
    const dx = anchor.x - (minX + (maxX - minX) / 2);
    const dy = anchor.y - (minY + (maxY - minY) / 2);
    for (const n of memberNodes) {
      const p = local.get(n.key)!;
      positions.set(n.key, { x: p.x + dx, y: p.y + dy });
    }
    const placed = { x: minX + dx, y: minY + dy, width: maxX - minX, height: maxY - minY };
    boxes.push({ members, placed, rect: { ...placed } });
  }

  // Compacts the groups together: each block is a node of a complete
  // meta-graph, sprung to contact and pushed apart by collision. Groups stay
  // tight overall while keeping a clear gap between them.
  const META_EDGE_GAP = 140;
  const META_PACK_GAP = 180;
  const metaNodes: ArrangeNode[] = boxes.map((b, i) => ({
    key: `@c${i}`,
    kind: "menu",
    width: b.placed.width,
    height: b.placed.height,
  }));
  const metaLinks: ArrangeEdge[] = [];
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++)
      metaLinks.push({ source: `@c${i}`, target: `@c${j}` });
  const metaSeed = new Map(
    boxes.map((b, i) => [
      `@c${i}`,
      { x: b.placed.x + b.placed.width / 2, y: b.placed.y + b.placed.height / 2 },
    ]),
  );
  const metaPacked = packBySprings(metaNodes, metaLinks, metaSeed, META_EDGE_GAP, META_PACK_GAP);
  boxes.forEach((b, i) => {
    const p = metaPacked.get(`@c${i}`)!;
    const ddx = p.x - b.placed.x;
    const ddy = p.y - b.placed.y;
    b.rect = { ...b.placed, x: p.x, y: p.y };
    if (!ddx && !ddy) return;
    for (const key of b.members) {
      const q = positions.get(key)!;
      q.x += ddx;
      q.y += ddy;
    }
  });

  const out: Record<string, Point> = {};
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  for (const n of nodes) {
    const p = positions.get(n.key)!;
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
  }
  let width = 0;
  let height = 0;
  for (const n of nodes) {
    const p = positions.get(n.key)!;
    const q = { x: p.x - minX, y: p.y - minY };
    out[n.key] = q;
    width = Math.max(width, q.x + n.width);
    height = Math.max(height, q.y + n.height);
  }
  return { positions: out, width, height };
}

/**
 * Structured: same groups as `force`, but each group is laid out in compact
 * layers (folded columns, navigation order) and the blocks are placed in
 * aligned rows. Less organic, more readable.
 */
function layoutStructured(
  nodes: ArrangeNode[],
  edges: ArrangeEdge[],
  preferredRoots: string[],
): Placed {
  if (nodes.length === 0) return { positions: {}, width: 0, height: 0 };
  const seed = layoutWrapped(nodes, edges, preferredRoots, "lr");
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  const keys = nodes.map((n) => n.key);
  const links = edges.filter(
    (e) => e.source !== e.target && byKey.has(e.source) && byKey.has(e.target),
  );
  const base = frCenters(nodes, links, seed);
  const communities = detectCommunities(keys, links, base);

  const GAP = 220;
  const blocks = communities.map((members) => {
    const set = new Set(members);
    const inner = links.filter((e) => set.has(e.source) && set.has(e.target));
    return {
      members,
      placed: layoutWrapped(
        members.map((key) => byKey.get(key)!),
        inner,
        [],
        "lr",
      ),
    };
  });

  // Rows: tall blocks first for regular rows; target width ≈ screen ratio
  // applied to the total area.
  const ordered = [...blocks].sort(
    (a, b) => b.placed.height - a.placed.height || compare(a.members[0]!, b.members[0]!),
  );
  const totalArea = ordered.reduce(
    (sum, b) => sum + (b.placed.width + GAP) * (b.placed.height + GAP),
    0,
  );
  const rowWidth = Math.max(1200, Math.sqrt(totalArea * AUTO_TARGET_RATIO));

  const out: Record<string, Point> = {};
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  for (const block of ordered) {
    if (x > 0 && x + block.placed.width > rowWidth) {
      x = 0;
      y += rowHeight + GAP;
      rowHeight = 0;
    }
    for (const key of block.members) {
      const p = block.placed.positions[key]!;
      out[key] = { x: x + p.x, y: y + p.y };
    }
    x += block.placed.width + GAP;
    rowHeight = Math.max(rowHeight, block.placed.height);
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  for (const n of nodes) {
    minX = Math.min(minX, out[n.key]!.x);
    minY = Math.min(minY, out[n.key]!.y);
  }
  let width = 0;
  let height = 0;
  for (const n of nodes) {
    const p = out[n.key]!;
    p.x -= minX;
    p.y -= minY;
    width = Math.max(width, p.x + n.width);
    height = Math.max(height, p.y + n.height);
  }
  return { positions: out, width, height };
}

/** Distance from the target ratio: 0 = ideally proportioned board. */
function aspectDistance(arrangement: Arrangement, nodes: ArrangeNode[]): number {
  let maxX = 0;
  let maxY = 0;
  for (const n of nodes) {
    const p = arrangement.positions[n.key];
    if (!p) continue;
    maxX = Math.max(maxX, p.x + n.width);
    maxY = Math.max(maxY, p.y + n.height);
  }
  const ratio = maxX / Math.max(1, maxY);
  return Math.abs(Math.log(Math.max(1e-6, ratio)) - Math.log(AUTO_TARGET_RATIO));
}

function resolveArrangement(input: {
  nodes: ArrangeNode[];
  edges: ArrangeEdge[];
  preferredRoots?: string[];
  mode?: ArrangeMode;
}): Arrangement {
  const mode = input.mode ?? "columns";
  if (mode === "auto") {
    const lr = arrangeFree(input, (n, f, p) => layoutWrapped(n, f, p, "lr"));
    const tb = arrangeFree(input, (n, f, p) => layoutWrapped(n, f, p, "tb"));
    return aspectDistance(tb, input.nodes) < aspectDistance(lr, input.nodes) ? tb : lr;
  }
  const place: PlaceFn =
    mode === "wrap"
      ? (n, f, p) => layoutWrapped(n, f, p, "lr")
      : mode === "cluster"
        ? (n, f, p) => layoutClustered(n, f, p)
        : mode === "force"
          ? (n, f, p) => layoutForced(n, f, p)
          : mode === "structured"
            ? (n, f, p) => layoutStructured(n, f, p)
            : (n, f) => layoutComponent(n, f);
  return arrangeFree(input, place);
}

/**
 * The arrangement, with the positions pinned by the user. A pinned node stays
 * in the computation (its edges structure its neighbours' layers): pinning a
 * node where it already was therefore moves nothing. Only automatic nodes
 * overlapping a pinned node move down their column. Two pinned nodes may
 * overlap: the user wanted it.
 */
export function arrangeBoard(input: {
  nodes: ArrangeNode[];
  edges: ArrangeEdge[];
  pinned?: Record<string, Point>;
  preferredRoots?: string[];
  mode?: ArrangeMode;
}): Arrangement {
  const arrangement = resolveArrangement(input);
  const byKey = new Map(input.nodes.map((n) => [n.key, n]));
  const pins = Object.entries(input.pinned ?? {}).filter(([key]) => byKey.has(key));
  if (pins.length === 0) return arrangement;

  const positions = { ...arrangement.positions };
  const settled: Rect[] = [];
  for (const [key, p] of pins) {
    positions[key] = { x: p.x, y: p.y };
    settled.push({ x: p.x, y: p.y, width: byKey.get(key)!.width, height: byKey.get(key)!.height });
  }
  const pinnedKeys = new Set(pins.map(([key]) => key));
  const autos = [...byKey.values()]
    .filter((n) => !pinnedKeys.has(n.key))
    .sort((a, b) => {
      const pa = positions[a.key]!;
      const pb = positions[b.key]!;
      return pa.y - pb.y || pa.x - pb.x || compare(a.key, b.key);
    });
  for (const n of autos) {
    const r: Rect = { ...positions[n.key]!, width: n.width, height: n.height };
    let hit = settled.find((s) => overlaps(s, r));
    while (hit) {
      r.y = hit.y + hit.height + NODESEP;
      hit = settled.find((s) => overlaps(s, r));
    }
    positions[n.key] = { x: r.x, y: r.y };
    settled.push(r);
  }
  return { positions, gutter: arrangement.gutter };
}
