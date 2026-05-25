import { describe, expect, test, it, beforeEach } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../db/index";
import { editorSessions, linkCodes, serverKeys, networks, users, userSessions, memberships } from "../db/schema";
import { generateCode, generateServerKey } from "../lib/auth";
import { app } from "../app";

// ---------------------------------------------------------------------------
// Shared test helpers
// ---------------------------------------------------------------------------

async function seedUserAndSession(): Promise<{ userId: string; sessionId: string }> {
  const suffix = Math.random().toString(36).slice(2, 10);
  const userId = `user_${suffix}`;
  const sessionId = `sess_${Math.random().toString(36).slice(2, 18)}`;
  await db.insert(users).values({
    id: userId,
    email: `${suffix}@test.dev`,
    name: "Test",
    passwordHash: null,
    avatarUrl: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  await db.insert(userSessions).values({
    id: sessionId,
    userId,
    createdAt: new Date(),
    lastUsedAt: new Date(),
    expiresAt: new Date(Date.now() + 30 * 86400 * 1000),
  });
  return { userId, sessionId };
}

async function makeClaim(sessionId: string, body: object): Promise<Response> {
  const created = await app.request("/api/v1/link", { method: "POST" });
  const { code } = (await created.json()) as { code: string };
  return app.request(`/api/v1/link/${code}/claim`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Cookie": `ifz_user_session=${sessionId}`,
    },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------

describe("link_codes schema", () => {
  test("insert and read a link code", async () => {
    const code = "TEST0001";
    // Clean up any leftover row from a previous run
    await db.delete(linkCodes).where(eq(linkCodes.code, code));
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 10 * 60 * 1000);
    await db.insert(linkCodes).values({ code, createdAt: now, expiresAt });
    const rows = await db.select().from(linkCodes).where(eq(linkCodes.code, code));
    expect(rows.length).toBe(1);
    expect(rows[0].code).toBe(code);
    expect(rows[0].claimedAt).toBeNull();
    expect(rows[0].serverKeyId).toBeNull();
  });
});

describe("generateCode", () => {
  test("returns 8-char uppercase alphanumeric without confusable chars", () => {
    const code = generateCode();
    expect(code).toHaveLength(8);
    expect(code).toMatch(/^[A-Z2-9]{8}$/);
  });

  test("two calls produce different codes", () => {
    expect(generateCode()).not.toBe(generateCode());
  });
});

describe("generateServerKey", () => {
  test("returns sk_ key, UUID id, and matching SHA-256 hash", async () => {
    const { id, key, hash } = await generateServerKey();
    expect(key).toMatch(/^sk_[0-9a-f]{64}$/);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
    const expected = Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
    expect(hash).toBe(expected);
  });
});

describe("POST /api/v1/link", () => {
  test("returns 201 with 8-char code, url, and expires_at", async () => {
    const res = await app.request("/api/v1/link", { method: "POST" });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { code: string; url: string; expires_at: string };
    expect(body.code).toMatch(/^[A-Z2-9]{8}$/);
    expect(body.url).toContain(body.code);
    expect(new Date(body.expires_at).getTime()).toBeGreaterThan(Date.now());
  });
});

describe("GET /api/v1/link/:code", () => {
  test("pending for a freshly created code", async () => {
    const createRes = await app.request("/api/v1/link", { method: "POST" });
    const { code } = (await createRes.json()) as { code: string };
    const res = await app.request(`/api/v1/link/${code}`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { status: string }).status).toBe("pending");
  });

  test("404 for unknown code", async () => {
    expect((await app.request("/api/v1/link/NOTEXIST")).status).toBe(404);
  });
});

describe("POST /api/v1/link/:code/claim", () => {
  test("401 when no ifz_user_session cookie is present (claim without auth)", async () => {
    const { code } = (await (await app.request("/api/v1/link", { method: "POST" })).json()) as { code: string };
    const claimRes = await app.request(`/api/v1/link/${code}/claim`, { method: "POST" });
    expect(claimRes.status).toBe(401);
    expect(((await claimRes.json()) as { error: string }).error).toBe("unauthorized");
  });

  test("409 when claiming already-claimed code (with auth)", async () => {
    const { userId, sessionId } = await seedUserAndSession();
    const { code } = (await (await app.request("/api/v1/link", { method: "POST" })).json()) as { code: string };
    await app.request(`/api/v1/link/${code}/claim`, {
      method: "POST",
      headers: { "Cookie": `ifz_user_session=${sessionId}` },
    });
    expect((await app.request(`/api/v1/link/${code}/claim`, {
      method: "POST",
      headers: { "Cookie": `ifz_user_session=${sessionId}` },
    })).status).toBe(409);
    void userId;
  });

  test("404 for unknown code", async () => {
    const { sessionId } = await seedUserAndSession();
    expect((await app.request("/api/v1/link/UNKNOWN1/claim", {
      method: "POST",
      headers: { "Cookie": `ifz_user_session=${sessionId}` },
    })).status).toBe(404);
  });
});

describe("POST /api/v1/link/:code/claim — hard break (Plan accounts × networks)", () => {
  it("returns 401 when no ifz_user_session cookie is present", async () => {
    const created = await app.request("/api/v1/link", { method: "POST" });
    const { code } = (await created.json()) as { code: string };

    const res = await app.request(`/api/v1/link/${code}/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("unauthorized");
  });
});

describe("POST /api/v1/link/:code/claim — smart-count network selection", () => {
  it("auto-creates 'Mon Network' when user has 0 networks", async () => {
    const { sessionId } = await seedUserAndSession();
    const res = await makeClaim(sessionId, {});
    expect(res.status).toBe(200);
    const body = (await res.json()) as { network_id: string };
    expect(body.network_id).toBeTruthy();
    const [created] = await db.select().from(networks).where(eq(networks.id, body.network_id));
    expect(created.name).toBe("Mon Network");
  });

  it("uses the single network when user has exactly 1", async () => {
    const { sessionId } = await seedUserAndSession();
    // First claim creates "Mon Network"
    const first = await makeClaim(sessionId, {});
    const firstBody = (await first.json()) as { network_id: string };
    // Second claim should re-use it
    const second = await makeClaim(sessionId, {});
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as { network_id: string };
    expect(secondBody.network_id).toBe(firstBody.network_id);
  });

  it("returns 400 must_choose_network when user has 2+ networks and body omits network_id", async () => {
    const { userId, sessionId } = await seedUserAndSession();
    const { createNetwork } = await import("../lib/networkManager");
    const { addMembership } = await import("../lib/membershipManager");
    const n1 = await createNetwork("A");
    const n2 = await createNetwork("B");
    await addMembership(userId, n1.id, "owner");
    await addMembership(userId, n2.id, "owner");
    const res = await makeClaim(sessionId, {});
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("must_choose_network");
  });

  it("returns 403 when user is not a member of the requested network_id", async () => {
    const { sessionId } = await seedUserAndSession();
    const { createNetwork } = await import("../lib/networkManager");
    const foreign = await createNetwork("foreign");
    const res = await makeClaim(sessionId, { network_id: foreign.id });
    expect(res.status).toBe(403);
  });
});
