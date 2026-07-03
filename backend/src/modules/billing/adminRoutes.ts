import { Hono } from "hono";
import {
	createPack,
	deactivatePack,
	getPack,
	listPacks,
	updatePack,
	type CreditPack,
	type PackInput,
} from "./packsRepo";
import {
	createPlan,
	deactivatePlan,
	getPlan,
	listPlans,
	updatePlan,
	type PlanInput,
	type SubscriptionPlan,
} from "./plansRepo";

function packDto(p: CreditPack) {
	return { ...p, createdAt: p.createdAt.toISOString(), updatedAt: p.updatedAt.toISOString() };
}

/** null si invalide. `partial` autorise les champs manquants (PUT). */
function parsePackBody(body: Record<string, unknown>, partial: boolean): Partial<PackInput> | null {
	const out: Partial<PackInput> = {};
	if (typeof body.name === "string") out.name = body.name;
	if (typeof body.currency === "string") out.currency = body.currency.toLowerCase();
	const int = (k: string) => (typeof body[k] === "number" && Number.isInteger(body[k]) ? (body[k] as number) : undefined);
	const priceCents = int("priceCents");
	if (priceCents !== undefined) out.priceCents = priceCents;
	const credits = int("credits");
	if (credits !== undefined) out.credits = credits;
	const bonusPct = int("bonusPct");
	if (bonusPct !== undefined) out.bonusPct = bonusPct;
	const sortOrder = int("sortOrder");
	if (sortOrder !== undefined) out.sortOrder = sortOrder;
	if (typeof body.isActive === "boolean") out.isActive = body.isActive;
	// Validation
	if (out.name === "") return null;
	if (out.priceCents !== undefined && out.priceCents <= 0) return null;
	if (out.credits !== undefined && out.credits <= 0) return null;
	if (out.bonusPct !== undefined && out.bonusPct < 0) return null;
	if (!partial) {
		if (!out.name || out.priceCents === undefined || out.credits === undefined) return null;
	}
	return out;
}

export function buildBillingAdminRouter(): Hono {
	const r = new Hono();

	r.get("/billing/packs", async (c) => c.json({ packs: (await listPacks()).map(packDto) }));
	r.get("/billing/packs/:id", async (c) => {
		const pack = await getPack(c.req.param("id"));
		return pack ? c.json(packDto(pack)) : c.json({ error: "not_found" }, 404);
	});

	r.post("/billing/packs", async (c) => {
		const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
		const input = parsePackBody(body, false);
		if (!input) return c.json({ error: "invalid_pack" }, 400);
		const pack = await createPack(input as PackInput);
		return c.json(packDto(pack));
	});

	r.put("/billing/packs/:id", async (c) => {
		const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
		const patch = parsePackBody(body, true);
		if (!patch) return c.json({ error: "invalid_pack" }, 400);
		if (!(await getPack(c.req.param("id")))) return c.json({ error: "not_found" }, 404);
		const pack = await updatePack(c.req.param("id"), patch);
		return pack ? c.json(packDto(pack)) : c.json({ error: "not_found" }, 404);
	});

	r.post("/billing/packs/:id/deactivate", async (c) => {
		const ok = await deactivatePack(c.req.param("id"));
		return ok ? c.json({ ok: true }) : c.json({ error: "not_found" }, 404);
	});

	// Plan routes
	function planDto(p: SubscriptionPlan) {
		return { ...p, createdAt: p.createdAt.toISOString(), updatedAt: p.updatedAt.toISOString() };
	}

	function parsePlanBody(body: Record<string, unknown>, partial: boolean): Partial<PlanInput> | null {
		const out: Partial<PlanInput> = {};
		if (typeof body.name === "string") out.name = body.name;
		if (typeof body.currency === "string") out.currency = body.currency.toLowerCase();
		if (typeof body.features === "string") out.features = body.features;
		if (body.interval === "month" || body.interval === "year") out.interval = body.interval;
		const int = (k: string) => (typeof body[k] === "number" && Number.isInteger(body[k]) ? (body[k] as number) : undefined);
		const priceCents = int("priceCents");
		if (priceCents !== undefined) out.priceCents = priceCents;
		const cpp = int("creditsPerPeriod");
		if (cpp !== undefined) out.creditsPerPeriod = cpp;
		const cap = int("rolloverCap");
		if (cap !== undefined) out.rolloverCap = cap;
		const sortOrder = int("sortOrder");
		if (sortOrder !== undefined) out.sortOrder = sortOrder;
		if (typeof body.isActive === "boolean") out.isActive = body.isActive;
		if (out.name === "") return null;
		if (out.priceCents !== undefined && out.priceCents <= 0) return null;
		if (out.creditsPerPeriod !== undefined && out.creditsPerPeriod <= 0) return null;
		if (out.rolloverCap !== undefined && out.rolloverCap < 0) return null;
		if (!partial) {
			if (!out.name || out.priceCents === undefined || out.creditsPerPeriod === undefined) return null;
		}
		return out;
	}

	r.get("/billing/plans", async (c) => c.json({ plans: (await listPlans()).map(planDto) }));
	r.get("/billing/plans/:id", async (c) => {
		const plan = await getPlan(c.req.param("id"));
		return plan ? c.json(planDto(plan)) : c.json({ error: "not_found" }, 404);
	});

	r.post("/billing/plans", async (c) => {
		const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
		const input = parsePlanBody(body, false);
		if (!input) return c.json({ error: "invalid_plan" }, 400);
		return c.json(planDto(await createPlan(input as PlanInput)));
	});
	r.put("/billing/plans/:id", async (c) => {
		const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
		const patch = parsePlanBody(body, true);
		if (!patch) return c.json({ error: "invalid_plan" }, 400);
		if (!(await getPlan(c.req.param("id")))) return c.json({ error: "not_found" }, 404);
		const plan = await updatePlan(c.req.param("id"), patch);
		return plan ? c.json(planDto(plan)) : c.json({ error: "not_found" }, 404);
	});
	r.post("/billing/plans/:id/deactivate", async (c) => {
		const ok = await deactivatePlan(c.req.param("id"));
		return ok ? c.json({ ok: true }) : c.json({ error: "not_found" }, 404);
	});

	return r;
}
