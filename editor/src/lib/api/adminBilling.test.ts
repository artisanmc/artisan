import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createPack, createPlan, deactivatePack, deactivatePlan, getSales, grantCredits,
  listPacks, listPlans, updatePack, updatePlan,
} from "./adminBilling";

afterEach(() => vi.unstubAllGlobals());

function stub(status: number, body: unknown) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("adminBilling client", () => {
  it("listPacks unwraps {packs} and includes credentials", async () => {
    const f = stub(200, { packs: [{ id: "p1", name: "Pack" }] });
    const packs = await listPacks();
    expect(packs?.[0].id).toBe("p1");
    expect(f.mock.calls[0][0]).toContain("/api/v1/admin/billing/packs");
    expect(f.mock.calls[0][1]).toMatchObject({ credentials: "include" });
  });

  it("listPacks returns null on error", async () => {
    stub(500, {});
    expect(await listPacks()).toBeNull();
  });

  it("createPack posts with credentials + JSON body, returns ok+data", async () => {
    const f = stub(200, { id: "p2", name: "New" });
    const res = await createPack({ name: "New", priceCents: 500, credits: 100 });
    expect(res).toEqual({ ok: true, data: { id: "p2", name: "New" } });
    const [url, init] = f.mock.calls[0];
    expect(url).toContain("/api/v1/admin/billing/packs");
    expect(init).toMatchObject({ method: "POST", credentials: "include" });
    expect(JSON.parse((init as RequestInit).body as string).name).toBe("New");
  });

  it("createPack surfaces backend error code on 400", async () => {
    stub(400, { error: "invalid_pack" });
    const res = await createPack({} as never);
    expect(res).toEqual({ ok: false, status: 400, error: "invalid_pack" });
  });

  it("updatePack PUTs to /:id", async () => {
    const f = stub(200, { id: "p1", name: "Updated" });
    await updatePack("p1", { name: "Updated" });
    expect(f.mock.calls[0][0]).toContain("/admin/billing/packs/p1");
    expect(f.mock.calls[0][1]).toMatchObject({ method: "PUT" });
  });

  it("deactivatePack POSTs to /:id/deactivate", async () => {
    const f = stub(200, { ok: true });
    const res = await deactivatePack("p1");
    expect(f.mock.calls[0][0]).toContain("/admin/billing/packs/p1/deactivate");
    expect(f.mock.calls[0][1]).toMatchObject({ method: "POST" });
    expect(res.ok).toBe(true);
  });

  it("listPlans unwraps {plans}", async () => {
    stub(200, { plans: [{ id: "pl1", name: "Plan" }] });
    const plans = await listPlans();
    expect(plans?.[0].id).toBe("pl1");
  });

  it("listPlans returns null on error", async () => {
    stub(500, {});
    expect(await listPlans()).toBeNull();
  });

  it("createPlan posts with credentials + JSON body", async () => {
    const f = stub(200, { id: "pl2", name: "New Plan" });
    const res = await createPlan({ name: "New Plan", interval: "month", priceCents: 1000, creditsPerPeriod: 500 });
    expect(res).toEqual({ ok: true, data: { id: "pl2", name: "New Plan" } });
    expect(f.mock.calls[0][1]).toMatchObject({ method: "POST", credentials: "include" });
  });

  it("updatePlan PUTs to /:id", async () => {
    const f = stub(200, { id: "pl1", name: "Updated" });
    await updatePlan("pl1", { name: "Updated" });
    expect(f.mock.calls[0][0]).toContain("/admin/billing/plans/pl1");
    expect(f.mock.calls[0][1]).toMatchObject({ method: "PUT" });
  });

  it("deactivatePlan POSTs to /:id/deactivate", async () => {
    const f = stub(200, { ok: true });
    await deactivatePlan("pl1");
    expect(f.mock.calls[0][0]).toContain("/admin/billing/plans/pl1/deactivate");
    expect(f.mock.calls[0][1]).toMatchObject({ method: "POST" });
  });

  it("getSales builds ?from&to query string and returns summary", async () => {
    const f = stub(200, {
      from: "2026-06-01", to: "2026-07-01",
      topups: { count: 3, byCurrency: { usd: 1000 } },
      subscriptions: { activeCount: 2, mrrByCurrency: { usd: 2000 }, perPlan: [] },
      daily: [{ date: "2026-06-15", topupCents: 500, topupCount: 1 }],
    });
    const summary = await getSales("2026-06-01", "2026-07-01");
    expect(f.mock.calls[0][0]).toContain("/api/v1/admin/billing/sales?from=2026-06-01&to=2026-07-01");
    expect(summary?.topups.count).toBe(3);
    expect(summary?.subscriptions.activeCount).toBe(2);
  });

  it("getSales omits missing params from query string", async () => {
    const f = stub(200, {
      from: "a", to: "b", topups: { count: 0, byCurrency: {} },
      subscriptions: { activeCount: 0, mrrByCurrency: {}, perPlan: [] }, daily: [],
    });
    await getSales();
    expect(f.mock.calls[0][0]).not.toContain("?");
  });

  it("getSales returns null on error", async () => {
    stub(500, {});
    expect(await getSales()).toBeNull();
  });

  it("grantCredits posts networkId/amount/note, returns ok+balance", async () => {
    const f = stub(200, { ok: true, balance: 4200 });
    const res = await grantCredits("net1", 100, "manual grant");
    expect(f.mock.calls[0][0]).toContain("/api/v1/admin/billing/grant");
    expect(f.mock.calls[0][1]).toMatchObject({ method: "POST", credentials: "include" });
    const body = JSON.parse((f.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toEqual({ networkId: "net1", amount: 100, note: "manual grant" });
    expect(res).toEqual({ ok: true, data: { ok: true, balance: 4200 } });
  });

  it("grantCredits surfaces error on invalid amount", async () => {
    stub(400, { error: "invalid_amount" });
    const res = await grantCredits("net1", -1);
    expect(res).toEqual({ ok: false, status: 400, error: "invalid_amount" });
  });
});
