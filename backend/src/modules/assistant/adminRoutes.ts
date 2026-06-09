import { Hono } from "hono";
import { getSetting, setSetting } from "../../lib/appSettings";
import { encryptSecret, isSecretsConfigured } from "../../lib/secretBox";
import { createProvider, presetBaseUrl } from "./provider/config";
import type { LlmProvider } from "./provider/types";
import { ASSISTANT_SETTING_KEY, type StoredAssistantConfig } from "./provider/dbConfig";

let testProvider: LlmProvider | null = null;
export function __setTestProviderForTests(p: LlmProvider | null): void { testProvider = p; }

export function buildAssistantAdminRouter(): Hono {
  const r = new Hono();

  r.get("/assistant-config", async (c) => {
    const stored = await getSetting<StoredAssistantConfig>(ASSISTANT_SETTING_KEY);
    return c.json({
      provider: stored?.provider ?? process.env.ASSISTANT_PROVIDER ?? "openai",
      baseUrl: stored?.baseUrl ?? "",
      model: stored?.model ?? process.env.ASSISTANT_MODEL ?? "",
      keySet: !!stored?.apiKeyEncrypted || !!process.env.ASSISTANT_API_KEY,
    });
  });

  r.put("/assistant-config", async (c) => {
    const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
    const provider = typeof body.provider === "string" ? body.provider : "openai";
    const baseUrl = typeof body.baseUrl === "string" ? body.baseUrl : "";
    const model = typeof body.model === "string" ? body.model : "";
    const apiKey = typeof body.apiKey === "string" ? body.apiKey : "";

    const prev = await getSetting<StoredAssistantConfig>(ASSISTANT_SETTING_KEY);
    let apiKeyEncrypted = prev?.apiKeyEncrypted; // keep existing if no new key
    if (apiKey) {
      if (!isSecretsConfigured()) return c.json({ error: "encryption_not_configured" }, 503);
      apiKeyEncrypted = encryptSecret(apiKey);
    }
    const next: StoredAssistantConfig = { provider, baseUrl, model, apiKeyEncrypted };
    await setSetting(ASSISTANT_SETTING_KEY, next, c.get("user")?.id ?? null);
    return c.json({ provider, baseUrl, model, keySet: !!apiKeyEncrypted });
  });

  r.post("/assistant-config/test", async (c) => {
    const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
    const provider = typeof body.provider === "string" ? body.provider : "openai";
    const baseURL = (typeof body.baseUrl === "string" && body.baseUrl) || presetBaseUrl(provider);
    const model = typeof body.model === "string" ? body.model : "";
    const apiKey = typeof body.apiKey === "string" ? body.apiKey : "";
    if (!model) return c.json({ ok: false, error: "model_required" });
    try {
      const prov = testProvider ?? createProvider({ baseURL, model, apiKey });
      let sawDone = false;
      for await (const ev of prov.streamTurn({ messages: [{ role: "user", content: "Reply with OK." }], tools: [], model })) {
        if (ev.type === "done") sawDone = true;
      }
      return c.json({ ok: sawDone });
    } catch (e) {
      return c.json({ ok: false, error: e instanceof Error ? e.message : "error" });
    }
  });

  return r;
}
