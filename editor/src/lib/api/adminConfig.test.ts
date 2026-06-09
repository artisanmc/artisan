import { afterEach, describe, expect, it, vi } from "vitest";
import { getAssistantConfig, putAssistantConfig } from "./adminConfig";

afterEach(() => vi.unstubAllGlobals());

describe("adminConfig client", () => {
  it("getAssistantConfig returns the masked config", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ provider: "openai", baseUrl: "", model: "gpt-4.1-mini", keySet: true }),
            { status: 200 },
          ),
      ),
    );
    expect(await getAssistantConfig()).toEqual({
      provider: "openai",
      baseUrl: "",
      model: "gpt-4.1-mini",
      keySet: true,
    });
  });

  it("getAssistantConfig sends credentials:include", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ provider: "openai", baseUrl: "", model: "", keySet: false }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    await getAssistantConfig();
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: "include" });
  });

  it("getAssistantConfig returns null on non-ok responses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 403 })));
    expect(await getAssistantConfig()).toBeNull();
  });

  it("putAssistantConfig posts credentials + body", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ provider: "deepseek", baseUrl: "", model: "deepseek-chat", keySet: true }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const r = await putAssistantConfig({
      provider: "deepseek",
      baseUrl: "",
      model: "deepseek-chat",
      apiKey: "sk",
    });
    expect(r.ok).toBe(true);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "PUT", credentials: "include" });
    const sentBody = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(sentBody).toMatchObject({ provider: "deepseek", model: "deepseek-chat", apiKey: "sk" });
  });

  it("putAssistantConfig reports failure status", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })));
    const r = await putAssistantConfig({ provider: "openai", baseUrl: "", model: "x" });
    expect(r).toEqual({ ok: false, status: 503 });
  });
});
