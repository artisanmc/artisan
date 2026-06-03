// backend/src/routes/userBranches.test.ts
import { beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { db } from "../db/index";
import {
  memberships, networks, packs, serverKeys,
  editorSessions, linkCodes, packCommits, packBranches, assets,
  users, userSessions,
} from "../db/schema";
import { eq } from "drizzle-orm";
import { userBranchesRouter } from "./userBranches";
import { userAuth } from "../middleware/userAuth";
import { createSession } from "../lib/sessionManager";
import { createNetwork } from "../lib/networkManager";
import { addMembership } from "../lib/membershipManager";
import { createPack } from "../lib/packStorage";
import { generateServerKey } from "../lib/auth";

async function clearAll() {
  await db.delete(packBranches);
  await db.delete(packCommits);
  await db.delete(assets);
  await db.delete(packs);
  await db.delete(editorSessions);
  await db.delete(linkCodes);
  await db.delete(serverKeys);
  await db.delete(memberships);
  await db.delete(networks);
  await db.delete(userSessions);
  await db.delete(users);
}

async function seedUserWithPack(userId = "u1") {
  await db.insert(users).values({
    id: userId, email: `${userId}@a.b`, name: userId, passwordHash: null, avatarUrl: null,
    createdAt: new Date(), updatedAt: new Date(),
  });
  const sess = await createSession(userId);
  const net = await createNetwork("N");
  await addMembership(userId, net.id, "owner");
  const { id: skId, hash: skHash } = await generateServerKey();
  await db.insert(serverKeys).values({ id: skId, hash: skHash, label: null, networkId: net.id, createdAt: new Date() });
  const pack = await createPack({ networkId: net.id, serverKeyId: skId, name: "p" });
  return { userId, sessionId: sess.id, networkId: net.id, packId: pack.id };
}

function makeApp() {
  const app = new Hono();
  app.use("/api/v1/networks/*", userAuth());
  app.route("/api/v1/networks", userBranchesRouter);
  return app;
}

// ─── B1: GET branches + commits ────────────────────────────────────────────

describe("userBranchesRouter — GET branches + commits", () => {
  beforeEach(clearAll);

  test("GET /:netId/packs/:packId/branches returns main after createPack", async () => {
    const { sessionId, networkId, packId } = await seedUserWithPack();
    const app = makeApp();
    const res = await app.request(`/api/v1/networks/${networkId}/packs/${packId}/branches`, {
      headers: { Cookie: `artisan_user_session=${sessionId}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.branches).toHaveLength(1);
    expect(body.branches[0].name).toBe("main");
  });

  test("GET /:netId/packs/:packId/commits?branch=main returns the initial commit", async () => {
    const { sessionId, networkId, packId } = await seedUserWithPack();
    const app = makeApp();
    const res = await app.request(`/api/v1/networks/${networkId}/packs/${packId}/commits?branch=main`, {
      headers: { Cookie: `artisan_user_session=${sessionId}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.commits).toHaveLength(1);
    expect(body.commits[0].message).toBe("Initial commit");
  });

  test("GET branches 403 when not member", async () => {
    const { networkId, packId } = await seedUserWithPack("uA");
    await db.insert(users).values({
      id: "uB", email: "uB@a.b", name: "uB", passwordHash: null, avatarUrl: null,
      createdAt: new Date(), updatedAt: new Date(),
    });
    const sessB = (await createSession("uB")).id;
    const app = makeApp();
    const res = await app.request(`/api/v1/networks/${networkId}/packs/${packId}/branches`, {
      headers: { Cookie: `artisan_user_session=${sessB}` },
    });
    expect(res.status).toBe(403);
  });

  test("GET /branches/:branch/head returns the head commit's editor + files (Revert payload)", async () => {
    const { sessionId, networkId, packId } = await seedUserWithPack();
    const app = makeApp();
    const res = await app.request(
      `/api/v1/networks/${networkId}/packs/${packId}/branches/main/head`,
      { headers: { Cookie: `artisan_user_session=${sessionId}` } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.commit?.id).toBeDefined();
    expect(body.commit?.message).toBe("Initial commit");
    expect(typeof body.editor).toBe("object");
    expect(typeof body.files).toBe("object");
  });

  test("GET /branches/:branch/head returns 404 when branch unknown", async () => {
    const { sessionId, networkId, packId } = await seedUserWithPack();
    const app = makeApp();
    const res = await app.request(
      `/api/v1/networks/${networkId}/packs/${packId}/branches/does-not-exist/head`,
      { headers: { Cookie: `artisan_user_session=${sessionId}` } },
    );
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("branch_not_found");
  });

  test("GET /branches/:branch/head returns 403 when not member", async () => {
    const { networkId, packId } = await seedUserWithPack("uA");
    await db.insert(users).values({
      id: "uB2", email: "uB2@a.b", name: "uB2", passwordHash: null, avatarUrl: null,
      createdAt: new Date(), updatedAt: new Date(),
    });
    const sessB = (await createSession("uB2")).id;
    const app = makeApp();
    const res = await app.request(
      `/api/v1/networks/${networkId}/packs/${packId}/branches/main/head`,
      { headers: { Cookie: `artisan_user_session=${sessB}` } },
    );
    expect(res.status).toBe(403);
  });
});

// ─── B1b: GET /commits/:commitId/content ────────────────────────────────────

describe("userBranchesRouter — GET /commits/:commitId/content", () => {
  beforeEach(clearAll);

  test("GET /commits/:commitId/content returns content for a known commit", async () => {
    const { sessionId, networkId, packId } = await seedUserWithPack();
    const app = makeApp();
    // Get the initial commit's id via the branches list
    const branchRes = await app.request(`/api/v1/networks/${networkId}/packs/${packId}/branches`, {
      headers: { Cookie: `artisan_user_session=${sessionId}` },
    });
    const { branches } = await branchRes.json();
    const commitId = branches[0].headCommitId;

    const res = await app.request(
      `/api/v1/networks/${networkId}/packs/${packId}/commits/${commitId}/content`,
      { headers: { Cookie: `artisan_user_session=${sessionId}` } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.commit?.id).toBe(commitId);
    expect(typeof body.editor).toBe("object");
    expect(typeof body.files).toBe("object");
  });

  test("GET /commits/:commitId/content returns 404 when commit doesn't belong to pack", async () => {
    const { sessionId, networkId, packId } = await seedUserWithPack();
    const app = makeApp();
    const res = await app.request(
      `/api/v1/networks/${networkId}/packs/${packId}/commits/does-not-exist/content`,
      { headers: { Cookie: `artisan_user_session=${sessionId}` } },
    );
    expect(res.status).toBe(404);
  });
});

// ─── B2: POST /branches ─────────────────────────────────────────────────────

describe("userBranchesRouter — POST /branches", () => {
  beforeEach(clearAll);

  test("POST /branches creates a new branch from an existing branch", async () => {
    const { sessionId, networkId, packId } = await seedUserWithPack();
    const app = makeApp();
    const res = await app.request(`/api/v1/networks/${networkId}/packs/${packId}/branches`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "dev", from: "main" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.branch.name).toBe("dev");
    // dev should point to the same head commit as main initially
    const branchesRes = await app.request(`/api/v1/networks/${networkId}/packs/${packId}/branches`, {
      headers: { Cookie: `artisan_user_session=${sessionId}` },
    });
    const { branches } = await branchesRes.json();
    const main = branches.find((b: { name: string }) => b.name === "main");
    const dev = branches.find((b: { name: string }) => b.name === "dev");
    expect(dev.headCommitId).toBe(main.headCommitId);
  });

  test("POST /branches 422 when name missing or invalid", async () => {
    const { sessionId, networkId, packId } = await seedUserWithPack();
    const app = makeApp();
    const res = await app.request(`/api/v1/networks/${networkId}/packs/${packId}/branches`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "", from: "main" }),
    });
    expect(res.status).toBe(422);
  });

  test("POST /branches 409 when name already exists", async () => {
    const { sessionId, networkId, packId } = await seedUserWithPack();
    const app = makeApp();
    await app.request(`/api/v1/networks/${networkId}/packs/${packId}/branches`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "dev", from: "main" }),
    });
    const res = await app.request(`/api/v1/networks/${networkId}/packs/${packId}/branches`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "dev", from: "main" }),
    });
    expect(res.status).toBe(409);
  });
});

// ─── B3: POST /commits ───────────────────────────────────────────────────────

describe("userBranchesRouter — POST /commits", () => {
  beforeEach(clearAll);

  test("POST /commits creates commit from current WIP and advances branch head", async () => {
    const { sessionId, networkId, packId, userId } = await seedUserWithPack();

    await db.update(packs).set({
      filesJson: JSON.stringify({ "menus/m.yaml": "id: m" }),
      editorJson: JSON.stringify({ id: packId, menus: [{ id: "m" }] }),
    }).where(eq(packs.id, packId));

    const app = makeApp();
    const res = await app.request(`/api/v1/networks/${networkId}/packs/${packId}/commits`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ branch: "main", message: "first real commit" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.commit.message).toBe("first real commit");

    // Branch head must now point to the new commit
    const branch = await (await import("../lib/branchStorage")).getBranch(packId, "main");
    expect(branch!.headCommitId).toBe(body.commit.id);

    // Author is the logged-in user
    expect(body.commit.authorUserId).toBe(userId);
  });

  test("POST /commits 404 when branch does not exist", async () => {
    const { sessionId, networkId, packId } = await seedUserWithPack();
    const app = makeApp();
    const res = await app.request(`/api/v1/networks/${networkId}/packs/${packId}/commits`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ branch: "ghost", message: "x" }),
    });
    expect(res.status).toBe(404);
  });
});

// ─── B4: POST /branches/:src/promote/:dst ────────────────────────────────────

describe("userBranchesRouter — POST /branches/:src/promote/:dst", () => {
  beforeEach(clearAll);

  test("POST /branches/:src/promote/:dst advances dst to src.head when FF", async () => {
    const { sessionId, networkId, packId } = await seedUserWithPack();
    const app = makeApp();

    // Create dev branch (= main head)
    await app.request(`/api/v1/networks/${networkId}/packs/${packId}/branches`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "dev", from: "main" }),
    });

    // Update WIP + commit on dev (so dev.head > main.head in parent chain)
    await db.update(packs).set({
      filesJson: JSON.stringify({ "menus/m.yaml": "id: m\n" }),
    }).where(eq(packs.id, packId));
    await app.request(`/api/v1/networks/${networkId}/packs/${packId}/commits`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ branch: "dev", message: "dev work" }),
    });

    // Promote dev → main
    const promoteRes = await app.request(`/api/v1/networks/${networkId}/packs/${packId}/branches/dev/promote/main`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}` },
    });
    expect(promoteRes.status).toBe(200);

    // main.head should now equal dev.head
    const { getBranch } = await import("../lib/branchStorage");
    const main = await getBranch(packId, "main");
    const dev = await getBranch(packId, "dev");
    expect(main!.headCommitId).toBe(dev!.headCommitId);
  });

  test("POST /branches/.../promote/... 409 when dst has diverged (not fast-forward)", async () => {
    const { sessionId, networkId, packId } = await seedUserWithPack();
    const app = makeApp();
    await app.request(`/api/v1/networks/${networkId}/packs/${packId}/branches`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "dev", from: "main" }),
    });

    // Commit on dev
    await db.update(packs).set({ filesJson: JSON.stringify({ "f": "dev" }) }).where(eq(packs.id, packId));
    await app.request(`/api/v1/networks/${networkId}/packs/${packId}/commits`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ branch: "dev", message: "dev1" }),
    });

    // Commit on main (separately)
    await db.update(packs).set({ filesJson: JSON.stringify({ "f": "main" }) }).where(eq(packs.id, packId));
    await app.request(`/api/v1/networks/${networkId}/packs/${packId}/commits`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ branch: "main", message: "main1" }),
    });

    // Now promote dev → main : not FF
    const res = await app.request(`/api/v1/networks/${networkId}/packs/${packId}/branches/dev/promote/main`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}` },
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/not_fast_forward/);
  });
});

// ─── C1: POST /branches/:src/merge-into/:dst ─────────────────────────────────

describe("POST /merge-into — FF + already-merged + 3-way", () => {
  beforeEach(clearAll);

  test("FF case (src is descendant of dst) advances dst.head + broadcasts", async () => {
    const { sessionId, networkId, packId } = await seedUserWithPack();
    const app = makeApp();

    // Create dev branch
    await app.request(`/api/v1/networks/${networkId}/packs/${packId}/branches`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "dev", from: "main" }),
    });

    // Commit on dev only
    await db.update(packs).set({
      filesJson: JSON.stringify({ "x": "1" }),
      editorJson: JSON.stringify({ menus: [{ id: "m_a", name: "alpha" }] }),
    }).where(eq(packs.id, packId));
    await app.request(`/api/v1/networks/${networkId}/packs/${packId}/commits`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ branch: "dev", message: "dev1" }),
    });

    // Merge dev → main : should be a fast-forward (main hasn't advanced)
    const res = await app.request(`/api/v1/networks/${networkId}/packs/${packId}/branches/dev/merge-into/main`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.kind).toBe("fast_forward");
    expect(body.advanced).toBe(true);

    // main.head now equals dev.head
    const { getBranch } = await import("../lib/branchStorage");
    const main = await getBranch(packId, "main");
    const dev = await getBranch(packId, "dev");
    expect(main!.headCommitId).toBe(dev!.headCommitId);
  });

  test("already-merged (src is ancestor of dst) returns 200 already_merged", async () => {
    const { sessionId, networkId, packId } = await seedUserWithPack();
    const app = makeApp();
    // dev branched from main, no new commits
    await app.request(`/api/v1/networks/${networkId}/packs/${packId}/branches`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "dev", from: "main" }),
    });
    const res = await app.request(`/api/v1/networks/${networkId}/packs/${packId}/branches/dev/merge-into/main`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.kind).toBe("already_merged");
  });

  test("3-way auto-merge returns kind=auto with empty conflicts + mergedEditorJson", async () => {
    const { sessionId, networkId, packId } = await seedUserWithPack();
    const app = makeApp();
    // Create dev with a different commit content from main.
    await app.request(`/api/v1/networks/${networkId}/packs/${packId}/branches`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "dev", from: "main" }),
    });

    // Commit on dev: add menu m_dev
    await db.update(packs).set({
      filesJson: JSON.stringify({ "menus/m_dev.yaml": "id: m_dev" }),
      editorJson: JSON.stringify({ menus: [{ id: "m_dev", name: "dev_menu" }] }),
    }).where(eq(packs.id, packId));
    await app.request(`/api/v1/networks/${networkId}/packs/${packId}/commits`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ branch: "dev", message: "dev1" }),
    });

    // Commit on main: add menu m_main (different id, no conflict)
    await db.update(packs).set({
      filesJson: JSON.stringify({ "menus/m_main.yaml": "id: m_main" }),
      editorJson: JSON.stringify({ menus: [{ id: "m_main", name: "main_menu" }] }),
    }).where(eq(packs.id, packId));
    await app.request(`/api/v1/networks/${networkId}/packs/${packId}/commits`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ branch: "main", message: "main1" }),
    });

    const res = await app.request(`/api/v1/networks/${networkId}/packs/${packId}/branches/dev/merge-into/main`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.kind).toBe("auto");
    expect(body.conflicts).toEqual([]);
    // mergedEditorJson should contain BOTH menus
    const ids = (body.mergedEditorJson.menus as Array<{ id: string }>).map((m) => m.id).sort();
    expect(ids).toEqual(["m_dev", "m_main"]);
    expect(body.lcaCommitId).toBeDefined();
    expect(body.srcCommitId).toBeDefined();
    expect(body.dstCommitId).toBeDefined();
  });

  test("3-way conflict returns kind=conflicts with the conflict list", async () => {
    const { sessionId, networkId, packId } = await seedUserWithPack();
    const app = makeApp();
    await app.request(`/api/v1/networks/${networkId}/packs/${packId}/branches`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "dev", from: "main" }),
    });
    // Same id on both, different names → conflict
    await db.update(packs).set({
      filesJson: JSON.stringify({ "menus/m_x.yaml": "id: m_x\nname: src-x" }),
      editorJson: JSON.stringify({ menus: [{ id: "m_x", name: "src-x" }] }),
    }).where(eq(packs.id, packId));
    await app.request(`/api/v1/networks/${networkId}/packs/${packId}/commits`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ branch: "dev", message: "d" }),
    });
    await db.update(packs).set({
      filesJson: JSON.stringify({ "menus/m_x.yaml": "id: m_x\nname: dst-x" }),
      editorJson: JSON.stringify({ menus: [{ id: "m_x", name: "dst-x" }] }),
    }).where(eq(packs.id, packId));
    await app.request(`/api/v1/networks/${networkId}/packs/${packId}/commits`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ branch: "main", message: "m" }),
    });

    const res = await app.request(`/api/v1/networks/${networkId}/packs/${packId}/branches/dev/merge-into/main`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.kind).toBe("conflicts");
    expect(body.conflicts).toHaveLength(1);
    expect(body.conflicts[0].conflictKey).toBe("menus:m_x");
    expect(body.lcaCommitId).toBeDefined();
    expect(body.srcCommitId).toBeDefined();
    expect(body.dstCommitId).toBeDefined();
  });

  test("same src and dst returns 400 same_branch", async () => {
    const { sessionId, networkId, packId } = await seedUserWithPack();
    const app = makeApp();
    const res = await app.request(`/api/v1/networks/${networkId}/packs/${packId}/branches/main/merge-into/main`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("same_branch");
  });

  test("unknown branch returns 404", async () => {
    const { sessionId, networkId, packId } = await seedUserWithPack();
    const app = makeApp();
    const res = await app.request(`/api/v1/networks/${networkId}/packs/${packId}/branches/ghost/merge-into/main`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);
  });
});

// ─── C2: POST /branches/:src/merge-into/:dst/resolve ─────────────────────────

describe("POST /merge-into/.../resolve", () => {
  beforeEach(clearAll);

  test("resolve auto-merge (empty conflicts) creates merge commit + advances dst", async () => {
    const { sessionId, networkId, packId } = await seedUserWithPack();
    const app = makeApp();
    // Set up an auto-merge scenario (different items on each branch)
    await app.request(`/api/v1/networks/${networkId}/packs/${packId}/branches`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "dev", from: "main" }),
    });
    await db.update(packs).set({
      filesJson: JSON.stringify({ "menus/m_dev.yaml": "id: m_dev" }),
      editorJson: JSON.stringify({ menus: [{ id: "m_dev", name: "d" }] }),
    }).where(eq(packs.id, packId));
    await app.request(`/api/v1/networks/${networkId}/packs/${packId}/commits`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ branch: "dev", message: "d" }),
    });
    await db.update(packs).set({
      filesJson: JSON.stringify({ "menus/m_main.yaml": "id: m_main" }),
      editorJson: JSON.stringify({ menus: [{ id: "m_main", name: "m" }] }),
    }).where(eq(packs.id, packId));
    await app.request(`/api/v1/networks/${networkId}/packs/${packId}/commits`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ branch: "main", message: "m" }),
    });

    // Get the merge plan
    const planRes = await app.request(`/api/v1/networks/${networkId}/packs/${packId}/branches/dev/merge-into/main`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const plan = await planRes.json();

    // Client would derive filesJson from plan.mergedEditorJson here; we use a stub.
    const mergedFiles = { "merged.yaml": "x" };

    const resolveRes = await app.request(`/api/v1/networks/${networkId}/packs/${packId}/branches/dev/merge-into/main/resolve`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        resolutions: {},  // empty for auto-merge
        lcaCommitId: plan.lcaCommitId,
        srcCommitId: plan.srcCommitId,
        dstCommitId: plan.dstCommitId,
        mergedFilesJson: mergedFiles,
        mergedEditorJson: plan.mergedEditorJson,
      }),
    });
    expect(resolveRes.status).toBe(201);
    const body = await resolveRes.json();
    expect(body.commit.id).toMatch(/^cmt_/);

    // Verify merge commit has parentId2 set
    const { getCommit } = await import("../lib/commitStorage");
    const cmt = await getCommit(body.commit.id);
    expect(cmt!.parentId).toBe(plan.dstCommitId);
    expect(cmt!.parentId2).toBe(plan.srcCommitId);

    // main.head advanced
    const { getBranch } = await import("../lib/branchStorage");
    const main = await getBranch(packId, "main");
    expect(main!.headCommitId).toBe(body.commit.id);
  });

  test("resolve with conflict choices applies them correctly", async () => {
    const { sessionId, networkId, packId } = await seedUserWithPack();
    const app = makeApp();
    await app.request(`/api/v1/networks/${networkId}/packs/${packId}/branches`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "dev", from: "main" }),
    });
    // Same id, different name → conflict
    await db.update(packs).set({
      filesJson: JSON.stringify({ "menus/m_x.yaml": "id: m_x\nname: src-x" }),
      editorJson: JSON.stringify({ menus: [{ id: "m_x", name: "src-x" }] }),
    }).where(eq(packs.id, packId));
    await app.request(`/api/v1/networks/${networkId}/packs/${packId}/commits`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ branch: "dev", message: "d" }),
    });
    await db.update(packs).set({
      filesJson: JSON.stringify({ "menus/m_x.yaml": "id: m_x\nname: dst-x" }),
      editorJson: JSON.stringify({ menus: [{ id: "m_x", name: "dst-x" }] }),
    }).where(eq(packs.id, packId));
    await app.request(`/api/v1/networks/${networkId}/packs/${packId}/commits`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ branch: "main", message: "m" }),
    });

    const planRes = await app.request(`/api/v1/networks/${networkId}/packs/${packId}/branches/dev/merge-into/main`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const plan = await planRes.json();
    expect(plan.conflicts).toHaveLength(1);

    const resolveRes = await app.request(`/api/v1/networks/${networkId}/packs/${packId}/branches/dev/merge-into/main/resolve`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        resolutions: { "menus:m_x": "src" },
        lcaCommitId: plan.lcaCommitId,
        srcCommitId: plan.srcCommitId,
        dstCommitId: plan.dstCommitId,
        mergedFilesJson: { "menus/m_x.yaml": "id: m_x\nname: src-x" },
        mergedEditorJson: { menus: [{ id: "m_x", name: "src-x" }] },
      }),
    });
    expect(resolveRes.status).toBe(201);
    const body = await resolveRes.json();
    const { getCommit } = await import("../lib/commitStorage");
    const cmt = await getCommit(body.commit.id);
    const editor = JSON.parse(cmt!.editorJson!);
    expect(editor.menus.find((m: { id: string; name: string }) => m.id === "m_x").name).toBe("src-x");
  });

  test("resolve with stale heads returns 409 stale_merge", async () => {
    const { sessionId, networkId, packId } = await seedUserWithPack();
    const app = makeApp();
    await app.request(`/api/v1/networks/${networkId}/packs/${packId}/branches`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "dev", from: "main" }),
    });
    await db.update(packs).set({
      filesJson: JSON.stringify({ "menus/m_a.yaml": "id: m_a\nname: v1" }),
      editorJson: JSON.stringify({ menus: [{ id: "m_a", name: "v1" }] }),
    }).where(eq(packs.id, packId));
    await app.request(`/api/v1/networks/${networkId}/packs/${packId}/commits`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ branch: "dev", message: "d" }),
    });

    // POST resolve with random ids that don't match
    const res = await app.request(`/api/v1/networks/${networkId}/packs/${packId}/branches/dev/merge-into/main/resolve`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        resolutions: {},
        lcaCommitId: "cmt_stale1",
        srcCommitId: "cmt_stale2",
        dstCommitId: "cmt_stale3",
        mergedFilesJson: {},
        mergedEditorJson: {},
      }),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("stale_merge");
  });

  test("resolve with missing resolution for a conflict returns 400", async () => {
    const { sessionId, networkId, packId } = await seedUserWithPack();
    const app = makeApp();
    await app.request(`/api/v1/networks/${networkId}/packs/${packId}/branches`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "dev", from: "main" }),
    });
    await db.update(packs).set({
      filesJson: JSON.stringify({ "menus/m_y.yaml": "id: m_y\nname: s" }),
      editorJson: JSON.stringify({ menus: [{ id: "m_y", name: "s" }] }),
    }).where(eq(packs.id, packId));
    await app.request(`/api/v1/networks/${networkId}/packs/${packId}/commits`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ branch: "dev", message: "d" }),
    });
    await db.update(packs).set({
      filesJson: JSON.stringify({ "menus/m_y.yaml": "id: m_y\nname: d" }),
      editorJson: JSON.stringify({ menus: [{ id: "m_y", name: "d" }] }),
    }).where(eq(packs.id, packId));
    await app.request(`/api/v1/networks/${networkId}/packs/${packId}/commits`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ branch: "main", message: "m" }),
    });

    const planRes = await app.request(`/api/v1/networks/${networkId}/packs/${packId}/branches/dev/merge-into/main`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const plan = await planRes.json();

    const res = await app.request(`/api/v1/networks/${networkId}/packs/${packId}/branches/dev/merge-into/main/resolve`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        resolutions: {},  // empty but there's 1 conflict
        lcaCommitId: plan.lcaCommitId,
        srcCommitId: plan.srcCommitId,
        dstCommitId: plan.dstCommitId,
        mergedFilesJson: {},
        mergedEditorJson: plan.mergedEditorJson,
      }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("missing_resolutions");
  });
});
