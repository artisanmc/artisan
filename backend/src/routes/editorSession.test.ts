import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../db/index";
import { editorSessions, serverKeys } from "../db/schema";
import { generateCode, generateEditorToken, generateTrustCode, validateAccessToken, findSessionByTrustCode, validateEditorToken } from "../lib/auth";
import { handlePluginMessage, connSenders, connToServerId } from "../ws/hub";
import type { HelloMessage, HelloAckMessage } from "../protocol";

describe("editor_sessions schema", () => {
  test("new security columns default to null", async () => {
    const keyId = crypto.randomUUID();
    await db.insert(serverKeys).values({ id: keyId, hash: "sc" + keyId.slice(0,8), createdAt: new Date() });
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

async function createRawSession(): Promise<{ urlToken: string; keyId: string }> {
  const keyId = crypto.randomUUID();
  await db.insert(serverKeys).values({ id: keyId, hash: "raw" + keyId.slice(0,8), createdAt: new Date() });
  const urlToken = "url_" + generateEditorToken();
  const trustCode = generateTrustCode();
  await db.insert(editorSessions).values({
    token: urlToken, serverKeyId: keyId, createdBy: "CONSOLE",
    createdAt: new Date(), expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    trustCode,
  });
  return { urlToken, keyId };
}

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
    const keyId = crypto.randomUUID();
    await db.insert(serverKeys).values({ id: keyId, hash: "revx" + keyId.slice(0,8), createdAt: new Date() });
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
    const keyId = crypto.randomUUID();
    await db.insert(serverKeys).values({ id: keyId, hash: "expx" + keyId.slice(0,8), createdAt: new Date() });
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

async function createSession(serverId?: string): Promise<{ token: string; keyId: string }> {
  const keyId = serverId ?? crypto.randomUUID();
  if (!serverId) {
    await db.insert(serverKeys).values({ id: keyId, hash: "sh" + keyId.slice(0,8), createdAt: new Date() });
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
    const keyId = crypto.randomUUID();
    await db.insert(serverKeys).values({ id: keyId, hash: "vat" + keyId.slice(0,8), createdAt: new Date() });
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
    const keyId = crypto.randomUUID();
    await db.insert(serverKeys).values({ id: keyId, hash: "exp" + keyId.slice(0,8), createdAt: new Date() });
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
    const keyId = crypto.randomUUID();
    await db.insert(serverKeys).values({ id: keyId, hash: "tr" + keyId.slice(0,8), createdAt: new Date() });
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
    const keyId = crypto.randomUUID();
    await db.insert(serverKeys).values({ id: keyId, hash: "rvat" + keyId.slice(0,8), createdAt: new Date() });
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
    const keyId = crypto.randomUUID();
    await db.insert(serverKeys).values({ id: keyId, hash: "sexp" + keyId.slice(0,8), createdAt: new Date() });
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
    const keyId = crypto.randomUUID();
    await db.insert(serverKeys).values({ id: keyId, hash: "fc" + keyId.slice(0,8), createdAt: new Date() });
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
    const keyId = crypto.randomUUID();
    await db.insert(serverKeys).values({ id: keyId, hash: "fcr" + keyId.slice(0,8), createdAt: new Date() });
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
    const keyId = crypto.randomUUID();
    await db.insert(serverKeys).values({ id: keyId, hash: "fce" + keyId.slice(0,8), createdAt: new Date() });
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

describe("GET /api/editor-session/:token/items", () => {
  test("returns 503 when server is offline (no mc_version registered)", async () => {
    const { token } = await createSession();
    const res = await app.request(`/api/editor-session/${token}/items`);
    expect(res.status).toBe(503);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("server_offline");
  });

  test("returns 404 for unknown mc_version", async () => {
    const createRes = await app.request("/api/server-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: "items-ver-test" }),
    });
    const { key: serverKey } = (await createRes.json()) as { key: string };

    const hello: HelloMessage = {
      type: "hello",
      server_key: serverKey,
      plugin_version: "1.0.0",
      minecraft_version: "99.99.99",
      current_bundle_hash: "",
    };
    const helloRes = await handlePluginMessage("conn-items-test", JSON.stringify(hello));
    const ack = JSON.parse(helloRes.reply!) as HelloAckMessage;

    const { token } = await createSession(ack.server_id);

    const res = await app.request(`/api/editor-session/${token}/items`);
    expect(res.status).toBe(404);
  });

  test("returns 200 with items for known mc_version", async () => {
    const createRes = await app.request("/api/server-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: "items-ok-test" }),
    });
    const { key: serverKey } = (await createRes.json()) as { key: string };

    const hello: HelloMessage = {
      type: "hello",
      server_key: serverKey,
      plugin_version: "1.0.0",
      minecraft_version: "1.21.4",
      current_bundle_hash: "",
    };
    const helloRes = await handlePluginMessage("conn-items-ok", JSON.stringify(hello));
    const ack = JSON.parse(helloRes.reply!) as HelloAckMessage;

    const { token } = await createSession(ack.server_id);

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
    const keyId = crypto.randomUUID();
    await db.insert(serverKeys).values({ id: keyId, hash: "cors_cred" + keyId.slice(0,8), createdAt: new Date() });
    const urlToken = "cors_cred_" + crypto.randomUUID().slice(0,8);
    await db.insert(editorSessions).values({
      token: urlToken, serverKeyId: keyId, createdBy: "test",
      createdAt: new Date(), expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), trustCode: generateTrustCode(),
    });
    const accessToken = "corsat_" + crypto.randomUUID().slice(0,8);
    await db.update(editorSessions).set({
      exchangedAt: new Date(), accessToken,
      accessExpiresAt: new Date(Date.now() + 5 * 60 * 1000), refreshToken: "dummy",
    }).where(eq(editorSessions.token, urlToken));

    const res = await app.request(`/api/editor-session/${accessToken}`, {
      headers: { "Origin": "http://localhost:5173" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Credentials")).toBe("true");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:5173");
  });
});

describe("custom_items_changed", () => {
  test("sends custom_items_request when hash differs from cache", async () => {
    // Arrange: register an authenticated plugin connection
    const connId = "conn_ci_test_" + crypto.randomUUID().slice(0, 8);
    const sent: string[] = [];
    connSenders.set(connId, (msg) => sent.push(msg));

    // Authenticate via hello
    const keyId = crypto.randomUUID();
    const hash = crypto.randomUUID().replace(/-/g, "");
    await db.insert(serverKeys).values({ id: keyId, hash, createdAt: new Date() });
    const rawKey = "rawkey_ci_" + keyId.slice(0, 8);
    const keyHash = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawKey)))
    ).map(b => b.toString(16).padStart(2, "0")).join("");
    await db.update(serverKeys).set({ hash: keyHash }).where(eq(serverKeys.id, keyId));

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
