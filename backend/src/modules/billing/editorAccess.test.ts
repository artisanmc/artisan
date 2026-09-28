import { beforeEach, expect, test } from "bun:test";
import { db } from "../../db";
import { appSettings, networkBilling, networks, serverKeys, subscriptionPlans } from "../../db/schema";
import { resolveServerCommercialPolicy } from "./editorAccess";

beforeEach(async () => {
  await db.delete(networkBilling);
  await db.delete(subscriptionPlans);
  await db.delete(networks);
  await db.delete(appSettings);
});

test("Free applies without billing and stale disabled enforcement cannot bypass its quota", async () => {
  const now = new Date();
  await db.insert(networks).values({ id: "free", name: "Free", createdAt: now, updatedAt: now });
  await db.insert(serverKeys).values({ id: "free-server", networkId: "free", createdAt: now });
  expect(await resolveServerCommercialPolicy("free-server")).toEqual({ enabled: true, quota: 10, proUntil: null });
  await db.insert(appSettings).values({ key: "editor_commercial_policy", value: JSON.stringify({ quota: 88, enforcementEnabled: false }), updatedAt: now });
  expect(await resolveServerCommercialPolicy("free-server")).toEqual({ enabled: true, quota: 10, proUntil: null });
});

test("server policy carries its effective nullable custom quota without legacy Pro override", async () => {
  const now = new Date();
  await db.insert(networks).values({ id: "access", name: "Access", createdAt: now, updatedAt: now });
  await db.insert(serverKeys).values({ id: "access-server", networkId: "access", createdAt: now });
  await db.insert(subscriptionPlans).values({ id: "access-plan", key: "access", name: "Access", priceCents: 1, creditsPerPeriod: 0,
    limits: { resourcesPerServer: null, servers: 3, collaborators: 1 }, capabilities: { editorPro: true }, targetNetworkId: "access", publicationStatus: "published", createdAt: now, updatedAt: now });
  await db.insert(networkBilling).values({ networkId: "access", planId: "access-plan", paidEditorPro: true, paidThrough: new Date("2999-01-01"), currentPeriodId: "paid", createdAt: now, updatedAt: now });
  expect(await resolveServerCommercialPolicy("access-server")).toEqual({ enabled: true, quota: null, proUntil: null });
});
