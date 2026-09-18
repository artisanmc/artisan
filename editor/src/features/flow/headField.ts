export type HeadSource = "none" | "hdb" | "basehead" | "playerhead";

/**
 * Tête du joueur qui ouvre le menu — le cas courant. `{player.name}` est un
 * placeholder de contexte résolu au rendu par le plugin, pas une valeur figée.
 */
export const VIEWER_HEAD = "playerhead:{player.name}";

export function headSourceOf(head: string): HeadSource {
  if (!head) return "none";
  if (head.startsWith("hdb:")) return "hdb";
  if (head.startsWith("playerhead:")) return "playerhead";
  return "basehead"; // basehead: prefix or raw eyJ…
}

export function headValueOf(head: string): string {
  for (const p of ["hdb:", "basehead:", "playerhead:"]) {
    if (head.startsWith(p)) return head.slice(p.length);
  }
  return head;
}

/** Builds the canonical stored value; pasting "hdb:…" or raw base64 re-detects the source. */
export function buildHeadValue(source: HeadSource, raw: string): string {
  const v = raw.trim();
  if (!v) return "";
  if (v.startsWith("hdb:") || v.startsWith("basehead:") || v.startsWith("playerhead:")) return v;
  if (v.startsWith("eyJ")) return `basehead:${v}`;
  if (source === "hdb") return `hdb:${v}`;
  if (source === "playerhead") return `playerhead:${v}`;
  return `basehead:${v}`;
}
