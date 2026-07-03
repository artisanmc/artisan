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

function packDto(p: CreditPack) {
	return { ...p, createdAt: p.createdAt.toISOString(), updatedAt: p.updatedAt.toISOString() };
}

/** null si invalide. `partial` autorise les champs manquants (PUT). */
function parsePackBody(body: Record<string, unknown>, partial: boolean): Partial<PackInput> | null {
	const out: Partial<PackInput> = {};
	if (typeof body.name === "string") out.name = body.name;
	if (typeof body.currency === "string") out.currency = body.currency;
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

	return r;
}
