import { advanceBranchHead, getBranch } from "./branchStorage";
import { createCommit } from "./commitStorage";
import { computeBundleHash } from "./hashUtils";
import { getProject, upsertProjectContent } from "./projectStorage";

export type JournalResult =
  | { ok: true; contentHash: string }
  | { ok: false; reason: "not_a_project" };

/**
 * Persist a project's whole file tree and record it in history: store the
 * content (bumping the optimistic-lock version, so concurrent editors get the
 * existing conflict banner), commit it, advance `main`.
 *
 * The single implementation behind every backend-side mutation of a project
 * tree — in-game module mutations (`/boutique additem`) and Config-screen
 * writes alike. A second copy of this sequence is how the two sides of a hash
 * silently diverge (cf. the duplicated-hash incident of 2026-06-17).
 *
 * A project that does not exist is **not** created: the caller is journaling a
 * write it merely relayed, and inventing a project here would turn a foreign
 * plugin's directory into an Artisan project behind the admin's back.
 */
export async function journalProjectFiles(
  projectId: string,
  files: Record<string, string>,
  opts: { message: string; authorUserId?: string | null },
): Promise<JournalResult> {
  const project = await getProject(projectId);
  if (!project) return { ok: false, reason: "not_a_project" };

  const hash = await computeBundleHash(files, projectId);
  await upsertProjectContent(projectId, { hash, filesJson: JSON.stringify(files) });

  const branch = await getBranch(projectId, "main");
  if (!branch) return { ok: true, contentHash: hash };

  const commit = await createCommit({
    projectId,
    parentId: branch.headCommitId,
    files,
    authorUserId: opts.authorUserId ?? null,
    message: opts.message,
  });
  await advanceBranchHead(projectId, "main", commit.id);
  return { ok: true, contentHash: commit.contentHash };
}

/**
 * Apply a Config-screen patch (project-relative writes + deletes) onto a
 * project's stored tree, returning a new map. Paths are re-rooted onto the
 * canonical `plugins/Artisan/projects/<id>/` prefix the store keys on.
 */
export function applyConfigPatch(
  prev: Record<string, string>,
  projectId: string,
  writes: { path: string; content: string }[],
  deletes: string[],
): Record<string, string> {
  const base = `plugins/Artisan/projects/${projectId}/`;
  const next = { ...prev };
  for (const { path, content } of writes) next[`${base}${path}`] = content;
  for (const path of deletes) delete next[`${base}${path}`];
  return next;
}
