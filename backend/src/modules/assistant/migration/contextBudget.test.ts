import { expect, test } from "bun:test";
import { buildStepContext } from "./contextBudget";
import { buildManifest } from "./manifest";

test("a 35-menu cycle supplies a global target index but only the current raw menu", () => {
	const attachments = Object.fromEntries(
		Array.from({ length: 35 }, (_, i) => [
			`server:z/menus/m${i}.yml`,
			`size: 9\nname: UNIQUE_RAW_${i}_END\nitems:\n  next: {type: INVENTORY, inventory: m${(i + 1) % 35}}\n`,
		]),
	);
	const manifest = buildManifest(attachments, { existingTargetIds: [] });
	const result = buildStepContext({
		manifest,
		attachments,
		sourceFileId: "server:z/menus/m0.yml",
		systemPrompt: "Convert",
		contextTokens: 16000,
		maxOutputTokens: 1000,
	});
	expect(JSON.stringify(result.messages)).toContain("UNIQUE_RAW_0_END");
	expect(JSON.stringify(result.messages)).not.toContain("UNIQUE_RAW_1_END");
	expect(JSON.stringify(result.messages)).toContain("m34");
	expect(() =>
		buildStepContext({
			manifest,
			attachments,
			sourceFileId: "server:z/menus/m0.yml",
			systemPrompt: "Convert",
			contextTokens: 1000,
			maxOutputTokens: 1000,
		}),
	).not.toThrow();
});

test("transitive shared cycles are included once without pulling referenced raw menus", () => {
	const attachments = {
		"server:z/menus/a.yml": "size: 9\npatterns: [p]",
		"server:z/menus/b.yml": "size: 9\nname: EXCLUDED_RAW",
		"server:z/patterns/p.yml": "patterns: [q]\nitems: {}",
		"server:z/patterns/q.yml":
			"patterns: [p]\nitems:\n  b: {type: INVENTORY, inventory: b}",
	};
	const manifest = buildManifest(attachments, { existingTargetIds: [] });
	const result = buildStepContext({
		manifest,
		attachments,
		sourceFileId: "server:z/menus/a.yml",
		systemPrompt: "Convert",
		contextTokens: 20000,
		maxOutputTokens: 1000,
	});
	const payload = JSON.parse(result.messages[1].content ?? "{}");
	expect(
		payload.sources.map((source: { fileId: string }) => source.fileId),
	).toEqual([
		"server:z/menus/a.yml",
		"server:z/patterns/p.yml",
		"server:z/patterns/q.yml",
	]);
	expect(JSON.stringify(result.messages)).not.toContain("EXCLUDED_RAW");
});

test("legacy context size does not block shared sources but changed sources are still rejected", () => {
	const attachments = {
		"server:z/menus/a.yml": "size: 9\npatterns: [p]",
		"server:z/patterns/p.yml": "items: {}\nname: SHARED_RAW",
	};
	const manifest = buildManifest(attachments, { existingTargetIds: [] });
	const input = {
		manifest,
		attachments,
		sourceFileId: "server:z/menus/a.yml",
		systemPrompt: "Convert",
		contextTokens: 20000,
		maxOutputTokens: 1000,
	};
	const result = buildStepContext(input);
	expect(JSON.stringify(result.messages)).toContain("SHARED_RAW");
	expect(() => buildStepContext({ ...input, contextTokens: 1 })).not.toThrow();
	expect(() =>
		buildStepContext({
			...input,
			contextTokens: 1,
			tools: [{ name: "x", description: "large tool", parameters: {} }],
		}),
	).not.toThrow();
	expect(() =>
		buildStepContext({
			...input,
			attachments: {
				...attachments,
				"server:z/patterns/p.yml": "changed: true",
			},
		}),
	).toThrow("source_changed");
});
