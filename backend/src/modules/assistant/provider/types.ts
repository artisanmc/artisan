export interface LlmUsage {
	inputTokens: number;
	outputTokens: number;
	cachedInputTokens?: number;
}

export class LlmRequestError extends Error {
	constructor(
		public readonly code:
			| "provider_network_error"
			| "provider_timeout"
			| "provider_output_limit"
			| "response_buffer_exceeded",
	) {
		super(code);
		this.name = "LlmRequestError";
	}
}

export type LlmStreamEvent =
	| { type: "text"; text: string }
	| { type: "reasoning"; text: string }
	| { type: "tool_use"; id: string; name: string; input: unknown }
	| { type: "usage"; usage: LlmUsage }
	| { type: "done"; stopReason: string };

/** Count retained payload, not stream framing repeated for every token. */
export function streamPayloadBytes(event: LlmStreamEvent): number {
	if (event.type === "text" || event.type === "reasoning")
		return Buffer.byteLength(event.text);
	if (event.type === "tool_use")
		return (
			Buffer.byteLength(event.id) +
			Buffer.byteLength(event.name) +
			Buffer.byteLength(JSON.stringify(event.input) ?? "")
		);
	return 0;
}

export type LlmMessage =
	| { role: "system"; content: string }
	| { role: "user"; content: string }
	| {
			role: "assistant";
			content: string | null;
			reasoningContent?: string;
			toolCalls?: { id: string; name: string; arguments: string }[];
	  }
	| { role: "tool"; toolCallId: string; content: string; isError?: boolean };

export interface ToolDef {
	name: string;
	description: string;
	/** JSON Schema des paramètres. */
	parameters: Record<string, unknown>;
}

export interface LlmProvider {
	/** Un tour : messages (le 1er est généralement le system) + tools → flux d'events.
	 *  Le caller exécute les tools et renvoie les résultats (role "tool") au tour suivant. */
	streamTurn(args: {
		messages: LlmMessage[];
		tools: ToolDef[];
		model: string;
		signal?: AbortSignal;
		maxOutputTokens?: number;
		maxRetries?: number;
		requireExplicitFinish?: boolean;
		maxResponseBytes?: number;
		includeReasoning?: boolean;
		/** Real streamed payload progress, including incomplete tool arguments. */
		onProgress?: () => void;
	}): AsyncIterable<LlmStreamEvent>;
}
