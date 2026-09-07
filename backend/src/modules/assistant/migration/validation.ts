import type { DslStep } from "../../../../../editor/src/lib/actionDsl/ast";
import { parseActionDsl } from "../../../../../editor/src/lib/actionDsl/parser";
import { validateMenuV1 } from "../validate";
import { hashJsonValue } from "./manifest";
import {
	MigrationInputError,
	type MigrationManifest,
	type MigrationProposal,
} from "./types";

export function validateMigrationProposal(
	menu: Record<string, unknown>,
	manifest: MigrationManifest,
	sourceFileId: string,
): Omit<MigrationProposal, "id" | "stepId"> {
	const source = manifest.entries.find(
		(entry) => entry.fileId === sourceFileId,
	);
	if (!source?.targetId || menu.id !== source.targetId)
		throw new MigrationInputError("target_mismatch");
	if (!validateMenuV1(menu).valid)
		throw new MigrationInputError("invalid_menu");
	const assertLiteral = (value: unknown, dsl = false): void => {
		if (typeof value === "string" && value.includes("{i18n:"))
			throw new MigrationInputError("invalid_menu");
		if (!value || typeof value !== "object") return;
		const record = value as Record<string, unknown>;
		if (
			Object.keys(record).length === 1 &&
			(typeof record.key === "string" ||
				(dsl && typeof record.ref === "string"))
		)
			throw new MigrationInputError("invalid_menu");
		for (const child of Object.values(value)) assertLiteral(child, dsl);
	};
	assertLiteral(menu);
	const validationView = structuredClone(menu);
	const normalizeClicks = (value: unknown): void => {
		if (!value || typeof value !== "object") return;
		for (const [key, child] of Object.entries(value)) {
			if (key === "click" && child && typeof child === "object")
				for (const [event, handler] of Object.entries(child)) {
					if (typeof handler === "string")
						(child as Record<string, unknown>)[event] = { steps: handler };
				}
			normalizeClicks(child);
		}
	};
	normalizeClicks(validationView);
	if (!validateMenuV1(validationView).valid)
		throw new MigrationInputError("invalid_menu");
	const links = new Set<string>();
	const walkSteps = (steps: DslStep[]): void => {
		assertLiteral(steps, true);
		for (const step of steps) {
			if (step.kind === "action") {
				if (step.action.type === "open_menu") links.add(step.action.menuId);
			} else {
				for (const branch of step.cases) walkSteps(branch.steps);
				if (step.else) walkSteps(step.else);
			}
		}
	};
	const walk = (value: unknown): void => {
		if (Array.isArray(value)) {
			value.forEach(walk);
			return;
		}
		if (!value || typeof value !== "object") return;
		for (const [key, child] of Object.entries(value)) {
			if (key === "steps" && typeof child === "string")
				walkSteps(parseActionDsl(child));
			else walk(child);
		}
	};
	walk(validationView);
	const known = new Set(
		manifest.entries
			.filter((entry) => entry.kind === "menu")
			.map((entry) => entry.targetId),
	);
	for (const target of links)
		if (!known.has(target))
			throw new MigrationInputError("unknown_menu_reference");
	const expected = new Set<string>();
	const visited = new Set<string>();
	const collect = (fileId: string): void => {
		if (visited.has(fileId)) return;
		visited.add(fileId);
		const entry = manifest.entries.find(
			(candidate) => candidate.fileId === fileId,
		);
		for (const id of entry?.dependencyIds ?? []) {
			const dependency = manifest.entries.find(
				(candidate) => candidate.fileId === id,
			);
			if (dependency?.kind === "menu" && dependency.targetId)
				expected.add(dependency.targetId);
			else if (dependency?.kind === "shared") collect(id);
		}
	};
	collect(sourceFileId);
	const issues = [...source.issues];
	for (const targetId of expected)
		if (!links.has(targetId))
			issues.push({
				code: "missing_generated_reference",
				targetId,
				fileId: sourceFileId,
				message:
					"A recognized source link is absent from the generated menu; verify this conversion.",
			});
	return {
		targetId: source.targetId,
		baseHash: null,
		resultHash: hashJsonValue(menu),
		menu,
		issues,
	};
}
