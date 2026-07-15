import { describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../db/index";
import { linkCodes, serverKeys } from "../db/schema";
import { createNetwork } from "./networkManager";
import { mintLinkCode, redeemLinkCode } from "./linkCodeStorage";

async function seedUnredeemedKey(): Promise<{ networkId: string; keyId: string }> {
	const n = await createNetwork("LinkCode Net");
	const keyId = `srv_${Math.random().toString(16).slice(2, 14)}`;
	// hash NULL = created in editor, not yet redeemed.
	await db.insert(serverKeys).values({ id: keyId, hash: null, networkId: n.id, createdAt: new Date() });
	return { networkId: n.id, keyId };
}

async function sha256Hex(input: string): Promise<string> {
	const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
	return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

describe("mintLinkCode", () => {
	it("creates a code bound to the server key with a future expiry", async () => {
		const { keyId } = await seedUnredeemedKey();
		const { code, expiresAt } = await mintLinkCode(keyId);
		expect(code).toMatch(/^[A-Z2-9]{8}$/);
		expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
		const [row] = await db.select().from(linkCodes).where(eq(linkCodes.code, code));
		expect(row.serverKeyId).toBe(keyId);
		expect(row.claimedAt).toBeNull();
	});
});

describe("redeemLinkCode", () => {
	it("issues the secret, sets the matching hash, and marks the code claimed", async () => {
		const { keyId } = await seedUnredeemedKey();
		const { code } = await mintLinkCode(keyId);

		const res = await redeemLinkCode(code);
		expect(res.ok).toBe(true);
		if (!res.ok) return;
		expect(res.serverKeyId).toBe(keyId);
		expect(res.serverKey).toMatch(/^sk_[0-9a-f]{64}$/);

		const [key] = await db.select().from(serverKeys).where(eq(serverKeys.id, keyId));
		expect(key.hash).toBe(await sha256Hex(res.serverKey)); // secret authenticates
		const [row] = await db.select().from(linkCodes).where(eq(linkCodes.code, code));
		expect(row.claimedAt).not.toBeNull();
	});

	it("rotates the secret when redeeming a fresh code for an already-linked key", async () => {
		const { keyId } = await seedUnredeemedKey();
		const first = await redeemLinkCode((await mintLinkCode(keyId)).code);
		expect(first.ok).toBe(true);
		const [afterFirst] = await db.select().from(serverKeys).where(eq(serverKeys.id, keyId));

		const second = await redeemLinkCode((await mintLinkCode(keyId)).code);
		expect(second.ok).toBe(true);
		const [afterSecond] = await db.select().from(serverKeys).where(eq(serverKeys.id, keyId));
		expect(afterSecond.hash).not.toBe(afterFirst.hash); // rotated in place
	});

	it("refuses an already-claimed code", async () => {
		const { keyId } = await seedUnredeemedKey();
		const { code } = await mintLinkCode(keyId);
		await redeemLinkCode(code);
		const again = await redeemLinkCode(code);
		expect(again).toEqual({ ok: false, reason: "claimed" });
	});

	it("refuses an unknown code", async () => {
		expect(await redeemLinkCode("ZZZZ9999")).toEqual({ ok: false, reason: "not_found" });
	});

	it("refuses an expired code", async () => {
		const { keyId } = await seedUnredeemedKey();
		const code = `EXP${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
		await db.insert(linkCodes).values({
			code,
			createdAt: new Date(Date.now() - 3600_000),
			expiresAt: new Date(Date.now() - 60_000),
			serverKeyId: keyId,
		});
		expect(await redeemLinkCode(code)).toEqual({ ok: false, reason: "expired" });
	});
});
