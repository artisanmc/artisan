import { afterAll, beforeAll, expect, it } from "bun:test";
import { app } from "../../app";
import { db } from "../../db/index";
import { memberships, users } from "../../db/schema";
import { createNetwork } from "../../lib/networkManager";
import { createSession } from "../../lib/sessionManager";
import { syncStandardPlans } from "./catalog";
import { getPlan, listCurrentPlans } from "./plansRepo";
import { __setStripeGatewayForTests } from "./stripe";
let headers: Record<string, string>, networkId: string, sourcePlanId: string;
const secret = process.env.STRIPE_SECRET_KEY;
beforeAll(async () => {
    delete process.env.STRIPE_SECRET_KEY;
    __setStripeGatewayForTests(null);
    await syncStandardPlans();
    sourcePlanId = (await listCurrentPlans()).find(p => p.key === "pro" && p.interval === "month")!.id;
    networkId = (await createNetwork("managed-route-test")).id;
    const id = crypto.randomUUID(), now = new Date();
    await db.insert(users).values({ id, email: `${id}@test.com`, name: "Admin", isAdmin: true, createdAt: now, updatedAt: now });
    await db.insert(memberships).values({ id: crypto.randomUUID(), userId: id, networkId, role: "owner", createdAt: now });
    headers = { Cookie: `artisan_user_session=${(await createSession(id)).id}`, "Content-Type": "application/json" };
});
afterAll(() => { if (secret !== undefined)
    process.env.STRIPE_SECRET_KEY = secret; });
it("copies an offline private draft, explicitly publishes and preserves prior versions", async () => {
    const created = await app.request("/api/v1/admin/billing/plans", { method: "POST", headers, body: JSON.stringify({ sourcePlanId, name: "Private contract", targetNetworkId: networkId }) });
    expect(created.status).toBe(200);
    const draft = await created.json();
    expect(draft).toMatchObject({ publicationStatus: "draft", managedBy: "admin", audience: "private", stripePriceId: null, priceCents: 900 });
    expect((await (await app.request("/api/v1/billing/plans")).json()).plans.some((p: any) => p.id === draft.id)).toBe(false);
    const published = await app.request(`/api/v1/admin/billing/plans/${draft.id}/publish`, { method: "POST", headers });
    expect(published.status).toBe(200);
    const scoped = await (await app.request(`/api/v1/billing/plans?networkId=${networkId}`, { headers })).json();
    expect(scoped.plans.find((p: any) => p.id === draft.id)).toMatchObject({ purchasable: false, creditInterval: "month" });
    expect((await app.request(`/api/v1/billing/plans?networkId=${networkId}`)).status).toBe(401);
    const change = await app.request(`/api/v1/admin/billing/plans/${draft.id}`, { method: "PUT", headers, body: JSON.stringify({ priceCents: 1500 }) });
    expect(change.status).toBe(200);
    const next = await change.json();
    expect(next.id).not.toBe(draft.id);
    expect(next).toMatchObject({ version: 2, publicationStatus: "draft" });
    expect((await getPlan(draft.id))!.priceCents).toBe(900);
    expect((await (await app.request(`/api/v1/billing/plans?networkId=${networkId}`, { headers })).json()).plans.some((p: any) => p.id === draft.id)).toBe(true);
});
it("rejects standard mutations and returns explicit offline checkout availability", async () => {
    for (const [method, suffix] of [["PUT", ""], ["POST", "/deactivate"], ["POST", "/publish"]]) {
        const res = await app.request(`/api/v1/admin/billing/plans/${sourcePlanId}${suffix}`, { method, headers, body: JSON.stringify({ name: "Changed" }) });
        expect(res.status).toBe(409);
        expect(await res.json()).toEqual({ error: "managed_plan_read_only" });
    }
    const res = await app.request("/api/v1/billing/checkout/subscription", { method: "POST", headers, body: JSON.stringify({ networkId, planKey: "pro", interval: "month" }) });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "billing_unavailable" });
});
