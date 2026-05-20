import { describe, expect, test, beforeEach } from "bun:test";
import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { db } from "../db/index";
import { editorSessions, packBindings, packConflicts, packs, serverKeys, networks } from "../db/schema";
import { generateCode, generateEditorToken, generateTrustCode, validateAccessToken, findSessionByTrustCode, validateEditorToken } from "../lib/auth";
import { handlePluginMessage, connSenders, connToServerId } from "../ws/hub";
import { createNetwork } from "../lib/networkManager";
import type { HelloMessage, HelloAckMessage } from "../protocol";
import { editorSessionRouter } from "./editorSession";

// Minimal local app — avoids importing broken bundles router
const app = new Hono();
app.route("/api/editor-session", editorSessionRouter);

// ─── Cleanup ───────────────────────────────────────────────────────────────
// FK-safe cleanup order for each test
beforeEach(async () => {
  await db.delete(packConflicts);
  await db.delete(packBindings);
  await db.delete(packs);
  await db.delete(editorSessions);
  // linkCodes references serverKeys — omit if not used in this file
  await db.delete(serverKeys);
  await db.delete(networks);
});

// ─── Helpers ────────────────────────────────────────────────────────────────

async function createNetworkAndServerKey(label?: string): Promise<{ networkId: string; keyId: string }> {
  const network = await createNetwork(label ?? "test-network");
  const keyId = crypto.randomUUID();
  await db.insert(serverKeys).values({
    id: keyId,
    hash: "h" + keyId.slice(0, 8),
    label: label ?? null,
    networkId: network.id,
    createdAt: new Date(),
  });
  return { networkId: network.id, keyId };
}

async function seedBoundPack(
  serverKeyId: string,
  packId: string,
  hash: string,
  files: Record<string, string>,
  extraEditorJson?: Record<string, unknown>,
): Promise<void> {
  const skRows = await db.select().from(serverKeys).where(eq(serverKeys.id, serverKeyId));
  if (skRows.length === 0) throw new Error("seed: server_key absent");
  const networkId = skRows[0].networkId;
  const { createPack } = await import("../lib/packStorage");
  const { createBinding } = await import("../lib/packBindingManager");
  await createPack({ networkId, name: packId, id: packId });
  await createBinding(serverKeyId, packId);
  const editorJson = extraEditorJson ? JSON.stringify(extraEditorJson) : JSON.stringify({ id: packId, name: packId });
  await db.update(packs)
    .set({ hash, filesJson: JSON.stringify(files), editorJson })
    .where(eq(packs.id, packId));
}

async function createRawSession(): Promise<{ urlToken: string; keyId: string }> {
  const { keyId } = await createNetworkAndServerKey();
  const urlToken = "url_" + generateEditorToken();
  const trustCode = generateTrustCode();
  await db.insert(editorSessions).values({
    token: urlToken, serverKeyId: keyId, createdBy: "CONSOLE",
    createdAt: new Date(), expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    trustCode,
  });
  return { urlToken, keyId };
}

async function createSession(serverId?: string): Promise<{ token: string; keyId: string }> {
  let keyId: string;
  if (serverId) {
    keyId = serverId;
  } else {
    const result = await createNetworkAndServerKey();
    keyId = result.keyId;
  }
  const urlToken = "url_" + generateEditorToken();
  const trustCode = generateTrustCode();
  await db.insert(editorSessions).values({
    token: urlToken, serverKeyId: keyId, createdBy: "CONSOLE",
    createdAt: new Date(), expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    trustCode,
  });
  const res = await app.request(`/api/editor-session/${urlToken}/exchange`, { method: "POST" });
  const { access_token } = await res.json() as { access_token: string };
  return { token: access_token, keyId };
}

async function createTrustedSession(): Promise<{ token: string; keyId: string }> {
  const { token, keyId } = await createSession();
  const rows = await db.select().from(editorSessions).where(eq(editorSessions.accessToken, token));
  await db.update(editorSessions)
    .set({ trustedAt: new Date(), trustedIp: "unknown" })
    .where(eq(editorSessions.token, rows[0].token));
  return { token, keyId };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("editor_sessions schema", () => {
  test("new security columns default to null", async () => {
    const { keyId } = await createNetworkAndServerKey();
    const token = "schema_test_" + crypto.randomUUID().slice(0, 8);
    await db.insert(editorSessions).values({
      token, serverKeyId: keyId, createdBy: "test",
      createdAt: new Date(), expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    });
    const rows = await db.select().from(editorSessions).where(eq(editorSessions.token, token));
    expect(rows[0].exchangedAt).toBeNull();
    expect(rows[0].refreshToken).toBeNull();
    expect(rows[0].accessToken).toBeNull();
    expect(rows[0].accessExpiresAt).toBeNull();
    expect(rows[0].trustCode).toBeNull();
    expect(rows[0].trustedAt).toBeNull();
    expect(rows[0].trustedIp).toBeNull();
  });

  test("insert and read a session", async () => {
    const { keyId } = await createNetworkAndServerKey();
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
    const { keyId } = await createNetworkAndServerKey();

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
    const { keyId } = await createNetworkAndServerKey();
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
    const { keyId } = await createNetworkAndServerKey();
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

describe("POST /api/editor-session/:urlToken/exchange", () => {
  test("200 returns access_token + trust_code, sets cookie", async () => {
    const { urlToken } = await createRawSession();
    const res = await app.request(`/api/editor-session/${urlToken}/exchange`, { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json() as { access_token: string; expires_in: number; trust_code: string };
    expect(typeof body.access_token).toBe("string");
    expect(body.access_token.length).toBeGreaterThan(0);
    expect(body.expires_in).toBe(300);
    expect(typeof body.trust_code).toBe("string");
    expect(body.trust_code.length).toBe(6);
    const cookie = res.headers.get("set-cookie");
    expect(cookie).toContain("ifz_refresh=");
    expect(cookie).toContain("HttpOnly");
  });

  test("401 already_used on second call", async () => {
    const { urlToken } = await createRawSession();
    await app.request(`/api/editor-session/${urlToken}/exchange`, { method: "POST" });
    const res2 = await app.request(`/api/editor-session/${urlToken}/exchange`, { method: "POST" });
    expect(res2.status).toBe(401);
    const body = await res2.json() as { error: string };
    expect(body.error).toBe("already_used");
  });

  test("401 for unknown url token", async () => {
    const res = await app.request("/api/editor-session/unknowntoken000000000000000000/exchange", { method: "POST" });
    expect(res.status).toBe(401);
  });

  test("401 for revoked url token", async () => {
    const { keyId } = await createNetworkAndServerKey();
    const urlToken = "url_rev_" + generateEditorToken();
    await db.insert(editorSessions).values({
      token: urlToken, serverKeyId: keyId, createdBy: "CONSOLE",
      createdAt: new Date(), expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      trustCode: generateTrustCode(),
      revokedAt: new Date(),
    });
    const res = await app.request(`/api/editor-session/${urlToken}/exchange`, { method: "POST" });
    expect(res.status).toBe(401);
  });

  test("401 for expired url token", async () => {
    const { keyId } = await createNetworkAndServerKey();
    const urlToken = "url_exp_" + generateEditorToken();
    await db.insert(editorSessions).values({
      token: urlToken, serverKeyId: keyId, createdBy: "CONSOLE",
      createdAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
      expiresAt: new Date(Date.now() - 1),
      trustCode: generateTrustCode(),
    });
    const res = await app.request(`/api/editor-session/${urlToken}/exchange`, { method: "POST" });
    expect(res.status).toBe(401);
  });
});

describe("POST /api/editor-session/refresh", () => {
  test("200 returns new access_token and rotates cookie", async () => {
    const { urlToken } = await createRawSession();
    const exchangeRes = await app.request(`/api/editor-session/${urlToken}/exchange`, { method: "POST" });
    const cookie = exchangeRes.headers.get("set-cookie") ?? "";
    const refreshToken = cookie.match(/ifz_refresh=([^;]+)/)?.[1] ?? "";
    expect(refreshToken).not.toBe("");

    const res = await app.request("/api/editor-session/refresh", {
      method: "POST",
      headers: { "Cookie": `ifz_refresh=${refreshToken}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { access_token: string; expires_in: number };
    expect(typeof body.access_token).toBe("string");
    expect(body.expires_in).toBe(300);
    expect(res.headers.get("set-cookie")).toContain("ifz_refresh=");
  });

  test("401 for unknown refresh token", async () => {
    const res = await app.request("/api/editor-session/refresh", {
      method: "POST",
      headers: { "Cookie": "ifz_refresh=unknowntoken000000000000000" },
    });
    expect(res.status).toBe(401);
  });

  test("401 when no cookie", async () => {
    const res = await app.request("/api/editor-session/refresh", { method: "POST" });
    expect(res.status).toBe(401);
  });

  test("old refresh token rejected after rotation", async () => {
    const { urlToken } = await createRawSession();
    const exchangeRes = await app.request(`/api/editor-session/${urlToken}/exchange`, { method: "POST" });
    const cookie = exchangeRes.headers.get("set-cookie") ?? "";
    const refreshToken = cookie.match(/ifz_refresh=([^;]+)/)?.[1] ?? "";

    await app.request("/api/editor-session/refresh", {
      method: "POST",
      headers: { "Cookie": `ifz_refresh=${refreshToken}` },
    });

    const res2 = await app.request("/api/editor-session/refresh", {
      method: "POST",
      headers: { "Cookie": `ifz_refresh=${refreshToken}` },
    });
    expect(res2.status).toBe(401);
  });
});

describe("GET /api/editor-session/:token", () => {
  test("200 with server_key_id, trusted, trust_code for valid token", async () => {
    const { token, keyId } = await createSession();
    const res = await app.request(`/api/editor-session/${token}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { server_key_id: string; trusted: boolean; trust_code: string };
    expect(body.server_key_id).toBe(keyId);
    expect(body.trusted).toBe(false);
    expect(typeof body.trust_code).toBe("string");
    expect(body.trust_code.length).toBe(6);
  });

  test("200 with trusted=true for trusted session", async () => {
    const { token, keyId } = await createTrustedSession();
    const res = await app.request(`/api/editor-session/${token}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { server_key_id: string; trusted: boolean; trust_code: string };
    expect(body.server_key_id).toBe(keyId);
    expect(body.trusted).toBe(true);
  });

  test("401 for unknown token", async () => {
    const res = await app.request("/api/editor-session/notavalidtoken0000000000000000");
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
    const body = await getRes.json() as { packs: { pack_id: string; editor: { id: string; name: string } | null }[] };
    expect(body.packs.some((p) => p.pack_id === "p_roundtrip")).toBe(true);
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
    const body = await getRes.json() as { packs: { pack_id: string }[] };
    expect(body.packs.some((p) => p.pack_id === "p_delete")).toBe(false);
  });
});

describe("POST /api/editor-session/:token/packs/:packId/deploy — trust gate", () => {
  const fakePayload = {
    pack: { id: "p_trust", name: "Trust Test", menus: [] },
    files: { "manifest.yaml": "pack_id: p_trust\n" },
  };

  test("403 session_not_trusted when not trusted", async () => {
    const { token } = await createSession();
    const res = await app.request(`/api/editor-session/${token}/packs/p_trust/deploy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fakePayload),
    });
    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("session_not_trusted");
  });

  test("403 session_not_trusted when trusted_ip differs", async () => {
    const { token } = await createSession();
    const rows = await db.select().from(editorSessions).where(eq(editorSessions.accessToken, token));
    await db.update(editorSessions)
      .set({ trustedAt: new Date(), trustedIp: "5.5.5.5" })
      .where(eq(editorSessions.token, rows[0].token));

    const res = await app.request(`/api/editor-session/${token}/packs/p_trust/deploy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fakePayload),
    });
    expect(res.status).toBe(403);
    expect((await res.json() as { error: string }).error).toBe("session_not_trusted");
  });

  test("201 when session is trusted with matching IP", async () => {
    const { token } = await createTrustedSession();
    const res = await app.request(`/api/editor-session/${token}/packs/p_trust_ok/deploy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pack: { id: "p_trust_ok", name: "ok" }, files: { "manifest.yaml": "" } }),
    });
    expect(res.status).toBe(201);
  });
});

describe("POST /api/editor-session/:token/packs/:packId/deploy", () => {
  test("201 deploys pack, sets deployed_editor_json, pushes bundle", async () => {
    const { token } = await createTrustedSession();
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

  test("201 auto-creates pack+binding when pack does not exist yet", async () => {
    const { token } = await createTrustedSession();
    const res = await app.request(`/api/editor-session/${token}/packs/p_new_deploy/deploy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pack: { id: "p_new_deploy", name: "New" }, files: { "manifest.yaml": "" } }),
    });
    expect(res.status).toBe(201);
    // Pack and binding should now exist in DB
    const packRows = await db.select().from(packs).where(eq(packs.id, "p_new_deploy"));
    expect(packRows.length).toBe(1);
    const bindingRows = await db.select().from(packBindings).where(eq(packBindings.packId, "p_new_deploy"));
    expect(bindingRows.length).toBe(1);
  });

  test("sets deployedEditorJson after deploy (not just editorJson)", async () => {
    const { token } = await createTrustedSession();
    await app.request(`/api/editor-session/${token}/packs/p_chk_deployed/deploy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pack: { id: "p_chk_deployed", name: "Check" }, files: { "manifest.yaml": "" } }),
    });
    const rows = await db.select().from(packs).where(eq(packs.id, "p_chk_deployed"));
    expect(rows[0].deployedEditorJson).not.toBeNull();
    expect(rows[0].editorJson).not.toBeNull();
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
    const body = await res.json() as { deployed: null };
    expect(body.deployed).toBeNull();
  });

  test("returns deployed pack after deploy", async () => {
    const { token } = await createTrustedSession();
    const fakePack = { id: "p_getdeployed", name: "Get Deployed", menus: [] };
    // Deploy it
    await app.request(`/api/editor-session/${token}/packs/p_getdeployed/deploy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pack: fakePack, files: { "manifest.yaml": "" } }),
    });
    const res = await app.request(`/api/editor-session/${token}/packs/p_getdeployed/deployed`);
    expect(res.status).toBe(200);
    const body = await res.json() as { deployed: { id: string; name: string } };
    expect(body.deployed?.name).toBe("Get Deployed");
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

describe("generateTrustCode", () => {
  test("returns 6-char uppercase alphanumeric code", () => {
    const code = generateTrustCode();
    expect(code).toHaveLength(6);
    expect(code).toMatch(/^[A-Z2-9]{6}$/);
  });

  test("two calls produce different codes", () => {
    expect(generateTrustCode()).not.toBe(generateTrustCode());
  });
});

describe("validateAccessToken", () => {
  test("returns session for valid access token", async () => {
    const { keyId } = await createNetworkAndServerKey();
    const urlToken = "url_" + crypto.randomUUID().slice(0, 8);
    const accessToken = generateEditorToken();
    const trustCode = generateTrustCode();
    await db.insert(editorSessions).values({
      token: urlToken, serverKeyId: keyId, createdBy: "test",
      createdAt: new Date(), expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      exchangedAt: new Date(), accessToken, accessExpiresAt: new Date(Date.now() + 5 * 60 * 1000),
      trustCode,
    });
    const result = await validateAccessToken(accessToken);
    expect(result).not.toBeNull();
    expect(result!.serverKeyId).toBe(keyId);
    expect(result!.sessionId).toBe(urlToken);
    expect(result!.trusted).toBe(false);
    expect(result!.trustCode).toBe(trustCode);
    expect(result!.trustedIp).toBeNull();
  });

  test("returns null for unknown access token", async () => {
    expect(await validateAccessToken("notavalidaccesstoken000000000")).toBeNull();
  });

  test("returns null for expired access token", async () => {
    const { keyId } = await createNetworkAndServerKey();
    const urlToken = "url_exp_" + crypto.randomUUID().slice(0, 8);
    const accessToken = generateEditorToken();
    await db.insert(editorSessions).values({
      token: urlToken, serverKeyId: keyId, createdBy: "test",
      createdAt: new Date(), expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      exchangedAt: new Date(), accessToken,
      accessExpiresAt: new Date(Date.now() - 1),
    });
    expect(await validateAccessToken(accessToken)).toBeNull();
  });

  test("returns trusted=true when trustedAt is set", async () => {
    const { keyId } = await createNetworkAndServerKey();
    const urlToken = "url_tr_" + crypto.randomUUID().slice(0, 8);
    const accessToken = generateEditorToken();
    await db.insert(editorSessions).values({
      token: urlToken, serverKeyId: keyId, createdBy: "test",
      createdAt: new Date(), expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      exchangedAt: new Date(), accessToken, accessExpiresAt: new Date(Date.now() + 5 * 60 * 1000),
      trustCode: generateTrustCode(), trustedAt: new Date(), trustedIp: "1.2.3.4",
    });
    const result = await validateAccessToken(accessToken);
    expect(result!.trusted).toBe(true);
    expect(result!.trustedIp).toBe("1.2.3.4");
  });

  test("returns null for revoked session", async () => {
    const { keyId } = await createNetworkAndServerKey();
    const urlToken = "url_rvat_" + crypto.randomUUID().slice(0, 8);
    const accessToken = generateEditorToken();
    await db.insert(editorSessions).values({
      token: urlToken, serverKeyId: keyId, createdBy: "test",
      createdAt: new Date(), expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      exchangedAt: new Date(), accessToken, accessExpiresAt: new Date(Date.now() + 5 * 60 * 1000),
      revokedAt: new Date(),
    });
    expect(await validateAccessToken(accessToken)).toBeNull();
  });

  test("returns null when session itself is expired", async () => {
    const { keyId } = await createNetworkAndServerKey();
    const urlToken = "url_sexp_" + crypto.randomUUID().slice(0, 8);
    const accessToken = generateEditorToken();
    await db.insert(editorSessions).values({
      token: urlToken, serverKeyId: keyId, createdBy: "test",
      createdAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
      expiresAt: new Date(Date.now() - 1),
      exchangedAt: new Date(), accessToken, accessExpiresAt: new Date(Date.now() + 5 * 60 * 1000),
    });
    expect(await validateAccessToken(accessToken)).toBeNull();
  });
});

describe("findSessionByTrustCode", () => {
  test("finds a session by trust_code", async () => {
    const { keyId } = await createNetworkAndServerKey();
    const urlToken = "url_fc_" + crypto.randomUUID().slice(0, 8);
    const accessToken = generateEditorToken();
    const trustCode = generateTrustCode();
    await db.insert(editorSessions).values({
      token: urlToken, serverKeyId: keyId, createdBy: "test",
      createdAt: new Date(), expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      exchangedAt: new Date(), accessToken, accessExpiresAt: new Date(Date.now() + 5 * 60 * 1000),
      trustCode,
    });
    const result = await findSessionByTrustCode(trustCode);
    expect(result).not.toBeNull();
    expect(result!.urlToken).toBe(urlToken);
    expect(result!.accessToken).toBe(accessToken);
    expect(result!.serverKeyId).toBe(keyId);
  });

  test("returns null for unknown code", async () => {
    expect(await findSessionByTrustCode("XXXXXX")).toBeNull();
  });

  test("returns null for revoked session", async () => {
    const { keyId } = await createNetworkAndServerKey();
    const urlToken = "url_fcr_" + crypto.randomUUID().slice(0, 8);
    const code = "REV" + generateTrustCode().slice(0, 3);
    await db.insert(editorSessions).values({
      token: urlToken, serverKeyId: keyId, createdBy: "test",
      createdAt: new Date(), expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      trustCode: code, revokedAt: new Date(),
    });
    expect(await findSessionByTrustCode(code)).toBeNull();
  });

  test("returns null for expired session", async () => {
    const { keyId } = await createNetworkAndServerKey();
    const urlToken = "url_fce_" + crypto.randomUUID().slice(0, 8);
    const code = "EXP" + generateTrustCode().slice(0, 3);
    await db.insert(editorSessions).values({
      token: urlToken, serverKeyId: keyId, createdBy: "test",
      createdAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
      expiresAt: new Date(Date.now() - 1),
      trustCode: code,
    });
    expect(await findSessionByTrustCode(code)).toBeNull();
  });
});

// Helper: create a server key with known raw key for hub hello flow
async function createServerKeyForHub(label: string): Promise<{ keyId: string; rawKey: string }> {
  const network = await createNetwork(`net-hub-${label}`);
  const keyId = "sk_hub_" + crypto.randomUUID().slice(0, 8);
  const rawKey = "rawkey_hub_" + keyId;
  const keyHash = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawKey)))
  ).map(b => b.toString(16).padStart(2, "0")).join("");
  await db.insert(serverKeys).values({ id: keyId, hash: keyHash, networkId: network.id, createdAt: new Date() });
  return { keyId, rawKey };
}

describe("GET /api/editor-session/:token/items", () => {
  test("returns 503 when server is offline (no mc_version registered)", async () => {
    const { token } = await createSession();
    const res = await app.request(`/api/editor-session/${token}/items`);
    expect(res.status).toBe(503);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("server_offline");
  });

  test("returns 404 for unknown mc_version", async () => {
    const { keyId, rawKey } = await createServerKeyForHub("items-ver-test");

    const hello: HelloMessage = {
      type: "hello",
      server_key: rawKey,
      plugin_version: "1.0.0",
      minecraft_version: "99.99.99",
      current_bundle_hash: "",
    };
    await handlePluginMessage("conn-items-test", JSON.stringify(hello));

    const { token } = await createSession(keyId);

    const res = await app.request(`/api/editor-session/${token}/items`);
    expect(res.status).toBe(404);
  });

  test("returns 200 with items for known mc_version", async () => {
    const { keyId, rawKey } = await createServerKeyForHub("items-ok-test");

    const hello: HelloMessage = {
      type: "hello",
      server_key: rawKey,
      plugin_version: "1.0.0",
      minecraft_version: "1.21.4",
      current_bundle_hash: "",
    };
    await handlePluginMessage("conn-items-ok", JSON.stringify(hello));

    const { token } = await createSession(keyId);

    const res = await app.request(`/api/editor-session/${token}/items`);
    expect(res.status).toBe(200);
    const body = await res.json() as { version: string; items: { id: string; label: string; category: string; texture: string }[] };
    expect(body.version).toBe("1.21.4");
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items.length).toBeGreaterThan(100);
    expect(body.items[0]).toHaveProperty("id");
    expect(body.items[0]).toHaveProperty("label");
    expect(body.items[0]).toHaveProperty("category");
    expect(body.items[0]).toHaveProperty("texture");
  });
});

describe("CORS credentials", () => {
  test("GET /api/editor-session/:token returns Access-Control-Allow-Credentials: true with browser Origin", async () => {
    // CORS is set up on the global app, not the local test app — skip this test
    // by testing with a global app that has CORS configured
    const corsApp = new Hono();
    const { cors } = await import("hono/cors");
    corsApp.use("/api/*", cors({ origin: "http://localhost:5173", credentials: true }));
    corsApp.route("/api/editor-session", editorSessionRouter);

    const { keyId } = await createNetworkAndServerKey();
    const urlToken = "cors_cred_" + crypto.randomUUID().slice(0, 8);
    await db.insert(editorSessions).values({
      token: urlToken, serverKeyId: keyId, createdBy: "test",
      createdAt: new Date(), expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), trustCode: generateTrustCode(),
    });
    const accessToken = "corsat_" + crypto.randomUUID().slice(0, 8);
    await db.update(editorSessions).set({
      exchangedAt: new Date(), accessToken,
      accessExpiresAt: new Date(Date.now() + 5 * 60 * 1000), refreshToken: "dummy",
    }).where(eq(editorSessions.token, urlToken));

    const res = await corsApp.request(`/api/editor-session/${accessToken}`, {
      headers: { "Origin": "http://localhost:5173" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Credentials")).toBe("true");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:5173");
  });
});

describe("GET /:token/custom-items", () => {
  test("returns empty items array when no cache exists", async () => {
    const { keyId } = await createNetworkAndServerKey();
    const token = generateEditorToken();
    await db.insert(editorSessions).values({
      token, serverKeyId: keyId, createdBy: "CONSOLE",
      createdAt: new Date(), expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    // Exchange for access token
    const exchangeRes = await app.request(`/api/editor-session/${token}/exchange`, { method: "POST" });
    const { access_token } = await exchangeRes.json() as { access_token: string };

    const res = await app.request(`/api/editor-session/${access_token}/custom-items`);
    expect(res.status).toBe(200);
    const body = await res.json() as { serverKeyId: string; items: unknown[] };
    expect(body.serverKeyId).toBe(keyId);
    expect(body.items).toEqual([]);
  });
});

describe("custom_items_changed", () => {
  test("sends custom_items_request when hash differs from cache", async () => {
    // Arrange: register an authenticated plugin connection
    const connId = "conn_ci_test_" + crypto.randomUUID().slice(0, 8);
    const sent: string[] = [];
    connSenders.set(connId, (msg) => sent.push(msg));

    // Authenticate via hello — create server key with network
    const { keyId, rawKey } = await createServerKeyForHub("ci-test");

    await handlePluginMessage(connId, JSON.stringify({
      type: "hello",
      server_key: rawKey,
      plugin_version: "1.0.0",
      minecraft_version: "1.21.4",
      current_bundle_hash: "",
      custom_items_hash: "nexo_hash_abc",
    }));

    sent.length = 0; // clear hello_ack

    // Act: send custom_items_changed with a different hash
    await handlePluginMessage(connId, JSON.stringify({
      type: "custom_items_changed",
      hash: "nexo_hash_xyz",
    }));

    // Assert: backend requested the bundle
    expect(sent.some((s) => JSON.parse(s).type === "custom_items_request")).toBe(true);

    connSenders.delete(connId);
  });
});

describe("custom_items_changed edge cases", () => {
  test("does NOT send custom_items_request if incoming hash matches cached", async () => {
    // Arrange: register an authenticated plugin connection with pre-cached hash
    const connId = "conn_ci_cache_" + crypto.randomUUID().slice(0, 8);
    const sent: string[] = [];
    connSenders.set(connId, (msg) => sent.push(msg));

    // Authenticate
    const { keyId, rawKey } = await createServerKeyForHub("ci-cache");

    // Pre-cache the hash
    const { customItemsCacheDir } = await import("../lib/customItems");
    const { mkdir, writeFile } = await import("fs/promises");
    const { join } = await import("path");
    const cacheDir = customItemsCacheDir(keyId);
    await mkdir(cacheDir, { recursive: true });
    await writeFile(join(cacheDir, "hash.txt"), "cached_hash_123");

    await handlePluginMessage(connId, JSON.stringify({
      type: "hello",
      server_key: rawKey,
      plugin_version: "1.0.0",
      minecraft_version: "1.21.4",
      current_bundle_hash: "",
      custom_items_hash: "cached_hash_123",
    }));

    sent.length = 0;

    // Act: send custom_items_changed with MATCHING hash
    await handlePluginMessage(connId, JSON.stringify({
      type: "custom_items_changed",
      hash: "cached_hash_123",
    }));

    // Assert: NO request sent because hash matches cache
    expect(sent.some((s) => JSON.parse(s).type === "custom_items_request")).toBe(false);
    expect(sent.length).toBe(0);

    connSenders.delete(connId);
  });

  test("ignores custom_items_bundle if connId not authenticated", async () => {
    const orphanConnId = "conn_ci_orphan_" + crypto.randomUUID().slice(0, 8);
    connSenders.set(orphanConnId, () => {});
    // Do NOT authenticate

    const result = await handlePluginMessage(orphanConnId, JSON.stringify({
      type: "custom_items_bundle",
      hash: "some_hash",
      data: "base64data",
    }));

    expect(result.reply).toBeNull();
    connSenders.delete(orphanConnId);
  });
});

describe("PUT /api/editor-session/:token/packs/:packId — canvasLayout (files win)", () => {
  test("manifest editor_layout overrides pack.canvasLayout in stored editorJson", async () => {
    const { token } = await createSession();
    const fakePack = {
      id: "p_files_win",
      name: "Files Win",
      menus: [],
      canvasLayout: { shop: { x: 1, y: 1 } }, // STALE — files should win
    };
    const fakeFiles = {
      "plugins/Interfaze/packs/p_files_win/manifest.yaml": [
        "schema: manifest/v1", "pack_id: p_files_win", "default_lang: en",
        "files:", "  menus: [shop]", "  commands: []", "  dialogs: []",
        "editor_layout:", "  shop: { x: 77, y: 88 }",
      ].join("\n") + "\n",
    };
    const res = await app.request(`/api/editor-session/${token}/packs/p_files_win`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pack: fakePack, files: fakeFiles }),
    });
    expect(res.status).toBe(201);

    const getRes = await app.request(`/api/editor-session/${token}/packs`);
    const body = await getRes.json() as { packs: Array<{ pack_id: string; editor: { id: string; canvasLayout: Record<string, { x: number; y: number }> } | null }> };
    const p = body.packs.find((x) => x.pack_id === "p_files_win")!;
    expect(p.editor?.canvasLayout).toEqual({ shop: { x: 77, y: 88 } });
    expect(p.editor?.id).toBe("p_files_win");
  });
});

describe("POST /api/editor-session/:token/packs/:packId/deploy — canvasLayout (files win)", () => {
  test("deploy applies manifest editor_layout to stored editorJson", async () => {
    const { token } = await createTrustedSession();
    const fakePack = {
      id: "p_deploy_layout",
      name: "Deploy Layout",
      menus: [],
      canvasLayout: { foo: { x: 0, y: 0 } }, // stale
    };
    const fakeFiles = {
      "plugins/Interfaze/packs/p_deploy_layout/manifest.yaml": [
        "schema: manifest/v1", "pack_id: p_deploy_layout", "default_lang: en",
        "files:", "  menus: []", "  commands: []", "  dialogs: []",
        "editor_layout:", "  bar: { x: 200, y: 300 }",
      ].join("\n") + "\n",
    };
    const res = await app.request(`/api/editor-session/${token}/packs/p_deploy_layout/deploy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pack: fakePack, files: fakeFiles }),
    });
    expect(res.status).toBe(201);

    const getRes = await app.request(`/api/editor-session/${token}/packs`);
    const body = await getRes.json() as { packs: Array<{ pack_id: string; editor: { id: string; canvasLayout: Record<string, { x: number; y: number }> } | null }> };
    const p = body.packs.find((x) => x.pack_id === "p_deploy_layout")!;
    expect(p.editor?.canvasLayout).toEqual({ bar: { x: 200, y: 300 } });
    expect(p.editor?.id).toBe("p_deploy_layout");
  });
});

describe("PUT /api/editor-session/:token/packs/:packId — invalid pack rejection", () => {
  test("400 when body.pack is null", async () => {
    const { token } = await createSession();
    const res = await app.request(`/api/editor-session/${token}/packs/p_null`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pack: null, files: { "x.yaml": "" } }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("missing_or_invalid_pack");
  });
});

describe("POST /api/editor-session/:token/packs/:packId/deploy — invalid pack rejection", () => {
  test("400 when body.pack is null", async () => {
    const { token } = await createTrustedSession();
    const res = await app.request(`/api/editor-session/${token}/packs/p_null/deploy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pack: null, files: { "x.yaml": "" } }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("missing_or_invalid_pack");
  });
});

describe("DELETE /api/editor-session/:token/packs/:packId", () => {
  test("soft-deletes pack, broadcasts pack_deleted, returns 200", async () => {
    const { token, keyId: serverKeyId } = await createSession();

    // Seed a bound pack using the new approach
    await seedBoundPack(serverKeyId, "p_to_delete", "h", {});

    const res = await app.request(`/api/editor-session/${token}/packs/p_to_delete`, {
      method: "DELETE",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { deleted: boolean };
    expect(body.deleted).toBe(true);

    // Verify soft-delete in DB
    const rows = await db.select().from(packs).where(eq(packs.id, "p_to_delete"));
    expect(rows[0].deletedAt).not.toBeNull();
  });

  test("returns 404 for unknown pack", async () => {
    const { token } = await createSession();

    const res = await app.request(`/api/editor-session/${token}/packs/nonexistent`, {
      method: "DELETE",
    });
    expect(res.status).toBe(404);
  });

  test("auto-resolves any open conflict for the pack as resolution=editor", async () => {
    const { token, keyId: serverKeyId } = await createSession();

    // Seed a bound pack
    await seedBoundPack(serverKeyId, "p_with_conflict", "h", {});

    // Insert open conflict
    const conflictId = crypto.randomUUID();
    await db.insert(packConflicts).values({
      id: conflictId, serverId: serverKeyId, packId: "p_with_conflict",
      diskFilesJson: "{}", diskHash: "d", lastSyncedHash: "", backendHashAtDetection: "h",
      detectedAt: new Date(),
    });

    const res = await app.request(`/api/editor-session/${token}/packs/p_with_conflict`, {
      method: "DELETE",
    });
    expect(res.status).toBe(200);

    const rows = await db.select().from(packConflicts).where(eq(packConflicts.id, conflictId));
    expect(rows[0].resolvedAt).not.toBeNull();
    expect(rows[0].resolution).toBe("editor");
  });
});
