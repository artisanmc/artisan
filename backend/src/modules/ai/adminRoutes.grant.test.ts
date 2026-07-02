import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { app } from "../../app";
import { db } from "../../db/index";
import { aiCreditLedger, networks, users } from "../../db/schema";
import { createNetwork } from "../../lib/networkManager";
import { createSession } from "../../lib/sessionManager";
import { getBalance, listLedger } from "./creditsRepo";

const ADMIN_ID = "user_admin_aigrant";
let adminSession = "";
let networkId = "";

beforeAll(async () => {
	const now = new Date();
	await db.insert(users).values({ id: ADMIN_ID, email: `${ADMIN_ID}@example.com`, name: "Admin", isAdmin: true, createdAt: now, updatedAt: now }).onConflictDoNothing();
	adminSession = (await createSession(ADMIN_ID)).id;
	networkId = (await createNetwork("grant-test-network")).id;
});

afterAll(async () => {
	await db.delete(aiCreditLedger).where(eq(aiCreditLedger.networkId, networkId));
	await db.delete(networks).where(eq(networks.id, networkId));
	await db.delete(users).where(eq(users.id, ADMIN_ID));
});

const adminHeaders = () => ({ Cookie: `artisan_user_session=${adminSession}`, "Content-Type": "application/json" });

describe("admin ai credits grant", () => {
	it("grants and returns the new balance; ledger records the admin author", async () => {
		const res = await app.request("/api/v1/admin/ai/credits/grant", {
			method: "POST", headers: adminHeaders(),
			body: JSON.stringify({ networkId, amount: 500, note: "starter" }),
		});
		expect(res.status).toBe(200);
		expect((await res.json())).toEqual({ ok: true, balance: 500 });
		expect(await getBalance(networkId)).toBe(500);
		const [entry] = await listLedger(networkId);
		expect(entry.reason).toBe("grant");
		expect(entry.createdBy).toBe(ADMIN_ID);
	});

	it("rejects non-positive / non-integer amounts", async () => {
		for (const amount of [0, -5, 1.5, "10"]) {
			const res = await app.request("/api/v1/admin/ai/credits/grant", {
				method: "POST", headers: adminHeaders(),
				body: JSON.stringify({ networkId, amount }),
			});
			expect(res.status).toBe(400);
		}
	});

	it("unknown network → 404", async () => {
		const res = await app.request("/api/v1/admin/ai/credits/grant", {
			method: "POST", headers: adminHeaders(),
			body: JSON.stringify({ networkId: "nope", amount: 10 }),
		});
		expect(res.status).toBe(404);
	});
});
