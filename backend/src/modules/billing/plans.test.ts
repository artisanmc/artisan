import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { app } from "../../app";
import { db } from "../../db/index";
import { appSettings, billingConfigAudit, memberships, networks, subscriptionPlans, users } from "../../db/schema";
import { createSession } from "../../lib/sessionManager";
import { syncStandardPlans } from "./catalog";
import { listPlans } from "./plansRepo";
import { __setStripeGatewayForTests } from "./stripe";

const ADMIN_ID = "user_admin_plans";
const NETWORK_ID = "admin_plans_network";
const secret = process.env.STRIPE_SECRET_KEY;
let adminSession = "";
let sourcePlanId = "";
const headers = () => ({ Cookie: `artisan_user_session=${adminSession}`, "Content-Type": "application/json" });
const request = (suffix = "", method = "GET", body?: unknown) => app.request(`/api/v1/admin/billing/plans${suffix}`, {
  method, headers: headers(), ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
async function create(patch: Record<string, unknown> = {}) {
  const response = await request("", "POST", { sourcePlanId, name: "Private contract", ...patch });
  expect(response.status).toBe(200);
  return response.json();
}

beforeAll(async () => {
  delete process.env.STRIPE_SECRET_KEY;
  __setStripeGatewayForTests(null);
  const now = new Date();
  await db.insert(users).values({ id: ADMIN_ID, email: `${ADMIN_ID}@example.com`, name: "Admin", isAdmin: true, createdAt: now, updatedAt: now }).onConflictDoNothing();
  await db.insert(networks).values({ id: NETWORK_ID, name: "Contracts", createdAt: now, updatedAt: now }).onConflictDoNothing();
  await db.insert(memberships).values({ id: "admin_plans_membership", userId: ADMIN_ID, networkId: NETWORK_ID, role: "owner", createdAt: now }).onConflictDoNothing();
  adminSession = (await createSession(ADMIN_ID)).id;
});
beforeEach(async () => {
  await db.delete(subscriptionPlans);
  await db.delete(billingConfigAudit);
  await db.delete(appSettings).where(eq(appSettings.key, "editor_commercial_policy"));
  await syncStandardPlans();
  sourcePlanId = (await listPlans()).find(p => p.key === "pro" && p.interval === "month")!.id;
});
afterAll(async () => {
  __setStripeGatewayForTests(null);
  if (secret !== undefined) process.env.STRIPE_SECRET_KEY = secret;
  await db.delete(subscriptionPlans);
  await db.delete(billingConfigAudit);
  await db.delete(appSettings).where(eq(appSettings.key, "editor_commercial_policy"));
  await db.delete(users).where(eq(users.id, ADMIN_ID));
  await db.delete(networks).where(eq(networks.id, NETWORK_ID));
});

describe("admin managed plans", () => {
  it("removes the separate editor policy endpoint and cannot store a toggle", async () => {
    const policyUrl = "/api/v1/admin/billing/editor-policy";
    expect((await app.request(policyUrl, { headers: headers() })).status).toBe(404);
    expect((await app.request(policyUrl, { method: "PUT", headers: headers(), body: JSON.stringify({ quota: 10, enforcementEnabled: false }) })).status).toBe(404);
    expect(await db.select().from(appSettings).where(eq(appSettings.key, "editor_commercial_policy"))).toHaveLength(0);
    expect(await db.select().from(billingConfigAudit).where(eq(billingConfigAudit.action, "editor_policy_update"))).toHaveLength(0);
  });

  it("copies standards offline, preserves presentation, and audits creation and draft edits", async () => {
    const created = await create({ description: "  More room  ", highlighted: true, features: "Shared credits\nMore servers", sortOrder: 5 });
    expect(created).toMatchObject({ managedBy: "admin", audience: "private", publicationStatus: "draft", priceCents: 900, creditsPerPeriod: 500, creditInterval: "month", stripePriceId: null, description: "More room", highlighted: true, limits: { servers: 10, resourcesPerServer: 250, collaborators: null } });
    const response = await request(`/${created.id}`, "PUT", { description: "Updated", highlighted: false, sortOrder: -1, creditsPerPeriod: 750 });
    expect(response.status).toBe(200);
    const updated = await response.json();
    expect(updated).toMatchObject({ id: created.id, version: 1, description: "Updated", highlighted: false, creditsPerPeriod: 750, stripePriceId: null });
    const fetched = await request(`/${created.id}`);
    expect(fetched.status).toBe(200);
    expect(await fetched.json()).toMatchObject({ description: "Updated", features: created.features });
    const audit = await db.select().from(billingConfigAudit);
    expect(audit.map(row => row.action).sort()).toEqual(["plan_create", "plan_update"]);
    expect(audit.every(row => row.actorId === ADMIN_ID)).toBe(true);
    expect(audit.find(row => row.action === "plan_update")).toMatchObject({ before: { description: "More room" }, after: { description: "Updated" } });
  });

  it("exposes only public standards anonymously with exact prices and no payment identifiers", async () => {
    await create({ isActive: false, sortOrder: -5 });
    const privatePlan = await create({ targetNetworkId: NETWORK_ID });
    expect((await request(`/${privatePlan.id}/publish`, "POST")).status).toBe(200);
    const response = await app.request("/api/v1/billing/plans");
    expect(response.status).toBe(200);
    const { plans } = await response.json();
    expect(plans.map((p: { key: string; interval: string; priceCents: number }) => [p.key, p.interval, p.priceCents])).toEqual([["free", "month", 0], ["pro", "month", 900], ["pro", "year", 7000]]);
    expect(plans.every((p: { purchasable: boolean }) => !p.purchasable)).toBe(true);
    expect(JSON.stringify(plans)).not.toContain("stripe");
  });

  it("rejects malformed terms and presentation on both creation and draft update", async () => {
    const created = await create();
    const invalid = [{ name: "" }, { priceCents: -1 }, { priceCents: 2147483648 }, { creditsPerPeriod: -5 }, { rolloverCap: -5 }, { description: 12 }, { description: "x".repeat(241) }, { highlighted: "true" }, { sortOrder: 1.5 }, { features: ["unexpected"] }, { interval: "week" }, { currency: "bad-currency" }, { limits: { servers: 2 } }, { capabilities: { editorPro: "yes" } }, { publicationStatus: "published" }, { managedBy: "code" }, { audience: "public" }, { key: "pro" }, { version: 2 }];
    for (const patch of invalid) {
      for (const method of ["POST", "PUT"]) {
        const response = await request(method === "PUT" ? `/${created.id}` : "", method, { sourcePlanId, ...patch });
        expect(response.status).toBe(400);
      }
    }
    expect((await request("", "POST", { name: "Missing source" })).status).toBe(400);
    expect((await request("", "POST", { sourcePlanId: created.id })).status).toBe(400);
    expect((await request("", "POST", { sourcePlanId, targetNetworkId: "missing" })).status).toBe(400);
    for (const body of [null, [], "invalid", 5]) {
      expect((await request("", "POST", body)).status).toBe(400);
      expect((await request(`/${created.id}`, "PUT", body)).status).toBe(400);
    }
  });

  it("accepts zero credits and unlimited quotas when the explicit calendar is consistent", async () => {
    const created = await create({ priceCents: 0, creditsPerPeriod: 0, creditInterval: "none", limits: { servers: null, resourcesPerServer: 0, collaborators: null } });
    expect(created).toMatchObject({ priceCents: 0, creditsPerPeriod: 0, creditInterval: "none", limits: { servers: null, resourcesPerServer: 0, collaborators: null } });
    expect((await request(`/${created.id}`, "PUT", { creditsPerPeriod: 5 })).status).toBe(400);
  });

  it("lists standards and custom drafts by sort order with serialized dates", async () => {
    const first = await create({ name: "First", sortOrder: -2 });
    const last = await create({ name: "Last", sortOrder: 8 });
    const { plans } = await (await request()).json();
    expect(plans.map((p: { id: string }) => p.id)).toEqual([first.id, ...(await listPlans()).filter(p => p.managedBy === "code").map(p => p.id), last.id]);
    expect(plans.every((p: { createdAt: unknown }) => typeof p.createdAt === "string")).toBe(true);
  });

  it("publishes targeted contracts and creates draft versions without mutating sold terms", async () => {
    const original = await create();
    const missingTarget = await request(`/${original.id}/publish`, "POST");
    expect(missingTarget.status).toBe(400);
    expect(await missingTarget.json()).toEqual({ error: "target_network_required" });
    expect((await request(`/${original.id}`, "PUT", { targetNetworkId: NETWORK_ID })).status).toBe(200);
    expect((await request(`/${original.id}/publish`, "POST")).status).toBe(200);
    const response = await request(`/${original.id}`, "PUT", { priceCents: 2000, currency: "usd", interval: "year" });
    expect(response.status).toBe(200);
    const updated = await response.json();
    expect(updated.id).not.toBe(original.id);
    expect(updated).toMatchObject({ version: 2, publicationStatus: "draft", priceCents: 2000, currency: "usd", interval: "year", stripePriceId: null });
    expect(await (await request(`/${original.id}`)).json()).toMatchObject({ priceCents: 900, currency: "eur", interval: "month", publicationStatus: "published" });
    const { plans } = await (await request()).json();
    expect(plans.filter((p: { key: string }) => p.key === original.key).map((p: { id: string }) => p.id)).toEqual([updated.id]);
    expect((await request(`/${updated.id}/publish`, "POST")).status).toBe(200);
    const audit = await db.select().from(billingConfigAudit).where(eq(billingConfigAudit.action, "plan_publish"));
    expect(audit).toHaveLength(2);
    expect(audit.every(row => row.actorId === ADMIN_ID)).toBe(true);
  });

  it("protects standards and restricts admin endpoints", async () => {
    expect((await app.request("/api/v1/admin/billing/plans")).status).toBe(403);
    for (const [method, suffix] of [["PUT", ""], ["POST", "/publish"], ["POST", "/deactivate"]]) {
      const response = await request(`/${sourcePlanId}${suffix}`, method, { name: "Changed" });
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: "managed_plan_read_only" });
    }
  });

  it("preserves orphaned private offers without blocking network deletion or exposing them", async () => {
    const removedId = "admin_plans_removed_network";
    const now = new Date();
    await db.insert(networks).values({ id: removedId, name: "Removed", createdAt: now, updatedAt: now }).onConflictDoNothing();
    const draft = await create({ targetNetworkId: removedId });
    const published = await create({ targetNetworkId: removedId });
    expect((await request(`/${published.id}/publish`, "POST")).status).toBe(200);
    const deletionError = await db.delete(networks).where(eq(networks.id, removedId)).then(() => null).catch(error => error.code ?? error.message);
    expect(deletionError).toBeNull();
    for (const original of [draft, published]) {
      expect(await (await request(`/${original.id}`)).json()).toMatchObject({ id: original.id, targetNetworkId: null, audience: "private", priceCents: original.priceCents });
    }
    const denied = await request(`/${draft.id}/publish`, "POST");
    expect(denied.status).toBe(400);
    expect(await denied.json()).toEqual({ error: "target_network_required" });
    for (const url of ["/api/v1/billing/plans", `/api/v1/billing/plans?networkId=${NETWORK_ID}`]) {
      const response = await app.request(url, { headers: headers() });
      expect(response.status).toBe(200);
      const { plans } = await response.json();
      expect(plans.some((p: { id: string }) => [draft.id, published.id].includes(p.id))).toBe(false);
    }
    const checkout = await app.request("/api/v1/billing/checkout/subscription", { method: "POST", headers: headers(), body: JSON.stringify({ networkId: NETWORK_ID, planId: published.id }) });
    expect(checkout.status).toBe(404);
  });

  it("deactivates a custom plan with an audit record and returns 404 for unknown IDs", async () => {
    const created = await create();
    expect((await request(`/${created.id}/deactivate`, "POST")).status).toBe(200);
    expect(await (await request(`/${created.id}`)).json()).toMatchObject({ isActive: false });
    const audit = await db.select().from(billingConfigAudit).where(eq(billingConfigAudit.action, "plan_deactivate"));
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorId: ADMIN_ID, before: { isActive: true }, after: { isActive: false } });
    for (const [method, suffix] of [["GET", ""], ["PUT", ""], ["POST", "/deactivate"], ["POST", "/publish"]]) {
      expect((await request(`/missing${suffix}`, method, method === "PUT" ? { name: "Changed" } : undefined)).status).toBe(404);
    }
  });
});
