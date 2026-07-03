import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../../db/index";
import { aiCreditLedger, networks } from "../../db/schema";
import { createNetwork } from "../../lib/networkManager";
import { getBucketBalances } from "./creditsRepo";
import { renewSubscriptionPeriod } from "./subscriptionCredits";

let networkId = "";

beforeAll(async () => {
	networkId = (await createNetwork("sub-renewal-net")).id;
});

afterAll(async () => {
	await db.delete(aiCreditLedger).where(eq(aiCreditLedger.networkId, networkId));
	await db.delete(networks).where(eq(networks.id, networkId));
});

describe("renewSubscriptionPeriod", () => {
	const future = new Date("2999-01-01T00:00:00Z");

	it("rolls the closing period's leftover (capped) even after its grant expired", async () => {
		const past = new Date("2020-01-01T00:00:00Z");
		// closing period pOld: granted 50, already expired (past). Period-scoped leftover = 50.
		await db.insert(aiCreditLedger).values({
			id: crypto.randomUUID(), networkId, delta: 50, reason: "grant",
			bucket: "subscription", expiresAt: past, periodId: "pOld", createdAt: past,
		});
		const res = await renewSubscriptionPeriod({
			networkId, creditsPerPeriod: 500, rolloverCap: 30,
			closingPeriodId: "pOld", newPeriodId: "pNew", newPeriodEnd: future,
		});
		expect(res.granted).toBe(500);
		expect(res.rolledOver).toBe(30); // capped at 30 even though grant expired
		const b = await getBucketBalances(networkId);
		expect(b.subscription).toBe(500); // old period excluded (expired), new 500 valid
		expect(b.rollover).toBe(30);
	});

	it("rolls nothing when cap is 0", async () => {
		const net = (await createNetwork("sub-renewal-net2")).id;
		try {
			await db.insert(aiCreditLedger).values({
				id: crypto.randomUUID(), networkId: net, delta: 40, reason: "grant",
				bucket: "subscription", expiresAt: future, periodId: "pOld2", createdAt: new Date(),
			});
			const res = await renewSubscriptionPeriod({
				networkId: net, creditsPerPeriod: 100, rolloverCap: 0,
				closingPeriodId: "pOld2", newPeriodId: "p1", newPeriodEnd: future,
			});
			expect(res.rolledOver).toBe(0);
			const b = await getBucketBalances(net);
			expect(b.subscription).toBe(140); // old (unexpired) 40 + new 100 — cap 0 rolls nothing
			expect(b.rollover).toBe(0);
		} finally {
			await db.delete(aiCreditLedger).where(eq(aiCreditLedger.networkId, net));
			await db.delete(networks).where(eq(networks.id, net));
		}
	});

	it("rolls nothing when there is no closing period", async () => {
		const net = (await createNetwork("sub-renewal-nocp")).id;
		try {
			const res = await renewSubscriptionPeriod({
				networkId: net, creditsPerPeriod: 100, rolloverCap: 50,
				closingPeriodId: null, newPeriodId: "p1", newPeriodEnd: future,
			});
			expect(res.rolledOver).toBe(0);
			expect((await getBucketBalances(net)).subscription).toBe(100);
		} finally {
			await db.delete(aiCreditLedger).where(eq(aiCreditLedger.networkId, net));
			await db.delete(networks).where(eq(networks.id, net));
		}
	});
});
