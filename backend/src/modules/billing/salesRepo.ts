import { and, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "../../db/index";
import { creditPurchases, networkBilling, subscriptionPlans } from "../../db/schema";

export interface SalesSummary {
	from: string; to: string;
	topups: { count: number; byCurrency: Record<string, number> };
	subscriptions: {
		activeCount: number;
		mrrByCurrency: Record<string, number>;
		perPlan: Array<{ planId: string; planName: string; currency: string; priceCents: number; activeCount: number }>;
	};
	daily: Array<{ date: string; topupCents: number; topupCount: number }>;
}

export async function salesSummary(from: Date, to: Date): Promise<SalesSummary> {
	// Top-ups in [from, to): summed per currency + count.
	const topupRows = await db
		.select({
			currency: creditPurchases.currency,
			cents: sql<number>`coalesce(sum(${creditPurchases.amountCents}), 0)::int`,
			count: sql<number>`count(*)::int`,
		})
		.from(creditPurchases)
		.where(and(gte(creditPurchases.createdAt, from), lt(creditPurchases.createdAt, to)))
		.groupBy(creditPurchases.currency);
	const byCurrency: Record<string, number> = {};
	let topupCount = 0;
	for (const r of topupRows) { byCurrency[r.currency] = r.cents; topupCount += r.count; }

	// Daily top-up revenue series (cents; single-currency assumption for the chart).
	const dailyRows = await db
		.select({
			date: sql<string>`to_char(${creditPurchases.createdAt}, 'YYYY-MM-DD')`,
			cents: sql<number>`coalesce(sum(${creditPurchases.amountCents}), 0)::int`,
			count: sql<number>`count(*)::int`,
		})
		.from(creditPurchases)
		.where(and(gte(creditPurchases.createdAt, from), lt(creditPurchases.createdAt, to)))
		.groupBy(sql`to_char(${creditPurchases.createdAt}, 'YYYY-MM-DD')`)
		.orderBy(sql`to_char(${creditPurchases.createdAt}, 'YYYY-MM-DD')`);

	// Active subscribers per plan (status snapshot — not period-scoped, per spec).
	const planRows = await db
		.select({
			planId: subscriptionPlans.id,
			planName: subscriptionPlans.name,
			currency: subscriptionPlans.currency,
			priceCents: subscriptionPlans.priceCents,
			activeCount: sql<number>`count(${networkBilling.networkId})::int`,
		})
		.from(networkBilling)
		.innerJoin(subscriptionPlans, eq(networkBilling.planId, subscriptionPlans.id))
		.where(eq(networkBilling.status, "active"))
		.groupBy(subscriptionPlans.id, subscriptionPlans.name, subscriptionPlans.currency, subscriptionPlans.priceCents);

	const perPlan = planRows.map((p) => ({ planId: p.planId, planName: p.planName, currency: p.currency, priceCents: p.priceCents, activeCount: p.activeCount }));
	const mrrByCurrency: Record<string, number> = {};
	let activeCount = 0;
	for (const p of perPlan) {
		mrrByCurrency[p.currency] = (mrrByCurrency[p.currency] ?? 0) + p.priceCents * p.activeCount;
		activeCount += p.activeCount;
	}

	return {
		from: from.toISOString(), to: to.toISOString(),
		topups: { count: topupCount, byCurrency },
		subscriptions: { activeCount, mrrByCurrency, perPlan },
		daily: dailyRows.map((d) => ({ date: d.date, topupCents: d.cents, topupCount: d.count })),
	};
}
