import { and, desc, eq } from "drizzle-orm";
import { createHash } from "crypto";
import { db } from "../db/index";
import { projectCommits } from "../db/schema";

export type Commit = typeof projectCommits.$inferSelect;

/**
 * Deterministic content hash: SHA-256 of `(key\nvalue\n)*` over sorted keys.
 * Matches the plugin's LocalPushSender.computeHash() so client & server agree.
 */
export function computeContentHash(files: Record<string, string>, projectId: string): string {
  // ONE house hash (CLAUDE.md § Invariants): the commit contentHash is the
  // SAME canonical pack hash as BundleHasher (plugin) and computeBundleHash
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
  const contentHash = computeContentHash(input.files, input.projectId);

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
