import { describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../db/index";
import { linkCodes, serverKeys } from "../db/schema";
import { createNetwork } from "../lib/networkManager";
import { mintLinkCode } from "../lib/linkCodeStorage";
import { app } from "../app";

async function seedUnredeemedKey(): Promise<{ networkId: string; keyId: string }> {
  const n = await createNetwork("Link Route Net");
  const keyId = `srv_${Math.random().toString(16).slice(2, 14)}`;
  await db.insert(serverKeys).values({ id: keyId, hash: null, networkId: n.id, createdAt: new Date() });
  return { networkId: n.id, keyId };
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

describe("GET /api/v1/link/:code", () => {
  it("returns pending for a fresh code and 404 for unknown", async () => {
    const { keyId } = await seedUnredeemedKey();
    const { code } = await mintLinkCode(keyId);
    const res = await app.request(`/api/v1/link/${code}`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { status: string }).status).toBe("pending");
    expect((await app.request("/api/v1/link/NOPE0000")).status).toBe(404);
  });

  it("returns claimed after redeem", async () => {
    const { keyId } = await seedUnredeemedKey();
    const { code } = await mintLinkCode(keyId);
    await app.request(`/api/v1/link/${code}/redeem`, { method: "POST" });
    const res = await app.request(`/api/v1/link/${code}`);
    expect(((await res.json()) as { status: string }).status).toBe("claimed");
  });
});

describe("POST /api/v1/link/:code/redeem", () => {
  it("issues the secret + network name and sets the matching hash", async () => {
    const { keyId } = await seedUnredeemedKey();
    const { code } = await mintLinkCode(keyId);

    const res = await app.request(`/api/v1/link/${code}/redeem`, { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      server_key: string;
      server_key_id: string;
      network_name: string;
    };
    expect(body.server_key_id).toBe(keyId);
    expect(body.server_key).toMatch(/^sk_[0-9a-f]{64}$/);
    expect(body.network_name).toBe("Link Route Net");

    const [key] = await db.select().from(serverKeys).where(eq(serverKeys.id, keyId));
    expect(key.hash).toBe(await sha256Hex(body.server_key));
  });

  it("409 already_redeemed on second redeem of the same code", async () => {
    const { keyId } = await seedUnredeemedKey();
    const { code } = await mintLinkCode(keyId);
    await app.request(`/api/v1/link/${code}/redeem`, { method: "POST" });
    const res = await app.request(`/api/v1/link/${code}/redeem`, { method: "POST" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe("already_redeemed");
  });

  it("404 for an unknown code", async () => {
    const res = await app.request("/api/v1/link/NOPE0000/redeem", { method: "POST" });
    expect(res.status).toBe(404);
  });

  it("410 for an expired code", async () => {
    const { keyId } = await seedUnredeemedKey();
    const code = `OLD${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    await db.insert(linkCodes).values({
      code,
      createdAt: new Date(Date.now() - 3600_000),
      expiresAt: new Date(Date.now() - 60_000),
      serverKeyId: keyId,
    });
    const res = await app.request(`/api/v1/link/${code}/redeem`, { method: "POST" });
    expect(res.status).toBe(410);
  });
});
