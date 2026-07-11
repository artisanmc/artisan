import { afterEach, describe, expect, it, vi } from "vitest";
import { getBalance, getModels, setPreferredModel } from "./aiUser";

afterEach(() => vi.unstubAllGlobals());
function stub(status: number, body: unknown) {
  const f = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", f);
  return f;
}

describe("aiUser client", () => {
  it("getModels returns the payload and sends cookie credentials", async () => {
    const f = stub(200, { models: [{ id: "m1" }], defaultModelId: "m1", preferredModelId: null });
    const r = await getModels();
    expect(r?.defaultModelId).toBe("m1");
    expect((f.mock.calls[0][1] as RequestInit).credentials).toBe("include");
  });

  it("getBalance returns the bucket breakdown", async () => {
    stub(200, { balance: 250, total: 250, subscription: 100, rollover: 0, topup: 150 });
    const b = await getBalance("proj1");
    expect(b?.total).toBe(250);
    expect(b?.subscription).toBe(100);
    expect(b?.topup).toBe(150);
  });

  it("getBalance returns null on 403", async () => {
    stub(403, { error: "forbidden" });
    expect(await getBalance("proj1")).toBeNull();
  });

  it("setPreferredModel true on 200, false on 403", async () => {
    stub(200, { ok: true });
    expect(await setPreferredModel("m1")).toBe(true);
    stub(403, { error: "user_session_required" });
    expect(await setPreferredModel("m1")).toBe(false);
  });
});
