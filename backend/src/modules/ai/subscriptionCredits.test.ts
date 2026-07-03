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

	it("rolls leftover subscription into rollover (capped) and grants the new period", async () => {
		// Start: 50 subscription left, cap 30.
		await db.insert(aiCreditLedger).values({
			id: crypto.randomUUID(), networkId, delta: 50, reason: "grant",
			bucket: "subscription", expiresAt: future, createdAt: new Date(),
		});
		const res = await renewSubscriptionPeriod({
			networkId, creditsPerPeriod: 500, rolloverCap: 30,
			newPeriodId: "p2", newPeriodEnd: future,
		});
		expect(res.granted).toBe(500);
		expect(res.rolledOver).toBe(30);
		const b = await getBucketBalances(networkId);
		expect(b.subscription).toBe(500); // old 50 zeroed, new 500 granted
		expect(b.rollover).toBe(30); // capped at 30, 20 dropped
	});

	it("rolls nothing when cap is 0", async () => {
		const net = (await createNetwork("sub-renewal-net2")).id;
		try {
			await db.insert(aiCreditLedger).values({
				id: crypto.randomUUID(), networkId: net, delta: 40, reason: "grant",
				bucket: "subscription", expiresAt: future, createdAt: new Date(),
			});
			const res = await renewSubscriptionPeriod({
				networkId: net, creditsPerPeriod: 100, rolloverCap: 0,
				newPeriodId: "p1", newPeriodEnd: future,
			});
			expect(res.rolledOver).toBe(0);
			const b = await getBucketBalances(net);
			expect(b.subscription).toBe(100);
			expect(b.rollover).toBe(0);
		} finally {
			await db.delete(aiCreditLedger).where(eq(aiCreditLedger.networkId, net));
			await db.delete(networks).where(eq(networks.id, net));
		}
	});
});
