import { afterAll, beforeAll, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../../../db";
import {
	aiModels,
	aiUsageLog,
	assistantConversations,
	assistantMigrationSteps,
	memberships,
	networks,
	projects,
	serverKeys,
	users,
} from "../../../db/schema";
import { getBalance, grantCredits } from "../../ai/creditsRepo";
import { type AiModel, createModel } from "../../ai/modelRepo";
import { getAiSettings, putAiSettings } from "../../ai/settings";
import { createConversation } from "../conversationRepo";
import type { LlmProvider } from "../provider/types";
import type { ImportSourcesReadFn } from "../serverAttachments";
import { buildManifest } from "./manifest";
import {
	createRun,
	getEvents,
	getProposals,
	getRun,
	transitionRun,
} from "./repository";
import { executeMigration } from "./runner";
import OpenAI from "openai";

test("explicit compression is durable, billed once, and preserves source inspection across interruptions", async () => {
	const fileId = "server:z/home.yml";
	const sources = { [fileId]: "size: 9\nname: PRIVATE_COMPRESS_SOURCE" };
	const run = await newRun(sources, 100, true);
	let calls = 0;
	let summaries = 0;
	const provider: LlmProvider = {
		async *streamTurn(input) {
			calls++;
			if (!input.tools.length) {
				summaries++;
				yield {
					type: "text",
					text: "Convert server:z/home.yml into home, size 9, no dependencies.",
				};
			} else if (calls === 2)
				throw new OpenAI.APIError(
					400,
					{ code: "context_length_exceeded" },
					undefined,
					new Headers(),
				);
			else if (calls === 4)
				throw new OpenAI.APIConnectionError({
					message: "network interrupted after compression checkpoint",
				});
			else if (calls === 1 || calls === 6)
				yield {
					type: "tool_use",
					id: `read${calls}`,
					name: "read_source",
					input: { fileId },
				};
			else if (calls === 5) {
				expect(JSON.stringify(input.messages)).toContain(
					"Convert server:z/home.yml",
				);
				yield {
					type: "tool_use",
					id: "plan",
					name: "submit_plan",
					input: {
						menus: [
							{
								sourceFileId: fileId,
								targetId: "home",
								dependencyIds: [],
								instructions: "Convert home",
							},
						],
						files: [{ fileId, role: "menu", notes: "One menu" }],
					},
				};
			} else
				yield {
					type: "tool_use",
					id: "write",
					name: "upsert_menu",
					input: {
						menu: {
							schema: "menu/v1",
							id: "home",
							size: 9,
							title: [],
							layers: [{ id: "base", name: "base", elements: [] }],
						},
					},
				};
			yield { type: "usage", usage: { inputTokens: 100, outputTokens: 20 } };
			yield {
				type: "done",
				stopReason: input.tools.length ? "tool_calls" : "stop",
			};
		},
	};
	const deps = {
		providerFor: async () => provider,
		readSources: read(sources),
	};
	await executeMigration(run.id, deps);
	const paused = (await getRun(run.id))!;
	expect(paused.status).toBe("paused");
	expect(paused.canCompress).toBe(true);
	expect(summaries).toBe(0);
	const [saved] = await db
		.select()
		.from(assistantMigrationSteps)
		.where(eq(assistantMigrationSteps.runId, run.id));
	expect(JSON.stringify(saved)).not.toContain("PRIVATE_COMPRESS_SOURCE");
	await transitionRun(run.id, paused.revision, "compress");
	await executeMigration(run.id, deps);
	const interrupted = (await getRun(run.id))!;
	expect(interrupted.status).toBe("paused");
	expect(summaries).toBe(1);
	expect(interrupted.budget.usedCredits).toBeGreaterThan(0);
	await transitionRun(run.id, interrupted.revision, "resume");
	await executeMigration(run.id, deps);
	expect((await getRun(run.id))!.status).toBe("completed");
	expect(summaries).toBe(1);
	expect(await getProposals(run.id)).toHaveLength(1);
	expect(
		(await getEvents(run.id)).filter(
			(event) => event.type === "context_compressed",
		),
	).toHaveLength(1);
});

const networkId = crypto.randomUUID();
const serverKeyId = crypto.randomUUID();
const projectId = crypto.randomUUID();
const userId = crypto.randomUUID();
let conversationId: string;
let model: AiModel;
const attachments = Object.fromEntries(
	Array.from({ length: 35 }, (_, i) => [
		`server:z/m${i}.yml`,
		`size: 9\nname: RAW_${i}_PRIVATE\nitems:\n  next: {type: INVENTORY, inventory: m${(i + 1) % 35}}`,
	]),
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
	conversationId = await createConversation(`user:${userId}`, projectId);
	model = await createModel({
		displayName: "runner-test",
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
	await db.delete(users).where(eq(users.id, userId));
	await db.delete(aiModels).where(eq(aiModels.id, model.id));
});
async function newRun(
	sources = attachments,
	maxCredits = 100,
	agentic = false,
) {
	const run = await createRun({
		conversationId,
		projectId,
		ownerKey: `user:${userId}`,
		networkId,
		serverKeyId,
		modelId: model.id,
		requestId: crypto.randomUUID(),
		requestHash: crypto.randomUUID(),
		manifest: buildManifest(sources, { existingTargetIds: [], agentic }),
		budget: {
			maxCredits,
			usedCredits: 0,
			contextTokens: 64000,
			maxOutputTokens: 8000,
		},
	});
	return transitionRun(run.id, run.revision, "start");
}

test("checkpoints an AI plan and resumes conversions without rediscovering the sources", async () => {
	const fileId = "server:z/custom.yml";
	const sources = { [fileId]: "screens:\n  home: {}\n  store: {}" };
	const run = await newRun(sources, 100, true);
	let reads = 0;
	let planned = false;
	let interrupted = false;
	const provider: LlmProvider = {
		async *streamTurn(input) {
			if (input.tools.some((t) => t.name === "submit_plan")) {
				if (!reads++)
					yield {
						type: "tool_use",
						id: "read",
						name: "read_source",
						input: { fileId },
					};
				else {
					expect(planned).toBe(false);
					planned = true;
					yield {
						type: "tool_use",
						id: "plan",
						name: "submit_plan",
						input: {
							menus: ["home", "store"].map((targetId) => ({
								sourceFileId: fileId,
								targetId,
								instructions: `Convert screens.${targetId}`,
								dependencyIds: [],
							})),
							files: [{ fileId, role: "menu", notes: "Two custom screens." }],
						},
					};
				}
			} else {
				if (!interrupted) {
					interrupted = true;
					throw new Error("interrupted");
				}
				const targetId = JSON.parse(input.messages[1].content ?? "{}").targetId;
				if (input.messages.length === 2)
					yield {
						type: "tool_use",
						id: "read",
						name: "read_source",
						input: { fileId },
					};
				else
					yield {
						type: "tool_use",
						id: "write",
						name: "upsert_menu",
						input: {
							menu: {
								schema: "menu/v1",
								id: targetId,
								title: [],
								size: 9,
								layers: [{ id: "base", name: "base", elements: [] }],
							},
						},
					};
			}
			yield { type: "usage", usage: { inputTokens: 100, outputTokens: 20 } };
			yield { type: "done", stopReason: "tool_calls" };
		},
	};
	await executeMigration(run.id, {
		providerFor: async () => provider,
		readSources: read(sources),
	});
	const paused = await getRun(run.id);
	expect(paused?.status).toBe("paused");
	expect(paused?.manifest.agent?.tasks?.length).toBe(2);
	expect(paused?.steps[0].status).toBe("completed");
	await transitionRun(run.id, paused!.revision, "resume");
	await executeMigration(run.id, {
		providerFor: async () => provider,
		readSources: read(sources),
	});
	expect((await getRun(run.id))?.status).toBe("completed");
	expect((await getProposals(run.id)).map((p) => p.targetId).sort()).toEqual([
		"home",
		"store",
	]);
	expect(reads).toBe(2);
});

function read(sources: Record<string, string>): ImportSourcesReadFn {
	return async () => ({
		kind: "result",
		result: {
			type: "import_sources_read_result",
			request_id: "test",
			ok: true,
			files: Object.entries(sources).map(([fileId, content]) => ({
				source_id: "z",
				path: fileId.slice("server:z/".length),
				content,
			})),
		},
	});
}
function validMenu(id: string) {
	return {
		schema: "menu/v1",
		id,
		title: [],
		size: 9,
		layers: [
			{
				id: "base",
				name: "base",
				elements: [{ id: "stone", positions: "0", material: "STONE" }],
			},
		],
	};
}
const twoMenus = {
	"server:z/a.yml": "size: 9\nname: A\nitems: {}",
	"server:z/b.yml": "size: 9\nname: B\nitems: {}",
};

test("the agent explores 35 linked files then generates every menu with bounded source reads", async () => {
	const run = await newRun(attachments, 100, true);
	const ids = Object.keys(attachments);
	let offset = 0;
	const provider: LlmProvider = {
		async *streamTurn(input) {
			if (input.tools.some((t) => t.name === "submit_plan")) {
				if (offset < ids.length) {
					for (const fileId of ids.slice(offset))
						yield {
							type: "tool_use",
							id: fileId,
							name: "read_source",
							input: { fileId },
						};
					offset = ids.length;
				} else
					yield {
						type: "tool_use",
						id: "plan",
						name: "submit_plan",
						input: {
							menus: ids.map((sourceFileId, i) => ({
								sourceFileId,
								targetId: `m${i}`,
								instructions: `Convert m${i}, retaining the next-menu link.`,
								dependencyIds: [ids[(i + 1) % ids.length]],
							})),
							files: ids.map((fileId) => ({
								fileId,
								role: "menu",
								notes: "Menu with a link to the next screen.",
							})),
						},
					};
			} else {
				const context = JSON.parse(input.messages[1].content ?? "{}");
				if (input.messages.length === 2)
					yield {
						type: "tool_use",
						id: "read",
						name: "read_source",
						input: { fileId: context.task.sourceFileId },
					};
				else {
					const menu = validMenu(context.targetId);
					const next = `m${(Number(context.targetId.slice(1)) + 1) % 35}`;
					yield {
						type: "tool_use",
						id: "write",
						name: "upsert_menu",
						input: {
							menu: {
								...menu,
								layers: [
									{
										...menu.layers[0],
										elements: [
											{
												id: "next",
												material: "STONE",
												positions: "0",
												click: { left: { steps: `open_menu ${next}` } },
											},
										],
									},
								],
							},
						},
					};
				}
			}
			yield { type: "usage", usage: { inputTokens: 100, outputTokens: 30 } };
			yield { type: "done", stopReason: "tool_calls" };
		},
	};
	await executeMigration(run.id, {
		providerFor: async () => provider,
		readSources: read(attachments),
	});
	expect((await getRun(run.id))?.status).toBe("completed");
	expect(await getProposals(run.id)).toHaveLength(35);
	expect((await getRun(run.id))?.steps).toHaveLength(36);
}, 20_000);

test("pause waits for the in-flight result without starting another menu", async () => {
	const run = await newRun(twoMenus);
	let calls = 0;
	const provider: LlmProvider = {
		async *streamTurn(input) {
			calls++;
			const latest = await getRun(run.id);
			if (!latest) throw new Error("missing run");
			await transitionRun(run.id, latest.revision, "pause");
			const { targetId } = JSON.parse(input.messages[1].content ?? "{}");
			yield { type: "usage", usage: { inputTokens: 500, outputTokens: 500 } };
			yield {
				type: "tool_use",
				id: "one",
				name: "upsert_menu",
				input: { menu: validMenu(targetId) },
			};
			yield { type: "done", stopReason: "tool_calls" };
		},
	};
	await executeMigration(run.id, {
		providerFor: async () => provider,
		readSources: read(twoMenus),
	});
	expect(calls).toBe(1);
	expect(await getProposals(run.id)).toHaveLength(1);
	expect((await getRun(run.id))?.status).toBe("paused");
});

test("the active per-turn setting prevents another provider iteration", async () => {
	const previous = await getAiSettings();
	await putAiSettings({ maxCreditsPerTurn: 1 }, null);
	try {
		const run = await newRun(twoMenus);
		const before = await getBalance(networkId);
		let calls = 0;
		const provider: LlmProvider = {
			async *streamTurn() {
				calls++;
				yield { type: "usage", usage: { inputTokens: 500, outputTokens: 500 } };
				yield {
					type: "tool_use",
					id: "read",
					name: "read_source",
					input: { fileId: "server:z/b.yml" },
				};
				yield { type: "done", stopReason: "tool_calls" };
			},
		};
		await executeMigration(run.id, {
			providerFor: async () => provider,
			readSources: read(twoMenus),
		});
		expect(calls).toBe(1);
		expect(await getProposals(run.id)).toHaveLength(0);
		expect(await getBalance(networkId)).toBe(before);
		expect((await getEvents(run.id)).at(-1)?.code).toBe("step_budget_exceeded");
	} finally {
		await putAiSettings(previous, null);
	}
});

test("streaming reasoning keeps a migration alive beyond its inactivity deadline", async () => {
	const run = await newRun(twoMenus);
	const provider: LlmProvider = {
		async *streamTurn(input) {
			for (let i = 0; i < 8; i++) {
				await new Promise((resolve) => setTimeout(resolve, 50));
				input.signal?.throwIfAborted();
				yield { type: "reasoning", text: "Working" };
			}
			const { targetId } = JSON.parse(input.messages[1].content ?? "{}");
			yield {
				type: "tool_use",
				id: "write",
				name: "upsert_menu",
				input: { menu: validMenu(targetId) },
			};
			yield { type: "usage", usage: { inputTokens: 100, outputTokens: 20 } };
			yield { type: "done", stopReason: "tool_calls" };
		},
	};
	await executeMigration(run.id, {
		providerFor: async () => provider,
		readSources: read(twoMenus),
		stepTimeoutMs: 200,
	});
	expect((await getRun(run.id))?.status).toBe("completed");
	expect(await getProposals(run.id)).toHaveLength(2);
});

test("a silent provider times out and releases monitoring without a paid retry", async () => {
	const run = await newRun(twoMenus);
	let calls = 0;
	const provider: LlmProvider = {
		async *streamTurn(input) {
			calls++;
			await new Promise<void>((_resolve, reject) => {
				if (input.signal?.aborted) reject(input.signal.reason);
				else
					input.signal?.addEventListener(
						"abort",
						() => reject(input.signal?.reason),
						{
							once: true,
						},
					);
			});
		},
	};
	await executeMigration(run.id, {
		providerFor: async () => provider,
		readSources: read(twoMenus),
		stepTimeoutMs: 1000,
		leaseIntervalMs: 50,
	});
	expect(calls).toBe(1);
	expect(await getProposals(run.id)).toHaveLength(0);
	expect((await getRun(run.id))?.status).toBe("paused");
	expect((await getEvents(run.id)).at(-1)?.code).toBe("provider_timeout");
});

test("a source changed between steps pauses before the next paid call", async () => {
	const sources = { ...twoMenus };
	const run = await newRun(sources);
	let calls = 0;
	const provider: LlmProvider = {
		async *streamTurn(input) {
			calls++;
			const { targetId } = JSON.parse(input.messages[1].content ?? "{}");
			sources["server:z/b.yml"] += "\n# Changed externally";
			yield { type: "usage", usage: { inputTokens: 500, outputTokens: 500 } };
			yield {
				type: "tool_use",
				id: "one",
				name: "upsert_menu",
				input: { menu: validMenu(targetId) },
			};
			yield { type: "done", stopReason: "tool_calls" };
		},
	};
	await executeMigration(run.id, {
		providerFor: async () => provider,
		readSources: read(sources),
	});
	expect(calls).toBe(1);
	expect(await getProposals(run.id)).toHaveLength(1);
	expect((await getRun(run.id))?.status).toBe("paused");
	expect((await getEvents(run.id)).at(-1)?.code).toBe("source_changed");
});

test("a valid proposal without provider usage is not checkpointed or billed", async () => {
	const run = await newRun(twoMenus);
	const before = await getBalance(networkId);
	const provider: LlmProvider = {
		async *streamTurn(input) {
			const { targetId } = JSON.parse(input.messages[1].content ?? "{}");
			yield {
				type: "tool_use",
				id: "one",
				name: "upsert_menu",
				input: { menu: validMenu(targetId) },
			};
			yield { type: "done", stopReason: "tool_calls" };
		},
	};
	await executeMigration(run.id, {
		providerFor: async () => provider,
		readSources: read(twoMenus),
	});
	expect(await getProposals(run.id)).toHaveLength(0);
	expect(await getBalance(networkId)).toBe(before);
	expect((await getEvents(run.id)).at(-1)?.code).toBe("provider_error");
});

test("legacy migration credit caps no longer stop progress while network credits remain", async () => {
	const run = await newRun(twoMenus, 1);
	let calls = 0;
	const provider: LlmProvider = {
		async *streamTurn(input) {
			calls++;
			const { targetId } = JSON.parse(input.messages[1].content ?? "{}");
			yield { type: "usage", usage: { inputTokens: 500, outputTokens: 500 } };
			yield {
				type: "tool_use",
				id: "one",
				name: "upsert_menu",
				input: { menu: validMenu(targetId) },
			};
			yield { type: "done", stopReason: "tool_calls" };
		},
	};
	await executeMigration(run.id, {
		providerFor: async () => provider,
		readSources: read(twoMenus),
	});
	expect(calls).toBe(2);
	expect(await getProposals(run.id)).toHaveLength(2);
	expect((await getRun(run.id))?.status).toBe("completed");
	expect((await getRun(run.id))?.budget.usedCredits).toBe(2);
});

test("lease loss aborts the old worker without checkpoint or debit on behalf of a new owner", async () => {
	const run = await newRun(twoMenus);
	const before = await getBalance(networkId);
	const provider: LlmProvider = {
		async *streamTurn(input) {
			const { targetId } = JSON.parse(input.messages[1].content ?? "{}");
			await db
				.update(assistantMigrationSteps)
				.set({ leaseToken: "another-worker" })
				.where(eq(assistantMigrationSteps.runId, run.id));
			await new Promise((resolve) => setTimeout(resolve, 80));
			yield { type: "usage", usage: { inputTokens: 500, outputTokens: 500 } };
			yield {
				type: "tool_use",
				id: "one",
				name: "upsert_menu",
				input: { menu: validMenu(targetId) },
			};
			yield { type: "done", stopReason: "tool_calls" };
		},
	};
	await executeMigration(run.id, {
		providerFor: async () => provider,
		readSources: read(twoMenus),
		leaseIntervalMs: 10,
	});
	expect(await getProposals(run.id)).toHaveLength(0);
	expect(await getBalance(networkId)).toBe(before);
	expect((await getRun(run.id))?.steps[0].status).toBe("running");
});

test("revoked access during conversion cannot checkpoint a proposal or debit credits", async () => {
	const sources = { "server:z/only.yml": "size: 9\nname: Only\nitems: {}" };
	const run = await newRun(sources);
	const before = await getBalance(networkId);
	const provider: LlmProvider = {
		async *streamTurn() {
			await db.delete(memberships).where(eq(memberships.userId, userId));
			yield { type: "usage", usage: { inputTokens: 500, outputTokens: 500 } };
			yield {
				type: "tool_use",
				id: "one",
				name: "upsert_menu",
				input: {
					menu: {
						schema: "menu/v1",
						id: "only",
						title: [],
						size: 9,
						layers: [
							{
								id: "base",
								name: "base",
								elements: [{ id: "stone", positions: "0", material: "STONE" }],
							},
						],
					},
				},
			};
			yield { type: "done", stopReason: "tool_calls" };
		},
	};
	try {
		await executeMigration(run.id, {
			providerFor: async () => provider,
			readSources: async () => ({
				kind: "result",
				result: {
					type: "import_sources_read_result",
					request_id: "test",
					ok: true,
					files: [
						{
							source_id: "z",
							path: "only.yml",
							content: sources["server:z/only.yml"],
						},
					],
				},
			}),
		});
		expect(await getProposals(run.id)).toHaveLength(0);
		expect(await getBalance(networkId)).toBe(before);
		expect((await getRun(run.id))?.status).toBe("paused");
	} finally {
		await db.insert(memberships).values({
			id: crypto.randomUUID(),
			userId,
			networkId,
			role: "owner",
			createdAt: new Date(),
		});
	}
});

test("35 cyclic menus checkpoint without a transport reader and resume after seven without regenerated or double-billed results", async () => {
	const run = await newRun();
	const generated: string[] = [];
	let failOnce = true;
	const provider: LlmProvider = {
		async *streamTurn(input) {
			const payload = JSON.parse(input.messages[1].content ?? "{}");
			const id = payload.targetId as string;
			expect(payload.sources).toHaveLength(1);
			expect(input.maxRetries).toBe(0);
			if (generated.length === 7 && failOnce) {
				failOnce = false;
				yield { type: "usage", usage: { inputTokens: 500, outputTokens: 500 } };
				throw new Error("RAW_PROVIDER_SECRET");
			}
			generated.push(id);
			yield { type: "usage", usage: { inputTokens: 500, outputTokens: 500 } };
			yield {
				type: "tool_use",
				id: "result",
				name: "upsert_menu",
				input: {
					menu: {
						schema: "menu/v1",
						id,
						title: [],
						size: 9,
						layers: [
							{
								id: "base",
								name: "base",
								elements: [
									{
										id: "next",
										positions: "0",
										material: "STONE",
										click: {
											left: {
												steps: `open_menu m${(Number(id.slice(1)) + 1) % 35}`,
											},
										},
									},
								],
							},
						],
					},
				},
			};
			yield { type: "done", stopReason: "tool_calls" };
		},
	};
	const dependencies = {
		providerFor: async () => provider,
		readSources: async () => ({
			kind: "result" as const,
			result: {
				type: "import_sources_read_result" as const,
				request_id: "test",
				ok: true,
				files: Object.entries(attachments).map(([fileId, content]) => ({
					source_id: "z",
					path: fileId.slice("server:z/".length),
					content,
				})),
			},
		}),
	};
	const balance = await getBalance(networkId);
	await executeMigration(run.id, dependencies);
	const paused = await getRun(run.id);
	expect(paused?.status).toBe("paused");
	expect(await getProposals(run.id)).toHaveLength(7);
	const logs = await db
		.select()
		.from(aiUsageLog)
		.where(eq(aiUsageLog.conversationId, conversationId));
	expect(
		logs.some(
			(log) =>
				log.status === "error" &&
				log.errorMessage === "engine_error" &&
				log.creditsCharged === 0,
		),
	).toBe(true);
	expect(JSON.stringify(await getEvents(run.id))).not.toContain(
		"RAW_PROVIDER_SECRET",
	);
	if (!paused) throw new Error("missing run");
	await transitionRun(run.id, paused.revision, "resume");
	await executeMigration(run.id, dependencies);
	expect((await getRun(run.id))?.status).toBe("completed");
	expect(generated).toHaveLength(35);
	expect(new Set(generated).size).toBe(35);
	expect(await getProposals(run.id)).toHaveLength(35);
	expect(balance - (await getBalance(networkId))).toBe(35);
}, 30000);
