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
