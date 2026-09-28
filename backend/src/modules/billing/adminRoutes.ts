import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../../db/index";
import { networks } from "../../db/schema";
import { grantCredits } from "../ai/creditsRepo";
import { createPack, deactivatePack, getPack, listPacks, updatePack, type CreditPack, type PackInput, } from "./packsRepo";
import { createPlan, deactivatePlan, getPlan, listPlans, updatePlan, type PlanInput, type SubscriptionPlan, } from "./plansRepo";
import { salesSummary } from "./salesRepo";
import { billingConfigAudit } from "../../db/schema";
import { provisionPublishedPlans } from "./planProvisioning";
import { isStripeConfigured } from "./stripe";
function packDto(p: CreditPack) {
    return { ...p, createdAt: p.createdAt.toISOString(), updatedAt: p.updatedAt.toISOString() };
}
/** null si invalide. `partial` autorise les champs manquants (PUT). */
function parsePackBody(body: Record<string, unknown>, partial: boolean): Partial<PackInput> | null {
    const out: Partial<PackInput> = {};
    if (typeof body.name === "string")
        out.name = body.name;
    if (typeof body.currency === "string")
        out.currency = body.currency.toLowerCase();
    const int = (k: string) => (typeof body[k] === "number" && Number.isInteger(body[k]) ? (body[k] as number) : undefined);
    const priceCents = int("priceCents");
    if (priceCents !== undefined)
        out.priceCents = priceCents;
    const credits = int("credits");
    if (credits !== undefined)
        out.credits = credits;
    const bonusPct = int("bonusPct");
    if (bonusPct !== undefined)
        out.bonusPct = bonusPct;
    const sortOrder = int("sortOrder");
    if (sortOrder !== undefined)
        out.sortOrder = sortOrder;
    if (typeof body.isActive === "boolean")
        out.isActive = body.isActive;
    // Validation
    if (out.name === "")
        return null;
    if (out.priceCents !== undefined && out.priceCents <= 0)
        return null;
    if (out.credits !== undefined && out.credits <= 0)
        return null;
    if (out.bonusPct !== undefined && out.bonusPct < 0)
        return null;
    if (!partial) {
        if (!out.name || out.priceCents === undefined || out.credits === undefined)
            return null;
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
        if (!input)
            return c.json({ error: "invalid_pack" }, 400);
        const pack = await createPack(input as PackInput);
        return c.json(packDto(pack));
    });
    r.put("/billing/packs/:id", async (c) => {
        const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
        const patch = parsePackBody(body, true);
        if (!patch)
            return c.json({ error: "invalid_pack" }, 400);
        if (!(await getPack(c.req.param("id"))))
            return c.json({ error: "not_found" }, 404);
        const pack = await updatePack(c.req.param("id"), patch);
        return pack ? c.json(packDto(pack)) : c.json({ error: "not_found" }, 404);
    });
    r.post("/billing/packs/:id/deactivate", async (c) => {
        const ok = await deactivatePack(c.req.param("id"));
        return ok ? c.json({ ok: true }) : c.json({ error: "not_found" }, 404);
    });
    // Plan routes
    function planDto(p: SubscriptionPlan) {
        return { ...p, stripeProvisioningStatus: p.stripePriceId ? "ready" : isStripeConfigured() ? "pending" : "unavailable", createdAt: p.createdAt.toISOString(), updatedAt: p.updatedAt.toISOString() };
    }
    function parsePlanBody(body: Record<string, unknown>, partial: boolean, existingPro = false): Partial<PlanInput> | null {
        if (!body || typeof body !== "object" || Array.isArray(body))
            return null;
        if (body.description !== undefined && (typeof body.description !== "string" || body.description.trim().length > 240))
            return null;
        if (body.highlighted !== undefined && typeof body.highlighted !== "boolean")
            return null;
        if (body.editorPro !== undefined && typeof body.editorPro !== "boolean")
            return null;
        if (body.features !== undefined && typeof body.features !== "string")
            return null;
        if (body.sortOrder !== undefined && (typeof body.sortOrder !== "number" || !Number.isSafeInteger(body.sortOrder) || body.sortOrder < -2147483648 || body.sortOrder > 2147483647))
            return null;
        const out: Partial<PlanInput> = {};
        if (typeof body.name === "string")
            out.name = body.name;
        if (typeof body.currency === "string")
            out.currency = body.currency.toLowerCase();
        if (typeof body.features === "string")
            out.features = body.features;
        if (typeof body.description === "string")
            out.description = body.description.trim();
        if (typeof body.highlighted === "boolean")
            out.highlighted = body.highlighted;
        if (typeof body.editorPro === "boolean")
            out.editorPro = body.editorPro;
        if (body.publicationStatus !== undefined || body.managedBy !== undefined || body.audience !== undefined || body.key !== undefined || body.version !== undefined)
            return null;
        if (body.sourcePlanId !== undefined) {
            if (typeof body.sourcePlanId !== "string" || !body.sourcePlanId)
                return null;
            out.sourcePlanId = body.sourcePlanId;
        }
        if (body.targetNetworkId !== undefined) {
            if (body.targetNetworkId !== null && (typeof body.targetNetworkId !== "string" || !body.targetNetworkId))
                return null;
            out.targetNetworkId = body.targetNetworkId as string | null;
        }
        if (body.creditInterval !== undefined) {
            if (!["month", "year", "none"].includes(body.creditInterval as string))
                return null;
            out.creditInterval = body.creditInterval as PlanInput["creditInterval"];
        }
        if (body.limits !== undefined) {
            const limits = body.limits as PlanInput["limits"];
            if (!limits || typeof limits !== "object" || ["servers", "resourcesPerServer", "collaborators"].some(k => { const v = (limits as Record<string, unknown>)[k]; return v !== null && (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0 || v > 2147483647); }))
                return null;
            out.limits = limits;
        }
        if (body.capabilities !== undefined) {
            if (!body.capabilities || typeof (body.capabilities as {
                editorPro?: unknown;
            }).editorPro !== "boolean")
                return null;
            out.capabilities = { editorPro: (body.capabilities as {
                    editorPro: boolean;
                }).editorPro };
        }
        for (const k of ["name", "currency", "interval"])
            if (body[k] !== undefined && typeof body[k] !== "string")
                return null;
        if (body.interval !== undefined && body.interval !== "month" && body.interval !== "year")
            return null;
        for (const k of ["priceCents", "creditsPerPeriod", "rolloverCap"])
            if (body[k] !== undefined && (typeof body[k] !== "number" || !Number.isSafeInteger(body[k]) || (body[k] as number) < 0 || (body[k] as number) > 2147483647))
                return null;
        if (body.interval === "month" || body.interval === "year")
            out.interval = body.interval;
        const int = (k: string) => (typeof body[k] === "number" && Number.isInteger(body[k]) ? (body[k] as number) : undefined);
        const priceCents = int("priceCents");
        if (priceCents !== undefined)
            out.priceCents = priceCents;
        const cpp = int("creditsPerPeriod");
        if (cpp !== undefined)
            out.creditsPerPeriod = cpp;
        const cap = int("rolloverCap");
        if (cap !== undefined)
            out.rolloverCap = cap;
        const sortOrder = int("sortOrder");
        if (sortOrder !== undefined)
            out.sortOrder = sortOrder;
        if (typeof body.isActive === "boolean")
            out.isActive = body.isActive;
        if (out.name === "")
            return null;
        if (out.priceCents !== undefined && out.priceCents < 0)
            return null;
        if (out.rolloverCap !== undefined && out.rolloverCap < 0)
            return null;
        if (!partial) {
            if (!out.sourcePlanId)
                return null;
        }
        return out;
    }
    r.get("/billing/plans", async (c) => {
        const rows = await listPlans();
        return c.json({ plans: rows.filter(p => !rows.some(other => other.key === p.key && other.version > p.version && (p.managedBy !== "code" || other.interval === p.interval))).map(planDto) });
    });
    r.get("/billing/plans/:id", async (c) => {
        const plan = await getPlan(c.req.param("id"));
        return plan ? c.json(planDto(plan)) : c.json({ error: "not_found" }, 404);
    });
    r.post("/billing/plans/provision", async (c) => c.json({ results: await provisionPublishedPlans() }));
    r.post("/billing/plans", async (c) => {
        const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
        const input = parsePlanBody(body, false);
        if (!input)
            return c.json({ error: "invalid_plan" }, 400);
        const source = await getPlan(input.sourcePlanId!);
        if (!source || source.managedBy !== "code")
            return c.json({ error: "source_plan_not_found" }, 400);
        if (input.targetNetworkId && !(await db.select({ id: networks.id }).from(networks).where(eq(networks.id, input.targetNetworkId))).length)
            return c.json({ error: "target_network_not_found" }, 400);
        let plan: SubscriptionPlan;
        try {
            plan = await createPlan({ ...source, ...input, interval: input.interval ?? source.interval as "month" | "year", creditInterval: input.creditInterval ?? source.creditInterval as "month" | "year" | "none", sourcePlanId: source.id, publicationStatus: "draft" });
        }
        catch (e) {
            return c.json({ error: e instanceof Error ? e.message : "invalid_plan" }, 400);
        }
        await db.insert(billingConfigAudit).values({ id: crypto.randomUUID(), actorId: c.get("user")?.id ?? null, action: "plan_create", before: null, after: plan, createdAt: new Date() });
        return c.json(planDto(plan));
    });
    r.put("/billing/plans/:id", async (c) => {
        const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
        const before = await getPlan(c.req.param("id"));
        if (!before)
            return c.json({ error: "not_found" }, 404);
        if (before.managedBy === "code")
            return c.json({ error: "managed_plan_read_only" }, 409);
        const patch = parsePlanBody(body, true, before.editorPro);
        if (!patch)
            return c.json({ error: "invalid_plan" }, 400);
        if (patch.targetNetworkId && !(await db.select({ id: networks.id }).from(networks).where(eq(networks.id, patch.targetNetworkId))).length)
            return c.json({ error: "target_network_not_found" }, 400);
        let plan: SubscriptionPlan | null;
        try {
            plan = await updatePlan(c.req.param("id"), patch);
        }
        catch (e) {
            return c.json({ error: e instanceof Error ? e.message : "invalid_plan" }, 400);
        }
        if (plan)
            await db.insert(billingConfigAudit).values({ id: crypto.randomUUID(), actorId: c.get("user")?.id ?? null, action: "plan_update", before, after: plan, createdAt: new Date() });
        return plan ? c.json(planDto(plan)) : c.json({ error: "not_found" }, 404);
    });
    r.post("/billing/plans/:id/deactivate", async (c) => {
        const before = await getPlan(c.req.param("id"));
        if (before?.managedBy === "code")
            return c.json({ error: "managed_plan_read_only" }, 409);
        const ok = await deactivatePlan(c.req.param("id"));
        if (ok)
            await db.insert(billingConfigAudit).values({ id: crypto.randomUUID(), actorId: c.get("user")?.id ?? null, action: "plan_deactivate", before, after: await getPlan(c.req.param("id")), createdAt: new Date() });
        return ok ? c.json({ ok: true }) : c.json({ error: "not_found" }, 404);
    });
    r.post("/billing/plans/:id/publish", async (c) => {
        const before = await getPlan(c.req.param("id"));
        if (!before)
            return c.json({ error: "not_found" }, 404);
        if (before.managedBy === "code")
            return c.json({ error: "managed_plan_read_only" }, 409);
        if (before.publicationStatus === "published")
            return c.json(planDto(before));
        if (!before.targetNetworkId)
            return c.json({ error: "target_network_required" }, 400);
        let plan: SubscriptionPlan | null;
        try {
            plan = await updatePlan(before.id, { publicationStatus: "published" });
        }
        catch (e) {
            return c.json({ error: e instanceof Error ? e.message : "invalid_plan" }, 400);
        }
        await db.insert(billingConfigAudit).values({ id: crypto.randomUUID(), actorId: c.get("user")?.id ?? null, action: "plan_publish", before, after: plan, createdAt: new Date() });
        return c.json(planDto(plan!));
    });
    r.get("/billing/sales", async (c) => {
        const to = c.req.query("to") ? new Date(c.req.query("to") as string) : new Date();
        const from = c.req.query("from") ? new Date(c.req.query("from") as string) : new Date(to.getTime() - 30 * 24 * 3600000);
        if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()))
            return c.json({ error: "invalid_range" }, 400);
        return c.json(await salesSummary(from, to));
    });
    r.post("/billing/grant", async (c) => {
        const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
        const networkId = typeof body.networkId === "string" ? body.networkId : "";
        const amount = body.amount;
        if (typeof amount !== "number" || !Number.isInteger(amount) || amount <= 0)
            return c.json({ error: "invalid_amount" }, 400);
        const net = await db.select({ id: networks.id }).from(networks).where(eq(networks.id, networkId));
        if (net.length === 0)
            return c.json({ error: "network_not_found" }, 404);
        const { balance } = await grantCredits({
            networkId, amount, bucket: "topup", reason: "adjustment",
            note: typeof body.note === "string" ? body.note : undefined,
            createdBy: c.get("user")?.id ?? null,
        });
        return c.json({ ok: true, balance });
    });
    return r;
}
