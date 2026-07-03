import { afterEach, describe, expect, it, vi } from "vitest";
import { createModel, listModels, putProvider, setDefaultModel, testModel } from "./adminModels";

afterEach(() => vi.unstubAllGlobals());

function stub(status: number, body: unknown) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("adminModels client", () => {
  it("listModels returns models array on 200", async () => {
    stub(200, { models: [{ id: "m1", displayName: "M" }] });
    const models = await listModels();
    expect(models?.[0].id).toBe("m1");
  });

  it("listModels returns null on error", async () => {
    stub(500, {});
    expect(await listModels()).toBeNull();
  });

  it("createModel posts with credentials + JSON body, returns ok+data", async () => {
    const f = stub(200, { id: "m2", displayName: "New" });
    const res = await createModel({
      displayName: "New", description: "", badge: "balanced", provider: "anthropic",
      providerModelId: "claude", creditsPerMInput: 1, creditsPerMOutput: 1,
      realUsdPerMInput: 0, realUsdPerMOutput: 0, isActive: true,
    });
    expect(res).toEqual({ ok: true, data: { id: "m2", displayName: "New" } });
    const [, init] = f.mock.calls[0];
    expect(init).toMatchObject({ method: "POST", credentials: "include" });
    expect(JSON.parse((init as RequestInit).body as string).displayName).toBe("New");
  });

  it("createModel surfaces backend error code on 400", async () => {
    stub(400, { error: "provider_key_missing" });
    const res = await createModel({} as never);
    expect(res).toEqual({ ok: false, status: 400, error: "provider_key_missing" });
  });

  it("setDefaultModel PUTs to /:id/default", async () => {
    const f = stub(200, { ok: true });
    await setDefaultModel("m1");
    expect(f.mock.calls[0][0]).toContain("/admin/ai/models/m1/default");
    expect(f.mock.calls[0][1]).toMatchObject({ method: "PUT" });
  });

  it("testModel returns the result payload", async () => {
    stub(200, { ok: true, latencyMs: 120, inputTokens: 12, outputTokens: 2, creditsCost: 3, realCostMicroUsd: 66 });
    const r = await testModel("m1");
    expect(r.ok).toBe(true);
    expect(r.creditsCost).toBe(3);
  });

  it("putProvider returns encryption_not_configured on 503", async () => {
    stub(503, { error: "encryption_not_configured" });
    const res = await putProvider("openai", { apiKey: "sk" });
    expect(res).toEqual({ ok: false, status: 503, error: "encryption_not_configured" });
  });
});
