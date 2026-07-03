import Stripe from "stripe";

export interface StripeGateway {
	/** Create a Stripe product + a price for it. `recurring` → a subscription
	 *  price; omitted → a one-off price. Returns the created ids. */
	createProductWithPrice(input: {
		name: string;
		amountCents: number;
		currency: string;
		recurring?: { interval: "month" | "year" };
	}): Promise<{ productId: string; priceId: string }>;
	/** Archive a price (Stripe prices are immutable; deactivating/repricing
	 *  archives the old one). */
	archivePrice(priceId: string): Promise<void>;
	/** Create a Stripe customer with metadata. */
	createCustomer(input: { metadata: Record<string, string>; email?: string }): Promise<{ customerId: string }>;
	/** Create a Stripe checkout session for payment or subscription. */
	createCheckoutSession(input: {
		mode: "payment" | "subscription";
		priceId: string;
		customerId: string;
		successUrl: string;
		cancelUrl: string;
		metadata: Record<string, string>;
	}): Promise<{ url: string }>;
	/** Create a Stripe billing portal session. */
	createPortalSession(input: { customerId: string; returnUrl: string }): Promise<{ url: string }>;
}

class RealStripeGateway implements StripeGateway {
	private stripe: Stripe;
	constructor(secretKey: string) {
		this.stripe = new Stripe(secretKey);
	}
	async createProductWithPrice(input: {
		name: string;
		amountCents: number;
		currency: string;
		recurring?: { interval: "month" | "year" };
	}): Promise<{ productId: string; priceId: string }> {
		const product = await this.stripe.products.create({ name: input.name });
		const price = await this.stripe.prices.create({
			product: product.id,
			unit_amount: input.amountCents,
			currency: input.currency,
			...(input.recurring ? { recurring: { interval: input.recurring.interval } } : {}),
		});
		return { productId: product.id, priceId: price.id };
	}
	async archivePrice(priceId: string): Promise<void> {
		await this.stripe.prices.update(priceId, { active: false });
	}
	async createCustomer(input: { metadata: Record<string, string>; email?: string }): Promise<{ customerId: string }> {
		const customer = await this.stripe.customers.create({
			metadata: input.metadata,
			...(input.email ? { email: input.email } : {}),
		});
		return { customerId: customer.id };
	}
	async createCheckoutSession(input: {
		mode: "payment" | "subscription";
		priceId: string;
		customerId: string;
		successUrl: string;
		cancelUrl: string;
		metadata: Record<string, string>;
	}): Promise<{ url: string }> {
		const session = await this.stripe.checkout.sessions.create({
			mode: input.mode,
			customer: input.customerId,
			line_items: [{ price: input.priceId, quantity: 1 }],
			success_url: input.successUrl,
			cancel_url: input.cancelUrl,
			metadata: input.metadata,
			...(input.mode === "subscription" ? { subscription_data: { metadata: input.metadata } } : {}),
		});
		if (!session.url) throw new Error("Stripe did not return a checkout url");
		return { url: session.url };
	}
	async createPortalSession(input: { customerId: string; returnUrl: string }): Promise<{ url: string }> {
		const session = await this.stripe.billingPortal.sessions.create({
			customer: input.customerId,
			return_url: input.returnUrl,
		});
		return { url: session.url };
	}
}

let injected: StripeGateway | null = null;
let real: StripeGateway | null = null;

/** Test hook: inject a fake gateway (skips the real SDK). */
export function __setStripeGatewayForTests(g: StripeGateway | null): void {
	injected = g;
}

/** The active gateway: injected fake in tests, else the real SDK gateway.
 *  Throws if STRIPE_SECRET_KEY is missing and no fake is injected. */
export function getStripeGateway(): StripeGateway {
	if (injected) return injected;
	if (!real) {
		const key = process.env.STRIPE_SECRET_KEY;
		if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
		real = new RealStripeGateway(key);
	}
	return real;
}
