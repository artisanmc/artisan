import { desc, eq, sql } from "drizzle-orm";
import { db } from "../../db/index";
import { subscriptionPlans } from "../../db/schema";
import { STANDARD_CATALOG, type PlanCapabilities, type PlanLimits } from "./catalog";

export type SubscriptionPlan = typeof subscriptionPlans.$inferSelect;
export type PlanInput = {
  name: string; interval?: "month" | "year"; priceCents: number; currency?: string;
  creditsPerPeriod: number; rolloverCap?: number; features?: string; description?: string;
  highlighted?: boolean; editorPro?: boolean; isActive?: boolean; sortOrder?: number;
  sourcePlanId?: string; targetNetworkId?: string | null; publicationStatus?: "draft" | "published";
  creditInterval?: "month" | "year" | "none"; limits?: PlanLimits; capabilities?: PlanCapabilities;
};

export async function listPlans(): Promise<SubscriptionPlan[]> {
  return db.select().from(subscriptionPlans).orderBy(subscriptionPlans.sortOrder, subscriptionPlans.id);
}
export async function getPlan(id: string): Promise<SubscriptionPlan | null> {
  return (await db.select().from(subscriptionPlans).where(eq(subscriptionPlans.id, id)))[0] ?? null;
}

export async function listCurrentPlans(): Promise<SubscriptionPlan[]> {
  const rows = await listPlans();
  return rows.filter(row => row.publicationStatus === "published" && !rows.some(other => other.publicationStatus === "published" && (other.key ?? other.id) === (row.key ?? row.id) && (row.managedBy !== "code" || other.interval === row.interval) && other.version > row.version));
}

function validateTerms(plan: SubscriptionPlan): void {
  if (!plan.name.trim() || !Number.isSafeInteger(plan.priceCents) || plan.priceCents < 0 || !/^[a-z]{3}$/.test(plan.currency)) throw new Error("invalid_plan_terms");
  for (const n of [plan.priceCents, plan.creditsPerPeriod, plan.rolloverCap]) if (!Number.isSafeInteger(n) || n < 0 || n > 2147483647) throw new Error("invalid_plan_terms");
  for (const key of ["resourcesPerServer", "servers", "collaborators"] as const) {
    const n = plan.limits[key];
    if (n !== null && (!Number.isSafeInteger(n) || n < 0 || n > 2147483647)) throw new Error("invalid_plan_limits");
  }
  if (typeof plan.capabilities.editorPro !== "boolean" || !["month", "year"].includes(plan.interval) || !["month", "year", "none"].includes(plan.creditInterval)) throw new Error("invalid_plan_terms");
  if ((plan.creditInterval === "none" && plan.creditsPerPeriod !== 0) || (plan.interval === "month" && plan.creditInterval === "year")) throw new Error("invalid_credit_interval");
  if (plan.publicationStatus === "published" && !plan.targetNetworkId) throw new Error("target_network_required");
}

export async function createPlan(input: PlanInput): Promise<SubscriptionPlan> {
  const source = input.sourcePlanId ? await getPlan(input.sourcePlanId) : null;
  if (input.sourcePlanId && !source) throw new Error("source_plan_not_found");
  const now = new Date();
  const id = crypto.randomUUID();
  const capabilities = input.capabilities ?? (input.editorPro !== undefined ? { editorPro: input.editorPro } : source?.capabilities ?? STANDARD_CATALOG[0].capabilities);
  const row: SubscriptionPlan = {
    id, key: `custom:${id}`, version: 1, managedBy: "admin", audience: "private",
    targetNetworkId: input.targetNetworkId ?? null, publicationStatus: input.publicationStatus ?? "draft",
    name: input.name, interval: input.interval ?? source?.interval ?? "month", priceCents: input.priceCents,
    currency: input.currency ?? source?.currency ?? "eur", creditsPerPeriod: input.creditsPerPeriod,
    creditInterval: input.creditInterval ?? source?.creditInterval ?? "month", rolloverCap: input.rolloverCap ?? source?.rolloverCap ?? 0,
    limits: structuredClone(input.limits ?? source?.limits ?? STANDARD_CATALOG[0].limits), capabilities: structuredClone(capabilities),
    features: input.features ?? source?.features ?? "", description: input.description ?? source?.description ?? "",
    highlighted: input.highlighted ?? false, editorPro: capabilities.editorPro, isActive: input.isActive ?? true,
    sortOrder: input.sortOrder ?? 0, stripeProductId: null, stripePriceId: null, createdAt: now, updatedAt: now,
  };
  validateTerms(row);
  return (await db.insert(subscriptionPlans).values(row).returning())[0];
}

export async function updatePlan(id: string, patch: Partial<PlanInput>): Promise<SubscriptionPlan | null> {
  const initial = await getPlan(id);
  if (!initial) return null;
  if (initial.managedBy === "code") throw new Error("managed_plan_read_only");
  validateTerms({ ...initial, ...patch });
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(726193042)`);
    const [existing] = await tx.select().from(subscriptionPlans).where(eq(subscriptionPlans.id, id));
    if (!existing) return null;
    if (existing.managedBy === "code") throw new Error("managed_plan_read_only");
    const { sourcePlanId: _, ...changes } = patch;
    const next = { ...existing, ...changes, updatedAt: new Date() };
    if (patch.capabilities) next.editorPro = patch.capabilities.editorPro;
    else if (patch.editorPro !== undefined) next.capabilities = { editorPro: patch.editorPro };
    validateTerms(next);
    if (existing.publicationStatus === "published") {
      const [latest] = await tx.select().from(subscriptionPlans).where(eq(subscriptionPlans.key, existing.key!)).orderBy(desc(subscriptionPlans.version)).limit(1);
      if (latest.id !== existing.id) throw new Error("plan_version_superseded");
      next.id = crypto.randomUUID();
      next.publicationStatus = patch.publicationStatus ?? "draft";
      next.version = latest.version + 1;
      next.key = existing.key ?? `custom:${existing.id}`;
      next.stripeProductId = null;
      next.stripePriceId = null;
      next.createdAt = next.updatedAt;
      return (await tx.insert(subscriptionPlans).values(next).returning())[0];
    }
    return (await tx.update(subscriptionPlans).set(next).where(eq(subscriptionPlans.id, id)).returning())[0];
  });
}

export async function deactivatePlan(id: string): Promise<boolean> {
  const existing = await getPlan(id);
  if (!existing) return false;
  if (existing.managedBy === "code") throw new Error("managed_plan_read_only");
  await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(726193042)`);
    await tx.update(subscriptionPlans).set({ isActive: false, updatedAt: new Date() }).where(existing.key ? eq(subscriptionPlans.key, existing.key) : eq(subscriptionPlans.id, id));
  });
  return true;
}
