import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../../../db";
import {
	aiModels,
	aiUsageLog,
	assistantConversations,
	assistantMigrationEvents,
	networks,
	projects,
	serverKeys,
} from "../../../db/schema";
import { getBalance, grantCredits } from "../../ai/creditsRepo";
import { type AiModel, createModel } from "../../ai/modelRepo";
import { createConversation } from "../conversationRepo";
import { buildManifest, hashJsonValue } from "./manifest";
import {
	claimNextStep,
	completeStep,
	createRun,
	getEvents,
	getProposals,
	getRun,
	interruptStep,
	listRuns,
	recoverExpiredRun,
	renewLease,
	transitionRun,
} from "./repository";

const networkId = crypto.randomUUID();
const serverKeyId = crypto.randomUUID();
const projectId = crypto.randomUUID();
let conversationId: string;
let model: AiModel;
const ownerKey = "user:migration-repository-test";
function required<T>(value: T | null | undefined): T {
	if (value == null) throw new Error("Missing test value");
	return value;
}
const manifest = buildManifest(
	{ "server:zmenu/shop.yml": "size: 9\nname: Shop\nitems: {}" },
	{ existingTargetIds: [] },
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
	conversationId = await createConversation(ownerKey, projectId);
	model = await createModel({
		displayName: "migration-test",
		description: "",
		badge: "cheap",
		provider: "test",
		providerModelId: "test",
		creditsPerMInput: 1000,
		creditsPerMOutput: 1000,
		realUsdPerMInput: 0,
		realUsdPerMOutput: 0,
		isActive: true,
	});
	await grantCredits({ networkId, amount: 1000 });
});
afterAll(async () => {
	await db
		.delete(assistantConversations)
		.where(eq(assistantConversations.id, conversationId));
	await db.delete(networks).where(eq(networks.id, networkId));
	await db.delete(aiModels).where(eq(aiModels.id, model.id));
});
function input(requestId = crypto.randomUUID()) {
	return {
		conversationId,
		projectId,
		ownerKey,
		networkId,
		serverKeyId,
		modelId: model.id,
		requestId,
		requestHash: "same-request",
		manifest,
		budget: {
			maxCredits: 100,
			usedCredits: 0,
			contextTokens: 32000,
			maxOutputTokens: 4000,
		},
	};
}
describe("durable migration", () => {
	it.each([
		"invalid_tool:read_source:invalid_offset",
		"invalid_tool:secret:invalid_offset",
	])("persists only allowlisted tool diagnostics: %s", async (code) => {
		const run = await createRun(input());
		await transitionRun(run.id, run.revision, "start");
		const claim = required(await claimNextStep(run.id, "diagnostic"));
		await interruptStep({
			runId: run.id,
			stepId: claim.step.id,
			leaseToken: claim.leaseToken,
			code,
		});
		expect((await getEvents(run.id)).at(-1)?.code).toBe(
			code.includes(":secret:") ? "migration_error" : code,
		);
	});
	it("blocks a selection with no menu steps", async () => {
		const run = await createRun({
			...input(),
			manifest: { version: 1, hash: "empty", entries: [], issues: [] },
		});
		expect(run.status).toBe("blocked");
		expect(run.issues[0].code).toBe("no_menus_to_migrate");
	});
	it("cascades proposals, steps and events when their conversation is removed", async () => {
		const temporaryConversation = await createConversation(ownerKey, projectId);
		const run = await createRun({
			...input(),
			conversationId: temporaryConversation,
		});
		await transitionRun(run.id, 0, "start");
		await db
			.delete(assistantConversations)
			.where(eq(assistantConversations.id, temporaryConversation));
		expect(await getRun(run.id)).toBeNull();
		expect(await getEvents(run.id)).toHaveLength(0);
		expect(await getProposals(run.id)).toHaveLength(0);
	});
	it("retains last in-flight result after pause and completes instead of becoming stuck", async () => {
		const run = await createRun(input());
		await transitionRun(run.id, 0, "start");
		const claim = required(await claimNextStep(run.id, "worker"));
		await transitionRun(run.id, claim.run.revision, "pause");
		const menu = { id: claim.step.targetId };
		await completeStep({
			runId: run.id,
			stepId: claim.step.id,
			leaseToken: claim.leaseToken,
			proposal: {
				targetId: claim.step.targetId,
				baseHash: null,
				resultHash: hashJsonValue(menu),
				menu,
				issues: [],
			},
			usageInput: {
				networkId,
				model,
				usage: { inputTokens: 0, outputTokens: 0 },
				promptPreview: "",
			},
		});
		expect((await getRun(run.id))?.status).toBe("completed");
	});
	it("rolls back proposal and debit when the final checkpoint write fails", async () => {
		const run = await createRun(input());
		await transitionRun(run.id, 0, "start");
		const claim = required(await claimNextStep(run.id, "worker"));
		// Inject a checkpoint persistence conflict, after the debit would have been written.
		await db.insert(assistantMigrationEvents).values({
			runId: run.id,
			sequence: claim.run.revision + 1,
			type: "test-conflict",
			createdAt: new Date(),
		});
		const menu = { id: claim.step.targetId };
		const before = await getBalance(networkId);
		let failed = false;
		try {
			await completeStep({
				runId: run.id,
				stepId: claim.step.id,
				leaseToken: claim.leaseToken,
				proposal: {
					targetId: claim.step.targetId,
					baseHash: null,
					resultHash: hashJsonValue(menu),
					menu,
					issues: [],
				},
				usageInput: {
					networkId,
					model,
					usage: { inputTokens: 1000, outputTokens: 1000 },
					promptPreview: "",
				},
			});
		} catch {
			failed = true;
		}
		expect(failed).toBe(true);
		expect(await getBalance(networkId)).toBe(before);
		expect(await getProposals(run.id)).toHaveLength(0);
		expect((await getRun(run.id))?.steps[0].status).toBe("running");
	});
	it("records failed known usage once without debit or raw preview", async () => {
		const run = await createRun(input());
		await transitionRun(run.id, 0, "start");
		const claim = required(await claimNextStep(run.id, "worker"));
		const args = {
			runId: run.id,
			stepId: claim.step.id,
			leaseToken: claim.leaseToken,
			code: "provider_timeout",
			usageInput: {
				networkId,
				model,
				usage: { inputTokens: 1000, outputTokens: 1000 },
				promptPreview: "RAW_SOURCE_SECRET",
			},
		};
		const before = await getBalance(networkId);
		await interruptStep(args);
		await interruptStep(args);
		expect(await getBalance(networkId)).toBe(before);
		const logs = await db
			.select()
			.from(aiUsageLog)
			.where(
				eq(
					aiUsageLog.idempotencyKey,
					`migration-error:${claim.step.id}:${claim.leaseToken}`,
				),
			);
		expect(logs).toHaveLength(1);
		expect(logs[0].inputTokens).toBe(1000);
		expect(logs[0].promptPreview).toBe("zMenu migration");
		expect(logs[0].creditsCharged).toBe(0);
	});
	it("recovers a crashed dispatch with no step lease only after its grace period", async () => {
		const run = await createRun(input());
		const now = new Date();
		await transitionRun(run.id, 0, "start", now);
		await recoverExpiredRun(run.id, new Date(now.getTime() + 1000));
		expect((await getRun(run.id))?.status).toBe("running");
		await recoverExpiredRun(run.id, new Date(now.getTime() + 100_000));
		expect((await getRun(run.id))?.status).toBe("paused");
	});
	it("requires explicit resume after lease expiry and rejects the old worker", async () => {
		const run = await createRun(input());
		await transitionRun(run.id, 0, "start");
		const now = new Date();
		const old = required(await claimNextStep(run.id, "old", now));
		const expired = new Date(now.getTime() + 100_000);
		expect(await renewLease(run.id, old.step.id, old.leaseToken, expired)).toBe(
			false,
		);
		await recoverExpiredRun(run.id, expired);
		expect((await getRun(run.id))?.status).toBe("paused");
		expect(await claimNextStep(run.id, "new", expired)).toBeNull();
		const paused = required(await getRun(run.id));
		await transitionRun(run.id, paused.revision, "resume", expired);
		const next = required(await claimNextStep(run.id, "new", expired));
		expect(next.leaseToken).not.toBe(old.leaseToken);
		let failure = "";
		try {
			await interruptStep(
				{
					runId: run.id,
					stepId: old.step.id,
					leaseToken: old.leaseToken,
					code: "provider_timeout",
				},
				expired,
			);
		} catch (error) {
			failure = (error as Error).message;
		}
		expect(failure).toBe("lease_lost");
		await interruptStep(
			{
				runId: run.id,
				stepId: next.step.id,
				leaseToken: next.leaseToken,
				code: "provider_timeout",
			},
			expired,
		);
		expect((await getRun(run.id))?.steps[0].status).toBe("interrupted");
	});
	it("fences two workers and checkpoints a result and charge only once", async () => {
		const run = await createRun(input());
		await transitionRun(run.id, run.revision, "start");
		const claims = await Promise.all([
			claimNextStep(run.id, "worker-a"),
			claimNextStep(run.id, "worker-b"),
		]);
		expect(claims.filter(Boolean)).toHaveLength(1);
		const claim = required(claims.find(Boolean));
		const menu = { schema: "menu/v1", id: claim.step.targetId };
		const args = {
			runId: run.id,
			stepId: claim.step.id,
			leaseToken: claim.leaseToken,
			proposal: {
				targetId: claim.step.targetId,
				baseHash: null,
				resultHash: hashJsonValue(menu),
				menu,
				issues: [],
			},
			usageInput: {
				networkId,
				model,
				usage: { inputTokens: 1000, outputTokens: 1000 },
				promptPreview: "Migration",
			},
		};
		const before = await getBalance(networkId);
		const [a, b] = await Promise.all([completeStep(args), completeStep(args)]);
		expect(a.id).toBe(b.id);
		expect(await getBalance(networkId)).toBe(before - 2);
		expect(await getProposals(run.id)).toHaveLength(1);
		expect((await getRun(run.id))?.status).toBe("completed");
		expect(await claimNextStep(run.id, "worker-c")).toBeNull();
		const events = await getEvents(run.id, 0, 100);
		expect(events.map((e) => e.sequence)).toEqual([1, 2, 3]);
	});
	it("creates a metadata-only run and replays a request id without duplication", async () => {
		const args = input();
		const [a, b] = await Promise.all([createRun(args), createRun(args)]);
		expect(a.id).toBe(b.id);
		expect((await getRun(a.id))?.steps).toHaveLength(1);
		expect(
			(await listRuns(conversationId)).filter((r) => r.id === a.id),
		).toHaveLength(1);
		await expect(
			createRun({ ...args, requestHash: "different" }),
		).rejects.toThrow("request_conflict");
	});
});
