import { afterEach, beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../../db/index";
import { aiModels, appSettings } from "../../db/schema";
import { setSetting } from "../../lib/appSettings";
import { ASSISTANT_SETTING_KEY } from "../assistant/provider/dbConfig";
import { createModel, listModels } from "./modelRepo";
import { AI_PROVIDERS_SETTING_KEY, getStoredProviders } from "./providers";
import { seedAiCatalogFromLegacy } from "./seed";

beforeAll(() => {
	process.env.CONFIG_ENC_KEY = "0".repeat(64);
});

afterEach(async () => {
	await db.delete(aiModels);
	await db.delete(appSettings).where(eq(appSettings.key, ASSISTANT_SETTING_KEY));
	await db.delete(appSettings).where(eq(appSettings.key, AI_PROVIDERS_SETTING_KEY));
	delete process.env.ASSISTANT_PROVIDER;
	delete process.env.ASSISTANT_MODEL;
	delete process.env.ASSISTANT_API_KEY;
	delete process.env.ASSISTANT_BASE_URL;
});

describe("seedAiCatalogFromLegacy", () => {
	it("seeds provider entry + default model from stored legacy config", async () => {
		await setSetting(ASSISTANT_SETTING_KEY, {
			provider: "deepseek", baseUrl: "", model: "deepseek-chat", apiKeyEncrypted: "iv:tag:ct",
		}, null);
		await seedAiCatalogFromLegacy();
		const models = await listModels();
		expect(models.length).toBe(1);
		expect(models[0].providerModelId).toBe("deepseek-chat");
		expect(models[0].provider).toBe("deepseek");
		expect(models[0].isDefault).toBe(true);
		expect(models[0].isActive).toBe(true);
		const providers = await getStoredProviders();
		expect(providers.deepseek.apiKeyEncrypted).toBe("iv:tag:ct");
		expect(providers.deepseek.baseUrl).toContain("deepseek");
	});

	it("seeds from env when no stored config", async () => {
		process.env.ASSISTANT_PROVIDER = "openai";
		process.env.ASSISTANT_MODEL = "gpt-4.1-mini";
		process.env.ASSISTANT_API_KEY = "sk-env-key";
		await seedAiCatalogFromLegacy();
		const models = await listModels();
		expect(models.length).toBe(1);
		expect(models[0].providerModelId).toBe("gpt-4.1-mini");
		const providers = await getStoredProviders();
		expect(providers.openai.apiKeyEncrypted).toBeDefined();
		expect(JSON.stringify(providers)).not.toContain("sk-env-key");
	});

	it("no-op when the catalog already has a model", async () => {
		await createModel({
			displayName: "Existing", description: "", badge: "cheap", provider: "openai",
			providerModelId: "x", creditsPerMInput: 1, creditsPerMOutput: 1,
			realUsdPerMInput: 0, realUsdPerMOutput: 0, isActive: true,
		});
		await setSetting(ASSISTANT_SETTING_KEY, { provider: "openai", model: "gpt-4.1-mini" }, null);
		await seedAiCatalogFromLegacy();
		expect((await listModels()).length).toBe(1);
	});

	it("no-op when there is nothing to seed", async () => {
		await seedAiCatalogFromLegacy();
		expect((await listModels()).length).toBe(0);
	});
});
