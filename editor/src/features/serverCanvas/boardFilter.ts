import type {
  BoardEdge,
  BoardNode,
  DocumentKind,
  ServerGraph,
} from "@/features/canvas/serverGraph";
import { listDocumentKinds } from "@/domain/documentKinds";

export interface BoardFilter {
  project?: string;
  kind?: DocumentKind;
  q?: string;
}

const KINDS: DocumentKind[] = listDocumentKinds().map((def) => def.kind);

export function parseBoardFilter(search: Record<string, unknown>): BoardFilter {
  const out: BoardFilter = {};
  if (typeof search.project === "string" && search.project) out.project = search.project;
  if (typeof search.kind === "string" && (KINDS as string[]).includes(search.kind)) {
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
