import { isDocumentKind } from "@/domain/documentKinds";
import type {
  BoardEdge,
  BoardNode,
  DocumentKind,
  ServerGraph,
} from "@/features/canvas/serverGraph";

export interface BoardFilter {
  project?: string;
  kind?: DocumentKind;
  q?: string;
}

export function parseBoardFilter(search: Record<string, unknown>): BoardFilter {
  const out: BoardFilter = {};
  if (typeof search.project === "string" && search.project) out.project = search.project;
  // Read at call time: a module registered after load adds its kinds.
  if (typeof search.kind === "string" && isDocumentKind(search.kind)) {
    out.kind = search.kind as DocumentKind;
  }
  if (typeof search.q === "string" && search.q) out.q = search.q;
  return out;
}

export function filterBoard(
  graph: ServerGraph,
  filter: BoardFilter,
): { nodes: BoardNode[]; edges: BoardEdge[] } {
  const q = filter.q?.toLowerCase();
  const nodes = graph.nodes.filter(
    (n) =>
      (!filter.project || n.projectId === filter.project) &&
      (!filter.kind || n.kind === filter.kind) &&
      (!q || n.docId.toLowerCase().includes(q)),
  );
  const visible = new Set(nodes.map((n) => n.key));
  return {
    nodes,
    edges: graph.edges.filter((e) => visible.has(e.source) && visible.has(e.target)),
  };
}
