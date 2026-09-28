import { and, eq, sql } from "drizzle-orm";
import { db } from "../../db";
import { subscriptionPlans } from "../../db/schema";

export type PlanLimits = { resourcesPerServer: number | null; servers: number | null; collaborators: number | null };
export type PlanCapabilities = { editorPro: boolean };
function canonical(value: unknown): string {
  return JSON.stringify(value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : value);
}
export const STANDARD_CATALOG = [
  { key: "free", name: "Free", interval: "month", version: 1, currency: "eur", priceCents: 0, creditsPerPeriod: 0, creditInterval: "none", limits: { resourcesPerServer: 10, servers: 2, collaborators: 2 }, capabilities: { editorPro: false }, sortOrder: 0 },
  { key: "pro", name: "Pro", interval: "month", version: 1, currency: "eur", priceCents: 900, creditsPerPeriod: 500, creditInterval: "month", limits: { resourcesPerServer: 250, servers: 10, collaborators: null }, capabilities: { editorPro: true }, sortOrder: 1 },
  { key: "pro", name: "Pro", interval: "year", version: 1, currency: "eur", priceCents: 7000, creditsPerPeriod: 500, creditInterval: "month", limits: { resourcesPerServer: 250, servers: 10, collaborators: null }, capabilities: { editorPro: true }, sortOrder: 2 },
] as const;

export async function syncStandardPlans(): Promise<void> {
  await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(726193041)`);
    for (const definition of STANDARD_CATALOG) {
      const now = new Date();
      const expected = { ...definition, currency: "eur", rolloverCap: 0, managedBy: "code", audience: "public", publicationStatus: "published", targetNetworkId: null, editorPro: definition.capabilities.editorPro };
      const [existing] = await tx.select().from(subscriptionPlans).where(and(eq(subscriptionPlans.key, definition.key), eq(subscriptionPlans.interval, definition.interval), eq(subscriptionPlans.version, definition.version)));
      if (existing) {
        for (const key of Object.keys(expected) as (keyof typeof expected)[]) {
          if (canonical(existing[key]) !== canonical(expected[key])) {
            throw new Error(`catalog_version_conflict:${definition.key}:${definition.interval}:${definition.version}:${key}`);
          }
        }
      } else {
        await tx.insert(subscriptionPlans).values({ ...expected, id: crypto.randomUUID(), isActive: true, createdAt: now, updatedAt: now });
      }
    }
  });
}
