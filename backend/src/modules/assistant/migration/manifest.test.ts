import { expect, test } from "bun:test";
import {
	buildManifest,
	hashJsonValue,
	verifyManifestSources,
} from "./manifest";
import { isBlockingMigrationIssue } from "./types";

test("reserves stable menu IDs independent of selection order and detects changed sources", () => {
	const sources = {
		"server:zmenu/menus/shop.yml": "name: Shop\nsize: 9\n",
		"server:zmenu/menus/home.yml": "name: Home\nsize: 9\n",
	};
	const manifest = buildManifest(sources, { existingTargetIds: [] });
	expect(
		buildManifest(Object.fromEntries(Object.entries(sources).reverse()), {
			existingTargetIds: [],
		}),
	).toEqual(manifest);
	expect(manifest.entries.map((entry) => entry.targetId)).toEqual([
		"home",
		"shop",
	]);
	expect(verifyManifestSources(manifest, sources)).toEqual([]);
	expect(
		verifyManifestSources(manifest, {
			...sources,
			"server:zmenu/menus/shop.yml": "name: Changed",
		}).map((issue) => issue.code),
	).toEqual(["source_changed"]);
});

test("does not misclassify a shared root without its directory metadata as a menu", () => {
	const manifest = buildManifest(
		{ "server:patterns/navigation.yml": "name: Navigation\nitems: {}" },
		{ existingTargetIds: [] },
	);
	expect(manifest.entries[0]?.kind).toBe("unsupported");
	expect(manifest.issues[0]?.code).toBe("unsupported_source");
});

test("does not persist oversized reference values copied from raw source", () => {
	const secretLikeValue = `missing_${"x".repeat(1024)}`;
	const manifest = buildManifest(
		{
			"server:z/a.yml": `size: 9\nitems:\n  a: {type: INVENTORY, inventory: ${secretLikeValue}}`,
		},
		{ existingTargetIds: [] },
	);
	expect(manifest.issues[0]?.code).toBe("missing_reference");
	expect(JSON.stringify(manifest)).not.toContain(secretLikeValue);
});

test("validates bounded YAML and source selections with controlled errors", () => {
	for (const [content, code] of [
		["x: &x [1]\ny: *x", "yaml_alias_unsupported"],
		[`${"x: [".repeat(60)}1${"]".repeat(60)}`, "yaml_complexity"],
		[`${"[".repeat(60)}1${"]".repeat(60)}`, "yaml_complexity"],
		["size: 9\nsize: 18", "invalid_yaml"],
		["#".repeat(1024 * 1024 + 1), "source_too_large"],
	])
		expect(() =>
			buildManifest({ "server:z/a.yml": content }, { existingTargetIds: [] }),
		).toThrow(code);
	expect(() => buildManifest({}, { existingTargetIds: [] })).toThrow(
		"empty_selection",
	);
	expect(() =>
		buildManifest(
			{ "server:z/../a.yml": "size: 9" },
			{ existingTargetIds: [] },
		),
	).toThrow("invalid_source_id");
});

test("canonical proposal hashes distinguish absence and sort object keys recursively", () => {
	expect(hashJsonValue({ b: [1, { y: 2, x: 1 }], a: "" })).toBe(
		hashJsonValue({ a: "", b: [1, { x: 1, y: 2 }] }),
	);
	expect(hashJsonValue("")).not.toBe(null);
	expect(
		isBlockingMigrationIssue({ code: "missing_reference", message: "" }),
	).toBe(false);
	expect(
		isBlockingMigrationIssue({ code: "target_collision", message: "" }),
	).toBe(true);
});

test("finds nested requirements, else patterns, action patterns and custom commands", () => {
	const manifest = buildManifest(
		{
			"server:z/menus/home.yml":
				"size: 9\nitems:\n  a:\n    requirements:\n      success:\n        - {type: inventory, inventory: shop}\n      deny:\n        - {type: inventory, inventory: '%dynamic%'}\n    else:\n      pattern: {fileName: shared}\n    action-patterns: [sound]\n",
			"server:z/menus/shop.yml": "size: 9",
			"server:z/patterns/shared.yml": "name: alias\nitems: {}",
			"server:z/actions_patterns/sound.yml": "actions: []",
			"server:z/commands.yml":
				"commands:\n  open: {inventory: home}\n  other: {inventory: 'Other:shop'}",
		},
		{ existingTargetIds: [] },
	);
	expect(
		manifest.entries.find((entry) => entry.targetId === "home")?.dependencyIds,
	).toEqual([
		"server:z/actions_patterns/sound.yml",
		"server:z/menus/shop.yml",
		"server:z/patterns/shared.yml",
	]);
	expect(
		manifest.entries.find((entry) => entry.path === "commands.yml")
			?.dependencyIds,
	).toEqual(["server:z/menus/home.yml"]);
	expect(manifest.issues.map((issue) => issue.code).sort()).toEqual([
		"commands_manual_verification",
		"dynamic_reference",
		"external_reference",
	]);
});

test("reports ambiguity, existing targets, missing, dynamic and external references distinctly", () => {
	const manifest = buildManifest(
		{
			"server:z/menus/a/shop.yml": "size: 9",
			"server:z/menus/b/shop.yml": "size: 9",
			"server:z/menus/home.yml":
				"size: 9\nitems:\n  a: {type: INVENTORY, inventory: shop}\n  b: {type: INVENTORY, inventory: missing}\n  c: {type: INVENTORY, inventory: '%player_menu%'}\n  d: {type: INVENTORY, inventory: elsewhere, plugin: Other}\n  e: {type: BACK, inventory: ignored}\n",
		},
		{ existingTargetIds: ["home"] },
	);
	expect(manifest.issues.map((issue) => issue.code).sort()).toEqual(
		[
			"ambiguous_reference",
			"dynamic_reference",
			"external_reference",
			"missing_reference",
			"target_collision",
			"target_collision",
			"target_exists",
		].sort(),
	);
	expect(
		manifest.entries.find((entry) => entry.targetId === "home")?.dependencyIds,
	).toEqual([]);
});

test("resolves cyclic menus and shared patterns without interpreting titles or lore as references", () => {
	const sources = Object.fromEntries(
		Array.from({ length: 35 }, (_, i) => [
			`server:zmenu/menus/menu${i}.yml`,
			`name: Title ${i}\nsize: 9\npatterns: [navigation]\nitems:\n  next:\n    type: INVENTORY\n    inventory: menu${(i + 1) % 35}\n  cosmetic:\n    lore: ['inventory: absent']\n`,
		]),
	);
	sources["server:zmenu/patterns/navigation.yml"] =
		"name: navigation\nitems:\n  home:\n    actions:\n      - type: inventory\n        inventory: menu0\n";
	const manifest = buildManifest(sources, { existingTargetIds: [] });
	expect(manifest.issues).toEqual([]);
	expect(
		manifest.entries.filter((entry) => entry.kind === "menu"),
	).toHaveLength(35);
	expect(
		manifest.entries.find((entry) => entry.targetId === "menu1")?.dependencyIds,
	).toEqual([
		"server:zmenu/menus/menu2.yml",
		"server:zmenu/patterns/navigation.yml",
	]);
});
