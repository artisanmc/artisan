import { describe, expect, it } from "bun:test";
import { resolveProviderConfig } from "./config";

describe("resolveProviderConfig", () => {
  it("returns null when no api key and not a local base url (feature disabled)", () => {
    expect(resolveProviderConfig({})).toBeNull();
  });

  it("resolves the openai preset by default", () => {
    const c = resolveProviderConfig({ ASSISTANT_API_KEY: "k" })!;
    expect(c.baseURL).toBe("https://api.openai.com/v1");
    expect(c.model).toBe("gpt-4.1-mini");
    expect(c.apiKey).toBe("k");
  });

  it("resolves the deepseek preset", () => {
    const c = resolveProviderConfig({ ASSISTANT_API_KEY: "k", ASSISTANT_PROVIDER: "deepseek" })!;
    expect(c.baseURL).toBe("https://api.deepseek.com/v1");
    expect(c.model).toBe("deepseek-chat");
  });

  it("honours explicit base url + model overrides", () => {
    const c = resolveProviderConfig({
      ASSISTANT_API_KEY: "k",
      ASSISTANT_PROVIDER: "mistral",
      ASSISTANT_BASE_URL: "https://example.test/v1",
      ASSISTANT_MODEL: "custom-model",
    })!;
    expect(c.baseURL).toBe("https://example.test/v1");
    expect(c.model).toBe("custom-model");
  });

  it("allows a local base url without an api key", () => {
    const c = resolveProviderConfig({ ASSISTANT_PROVIDER: "local" })!;
    expect(c.baseURL).toBe("http://localhost:11434/v1");
    expect(c.apiKey).toBe(""); // local servers often need no key
  });

  it("falls back to openai preset for an unknown provider name", () => {
    const c = resolveProviderConfig({ ASSISTANT_API_KEY: "k", ASSISTANT_PROVIDER: "bogus" })!;
    expect(c.baseURL).toBe("https://api.openai.com/v1");
  });
});
