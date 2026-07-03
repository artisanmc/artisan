import { Hono } from "hono";
import { getStripeGateway } from "./stripe";
import { handleStripeEvent } from "./webhookHandler";

export function buildBillingWebhookRouter(): Hono {
	const r = new Hono();
	r.post("/webhook", async (c) => {
		const raw = await c.req.text();
		const sig = c.req.header("stripe-signature") ?? "";
		let event;
		try {
			event = getStripeGateway().constructWebhookEvent(raw, sig);
		} catch {
			return c.json({ error: "invalid_signature" }, 400);
		}
		await handleStripeEvent(event);
		return c.json({ received: true });
	});
	return r;
}
