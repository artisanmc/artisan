import { afterAll, beforeAll, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../../../db";
import {
	aiModels,
	assistantConversations,
	memberships,
	networks,
	projects,
	serverKeys,
	users,
} from "../../../db/schema";
import { grantCredits } from "../../ai/creditsRepo";
import { createModel } from "../../ai/modelRepo";
import { createConversation } from "../conversationRepo";
import { claimNextStep, interruptStep } from "./repository";

test("compression is explicit, revision guarded, source checked and never dispatched by reads", async () => {
	const originalSource = state.source;
	let starts = 0;
	dependencies.startExecution = () => {
		starts++;
	};
	try {
		const created = await (await request("", "POST", body())).json();
		expect(created.run.budget.contextTokens).toBeNull();
		const started = await (
			await request(`/${created.run.id}/start`, "POST", {
				expectedRevision: created.run.revision,
			})
		).json();
		const claim = (await claimNextStep(started.run.id, "compression-test"))!;
		await interruptStep({
			runId: claim.run.id,
			stepId: claim.step.id,
			leaseToken: claim.leaseToken,
			code: "provider_context_full",
			continuation: {
				messages: [{ role: "user", content: "working notes" }],
				reads: {},
				issues: [],
				needsCompression: true,
			},
		});
		const paused = await (await request(`/${claim.run.id}`)).json();
		expect(paused.run.canCompress).toBe(true);
		expect(JSON.stringify(paused)).not.toContain("working notes");
		expect(starts).toBe(1);
		expect(
			(
				await request(`/${claim.run.id}/resume`, "POST", {
					expectedRevision: paused.run.revision,
				})
			).status,
		).toBe(422);
		const compressed = await request(`/${claim.run.id}/compress`, "POST", {
			expectedRevision: paused.run.revision,
		});
		expect(compressed.status).toBe(200);
		expect((await compressed.json()).run.compressing).toBe(true);
		expect(starts).toBe(2);
		expect(
			(
				await request(`/${claim.run.id}/compress`, "POST", {
					expectedRevision: paused.run.revision,
				})
			).status,
		).toBe(409);
		expect(starts).toBe(2);
		const next = (await claimNextStep(claim.run.id, "again"))!;
		await interruptStep({
			runId: next.run.id,
			stepId: next.step.id,
			leaseToken: next.leaseToken,
			code: "provider_timeout",
		});
		const retry = await (await request(`/${claim.run.id}`)).json();
		state.source += "\n# changed";
		expect(
			(
				await request(`/${claim.run.id}/compress`, "POST", {
					expectedRevision: retry.run.revision,
				})
			).status,
		).toBe(409);
		expect(starts).toBe(2);
	} finally {
		state.source = originalSource;
		dependencies.startExecution = undefined;
	}
});
import {
	type MigrationRouteDependencies,
	type MigrationRouteEnv,
	buildMigrationRouter,
} from "./routes";

const networkId = crypto.randomUUID();
const serverKeyId = crypto.randomUUID();
const projectId = crypto.randomUUID();
const userId = crypto.randomUUID();
let conversationId: string;
let modelId: string;
const state = {
	ownerKey: `user:${userId}`,
	source: "size: 9\nname: PRIVATE_RAW_SOURCE\nitems: {}",
	starts: 0,
};
const router = new Hono<MigrationRouteEnv>();
router.use("*", async (c, next) => {
	c.set("ownerKey", state.ownerKey);
	await next();
});
const dependencies: MigrationRouteDependencies = {
	modelAvailable: async () => true,
	readSources: async () => ({
		kind: "result",
		result: {
			type: "import_sources_read_result",
			request_id: "test",
			ok: true,
			files: [{ source_id: "z", path: "shop.yml", content: state.source }],
		},
	}),
};
router.route(
	"/conversations/:id/migrations",
	buildMigrationRouter(dependencies),
);
beforeAll(async () => {
	const now = new Date();
	await db
		.insert(networks)
		.values({ id: networkId, name: networkId, createdAt: now, updatedAt: now });
	await db
		.insert(serverKeys)
		.values({ id: serverKeyId, networkId, createdAt: now });
	await db.insert(projects).values({
		id: projectId,
		networkId,
		serverKeyId,
		name: projectId,
		createdAt: now,
		updatedAt: now,
	});
	await db.insert(users).values({
		id: userId,
		email: `${userId}@test.invalid`,
		name: "migration",
		createdAt: now,
		updatedAt: now,
	});
	await db.insert(memberships).values({
		id: crypto.randomUUID(),
		userId,
		networkId,
		role: "owner",
		createdAt: now,
	});
	conversationId = await createConversation(state.ownerKey, projectId);
	modelId = (
		await createModel({
			displayName: "migration-routes",
			description: "",
			badge: "cheap",
			provider: "test",
			providerModelId: "test",
			creditsPerMInput: 1000,
			creditsPerMOutput: 1000,
			realUsdPerMInput: 0,
			realUsdPerMOutput: 0,
			isActive: true,
		})
	).id;
	await grantCredits({ networkId, amount: 1000 });
});
afterAll(async () => {
	await db
		.delete(assistantConversations)
		.where(eq(assistantConversations.id, conversationId));
	await db.delete(networks).where(eq(networks.id, networkId));
	await db.delete(users).where(eq(users.id, userId));
	await db.delete(aiModels).where(eq(aiModels.id, modelId));
});
const body = () => ({
	requestId: crypto.randomUUID(),
	modelId,
	serverAttachments: [{ sourceId: "z", paths: ["shop.yml"] }],
	existingTargetIds: [],
});
const request = (path = "", method = "GET", value?: unknown) =>
	router.request(`/conversations/${conversationId}/migrations${path}`, {
		method,
		headers: { "Content-Type": "application/json" },
		...(value ? { body: JSON.stringify(value) } : {}),
	});

test("creates an unstarted metadata-only migration and replays its request ID", async () => {
	const input = body();
	const response = await request("", "POST", input);
	expect(response.status).toBe(201);
	const { run } = await response.json();
	expect(run.status).toBe("ready");
	expect(JSON.stringify(run)).not.toContain("PRIVATE_RAW_SOURCE");
	expect((await (await request("", "POST", input)).json()).run.id).toBe(run.id);
	expect(
		(
			await request(`/${run.id}/start`, "POST", {
				expectedRevision: run.revision,
			})
		).status,
	).toBe(503);
	expect((await (await request(`/${run.id}`)).json()).run.status).toBe("ready");
});

test("lets the AI read malformed source YAML without persisting it", async () => {
	state.source = "size: 9\nname: PRIVATE_RAW_SOURCE\nitems: [broken";
	try {
		const response = await request("", "POST", body());
		expect(response.status).toBe(201);
		const { run } = await response.json();
		expect(run.status).toBe("ready");
		expect(run.issues).toEqual([]);
		expect(run.manifest.agent.tasks).toBeUndefined();
		expect(JSON.stringify(run)).not.toContain("PRIVATE_RAW_SOURCE");
	} finally {
		state.source = "size: 9\nname: PRIVATE_RAW_SOURCE\nitems: {}";
	}
});

test("masks foreign conversations and denies revoked membership and deleted Projects", async () => {
	const input = body();
	const { run } = await (await request("", "POST", input)).json();
	state.ownerKey = "user:someone-else";
	expect((await request(`/${run.id}/proposals`)).status).toBe(404);
	state.ownerKey = `user:${userId}`;
	await db.delete(memberships).where(eq(memberships.userId, userId));
	expect((await request(`/${run.id}/events`)).status).toBe(403);
	await db.insert(memberships).values({
		id: crypto.randomUUID(),
		userId,
		networkId,
		role: "owner",
		createdAt: new Date(),
	});
	await db
		.update(projects)
		.set({ deletedAt: new Date() })
		.where(eq(projects.id, projectId));
	expect((await request(`/${run.id}`)).status).toBe(404);
	await db
		.update(projects)
		.set({ deletedAt: null })
		.where(eq(projects.id, projectId));
});

test("accepts analysis without a credit budget and validates context and request-ID reuse", async () => {
	expect((await request("", "POST", body())).status).toBe(201);
	expect(
		(await request("", "POST", { ...body(), contextTokens: -1 })).status,
	).toBe(422);
	const input = body();
	await request("", "POST", input);
	expect(
		(await request("", "POST", { ...input, contextTokens: 32000 })).status,
	).toBe(409);
	state.source = "commands: {shop: {inventory: shop}}";
	expect((await request("", "POST", body())).status).toBe(201);
	state.source = "size: 9\nname: PRIVATE_RAW_SOURCE\nitems: {}";
});

test("dispatches once after explicit start, keeps reads passive, and blocks changed sources", async () => {
	dependencies.startExecution = () => {
		state.starts++;
	};
	const { run } = await (await request("", "POST", body())).json();
	const start = await request(`/${run.id}/start`, "POST", {
		expectedRevision: run.revision,
	});
	expect(start.status).toBe(200);
	const running = (await start.json()).run;
	expect(state.starts).toBe(1);
	expect(
		(
			await request(`/${run.id}/start`, "POST", {
				expectedRevision: run.revision,
			})
		).status,
	).toBe(409);
	await request(`/${run.id}`);
	await request(`/${run.id}/events`);
	await request(`/${run.id}/proposals`);
	expect(state.starts).toBe(1);
	const paused = (
		await (
			await request(`/${run.id}/pause`, "POST", {
				expectedRevision: running.revision,
			})
		).json()
	).run;
	state.source = "size: 18\nname: CHANGED";
	const resumed = await request(`/${run.id}/resume`, "POST", {
		expectedRevision: paused.revision,
	});
	expect(resumed.status).toBe(409);
	expect((await resumed.json()).error).toBe("source_changed");
	expect(state.starts).toBe(1);
	state.source = "size: 9\nname: PRIVATE_RAW_SOURCE\nitems: {}";
	dependencies.startExecution = undefined;
});

test("Project server changes hide old runs from collections and reject request replay", async () => {
	const input = body();
	const { run } = await (await request("", "POST", input)).json();
	const otherServer = crypto.randomUUID();
	await db
		.insert(serverKeys)
		.values({ id: otherServer, networkId, createdAt: new Date() });
	await db
		.update(projects)
		.set({ serverKeyId: otherServer })
		.where(eq(projects.id, projectId));
	expect((await request(`/${run.id}`)).status).toBe(409);
	expect((await (await request()).json()).runs).toEqual([]);
	expect((await request("", "POST", input)).status).toBe(409);
	await db
		.update(projects)
		.set({ serverKeyId })
		.where(eq(projects.id, projectId));
});

test("cannot read or control a run through another conversation owned by the same user", async () => {
	const { run } = await (await request("", "POST", body())).json();
	const other = await createConversation(state.ownerKey, projectId);
	for (const suffix of ["", "/events", "/proposals"]) {
		const response = await router.request(
			`/conversations/${other}/migrations/${run.id}${suffix}`,
		);
		expect(response.status).toBe(404);
	}
	await db
		.delete(assistantConversations)
		.where(eq(assistantConversations.id, other));
});
