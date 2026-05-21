import { and, eq } from "drizzle-orm";
import { db } from "../db/index";
import { packBranches, packCommits } from "../db/schema";

export type Branch = typeof packBranches.$inferSelect;

export async function createBranch(packId: string, name: string, headCommitId: string): Promise<void> {
  const now = new Date();
  await db.insert(packBranches).values({ packId, name, headCommitId, createdAt: now, updatedAt: now });
}

export async function getBranch(packId: string, name: string): Promise<Branch | null> {
  const rows = await db.select().from(packBranches).where(and(
    eq(packBranches.packId, packId), eq(packBranches.name, name),
  ));
  return rows[0] ?? null;
}

export async function advanceBranchHead(packId: string, name: string, newHeadCommitId: string): Promise<void> {
  await db.update(packBranches).set({
    headCommitId: newHeadCommitId,
    updatedAt: new Date(),
  }).where(and(eq(packBranches.packId, packId), eq(packBranches.name, name)));
}

export async function listBranchesForPack(packId: string): Promise<Branch[]> {
  return await db.select().from(packBranches).where(eq(packBranches.packId, packId));
}

/**
 * True if `ancestorId` is reachable from `descendantId` by walking parent links.
 * Returns true on identity (a commit is its own ancestor). Bounded walk (1000 steps)
 * to defend against accidentally cyclic data.
 */
export async function isAncestor(ancestorId: string, descendantId: string): Promise<boolean> {
  if (ancestorId === descendantId) return true;
  let current: string | null = descendantId;
  for (let step = 0; step < 1000 && current; step++) {
    const rows = await db
      .select({ parentId: packCommits.parentId })
      .from(packCommits)
      .where(eq(packCommits.id, current));
    if (rows.length === 0) return false;
    current = rows[0].parentId;
    if (current === ancestorId) return true;
  }
  return false;
}

/**
 * Returns the LCA (lowest common ancestor) of two commits in the same pack's
 * commit DAG. Walks both parentId and parentId2 (the merge commit 2nd parent).
 * Throws "no common ancestor" if the BFS exhausts both queues without overlap.
 *
 * Bounded to 10_000 steps total to defend against accidental cycles.
 */
export async function findLCA(commitIdA: string, commitIdB: string): Promise<string> {
  if (commitIdA === commitIdB) return commitIdA;

  const visitedA = new Set<string>([commitIdA]);
  const visitedB = new Set<string>([commitIdB]);
  const queueA: string[] = [commitIdA];
  const queueB: string[] = [commitIdB];

  for (let step = 0; step < 10_000; step++) {
    if (queueA.length === 0 && queueB.length === 0) {
      throw new Error("findLCA: no common ancestor");
    }

    // Step A
    if (queueA.length > 0) {
      const cur = queueA.shift()!;
      const row = (await db.select({ p1: packCommits.parentId, p2: packCommits.parentId2 })
        .from(packCommits).where(eq(packCommits.id, cur)))[0];
      if (row) {
        for (const p of [row.p1, row.p2]) {
          if (!p) continue;
          if (visitedB.has(p)) return p;
          if (!visitedA.has(p)) { visitedA.add(p); queueA.push(p); }
        }
      }
    }

    // Step B
    if (queueB.length > 0) {
      const cur = queueB.shift()!;
      const row = (await db.select({ p1: packCommits.parentId, p2: packCommits.parentId2 })
        .from(packCommits).where(eq(packCommits.id, cur)))[0];
      if (row) {
        for (const p of [row.p1, row.p2]) {
          if (!p) continue;
          if (visitedA.has(p)) return p;
          if (!visitedB.has(p)) { visitedB.add(p); queueB.push(p); }
        }
      }
    }
  }

  throw new Error("findLCA: walk exhausted (possible cycle)");
}
