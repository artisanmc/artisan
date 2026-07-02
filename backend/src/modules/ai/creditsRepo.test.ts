import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../../db/index";
import { aiCreditLedger, networks } from "../../db/schema";
import { createNetwork } from "../../lib/networkManager";
import { getBalance, grantCredits, listLedger } from "./creditsRepo";

let networkId = "";

beforeAll(async () => {
	networkId = (await createNetwork("credits-test-network")).id;
});

afterAll(async () => {
	await db.delete(aiCreditLedger).where(eq(aiCreditLedger.networkId, networkId));
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
});
