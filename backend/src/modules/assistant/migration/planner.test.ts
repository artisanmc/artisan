import { expect, test } from "bun:test";
import type { LlmProvider } from "../provider/types";
import { buildManifest } from "./manifest";
import { convertMigrationStep } from "./planner";

const attachments = {
	"server:z/a.yml": "size: 9\nitems:\n  next: {type: INVENTORY, inventory: b}",
	"server:z/b.yml": "size: 9",
};
const manifest = buildManifest(attachments, { existingTargetIds: [] });
const menu = {
	schema: "menu/v1",
	id: "a",
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
					click: { left: { steps: "open_menu b" } },
				},
			],
		},
	],
};
test("converts one reserved menu with bounded context and returns a validated proposal", async () => {
	const provider: LlmProvider = {
		async *streamTurn(input) {
			expect(input.maxRetries).toBe(0);
			expect(input.maxOutputTokens).toBe(4000);
			expect(input.tools.map((t) => t.name)).toEqual([
				"upsert_menu",
				"read_source",
			]);
			yield { type: "usage", usage: { inputTokens: 100, outputTokens: 20 } };
			yield {
				type: "tool_use",
				id: "write",
				name: "upsert_menu",
				input: { menu },
			};
			yield { type: "done", stopReason: "tool_calls" };
		},
	};
	const proposal = await convertMigrationStep({
		provider,
		model: "test",
		manifest,
		sourceFileId: "server:z/a.yml",
		attachments,
		contextTokens: 64000,
		maxOutputTokens: 4000,
		signal: new AbortController().signal,
		onUsage: () => {},
		canCall: () => true,
	});
	expect(proposal.menu).toEqual(menu);
	expect(proposal.baseHash).toBeNull();
	expect(proposal.issues).toEqual([]);
});

const args = (provider: LlmProvider) => ({
	provider,
	model: "test",
	manifest,
	sourceFileId: "server:z/a.yml",
	attachments,
	contextTokens: 64000,
	maxOutputTokens: 4000,
	signal: new AbortController().signal,
	onUsage: () => {},
	canCall: () => true,
});

test("allows at most three explicit schema corrections and never checkpoints invalid menus", async () => {
	let calls = 0;
	const provider: LlmProvider = {
		async *streamTurn() {
			calls++;
			yield {
				type: "tool_use",
				id: "bad",
				name: "upsert_menu",
				input: { menu: { id: "a" } },
			};
			yield { type: "done", stopReason: "tool_calls" };
		},
	};
	let error = "";
	try {
		await convertMigrationStep(args(provider));
	} catch (e) {
		error = (e as Error).message;
	}
	expect(error).toBe("invalid_menu");
	expect(calls).toBe(3);
});

test("rechecks expanded source context and usage budget before another paid call", async () => {
	let calls = 0;
	const provider: LlmProvider = {
		async *streamTurn() {
			calls++;
			yield {
				type: "tool_use",
				id: "read",
				name: "read_source",
				input: { fileId: "server:z/b.yml" },
			};
			yield { type: "done", stopReason: "tool_calls" };
		},
	};
	const large = {
		...attachments,
		"server:z/b.yml": `size: 9\n#${"x".repeat(70000)}`,
	};
	let error = "";
	try {
		await convertMigrationStep({
			...args(provider),
			attachments: large,
			manifest: buildManifest(large, { existingTargetIds: [] }),
		});
	} catch (e) {
		error = (e as Error).message;
	}
	expect(error).toBe("context_budget_exceeded");
	expect(calls).toBe(1);
	calls = 0;
	try {
		await convertMigrationStep({
			...args(provider),
			canCall: () => calls === 0,
		});
	} catch (e) {
		error = (e as Error).message;
	}
	expect(error).toBe("step_budget_exceeded");
	expect(calls).toBe(1);
});

test("rejects a valid-looking menu when the provider reports truncated output", async () => {
	const provider: LlmProvider = {
		async *streamTurn() {
			yield {
				type: "tool_use",
				id: "write",
				name: "upsert_menu",
				input: { menu },
			};
			yield { type: "done", stopReason: "length" };
		},
	};
	let error = "";
	try {
		await convertMigrationStep(args(provider));
	} catch (e) {
		error = (e as Error).message;
	}
	expect(error).toBe("provider_output_limit");
});
