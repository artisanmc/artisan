import { and, desc, eq } from "drizzle-orm";
import { createHash } from "crypto";
import { db } from "../db/index";
import { projectCommits } from "../db/schema";

export type Commit = typeof projectCommits.$inferSelect;

/**
 * Deterministic content hash: SHA-256 of `(key\nvalue\n)*` over sorted keys.
 * Matches the plugin's LocalPushSender.computeHash() so client & server agree.
 */
export function computeContentHash(files: Record<string, string>): string {
  // Empty-content sentinel: "" means "no content", consistent with
  // BundleHasher.hash() (plugin) and hashUtils.computeBundleHash() (backend).
  // A freshly-created project stub (empty initial commit) must hash to "" so
  // the plugin's auto-push path (backendHash.isEmpty()) fires instead of
  // mistaking the stub for divergent content and overwriting local files.
  if (Object.keys(files).length === 0) return "";
  const sb: string[] = [];
  for (const key of Object.keys(files).sort()) {
    sb.push(key, "\n", files[key], "\n");
  }
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
  const contentHash = computeContentHash(input.files);

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
