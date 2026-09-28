import { afterEach, beforeEach, expect, it } from "bun:test";
import { db } from "../../db";
import { eq } from "drizzle-orm";
import { networks, subscriptionPlans } from "../../db/schema";
import { syncStandardPlans } from "./catalog";
import { createPlan, deactivatePlan, getPlan, listCurrentPlans, listPlans, updatePlan } from "./plansRepo";

afterEach(async () => { await db.delete(subscriptionPlans); });
beforeEach(async () => { await db.delete(subscriptionPlans); });

it("publishes a new custom version while preserving previously subscribed terms", async () => {
  const now = new Date();
  await db.insert(networks).values({ id: "catalog-network", name: "Catalog", createdAt: now, updatedAt: now }).onConflictDoNothing();
  const original = await createPlan({ name: "Contract", priceCents: 1000, creditsPerPeriod: 500, targetNetworkId: "catalog-network", publicationStatus: "published" });
  const updated = await updatePlan(original.id, { priceCents: 2000 });
  expect(updated!.id).not.toBe(original.id);
  expect(updated!.version).toBe(2);
  expect((await getPlan(original.id))!.priceCents).toBe(1000);
  expect(updated!.publicationStatus).toBe("draft");
  expect((await listCurrentPlans()).map(p => p.id)).toEqual([original.id]);
  await updatePlan(updated!.id, { publicationStatus: "published" });
  expect((await listCurrentPlans()).map(p => p.id)).toEqual([updated!.id]);
  const annual = await updatePlan(updated!.id, { interval: "year" });
  await updatePlan(annual!.id, { publicationStatus: "published" });
  expect((await listCurrentPlans()).map(p => p.id)).toEqual([annual!.id]);
  const draft = await updatePlan(annual!.id, { priceCents: 2400 });
  await deactivatePlan(draft!.id);
  expect((await getPlan(annual!.id))!.isActive).toBe(false);
});

it("copies a standard offer into a private draft without Stripe and protects standards", async () => {
  await syncStandardPlans();
  const source = (await listPlans())[2];
  const draft = await createPlan({ sourcePlanId: source.id, name: "Custom", priceCents: 12000, creditsPerPeriod: 800 });
  expect(draft).toMatchObject({ managedBy: "admin", audience: "private", publicationStatus: "draft", stripePriceId: null, limits: source.limits, creditInterval: "month" });
  expect(await updatePlan(source.id, { priceCents: 99 }).catch(e => e.message)).toBe("managed_plan_read_only");
  expect(await updatePlan(draft.id, { publicationStatus: "published" }).catch(e => e.message)).toBe("target_network_required");
});

it("installs reproducible Free and Pro offers without a payment gateway", async () => {
  await syncStandardPlans();
  const plans = await listPlans();
  expect(plans.map(p => [p.key, p.interval, p.version, p.priceCents])).toEqual([
    ["free", "month", 1, 0], ["pro", "month", 1, 900], ["pro", "year", 1, 7000],
  ]);
  expect(plans[2]).toMatchObject({ managedBy: "code", creditInterval: "month", creditsPerPeriod: 500,
    limits: { servers: 10, resourcesPerServer: 250, collaborators: null }, stripePriceId: null });
});

it("concurrent and repeated synchronization keeps IDs stable and rejects changed version terms", async () => {
  await Promise.all([syncStandardPlans(), syncStandardPlans()]);
  const before = await listPlans();
  await syncStandardPlans();
  expect((await listPlans()).map(p => p.id)).toEqual(before.map(p => p.id));
  await db.update(subscriptionPlans).set({ priceCents: 123 }).where(eq(subscriptionPlans.id, before[1].id));
  expect(await syncStandardPlans().catch(e => e.message)).toContain("catalog_version_conflict");
});
