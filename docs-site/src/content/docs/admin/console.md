---
title: Admin console
description: Manage platform-wide settings — including the AI provider — from the /admin console.
---

The **admin console** is a web page at `/admin` in the editor, reserved for
platform administrators. Its sidebar includes **Billing**, **AI**,
where you configure the provider that powers the in-editor assistant without
redeploying the backend, and **Users**, where you manage the platform's
accounts.

> **Who can access it?**
> Only users flagged as admins. The console (and the link to it) is hidden for
> everyone else, and the backend rejects admin API calls from non-admins.

## Becoming an admin

Admins are bootstrapped from an environment variable on the backend:

```bash
# Comma-separated list of emails promoted to admin on their next sign-in.
ADMIN_BOOTSTRAP_EMAILS="you@example.com,teammate@example.com"
```

The first time a listed user signs in, their account is promoted (`is_admin`
flips to `true` in the database) and stays an admin afterward — you can remove
the email from the variable once promotion has happened. An **Admin console**
link then appears on your account page, and `/admin` becomes accessible.

## Presenting subscription plans

Open **Billing → Subscriptions** at `/admin/billing`. Free and monthly/yearly
Pro are managed in code and installed automatically in each environment. Their
conditions are read-only here; changing them requires a new catalogue version
and deployment. Standard offers appear on public `/pricing` even before payment
setup is available.

Free is every Network's default plan. Its limits apply automatically; there is no
separate editor access setting. The list distinguishes credit allocation from
billing: both Pro offers grant **500 credits/month**, including annual billing.

Create a custom offer by copying a standard version. Set its price, billing and
credit cadence, limits and target Network, then save the draft. A blank limit
means unlimited; zero means no allowance. The copy is independent of later
standard-plan changes. Drafts can be created without Stripe and are not offered
to customers.

Publish the completed draft to make it available in its target Network's billing
page. Custom offers stay private and never appear on public Pricing. Publishing
does not grant an entitlement or confirm payment. Checkout remains unavailable
until payment setup is ready.

After connecting Stripe, use **Set up payment offers** to prepare the published
offers for checkout. The action can be retried after a setup failure; each row
shows its payment readiness. This does not change the offer's conditions.

Editing published conditions creates a new draft version. Publish that version
when ready; subscribers retain the version they have paid for. Existing manual
plans are preserved as inactive custom drafts for review and completion.

Deactivating a custom offer withdraws all its versions from new purchases,
including an older published version when a newer draft exists. Existing paid
conditions stay valid until their paid period ends.

## Managing users

The **Users** section lists every account on the platform, with a search box
(matches name or email). Click a user to open their profile:

- **Editable fields** — name, email, and the **Administrator** flag. Only the
  fields you change are saved. Emails must stay unique, and you can't remove
  your own admin access (so you can't lock yourself out).
- **Read-only facts** — how the account signs in (email + password vs Discord
  only), when it was created, and the networks the user belongs to with their
  role in each.

## Configuring the AI provider

Open `/admin` (or follow the **Admin console** link on your account page) and
use the **AI** tab:

| Field | What it does |
| --- | --- |
| **Provider** | Which AI vendor to use (OpenAI, DeepSeek, Mistral, OpenRouter, or a local endpoint). |
| **Base URL** *(optional)* | Override the provider's API endpoint — leave empty to use the provider's default. |
| **Model** | The model id to call (e.g. `gpt-4.1-mini`, `deepseek-chat`). |
| **API key** | Your provider key. It is **write-only**: stored encrypted, never shown back. |

- **Test connection** sends a tiny probe to the configured provider and reports
  whether the round-trip succeeded — handy before saving.
- **Save** persists the configuration. The assistant engine reads it on the next
  message, so changes take effect **without a redeploy**.

### About the API key

The key is never returned by the server. When a key is already set, the field
shows a `•••• set` placeholder; **leaving it empty keeps the existing key**.
Type a new value only when you want to replace it.

> **Encryption required for keys.**
> Saving an API key requires the backend to have a `CONFIG_ENC_KEY` (a 32-byte
> hex string) so the secret can be encrypted at rest. Without it, saving a key
> is refused — set `CONFIG_ENC_KEY` on the backend first.

If no DB configuration is present, the assistant falls back to the backend's
environment variables (`ASSISTANT_PROVIDER`, `ASSISTANT_MODEL`,
`ASSISTANT_API_KEY`), so existing deployments keep working until you save a
config here.
