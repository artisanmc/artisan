import type { Edge } from "./deriveEdges";

export interface OffBoardLink {
  source: string;
  target: string;
}

/** Liens dont la source est sur la planche mais la cible non — candidats aux chips. Dédupliqué par (source,target). */
export function offBoardLinks(
  edges: Edge[],
  layout: Record<string, { x: number; y: number }>,
): OffBoardLink[] {
  const seen = new Set<string>();
  const out: OffBoardLink[] = [];
  for (const e of edges) {
    if (!layout[e.source] || layout[e.target]) continue;
    const key = `${e.source}->${e.target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ source: e.source, target: e.target });
  }
  return out;
}
