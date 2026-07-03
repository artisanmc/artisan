import { Hono } from "hono";
import { getPack, listPacks, creditsForPack } from "./packsRepo";
import { getPlan, listPlans } from "./plansRepo";
import { ensureCustomer, getNetworkBilling, isMember } from "./networkBillingRepo";
import { listPurchases } from "./purchasesRepo";
import { getBucketBalances } from "../ai/creditsRepo";
import { getStripeGateway } from "./stripe";

const editorUrl = (): string => process.env.EDITOR_URL ?? "http://localhost:5173";
const successUrl = (): string => process.env.BILLING_SUCCESS_URL ?? `${editorUrl()}/credits?checkout=success`;
const cancelUrl = (): string => process.env.BILLING_CANCEL_URL ?? `${editorUrl()}/credits?checkout=cancel`;
const portalReturnUrl = (): string => process.env.BILLING_PORTAL_RETURN_URL ?? `${editorUrl()}/credits`;

export function buildBillingUserRouter(): Hono {
	const r = new Hono();

	r.post("/checkout/pack", async (c) => {
		const user = c.get("user");
		if (!user) return c.json({ error: "unauthorized" }, 401);
		const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
		const networkId = typeof body.networkId === "string" ? body.networkId : "";
		const packId = typeof body.packId === "string" ? body.packId : "";
		if (!(await isMember(user.id, networkId))) return c.json({ error: "forbidden" }, 403);
		const pack = await getPack(packId);
		if (!pack || !pack.isActive || !pack.stripePriceId) return c.json({ error: "pack_not_found" }, 404);
		const customerId = await ensureCustomer(networkId, user.email);
		const { url } = await getStripeGateway().createCheckoutSession({
			mode: "payment",
			priceId: pack.stripePriceId,
			customerId,
			successUrl: successUrl(),
			cancelUrl: cancelUrl(),
			metadata: { networkId, kind: "pack", packId, userId: user.id },
		});
		return c.json({ url });
	});

	r.post("/checkout/subscription", async (c) => {
		const user = c.get("user");
		if (!user) return c.json({ error: "unauthorized" }, 401);
		const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
		const networkId = typeof body.networkId === "string" ? body.networkId : "";
		const planId = typeof body.planId === "string" ? body.planId : "";
		if (!(await isMember(user.id, networkId))) return c.json({ error: "forbidden" }, 403);
		const plan = await getPlan(planId);
		if (!plan || !plan.isActive || !plan.stripePriceId) return c.json({ error: "plan_not_found" }, 404);
		const customerId = await ensureCustomer(networkId, user.email);
		const { url } = await getStripeGateway().createCheckoutSession({
			mode: "subscription",
			priceId: plan.stripePriceId,
			customerId,
			successUrl: successUrl(),
			cancelUrl: cancelUrl(),
			metadata: { networkId, kind: "subscription", planId, userId: user.id },
		});
		return c.json({ url });
	});

	r.post("/portal", async (c) => {
		const user = c.get("user");
		if (!user) return c.json({ error: "unauthorized" }, 401);
		const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
		const networkId = typeof body.networkId === "string" ? body.networkId : "";
		if (!(await isMember(user.id, networkId))) return c.json({ error: "forbidden" }, 403);
		const billing = await getNetworkBilling(networkId);
		if (!billing?.stripeCustomerId) return c.json({ error: "no_billing" }, 400);
		const { url } = await getStripeGateway().createPortalSession({
			customerId: billing.stripeCustomerId,
			returnUrl: portalReturnUrl(),
		});
		return c.json({ url });
	});

	r.get("/balance", async (c) => {
		const user = c.get("user");
		if (!user) return c.json({ error: "unauthorized" }, 401);
		const networkId = c.req.query("networkId") ?? "";
		if (!(await isMember(user.id, networkId))) return c.json({ error: "forbidden" }, 403);
		const b = await getBucketBalances(networkId);
		const billing = await getNetworkBilling(networkId);
		let subscriptionQuota = 0;
		if (billing?.planId) {
			const plan = await getPlan(billing.planId);
			subscriptionQuota = plan?.creditsPerPeriod ?? 0;
		}
		return c.json({ ...b, subscriptionQuota, periodEnd: billing?.currentPeriodEnd?.toISOString() ?? null });
	});

	r.get("/packs", async (c) => {
		// public catalog (no user needed)
		const packs = (await listPacks())
			.filter((p) => p.isActive)
			.map((p) => ({
				id: p.id, name: p.name, priceCents: p.priceCents, currency: p.currency,
				credits: p.credits, bonusPct: p.bonusPct, creditsGranted: creditsForPack(p),
			}));
		return c.json({ packs });
	});

	r.get("/plans", async (c) => {
		// public catalog (no user needed)
		const plans = (await listPlans())
			.filter((p) => p.isActive)
			.map((p) => ({
				id: p.id, name: p.name, interval: p.interval, priceCents: p.priceCents,
				currency: p.currency, creditsPerPeriod: p.creditsPerPeriod, rolloverCap: p.rolloverCap, features: p.features,
			}));
		return c.json({ plans });
	});

	r.get("/subscription", async (c) => {
		const user = c.get("user");
		if (!user) return c.json({ error: "unauthorized" }, 401);
		const networkId = c.req.query("networkId") ?? "";
		if (!(await isMember(user.id, networkId))) return c.json({ error: "forbidden" }, 403);
		const billing = await getNetworkBilling(networkId);
		if (!billing?.status) return c.json({ status: null });
		const plan = billing.planId ? await getPlan(billing.planId) : null;
		return c.json({
			status: billing.status,
			planId: billing.planId,
			planName: plan?.name ?? null,
			currentPeriodEnd: billing.currentPeriodEnd?.toISOString() ?? null,
			graceUntil: billing.graceUntil?.toISOString() ?? null,
		});
	});

	r.get("/purchases", async (c) => {
		const user = c.get("user");
		if (!user) return c.json({ error: "unauthorized" }, 401);
		const networkId = c.req.query("networkId") ?? "";
		if (!(await isMember(user.id, networkId))) return c.json({ error: "forbidden" }, 403);
		const purchases = (await listPurchases(networkId)).map((p) => ({
			id: p.id, amountCents: p.amountCents, currency: p.currency, credits: p.credits,
			stripeInvoiceUrl: p.stripeInvoiceUrl, createdAt: p.createdAt.toISOString(),
		}));
		return c.json({ purchases });
	});

	return r;
}
