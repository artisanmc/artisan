import { graphlib, layout } from "@dagrejs/dagre";
import type { DocumentKind } from "./serverGraph";

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
  /** Coins haut-gauche, comme `Stage` et `nodeBox` les attendent. */
  positions: Record<string, Point>;
  /** Ancre de l'intitulé de la gouttière ; `null` si aucun Document n'est isolé. */
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

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

interface Placed {
  positions: Record<string, Point>;
  width: number;
  height: number;
}

/** Composantes connexes sans tenir compte du sens des arêtes, triées. */
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
 * Arêtes retour d'une composante : DFS depuis les nœuds que rien ne cible.
 * Une arête vers un nœud encore sur la pile referme un cycle ; on l'écarte du
 * calcul des couches pour qu'un « retour au menu principal » ne repousse pas
 * le menu principal d'une couche.
 */
function forwardEdges(keys: string[], edges: ArrangeEdge[]): ArrangeEdge[] {
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
  for (const k of roots) if (!state.has(k)) visit(k);
  for (const k of keys) if (!state.has(k)) visit(k);
  return edges.filter((e) => !back.has(`${e.source}->${e.target}`));
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

  const positions: Record<string, Point> = {};
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  for (const n of nodes) {
    const c = g.node(n.key) as { x: number; y: number };
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
 * Arrangement complet d'une planche : un graphe par couches (dagre) par
 * composante connexe, une composante par ligne, les Documents sans
 * lien en gouttière. Déterministe : l'ordre d'entrée n'a aucun effet.
 */
function arrangeFree(input: { nodes: ArrangeNode[]; edges: ArrangeEdge[] }): Arrangement {
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

  // Un groupe relié par ligne : chaque ligne est un parcours qui se lit de
  // gauche à droite, depuis son point d'entrée.
  let y = BOARD_MARGIN;
  const groups = components(
    nodes.filter((n) => linked.has(n.key)).map((n) => n.key),
    edges,
  );
  for (const keys of groups) {
    const inGroup = new Set(keys);
    const groupEdges = edges.filter((e) => inGroup.has(e.source));
    const placed = layoutComponent(
      keys.map((k) => byKey.get(k)!),
      forwardEdges(keys, groupEdges),
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

/**
 * L'arrangement, avec les positions fixées par l'utilisateur. Un nœud fixé
 * reste dans le calcul (ses arêtes structurent les couches de ses voisins) :
 * fixer un nœud là où il était déjà ne déplace donc rien. Seuls les nœuds
 * automatiques qui chevauchent un nœud fixé descendent dans leur colonne.
 * Deux nœuds fixés peuvent se chevaucher : c'est l'utilisateur qui l'a voulu.
 */
export function arrangeBoard(input: {
  nodes: ArrangeNode[];
  edges: ArrangeEdge[];
  pinned?: Record<string, Point>;
}): Arrangement {
  const arrangement = arrangeFree(input);
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
