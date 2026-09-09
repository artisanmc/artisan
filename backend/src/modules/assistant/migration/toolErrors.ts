import { MigrationInputError } from "./types";

const toolNames = new Set([
	"read_source",
	"list_sources",
	"search_sources",
	"read_reference",
	"read_migration_plan",
	"report_limitations",
	"submit_plan",
	"upsert_menu",
]);
export const toolReasons = {
	invalid_arguments:
		"Use a JSON object matching the tool schema and its required fields.",
	invalid_offset:
		"Use offset 0 or the nextOffset returned by read_source; do not guess offsets.",
	unselected_source:
		"Use an exact fileId from the selected source index. Other files are not accessible.",
	unknown_tool: "Use only tools provided in this request.",
	mixed_proposal:
		"No action in this batch was executed. Read sources and record notes first, then submit exactly one proposal or plan in a separate call.",
} as const;
export function toolFailure(name: string, reason: keyof typeof toolReasons) {
	return new MigrationInputError(
		`invalid_tool:${toolNames.has(name) ? name : "unknown"}:${reason}`,
	);
}
export function isToolFailure(code: string): boolean {
	const [prefix, name, reason, extra] = code.split(":");
	return (
		prefix === "invalid_tool" &&
		(toolNames.has(name) || name === "unknown") &&
		Object.hasOwn(toolReasons, reason) &&
		extra === undefined
	);
}
export function toolFeedback(code: string): string {
	const reason = code.split(":")[2] as keyof typeof toolReasons;
	return JSON.stringify({ error: code, correction: toolReasons[reason] });
}
