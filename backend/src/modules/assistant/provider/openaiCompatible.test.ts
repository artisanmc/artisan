import { describe, expect, it } from "bun:test";
import { OpenAICompatibleProvider } from "./openaiCompatible";
import type { LlmStreamEvent } from "./types";

// biome-ignore lint/suspicious/noExplicitAny: scripted SDK chunks are intentionally untyped
function fakeStream(chunks: any[]) {
	return (async function* () {
		for (const c of chunks) yield c;
	})();
}
// biome-ignore lint/suspicious/noExplicitAny: injected fake client mimics the openai SDK shape
function fakeClient(chunks: any[]) {
	return {
		chat: { completions: { create: async () => fakeStream(chunks) } },
	} as unknown as ConstructorParameters<typeof OpenAICompatibleProvider>[1];
}
async function collect(it: AsyncIterable<LlmStreamEvent>) {
	const out: LlmStreamEvent[] = [];
	for await (const e of it) out.push(e);
	return out;
}

const cfg = { baseURL: "x", model: "m", apiKey: "k" };

describe("OpenAICompatibleProvider.streamTurn", () => {
	it("does not emit migration tools or completion after EOF without explicit finish", async () => {
		const provider = new OpenAICompatibleProvider(
			cfg,
			fakeClient([
				{
					choices: [
						{
							delta: {
								tool_calls: [
									{
										index: 0,
										id: "write",
										function: { name: "upsert_menu", arguments: '{"menu":{}}' },
									},
								],
							},
						},
					],
				},
			]),
		);
		let code = "";
		try {
			await collect(
				provider.streamTurn({
					messages: [],
					tools: [],
					model: "m",
					requireExplicitFinish: true,
				}),
			);
		} catch (error) {
			code = (error as Error).message;
		}
		expect(code).toBe("provider_network_error");
	});
	it("bounds migration tool argument buffers before accumulating oversized chunks", async () => {
		const provider = new OpenAICompatibleProvider(
			cfg,
			fakeClient([
				{
					choices: [
						{
							delta: {
								tool_calls: [
									{
										index: 0,
										id: "write",
										function: {
											name: "upsert_menu",
											arguments: "x".repeat(200),
										},
									},
								],
							},
						},
					],
				},
			]),
		);
		let code = "";
		try {
			await collect(
				provider.streamTurn({
					messages: [],
					tools: [],
					model: "m",
					maxResponseBytes: 100,
				}),
			);
		} catch (error) {
			code = (error as Error).message;
		}
		expect(code).toBe("provider_output_limit");
	});
	it("bounds migration output and disables SDK retries only when requested", async () => {
		let parameters: unknown;
		let options: unknown;
		const client = {
			chat: {
				completions: {
					create: async (params: unknown, opts: unknown) => {
						parameters = params;
						options = opts;
						return fakeStream([]);
					},
				},
			},
		} as unknown as ConstructorParameters<typeof OpenAICompatibleProvider>[1];
		await collect(
			new OpenAICompatibleProvider(cfg, client).streamTurn({
				messages: [],
				tools: [],
				model: "m",
				maxOutputTokens: 4000,
				maxRetries: 0,
			}),
		);
		expect(parameters).toMatchObject({ max_tokens: 4000 });
		expect(options).toMatchObject({ maxRetries: 0 });
	});
	it("forwards the optional AbortSignal through SDK request options", async () => {
		let options: unknown;
		const client = {
			chat: {
				completions: {
					create: async (_params: unknown, opts: unknown) => {
						options = opts;
						return fakeStream([]);
					},
				},
			},
		} as unknown as ConstructorParameters<typeof OpenAICompatibleProvider>[1];
		const signal = new AbortController().signal;
		await collect(
			new OpenAICompatibleProvider(cfg, client).streamTurn({
				messages: [],
				tools: [],
				model: "m",
				signal,
			}),
		);
		expect(options).toEqual({ signal });
	});
	it("emits text deltas, then accumulates a tool_use, usage and done", async () => {
		const chunks = [
			{ choices: [{ delta: { content: "Hel" } }] },
			{ choices: [{ delta: { content: "lo" } }] },
			{
				choices: [
					{
						delta: {
							tool_calls: [
								{
									index: 0,
									id: "call_1",
									function: { name: "upsert_menu", arguments: '{"id":' },
								},
							],
						},
					},
				],
			},
			{
				choices: [
					{
						delta: {
							tool_calls: [{ index: 0, function: { arguments: '"shop"}' } }],
						},
					},
				],
			},
			{
				choices: [{ delta: {}, finish_reason: "tool_calls" }],
				usage: {
					prompt_tokens: 12,
					completion_tokens: 7,
					prompt_tokens_details: { cached_tokens: 4 },
				},
			},
		];
		const p = new OpenAICompatibleProvider(cfg, fakeClient(chunks));
		const events = await collect(
			p.streamTurn({
				messages: [{ role: "user", content: "hi" }],
				tools: [],
				model: "m",
			}),
		);

		const text = events
			.filter((e) => e.type === "text")
			// biome-ignore lint/suspicious/noExplicitAny: event narrowed by filter above
			.map((e: any) => e.text)
			.join("");
		expect(text).toBe("Hello");

		// biome-ignore lint/suspicious/noExplicitAny: assertion convenience
		const toolUse = events.find((e) => e.type === "tool_use") as any;
		expect(toolUse).toMatchObject({ id: "call_1", name: "upsert_menu" });
		expect(toolUse.input).toEqual({ id: "shop" });

		// biome-ignore lint/suspicious/noExplicitAny: assertion convenience
		const usage = events.find((e) => e.type === "usage") as any;
		expect(usage.usage).toEqual({
			inputTokens: 12,
			outputTokens: 7,
			cachedInputTokens: 4,
		});

		// biome-ignore lint/suspicious/noExplicitAny: assertion convenience
		const done = events.find((e) => e.type === "done") as any;
		expect(done.stopReason).toBe("tool_calls");
	});

	it("passes mapped messages + tools to the client", async () => {
		// biome-ignore lint/suspicious/noExplicitAny: captured raw SDK params
		let received: any;
		const client = {
			chat: {
				completions: {
					// biome-ignore lint/suspicious/noExplicitAny: injected fake client mimics the openai SDK shape
					create: async (params: any) => {
						received = params;
						return fakeStream([
							{ choices: [{ delta: {}, finish_reason: "stop" }] },
						]);
					},
				},
			},
			// biome-ignore lint/suspicious/noExplicitAny: injected fake client mimics the openai SDK shape
		} as any;
		const p = new OpenAICompatibleProvider(cfg, client);
		await collect(
			p.streamTurn({
				messages: [
					{ role: "system", content: "sys" },
					{ role: "user", content: "u" },
					{
						role: "assistant",
						content: null,
						toolCalls: [{ id: "c1", name: "get_menu", arguments: "{}" }],
					},
					{ role: "tool", toolCallId: "c1", content: "result" },
				],
				tools: [
					{
						name: "get_menu",
						description: "d",
						parameters: { type: "object", properties: {} },
					},
				],
				model: "m",
			}),
		);
		expect(received.model).toBe("m");
		expect(received.stream).toBe(true);
		expect(received.messages[0]).toEqual({ role: "system", content: "sys" });
		expect(received.messages[2]).toEqual({
			role: "assistant",
			content: null,
			tool_calls: [
				{
					id: "c1",
					type: "function",
					function: { name: "get_menu", arguments: "{}" },
				},
			],
		});
		expect(received.messages[3]).toEqual({
			role: "tool",
			tool_call_id: "c1",
			content: "result",
		});
		expect(received.tools[0]).toEqual({
			type: "function",
			function: {
				name: "get_menu",
				description: "d",
				parameters: { type: "object", properties: {} },
			},
		});
	});
});
