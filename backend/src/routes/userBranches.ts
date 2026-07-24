// backend/src/routes/userBranches.ts — B1 + B2 + B3 + B4
import { Hono } from "hono";
import type { Context } from "hono";
import { eq } from "drizzle-orm";
import { db } from "../db/index";
import { projects, projectCommits } from "../db/schema";
import { listBranchesForProject, getBranch, createBranch, advanceBranchHead, isAncestor } from "../lib/branchStorage";
import { listCommitsByProject, createCommit, getCommit } from "../lib/commitStorage";
import { requireMember } from "../lib/membershipGuard";
import { getProject } from "../lib/projectStorage";
import { pushBundleAvailable } from "../ws/hub";
import type { AuthUser } from "../middleware/userAuth";

type Vars = { user: AuthUser | null };

function getUserId(c: Context<{ Variables: Vars }>): string | null {
  return c.get("user")?.id ?? null;
}

async function checkAccess(
  c: Context<{ Variables: Vars }>,
  networkId: string,
  projectId: string,
): Promise<{ ok: true } | { ok: false; status: 401 | 403 | 404 }> {
  const userId = getUserId(c);
  if (!userId) return { ok: false, status: 401 };
  try { await requireMember(userId, networkId); }
  catch { return { ok: false, status: 403 }; }
  const projectRows = await db.select({ networkId: projects.networkId }).from(projects).where(eq(projects.id, projectId));
  if (projectRows.length === 0 || projectRows[0].networkId !== networkId) return { ok: false, status: 404 };
  return { ok: true };
}

const BRANCH_NAME_RE = /^[a-zA-Z0-9_\-./]+$/;

export const userBranchesRouter = new Hono<{ Variables: Vars }>();

// GET /:id/projects/:projectId/branches — list branches for a project, augmented with
// each branch's head commit contentHash so the editor can detect a divergence
// between the WIP buffer (projects.hash) and the branch HEAD (uncommitted edits).
userBranchesRouter.get("/:id/projects/:projectId/branches", async (c) => {
  const access = await checkAccess(c, c.req.param("id"), c.req.param("projectId"));
  if (!access.ok) return c.json({ error: "denied" }, access.status);
  const list = await listBranchesForProject(c.req.param("projectId"));
  const headIds = Array.from(new Set(list.map((b) => b.headCommitId)));
  const heads = headIds.length > 0
    ? await db
        .select({ id: projectCommits.id, contentHash: projectCommits.contentHash })
        .from(projectCommits)
        .where(eq(projectCommits.id, headIds[0]!))
    : [];
  // The single eq() above only fetches one head — extend to an `in` clause if
  // we ever need multiple heads in a single round-trip. For now most projects
  // have ≤ 3 branches so one lookup per branch is fine.
  const byId = new Map<string, string>();
  for (const h of heads) byId.set(h.id, h.contentHash);
  for (const id of headIds.slice(1)) {
    const rows = await db
      .select({ id: projectCommits.id, contentHash: projectCommits.contentHash })
      .from(projectCommits)
      .where(eq(projectCommits.id, id));
    if (rows[0]) byId.set(rows[0].id, rows[0].contentHash);
  }
  const enriched = list.map((b) => ({
    ...b,
    headCommitHash: byId.get(b.headCommitId) ?? "",
  }));
  return c.json({ branches: enriched });
});

// GET /:id/projects/:projectId/branches/:branch/head — content of the head commit
// of a branch. Used by the editor's "Revert / Discard" action in user-auth
// mode to restore the last committed (deployed) state, replacing the WIP.
userBranchesRouter.get("/:id/projects/:projectId/branches/:branch/head", async (c) => {
  const networkId = c.req.param("id");
  const projectId = c.req.param("projectId");
  const branchName = c.req.param("branch");
  const access = await checkAccess(c, networkId, projectId);
  if (!access.ok) return c.json({ error: "denied" }, access.status);

  const branch = await getBranch(projectId, branchName);
  if (!branch) return c.json({ error: "branch_not_found" }, 404);

  const commit = await getCommit(branch.headCommitId);
  if (!commit) return c.json({ error: "commit_not_found" }, 404);

  // Files-first: a commit's content IS its file tree — the client parses it
  // (projectFromFiles) to restore the editor state.
  const files = commit.filesJson ? JSON.parse(commit.filesJson) : {};

  return c.json({
    commit: {
      id: commit.id,
      contentHash: commit.contentHash,
      message: commit.message,
      createdAt: commit.createdAt,
    },
    files,
  });
});

// GET /:id/projects/:projectId/commits/:commitId/content — used by the History
// tab Restore action to fetch any past commit's files.
userBranchesRouter.get("/:id/projects/:projectId/commits/:commitId/content", async (c) => {
  const networkId = c.req.param("id");
  const projectId = c.req.param("projectId");
  const commitId = c.req.param("commitId");
  const access = await checkAccess(c, networkId, projectId);
  if (!access.ok) return c.json({ error: "denied" }, access.status);

  const commit = await getCommit(commitId);
  if (!commit || commit.projectId !== projectId) {
    return c.json({ error: "commit_not_found" }, 404);
  }

  const files = commit.filesJson ? JSON.parse(commit.filesJson) : {};
  return c.json({
    commit: { id: commit.id, contentHash: commit.contentHash, message: commit.message, createdAt: commit.createdAt },
    files,
  });
});

// GET /:id/projects/:projectId/commits — list commits for a project (optional ?branch=, ?limit=)
userBranchesRouter.get("/:id/projects/:projectId/commits", async (c) => {
  const access = await checkAccess(c, c.req.param("id"), c.req.param("projectId"));
  if (!access.ok) return c.json({ error: "denied" }, access.status);
  // `branch` filter accepted but ignored for MVP — commits exist in a pool, branches are pointers.
  const _branch = c.req.query("branch");
  const limit = Math.min(parseInt(c.req.query("limit") ?? "50", 10), 200);
  const list = await listCommitsByProject(c.req.param("projectId"), limit);
  return c.json({ commits: list });
});

// POST /:id/projects/:projectId/branches — create a new branch from an existing one
userBranchesRouter.post("/:id/projects/:projectId/branches", async (c) => {
  const access = await checkAccess(c, c.req.param("id"), c.req.param("projectId"));
  if (!access.ok) return c.json({ error: "denied" }, access.status);
  const projectId = c.req.param("projectId");

  let body: { name?: unknown; from?: unknown };
  try { body = await c.req.json(); } catch { return c.json({ error: "invalid_body" }, 400); }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const from = typeof body.from === "string" ? body.from.trim() : "main";
  if (name.length === 0 || !BRANCH_NAME_RE.test(name)) {
    return c.json({ error: "invalid_name" }, 422);
  }

  if (await getBranch(projectId, name)) {
    return c.json({ error: "branch_exists" }, 409);
  }
  const source = await getBranch(projectId, from);
  if (!source) return c.json({ error: "source_branch_not_found" }, 404);

  await createBranch(projectId, name, source.headCommitId);
  const created = await getBranch(projectId, name);
  return c.json({ branch: created }, 201);
});

// POST /:id/projects/:projectId/commits — commit current WIP onto a branch
userBranchesRouter.post("/:id/projects/:projectId/commits", async (c) => {
  const access = await checkAccess(c, c.req.param("id"), c.req.param("projectId"));
  if (!access.ok) return c.json({ error: "denied" }, access.status);
  const projectId = c.req.param("projectId");

  let body: { branch?: unknown; message?: unknown };
  try { body = await c.req.json(); } catch { return c.json({ error: "invalid_body" }, 400); }
  const branchName = typeof body.branch === "string" ? body.branch : "main";
  const message = typeof body.message === "string" ? body.message : "";

  const branch = await getBranch(projectId, branchName);
  if (!branch) return c.json({ error: "branch_not_found" }, 404);

  const project = await getProject(projectId);
  if (!project) return c.json({ error: "pack_not_found" }, 404);

  const files = JSON.parse(project.filesJson) as Record<string, string>;

  const commit = await createCommit({
    projectId,
    parentId: branch.headCommitId,
    files,
    authorUserId: getUserId(c),
    message,
  });
  await advanceBranchHead(projectId, branchName, commit.id);

  // Broadcast bundle_available to all server_keys bound to (projectId, branchName).
  await pushBundleAvailable(projectId, branchName, commit.contentHash);

  return c.json({ commit }, 201);
});

// POST /:id/projects/:projectId/branches/:src/promote/:dst — fast-forward only promotion
userBranchesRouter.post("/:id/projects/:projectId/branches/:src/promote/:dst", async (c) => {
  const access = await checkAccess(c, c.req.param("id"), c.req.param("projectId"));
  if (!access.ok) return c.json({ error: "denied" }, access.status);
  const projectId = c.req.param("projectId");
  const srcName = c.req.param("src");
  const dstName = c.req.param("dst");
  if (srcName === dstName) return c.json({ error: "same_branch" }, 400);

  const src = await getBranch(projectId, srcName);
  const dst = await getBranch(projectId, dstName);
  if (!src || !dst) return c.json({ error: "branch_not_found" }, 404);

  // Fast-forward check: dst.head must be an ancestor of src.head.
  if (!(await isAncestor(dst.headCommitId, src.headCommitId))) {
    return c.json({ error: "not_fast_forward" }, 409);
  }
  if (src.headCommitId === dst.headCommitId) {
    return c.json({ ok: true, advanced: false });
  }

  await advanceBranchHead(projectId, dstName, src.headCommitId);
  // Broadcast bundle_available to all server_keys bound to (projectId, dstName).
  const newHead = await getCommit(src.headCommitId);
  if (newHead) await pushBundleAvailable(projectId, dstName, newHead.contentHash);

  return c.json({ ok: true, advanced: true });
});
