// backend/src/routes/userBranches.ts — B1 + B2 + B3 + B4
import { Hono } from "hono";
import type { Context } from "hono";
import { eq } from "drizzle-orm";
import { db } from "../db/index";
import { packs } from "../db/schema";
import { listBranchesForPack, getBranch, createBranch, advanceBranchHead, isAncestor } from "../lib/branchStorage";
import { listCommitsByPack, createCommit, getCommit } from "../lib/commitStorage";
import { requireMember } from "../lib/membershipGuard";
import { getPack } from "../lib/packStorage";
import { pushBundleAvailable } from "../ws/hub";
import type { AuthUser } from "../middleware/userAuth";

type Vars = { user: AuthUser | null };

function getUserId(c: Context<{ Variables: Vars }>): string | null {
  return c.get("user")?.id ?? null;
}

async function checkAccess(
  c: Context<{ Variables: Vars }>,
  networkId: string,
  packId: string,
): Promise<{ ok: true } | { ok: false; status: 401 | 403 | 404 }> {
  const userId = getUserId(c);
  if (!userId) return { ok: false, status: 401 };
  try { await requireMember(userId, networkId); }
  catch { return { ok: false, status: 403 }; }
  const packRows = await db.select({ networkId: packs.networkId }).from(packs).where(eq(packs.id, packId));
  if (packRows.length === 0 || packRows[0].networkId !== networkId) return { ok: false, status: 404 };
  return { ok: true };
}

const BRANCH_NAME_RE = /^[a-zA-Z0-9_\-./]+$/;

export const userBranchesRouter = new Hono<{ Variables: Vars }>();

// GET /:id/packs/:packId/branches — list branches for a pack
userBranchesRouter.get("/:id/packs/:packId/branches", async (c) => {
  const access = await checkAccess(c, c.req.param("id"), c.req.param("packId"));
  if (!access.ok) return c.json({ error: "denied" }, access.status);
  const list = await listBranchesForPack(c.req.param("packId"));
  return c.json({ branches: list });
});

// GET /:id/packs/:packId/commits — list commits for a pack (optional ?branch=, ?limit=)
userBranchesRouter.get("/:id/packs/:packId/commits", async (c) => {
  const access = await checkAccess(c, c.req.param("id"), c.req.param("packId"));
  if (!access.ok) return c.json({ error: "denied" }, access.status);
  // `branch` filter accepted but ignored for MVP — commits exist in a pool, branches are pointers.
  const _branch = c.req.query("branch");
  const limit = Math.min(parseInt(c.req.query("limit") ?? "50", 10), 200);
  const list = await listCommitsByPack(c.req.param("packId"), limit);
  return c.json({ commits: list });
});

// POST /:id/packs/:packId/branches — create a new branch from an existing one
userBranchesRouter.post("/:id/packs/:packId/branches", async (c) => {
  const access = await checkAccess(c, c.req.param("id"), c.req.param("packId"));
  if (!access.ok) return c.json({ error: "denied" }, access.status);
  const packId = c.req.param("packId");

  let body: { name?: unknown; from?: unknown };
  try { body = await c.req.json(); } catch { return c.json({ error: "invalid_body" }, 400); }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const from = typeof body.from === "string" ? body.from.trim() : "main";
  if (name.length === 0 || !BRANCH_NAME_RE.test(name)) {
    return c.json({ error: "invalid_name" }, 422);
  }

  if (await getBranch(packId, name)) {
    return c.json({ error: "branch_exists" }, 409);
  }
  const source = await getBranch(packId, from);
  if (!source) return c.json({ error: "source_branch_not_found" }, 404);

  await createBranch(packId, name, source.headCommitId);
  const created = await getBranch(packId, name);
  return c.json({ branch: created }, 201);
});

// POST /:id/packs/:packId/commits — commit current WIP onto a branch
userBranchesRouter.post("/:id/packs/:packId/commits", async (c) => {
  const access = await checkAccess(c, c.req.param("id"), c.req.param("packId"));
  if (!access.ok) return c.json({ error: "denied" }, access.status);
  const packId = c.req.param("packId");

  let body: { branch?: unknown; message?: unknown };
  try { body = await c.req.json(); } catch { return c.json({ error: "invalid_body" }, 400); }
  const branchName = typeof body.branch === "string" ? body.branch : "main";
  const message = typeof body.message === "string" ? body.message : "";

  const branch = await getBranch(packId, branchName);
  if (!branch) return c.json({ error: "branch_not_found" }, 404);

  const pack = await getPack(packId);
  if (!pack) return c.json({ error: "pack_not_found" }, 404);

  const files = JSON.parse(pack.filesJson) as Record<string, string>;
  const editor = pack.editorJson ? JSON.parse(pack.editorJson) : null;

  const commit = await createCommit({
    packId,
    parentId: branch.headCommitId,
    files,
    editor,
    authorUserId: getUserId(c),
    message,
  });
  await advanceBranchHead(packId, branchName, commit.id);

  // Broadcast bundle_available to all server_keys bound to (packId, branchName).
  await pushBundleAvailable(packId, branchName, commit.contentHash);

  return c.json({ commit }, 201);
});

// POST /:id/packs/:packId/branches/:src/promote/:dst — fast-forward only promotion
userBranchesRouter.post("/:id/packs/:packId/branches/:src/promote/:dst", async (c) => {
  const access = await checkAccess(c, c.req.param("id"), c.req.param("packId"));
  if (!access.ok) return c.json({ error: "denied" }, access.status);
  const packId = c.req.param("packId");
  const srcName = c.req.param("src");
  const dstName = c.req.param("dst");
  if (srcName === dstName) return c.json({ error: "same_branch" }, 400);

  const src = await getBranch(packId, srcName);
  const dst = await getBranch(packId, dstName);
  if (!src || !dst) return c.json({ error: "branch_not_found" }, 404);

  // Fast-forward check: dst.head must be an ancestor of src.head.
  if (!(await isAncestor(dst.headCommitId, src.headCommitId))) {
    return c.json({ error: "not_fast_forward" }, 409);
  }
  if (src.headCommitId === dst.headCommitId) {
    return c.json({ ok: true, advanced: false });
  }

  await advanceBranchHead(packId, dstName, src.headCommitId);
  // Broadcast bundle_available to all server_keys bound to (packId, dstName).
  const newHead = await getCommit(src.headCommitId);
  if (newHead) await pushBundleAvailable(packId, dstName, newHead.contentHash);

  return c.json({ ok: true, advanced: true });
});
