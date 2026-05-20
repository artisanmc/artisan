import { describe, expect, test, beforeEach } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../db/index";
import { linkCodes, serverKeys, networks } from "../db/schema";
import { generateCode, generateServerKey } from "../lib/auth";
import { app } from "../app";

describe("link_codes schema", () => {
  test("insert and read a link code", async () => {
    const code = "TEST0001";
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

describe("POST /api/link", () => {
  test("returns 201 with 8-char code, url, and expires_at", async () => {
    const res = await app.request("/api/link", { method: "POST" });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { code: string; url: string; expires_at: string };
    expect(body.code).toMatch(/^[A-Z2-9]{8}$/);
    expect(body.url).toContain(body.code);
    expect(new Date(body.expires_at).getTime()).toBeGreaterThan(Date.now());
  });
});

describe("GET /api/link/:code", () => {
  test("pending for a freshly created code", async () => {
    const createRes = await app.request("/api/link", { method: "POST" });
    const { code } = (await createRes.json()) as { code: string };
    const res = await app.request(`/api/link/${code}`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { status: string }).status).toBe("pending");
  });

  test("404 for unknown code", async () => {
    expect((await app.request("/api/link/NOTEXIST")).status).toBe(404);
  });
});

describe("POST /api/link/:code/claim", () => {
  test("claims valid code and returns server_key_id", async () => {
    const { code } = (await (await app.request("/api/link", { method: "POST" })).json()) as { code: string };
    const claimRes = await app.request(`/api/link/${code}/claim`, { method: "POST" });
    expect(claimRes.status).toBe(200);
    const { server_key_id } = (await claimRes.json()) as { server_key_id: string };
    expect(server_key_id).toMatch(/^[0-9a-f-]{36}$/);
    // Status is now claimed
    const status = (await (await app.request(`/api/link/${code}`)).json()) as { status: string };
    expect(status.status).toBe("claimed");
  });

  test("409 when claiming already-claimed code", async () => {
    const { code } = (await (await app.request("/api/link", { method: "POST" })).json()) as { code: string };
    await app.request(`/api/link/${code}/claim`, { method: "POST" });
    expect((await app.request(`/api/link/${code}/claim`, { method: "POST" })).status).toBe(409);
  });

  test("404 for unknown code", async () => {
    expect((await app.request("/api/link/UNKNOWN1/claim", { method: "POST" })).status).toBe(404);
  });
});

describe("POST /api/link/:code/claim — Network auto-creation", () => {
  beforeEach(async () => {
    // Delete in dependency order: linkCodes refs serverKeys, serverKeys refs networks
    await db.delete(linkCodes);
    await db.delete(serverKeys);
    await db.delete(networks);
  });

  test("auto-creates a Network when claiming and links the server_key to it", async () => {
    const create = await app.request("/api/link/", { method: "POST" });
    const { code } = (await create.json()) as { code: string };
    const claim = await app.request(`/api/link/${code}/claim`, { method: "POST" });
    const { server_key_id } = (await claim.json()) as { server_key_id: string };

    const sk = await db.select().from(serverKeys).where(eq(serverKeys.id, server_key_id));
    expect(sk[0].networkId).toBeTruthy();
    const nets = await db.select().from(networks).where(eq(networks.id, sk[0].networkId as string));
    expect(nets).toHaveLength(1);
    expect(nets[0].name).toMatch(/Network/);
  });
});
