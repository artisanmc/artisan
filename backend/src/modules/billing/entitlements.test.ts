import { beforeEach, expect, test } from "bun:test";
import { db } from "../../db";
import { networkBilling, networks, subscriptionPlans } from "../../db/schema";
import { resolveNetworkEntitlements } from "./entitlements";
import { eq } from "drizzle-orm";
import { STANDARD_CATALOG } from "./catalog";

beforeEach(async () => {
  await db.delete(networkBilling);
  await db.delete(subscriptionPlans);
  await db.delete(networks);
  const now = new Date();
  await db.insert(networks).values({ id: "rights", name: "Rights", createdAt: now, updatedAt: now });
});

test("expired, unconfirmed, missing and other-network versions all resolve to Free", async () => {
  const now = new Date();
  const free = { planId: null, planKey: "free", planName: "Free", limits: STANDARD_CATALOG[0].limits, capabilities: STANDARD_CATALOG[0].capabilities, paidThrough: null };
  expect(await resolveNetworkEntitlements("rights")).toEqual(free);
  await db.insert(subscriptionPlans).values({ id: "private", key: "private", name: "Private", priceCents: 900, creditsPerPeriod: 0,
    limits: { servers: null, collaborators: null, resourcesPerServer: null }, capabilities: { editorPro: true },
    audience: "private", publicationStatus: "published", createdAt: now, updatedAt: now });
  await db.insert(networkBilling).values({ networkId: "rights", planId: "private", paidEditorPro: true, currentPeriodId: "paid", paidThrough: new Date("2999-01-01"), createdAt: now, updatedAt: now });
  expect(await resolveNetworkEntitlements("rights")).toEqual(free);
  await db.update(subscriptionPlans).set({ targetNetworkId: "rights" }).where(eq(subscriptionPlans.id, "private"));
  expect((await resolveNetworkEntitlements("rights")).limits.servers).toBeNull();
  expect(await resolveNetworkEntitlements("rights", db, new Date("2999-01-01"))).toEqual(free);
  await db.update(networkBilling).set({ currentPeriodId: null }).where(eq(networkBilling.networkId, "rights"));
  expect(await resolveNetworkEntitlements("rights")).toEqual(free);
});

test("confirmed custom terms apply independently of the Pro flag and renewal status", async () => {
  const now = new Date();
  await db.insert(subscriptionPlans).values({ id: "custom", key: "custom", name: "Contract", priceCents: 900, creditsPerPeriod: 0,
    limits: { servers: 4, collaborators: 1, resourcesPerServer: null }, capabilities: { editorPro: false },
    publicationStatus: "published", targetNetworkId: "rights", createdAt: now, updatedAt: now });
  await db.insert(networkBilling).values({ networkId: "rights", planId: "custom", currentPeriodId: "paid", paidThrough: new Date("2999-01-01"), status: "canceled", createdAt: now, updatedAt: now });
  expect(await resolveNetworkEntitlements("rights")).toMatchObject({ planId: "custom", limits: { servers: 4, collaborators: 1, resourcesPerServer: null }, capabilities: { editorPro: false } });
});
