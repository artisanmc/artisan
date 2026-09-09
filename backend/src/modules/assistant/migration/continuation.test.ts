import { expect, test } from "bun:test";
import OpenAI from "openai";
import type { AgentInput } from "./agent";
import { compressMessages } from "./continuation";
import { buildManifest } from "./manifest";
import type { LlmMessage, LlmProvider } from "../provider/types";

function input(provider: LlmProvider): AgentInput {
	return {
		provider,
		model: "test",
		manifest: buildManifest(
			{ "server:x/a.yml": "size: 9" },
			{ existingTargetIds: [], agentic: true },
		),
		attachments: { "server:x/a.yml": "size: 9" },
		contextTokens: null,
		maxOutputTokens: 4000,
		signal: new AbortController().signal,
		onUsage: () => {},
		canCall: () => true,
	};
}
const messages: LlmMessage[] = [
	{ role: "system", content: "Trusted instructions" },
	{ role: "user", content: "Findings and dependencies ".repeat(200) },
];

test("splits summary input only after an explicit context refusal, preserving both halves", async () => {
	const seen: string[] = [];
	const provider: LlmProvider = {
		async *streamTurn(args) {
			seen.push(args.messages[1].content ?? "");
			if (seen.length === 1)
				throw new OpenAI.APIError(
					400,
					{ code: "context_length_exceeded" },
					undefined,
					new Headers(),
				);
			yield { type: "text", text: `Findings from part ${seen.length - 1}` };
			yield { type: "done", stopReason: "stop" };
		},
	};
	const result = await compressMessages(input(provider), messages);
	expect(seen).toHaveLength(3);
	expect(seen[1] + seen[2]).toBe(seen[0]);
	expect(result[0]).toEqual(messages[0]);
	expect(result[1].content).toContain("part 1");
	expect(result[1].content).toContain("part 2");
});

test("rejects truncated summaries without altering the original history or retrying", async () => {
	const original = structuredClone(messages);
	let calls = 0;
	const provider: LlmProvider = {
		async *streamTurn() {
			calls++;
			yield { type: "text", text: "Incomplete" };
			yield { type: "done", stopReason: "length" };
		},
	};
	await expect(compressMessages(input(provider), messages)).rejects.toThrow(
		"compression_failed",
	);
	expect(messages).toEqual(original);
	expect(calls).toBe(1);
});

test("does not split or retry network failures and obeys credit and cancellation checks", async () => {
	let calls = 0;
	const provider: LlmProvider = {
		// biome-ignore lint/correctness/useYield: simulate a stream failing before its first chunk
		async *streamTurn() {
			calls++;
			throw new OpenAI.APIConnectionError({ message: "offline" });
		},
	};
	await expect(compressMessages(input(provider), messages)).rejects.toThrow();
	expect(calls).toBe(1);
	await expect(
		compressMessages({ ...input(provider), canCall: () => false }, messages),
	).rejects.toThrow("step_budget_exceeded");
	await expect(
		compressMessages(
			{ ...input(provider), signal: AbortSignal.abort() },
			messages,
		),
	).rejects.toThrow();
	expect(calls).toBe(1);
});
