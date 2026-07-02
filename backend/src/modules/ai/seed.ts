import { getSetting, setSetting } from "../../lib/appSettings";
import { encryptSecret, isSecretsConfigured } from "../../lib/secretBox";
import { presetBaseUrl } from "../assistant/provider/config";
import { ASSISTANT_SETTING_KEY, type StoredAssistantConfig } from "../assistant/provider/dbConfig";
import { createModel, listModels, setDefaultModel } from "./modelRepo";
import { AI_PROVIDERS_SETTING_KEY, getStoredProviders, PROVIDER_PRESETS } from "./providers";

/**
 * One-shot migration of the pre-catalog assistant config (single global model in
 * app_settings.assistant, or ASSISTANT_* env) into the ai_models catalog.
 * Runs at boot; no-op once the catalog has any model. Prices are seeded at 0 —
 * the admin fills them in (debits stay 0 until then, and networks without a
 * grant are blocked anyway).
 */
export async function seedAiCatalogFromLegacy(): Promise<void> {
	if ((await listModels()).length > 0) return;

	const stored = await getSetting<StoredAssistantConfig>(ASSISTANT_SETTING_KEY);
	const slug = stored?.provider ?? process.env.ASSISTANT_PROVIDER ?? "openai";
	const modelId = stored?.model || process.env.ASSISTANT_MODEL || "";
	if (!modelId) return;
	const baseUrl =
		stored?.baseUrl ||
		process.env.ASSISTANT_BASE_URL ||
		PROVIDER_PRESETS[slug]?.baseUrl ||
		presetBaseUrl(slug);
	let apiKeyEncrypted = stored?.apiKeyEncrypted;
	if (!apiKeyEncrypted && process.env.ASSISTANT_API_KEY && isSecretsConfigured()) {
		apiKeyEncrypted = encryptSecret(process.env.ASSISTANT_API_KEY);
	}

	const providers = await getStoredProviders();
	if (!providers[slug]) {
		providers[slug] = {
			label: PROVIDER_PRESETS[slug]?.label ?? slug,
			baseUrl,
			...(apiKeyEncrypted ? { apiKeyEncrypted } : {}),
		};
		await setSetting(AI_PROVIDERS_SETTING_KEY, providers, null);
	}

	const m = await createModel({
		displayName: modelId,
		description: "",
		badge: "balanced",
		provider: slug,
		providerModelId: modelId,
		creditsPerMInput: 0,
		creditsPerMOutput: 0,
		realUsdPerMInput: 0,
		realUsdPerMOutput: 0,
		isActive: true,
	});
	await setDefaultModel(m.id);
	console.log(`[ai] seeded model catalog from legacy assistant config (${slug}/${modelId})`);
}
