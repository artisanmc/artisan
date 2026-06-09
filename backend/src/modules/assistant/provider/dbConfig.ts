import { getSetting } from "../../../lib/appSettings";
import { decryptSecret, isSecretsConfigured } from "../../../lib/secretBox";
import { presetBaseUrl, resolveProviderConfig, type ProviderConfig } from "./config";

export const ASSISTANT_SETTING_KEY = "assistant";
export interface StoredAssistantConfig {
  provider?: string; baseUrl?: string; model?: string; apiKeyEncrypted?: string;
}

/** DB config (decrypted) when present & usable; otherwise the env fallback. */
export async function loadAssistantProviderConfig(): Promise<ProviderConfig | null> {
  const stored = await getSetting<StoredAssistantConfig>(ASSISTANT_SETTING_KEY);
  if (stored && isSecretsConfigured()) {
    const baseURL = stored.baseUrl || presetBaseUrl(stored.provider);
    const model = stored.model ?? "";
    let apiKey = "";
    if (stored.apiKeyEncrypted) { try { apiKey = decryptSecret(stored.apiKeyEncrypted); } catch { apiKey = ""; } }
    const isLocal = baseURL.includes("localhost") || baseURL.includes("127.0.0.1");
    if (model && (apiKey || isLocal)) return { baseURL, model, apiKey };
  }
  return resolveProviderConfig(process.env as Record<string, string | undefined>);
}
