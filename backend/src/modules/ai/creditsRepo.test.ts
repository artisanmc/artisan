import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { and, eq } from "drizzle-orm";
import { db } from "../../db/index";
import { aiCreditLedger, aiUsageLog, networks } from "../../db/schema";
import { createNetwork } from "../../lib/networkManager";
import { getBalance, grantCredits, listLedger, getBucketBalances, debitBuckets, type BucketType } from "./creditsRepo";

let networkId = "";

beforeAll(async () => {
	networkId = (await createNetwork("credits-test-network")).id;
});

afterEach(async () => {
	await db.delete(aiCreditLedger).where(eq(aiCreditLedger.networkId, networkId));
	await db.delete(aiUsageLog).where(eq(aiUsageLog.networkId, networkId));
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

	it("debitBuckets consumes subscription → rollover → topup in order", async () => {
		const now = new Date();
		await grantCredits({ networkId, amount: 30, bucket: "subscription" });
		await grantCredits({ networkId, amount: 20, bucket: "rollover" });
		await grantCredits({ networkId, amount: 100, bucket: "topup" });
		// debit 65 → 30 sub + 20 rollover + 15 topup
		const br = await db.transaction((tx) => debitBuckets(tx, networkId, 65, { now }));
		expect(br).toEqual({ subscription: 30, rollover: 20, topup: 15, total: 65 });
		const b = await getBucketBalances(networkId);
		expect(b.subscription).toBe(0);
		expect(b.rollover).toBe(0);
		expect(b.topup).toBe(85);
	});

	it("debitBuckets puts the shortfall on topup (can go negative) when funds are insufficient", async () => {
		const now = new Date();
		await grantCredits({ networkId, amount: 10, bucket: "subscription" });
		const br = await db.transaction((tx) => debitBuckets(tx, networkId, 25, { now }));
		expect(br.subscription).toBe(10);
		expect(br.topup).toBe(15); // 15 debited from topup even though it was 0 → -15
		expect(br.total).toBe(25);
		expect(await getBalance(networkId)).toBe(-15);
	});

	it("debitBuckets writes one negative ledger entry per consumed bucket, tagged with usageLogId", async () => {
		const now = new Date();
		const logId = crypto.randomUUID();
		await db.insert(aiUsageLog).values({
			id: logId,
			networkId,
			modelId: null,
			modelName: "test-model",
			provider: "openai",
			providerModelId: "gpt-4",
			actionType: "chat",
			inputTokens: 0,
			outputTokens: 0,
			cachedInputTokens: 0,
			creditsCharged: 0,
			realCostMicroUsd: 0,
			status: "success",
			promptPreview: "test",
			createdAt: now,
		});
		await grantCredits({ networkId, amount: 5, bucket: "subscription" });
		await grantCredits({ networkId, amount: 5, bucket: "topup" });
		await db.transaction((tx) => debitBuckets(tx, networkId, 8, { now, usageLogId: logId }));
		const debits = await db.select().from(aiCreditLedger)
			.where(and(eq(aiCreditLedger.networkId, networkId), eq(aiCreditLedger.reason, "debit")));
		const byBucket = Object.fromEntries(debits.map((d) => [d.bucket, d.delta]));
		expect(byBucket.subscription).toBe(-5);
		expect(byBucket.topup).toBe(-3);
		expect(debits.every((d) => d.usageLogId === logId)).toBe(true);
	});

	it("debitBuckets stamps subscription debits with the consumed period's expiry+period", async () => {
		const now = new Date();
		const future = new Date("2999-01-01T00:00:00Z");
		await grantCredits({ networkId, amount: 40, bucket: "subscription", expiresAt: future, periodId: "pA" });
		await grantCredits({ networkId, amount: 100, bucket: "topup" });
		await db.transaction((tx) => debitBuckets(tx, networkId, 50, { now })); // 40 sub + 10 topup
		const debits = await db.select().from(aiCreditLedger)
			.where(and(eq(aiCreditLedger.networkId, networkId), eq(aiCreditLedger.reason, "debit")));
		const sub = debits.find((d) => d.bucket === "subscription");
		const top = debits.find((d) => d.bucket === "topup");
		expect(sub?.expiresAt?.toISOString()).toBe(future.toISOString());
		expect(sub?.periodId).toBe("pA");
		expect(top?.expiresAt).toBeNull(); // topup debit stays permanent
	});

	it("a consumed subscription period nets to zero after expiry (no lingering debit)", async () => {
		const past = new Date("2020-01-01T00:00:00Z");
		// grant + its consumption both tagged with the (now past) period expiry
		await db.insert(aiCreditLedger).values([
			{ id: crypto.randomUUID(), networkId, delta: 100, reason: "grant", bucket: "subscription", expiresAt: past, periodId: "pOld", createdAt: past },
			{ id: crypto.randomUUID(), networkId, delta: -30, reason: "debit", bucket: "subscription", expiresAt: past, periodId: "pOld", createdAt: past },
		]);
		const b = await getBucketBalances(networkId);
		expect(b.subscription).toBe(0); // both excluded together — no −30 lingering
	});
});
