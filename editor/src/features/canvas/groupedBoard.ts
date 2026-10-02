import { normalizeCanvasGroups } from "@/domain/canvasGroups";
import type { Project } from "@/domain/types";
import { type ArrangeEdge, type ArrangeMode, type ArrangeNode, arrangeBoard } from "./arrangeBoard";
import type { Edge } from "./deriveEdges";
import type { Box } from "./edgeRouting";
import { type ServerGraph, documentKey } from "./serverGraph";

type Point = { x: number; y: number };
const PAD = 24;
export const GROUP_HEADER = 40;

export interface BoardGroup extends Box {
  key: string;
  id: string;
  projectId: Project["id"];
  name: string;
  kind: "project" | "group";
  color?: string;
  members: string[];
}

export interface GroupedArrangement {
  positions: Record<string, Point>;
  allPositions: Record<string, Point>;
  groups: BoardGroup[];
  representatives: Record<string, string>;
  gutter: Point | null;
}

export const projectGroupKey = (id: string) => `@project/${id}`;
const manualKey = (projectId: string, id: string) => `@group/${projectId}/${id}`;

function bounds(boxes: Box[]): Box {
  if (!boxes.length) return { x: 40, y: 40, width: 0, height: 0 };
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  return {
    x,
    y,
    width: Math.max(...boxes.map((b) => b.x + b.width)) - x,
    height: Math.max(...boxes.map((b) => b.y + b.height)) - y,
  };
}

function navigationRoot(
  nodes: ArrangeNode[],
  edges: ArrangeEdge[],
  entries: string[] = [],
): string[] {
  const targets = (key: string) =>
    new Set(edges.filter((e) => e.source === key && e.target !== key).map((e) => e.target)).size;
  const menus = nodes.filter((n) => n.kind === "menu");
  const candidates = menus.length ? menus : [...nodes];
  candidates.sort(
    (a, b) =>
      Number(entries.includes(b.key)) - Number(entries.includes(a.key)) ||
      targets(b.key) - targets(a.key) ||
      (a.key < b.key ? -1 : 1),
  );
  return candidates[0] ? [candidates[0].key] : [];
}

/** Layout each manual group first, then place its box alongside ungrouped documents. */
export function arrangeProjectGroups(
  project: Project,
  graph: Pick<ServerGraph, "nodes" | "edges">,
  options: { releaseOuterPositions?: boolean; mode?: ArrangeMode } = {},
): GroupedArrangement {
  const nodes = graph.nodes.filter((n) => n.projectId === project.id);
  const live = new Set(nodes.map((n) => n.key));
  const edges = graph.edges.filter((e) => live.has(e.source) && live.has(e.target));
  const groups = normalizeCanvasGroups(
    project.canvasGroups,
    nodes.map((n) => n.docId),
  );
  const parent = new Map<string, string>();
  const inner = new Map<
    string,
    { positions: Record<string, Point>; bounds: Box; members: string[] }
  >();
  const outerNodes: ArrangeNode[] = [];
  const pins: Record<string, Point> = {};
  const metadata = new Map(groups.map((g) => [manualKey(project.id, g.id), g]));
  for (const [key, group] of metadata) {
    const members = group.nodeIds.map((id) => documentKey(project.id, id));
    const memberSet = new Set(members);
    for (const id of members) parent.set(id, key);
    const childNodes = nodes.filter((n) => memberSet.has(n.key));
    const childEdges = edges.filter((e) => memberSet.has(e.source) && memberSet.has(e.target));
    const childPins = Object.fromEntries(
      childNodes.flatMap((n) => {
        const p = project.canvasLayout[n.docId as keyof typeof project.canvasLayout];
        return p ? [[n.key, p]] : [];
      }),
    );
    const entryMenus = edges
      .filter((e) => !memberSet.has(e.source) && memberSet.has(e.target))
      .map((e) => e.target);
    const arranged = arrangeBoard({
      nodes: childNodes,
      edges: childEdges,
      pinned: childPins,
      preferredRoots: navigationRoot(childNodes, childEdges, entryMenus),
      mode: options.mode,
    });
    const box = bounds(
      childNodes.map((n) => ({ ...arranged.positions[n.key]!, width: n.width, height: n.height })),
    );
    inner.set(key, { positions: arranged.positions, bounds: box, members });
    outerNodes.push({
      key,
      kind: "menu",
      width: Math.max(240, box.width + PAD * 2),
      height: box.height + GROUP_HEADER + PAD,
    });
    if (Object.keys(childPins).length) pins[key] = { x: box.x - PAD, y: box.y - GROUP_HEADER };
    else if (group.position) pins[key] = group.position;
  }
  for (const n of nodes) {
    if (parent.has(n.key)) continue;
    outerNodes.push(n);
    const p = project.canvasLayout[n.docId as keyof typeof project.canvasLayout];
    if (p) pins[n.key] = p;
  }
  const outerEdges = edges
    .map((e) => ({
      source: parent.get(e.source) ?? e.source,
      target: parent.get(e.target) ?? e.target,
    }))
    .filter((e) => e.source !== e.target);
  const arranged = arrangeBoard({
    nodes: outerNodes,
    edges: outerEdges,
    pinned: options.releaseOuterPositions ? {} : pins,
    mode: options.mode,
    ...(groups.length ? { preferredRoots: navigationRoot(outerNodes, outerEdges) } : {}),
  });
  const result: GroupedArrangement = {
    positions: {},
    allPositions: {},
    groups: [],
    representatives: {},
    gutter: arranged.gutter,
  };
  for (const n of nodes) {
    const key = parent.get(n.key);
    const child = key ? inner.get(key)! : null;
    const anchor = arranged.positions[key ?? n.key]!;
    const p = child
      ? {
          x: anchor.x + PAD + child.positions[n.key]!.x - child.bounds.x,
          y: anchor.y + GROUP_HEADER + child.positions[n.key]!.y - child.bounds.y,
        }
      : anchor;
    result.allPositions[n.key] = p;
    result.positions[n.key] = p;
    result.representatives[n.key] = n.key;
  }
  for (const [key, group] of metadata) {
    const box = outerNodes.find((n) => n.key === key)!;
    result.groups.push({
      key,
      id: group.id,
      projectId: project.id,
      name: group.name,
      kind: "group",
      color: group.color,
      members: inner.get(key)!.members,
      ...arranged.positions[key]!,
      width: box.width,
      height: box.height,
    });
  }
  if (nodes.length) {
    const box = bounds(
      outerNodes.map((n) => ({ ...arranged.positions[n.key]!, width: n.width, height: n.height })),
    );
    const root: BoardGroup = {
      key: projectGroupKey(project.id),
      id: project.id,
      projectId: project.id,
      name: project.name,
      kind: "project",
      members: nodes.map((n) => n.key),
      x: box.x - PAD,
      y: box.y - GROUP_HEADER,
      width: box.width + PAD * 2,
      height: box.height + GROUP_HEADER + PAD,
    };
    result.groups.unshift(root);
  }
  return result;
}

/** Project boxes are the only nodes seen by the outer server layout. */
export function serverBoard(
  projects: Project[],
  graph: Pick<ServerGraph, "nodes" | "edges">,
): GroupedArrangement {
  const boards = projects
    .map((project) => ({ project, board: arrangeProjectGroups(project, graph) }))
    .filter(({ board }) => board.groups.length > 0);
  const projectOf = new Map(graph.nodes.map((n) => [n.key, projectGroupKey(n.projectId)]));
  const nodes = boards.map(({ board }) => ({ ...board.groups[0]!, kind: "menu" as const }));
  const edges = graph.edges
    .map((e) => ({ source: projectOf.get(e.source)!, target: projectOf.get(e.target)! }))
    .filter((e) => e.source && e.target && e.source !== e.target);
  const outer = arrangeBoard({ nodes, edges });
  const result: GroupedArrangement = {
    positions: {},
    allPositions: {},
    groups: [],
    representatives: {},
    gutter: null,
  };
  for (const { board } of boards) {
    const frame = board.groups[0]!;
    const position = outer.positions[frame.key]!;
    const dx = position.x - frame.x;
    const dy = position.y - frame.y;
    const shift = (p: Point) => ({ x: p.x + dx, y: p.y + dy });
    for (const [key, p] of Object.entries(board.positions)) result.positions[key] = shift(p);
    for (const [key, p] of Object.entries(board.allPositions)) result.allPositions[key] = shift(p);
    result.groups.push(...board.groups.map((g) => ({ ...g, ...shift(g) })));
    Object.assign(result.representatives, board.representatives);
  }
  return result;
}

/** Hidden endpoints converge on their folded frame; internal links disappear. */
export function groupEdges(edges: Edge[], representatives: Record<string, string>): Edge[] {
  const result = new Map<string, Edge>();
  for (const edge of edges) {
    const source = representatives[edge.source] ?? edge.source;
    const target = representatives[edge.target] ?? edge.target;
    const changed = source !== edge.source || target !== edge.target;
    if (source === target && changed) continue;
    const id = changed ? `${source}->${target}` : edge.id;
    const existing = result.get(id);
    if (existing) existing.triggers.push(...edge.triggers);
    else result.set(id, { ...edge, id, source, target, triggers: [...edge.triggers] });
  }
  return [...result.values()];
}
