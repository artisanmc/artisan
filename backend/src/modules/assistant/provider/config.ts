import type { LlmProvider } from "./types";
import { OpenAICompatibleProvider } from "./openaiCompatible";

interface Preset {
  baseURL: string;
  defaultModel: string;
}

const PRESETS: Record<string, Preset> = {
  openai: { baseURL: "https://api.openai.com/v1", defaultModel: "gpt-4.1-mini" },
  deepseek: { baseURL: "https://api.deepseek.com/v1", defaultModel: "deepseek-chat" },
  mistral: { baseURL: "https://api.mistral.ai/v1", defaultModel: "mistral-large-latest" },
  openrouter: { baseURL: "https://openrouter.ai/api/v1", defaultModel: "openai/gpt-4.1-mini" },
  local: { baseURL: "http://localhost:11434/v1", defaultModel: "llama3.1" },
};

export interface ProviderConfig {
  baseURL: string;
  model: string;
  apiKey: string;
}

type Env = Record<string, string | undefined>;

/** Resolve the active provider from env, or null when the feature is disabled (no key + not local). */
export function resolveProviderConfig(env: Env): ProviderConfig | null {
  const preset = PRESETS[env.ASSISTANT_PROVIDER ?? "openai"] ?? PRESETS.openai;
  const baseURL = env.ASSISTANT_BASE_URL || preset.baseURL;
  const apiKey = env.ASSISTANT_API_KEY ?? "";
  const isLocal = baseURL.includes("localhost") || baseURL.includes("127.0.0.1");
  if (!apiKey && !isLocal) return null;
  const model = env.ASSISTANT_MODEL || preset.defaultModel;
  return { baseURL, model, apiKey };
}

export function createProvider(cfg: ProviderConfig): LlmProvider {
  return new OpenAICompatibleProvider(cfg);
}

/** Default base URL for a provider preset (falls back to openai). */
export function presetBaseUrl(provider: string | undefined): string {
  return (PRESETS[provider ?? "openai"] ?? PRESETS.openai).baseURL;
}
