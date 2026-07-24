// backend/src/routes/userBranches.test.ts
import { beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { db } from "../db/index";
import {
  memberships, networks, projects, serverKeys,
  linkCodes, projectCommits, projectBranches, assets,
  users, userSessions,
} from "../db/schema";
import { eq } from "drizzle-orm";
import { userBranchesRouter } from "./userBranches";
import { userAuth } from "../middleware/userAuth";
import { createSession } from "../lib/sessionManager";
import { createNetwork } from "../lib/networkManager";
import { addMembership } from "../lib/membershipManager";
import { createProject } from "../lib/projectStorage";
import { generateServerKey } from "../lib/auth";

async function clearAll() {
  await db.delete(projectBranches);
  await db.delete(projectCommits);
  await db.delete(assets);
  await db.delete(projects);
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
  const pack = await createProject({ networkId: net.id, serverKeyId: skId, name: "p" });
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

  test("GET /:netId/projects/:projectId/branches returns main after createProject", async () => {
    const { sessionId, networkId, packId } = await seedUserWithPack();
    const app = makeApp();
    const res = await app.request(`/api/v1/networks/${networkId}/projects/${packId}/branches`, {
      headers: { Cookie: `artisan_user_session=${sessionId}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.branches).toHaveLength(1);
    expect(body.branches[0].name).toBe("main");
  });

  test("GET /:netId/projects/:projectId/commits?branch=main returns the initial commit", async () => {
    const { sessionId, networkId, packId } = await seedUserWithPack();
    const app = makeApp();
    const res = await app.request(`/api/v1/networks/${networkId}/projects/${packId}/commits?branch=main`, {
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
    const res = await app.request(`/api/v1/networks/${networkId}/projects/${packId}/branches`, {
      headers: { Cookie: `artisan_user_session=${sessB}` },
    });
    expect(res.status).toBe(403);
  });

  test("GET /branches/:branch/head returns the head commit's files (Revert payload)", async () => {
    const { sessionId, networkId, packId } = await seedUserWithPack();
    const app = makeApp();
    const res = await app.request(
      `/api/v1/networks/${networkId}/projects/${packId}/branches/main/head`,
      { headers: { Cookie: `artisan_user_session=${sessionId}` } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.commit?.id).toBeDefined();
    expect(body.commit?.message).toBe("Initial commit");
    // Files-first: no editor JSON on the wire — the client parses `files`.
    expect(body.editor).toBeUndefined();
    expect(typeof body.files).toBe("object");
  });

  test("GET /branches/:branch/head returns 404 when branch unknown", async () => {
    const { sessionId, networkId, packId } = await seedUserWithPack();
    const app = makeApp();
    const res = await app.request(
      `/api/v1/networks/${networkId}/projects/${packId}/branches/does-not-exist/head`,
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
      `/api/v1/networks/${networkId}/projects/${packId}/branches/main/head`,
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
    const branchRes = await app.request(`/api/v1/networks/${networkId}/projects/${packId}/branches`, {
      headers: { Cookie: `artisan_user_session=${sessionId}` },
    });
    const { branches } = await branchRes.json();
    const commitId = branches[0].headCommitId;

    const res = await app.request(
      `/api/v1/networks/${networkId}/projects/${packId}/commits/${commitId}/content`,
      { headers: { Cookie: `artisan_user_session=${sessionId}` } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.commit?.id).toBe(commitId);
    expect(body.editor).toBeUndefined();
    expect(typeof body.files).toBe("object");
  });

  test("GET /commits/:commitId/content returns 404 when commit doesn't belong to pack", async () => {
    const { sessionId, networkId, packId } = await seedUserWithPack();
    const app = makeApp();
    const res = await app.request(
      `/api/v1/networks/${networkId}/projects/${packId}/commits/does-not-exist/content`,
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
    const res = await app.request(`/api/v1/networks/${networkId}/projects/${packId}/branches`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "dev", from: "main" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.branch.name).toBe("dev");
    // dev should point to the same head commit as main initially
    const branchesRes = await app.request(`/api/v1/networks/${networkId}/projects/${packId}/branches`, {
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
    const res = await app.request(`/api/v1/networks/${networkId}/projects/${packId}/branches`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "", from: "main" }),
    });
    expect(res.status).toBe(422);
  });

  test("POST /branches 409 when name already exists", async () => {
    const { sessionId, networkId, packId } = await seedUserWithPack();
    const app = makeApp();
    await app.request(`/api/v1/networks/${networkId}/projects/${packId}/branches`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "dev", from: "main" }),
    });
    const res = await app.request(`/api/v1/networks/${networkId}/projects/${packId}/branches`, {
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

    await db.update(projects).set({
      filesJson: JSON.stringify({ "menus/m.yaml": "id: m" }),
    }).where(eq(projects.id, packId));

    const app = makeApp();
    const res = await app.request(`/api/v1/networks/${networkId}/projects/${packId}/commits`, {
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
    const res = await app.request(`/api/v1/networks/${networkId}/projects/${packId}/commits`, {
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
    await app.request(`/api/v1/networks/${networkId}/projects/${packId}/branches`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "dev", from: "main" }),
    });

    // Update WIP + commit on dev (so dev.head > main.head in parent chain)
    await db.update(projects).set({
      filesJson: JSON.stringify({ "menus/m.yaml": "id: m\n" }),
    }).where(eq(projects.id, packId));
    await app.request(`/api/v1/networks/${networkId}/projects/${packId}/commits`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ branch: "dev", message: "dev work" }),
    });

    // Promote dev → main
    const promoteRes = await app.request(`/api/v1/networks/${networkId}/projects/${packId}/branches/dev/promote/main`, {
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
    await app.request(`/api/v1/networks/${networkId}/projects/${packId}/branches`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "dev", from: "main" }),
    });

    // Commit on dev
    await db.update(projects).set({ filesJson: JSON.stringify({ "f": "dev" }) }).where(eq(projects.id, packId));
    await app.request(`/api/v1/networks/${networkId}/projects/${packId}/commits`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ branch: "dev", message: "dev1" }),
    });

    // Commit on main (separately)
    await db.update(projects).set({ filesJson: JSON.stringify({ "f": "main" }) }).where(eq(projects.id, packId));
    await app.request(`/api/v1/networks/${networkId}/projects/${packId}/commits`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ branch: "main", message: "main1" }),
    });

    // Now promote dev → main : not FF
    const res = await app.request(`/api/v1/networks/${networkId}/projects/${packId}/branches/dev/promote/main`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}` },
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/not_fast_forward/);
  });
});
