import { buildMigrationSystemPrompt } from "../grounding";
import type {
	LlmMessage,
	LlmProvider,
	LlmUsage,
	ToolDef,
} from "../provider/types";
import { TOOL_DEFS, executeTool } from "../tools";
import { WorkingCopy } from "../workingCopy";
import { buildStepContext } from "./contextBudget";
import {
	MigrationInputError,
	type MigrationManifest,
	type MigrationProposal,
} from "./types";
import { validateMigrationProposal } from "./validation";
import {
	agentLoop,
	explorationTools,
	sourceTools,
	type AgentInput,
} from "./agent";

export async function convertAgentTask(
	input: AgentInput & { sourceFileId: string; targetId: string },
): Promise<Omit<MigrationProposal, "id" | "stepId">> {
	const task = input.manifest.agent?.tasks?.find(
		(t) =>
			t.targetId === input.targetId && t.sourceFileId === input.sourceFileId,
	);
	if (!task) throw new MigrationInputError("invalid_step_source");
	const sources = sourceTools(input);
	const issues: MigrationProposal["issues"] = [];
	return agentLoop(
		input,
		[
			{
				role: "system",
				content: `${buildMigrationSystemPrompt()}\nExplore raw sources with tools as needed. The task identifies one menu, not necessarily the whole source file. Use report_limitations for unsupported or uncertain semantics, explaining alternatives. Call upsert_menu alone to finish. Read at least the main source before proposing a menu. Invalid output returns validation feedback for repair.`,
			},
			{
				role: "user",
				content: JSON.stringify({
					targetId: task.targetId,
					task,
					index: input.manifest.agent?.tasks,
					reports: input.manifest.agent?.reports,
					files: input.manifest.entries.map(({ fileId, byteLength }) => ({
						fileId,
						byteLength,
					})),
				}),
			},
		],
		[
			...TOOL_DEFS.filter((t) => t.name === "upsert_menu"),
			...explorationTools,
			{
				name: "report_limitations",
				description:
					"Report unsupported features, uncertainty, missing dependencies and proposed alternatives. These notes are displayed for review, not hidden in the menu.",
				parameters: {
					type: "object",
					properties: { notes: { type: "string", maxLength: 2000 } },
					required: ["notes"],
					additionalProperties: false,
				},
			},
		],
		(name, args) => {
			if (name === "report_limitations") {
				if (
					typeof args.notes !== "string" ||
					!args.notes.trim() ||
					args.notes.length > 2000 ||
					issues.length >= 20
				)
					throw new MigrationInputError("invalid_tool");
				issues.push({
					code: "conversion_limitation",
					fileId: task.sourceFileId,
					targetId: task.targetId,
					message: args.notes,
				});
				return { content: "Limitation recorded for review." };
			}
			if (name !== "upsert_menu")
				return { content: sources.execute(name, args) };
			if (!sources.inspected.has(task.sourceFileId))
				return {
					content: "Read the main source before proposing its conversion.",
				};
			try {
				if (
					!args.menu ||
					typeof args.menu !== "object" ||
					Array.isArray(args.menu)
				)
					throw new MigrationInputError("invalid_menu");
				const result = executeTool("upsert_menu", args, new WorkingCopy());
				if (!result.ok) return { content: result.content.slice(0, 4000) };
				const proposal = validateMigrationProposal(
					args.menu as Record<string, unknown>,
					input.manifest,
					task.sourceFileId,
					task.targetId,
				);
				proposal.issues.push(...issues);
				for (const fileId of new Set([
					task.sourceFileId,
					...task.dependencyIds,
				])) {
					if (!sources.isFullyRead(fileId))
						proposal.issues.push({
							code: "conversion_limitation",
							fileId,
							targetId: task.targetId,
							message: `Source not fully read during conversion: ${fileId}. Verify that no behavior or dependency was omitted.`,
						});
				}
				return {
					content: "Proposal validated, awaiting user review.",
					result: proposal,
				};
			} catch (error) {
				if (!(error instanceof MigrationInputError)) throw error;
				return {
					content: `Validation failed: ${error.code}. Correct the proposal and retry; do not invent unknown menu links.`,
				};
			}
		},
		32,
	);
}

const tools: ToolDef[] = [
	...TOOL_DEFS.filter((tool) => tool.name === "upsert_menu"),
	{
		name: "read_source",
		description:
			"Read another selected source by its exact fileId when its raw content is required. Unselected paths are inaccessible.",
		parameters: {
			type: "object",
			properties: { fileId: { type: "string" } },
			required: ["fileId"],
			additionalProperties: false,
		},
	},
];

export async function convertMigrationStep(input: {
	provider: LlmProvider;
	model: string;
	manifest: MigrationManifest;
	sourceFileId: string;
	attachments: Record<string, string>;
	contextTokens: number;
	maxOutputTokens: number;
	signal: AbortSignal;
	onUsage: (usage: LlmUsage) => void;
	canCall: () => boolean;
}): Promise<Omit<MigrationProposal, "id" | "stepId">> {
	const { messages } = buildStepContext({
		...input,
		systemPrompt: buildMigrationSystemPrompt(),
		tools,
	});
	for (let iteration = 0; iteration < 3; iteration++) {
		input.signal.throwIfAborted();
		if (!input.canCall()) throw new MigrationInputError("step_budget_exceeded");
		const estimated =
			Buffer.byteLength(JSON.stringify(messages)) +
			Buffer.byteLength(JSON.stringify(tools)) +
			256 +
			input.maxOutputTokens;
		if (estimated > input.contextTokens)
			throw new MigrationInputError("context_budget_exceeded");
		const calls: { id: string; name: string; input: unknown }[] = [];
		let stop: string | undefined;
		let responseBytes = 0;
		for await (const event of input.provider.streamTurn({
			messages,
			tools,
			model: input.model,
			signal: input.signal,
			maxOutputTokens: input.maxOutputTokens,
			maxRetries: 0,
			requireExplicitFinish: true,
			maxResponseBytes: 1024 * 1024,
		})) {
			input.signal.throwIfAborted();
			responseBytes += Buffer.byteLength(JSON.stringify(event));
			if (responseBytes > 1024 * 1024)
				throw new MigrationInputError("provider_output_limit");
			if (event.type === "usage") input.onUsage(event.usage);
			if (event.type === "tool_use") calls.push(event);
			if (event.type === "done") stop = event.stopReason;
		}
		if (!stop) throw new MigrationInputError("provider_network_error");
		if (stop === "length" || stop === "max_tokens")
			throw new MigrationInputError("provider_output_limit");
		if (!["tool_calls", "stop", "end_turn"].includes(stop))
			throw new MigrationInputError("provider_error");
		if (!calls.length || calls.length > 8)
			throw new MigrationInputError("missing_proposal");
		messages.push({
			role: "assistant",
			content: null,
			toolCalls: calls.map((call) => ({
				id: call.id,
				name: call.name,
				arguments: JSON.stringify(call.input),
			})),
		});
		let proposal: Omit<MigrationProposal, "id" | "stepId"> | undefined;
		for (const call of calls) {
			if (
				!call.input ||
				typeof call.input !== "object" ||
				Array.isArray(call.input)
			)
				throw new MigrationInputError("invalid_tool");
			const args = call.input as Record<string, unknown>;
			let content: string;
			if (call.name === "read_source") {
				if (
					typeof args.fileId !== "string" ||
					Object.keys(args).length !== 1 ||
					!input.manifest.entries.some((entry) => entry.fileId === args.fileId)
				)
					throw new MigrationInputError("invalid_tool");
				content = input.attachments[args.fileId];
			} else if (call.name === "upsert_menu") {
				if (proposal) throw new MigrationInputError("invalid_tool");
				const source = input.manifest.entries.find(
					(entry) => entry.fileId === input.sourceFileId,
				);
				if (
					!args.menu ||
					typeof args.menu !== "object" ||
					(args.menu as Record<string, unknown>).id !== source?.targetId
				)
					throw new MigrationInputError("target_mismatch");
				const result = executeTool("upsert_menu", args, new WorkingCopy());
				content = result.ok
					? "Proposal validated."
					: result.content.slice(0, 4000);
				if (result.ok)
					proposal = validateMigrationProposal(
						args.menu as Record<string, unknown>,
						input.manifest,
						input.sourceFileId,
					);
			} else throw new MigrationInputError("invalid_tool");
			messages.push({
				role: "tool",
				toolCallId: call.id,
				content,
			} satisfies LlmMessage);
		}
		if (proposal && calls.some((call) => call.name === "read_source"))
			throw new MigrationInputError("invalid_tool");
		if (proposal) return proposal;
	}
	throw new MigrationInputError("invalid_menu");
}
