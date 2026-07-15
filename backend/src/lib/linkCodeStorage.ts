import { eq } from "drizzle-orm";
import { db } from "../db/index";
import { linkCodes, serverKeys } from "../db/schema";
import { generateCode, generateServerKey } from "./auth";

/** Link codes live 10 minutes — long enough to copy from editor to server console. */
const CODE_TTL_MS = 10 * 60 * 1000;

/**
 * Mint a fresh single-use link code bound to an existing `server_key`. The
 * editor shows this code; the admin runs `/artisan link <code>` on the server
 * to redeem it. A server_key can have several codes minted over its life
 * (re-link / rotation) — only the first successful redeem of each consumes it.
 */
export async function mintLinkCode(
	serverKeyId: string,
): Promise<{ code: string; expiresAt: Date }> {
	const code = generateCode();
	const now = new Date();
	const expiresAt = new Date(now.getTime() + CODE_TTL_MS);
	await db.insert(linkCodes).values({ code, createdAt: now, expiresAt, serverKeyId });
	return { code, expiresAt };
}

export type RedeemResult =
	| { ok: true; serverKey: string; serverKeyId: string; networkId: string }
	| { ok: false; reason: "not_found" | "expired" | "claimed" | "no_key" };

/**
 * Redeem a link code: generate the server_key's secret, set its hash, and mark
 * the code consumed — all atomically. The secret is returned exactly once and
 * never stored in plaintext. Redeeming a code whose key already has a hash
 * **rotates** it (re-link), keeping the same row + attached projects.
 */
export async function redeemLinkCode(code: string): Promise<RedeemResult> {
	const rotated = await generateServerKey();
	return db.transaction(async (tx): Promise<RedeemResult> => {
		const rows = await tx.select().from(linkCodes).where(eq(linkCodes.code, code));
		if (rows.length === 0) return { ok: false, reason: "not_found" };
		const row = rows[0];
		if (row.claimedAt) return { ok: false, reason: "claimed" };
		if (row.expiresAt < new Date()) return { ok: false, reason: "expired" };
		if (!row.serverKeyId) return { ok: false, reason: "no_key" };

		const keyRows = await tx
			.select({ id: serverKeys.id, networkId: serverKeys.networkId })
			.from(serverKeys)
			.where(eq(serverKeys.id, row.serverKeyId));
		if (keyRows.length === 0) return { ok: false, reason: "no_key" };

		await tx.update(serverKeys).set({ hash: rotated.hash }).where(eq(serverKeys.id, row.serverKeyId));
		await tx.update(linkCodes).set({ claimedAt: new Date() }).where(eq(linkCodes.code, code));
		return {
			ok: true,
			serverKey: rotated.key,
			serverKeyId: row.serverKeyId,
			networkId: keyRows[0].networkId,
		};
	});
}
