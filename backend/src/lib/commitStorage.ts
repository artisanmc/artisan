import { and, desc, eq } from "drizzle-orm";
import { createHash } from "crypto";
import { db } from "../db/index";
import { projectCommits, projects } from "../db/schema";

export type Commit = typeof projectCommits.$inferSelect;

/**
 * Deterministic content hash: SHA-256 of `(key\nvalue\n)*` over sorted keys.
 * Matches the plugin's LocalPushSender.computeHash() so client & server agree.
 */
export function computeContentHash(files: Record<string, string>, projectId: string): string {
  // ONE house hash (CLAUDE.md § Invariants): the commit contentHash is the
  // SAME canonical project hash as BundleHasher (plugin) and computeBundleHash
  // (backend) — relPath-keyed, native byte-order sort, `.artisan*` first
  // segment excluded. It used to hash full disk paths incl. `.artisan*`,
  // which made hello_ack.project_hashes never match the plugin's disk hash:
  // detectSyncAction could never see IN_SYNC/LOCAL_ONLY (no auto-push).
  // Empty-content sentinel: "" means "no content" — a freshly-created stub
  // must hash to "" so the plugin's backendHash.isEmpty() auto-push fires.
  const prefix = `plugins/Artisan/projects/${projectId}/`;
  const entries = Object.entries(files)
    .map(([k, v]) => [k.startsWith(prefix) ? k.slice(prefix.length) : k, v] as const)
    .filter(([k]) => !k.split("/", 1)[0]!.startsWith(".artisan"))
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  if (entries.length === 0) return "";
  const sb: string[] = [];
  for (const [k, v] of entries) sb.push(k, "\n", v, "\n");
  return createHash("sha256").update(sb.join("")).digest("hex");
}

export interface CreateCommitInput {
  projectId: string;
  parentId: string | null;
  files: Record<string, string>;
  authorUserId: string | null;
  message: string;
}

export async function createCommit(input: CreateCommitInput): Promise<Commit> {
  // Hash by the project's DISK id, not its internal row id: `files` keys are
  // disk paths (`plugins/Artisan/projects/<diskId>/...`), and the prefix must
  // strip for the hash to match what the plugin computes over the same tree.
  // Resolved here rather than passed in so no call site can forget it — a
  // mismatch is invisible until a plugin rejects the bundle as divergent.
  // (Read inline instead of importing projectStorage: that module imports this
  // one for the initial commit, and the cycle would be load-order dependent.)
  const owner = (
    await db
      .select({ id: projects.id, externalId: projects.externalId })
      .from(projects)
      .where(eq(projects.id, input.projectId))
  )[0];
  const hashId = owner?.externalId ?? input.projectId;
  const contentHash = computeContentHash(input.files, hashId);

  // Dedup: if a commit with this (projectId, contentHash) already exists, return it.
  const existing = await db.select().from(projectCommits).where(and(
    eq(projectCommits.projectId, input.projectId),
    eq(projectCommits.contentHash, contentHash),
  ));
  if (existing.length > 0) return existing[0];

  const id = "cmt_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  const filesJson = JSON.stringify(input.files);
  const now = new Date();
  await db.insert(projectCommits).values({
    id,
    projectId: input.projectId,
    parentId: input.parentId,
    contentHash,
    filesJson,
    authorUserId: input.authorUserId,
    message: input.message,
    createdAt: now,
  });
  return (await getCommit(id))!;
}

export async function getCommit(id: string): Promise<Commit | null> {
  const rows = await db.select().from(projectCommits).where(eq(projectCommits.id, id));
  return rows[0] ?? null;
}

export async function listCommitsByProject(projectId: string, limit: number): Promise<Commit[]> {
  return await db
    .select()
    .from(projectCommits)
    .where(eq(projectCommits.projectId, projectId))
    .orderBy(desc(projectCommits.createdAt))
    .limit(limit);
}
