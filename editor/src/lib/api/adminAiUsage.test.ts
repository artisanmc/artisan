import { afterEach, describe, expect, it, vi } from "vitest";
import { getUsageLogs, getUsageSummary, grantCredits, usageLogsCsvUrl } from "./adminAiUsage";

afterEach(() => vi.unstubAllGlobals());
function stub(status: number, body: unknown) {
  const f = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", f);
  return f;
}

describe("adminAiUsage client", () => {
  it("getUsageSummary passes from/to as query params", async () => {
    const f = stub(200, { totals: { turns: 3 }, byModel: [], byProvider: [], daily: [] });
    const s = await getUsageSummary("2020-01-01T00:00:00Z", "2020-02-01T00:00:00Z");
    expect(s?.totals.turns).toBe(3);
    const url = f.mock.calls[0][0] as string;
    expect(url).toContain("from=2020-01-01");
    expect(url).toContain("to=2020-02-01");
  });

  it("getUsageLogs threads filters + cursor + limit", async () => {
    const f = stub(200, { logs: [], nextCursor: null });
    await getUsageLogs({ provider: "openai", status: "error" }, "cur1", 25);
    const url = f.mock.calls[0][0] as string;
    expect(url).toContain("provider=openai");
    expect(url).toContain("status=error");
    expect(url).toContain("cursor=cur1");
    expect(url).toContain("limit=25");
  });

  it("usageLogsCsvUrl appends format=csv and filters", () => {
    const url = usageLogsCsvUrl({ status: "success" });
    expect(url).toContain("/admin/ai/usage/logs");
    expect(url).toContain("format=csv");
    expect(url).toContain("status=success");
  });

  it("grantCredits posts amount and returns balance", async () => {
    const f = stub(200, { ok: true, balance: 500 });
    const res = await grantCredits("net1", 500, "starter");
    expect(res).toEqual({ ok: true, data: { ok: true, balance: 500 } });
    expect(JSON.parse((f.mock.calls[0][1] as RequestInit).body as string)).toEqual({
      networkId: "net1", amount: 500, note: "starter",
    });
  });

  it("grantCredits surfaces invalid_amount on 400", async () => {
    stub(400, { error: "invalid_amount" });
    const res = await grantCredits("net1", -5);
    expect(res).toEqual({ ok: false, status: 400, error: "invalid_amount" });
  });
});
