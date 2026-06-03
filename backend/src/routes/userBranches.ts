// backend/src/routes/userBranches.ts — B1 + B2 + B3 + B4 + C1 + C2
import { Hono } from "hono";
import type { Context } from "hono";
import { eq } from "drizzle-orm";
import { db } from "../db/index";
import { packs, packCommits } from "../db/schema";
import { listBranchesForPack, getBranch, createBranch, advanceBranchHead, isAncestor, findLCA } from "../lib/branchStorage";
import { listCommitsByPack, createCommit, getCommit, computeContentHash } from "../lib/commitStorage";
import { requireMember } from "../lib/membershipGuard";
import { getPack } from "../lib/packStorage";
import { pushBundleAvailable } from "../ws/hub";
import type { AuthUser } from "../middleware/userAuth";
import { merge as mergeStates, applyResolutions, type EditorState } from "../lib/mergeEngine";

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

// GET /:id/packs/:packId/branches — list branches for a pack, augmented with
// each branch's head commit contentHash so the editor can detect a divergence
// between the WIP buffer (packs.hash) and the branch HEAD (uncommitted edits).
userBranchesRouter.get("/:id/packs/:packId/branches", async (c) => {
  const access = await checkAccess(c, c.req.param("id"), c.req.param("packId"));
  if (!access.ok) return c.json({ error: "denied" }, access.status);
  const list = await listBranchesForPack(c.req.param("packId"));
  const headIds = Array.from(new Set(list.map((b) => b.headCommitId)));
  const heads = headIds.length > 0
    ? await db
        .select({ id: packCommits.id, contentHash: packCommits.contentHash })
        .from(packCommits)
        .where(eq(packCommits.id, headIds[0]!))
    : [];
  // The single eq() above only fetches one head — extend to an `in` clause if
  // we ever need multiple heads in a single round-trip. For now most packs
  // have ≤ 3 branches so one lookup per branch is fine.
  const byId = new Map<string, string>();
  for (const h of heads) byId.set(h.id, h.contentHash);
  for (const id of headIds.slice(1)) {
    const rows = await db
      .select({ id: packCommits.id, contentHash: packCommits.contentHash })
      .from(packCommits)
      .where(eq(packCommits.id, id));
    if (rows[0]) byId.set(rows[0].id, rows[0].contentHash);
  }
  const enriched = list.map((b) => ({
    ...b,
    headCommitHash: byId.get(b.headCommitId) ?? "",
  }));
  return c.json({ branches: enriched });
});

// GET /:id/packs/:packId/branches/:branch/head — content of the head commit
// of a branch. Used by the editor's "Revert / Discard" action in user-auth
// mode to restore the last committed (deployed) state, replacing the WIP.
userBranchesRouter.get("/:id/packs/:packId/branches/:branch/head", async (c) => {
  const networkId = c.req.param("id");
  const packId = c.req.param("packId");
  const branchName = c.req.param("branch");
  const access = await checkAccess(c, networkId, packId);
  if (!access.ok) return c.json({ error: "denied" }, access.status);

  const branch = await getBranch(packId, branchName);
  if (!branch) return c.json({ error: "branch_not_found" }, 404);

  const commit = await getCommit(branch.headCommitId);
  if (!commit) return c.json({ error: "commit_not_found" }, 404);

  // editorJson may be null on an empty-initial commit (auto-created at pack
  // creation). Return an empty object so the client can still call
  // `replacePack` without crashing — same shape it would have stored.
  const editor = commit.editorJson ? JSON.parse(commit.editorJson) : {};
  const files = commit.filesJson ? JSON.parse(commit.filesJson) : {};

  return c.json({
    commit: {
      id: commit.id,
      contentHash: commit.contentHash,
      message: commit.message,
      createdAt: commit.createdAt,
    },
    editor,
    files,
  });
});

// GET /:id/packs/:packId/commits/:commitId/content — used by the History
// tab Restore action to fetch any past commit's editor + files JSON.
userBranchesRouter.get("/:id/packs/:packId/commits/:commitId/content", async (c) => {
  const networkId = c.req.param("id");
  const packId = c.req.param("packId");
  const commitId = c.req.param("commitId");
  const access = await checkAccess(c, networkId, packId);
  if (!access.ok) return c.json({ error: "denied" }, access.status);

  const commit = await getCommit(commitId);
  if (!commit || commit.packId !== packId) {
    return c.json({ error: "commit_not_found" }, 404);
  }

  const editor = commit.editorJson ? JSON.parse(commit.editorJson) : {};
  const files = commit.filesJson ? JSON.parse(commit.filesJson) : {};
  return c.json({
    commit: { id: commit.id, contentHash: commit.contentHash, message: commit.message, createdAt: commit.createdAt },
    editor,
    files,
  });
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

// POST /:id/packs/:packId/branches/:src/merge-into/:dst — compute merge plan (FF / already_merged / 3-way)
userBranchesRouter.post("/:id/packs/:packId/branches/:src/merge-into/:dst", async (c) => {
  const access = await checkAccess(c, c.req.param("id"), c.req.param("packId"));
  if (!access.ok) return c.json({ error: "denied" }, access.status);
  const packId = c.req.param("packId");
  const srcName = c.req.param("src");
  const dstName = c.req.param("dst");
  if (srcName === dstName) return c.json({ error: "same_branch" }, 400);

  const src = await getBranch(packId, srcName);
  const dst = await getBranch(packId, dstName);
  if (!src || !dst) return c.json({ error: "branch_not_found" }, 404);

  let lcaId: string;
  try { lcaId = await findLCA(src.headCommitId, dst.headCommitId); }
  catch { return c.json({ error: "no_common_ancestor" }, 500); }

  // already_merged: src is ancestor of dst (LCA = src.head)
  if (lcaId === src.headCommitId) {
    return c.json({ kind: "already_merged", advanced: false });
  }

  // fast_forward: dst is ancestor of src (LCA = dst.head) — advance dst to src.head
  if (lcaId === dst.headCommitId) {
    await advanceBranchHead(packId, dstName, src.headCommitId);
    const newHead = await getCommit(src.headCommitId);
    if (newHead) await pushBundleAvailable(packId, dstName, newHead.contentHash);
    return c.json({
      kind: "fast_forward",
      advanced: true,
      head_commit_id: src.headCommitId,
    });
  }

  // 3-way merge
  const [baseCommit, srcCommit, dstCommit] = await Promise.all([
    getCommit(lcaId),
    getCommit(src.headCommitId),
    getCommit(dst.headCommitId),
  ]);
  if (!baseCommit || !srcCommit || !dstCommit) return c.json({ error: "commit_missing" }, 500);

  const baseState = baseCommit.editorJson ? JSON.parse(baseCommit.editorJson) as EditorState : {};
  const srcState = srcCommit.editorJson ? JSON.parse(srcCommit.editorJson) as EditorState : {};
  const dstState = dstCommit.editorJson ? JSON.parse(dstCommit.editorJson) as EditorState : {};

  const result = mergeStates(baseState, srcState, dstState);

  return c.json({
    kind: result.conflicts.length === 0 ? "auto" : "conflicts",
    conflicts: result.conflicts,
    mergedEditorJson: result.mergedState,
    lcaCommitId: lcaId,
    srcCommitId: src.headCommitId,
    dstCommitId: dst.headCommitId,
  });
});

// POST /:id/packs/:packId/branches/:src/merge-into/:dst/resolve — apply resolutions + create merge commit
userBranchesRouter.post("/:id/packs/:packId/branches/:src/merge-into/:dst/resolve", async (c) => {
  const access = await checkAccess(c, c.req.param("id"), c.req.param("packId"));
  if (!access.ok) return c.json({ error: "denied" }, access.status);
  const packId = c.req.param("packId");
  const srcName = c.req.param("src");
  const dstName = c.req.param("dst");
  if (srcName === dstName) return c.json({ error: "same_branch" }, 400);

  let body: {
    resolutions?: unknown;
    lcaCommitId?: unknown;
    srcCommitId?: unknown;
    dstCommitId?: unknown;
    mergedFilesJson?: unknown;
    mergedEditorJson?: unknown;
    message?: unknown;
  };
  try { body = await c.req.json(); } catch { return c.json({ error: "invalid_body" }, 400); }

  // Stale check: heads must match what client received from /merge-into.
  const src = await getBranch(packId, srcName);
  const dst = await getBranch(packId, dstName);
  if (!src || !dst) return c.json({ error: "branch_not_found" }, 404);
  if (src.headCommitId !== body.srcCommitId || dst.headCommitId !== body.dstCommitId) {
    return c.json({ error: "stale_merge" }, 409);
  }

  // Re-run merge to validate conflicts list (server is source of truth).
  const lcaId = body.lcaCommitId as string;
  const [baseCommit, srcCommit, dstCommit] = await Promise.all([
    getCommit(lcaId),
    getCommit(src.headCommitId),
    getCommit(dst.headCommitId),
  ]);
  if (!baseCommit || !srcCommit || !dstCommit) return c.json({ error: "commit_missing" }, 500);

  const baseState = baseCommit.editorJson ? JSON.parse(baseCommit.editorJson) as EditorState : {};
  const srcState = srcCommit.editorJson ? JSON.parse(srcCommit.editorJson) as EditorState : {};
  const dstState = dstCommit.editorJson ? JSON.parse(dstCommit.editorJson) as EditorState : {};
  const mergeResult = mergeStates(baseState, srcState, dstState);

  // Validate resolutions: must cover exactly the conflict keys.
  const resolutions = (body.resolutions ?? {}) as Record<string, "src" | "dst">;
  const conflictKeys = new Set(mergeResult.conflicts.map((c2) => c2.conflictKey));
  const resolutionKeys = new Set(Object.keys(resolutions));
  for (const k of conflictKeys) {
    if (!resolutionKeys.has(k)) return c.json({ error: "missing_resolutions", missingKey: k }, 400);
  }
  for (const k of resolutionKeys) {
    if (!conflictKeys.has(k)) return c.json({ error: "extra_resolutions", extraKey: k }, 400);
    if (resolutions[k] !== "src" && resolutions[k] !== "dst") {
      return c.json({ error: "invalid_resolution_value", key: k }, 400);
    }
  }

  // Apply resolutions to get the final editorJson.
  const finalEditor = applyResolutions(mergeResult.mergedState, mergeResult.conflicts, resolutions);

  const finalFiles = (body.mergedFilesJson ?? {}) as Record<string, string>;
  const message = typeof body.message === "string" && body.message.trim()
    ? body.message.trim()
    : `Merge ${srcName} into ${dstName}`;

  // Create merge commit with both parents.
  // Direct insert (not createCommit) because createCommit doesn't accept parentId2.
  // contentHash for merge commits includes the parent IDs as a discriminator so that
  // a merge producing the same filesJson as an existing commit does not violate the
  // unique (packId, contentHash) constraint.  The plugin treats contentHash as an
  // opaque "have I downloaded this version?" token — it just re-downloads when it differs.
  const contentHash = computeContentHash({
    ...finalFiles,
    "\x00merge-meta": `${dst.headCommitId}|${src.headCommitId}`,
  });
  const id = "cmt_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  await db.insert(packCommits).values({
    id,
    packId,
    parentId: dst.headCommitId,
    parentId2: src.headCommitId,
    contentHash,
    filesJson: JSON.stringify(finalFiles),
    editorJson: JSON.stringify(finalEditor),
    authorUserId: getUserId(c),
    message,
    createdAt: new Date(),
  });
  await advanceBranchHead(packId, dstName, id);
  await pushBundleAvailable(packId, dstName, contentHash);

  const commit = await getCommit(id);
  return c.json({ commit, head_commit_id: id }, 201);
});
