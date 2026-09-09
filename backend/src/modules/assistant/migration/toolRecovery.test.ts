import { expect, test } from "bun:test";
import { agentLoop, sourceTools, type AgentInput } from "./agent";
import { buildManifest } from "./manifest";
import {
	MigrationPausedError,
	restoreMessages,
	saveMessages,
} from "./continuation";
import type { LlmMessage, LlmProvider } from "../provider/types";

const attachments = { "server:x/a.yml": "size: 9" };
function input(provider: LlmProvider): AgentInput {
	return {
		provider,
		attachments,
		manifest: buildManifest(attachments, {
			existingTargetIds: [],
			agentic: true,
		}),
		model: "test",
		contextTokens: null,
		maxOutputTokens: 8000,
		signal: new AbortController().signal,
		onUsage: () => {},
		canCall: () => true,
	};
}
const tools = ["read_source", "upsert_menu"].map((name) => ({
	name,
	description: name,
	parameters: { type: "object" },
}));

test.each([
	"bad_offset",
	"unknown_tool",
	"bad_arguments",
	"mixed_proposal",
	"foreign_source",
])(
	"repairs %s with tool feedback before accepting a single proposal",
	async (scenario) => {
		let turns = 0;
		let proposals = 0;
		const messages: LlmMessage[] = [];
		const ctx = input({
			async *streamTurn(args) {
				turns++;
				if (turns === 1) {
					yield {
						type: "tool_use",
						id: "bad",
						name: scenario === "unknown_tool" ? "read_file" : "read_source",
						input:
							scenario === "bad_arguments"
								? null
								: {
										fileId:
											scenario === "foreign_source"
												? "server:private/secret.yml"
												: "server:x/a.yml",
										offset: scenario === "mixed_proposal" ? 0 : -1,
									},
					};
					if (scenario === "mixed_proposal")
						yield {
							type: "tool_use",
							id: "early",
							name: "upsert_menu",
							input: {},
						};
				} else {
					expect(
						args.messages
							.filter((message) => message.role === "tool")
							.every((message) => message.content.includes("error")),
					).toBe(true);
					yield {
						type: "tool_use",
						id: "fixed",
						name: "upsert_menu",
						input: {},
					};
				}
				yield { type: "done", stopReason: "tool_calls" };
			},
		});
		const sources = sourceTools(ctx);
		const result = await agentLoop(
			ctx,
			messages,
			tools,
			(name, args) => {
				if (name === "upsert_menu") {
					proposals++;
					return { content: "ok", result: "proposal" };
				}
				return { content: sources.execute(name, args) };
			},
			8,
		);
		expect(result).toBe("proposal");
		expect(turns).toBe(2);
		expect(proposals).toBe(1);
		const restored = restoreMessages(saveMessages(messages), () => {
			throw new Error("Failed reads must never be replayed");
		});
		expect(restored).toEqual(messages);
	},
);

test("persistent invalid reads stop after three rounds with a safe diagnostic and resumable feedback", async () => {
	let turns = 0;
	const ctx = input({
		async *streamTurn() {
			turns++;
			yield {
				type: "tool_use",
				id: `bad${turns}`,
				name: "read_source",
				input: { fileId: "server:x/a.yml", offset: -1 },
			};
			yield { type: "done", stopReason: "tool_calls" };
		},
	});
	const sources = sourceTools(ctx);
	try {
		await agentLoop(
			ctx,
			[],
			tools,
			(name, args) => ({ content: sources.execute(name, args) }),
			8,
		);
		throw new Error("Expected pause");
	} catch (error) {
		expect(error).toBeInstanceOf(MigrationPausedError);
		if (!(error instanceof MigrationPausedError)) throw error;
		expect(error.code).toBe("invalid_tool:read_source:invalid_offset");
		expect(
			restoreMessages(error.continuation.messages, () => {
				throw new Error("Do not replay invalid reads");
			}),
		).toHaveLength(6);
	}
	expect(turns).toBe(3);
});
