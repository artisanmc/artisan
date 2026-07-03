import { afterEach, describe, expect, it, vi } from "vitest";
import { getBalance, getModels, setPreferredModel } from "./aiUser";

afterEach(() => vi.unstubAllGlobals());
function stub(status: number, body: unknown) {
  const f = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", f);
  return f;
}

describe("aiUser client", () => {
  it("getModels returns the payload; sends bearer when token present", async () => {
    const f = stub(200, { models: [{ id: "m1" }], defaultModelId: "m1", preferredModelId: null });
    const r = await getModels("tok123");
    expect(r?.defaultModelId).toBe("m1");
    expect((f.mock.calls[0][1] as RequestInit).headers).toMatchObject({ Authorization: "Bearer tok123" });
  });

  it("getModels uses cookie (no Authorization) when token is null", async () => {
    const f = stub(200, { models: [], defaultModelId: null, preferredModelId: null });
    await getModels(null);
    const init = f.mock.calls[0][1] as RequestInit;
    expect(init.credentials).toBe("include");
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it("getBalance returns the number", async () => {
    stub(200, { balance: 250 });
    expect(await getBalance("t", "proj1")).toBe(250);
  });

  it("getBalance returns null on 403", async () => {
    stub(403, { error: "forbidden" });
    expect(await getBalance("t", "proj1")).toBeNull();
  });

  it("setPreferredModel true on 200, false on 403", async () => {
    stub(200, { ok: true });
    expect(await setPreferredModel(null, "m1")).toBe(true);
    stub(403, { error: "user_session_required" });
    expect(await setPreferredModel("t", "m1")).toBe(false);
  });
});
