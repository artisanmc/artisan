import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../../db/index";
import { aiCreditLedger, networks } from "../../db/schema";
import { createNetwork } from "../../lib/networkManager";
import { getBalance, grantCredits, listLedger, getBucketBalances, type BucketType } from "./creditsRepo";

let networkId = "";

beforeAll(async () => {
	networkId = (await createNetwork("credits-test-network")).id;
});

afterEach(async () => {
	await db.delete(aiCreditLedger).where(eq(aiCreditLedger.networkId, networkId));
});

afterAll(async () => {
	await db.delete(networks).where(eq(networks.id, networkId));
});

describe("creditsRepo", () => {
	it("balance is 0 for a never-granted network", async () => {
		expect(await getBalance(networkId)).toBe(0);
	});

	it("grant → balance = sum of deltas; ledger lists newest first", async () => {
		await grantCredits({ networkId, amount: 500, note: "welcome" });
		await grantCredits({ networkId, amount: 200 });
		expect(await getBalance(networkId)).toBe(700);
		const ledger = await listLedger(networkId);
		expect(ledger.length).toBe(2);
		expect(ledger[0].delta).toBe(200);
		expect(ledger[1].note).toBe("welcome");
	});

	it("getBucketBalances sums each bucket, excluding expired entries", async () => {
		const past = new Date("2020-01-01T00:00:00Z");
		const future = new Date("2999-01-01T00:00:00Z");
		await grantCredits({ networkId, amount: 100, bucket: "subscription", expiresAt: future });
		await grantCredits({ networkId, amount: 40, bucket: "subscription", expiresAt: past }); // expired → ignored
		await grantCredits({ networkId, amount: 30, bucket: "rollover" });
		await grantCredits({ networkId, amount: 200, bucket: "topup" });
		const b = await getBucketBalances(networkId);
		expect(b.subscription).toBe(100);
		expect(b.rollover).toBe(30);
		expect(b.topup).toBe(200);
		expect(b.total).toBe(330);
	});

	it("getBalance excludes expired entries", async () => {
		await grantCredits({ networkId, amount: 50, bucket: "topup" });
		await grantCredits({ networkId, amount: 999, bucket: "subscription", expiresAt: new Date("2020-01-01T00:00:00Z") });
		expect(await getBalance(networkId)).toBe(50);
	});

	it("grantCredits defaults to the topup bucket", async () => {
		const { id } = await grantCredits({ networkId, amount: 10 });
		const [row] = await db.select().from(aiCreditLedger).where(eq(aiCreditLedger.id, id));
		expect(row.bucket).toBe("topup");
		expect(row.expiresAt).toBeNull();
	});
});
