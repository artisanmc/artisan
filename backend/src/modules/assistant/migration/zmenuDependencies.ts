import { isAlias, isCollection, isPair, parseDocument } from "yaml";
import { MigrationInputError } from "./types";

export type SourceKind =
	| "menu"
	| "pattern"
	| "actions"
	| "commands"
	| "unsupported";
export interface ZmenuReference {
	kind: "menu" | "pattern" | "actions";
	value: string;
	external: boolean;
}
export interface ZmenuDocument {
	kind: SourceKind;
	aliases: string[];
	references: ZmenuReference[];
	analysisIncomplete?: boolean;
}

const record = (value: unknown): Record<string, unknown> | undefined =>
	value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;

export function analyzeZmenu(path: string, content: string): ZmenuDocument {
	if (Buffer.byteLength(content) > 1024 * 1024)
		throw new MigrationInputError("source_too_large");
	const segments = path.split("/");
	const basename = (segments.at(-1) ?? "").replace(/\.ya?ml$/i, "");
	const fallback = (): ZmenuDocument => ({
		kind: segments.includes("patterns") ? "pattern"
			: segments.some((part) => ["action_patterns", "actions_patterns"].includes(part)) ? "actions" : "menu",
		aliases: [basename],
		references: [],
		analysisIncomplete: true,
	});
	let root: Record<string, unknown> | undefined;
	try {
		const doc = parseDocument(content, { uniqueKeys: true });
		if (doc.errors.length) throw new MigrationInputError("invalid_yaml");
		let nodes = 0;
		const inspect = (node: unknown, depth: number): void => {
			if (++nodes > 20000 || depth > 48)
				throw new MigrationInputError("yaml_complexity");
			if (isAlias(node))
				throw new MigrationInputError("yaml_alias_unsupported");
			if (isPair(node)) {
				inspect(node.key, depth + 1);
				inspect(node.value, depth + 1);
			} else if (isCollection(node))
				for (const item of node.items) inspect(item, depth + 1);
		};
		inspect(doc.contents, 0);
		root = record(doc.toJS({ maxAliasCount: 0 }));
	} catch {
		// Do not expand aliases or guess dependencies from a partial parse. The AI reads bounded raw text.
		return fallback();
	}
	if (!root) return fallback();
	const kind: SourceKind = segments.some((part) => part === "patterns")
		? "pattern"
		: segments.some(
					(part) => part === "action_patterns" || part === "actions_patterns",
				)
			? "actions"
			: record(root.commands)
				? "commands"
				: "size" in root || "rows" in root
					? "menu"
					: "unsupported";
	const references: ZmenuReference[] = [];
	const add = (
		refKind: ZmenuReference["kind"],
		value: unknown,
		plugin?: unknown,
	) => {
		if (typeof value === "string")
			references.push({
				kind: refKind,
				value,
				external:
					typeof plugin === "string" && plugin.toLowerCase() !== "zmenu",
			});
	};
	const walk = (value: unknown): void => {
		if (Array.isArray(value)) {
			for (const child of value) walk(child);
			return;
		}
		const obj = record(value);
		if (!obj) return;
		if (typeof obj.type === "string" && obj.type.toLowerCase() === "inventory")
			add("menu", obj.inventory, obj.plugin);
		if (Array.isArray(obj.patterns))
			for (const ref of obj.patterns) add("pattern", ref);
		if (record(obj.pattern)) add("pattern", record(obj.pattern)?.fileName);
		if (Array.isArray(obj["action-patterns"]))
			for (const ref of obj["action-patterns"]) add("actions", ref);
		for (const [key, child] of Object.entries(obj)) {
			if (!["lore", "name", "title", "commands"].includes(key)) walk(child);
		}
	};
	walk(root);
	if (kind === "commands")
		for (const command of Object.values(record(root.commands) ?? {}))
			add("menu", record(command)?.inventory);
	return {
		kind,
		aliases: [
			...new Set([
				basename,
				...(kind === "pattern" && typeof root.name === "string"
					? [root.name]
					: []),
			]),
		],
		references,
	};
}
