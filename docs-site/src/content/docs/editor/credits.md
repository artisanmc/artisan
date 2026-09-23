---
title: Buying credits & subscriptions
description: Check your credit balance, buy credit packs, subscribe to a plan, and manage billing.
---

Credits power the AI Assistant. They are shared across everyone in your **network** — the owner buys and manages them, and the whole team draws from the same pool. This page explains how to see your balance and top it up.

## See your balance

The **credit indicator** sits in the assistant composer, next to the model selector. It shows your total remaining credits with a colored dot:

- **Green** — healthy balance.
- **Amber** — running low.
- **Red** — critically low or empty; top up to keep chatting.

Click the indicator to open a breakdown:

- **Subscription** — the current billing period's quota (monthly or yearly, according to your plan). When you have an active plan, a bar shows how much remains.
- **Rollover** — unused subscription credits carried into the next period, up to your plan's cap.
- **Top-up** — credits bought as one-off packs. These never expire.

Credits are always spent in that order (subscription first, then rollover, then top-up), so your permanent top-up credits are preserved as long as possible.

The popover also shows your renewal date and an **Add credits** button that opens the credits page.

## Buy a credit pack

Open **`/credits`** — click **Add credits** from the indicator, or **Billing & credits** in your network page header. Under **Credit packs** you'll find one-off packs. Each card shows the price and how many credits you'll receive — including any bonus. Click **Buy** to open Stripe's secure checkout. After paying, you're returned to the credits page and your top-up credits appear within a few moments.

## Subscribe to a plan

Browse [Pricing](/pricing) without signing in to see the current plans, their monthly or yearly prices, credits, rollover caps and included benefits. These subscriptions fund the AI assistant; they are not separate editions of the visual editor. You can [try the demo](/demo) without an account or a server.

Choose a plan, then create an account or sign in. Your choice is preserved through email, Google and Discord authentication. Select the network that will receive the credits, or create one if you do not have a network yet. Only a network owner can continue to Stripe, and payment always requires an explicit action.

The **Subscriptions** section on `/credits` offers the same catalog. Once payment is confirmed, the plan becomes active and credits are granted at the start of each billing period. Unused credits carry over up to the plan's cap. If the network already has a subscription, manage it in the billing portal instead of creating another one.

Returning from checkout does not by itself confirm payment. The return message explains that the balance and subscription may take a little time to update; use **Refresh billing** to check their current state. You can dismiss the return message yourself. An unavailable catalog shows an error and a retry action rather than silently hiding the offers.

## Manage your subscription

The **My subscription** section shows your current plan, its status, and the next renewal date. Click **Manage subscription** to open the Stripe **Customer Portal**, where you can update your payment method, change or cancel your plan, and download invoices.

If a renewal payment fails, your subscription enters a short grace period before it's suspended — you'll keep access to any credits you already have.

## Purchase history

The **Purchase history** table lists your past top-ups and subscription charges, with a link to each Stripe invoice.

> Billing is per network. Choose the intended network before buying. Checkout and billing-portal returns restore the network used for that purchase, even if your previous workspace selection was different.
