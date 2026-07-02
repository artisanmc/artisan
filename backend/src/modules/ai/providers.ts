import { getSetting, setSetting } from "../../lib/appSettings";
import { decryptSecret, encryptSecret, isSecretsConfigured } from "../../lib/secretBox";
import { OpenAICompatibleProvider } from "../assistant/provider/openaiCompatible";
import type { LlmProvider } from "../assistant/provider/types";
import type { AiModel } from "./modelRepo";

export const AI_PROVIDERS_SETTING_KEY = "ai_providers";

export interface StoredAiProvider {
	label: string;
	baseUrl: string;
	apiKeyEncrypted?: string;
}
export type StoredAiProviders = Record<string, StoredAiProvider>;

/** Built-in slugs shown by default in the admin UI. All expose an
 *  OpenAI-compatible chat-completions endpoint. Custom slugs are allowed too. */
export const PROVIDER_PRESETS: Record<string, { label: string; baseUrl: string }> = {
	anthropic: { label: "Anthropic", baseUrl: "https://api.anthropic.com/v1" },
	openai: { label: "OpenAI", baseUrl: "https://api.openai.com/v1" },
	deepseek: { label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1" },
	google: { label: "Google", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai" },
};

function isLocalBaseUrl(u: string): boolean {
	return u.includes("localhost") || u.includes("127.0.0.1");
}

export async function getStoredProviders(): Promise<StoredAiProviders> {
	return (await getSetting<StoredAiProviders>(AI_PROVIDERS_SETTING_KEY)) ?? {};
}

export async function listProvidersForAdmin(): Promise<
	Record<string, { label: string; baseUrl: string; keySet: boolean; preset: boolean }>
> {
	const stored = await getStoredProviders();
	const out: Record<string, { label: string; baseUrl: string; keySet: boolean; preset: boolean }> = {};
	for (const [slug, p] of Object.entries(PROVIDER_PRESETS)) {
		out[slug] = { label: p.label, baseUrl: p.baseUrl, keySet: false, preset: true };
	}
	for (const [slug, s] of Object.entries(stored)) {
		out[slug] = {
			label: s.label || PROVIDER_PRESETS[slug]?.label || slug,
			baseUrl: s.baseUrl || PROVIDER_PRESETS[slug]?.baseUrl || "",
			keySet: !!s.apiKeyEncrypted,
			preset: slug in PROVIDER_PRESETS,
		};
	}
	return out;
}

/** Upsert a provider entry. Empty apiKey keeps the stored key (write-only). */
export async function putProvider(
	slug: string,
	input: { label?: string; baseUrl?: string; apiKey?: string },
	updatedBy: string | null,
): Promise<{ ok: true } | { ok: false; error: "encryption_not_configured" }> {
	const all = await getStoredProviders();
	const prev = all[slug];
	let apiKeyEncrypted = prev?.apiKeyEncrypted;
	if (input.apiKey) {
		if (!isSecretsConfigured()) return { ok: false, error: "encryption_not_configured" };
		apiKeyEncrypted = encryptSecret(input.apiKey);
	}
	all[slug] = {
		label: input.label ?? prev?.label ?? PROVIDER_PRESETS[slug]?.label ?? slug,
		baseUrl: input.baseUrl ?? prev?.baseUrl ?? "",
		...(apiKeyEncrypted ? { apiKeyEncrypted } : {}),
	};
	await setSetting(AI_PROVIDERS_SETTING_KEY, all, updatedBy);
	return { ok: true };
}

/** A model on this provider can actually run: stored key, or local endpoint. */
export async function hasUsableKey(slug: string): Promise<boolean> {
	const stored = (await getStoredProviders())[slug];
	if (stored?.apiKeyEncrypted) return true;
	const baseUrl = stored?.baseUrl || PROVIDER_PRESETS[slug]?.baseUrl || "";
	return isLocalBaseUrl(baseUrl);
}

/** Instantiate the (single) OpenAI-compat provider for a model's credentials. */
export async function createProviderFor(model: AiModel): Promise<LlmProvider | null> {
	const stored = (await getStoredProviders())[model.provider];
	const baseURL = stored?.baseUrl || PROVIDER_PRESETS[model.provider]?.baseUrl || "";
	if (!baseURL) return null;
	let apiKey = "";
	if (stored?.apiKeyEncrypted && isSecretsConfigured()) {
		try {
			apiKey = decryptSecret(stored.apiKeyEncrypted);
		} catch {
			apiKey = "";
		}
	}
	if (!apiKey && !isLocalBaseUrl(baseURL)) return null;
	return new OpenAICompatibleProvider({ baseURL, model: model.providerModelId, apiKey });
}
