import { beforeAll, expect, test } from "bun:test";
import { app } from "../../app";
import { db } from "../../db";
import { aiCreditLedger, memberships, networkBilling, users } from "../../db/schema";
import { and, eq } from "drizzle-orm";
import { createNetwork } from "../../lib/networkManager";
import { createSession } from "../../lib/sessionManager";
import { getBucketBalances } from "../ai/creditsRepo";
import { syncStandardPlans } from "./catalog";
import { resolveNetworkEntitlements } from "./entitlements";
import { getNetworkBilling } from "./networkBillingRepo";
import { createPlan, listCurrentPlans, updatePlan } from "./plansRepo";
import { assignManualPlan, grantDueManualPlanCredits } from "./manualAssignments";
import { annualCreditBoundary } from "./annualProCredits";
import { handleStripeEvent } from "./webhookHandler";

let headers: Record<string, string>, proId: string, adminId: string;
beforeAll(async () => {
  await syncStandardPlans();
  proId = (await listCurrentPlans()).find(p => p.key === "pro" && p.interval === "year")!.id;
  const id = crypto.randomUUID(), now = new Date();
  adminId = id;
  await db.insert(users).values({ id, email: `${id}@test.com`, name: "Admin", isAdmin: true, createdAt: now, updatedAt: now });
  headers = { Cookie: `artisan_user_session=${(await createSession(id)).id}`, "Content-Type": "application/json" };
});

test("manual plans expose the effective subscription and its monthly credit period to members", async () => {
  const network = await createNetwork("Manual member");
  await db.insert(memberships).values({ id: crypto.randomUUID(), networkId: network.id, userId: adminId, role: "owner", createdAt: new Date() });
  await assignManualPlan(network.id, proId, null, adminId);
  const subscription = await (await app.request(`/api/v1/billing/subscription?networkId=${network.id}`, { headers })).json();
  expect(subscription).toMatchObject({ status: null, effectivePlan: { id: proId }, manualAssignment: { planId: proId, expiresAt: null } });
  const balance = await (await app.request(`/api/v1/billing/balance?networkId=${network.id}`, { headers })).json();
  expect(balance).toMatchObject({ subscription: 500, subscriptionQuota: 500 });
  expect(balance.periodEnd).toBe((await getNetworkBilling(network.id))!.manualPeriodEnd!.toISOString());
});

test("monthly renewals are idempotent, skip missed periods and continue beyond a year", async () => {
  const network = await createNetwork("Manual recurring"), start = new Date();
  await assignManualPlan(network.id, proId, null, adminId, start);
  await Promise.all([grantDueManualPlanCredits(annualCreditBoundary(start, 1)), grantDueManualPlanCredits(annualCreditBoundary(start, 1))]);
  let billing = (await getNetworkBilling(network.id))!;
  expect(billing.manualPeriodIndex).toBe(1);
  const period = await db.select().from(aiCreditLedger).where(and(eq(aiCreditLedger.networkId, network.id), eq(aiCreditLedger.periodId, billing.manualPeriodId!)));
  expect(period.filter(row => row.delta > 0)).toHaveLength(1);
  await grantDueManualPlanCredits(annualCreditBoundary(start, 15));
  billing = (await getNetworkBilling(network.id))!;
  expect(billing.manualPeriodIndex).toBe(15);
  expect(billing.manualPeriodEnd).toEqual(annualCreditBoundary(start, 16));
  expect((await resolveNetworkEntitlements(network.id, db, annualCreditBoundary(start, 15))).planId).toBe(proId);
});

test("expiry and removal restore Free and remove remaining subscription credits", async () => {
  const network = await createNetwork("Manual expiry"), start = new Date();
  const end = new Date(start.getTime() + 86400000);
  await assignManualPlan(network.id, proId, end, adminId, start);
  expect((await getNetworkBilling(network.id))!.manualPeriodEnd).toEqual(end);
  expect((await resolveNetworkEntitlements(network.id, db, end)).planKey).toBe("free");
  await grantDueManualPlanCredits(end);
  expect((await getNetworkBilling(network.id))!.manualPlanId).toBeNull();
  expect((await getBucketBalances(network.id)).subscription).toBe(0);
  await assignManualPlan(network.id, proId, null, adminId);
  await assignManualPlan(network.id, null, null, adminId);
  expect((await resolveNetworkEntitlements(network.id)).planKey).toBe("free");
  expect((await getBucketBalances(network.id)).subscription).toBe(0);
});

test("only published eligible plans can be assigned and Stripe rights cannot be overwritten", async () => {
  const network = await createNetwork("Manual restrictions");
  const draft = await createPlan({ sourcePlanId: proId, name: "Private", priceCents: 900, creditsPerPeriod: 500, targetNetworkId: network.id });
  const assign = (planId: string, expiresAt: unknown = null) => app.request(`/api/v1/admin/billing/networks/${network.id}/plan`, { method: "PUT", headers, body: JSON.stringify({ planId, expiresAt }) });
  expect((await assign(draft.id)).status).toBe(400);
  await updatePlan(draft.id, { publicationStatus: "published" });
  expect((await assign(draft.id)).status).toBe(200);
  const other = await createNetwork("Wrong network");
  expect(await assignManualPlan(other.id, draft.id, null, adminId).catch(error => error.message)).toBe("plan_not_available");
  expect((await assign(proId, "invalid")).status).toBe(400);
  expect((await assign(proId, "2000-01-01")).status).toBe(400);
  await assignManualPlan(network.id, null, null, adminId);
  await db.update(networkBilling).set({ paidThrough: new Date("2999-01-01") }).where(eq(networkBilling.networkId, network.id));
  expect((await assign(proId)).status).toBe(409);
  expect((await app.request(`/api/v1/admin/billing/networks/${network.id}/plan`, { method: "PUT", body: JSON.stringify({ planId: proId }) })).status).toBe(403);
  const userId = crypto.randomUUID(), now = new Date();
  await db.insert(users).values({ id: userId, email: `${userId}@test.com`, name: "Member", createdAt: now, updatedAt: now });
  const memberHeaders = { Cookie: `artisan_user_session=${(await createSession(userId)).id}` };
  expect((await app.request("/api/v1/admin/billing/networks", { headers: memberHeaders })).status).toBe(403);
});

test("admin assigns the full Pro plan without Stripe and repeated saves do not grant twice", async () => {
  const network = await createNetwork("Manual Pro");
  const url = `/api/v1/admin/billing/networks/${network.id}/plan`;
  for (let i = 0; i < 2; i++) {
    const response = await app.request(url, { method: "PUT", headers, body: JSON.stringify({ planId: proId, expiresAt: null }) });
    expect(response.status).toBe(200);
  }
  expect(await resolveNetworkEntitlements(network.id)).toMatchObject({ planId: proId, limits: { resourcesPerServer: 250 } });
  expect(await getBucketBalances(network.id)).toMatchObject({ subscription: 500, total: 500 });
  expect(await getNetworkBilling(network.id)).toMatchObject({ stripeSubscriptionId: null, paidThrough: null, status: null });
});

test("a confirmed payment replaces manual rights without stacking credit grants", async () => {
  const network = await createNetwork("Manual to paid"), now = new Date();
  await assignManualPlan(network.id, proId, null, adminId, now);
  const paid = await createPlan({ name: "Paid", interval: "month", priceCents: 900, creditsPerPeriod: 75, targetNetworkId: network.id, publicationStatus: "published" });
  const { subscriptionPlans } = await import("../../db/schema");
  await db.update(subscriptionPlans).set({ stripePriceId: `price_${paid.id}` }).where(eq(subscriptionPlans.id, paid.id));
  const sub = `sub_${network.id}`;
  await db.update(networkBilling).set({ planId: paid.id, stripeSubscriptionId: sub }).where(eq(networkBilling.networkId, network.id));
  await handleStripeEvent({ id: crypto.randomUUID(), type: "invoice.paid", data: { object: {
    id: `invoice_${network.id}`, created: Math.floor(now.getTime() / 1000), subscription: sub, billing_reason: "subscription_create",
    lines: { data: [{ price: { id: `price_${paid.id}` }, period: { start: now.getTime() / 1000, end: annualCreditBoundary(now, 1).getTime() / 1000 } }] },
  } } });
  expect((await getNetworkBilling(network.id))!.manualPlanId).toBeNull();
  expect((await resolveNetworkEntitlements(network.id)).planId).toBe(paid.id);
  expect((await getBucketBalances(network.id)).subscription).toBe(75);
});

test("custom yearly and no-credit plans preserve their own cadence", async () => {
  const network = await createNetwork("Manual custom cadence"), start = new Date();
  const yearly = await createPlan({ name: "Annual credits", interval: "year", priceCents: 100, creditsPerPeriod: 1200, creditInterval: "year", targetNetworkId: network.id, publicationStatus: "published" });
  await assignManualPlan(network.id, yearly.id, null, adminId, start);
  await grantDueManualPlanCredits(annualCreditBoundary(start, 1));
  expect((await getNetworkBilling(network.id))!.manualPeriodIndex).toBe(0);
  await grantDueManualPlanCredits(annualCreditBoundary(start, 12));
  expect((await getNetworkBilling(network.id))!.manualPeriodIndex).toBe(1);
  const noCredits = await createPlan({ name: "Quotas only", priceCents: 100, creditsPerPeriod: 0, creditInterval: "none", targetNetworkId: network.id, publicationStatus: "published" });
  await assignManualPlan(network.id, noCredits.id, null, adminId);
  expect((await getBucketBalances(network.id)).subscription).toBe(0);
  expect((await getNetworkBilling(network.id))!.manualPeriodEnd).toBeNull();
});
