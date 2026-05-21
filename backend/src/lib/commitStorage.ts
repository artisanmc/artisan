import { and, desc, eq } from "drizzle-orm";
import { createHash } from "crypto";
import { db } from "../db/index";
import { packCommits } from "../db/schema";

export type Commit = typeof packCommits.$inferSelect;

/**
 * Deterministic content hash: SHA-256 of `(key\nvalue\n)*` over sorted keys.
 * Matches the plugin's LocalPushSender.computeHash() so client & server agree.
 */
export function computeContentHash(files: Record<string, string>): string {
  const sb: string[] = [];
  for (const key of Object.keys(files).sort()) {
    sb.push(key, "\n", files[key], "\n");
  }
  return createHash("sha256").update(sb.join("")).digest("hex");
}

export interface CreateCommitInput {
  packId: string;
  parentId: string | null;
  files: Record<string, string>;
  editor: unknown | null;
  authorUserId: string | null;
  message: string;
}

export async function createCommit(input: CreateCommitInput): Promise<Commit> {
  const contentHash = computeContentHash(input.files);

  // Dedup: if a commit with this (packId, contentHash) already exists, return it.
  const existing = await db.select().from(packCommits).where(and(
    eq(packCommits.packId, input.packId),
    eq(packCommits.contentHash, contentHash),
  ));
  if (existing.length > 0) return existing[0];

  const id = "cmt_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  const filesJson = JSON.stringify(input.files);
  const editorJson = input.editor ? JSON.stringify(input.editor) : null;
  const now = new Date();
  await db.insert(packCommits).values({
    id,
    packId: input.packId,
    parentId: input.parentId,
    contentHash,
    filesJson,
    editorJson,
    authorUserId: input.authorUserId,
    message: input.message,
    createdAt: now,
  });
  return (await getCommit(id))!;
}

export async function getCommit(id: string): Promise<Commit | null> {
  const rows = await db.select().from(packCommits).where(eq(packCommits.id, id));
  return rows[0] ?? null;
}

export async function listCommitsByPack(packId: string, limit: number): Promise<Commit[]> {
  return await db
    .select()
    .from(packCommits)
    .where(eq(packCommits.packId, packId))
    .orderBy(desc(packCommits.createdAt))
    .limit(limit);
}
