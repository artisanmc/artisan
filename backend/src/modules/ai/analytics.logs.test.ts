import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { app } from "../../app";
import { db } from "../../db/index";
import { aiUsageLog, networks, users } from "../../db/schema";
import { createNetwork } from "../../lib/networkManager";
import { createSession } from "../../lib/sessionManager";
import { listUsageLogs } from "./analytics";

const ADMIN_ID = "user_admin_ailogs";
let adminSession = "";
let networkId = "";

function row(over: Partial<typeof aiUsageLog.$inferInsert>): typeof aiUsageLog.$inferInsert {
	return {
		id: crypto.randomUUID(), networkId, userId: null, serverKeyId: null,
		modelId: null, modelName: "M1", provider: "openai", providerModelId: "m1",
		actionType: "chat", conversationId: null,
		inputTokens: 1000, outputTokens: 100, cachedInputTokens: 0,
		creditsCharged: 10, realCostMicroUsd: 5000, durationMs: 100,
		status: "success", errorMessage: null, promptPreview: "",
		createdAt: new Date("2020-02-10T10:00:00Z"),
		...over,
	};
}

beforeAll(async () => {
	const now = new Date();
	await db.insert(users).values({ id: ADMIN_ID, email: `${ADMIN_ID}@example.com`, name: "A", isAdmin: true, createdAt: now, updatedAt: now }).onConflictDoNothing();
	adminSession = (await createSession(ADMIN_ID)).id;
	networkId = (await createNetwork("ailogs-net")).id;
	// userId reste null partout (FK users.id) — les filtres testés ici sont
	// provider/status ; le filtre userId est couvert par analytics.user.test.ts.
	await db.insert(aiUsageLog).values([
		row({ createdAt: new Date("2020-02-10T10:00:00Z") }),
		row({ provider: "anthropic", createdAt: new Date("2020-02-10T10:01:00Z") }),
		row({ provider: "anthropic", status: "error", creditsCharged: 0, createdAt: new Date("2020-02-10T10:02:00Z") }),
		row({ createdAt: new Date("2020-02-10T10:03:00Z") }),
		row({ createdAt: new Date("2020-02-10T10:04:00Z") }),
	]);
});

afterAll(async () => {
	await db.delete(aiUsageLog).where(eq(aiUsageLog.networkId, networkId));
	await db.delete(networks).where(eq(networks.id, networkId));
	await db.delete(users).where(eq(users.id, ADMIN_ID));
});

describe("listUsageLogs", () => {
	it("filters by provider + status", async () => {
		const { logs } = await listUsageLogs({
			provider: "anthropic", status: "success",
			from: new Date("2020-02-10T00:00:00Z"), to: new Date("2020-02-11T00:00:00Z"),
		});
		expect(logs.every((l) => l.provider === "anthropic" && l.status === "success")).toBe(true);
	});

	it("paginates with a stable cursor (createdAt desc, id desc)", async () => {
		const page1 = await listUsageLogs(
			{ from: new Date("2020-02-10T00:00:00Z"), to: new Date("2020-02-11T00:00:00Z") },
			undefined, 2
		);
		expect(page1.logs.length).toBe(2);
		expect(page1.nextCursor).toBeTruthy();
		const page2 = await listUsageLogs(
			{ from: new Date("2020-02-10T00:00:00Z"), to: new Date("2020-02-11T00:00:00Z") },
			page1.nextCursor as string, 2
		);
		const ids1 = page1.logs.map((l) => l.id);
		expect(page2.logs.every((l) => !ids1.includes(l.id))).toBe(true);
		// newest first
		expect(page1.logs[0].createdAt > page1.logs[1].createdAt).toBe(true);
	});
});

describe("GET /api/v1/admin/ai/usage/logs", () => {
	it("serves filtered logs", async () => {
		const res = await app.request("/api/v1/admin/ai/usage/logs?status=error&from=2020-02-10T00:00:00Z&to=2020-02-11T00:00:00Z", {
			headers: { Cookie: `artisan_user_session=${adminSession}` },
		});
		expect(res.status).toBe(200);
		const { logs } = await res.json();
		expect(logs.every((l: { status: string }) => l.status === "error")).toBe(true);
	});

	it("format=csv returns an attachment with a header row", async () => {
		const res = await app.request("/api/v1/admin/ai/usage/logs?format=csv&from=2020-02-10T00:00:00Z&to=2020-02-11T00:00:00Z", {
			headers: { Cookie: `artisan_user_session=${adminSession}` },
		});
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toContain("text/csv");
		expect(res.headers.get("content-disposition")).toContain("ai-usage.csv");
		const csv = await res.text();
		expect(csv.split("\n")[0]).toBe(
			"id,createdAt,networkId,userId,serverKeyId,modelName,provider,providerModelId,actionType,status,inputTokens,outputTokens,cachedInputTokens,creditsCharged,realCostMicroUsd,durationMs,errorMessage,promptPreview",
		);
	});
});
