import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../db/index";
import { editorSessions, serverKeys } from "../db/schema";
import { generateEditorToken, validateEditorToken } from "../lib/auth";

describe("editor_sessions schema", () => {
  test("insert and read a session", async () => {
    const keyId = crypto.randomUUID();
    await db.insert(serverKeys).values({ id: keyId, hash: "testhash" + keyId.slice(0,8), createdAt: new Date() });

    const token = "test_token_" + crypto.randomUUID().slice(0, 8);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30 * 60 * 1000);
    await db.insert(editorSessions).values({
      token,
      serverKeyId: keyId,
      createdBy: "TestAdmin",
      createdAt: now,
      expiresAt,
    });

    const rows = await db.select().from(editorSessions).where(eq(editorSessions.token, token));
    expect(rows.length).toBe(1);
    expect(rows[0].serverKeyId).toBe(keyId);
    expect(rows[0].revokedAt).toBeNull();
  });
});

describe("generateEditorToken", () => {
  test("returns 30-char alphanumeric token", () => {
    const token = generateEditorToken();
    expect(token).toHaveLength(30);
    expect(token).toMatch(/^[A-Za-z0-9]{30}$/);
  });

  test("two calls produce different tokens", () => {
    expect(generateEditorToken()).not.toBe(generateEditorToken());
  });
});

describe("validateEditorToken", () => {
  test("returns serverKeyId for valid token", async () => {
    const keyId = crypto.randomUUID();
    await db.insert(serverKeys).values({ id: keyId, hash: "vh" + keyId.slice(0,8), createdAt: new Date() });

    const token = generateEditorToken();
    await db.insert(editorSessions).values({
      token,
      serverKeyId: keyId,
      createdBy: "CONSOLE",
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    });

    const result = await validateEditorToken(token);
    expect(result).not.toBeNull();
    expect(result!.serverKeyId).toBe(keyId);
  });

  test("returns null for unknown token", async () => {
    expect(await validateEditorToken("doesnotexist000000000000000000")).toBeNull();
  });

  test("returns null for expired token", async () => {
    const keyId = crypto.randomUUID();
    await db.insert(serverKeys).values({ id: keyId, hash: "eh" + keyId.slice(0,8), createdAt: new Date() });
    const token = generateEditorToken();
    await db.insert(editorSessions).values({
      token,
      serverKeyId: keyId,
      createdBy: "CONSOLE",
      createdAt: new Date(Date.now() - 60 * 60 * 1000),
      expiresAt: new Date(Date.now() - 1),
    });
    expect(await validateEditorToken(token)).toBeNull();
  });

  test("returns null for revoked token", async () => {
    const keyId = crypto.randomUUID();
    await db.insert(serverKeys).values({ id: keyId, hash: "rh" + keyId.slice(0,8), createdAt: new Date() });
    const token = generateEditorToken();
    await db.insert(editorSessions).values({
      token,
      serverKeyId: keyId,
      createdBy: "CONSOLE",
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      revokedAt: new Date(),
    });
    expect(await validateEditorToken(token)).toBeNull();
  });
});

import { app } from "../app";

async function createSession(serverId?: string): Promise<{ token: string; keyId: string }> {
  const keyId = serverId ?? crypto.randomUUID();
  if (!serverId) {
    await db.insert(serverKeys).values({ id: keyId, hash: "sh" + keyId.slice(0,8), createdAt: new Date() });
  }
  const token = generateEditorToken();
  await db.insert(editorSessions).values({
    token, serverKeyId: keyId, createdBy: "CONSOLE",
    createdAt: new Date(), expiresAt: new Date(Date.now() + 30 * 60 * 1000),
  });
  return { token, keyId };
}

describe("GET /api/editor-session/:token", () => {
  test("200 with server_key_id for valid token", async () => {
    const { token, keyId } = await createSession();
    const res = await app.request(`/api/editor-session/${token}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { server_key_id: string };
    expect(body.server_key_id).toBe(keyId);
  });

  test("401 for unknown token", async () => {
    const res = await app.request("/api/editor-session/notavalidtoken0000000000000000");
    expect(res.status).toBe(401);
  });
});

describe("POST /api/editor-session/:token/refresh", () => {
  test("200 and returns new expires_at", async () => {
    const { token } = await createSession();
    const res = await app.request(`/api/editor-session/${token}/refresh`, { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json() as { expires_at: string };
    expect(new Date(body.expires_at).getTime()).toBeGreaterThan(Date.now() + 29 * 60 * 1000);
  });

  test("401 for invalid token", async () => {
    const res = await app.request("/api/editor-session/badtoken00000000000000000000000/refresh", { method: "POST" });
    expect(res.status).toBe(401);
  });
});

describe("DELETE /api/editor-session/:token", () => {
  test("200 and revokes token", async () => {
    const { token } = await createSession();
    const res = await app.request(`/api/editor-session/${token}`, { method: "DELETE" });
    expect(res.status).toBe(200);
    const check = await app.request(`/api/editor-session/${token}`);
    expect(check.status).toBe(401);
  });
});

describe("GET /api/editor-session/:token/packs", () => {
  test("200 returns empty array when no packs", async () => {
    const { token } = await createSession();
    const res = await app.request(`/api/editor-session/${token}/packs`);
    expect(res.status).toBe(200);
    const body = await res.json() as { packs: unknown[] };
    expect(Array.isArray(body.packs)).toBe(true);
    expect(body.packs.length).toBe(0);
  });

  test("401 for invalid token", async () => {
    const res = await app.request("/api/editor-session/badtoken00000000000000000000000/packs");
    expect(res.status).toBe(401);
  });
});

describe("PUT /api/editor-session/:token/packs/:packId", () => {
  test("201 upserts pack and returns hash", async () => {
    const { token } = await createSession();
    const fakePack = { id: "p_test", name: "Test Pack", menus: [] };
    const fakeFiles = { "plugins/Interfaze/packs/p_test/manifest.yaml": "pack_id: p_test\n" };
    const res = await app.request(`/api/editor-session/${token}/packs/p_test`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pack: fakePack, files: fakeFiles }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { hash: string };
    expect(typeof body.hash).toBe("string");
    expect(body.hash.length).toBeGreaterThan(0);
  });

  test("GET after PUT returns the saved pack", async () => {
    const { token } = await createSession();
    const fakePack = { id: "p_roundtrip", name: "Round Trip", menus: [] };
    const fakeFiles = { "plugins/Interfaze/packs/p_roundtrip/manifest.yaml": "pack_id: p_roundtrip\n" };
    await app.request(`/api/editor-session/${token}/packs/p_roundtrip`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pack: fakePack, files: fakeFiles }),
    });
    const getRes = await app.request(`/api/editor-session/${token}/packs`);
    const body = await getRes.json() as { packs: { id: string; name: string }[] };
    expect(body.packs.some((p) => p.id === "p_roundtrip")).toBe(true);
  });

  test("401 for invalid token", async () => {
    const res = await app.request("/api/editor-session/badtoken00000000000000000000000/packs/p_test", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pack: {}, files: {} }),
    });
    expect(res.status).toBe(401);
  });
});

describe("DELETE /api/editor-session/:token/packs/:packId", () => {
  test("200 deletes pack and it no longer appears in GET", async () => {
    const { token } = await createSession();
    const fakePack = { id: "p_delete", name: "To Delete", menus: [] };
    await app.request(`/api/editor-session/${token}/packs/p_delete`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pack: fakePack, files: { "plugins/Interfaze/packs/p_delete/manifest.yaml": "" } }),
    });
    const delRes = await app.request(`/api/editor-session/${token}/packs/p_delete`, { method: "DELETE" });
    expect(delRes.status).toBe(200);
    const getRes = await app.request(`/api/editor-session/${token}/packs`);
    const body = await getRes.json() as { packs: { id: string }[] };
    expect(body.packs.some((p) => p.id === "p_delete")).toBe(false);
  });
});

describe("POST /api/editor-session/:token/packs/:packId/deploy", () => {
  test("201 deploys pack, sets deployed_editor_json, pushes bundle", async () => {
    const { token } = await createSession();
    const fakePack = { id: "p_deploy", name: "Deploy Me", menus: [] };
    const fakeFiles = { "manifest.yaml": "pack_id: p_deploy\n" };

    const res = await app.request(`/api/editor-session/${token}/packs/p_deploy/deploy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pack: fakePack, files: fakeFiles }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { hash: string };
    expect(typeof body.hash).toBe("string");
  });

  test("401 for invalid token", async () => {
    const res = await app.request("/api/editor-session/badtoken00000000000000000000000/packs/p_x/deploy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pack: {}, files: {} }),
    });
    expect(res.status).toBe(401);
  });
});

describe("GET /api/editor-session/:token/packs/:packId/deployed", () => {
  test("returns null when pack never deployed", async () => {
    const { token } = await createSession();
    // Save a draft but never deploy
    await app.request(`/api/editor-session/${token}/packs/p_nodeploy`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pack: { id: "p_nodeploy" }, files: { "manifest.yaml": "" } }),
    });
    const res = await app.request(`/api/editor-session/${token}/packs/p_nodeploy/deployed`);
    expect(res.status).toBe(200);
    const body = await res.json() as { pack: null };
    expect(body.pack).toBeNull();
  });

  test("returns deployed pack after deploy", async () => {
    const { token } = await createSession();
    const fakePack = { id: "p_getdeployed", name: "Get Deployed", menus: [] };
    // Deploy it
    await app.request(`/api/editor-session/${token}/packs/p_getdeployed/deploy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pack: fakePack, files: { "manifest.yaml": "" } }),
    });
    const res = await app.request(`/api/editor-session/${token}/packs/p_getdeployed/deployed`);
    expect(res.status).toBe(200);
    const body = await res.json() as { pack: { id: string; name: string } };
    expect(body.pack?.name).toBe("Get Deployed");
  });

  test("401 for invalid token", async () => {
    const res = await app.request("/api/editor-session/badtoken00000000000000000000000/packs/p_x/deployed");
    expect(res.status).toBe(401);
  });
});

describe("POST /api/editor-session/:token/draft", () => {
  test("200 for valid token and valid body", async () => {
    const { token } = await createSession();
    const res = await app.request(`/api/editor-session/${token}/draft`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pack_id: "pack1", menu_id: "shop_main", menu_yaml: "title: Shop\n" }),
    });
    expect(res.status).toBe(200);
  });

  test("401 for invalid token", async () => {
    const res = await app.request("/api/editor-session/badtoken00000000000000000000000/draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pack_id: "p", menu_id: "m", menu_yaml: "" }),
    });
    expect(res.status).toBe(401);
  });
});
