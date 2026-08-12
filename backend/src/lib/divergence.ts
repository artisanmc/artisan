// Files-first P3c (ADR files-first-source-of-truth #6): when disk AND web both
// moved since the last sync, neither side may overwrite the other. The plugin
// reports its disk tree (`sync_divergence`); the editor resolves per file.
// Pure helpers — the hub stores the pending report, the route applies the merge.

/** relPaths whose first segment starts with `.artisan` are metadata — never
 *  part of a divergence (mirrors the universal hash exclusion). */
function isArtisanMeta(relPath: string): boolean {
  return relPath.split("/", 1)[0]!.startsWith(".artisan");
}

/** [diskId] : l'id que le serveur propriétaire utilise dans les chemins. */
function relOf(path: string, diskId: string): string {
  const prefix = `plugins/Artisan/projects/${diskId}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

export interface DivergentFile {
  /** Project-relative path. */
  path: string;
  /** Disk-side content, null when the file was deleted on disk. */
  disk: string | null;
  /** Web-side content, null when the file doesn't exist in the editor state. */
  web: string | null;
}

/**
 * The per-file delta between the web tree (stored WIP) and the disk tree
 * (plugin report). Both trees are keyed by canonical full paths; the result is
 * rel-path keyed, `.artisan*` excluded, sorted (deterministic).
 */
export function diffDivergence(
  webFiles: Record<string, string>,
  diskFiles: Record<string, string>,
  projectId: string,
): DivergentFile[] {
  const web = new Map<string, string>();
  for (const [p, c] of Object.entries(webFiles)) {
    const rel = relOf(p, projectId);
    if (!isArtisanMeta(rel)) web.set(rel, c);
  }
  const disk = new Map<string, string>();
  for (const [p, c] of Object.entries(diskFiles)) {
    const rel = relOf(p, projectId);
    if (!isArtisanMeta(rel)) disk.set(rel, c);
  }
  const out: DivergentFile[] = [];
  for (const rel of new Set([...web.keys(), ...disk.keys()])) {
    const w = web.get(rel) ?? null;
    const d = disk.get(rel) ?? null;
    if (w !== d) out.push({ path: rel, disk: d, web: w });
  }
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/**
 * Apply per-file choices to produce the resolved tree (full-path keyed).
 * Unchosen paths default to "web" (the stored WIP wins). `.artisan*` entries
 * of the web tree are always preserved as-is.
 */
export function mergeDivergence(
  webFiles: Record<string, string>,
  diskFiles: Record<string, string>,
  diskId: string,
  choices: Record<string, "disk" | "web">,
): Record<string, string> {
  const prefix = `plugins/Artisan/projects/${diskId}/`;
  const merged: Record<string, string> = { ...webFiles };
  for (const f of diffDivergence(webFiles, diskFiles, diskId)) {
    if ((choices[f.path] ?? "web") !== "disk") continue;
    const full = prefix + f.path;
    if (f.disk === null) delete merged[full];
    else merged[full] = f.disk;
  }
  return merged;
}
