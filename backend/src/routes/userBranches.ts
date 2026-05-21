// backend/src/routes/userBranches.ts — B1 + B2
import { Hono } from "hono";
import type { Context } from "hono";
import { eq } from "drizzle-orm";
import { db } from "../db/index";
import { packs } from "../db/schema";
import { listBranchesForPack, getBranch, createBranch } from "../lib/branchStorage";
import { listCommitsByPack } from "../lib/commitStorage";
import { requireMember } from "../lib/membershipGuard";
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
