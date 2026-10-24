import type { DocKey } from "@/domain/documents";
import type { Project } from "@/domain/types";
import { deriveServerGraph } from "@/features/canvas/serverGraph";

/** Who opens whom in a project, keyed by `docKey`. */
export interface DocumentLinks {
  /** The Documents that open this one. */
  parents: ReadonlyMap<DocKey, ReadonlySet<DocKey>>;
  /** The Documents this one opens. */
  children: ReadonlyMap<DocKey, ReadonlySet<DocKey>>;
}

const cache = new WeakMap<Project, DocumentLinks>();

/** The board's links between a project's Documents, both ways (a link to itself left out). */
export function documentLinks(project: Project): DocumentLinks {
  const cached = cache.get(project);
  if (cached) return cached;
  const graph = deriveServerGraph([project]);
  const toDocKey = new Map(graph.nodes.map((n) => [n.key, n.docKey]));
  const parents = new Map<DocKey, Set<DocKey>>();
  const children = new Map<DocKey, Set<DocKey>>();
  for (const e of graph.edges) {
    const from = toDocKey.get(e.source);
    const to = toDocKey.get(e.target);
    if (!from || !to || from === to) continue;
    if (!children.has(from)) children.set(from, new Set());
    children.get(from)!.add(to);
    if (!parents.has(to)) parents.set(to, new Set());
    parents.get(to)!.add(from);
  }
  const links = { parents, children };
  cache.set(project, links);
  return links;
}
