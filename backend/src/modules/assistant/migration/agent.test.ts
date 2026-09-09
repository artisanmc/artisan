import { expect, test } from "bun:test";
import { buildManifest } from "./manifest";
import { discoverMigration, sourceTools, validateAgentPlan } from "./agent";
import { convertAgentTask } from "./planner";
import type { LlmProvider } from "../provider/types";

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
