import { expect, test } from "bun:test";
import { buildManifest } from "./manifest";
import {
	agentLoop,
	discoverMigration,
	sourceTools,
	validateAgentPlan,
} from "./agent";
import { convertAgentTask } from "./planner";
import type { LlmProvider } from "../provider/types";
import OpenAI from "openai";
import { MigrationPausedError } from "./continuation";

test("context rejection saves replayable state and only explicit compression summarizes before resuming", async () => {
	const fileId = "server:x/a.yml";
	const attachments = { [fileId]: "PRIVATE_SOURCE: size 9" };
	const manifest = buildManifest(attachments, {
		existingTargetIds: [],
		agentic: true,
	});
	let calls = 0;
	let summaries = 0;
	const provider: LlmProvider = {
		async *streamTurn(input) {
			calls++;
			if (input.tools.length) expect(input.maxOutputTokens).toBeUndefined();
			if (!input.tools.length) {
				summaries++;
				expect(JSON.stringify(input.messages)).toContain("PRIVATE_SOURCE");
				yield {
					type: "text",
					text: "One menu home from server:x/a.yml, size 9. No dependencies. Read the original again if needed.",
				};
			} else if (calls === 1) {
				yield {
					type: "tool_use",
					id: "read",
					name: "read_source",
					input: { fileId },
				};
			} else if (summaries === 0) {
				throw new OpenAI.APIError(
					400,
					{ code: "context_length_exceeded" },
					undefined,
					new Headers(),
				);
			} else {
				expect(JSON.stringify(input.messages)).toContain("One menu home");
				yield {
					type: "tool_use",
					id: "plan",
					name: "submit_plan",
					input: {
						menus: [
							{
								sourceFileId: fileId,
								targetId: "home",
								instructions: "Convert home",
								dependencyIds: [],
							},
						],
						files: [{ fileId, role: "menu", notes: "One menu" }],
					},
				};
			}
			yield { type: "usage", usage: { inputTokens: 100, outputTokens: 20 } };
			yield {
				type: "done",
				stopReason: input.tools.length ? "tool_calls" : "stop",
			};
		},
	};
	const input = {
		provider,
		model: "test",
		manifest,
		attachments,
		contextTokens: 64000,
		maxOutputTokens: 8000,
		signal: new AbortController().signal,
		canCall: () => true,
		onUsage: () => {},
	};
	let failure: MigrationPausedError | undefined;
	try {
		await discoverMigration(input);
	} catch (error) {
		if (error instanceof MigrationPausedError) failure = error;
		else throw error;
	}
	expect(failure?.code).toBe("provider_context_full");
	expect(calls).toBe(2);
	expect(summaries).toBe(0);
	expect(JSON.stringify(failure!.continuation)).not.toContain("PRIVATE_SOURCE");
	let checkpointed = false;
	const result = await discoverMigration({
		...input,
		continuation: { ...failure!.continuation, compact: true },
		onCompacted: async () => {
			checkpointed = true;
		},
	});
	expect(checkpointed).toBe(true);
	expect(summaries).toBe(1);
	expect(result.agent?.tasks?.[0].targetId).toBe("home");
});

test("sends large context intact to the provider without enforcing the legacy local budget", async () => {
	const attachments = { "server:x/a.yml": "size: 9" };
	const manifest = buildManifest(attachments, {
		existingTargetIds: [],
		agentic: true,
	});
	const content = "source detail ".repeat(15000);
	let calls = 0;
	const result = await agentLoop(
		{
			provider: {
				async *streamTurn(input) {
					calls++;
					expect(JSON.stringify(input.messages)).toContain(content);
					yield { type: "tool_use", id: "done", name: "finish", input: {} };
					yield { type: "done", stopReason: "tool_calls" };
				},
			},
			model: "test",
			manifest,
			attachments,
			contextTokens: 4096,
			maxOutputTokens: 8000,
			signal: new AbortController().signal,
			canCall: () => true,
			onUsage: () => {},
		},
		[
			{ role: "system", content: "migrate" },
			{ role: "user", content },
		],
		[],
		() => ({ content: "done", result: true }),
		1,
	);
	expect(result).toBe(true);
	expect(calls).toBe(1);
});

test("conversion keeps 35 detailed interdependent plans accessible without stuffing every plan into context", async () => {
	const attachments = Object.fromEntries(
		Array.from({ length: 35 }, (_, i) => [`server:x/menu${i}.yml`, "size: 9"]),
	);
	const manifest = buildManifest(attachments, {
		existingTargetIds: [],
		agentic: true,
	});
	const ids = Object.keys(attachments);
	manifest.agent!.tasks = ids.map((sourceFileId, i) => ({
		sourceFileId,
		targetId: `menu${i}`,
		instructions: "Instruction ".repeat(160),
		dependencyIds: ids,
	}));
	manifest.agent!.reports = ids.map((fileId) => ({
		fileId,
		role: "menu",
		notes: "Observation ".repeat(160),
	}));
	let calls = 0;
	const provider: LlmProvider = {
		async *streamTurn(input) {
			calls++;
			expect(
				Buffer.byteLength(JSON.stringify(input.messages)) +
					Buffer.byteLength(JSON.stringify(input.tools)) +
					8256,
			).toBeLessThanOrEqual(64000);
			if (calls === 1) {
				yield {
					type: "tool_use",
					id: "plan",
					name: "read_migration_plan",
					input: { fileId: ids[34], targetId: "menu34" },
				};
			} else if (calls === 2) {
				const last = input.messages.at(-1)!;
				expect(last.content).toContain(manifest.agent!.tasks![34].instructions);
				expect(last.content).toContain(manifest.agent!.reports![34].notes);
				yield {
					type: "tool_use",
					id: "read",
					name: "read_source",
					input: { fileId: ids[0] },
				};
			} else {
				yield {
					type: "tool_use",
					id: "write",
					name: "upsert_menu",
					input: {
						menu: {
							schema: "menu/v1",
							id: "menu0",
							title: [],
							size: 9,
							layers: [{ id: "base", name: "base", elements: [] }],
						},
					},
				};
			}
			yield { type: "done", stopReason: "tool_calls" };
		},
	};
	const result = await convertAgentTask({
		provider,
		model: "test",
		manifest,
		attachments,
		sourceFileId: ids[0],
		targetId: "menu0",
		contextTokens: 64000,
		maxOutputTokens: 8000,
		signal: new AbortController().signal,
		onUsage: () => {},
		canCall: () => true,
	});
	expect(result.menu.id).toBe("menu0");
	expect(calls).toBe(3);
});

test("oversized tool batches stop with a specific code before executing any action", async () => {
	const attachments = { "server:x/a.yml": "size: 9" };
	const manifest = buildManifest(attachments, {
		existingTargetIds: [],
		agentic: true,
	});
	let executed = 0;
	const provider: LlmProvider = {
		async *streamTurn() {
			for (let i = 0; i < 257; i++)
				yield {
					type: "tool_use",
					id: String(i),
					name: "read_source",
					input: { fileId: "server:x/a.yml" },
				};
			yield { type: "done", stopReason: "tool_calls" };
		},
	};
	await expect(
		agentLoop(
			{
				provider,
				model: "test",
				manifest,
				attachments,
				contextTokens: 64000,
				maxOutputTokens: 4000,
				signal: new AbortController().signal,
				canCall: () => true,
				onUsage: () => {},
			},
			[],
			[],
			() => {
				executed++;
				return { content: "read" };
			},
			2,
		),
	).rejects.toThrow("tool_batch_limit");
	expect(executed).toBe(0);
});

test("inventories arbitrary text formats without deciding what constitutes a menu", () => {
	const manifest = buildManifest(
		{
			"server:custom/screens.json": '{"screens":{"home":{},"shop":{}}}',
			"server:custom/settings.conf": "broken: [syntax",
		},
		{ existingTargetIds: ["home"], agentic: true },
	);
	expect(manifest.issues).toEqual([]);
	expect(manifest.entries.every((e) => e.targetId === null)).toBe(true);
	expect(manifest.agent?.existingTargetIds).toEqual(["home"]);
	expect(manifest.agent?.tasks).toBeUndefined();
});

test("source tools cannot read outside the selection and searches stay bounded", () => {
	const attachments = { "server:x/a.json": "dependency ".repeat(5000) };
	const manifest = buildManifest(attachments, {
		existingTargetIds: [],
		agentic: true,
	});
	const tools = sourceTools({ manifest, attachments });
	expect(() =>
		tools.execute("read_source", { fileId: "server:x/secrets.yml" }),
	).toThrow("invalid_tool");
	expect(() =>
		tools.execute("read_reference", { name: "../../secrets" }),
	).toThrow("invalid_tool");
	expect(
		JSON.parse(tools.execute("search_sources", { query: "dependency" }))
			.matches,
	).toHaveLength(40);
	const first = JSON.parse(
		tools.execute("read_source", { fileId: "server:x/a.json" }),
	);
	expect(first.content.length).toBe(12000);
	expect(first.nextOffset).toBe(12000);
	expect(tools.isFullyRead("server:x/a.json")).toBe(false);
	for (
		let offset = 12000;
		offset < attachments["server:x/a.json"].length;
		offset += 12000
	)
		tools.execute("read_source", { fileId: "server:x/a.json", offset });
	expect(tools.isFullyRead("server:x/a.json")).toBe(true);
});

test("source pages bound encoded bytes, preserving Unicode and escaped content across pages", () => {
	const fileId = "server:x/large.yml";
	const raw = '漢字😀"\\\n'.repeat(5000);
	const attachments = { [fileId]: raw };
	const manifest = buildManifest(attachments, {
		existingTargetIds: [],
		agentic: true,
	});
	const tools = sourceTools({ manifest, attachments });
	let offset: number | null = 0;
	let reconstructed = "";
	do {
		const content = tools.execute("read_source", { fileId, offset });
		expect(Buffer.byteLength(JSON.stringify(content))).toBeLessThan(12500);
		const page = JSON.parse(content);
		expect(page.content.length).toBeGreaterThan(0);
		reconstructed += page.content;
		offset = page.nextOffset;
	} while (offset !== null);
	expect(reconstructed).toBe(raw);
	expect(tools.isFullyRead(fileId)).toBe(true);
});

test("planning rejects unread or omitted files, collisions and unselected dependencies", () => {
	const fileId = "server:x/custom.yml";
	const manifest = buildManifest(
		{ [fileId]: "screens: []" },
		{ existingTargetIds: ["existing"], agentic: true },
	);
	const task = {
		sourceFileId: fileId,
		targetId: "home",
		instructions: "Convert home",
		dependencyIds: [],
	};
	const plan = {
		menus: [task],
		files: [{ fileId, role: "menu", notes: "One screen" }],
	};
	expect(() => validateAgentPlan(manifest, plan, new Set())).toThrow(
		"invalid_plan",
	);
	for (const invalid of [
		{ ...plan, files: [] },
		{ ...plan, menus: [task, task] },
		{ ...plan, menus: [{ ...task, targetId: "existing" }] },
		{ ...plan, menus: [{ ...task, dependencyIds: ["server:x/private.yml"] }] },
	])
		expect(() =>
			validateAgentPlan(manifest, invalid, new Set([fileId])),
		).toThrow("invalid_plan");
});

for (const raw of [
	"menu_title: Deluxe\nsize: 9\nitems: {}",
	"menu-settings:\n  rows: 1\n  name: Chest",
	"buttons: [BROKEN_CUSTOM_FORMAT",
]) {
	test(`converts raw source flexibly, repairs invalid output and exposes limitations: ${raw.slice(0, 24)}`, async () => {
		const fileId = "server:custom/config.yml";
		const attachments = { [fileId]: raw };
		const manifest = buildManifest(attachments, {
			existingTargetIds: [],
			agentic: true,
		});
		manifest.agent!.tasks = [
			{
				sourceFileId: fileId,
				targetId: "home",
				instructions: "Convert the home menu",
				dependencyIds: [],
			},
		];
		let calls = 0;
		const provider: LlmProvider = {
			async *streamTurn(input) {
				calls++;
				if (calls === 1)
					yield {
						type: "tool_use",
						id: "read",
						name: "read_source",
						input: { fileId },
					};
				else if (calls === 2) {
					expect(JSON.stringify(input.messages)).toContain(raw.split("\n")[0]);
					yield {
						type: "tool_use",
						id: "limit",
						name: "report_limitations",
						input: {
							notes: "Custom animation has no equivalent; use a static icon.",
						},
					};
				} else
					yield {
						type: "tool_use",
						id: `write${calls}`,
						name: "upsert_menu",
						input: {
							menu:
								calls === 3
									? { id: "home" }
									: {
											schema: "menu/v1",
											id: "home",
											title: [],
											size: 9,
											layers: [{ id: "base", name: "base", elements: [] }],
										},
						},
					};
				yield { type: "done", stopReason: "tool_calls" };
			},
		};
		const result = await convertAgentTask({
			provider,
			model: "test",
			manifest,
			attachments,
			sourceFileId: fileId,
			targetId: "home",
			contextTokens: 64000,
			maxOutputTokens: 4000,
			signal: new AbortController().signal,
			onUsage: () => {},
			canCall: () => true,
		});
		expect(result.menu.id).toBe("home");
		expect(result.issues[0].message).toContain("static icon");
		expect(calls).toBe(4);
	});
}

test("the AI explores an unknown format and plans multiple menus from one source", async () => {
	const fileId = "server:custom/screens.json";
	const attachments = { [fileId]: '{"screens":{"home":{},"shop":{}}}' };
	const manifest = buildManifest(attachments, {
		existingTargetIds: [],
		agentic: true,
	});
	let calls = 0;
	const provider: LlmProvider = {
		async *streamTurn(input) {
			calls++;
			if (calls === 1) {
				expect(input.tools.some((t) => t.name === "search_sources")).toBe(true);
				yield {
					type: "tool_use",
					id: "read",
					name: "read_source",
					input: { fileId },
				};
			} else {
				expect(JSON.stringify(input.messages)).toContain("screens");
				yield {
					type: "tool_use",
					id: "plan",
					name: "submit_plan",
					input: {
						menus: ["home", "shop"].map((targetId) => ({
							sourceFileId: fileId,
							targetId,
							instructions: `Convert screens.${targetId}`,
							dependencyIds: [],
						})),
						files: [
							{ fileId, role: "menu", notes: "Two screens in this JSON file." },
						],
					},
				};
			}
			yield { type: "usage", usage: { inputTokens: 100, outputTokens: 30 } };
			yield { type: "done", stopReason: "tool_calls" };
		},
	};
	const result = await discoverMigration({
		provider,
		model: "test",
		manifest,
		attachments,
		contextTokens: 64000,
		maxOutputTokens: 4000,
		signal: new AbortController().signal,
		canCall: () => true,
		onUsage: () => {},
	});
	expect(result.agent?.tasks?.map((t) => t.targetId)).toEqual(["home", "shop"]);
	expect(result.entries).toEqual(manifest.entries);
	expect(calls).toBe(2);
});
