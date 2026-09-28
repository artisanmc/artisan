import Stripe from "stripe";
export interface StripeWebhookEvent {
    id: string;
    type: string;
    data: {
        object: Record<string, unknown>;
    };
}
export interface StripeGateway {
    getSubscriptionPaymentState?(subscriptionId: string): Promise<{invoiceId:string|null;priceId:string|null;paid:boolean}>;
    ensurePlanProduct?(input: {
        planId: string;
        name: string;
    }): Promise<{
        productId: string;
    }>;
    ensurePlanPrice?(input: {
        planId: string;
        productId: string;
        amountCents: number;
        currency: string;
        interval: "month" | "year";
    }): Promise<{
        priceId: string;
    }>;
    /** Create a Stripe product + a price for it. `recurring` → a subscription
     *  price; omitted → a one-off price. Returns the created ids. */
    createProductWithPrice(input: {
        name: string;
        amountCents: number;
        currency: string;
        recurring?: {
            interval: "month" | "year";
        };
    }): Promise<{
        productId: string;
        priceId: string;
    }>;
    /** Create a new price for an existing product (for repricing without orphaning the product). */
    createPriceForProduct(input: {
        productId: string;
        amountCents: number;
        currency: string;
        recurring?: {
            interval: "month" | "year";
        };
    }): Promise<{
        priceId: string;
    }>;
    /** Update a product's name in Stripe. */
    updateProductName(productId: string, name: string): Promise<void>;
    /** Archive a price (Stripe prices are immutable; deactivating/repricing
     *  archives the old one). */
    archivePrice(priceId: string): Promise<void>;
    /** Create a Stripe customer with metadata. */
    createCustomer(input: {
        metadata: Record<string, string>;
        email?: string;
    }): Promise<{
        customerId: string;
    }>;
    /** Create a Stripe checkout session for payment or subscription. */
    createCheckoutSession(input: {
        mode: "payment" | "subscription";
        priceId: string;
        customerId: string;
        successUrl: string;
        cancelUrl: string;
        metadata: Record<string, string>;
    }): Promise<{
        url: string;
    }>;
    /** Create a Stripe billing portal session. */
    createPortalSession(input: {
        customerId: string;
        returnUrl: string;
    }): Promise<{
        url: string;
    }>;
    /** Verify a webhook payload's signature and parse it into an event.
     *  Throws if the signature is invalid. */
    constructWebhookEvent(rawBody: string, signature: string): StripeWebhookEvent;
}
class RealStripeGateway implements StripeGateway {
    private stripe: Stripe;
    constructor(secretKey: string) {
        this.stripe = new Stripe(secretKey);
    }
    async getSubscriptionPaymentState(subscriptionId: string): Promise<{invoiceId:string|null;priceId:string|null;paid:boolean}> {
        const subscription = await this.stripe.subscriptions.retrieve(subscriptionId, {expand:["latest_invoice"]});
        const invoice = subscription.latest_invoice;
        const resolved = typeof invoice === "string" ? await this.stripe.invoices.retrieve(invoice) : invoice;
        return {invoiceId: resolved?.id ?? null, priceId: subscription.items.data.length === 1 ? subscription.items.data[0].price.id : null, paid: resolved?.status === "paid"};
    }
    async ensurePlanProduct(input: {
        planId: string;
        name: string;
    }): Promise<{
        productId: string;
    }> {
        const id = `artisan_plan_${input.planId}`;
        try {
            const product = await this.stripe.products.retrieve(id);
            if (product.deleted)
                throw new Error("plan_product_deleted");
            return { productId: product.id };
        }
        catch (error) {
            if (!(error instanceof Stripe.errors.StripeInvalidRequestError) || error.code !== "resource_missing")
                throw error;
        }
        const product = await this.stripe.products.create({ id, name: input.name, metadata: { planVersionId: input.planId } }, { idempotencyKey: `plan-product:${input.planId}` });
        return { productId: product.id };
    }
    async ensurePlanPrice(input: {
        planId: string;
        productId: string;
        amountCents: number;
        currency: string;
        interval: "month" | "year";
    }): Promise<{
        priceId: string;
    }> {
        const lookupKey = `artisan_plan_${input.planId}`;
        const prices = await this.stripe.prices.list({ lookup_keys: [lookupKey], limit: 1 });
        const existing = prices.data[0];
        if (existing) {
            const productId = typeof existing.product === "string" ? existing.product : existing.product.id;
            if (productId !== input.productId || existing.unit_amount !== input.amountCents || existing.currency !== input.currency || existing.recurring?.interval !== input.interval || !existing.active)
                throw new Error("plan_price_terms_mismatch");
            return { priceId: existing.id };
        }
        const price = await this.stripe.prices.create({ product: input.productId, unit_amount: input.amountCents, currency: input.currency, recurring: { interval: input.interval }, lookup_key: lookupKey, metadata: { planVersionId: input.planId } }, { idempotencyKey: `plan-price:${input.planId}` });
        return { priceId: price.id };
    }
    async createProductWithPrice(input: {
        name: string;
        amountCents: number;
        currency: string;
        recurring?: {
            interval: "month" | "year";
        };
    }): Promise<{
        productId: string;
        priceId: string;
    }> {
        const product = await this.stripe.products.create({ name: input.name });
        const price = await this.stripe.prices.create({
            product: product.id,
            unit_amount: input.amountCents,
            currency: input.currency,
            ...(input.recurring ? { recurring: { interval: input.recurring.interval } } : {}),
        });
        return { productId: product.id, priceId: price.id };
    }
    async createPriceForProduct(input: {
        productId: string;
        amountCents: number;
        currency: string;
        recurring?: {
            interval: "month" | "year";
        };
    }): Promise<{
        priceId: string;
    }> {
        const price = await this.stripe.prices.create({
            product: input.productId,
            unit_amount: input.amountCents,
            currency: input.currency,
            ...(input.recurring ? { recurring: { interval: input.recurring.interval } } : {}),
        });
        return { priceId: price.id };
    }
    async updateProductName(productId: string, name: string): Promise<void> {
        await this.stripe.products.update(productId, { name });
    }
    async archivePrice(priceId: string): Promise<void> {
        await this.stripe.prices.update(priceId, { active: false });
    }
    async createCustomer(input: {
        metadata: Record<string, string>;
        email?: string;
    }): Promise<{
        customerId: string;
    }> {
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
    }): Promise<{
        url: string;
    }> {
        const session = await this.stripe.checkout.sessions.create({
            mode: input.mode,
            customer: input.customerId,
            line_items: [{ price: input.priceId, quantity: 1 }],
            success_url: input.successUrl,
            cancel_url: input.cancelUrl,
            metadata: input.metadata,
            ...(input.mode === "subscription" ? { subscription_data: { metadata: input.metadata } } : {}),
        });
        if (!session.url)
            throw new Error("Stripe did not return a checkout url");
        return { url: session.url };
    }
    async createPortalSession(input: {
        customerId: string;
        returnUrl: string;
    }): Promise<{
        url: string;
    }> {
        const session = await this.stripe.billingPortal.sessions.create({
            customer: input.customerId,
            return_url: input.returnUrl,
        });
        return { url: session.url };
    }
    constructWebhookEvent(rawBody: string, signature: string): StripeWebhookEvent {
        const secret = process.env.STRIPE_WEBHOOK_SECRET;
        if (!secret)
            throw new Error("STRIPE_WEBHOOK_SECRET is not set");
        return this.stripe.webhooks.constructEvent(rawBody, signature, secret) as unknown as StripeWebhookEvent;
    }
}
let injected: StripeGateway | null = null;
let real: StripeGateway | null = null;
export function isStripeConfigured(): boolean {
    return Boolean(injected || process.env.STRIPE_SECRET_KEY);
}
/** Test hook: inject a fake gateway (skips the real SDK). */
export function __setStripeGatewayForTests(g: StripeGateway | null): void {
    injected = g;
}
/** The active gateway: injected fake in tests, else the real SDK gateway.
 *  Throws if STRIPE_SECRET_KEY is missing and no fake is injected. */
export function getStripeGateway(): StripeGateway {
    if (injected)
        return injected;
    if (!real) {
        const key = process.env.STRIPE_SECRET_KEY;
        if (!key)
            throw new Error("STRIPE_SECRET_KEY is not set");
        real = new RealStripeGateway(key);
    }
    return real;
}
