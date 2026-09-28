import type {
  BoardEdge,
  BoardNode,
  DocumentKind,
  ServerGraph,
} from "@/features/canvas/serverGraph";

/**
 * L'état de la planche serveur, porté par l'URL pour qu'une vue filtrée se
 * partage (spec `server-registry-and-derived-canvas`, décision 4).
 *
 * `hide` liste les projects décochés dans le registre : on filtre par
 * soustraction, pour qu'un project apparu depuis le partage du lien soit
 * visible par défaut. `doc` est la clé du Document sélectionné — c'est elle
 * qui remplace l'URL de la vue focus.
 */
export interface BoardFilter {
  hide?: string[];
  kind?: DocumentKind;
  q?: string;
  doc?: string;
}

const KINDS: DocumentKind[] = ["menu", "command", "dialog"];

export function parseBoardFilter(search: Record<string, unknown>): BoardFilter {
  const out: BoardFilter = {};
  const hide = Array.isArray(search.hide)
    ? search.hide.filter((h): h is string => typeof h === "string" && h !== "")
    : typeof search.hide === "string" && search.hide
      ? [search.hide]
      : [];
  if (hide.length > 0) out.hide = [...new Set(hide)].sort();
  if (typeof search.kind === "string" && (KINDS as string[]).includes(search.kind)) {
    out.kind = search.kind as DocumentKind;
  }
  if (typeof search.q === "string" && search.q) out.q = search.q;
  if (typeof search.doc === "string" && search.doc) out.doc = search.doc;
  return out;
}

/** Le texte du filtre vise l'id et le libellé affiché (`/boutique` pour une commande). */
export function matchesQuery(q: string | undefined, docId: string, label?: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return docId.toLowerCase().includes(needle) || (label?.toLowerCase().includes(needle) ?? false);
}

export function filterBoard(
  graph: ServerGraph,
  filter: BoardFilter,
  labelOf: (node: BoardNode) => string | undefined = () => undefined,
): { nodes: BoardNode[]; edges: BoardEdge[] } {
  const hidden = new Set(filter.hide ?? []);
  const nodes = graph.nodes.filter(
    (n) =>
      !hidden.has(n.projectId) &&
      (!filter.kind || n.kind === filter.kind) &&
      matchesQuery(filter.q, n.docId, labelOf(n)),
  );
  const visible = new Set(nodes.map((n) => n.key));
  return {
    nodes,
    edges: graph.edges.filter((e) => visible.has(e.source) && visible.has(e.target)),
  };
}
