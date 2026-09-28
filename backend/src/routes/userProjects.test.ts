// backend/src/routes/userProjects.test.ts
import { beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { db } from "../db/index";
import {memberships, networks, projects, serverKeys, linkCodes, users, userSessions} from "../db/schema";
import { userProjectsRouter } from "./userProjects";
import { userAuth } from "../middleware/userAuth";
import { createSession } from "../lib/sessionManager";
import { createNetwork } from "../lib/networkManager";
import { addMembership } from "../lib/membershipManager";
import { createProject, getProject } from "../lib/projectStorage";
import { generateServerKey } from "../lib/auth";
import { registerEditorConn } from "../ws/hub";
import { eq } from "drizzle-orm";
import { beginProjectRename, completeProjectRename } from "../lib/projectRename";

async function clearAll() {
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
  await db.update(projects).set({ slug: "legacy-p" }).where(eq(projects.id, project.id));
  return { userId, sessionId: session.id, networkId: network.id, projectId: project.id, skId };
}

function makeApp() {
  const app = new Hono();
  app.use("/api/v1/user/projects/*", userAuth());
  app.route("/api/v1/user/projects", userProjectsRouter);
  return app;
}

describe("userProjectsRouter — GET", () => {
  beforeEach(async () => {
    await clearAll();
  });

  test("opens the module ID in its network/server scope without changing the internal anchor", async () => {
    const { sessionId, projectId, skId, networkId } = await seedUserWithProject("url-id");
    await db.update(projects).set({ externalId: "boutique_addon", slug: "boutique-shop" }).where(eq(projects.id, projectId));
    await db.update(serverKeys).set({ slug: "survival" }).where(eq(serverKeys.id, skId));
    const other = await createNetwork("Other");
    await db.insert(serverKeys).values({ id: "other-server", hash: "other-hash", slug: "survival", networkId: other.id, createdAt: new Date() });
    const response = await makeApp().request(`/api/v1/user/projects/boutique_addon?server=survival&network=${networkId}`, {
      headers: { Cookie: `artisan_user_session=${sessionId}` },
    });
    expect(response.status).toBe(200);
    expect((await response.json()).project.id).toBe(projectId);
  });

  test.each(["server"])("%s rename preserves the anchor and resolves its old folder and legacy slug", async (storageKind) => {
    const seed = await seedUserWithProject(`rename-${storageKind}`);
    await db.update(projects).set({ externalId: "old_folder" }).where(eq(projects.id, seed.projectId));
    await beginProjectRename(seed.projectId, `rename-${storageKind}`, "New_Folder");
    const receipt = { operation_id: `rename-${storageKind}`, project_id: "old_folder", target_project_id: "New_Folder" };
    await completeProjectRename(seed.skId, receipt);
    const scope = `network=${seed.networkId}&server=${seed.skId}`;
    for (const ref of ["old_folder", "New_Folder", "legacy-p", seed.projectId]) {
      const response = await makeApp().request(`/api/v1/user/projects/${ref}?${scope}`, { headers: { Cookie: `artisan_user_session=${seed.sessionId}` } });
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.project.id).toBe(seed.projectId);
      expect(body.project.externalId).toBe("New_Folder");
    }
  });

  test("ambiguous legacy aliases fail closed, while a current folder ID takes precedence", async () => {
    const seed = await seedUserWithProject("ambiguous");
    await db.update(projects).set({ externalId: "first" }).where(eq(projects.id, seed.projectId));
    await beginProjectRename(seed.projectId, "rename-first", "second");
    await completeProjectRename(seed.skId, { operation_id: "rename-first", project_id: "first", target_project_id: "second" });
    const other = await createProject({ networkId: seed.networkId, serverKeyId: seed.skId, externalId: "third", name: "Third" });
    await db.update(projects).set({ slug: "first" }).where(eq(projects.id, other.id));
    const request = () => makeApp().request(`/api/v1/user/projects/first?network=${seed.networkId}&server=${seed.skId}`, { headers: { Cookie: `artisan_user_session=${seed.sessionId}` } });
    expect((await request()).status).toBe(404);
    await db.update(projects).set({ externalId: "first" }).where(eq(projects.id, other.id));
    expect((await (await request()).json()).project.id).toBe(other.id);
  });

  test("GET /:projectId 200 — member gets project content", async () => {
    const { sessionId, projectId } = await seedUserWithProject("u1");
    const app = makeApp();
    const res = await app.request(`/api/v1/user/projects/${projectId}`, {
      headers: { Cookie: `artisan_user_session=${sessionId}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.project.id).toBe(projectId);
    // Identité seulement : le contenu vit sur le disque du serveur et se lit
    // par `project_read` (ADR `server-disk-only-storage`).
    expect(body.serverKeyId).toBeDefined();
    expect(body.files).toBeUndefined();
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
    await db.update(projects).set({ slug: mine.slug }).where(eq(projects.id, other.id));

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
