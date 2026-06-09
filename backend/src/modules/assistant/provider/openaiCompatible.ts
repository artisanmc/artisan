import OpenAI from "openai";
import type { LlmMessage, LlmProvider, LlmStreamEvent, ToolDef } from "./types";
import type { ProviderConfig } from "./config";

type OpenAIClient = Pick<OpenAI, "chat">;

export class OpenAICompatibleProvider implements LlmProvider {
  private client: OpenAIClient;
  private cfg: ProviderConfig;

  constructor(cfg: ProviderConfig, client?: OpenAIClient) {
    this.cfg = cfg;
    this.client = client ?? new OpenAI({ baseURL: cfg.baseURL, apiKey: cfg.apiKey || "x" });
  }

  // eslint-disable-next-line require-yield
  async *streamTurn(_args: {
    messages: LlmMessage[];
    tools: ToolDef[];
    model: string;
  }): AsyncIterable<LlmStreamEvent> {
    throw new Error("not implemented (Task 2)");
  }
}
