import { afterEach, beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../../../db/index";
import { appSettings } from "../../../db/schema";
import { setSetting } from "../../../lib/appSettings";
import { encryptSecret } from "../../../lib/secretBox";
import { ASSISTANT_SETTING_KEY, loadAssistantProviderConfig } from "./dbConfig";

beforeAll(() => { process.env.CONFIG_ENC_KEY = "0".repeat(64); });
afterEach(async () => {
  await db.delete(appSettings).where(eq(appSettings.key, ASSISTANT_SETTING_KEY));
  delete process.env.ASSISTANT_API_KEY; delete process.env.ASSISTANT_PROVIDER; delete process.env.ASSISTANT_MODEL;
});

describe("loadAssistantProviderConfig", () => {
  it("uses DB config with a decrypted key", async () => {
    await setSetting(ASSISTANT_SETTING_KEY, { provider: "deepseek", model: "deepseek-chat", apiKeyEncrypted: encryptSecret("sk-db") }, null);
    const cfg = await loadAssistantProviderConfig();
    expect(cfg).toEqual({ baseURL: "https://api.deepseek.com/v1", model: "deepseek-chat", apiKey: "sk-db" });
  });
  it("falls back to env when no DB config", async () => {
    process.env.ASSISTANT_API_KEY = "sk-env"; process.env.ASSISTANT_PROVIDER = "openai";
    const cfg = await loadAssistantProviderConfig();
    expect(cfg?.apiKey).toBe("sk-env");
    expect(cfg?.baseURL).toBe("https://api.openai.com/v1");
  });
});
