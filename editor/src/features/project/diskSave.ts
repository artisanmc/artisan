import { hashContent } from "../../lib/contentHash";

/**
 * Planning a save to the server's disk (ADR `server-disk-only-storage`).
 *
 * The editor keeps the **base** — each file's content as it was loaded.
 * Saving does not push the whole tree: it compares to the base, sends only
 * the delta, and each entry carries its base hash so the plugin refuses if the
 * disk moved meanwhile. A file nobody touched is never rewritten, so it can
 * never conflict.
 */

export interface PlannedWrite {
  path: string;
  content: string;
  /** Hash of the content expected on disk; `null` = "there should be none". */
  base_hash: string | null;
}

export interface PlannedDelete {
  path: string;
  base_hash: string | null;
}

export interface WritePlan {
  files: PlannedWrite[];
  deletes: PlannedDelete[];
  /** Nothing to save — the caller can skip the round trip. */
  empty: boolean;
}

/** Rel-keyed contents → minimal write plan, sorted paths. */
export async function planWrite(
  baseline: Record<string, string>,
  next: Record<string, string>,
): Promise<WritePlan> {
  const files: PlannedWrite[] = [];
  for (const path of Object.keys(next).sort()) {
    const content = next[path]!;
    const before = baseline[path];
    if (before === content) continue;
    files.push({
      path,
      content,
      // The token describes what we expected on disk, so it is computed on the
      // BASE, never on the new content.
      base_hash: before === undefined ? null : await hashContent(before),
    });
  }

  const deletes: PlannedDelete[] = [];
  for (const path of Object.keys(baseline).sort()) {
    if (path in next) continue;
    deletes.push({ path, base_hash: await hashContent(baseline[path]!) });
  }

  return { files, deletes, empty: files.length === 0 && deletes.length === 0 };
}

/**
 * `projectToFiles()` produces canonical paths
 * (`plugins/Artisan/projects/<diskId>/<rel>`); the plugin protocol speaks in
 * project-relative paths. Anything outside the project is dropped — a write
 * never leaves its own tree.
 */
export function toRelative(
  canonical: Record<string, string>,
  diskId: string,
): Record<string, string> {
  const prefix = `plugins/Artisan/projects/${diskId}/`;
  const out: Record<string, string> = {};
  for (const [key, content] of Object.entries(canonical)) {
    if (key.startsWith(prefix)) out[key.slice(prefix.length)] = content;
  }
  return out;
}

/**
 * Turns "delete the old + create the new" into a **move** when the editor
 * declared a rename.
 *
 * The tree alone cannot tell the two apart, but the editor can. Without this
 * translation, renaming a Document archives a deletion that is not one and
 * orphans its history from the new name.
 *
 * The move's `base_hash` is about the OLD path — that is what the server must
 * find intact. And if the content changed too, the following write is based
 * on that same content, since the moved file still holds it.
 */
export async function applyRenames(
  plan: WritePlan,
  renames: { from: string; to: string }[],
  baseline: Record<string, string>,
): Promise<WritePlan & { renames: { from: string; to: string; base_hash: string }[] }> {
  const applied: { from: string; to: string; base_hash: string }[] = [];
  let files = plan.files;
  let deletes = plan.deletes;

  for (const { from, to } of renames) {
    const was = baseline[from];
    // A rename whose source is not in the base describes nothing the server can
    // check: it falls back to a plain create.
    if (was === undefined) continue;
    applied.push({ from, to, base_hash: await hashContent(was) });
    // The old path is no longer deleted: it is moved.
    deletes = deletes.filter((d) => d.path !== from);
    files = files.map((f) =>
      // After the move, the destination holds the old content: that is what the
      // compare-and-swap must expect, not "no file".
      f.path === to ? { ...f, base_hash: applied[applied.length - 1]!.base_hash } : f,
    );
    // Unchanged content: the move is enough, nothing to rewrite.
    const target = files.find((f) => f.path === to);
    if (target && target.content === was) files = files.filter((f) => f.path !== to);
  }

  return {
    files,
    deletes,
    renames: applied,
    empty: files.length === 0 && deletes.length === 0 && applied.length === 0,
  };
}
