import { afterEach, beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../../db/index";
import { appSettings } from "../../db/schema";
import type { AiModel } from "./modelRepo";
import {
	AI_PROVIDERS_SETTING_KEY,
	createProviderFor,
	getStoredProviders,
	hasUsableKey,
	listProvidersForAdmin,
	putProvider,
} from "./providers";
import { AI_SETTINGS_KEY, DEFAULT_AI_SETTINGS, getAiSettings, putAiSettings } from "./settings";

beforeAll(() => {
	process.env.CONFIG_ENC_KEY = "0".repeat(64);
});

afterEach(async () => {
	await db.delete(appSettings).where(eq(appSettings.key, AI_PROVIDERS_SETTING_KEY));
	await db.delete(appSettings).where(eq(appSettings.key, AI_SETTINGS_KEY));
});

describe("providers config", () => {
	it("putProvider encrypts the key; admin listing only exposes keySet", async () => {
		const res = await putProvider("anthropic", { apiKey: "sk-ant-secret" }, null);
		expect(res.ok).toBe(true);
		const stored = await getStoredProviders();
		expect(stored.anthropic.apiKeyEncrypted).toBeDefined();
		expect(JSON.stringify(stored)).not.toContain("sk-ant-secret");
		const admin = await listProvidersForAdmin();
		expect(admin.anthropic.keySet).toBe(true);
		expect(JSON.stringify(admin)).not.toContain("sk-ant-secret");
	});

	it("putProvider with empty apiKey keeps the previously stored key", async () => {
		await putProvider("openai", { apiKey: "sk-first" }, null);
		await putProvider("openai", { baseUrl: "https://proxy.example/v1", apiKey: "" }, null);
		const stored = await getStoredProviders();
		expect(stored.openai.baseUrl).toBe("https://proxy.example/v1");
		expect(stored.openai.apiKeyEncrypted).toBeDefined();
	});

	it("presets appear in the admin listing without a stored entry", async () => {
		const admin = await listProvidersForAdmin();
		expect(admin.deepseek.preset).toBe(true);
		expect(admin.deepseek.keySet).toBe(false);
		expect(admin.deepseek.baseUrl).toContain("deepseek");
	});

	it("hasUsableKey: stored key OR local baseUrl", async () => {
		expect(await hasUsableKey("google")).toBe(false);
		await putProvider("google", { apiKey: "g-key" }, null);
		expect(await hasUsableKey("google")).toBe(true);
		await putProvider("ollama", { label: "Ollama", baseUrl: "http://localhost:11434/v1" }, null);
		expect(await hasUsableKey("ollama")).toBe(true);
	});

	it("createProviderFor returns null when the provider has no usable key", async () => {
		const m = { provider: "openai", providerModelId: "gpt-x" } as AiModel;
		expect(await createProviderFor(m)).toBeNull();
		await putProvider("openai", { apiKey: "sk-yes" }, null);
		expect(await createProviderFor(m)).not.toBeNull();
	});
});

describe("ai settings", () => {
	it("defaults when nothing stored", async () => {
		expect(await getAiSettings()).toEqual(DEFAULT_AI_SETTINGS);
	});
	it("putAiSettings patches and persists", async () => {
		await putAiSettings({ maxCreditsPerTurn: 50 }, null);
		const s = await getAiSettings();
		expect(s.maxCreditsPerTurn).toBe(50);
		expect(s.creditUsdMicroRate).toBe(DEFAULT_AI_SETTINGS.creditUsdMicroRate);
	});
});
