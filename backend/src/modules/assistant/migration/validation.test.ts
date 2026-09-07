import { expect, test } from "bun:test";
import { buildManifest } from "./manifest";
import { validateMigrationProposal } from "./validation";

const manifest = buildManifest(
	{
		"server:z/a.yml": "size: 9\nitems:\n  x: {type: INVENTORY, inventory: b}",
		"server:z/b.yml": "size: 9",
	},
	{ existingTargetIds: [] },
);
function menu(steps: string | { steps: string }) {
	return {
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
						id: "x",
						material: "STONE",
						positions: "0",
						click: { left: steps },
					},
				],
			},
		],
	};
}

test("checks known links in canonical collapsed DSL click strings", () => {
	expect(
		validateMigrationProposal(menu("open_menu b"), manifest, "server:z/a.yml")
			.issues,
	).toEqual([]);
	expect(() =>
		validateMigrationProposal(
			menu("open_menu nonexistent"),
			manifest,
			"server:z/a.yml",
		),
	).toThrow("unknown_menu_reference");
});
test("retains link checks for supported legacy click handler objects", () => {
	expect(
		validateMigrationProposal(
			menu({ steps: "open_menu b" }),
			manifest,
			"server:z/a.yml",
		).issues,
	).toEqual([]);
	expect(() =>
		validateMigrationProposal(
			menu({ steps: "open_menu nonexistent" }),
			manifest,
			"server:z/a.yml",
		),
	).toThrow("unknown_menu_reference");
});

test("does not checkpoint invented translation keys in menu text or DSL", () => {
	expect(() =>
		validateMigrationProposal(
			{ ...menu("open_menu b"), title: "{i18n:new.key}" },
			manifest,
			"server:z/a.yml",
		),
	).toThrow("invalid_menu");
	expect(() =>
		validateMigrationProposal(
			menu("send_message @new.key"),
			manifest,
			"server:z/a.yml",
		),
	).toThrow("invalid_menu");
});

test("validates canonical click vocabulary and detects missing recognized source links", () => {
	expect(() =>
		validateMigrationProposal(
			menu("not_real_action x"),
			manifest,
			"server:z/a.yml",
		),
	).toThrow("invalid_menu");
	expect(
		validateMigrationProposal(
			menu("close_menu"),
			manifest,
			"server:z/a.yml",
		).issues.map((issue) => issue.code),
	).toEqual(["missing_generated_reference"]);
});
