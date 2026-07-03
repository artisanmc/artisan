import { Hono } from "hono";
import { getPack } from "./packsRepo";
import { getPlan } from "./plansRepo";
import { ensureCustomer, getNetworkBilling, isMember } from "./networkBillingRepo";
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

	return r;
}
