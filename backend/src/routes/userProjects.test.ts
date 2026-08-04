// backend/src/routes/userProjects.test.ts
import { beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { db } from "../db/index";
import {
  memberships, networks, projects, serverKeys,
  linkCodes, assets, users, userSessions,
} from "../db/schema";
import { userProjectsRouter } from "./userProjects";
import { userAuth } from "../middleware/userAuth";
import { createSession } from "../lib/sessionManager";
import { createNetwork } from "../lib/networkManager";
import { addMembership } from "../lib/membershipManager";
import { createProject, getProject, upsertProjectContent } from "../lib/projectStorage";
import { generateServerKey } from "../lib/auth";
import { registerEditorConn } from "../ws/hub";

async function clearAll() {
  await db.delete(assets);
  await db.delete(projects);
  await db.delete(linkCodes);
  await db.delete(serverKeys);
  await db.delete(memberships);
  await db.delete(networks);
  await db.delete(userSessions);
  await db.delete(users);
}

async function seedUserWithProject(userId: string) {
  await db.insert(users).values({
    id: userId,
    email: `${userId}@a.b`,
    name: userId,
    passwordHash: null,
    avatarUrl: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const session = await createSession(userId);
  const network = await createNetwork("N");
  await addMembership(userId, network.id, "owner");
  const { id: skId, hash: skHash } = await generateServerKey();
  await db.insert(serverKeys).values({ id: skId, hash: skHash, label: null, networkId: network.id, createdAt: new Date() });
  const project = await createProject({ networkId: network.id, serverKeyId: skId, name: "p" });
  await upsertProjectContent(project.id, {
    hash: "h1",
    filesJson: '{"menus/m.yaml":"id: m"}',
  });
  return { userId, sessionId: session.id, networkId: network.id, projectId: project.id, skId };
}

function makeApp() {
  const app = new Hono();
  app.use("/api/v1/user/projects/*", userAuth());
  app.route("/api/v1/user/projects", userProjectsRouter);
  return app;
}

describe("userProjectsRouter — GET", () => {
  beforeEach(clearAll);

  test("GET /:projectId 200 — member gets project content", async () => {
    const { sessionId, projectId } = await seedUserWithProject("u1");
    const app = makeApp();
    const res = await app.request(`/api/v1/user/projects/${projectId}`, {
      headers: { Cookie: `artisan_user_session=${sessionId}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.project.id).toBe(projectId);
    expect(body.project.hash).toBe("h1");
    expect(body.files).toEqual({ "menus/m.yaml": "id: m" });
    // Files-first: no editor JSON on the wire — the client parses `files`.
    expect(body.editor).toBeUndefined();
  });

  test("GET /:projectId 403 — non-member gets forbidden", async () => {
    const { projectId } = await seedUserWithProject("u1");
    await db.insert(users).values({
      id: "u2", email: "u2@a.b", name: "u2", passwordHash: null, avatarUrl: null,
      createdAt: new Date(), updatedAt: new Date(),
    });
    const sess2 = await createSession("u2");
    const app = makeApp();
    const res = await app.request(`/api/v1/user/projects/${projectId}`, {
      headers: { Cookie: `artisan_user_session=${sess2.id}` },
    });
    expect(res.status).toBe(403);
  });

  test("GET /:projectId 404 — project does not exist", async () => {
    const { sessionId } = await seedUserWithProject("u1");
    const app = makeApp();
    const res = await app.request("/api/v1/user/projects/pack_nonexistent", {
      headers: { Cookie: `artisan_user_session=${sessionId}` },
    });
    expect(res.status).toBe(404);
  });
});

describe("userProjectsRouter — PUT", () => {
  beforeEach(clearAll);

  test("PUT /:projectId 200 — member updates project content", async () => {
    const { sessionId, projectId } = await seedUserWithProject("u1");
    const app = makeApp();
    const res = await app.request(`/api/v1/user/projects/${projectId}`, {
      method: "PUT",
      headers: {
        Cookie: `artisan_user_session=${sessionId}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        hash: "h2",
        files: { "menus/m.yaml": "id: m\ntitle: Hello" },
        editor: { id: projectId, menus: [{ id: "m" }] },
        baseVersion: 1,
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    // Verify DB updated
    const { getProject } = await import("../lib/projectStorage");
    const updated = await getProject(projectId);
    expect(updated?.hash).toBe("h2");
    expect(JSON.parse(updated?.filesJson ?? "{}")).toEqual({ "menus/m.yaml": "id: m\ntitle: Hello" });
  });

  test("GET /:projectId returns project version", async () => {
    const { sessionId, projectId } = await seedUserWithProject("u1");
    const app = makeApp();
    const res = await app.request(`/api/v1/user/projects/${projectId}`, {
      headers: { Cookie: `artisan_user_session=${sessionId}` },
    });
    const body = await res.json();
    // seedUserWithProject does one upsert after createProject → version 1
    expect(body.project.version).toBe(1);
  });

  test("PUT /:projectId 200 — matching baseVersion saves and returns new version", async () => {
    const { sessionId, projectId } = await seedUserWithProject("u1");
    const app = makeApp();
    const res = await app.request(`/api/v1/user/projects/${projectId}`, {
      method: "PUT",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ hash: "h2", files: {}, baseVersion: 1 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.version).toBe(2);
  });

  test("PUT /:projectId 409 — stale baseVersion is rejected without overwriting", async () => {
    const { sessionId, projectId } = await seedUserWithProject("u1");
    const app = makeApp();
    // concurrent writer bumps the version
    const ok = await app.request(`/api/v1/user/projects/${projectId}`, {
      method: "PUT",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ hash: "h2", files: { "menus/m.yaml": "id: m2" }, baseVersion: 1 }),
    });
    expect(ok.status).toBe(200);

    // stale tab still holds baseVersion 1
    const res = await app.request(`/api/v1/user/projects/${projectId}`, {
      method: "PUT",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ hash: "h_stale", files: { "menus/m.yaml": "id: stale" }, baseVersion: 1 }),
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("version_conflict");
    expect(body.currentVersion).toBe(2);

    const { getProject } = await import("../lib/projectStorage");
    const row = await getProject(projectId);
    expect(row?.hash).toBe("h2");
  });

  test("PUT /:projectId 400 — missing baseVersion is rejected", async () => {
    const { sessionId, projectId } = await seedUserWithProject("u1");
    const app = makeApp();
    const res = await app.request(`/api/v1/user/projects/${projectId}`, {
      method: "PUT",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ hash: "h2", files: {} }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("missing_base_version");
  });

  test("PUT /:projectId 403 — non-member cannot write", async () => {
    const { projectId } = await seedUserWithProject("u1");
    await db.insert(users).values({
      id: "u2", email: "u2@a.b", name: "u2", passwordHash: null, avatarUrl: null,
      createdAt: new Date(), updatedAt: new Date(),
    });
    const sess2 = await createSession("u2");
    const app = makeApp();
    const res = await app.request(`/api/v1/user/projects/${projectId}`, {
      method: "PUT",
      headers: {
        Cookie: `artisan_user_session=${sess2.id}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ hash: "h99", files: {} }),
    });
    expect(res.status).toBe(403);
  });
});

describe("userProjectsRouter — POST /:projectId/draft", () => {
  beforeEach(clearAll);

  test("200 for member and broadcasts draft_update to other editor connections", async () => {
    const { sessionId, projectId, skId } = await seedUserWithProject("u1");
    const app = makeApp();

    const receivedByOther: string[] = [];
    registerEditorConn("other-editor-conn", skId, (msg) => receivedByOther.push(msg));

    const res = await app.request(`/api/v1/user/projects/${projectId}/draft`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ menu_id: "shop_main", menu_yaml: "title: Shop\n" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    expect(receivedByOther.length).toBe(1);
    const msg = JSON.parse(receivedByOther[0]) as { type: string; menu_id: string };
    expect(msg.type).toBe("draft_update");
    expect(msg.menu_id).toBe("shop_main");
  });

  test("403 — non-member cannot broadcast draft", async () => {
    const { projectId } = await seedUserWithProject("u1");
    await db.insert(users).values({
      id: "u2", email: "u2@a.b", name: "u2", passwordHash: null, avatarUrl: null,
      createdAt: new Date(), updatedAt: new Date(),
    });
    const sess2 = await createSession("u2");
    const app = makeApp();
    const res = await app.request(`/api/v1/user/projects/${projectId}/draft`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sess2.id}`, "Content-Type": "application/json" },
      body: JSON.stringify({ menu_id: "shop_main", menu_yaml: "title: Shop\n" }),
    });
    expect(res.status).toBe(403);
  });
});

describe("userProjectsRouter — DELETE /:projectId", () => {
  beforeEach(clearAll);

  test("200 — member soft-deletes project (row kept, deletedAt set)", async () => {
    const { sessionId, projectId } = await seedUserWithProject("u1");
    const app = makeApp();

    const res = await app.request(`/api/v1/user/projects/${projectId}`, {
      method: "DELETE",
      headers: { Cookie: `artisan_user_session=${sessionId}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deleted).toBe(true);

    const row = await getProject(projectId);
    expect(row).not.toBeNull(); // softDeleteProject keeps the row
    expect(row?.deletedAt).not.toBeNull();
  });

  test("200 — DELETE is idempotent-guarded: second call 404s (already deleted)", async () => {
    const { sessionId, projectId } = await seedUserWithProject("u1");
    const app = makeApp();

    await app.request(`/api/v1/user/projects/${projectId}`, {
      method: "DELETE",
      headers: { Cookie: `artisan_user_session=${sessionId}` },
    });
    const res2 = await app.request(`/api/v1/user/projects/${projectId}`, {
      method: "DELETE",
      headers: { Cookie: `artisan_user_session=${sessionId}` },
    });
    expect(res2.status).toBe(404);
  });

  test("403 — non-member cannot delete", async () => {
    const { projectId } = await seedUserWithProject("u1");
    await db.insert(users).values({
      id: "u2", email: "u2@a.b", name: "u2", passwordHash: null, avatarUrl: null,
      createdAt: new Date(), updatedAt: new Date(),
    });
    const sess2 = await createSession("u2");
    const app = makeApp();
    const res = await app.request(`/api/v1/user/projects/${projectId}`, {
      method: "DELETE",
      headers: { Cookie: `artisan_user_session=${sess2.id}` },
    });
    expect(res.status).toBe(403);

    const row = await getProject(projectId);
    expect(row?.deletedAt).toBeNull();
  });
});

// ─── files-first P3c: divergence report + per-file resolution ────────────────

describe("userProjectsRouter — divergence", () => {
  beforeEach(clearAll);

  async function seedDivergence(projectId: string, skId: string) {
    const { registerConn, connToServerId, handlePluginMessage } = await import("../ws/hub");
    const connId = `conn-div-${projectId}`;
    registerConn(connId, () => {});
    connToServerId.set(connId, skId);
    const base = `plugins/Artisan/projects/${projectId}`;
    await handlePluginMessage(connId, JSON.stringify({
      type: "sync_divergence",
      project_id: projectId,
      files: {
        [`${base}/menus/m.yaml`]: "id: m\ntitle: DISK\n",
        [`${base}/menus/disk_only.yaml`]: "id: disk_only\n",
      },
      disk_hash: "h_disk",
      synced_hash: "h_old",
    }));
    return base;
  }

  test("GET includes the per-file divergence detail while pending", async () => {
    const { sessionId, projectId, skId } = await seedUserWithProject("u1");
    const base = `plugins/Artisan/projects/${projectId}`;
    await upsertProjectContent(projectId, {
      filesJson: JSON.stringify({ [`${base}/menus/m.yaml`]: "id: m\ntitle: WEB\n" }),
    });
    await seedDivergence(projectId, skId);

    const app = makeApp();
    const res = await app.request(`/api/v1/user/projects/${projectId}`, {
      headers: { Cookie: `artisan_user_session=${sessionId}` },
    });
    const body = await res.json();
    expect(body.divergence).toBeDefined();
    expect(body.divergence.disk_hash).toBe("h_disk");
    expect(body.divergence.files).toEqual([
      { path: "menus/disk_only.yaml", disk: "id: disk_only\n", web: null },
      { path: "menus/m.yaml", disk: "id: m\ntitle: DISK\n", web: "id: m\ntitle: WEB\n" },
    ]);
  });

  test("resolve-divergence applies per-file choices, commits, clears the report", async () => {
    const { sessionId, projectId, skId } = await seedUserWithProject("u1");
    const base = `plugins/Artisan/projects/${projectId}`;
    await upsertProjectContent(projectId, {
      filesJson: JSON.stringify({ [`${base}/menus/m.yaml`]: "id: m\ntitle: WEB\n" }),
    });
    await seedDivergence(projectId, skId);

    const app = makeApp();
    const res = await app.request(`/api/v1/user/projects/${projectId}/resolve-divergence`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ choices: { "menus/m.yaml": "disk", "menus/disk_only.yaml": "web" } }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    const updated = await getProject(projectId);
    const files = JSON.parse(updated!.filesJson);
    expect(files[`${base}/menus/m.yaml`]).toBe("id: m\ntitle: DISK\n"); // disk chosen
    expect(files[`${base}/menus/disk_only.yaml`]).toBeUndefined();      // web chosen (absent)

    // Committed on main + head advanced.
    const { getBranch } = await import("../lib/branchStorage");
    const { getCommit } = await import("../lib/commitStorage");
    const branch = await getBranch(projectId, "main");
    const head = await getCommit(branch!.headCommitId);
    expect(head!.message).toBe("Resolve disk/web divergence");

    // Cleared: GET no longer reports it.
    const { getPendingDivergence } = await import("../ws/hub");
    expect(getPendingDivergence(projectId)).toBeUndefined();
  });

  test("resolve-divergence broadcasts a FORCED bundle_available (plugin must download over its local changes)", async () => {
    const { sessionId, projectId, skId } = await seedUserWithProject("u1");
    const base = `plugins/Artisan/projects/${projectId}`;
    await upsertProjectContent(projectId, {
      filesJson: JSON.stringify({ [`${base}/menus/m.yaml`]: "id: m\ntitle: WEB\n" }),
    });
    await seedDivergence(projectId, skId);

    const { registerConn, connToServerId, connSenders } = await import("../ws/hub");
    const sent: string[] = [];
    registerConn("conn-resolve", (msg) => sent.push(msg));
    connToServerId.set("conn-resolve", skId);
    try {
      const app = makeApp();
      const res = await app.request(`/api/v1/user/projects/${projectId}/resolve-divergence`, {
        method: "POST",
        headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
        body: JSON.stringify({ choices: { "menus/m.yaml": "disk" } }),
      });
      expect(res.status).toBe(200);

      const bundle = sent.map((s) => JSON.parse(s)).find((m) => m.type === "bundle_available");
      expect(bundle).toBeDefined();
      expect(bundle.force).toBe(true);
    } finally {
      connToServerId.delete("conn-resolve");
      connSenders.delete("conn-resolve");
    }
  });

  test("resolve-divergence 404 when nothing is pending", async () => {
    const { sessionId, projectId } = await seedUserWithProject("u1");
    const app = makeApp();
    const res = await app.request(`/api/v1/user/projects/${projectId}/resolve-divergence`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ choices: {} }),
    });
    expect(res.status).toBe(404);
  });
});

// Le slug de project est unique PAR SERVEUR (uniqueIndex serverKeyId+slug), pas
// globalement : la résolution n'est donc possible qu'avec le serveur en portée,
// que l'URL de l'éditeur porte déjà (/networks/:n/servers/:s/projects/:p).
describe("userProjectsRouter — GET par slug", () => {
  beforeEach(clearAll);

  test("résout le slug quand le serveur est fourni", async () => {
    const { sessionId, projectId, skId } = await seedUserWithProject("u1");
    const project = (await getProject(projectId))!;
    const app = makeApp();
    const res = await app.request(`/api/v1/user/projects/${project.slug}?server=${skId}`, {
      headers: { Cookie: `artisan_user_session=${sessionId}` },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).project.id).toBe(projectId);
  });

  test("l'id continue de marcher, avec ou sans serveur", async () => {
    const { sessionId, projectId, skId } = await seedUserWithProject("u1");
    const app = makeApp();
    for (const url of [
      `/api/v1/user/projects/${projectId}`,
      `/api/v1/user/projects/${projectId}?server=${skId}`,
    ]) {
      const res = await app.request(url, { headers: { Cookie: `artisan_user_session=${sessionId}` } });
      expect(res.status).toBe(200);
      expect((await res.json()).project.id).toBe(projectId);
    }
  });

  // Le piège que la portée serveur évite : deux serveurs peuvent porter le même
  // slug de project, un lookup global tomberait sur celui d'un autre serveur.
  test("ne traverse jamais la frontière du serveur", async () => {
    const { sessionId, projectId, skId, networkId } = await seedUserWithProject("u1");
    const mine = (await getProject(projectId))!;
    const { id: otherSk, hash: otherHash } = await generateServerKey();
    await db.insert(serverKeys).values({
      id: otherSk, hash: otherHash, label: null, networkId, createdAt: new Date(),
    });
    const other = await createProject({ networkId, serverKeyId: otherSk, name: "p" });
    expect(other.slug).toBe(mine.slug); // même slug, serveur différent

    const app = makeApp();
    const res = await app.request(`/api/v1/user/projects/${mine.slug}?server=${otherSk}`, {
      headers: { Cookie: `artisan_user_session=${sessionId}` },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).project.id).toBe(other.id);
  });

  test("slug inconnu sur ce serveur → 404", async () => {
    const { sessionId, skId } = await seedUserWithProject("u1");
    const app = makeApp();
    const res = await app.request(`/api/v1/user/projects/nexistepas?server=${skId}`, {
      headers: { Cookie: `artisan_user_session=${sessionId}` },
    });
    expect(res.status).toBe(404);
  });

  // La sidebar navigue en slug (`projectId: slug || id`) : les sous-routes de la
  // bibliothèque doivent résoudre la même référence que `GET /:projectId`, sinon
  // l'éditeur affiche « Bibliothèque indisponible » sur toute URL à slug.
  test("/items résout le slug quand le serveur est fourni", async () => {
    const { sessionId, projectId, skId } = await seedUserWithProject("u1");
    const project = (await getProject(projectId))!;
    const app = makeApp();
    const res = await app.request(`/api/v1/user/projects/${project.slug}/items?server=${skId}`, {
      headers: { Cookie: `artisan_user_session=${sessionId}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items.length).toBeGreaterThan(0);
  });

  test("/custom-items résout le slug quand le serveur est fourni", async () => {
    const { sessionId, projectId, skId } = await seedUserWithProject("u1");
    const project = (await getProject(projectId))!;
    const app = makeApp();
    const res = await app.request(
      `/api/v1/user/projects/${project.slug}/custom-items?server=${skId}`,
      { headers: { Cookie: `artisan_user_session=${sessionId}` } },
    );
    expect(res.status).toBe(200);
    expect((await res.json()).serverKeyId).toBe(skId);
  });

  test("/items par id continue de marcher sans serveur", async () => {
    const { sessionId, projectId } = await seedUserWithProject("u1");
    const app = makeApp();
    const res = await app.request(`/api/v1/user/projects/${projectId}/items`, {
      headers: { Cookie: `artisan_user_session=${sessionId}` },
    });
    expect(res.status).toBe(200);
  });
});
