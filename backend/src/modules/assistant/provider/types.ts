export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
}

export type LlmStreamEvent =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "usage"; usage: LlmUsage }
  | { type: "done"; stopReason: string };

export type LlmMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content: string | null;
      toolCalls?: { id: string; name: string; arguments: string }[];
    }
  | { role: "tool"; toolCallId: string; content: string };

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
  }): AsyncIterable<LlmStreamEvent>;
}
