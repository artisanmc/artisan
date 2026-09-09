import OpenAI from "openai";
import type { ProviderConfig } from "./config";
import {
	type LlmMessage,
	type LlmProvider,
	LlmRequestError,
	type LlmStreamEvent,
	type ToolDef,
} from "./types";

type OpenAIClient = Pick<OpenAI, "chat">;

export class OpenAICompatibleProvider implements LlmProvider {
	private client: OpenAIClient;
	private cfg: ProviderConfig;

	constructor(cfg: ProviderConfig, client?: OpenAIClient) {
		this.cfg = cfg;
		this.client =
			client ?? new OpenAI({ baseURL: cfg.baseURL, apiKey: cfg.apiKey || "x" });
	}

	async *streamTurn(args: {
		messages: LlmMessage[];
		tools: ToolDef[];
		model: string;
		signal?: AbortSignal;
		maxOutputTokens?: number;
		maxRetries?: number;
		requireExplicitFinish?: boolean;
		maxResponseBytes?: number;
	}): AsyncIterable<LlmStreamEvent> {
		const messages = args.messages.map((m) => {
			switch (m.role) {
				case "system":
					return { role: "system", content: m.content };
				case "user":
					return { role: "user", content: m.content };
				case "tool":
					return {
						role: "tool",
						tool_call_id: m.toolCallId,
						content: m.content,
					};
				case "assistant":
					return {
						role: "assistant",
						content: m.content,
						...(m.toolCalls && m.toolCalls.length > 0
							? {
									tool_calls: m.toolCalls.map((tc) => ({
										id: tc.id,
										type: "function",
										function: { name: tc.name, arguments: tc.arguments },
									})),
								}
							: {}),
					};
			}
		});

		const tools =
			args.tools.length > 0
				? args.tools.map((t) => ({
						type: "function",
						function: {
							name: t.name,
							description: t.description,
							parameters: t.parameters,
						},
					}))
				: undefined;

		const stream = await this.client.chat.completions.create(
			{
				model: args.model,
				messages: messages as never,
				tools: tools as never,
				stream: true,
				stream_options: { include_usage: true },
				...(args.maxOutputTokens === undefined
					? {}
					: { max_tokens: args.maxOutputTokens }),
			} as never,
			{
				signal: args.signal,
				...(args.maxRetries === undefined
					? {}
					: { maxRetries: args.maxRetries }),
			},
		);

		const acc = new Map<number, { id: string; name: string; args: string }>();
		let usage: {
			type: "usage";
			usage: {
				inputTokens: number;
				outputTokens: number;
				cachedInputTokens?: number;
			};
		} | null = null;
		let stopReason = "stop";
		let explicitlyFinished = false;
		let responseBytes = 0;

		// biome-ignore lint/suspicious/noExplicitAny: openai stream chunks are dynamically shaped
		for await (const chunk of stream as unknown as AsyncIterable<any>) {
			const choice = chunk.choices?.[0];
			const delta = choice?.delta;
			if (args.maxResponseBytes !== undefined) {
				responseBytes += Buffer.byteLength(delta?.content ?? "");
				for (const tc of delta?.tool_calls ?? []) {
					responseBytes +=
						Buffer.byteLength(tc.id ?? "") +
						Buffer.byteLength(tc.function?.name ?? "") +
						Buffer.byteLength(tc.function?.arguments ?? "");
				}
				if (responseBytes > args.maxResponseBytes)
					throw new LlmRequestError("response_buffer_exceeded");
			}
			if (delta?.content) yield { type: "text", text: delta.content };
			if (delta?.tool_calls) {
				for (const tc of delta.tool_calls) {
					const cur = acc.get(tc.index) ?? { id: "", name: "", args: "" };
					if (tc.id) cur.id = tc.id;
					if (tc.function?.name) cur.name = tc.function.name;
					if (tc.function?.arguments) cur.args += tc.function.arguments;
					acc.set(tc.index, cur);
				}
			}
			if (choice?.finish_reason) {
				stopReason = choice.finish_reason;
				explicitlyFinished = true;
			}
			if (chunk.usage) {
				usage = {
					type: "usage",
					usage: {
						inputTokens: chunk.usage.prompt_tokens ?? 0,
						outputTokens: chunk.usage.completion_tokens ?? 0,
						...(chunk.usage.prompt_tokens_details?.cached_tokens !== undefined
							? {
									cachedInputTokens:
										chunk.usage.prompt_tokens_details.cached_tokens,
								}
							: {}),
					},
				};
			}
		}

		if (usage) yield usage;
		if (args.requireExplicitFinish && !explicitlyFinished)
			throw new LlmRequestError("provider_network_error");
		for (const tc of [...acc.values()].filter((t) => t.id)) {
			let input: unknown = {};
			try {
				input = tc.args ? JSON.parse(tc.args) : {};
			} catch {
				input = { __raw: tc.args };
			}
			yield { type: "tool_use", id: tc.id, name: tc.name, input };
		}
		yield { type: "done", stopReason };
	}
}
