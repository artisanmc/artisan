import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { app } from "../../app";
import { db } from "../../db/index";
import { aiCreditLedger, aiUsageLog, memberships, networks, users } from "../../db/schema";
import { createNetwork } from "../../lib/networkManager";
import { createSession } from "../../lib/sessionManager";
import { grantCredits } from "./creditsRepo";
import { userFocus } from "./analytics";

const ADMIN_ID = "user_admin_aifocus";
const TARGET_ID = "usr_focus_ai";
let adminSession = "";
let networkId = "";
const from = new Date("2020-03-10T00:00:00Z");
const to = new Date("2020-03-13T00:00:00Z");

function row(over: Partial<typeof aiUsageLog.$inferInsert>): typeof aiUsageLog.$inferInsert {
	return {
		id: crypto.randomUUID(), networkId, userId: null, serverKeyId: null,
		modelId: null, modelName: "M1", provider: "openai", providerModelId: "m1",
		actionType: "chat", conversationId: null,
		inputTokens: 1000, outputTokens: 100, cachedInputTokens: 0,
		creditsCharged: 10, realCostMicroUsd: 5000, durationMs: 100,
		status: "success", errorMessage: null, promptPreview: "",
		createdAt: new Date("2020-03-11T10:00:00Z"),
		...over,
	};
}

beforeAll(async () => {
	const now = new Date();
	for (const [id, admin] of [[ADMIN_ID, true], [TARGET_ID, false], ["usr_focus_other", false]] as const) {
		await db.insert(users).values({ id, email: `${id}@example.com`, name: id, isAdmin: admin, createdAt: now, updatedAt: now }).onConflictDoNothing();
	}
	adminSession = (await createSession(ADMIN_ID)).id;
	networkId = (await createNetwork("aifocus-net")).id;
	await db.insert(memberships).values({
		id: "mem_aifocus", userId: TARGET_ID, networkId, role: "owner", createdAt: now,
	}).onConflictDoNothing();
	await db.insert(aiUsageLog).values([
		row({ userId: TARGET_ID }),
		row({ userId: TARGET_ID, status: "error", creditsCharged: 0 }),
		row({ userId: "usr_focus_other" }),
	]);
	await grantCredits({ networkId, amount: 500, note: "starter" });
});

afterAll(async () => {
	await db.delete(aiUsageLog).where(eq(aiUsageLog.networkId, networkId));
	await db.delete(aiCreditLedger).where(eq(aiCreditLedger.networkId, networkId));
	await db.delete(networks).where(eq(networks.id, networkId)); // cascades memberships
	await db.delete(users).where(eq(users.id, ADMIN_ID));
	await db.delete(users).where(eq(users.id, TARGET_ID));
	await db.delete(users).where(eq(users.id, "usr_focus_other"));
});

describe("userFocus", () => {
	it("aggregates only the target user's rows", async () => {
		const f = await userFocus("usr_focus_ai", from, to);
		expect(f.totals.turns).toBe(2);
		expect(f.totals.errors).toBe(1);
	});

	it("lists the user's networks with balance and non-debit ledger entries", async () => {
		const f = await userFocus("usr_focus_ai", from, to);
		expect(f.networks.length).toBe(1);
		expect(f.networks[0].balance).toBe(500);
		expect(f.networks[0].grants.length).toBe(1);
		expect(f.networks[0].grants[0].reason).toBe("grant");
	});

	it("grants survive being older than a flood of debit rows", async () => {
		// 5 debits newer than the grant — a recency-limited window would evict it.
		const debits = Array.from({ length: 5 }, (_, i) => ({
			id: crypto.randomUUID(),
			networkId,
			delta: -10,
			reason: "debit",
			createdAt: new Date(Date.now() - i * 1000),
		}));
		await db.insert(aiCreditLedger).values(debits);
		const f = await userFocus("usr_focus_ai", from, to);
		expect(f.networks[0].grants.length).toBe(1);
		expect(f.networks[0].grants[0].reason).toBe("grant");
		// Documented contract only — no networkId/usageLogId leak.
		expect(Object.keys(f.networks[0].grants[0]).sort()).toEqual(
			["createdAt", "createdBy", "delta", "id", "note", "reason"],
		);
	});
});

describe("GET /api/v1/admin/ai/users/:userId", () => {
	it("serves the focus payload to admins", async () => {
		const res = await app.request("/api/v1/admin/ai/users/usr_focus_ai?from=2020-03-10T00:00:00Z&to=2020-03-13T00:00:00Z", {
			headers: { Cookie: `artisan_user_session=${adminSession}` },
		});
		expect(res.status).toBe(200);
		expect((await res.json()).totals.turns).toBe(2);
	});
});
