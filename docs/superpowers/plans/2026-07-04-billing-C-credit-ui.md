# Billing — Plan C : UI user (CreditIndicator + page /credits)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Donner à l'utilisateur web un **indicateur de solde permanent** (`CreditIndicator` : barre segmentée quota abo + total + états couleur + popover breakdown/CTA) et une **page `/credits` réelle** (achat de packs, souscription d'abonnement, gestion via Customer Portal, historique d'achats) — branchés sur les routes B2a déjà livrées.

**Architecture:** `CreditIndicator` est un composant présentationnel qui reçoit un `BalanceBreakdown` en prop (agnostique de la source). Deux sources l'alimentent : le **composer assistant** via l'endpoint dual-auth existant `GET /api/v1/ai/balance` (project-scoped) **étendu** pour renvoyer le breakdown par bucket (aucun couplage `ai→billing` : les buckets viennent de `ai/creditsRepo.getBucketBalances`) ; la **page `/credits`** via `GET /api/v1/billing/balance?networkId=` (network-scoped, cookie-auth, avec quota+periodEnd). La page lit le network courant depuis `useNetworksStore.activeId`, est gated sur `useAuthStore.currentUser`, et utilise le design system (`Card`, `HBar`, `Table`, `Button`, `EmptyState`, `DropdownMenu`). Fetch brut + `useState`/`useEffect` (le codebase n'a PAS TanStack Query).

**Tech Stack:** React 19 + Vite + TanStack Router (file-based) + Zustand + react-i18next + Radix (`components/ui`). Tests Vitest + Testing Library, **locale FR épinglée** (`tests/setup.ts`).

## Global Constraints

- Spec : `docs/superpowers/specs/2026-07-03-billing-subscriptions-topups-design.md` §UI (C) lignes 106-111. Facturation **per-network**.
- **Design-system-first** : réutiliser `editor/src/components/ui/*` (Button, Card+CardHeader/Title/Content/Footer, Badge, EmptyState, Table+THead/TBody/TR/TH/TD, StatCard, HBar, DropdownMenu+Trigger/Content/Item/Label/Separator) et les classes `globals.css` (`.card`, `.btn*`, `.badge*`, `.chip`, `.eyebrow`, `.display`). **Zéro hex/rgba en dur** — couleurs via `var(--token)`. Composant manquant → le créer dans `components/ui/` + spécimen `/admin/design` dans le même commit (cf. CLAUDE.md).
- **i18n en+fr, parité stricte.** Locales : `editor/src/locales/en.ts` + `fr.ts` (objets littéraux default-exportés). Ajouter un groupe `billing: { ... }` **au même niveau** que `assistant`, mirroré 1-pour-1 en/fr. **Jamais** de chaîne FR/EN en dur dans le JSX. Tests assertent le **français** (locale épinglée dans `tests/setup.ts`).
- **Auth** : les routes `/api/v1/billing/*` sont **cookie-only** (`userAuth`) → le client envoie `credentials: "include"`, sans Bearer. Gate d'affichage sur `useAuthStore((s) => s.currentUser)`. L'endpoint `ai/balance` reste **dual-auth** (Bearer session plugin OU cookie) — ne pas casser ça.
- **Network courant** : `useNetworksStore((s) => s.activeId)` (seul champ persistant, `partialize`). `null` → état « choisis un réseau » (pas de crash, pas de fetch).
- **Fetch idiom** : fonctions typées dans `editor/src/lib/api/billing.ts` (raw `fetch` + `credentials:"include"`), consommées via `useEffect`/`useState`. Pas de TanStack Query.
- **Mobile-friendly** : pas d'affordance hover-only ; grilles responsive (`grid` + `sm:`/`lg:` breakpoints).
- **Redirections Stripe** : `POST /billing/checkout/*` et `/portal` renvoient `{ url }` → le client fait `window.location.assign(url)`. Retour succès/cancel arrive sur `/credits?checkout=success|cancel` (afficher un bandeau, refetch balance).
- Editor tests : `cd editor && npm test`. Build : `cd editor && npm run build` (typecheck TS inclus — DOIT passer). Commits conventional, trailing `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. Stage explicite — jamais `git add -A` (WIP `backend/src/routes/link.ts`, `.agents/`, `AGENTS.md`).

## Contrats backend consommés (B2a, déjà livrés — `backend/src/modules/billing/userRoutes.ts`)

- `GET /api/v1/billing/balance?networkId=` → `{ subscription, rollover, topup, total, subscriptionQuota, periodEnd: string|null }` (cookie-auth, membership-gated).
- `GET /api/v1/billing/packs` → `{ packs: Array<{ id, name, priceCents, currency, credits, bonusPct, creditsGranted }> }` (public).
- `GET /api/v1/billing/plans` → `{ plans: Array<{ id, name, interval, priceCents, currency, creditsPerPeriod, rolloverCap, features }> }` (public).
- `GET /api/v1/billing/subscription?networkId=` → `{ status, planId, planName, currentPeriodEnd: string|null, graceUntil: string|null }` ou `{ status: null }`.
- `GET /api/v1/billing/purchases?networkId=` → `{ purchases: Array<{ id, amountCents, currency, credits, stripeInvoiceUrl: string|null, createdAt: string }> }`.
- `POST /api/v1/billing/checkout/pack` `{ networkId, packId }` → `{ url }` (401/403/404).
- `POST /api/v1/billing/checkout/subscription` `{ networkId, planId }` → `{ url }`.
- `POST /api/v1/billing/portal` `{ networkId }` → `{ url }` (400 `no_billing` si pas de customer).

---

### Task 1: Backend — `ai/balance` renvoie le breakdown par bucket (composer)

**Files:**
- Modify: `backend/src/modules/ai/routes.ts` (handler `GET /balance`)
- Test: `backend/src/modules/ai/routes.test.ts` (ou le fichier de test du router ai — sinon créer `backend/src/modules/ai/balance.test.ts`)
- Modify: `docs/architecture/rest-endpoints.md`

**Interfaces:**
- Consumes: `getBucketBalances(networkId)` de `../ai/creditsRepo` (renvoie `{ subscription, rollover, topup, total }` — **aucune** dépendance billing), `resolveProjectAccess` déjà utilisé.
- Produces: `GET /api/v1/ai/balance?projectId=` renvoie désormais `{ balance, total, subscription, rollover, topup }`. `balance` (= `total`) est conservé pour la compat de l'appelant existant. Dual-auth inchangée.

- [ ] **Step 1: Lire le handler actuel**

`backend/src/modules/ai/routes.ts` handler `r.get("/balance", ...)` fait aujourd'hui `return c.json({ balance: await getBalance(access.networkId) })`. Confirmer l'import de `getBalance` depuis `./creditsRepo` et ajouter `getBucketBalances`.

- [ ] **Step 2: Écrire le test (RED)**

Dans le fichier de test du router ai (suivre le pattern existant des tests de `ai/routes` — chercher un test qui hit `/api/v1/ai/balance`). Ajouter :

```ts
it("GET /ai/balance returns the per-bucket breakdown", async () => {
	// seed: a network with subscription+topup credits (reuse the file's helpers to
	// create a project/network + grant credits into buckets via grantCredits).
	// then call the route as the existing tests do and assert:
	// body.total === body.subscription + body.rollover + body.topup
	// and body.balance === body.total.
	// (Follow the exact request/auth helper the sibling balance test uses.)
});
```

If no existing `ai/balance` test exists, create `backend/src/modules/ai/balance.test.ts` mirroring the auth/seed setup of the nearest ai router test.

- [ ] **Step 3: Run — expect FAIL**

Run: `cd backend && bun run test src/modules/ai` (scope to the ai module test that covers balance)
Expected: FAIL — `body.subscription` undefined.

- [ ] **Step 4: Implémenter**

Remplacer le corps du handler `/balance` :

```ts
		const b = await getBucketBalances(access.networkId);
		return c.json({ balance: b.total, ...b });
```

(`b` = `{ subscription, rollover, topup, total }`. `balance: b.total` garde le champ historique.)

- [ ] **Step 5: Run — expect PASS**

Run: `cd backend && bun run test src/modules/ai`
Expected: PASS.

- [ ] **Step 6: rest-endpoints.md** — sur la ligne `modules/ai/routes.ts`, préciser que `/api/v1/ai/balance` renvoie désormais `{ balance, total, subscription, rollover, topup }` (breakdown par bucket pour l'indicateur composer).

- [ ] **Step 7: Suite backend complète + commit**

Run: `cd backend && bun run test`
Expected: PASS.
```bash
git add backend/src/modules/ai/routes.ts backend/src/modules/ai/*.test.ts docs/architecture/rest-endpoints.md
git commit -m "feat(backend): ai/balance returns per-bucket breakdown for the credit indicator"
```

---

### Task 2: Editor — client `lib/api/billing.ts` + `formatMoney` + breakdown côté ai client

**Files:**
- Create: `editor/src/lib/api/billing.ts`
- Modify: `editor/src/lib/format.ts`
- Modify: `editor/src/lib/api/aiUser.ts` (`getBalance` → breakdown)
- Test: `editor/src/lib/api/billing.test.ts`, `editor/src/lib/format.test.ts` (étendre si existe, sinon créer)

**Interfaces:**
- Produces (`billing.ts`):
  ```ts
  export interface BalanceBreakdown { total: number; subscription: number; rollover: number; topup: number; subscriptionQuota?: number; periodEnd?: string | null; }
  export interface PackDto { id: string; name: string; priceCents: number; currency: string; credits: number; bonusPct: number; creditsGranted: number; }
  export interface PlanDto { id: string; name: string; interval: string; priceCents: number; currency: string; creditsPerPeriod: number; rolloverCap: number; features: string; }
  export interface SubscriptionDto { status: string | null; planId?: string | null; planName?: string | null; currentPeriodEnd?: string | null; graceUntil?: string | null; }
  export interface PurchaseDto { id: string; amountCents: number; currency: string; credits: number; stripeInvoiceUrl: string | null; createdAt: string; }
  export function getBillingBalance(networkId: string): Promise<BalanceBreakdown | null>;
  export function getPacks(): Promise<PackDto[]>;
  export function getPlans(): Promise<PlanDto[]>;
  export function getSubscription(networkId: string): Promise<SubscriptionDto | null>;
  export function getPurchases(networkId: string): Promise<PurchaseDto[]>;
  export function startPackCheckout(networkId: string, packId: string): Promise<string | null>; // returns url
  export function startSubscriptionCheckout(networkId: string, planId: string): Promise<string | null>;
  export function openPortal(networkId: string): Promise<string | null>;
  ```
- Produces (`format.ts`): `export function formatMoney(cents: number, currency: string, lang?: string): string;`
- Produces (`aiUser.ts`): `getBalance` returns `BalanceBreakdown | null` (was `number | null`).

- [ ] **Step 1: `formatMoney` test (RED) + impl**

`editor/src/lib/format.test.ts` (créer si absent) :

```ts
import { describe, expect, it } from "vitest";
import { formatMoney } from "./format";
describe("formatMoney", () => {
	it("renders cents in the given currency + locale", () => {
		expect(formatMoney(1000, "eur", "fr").replace(/ /g, " ")).toContain("10,00");
		expect(formatMoney(2500, "usd", "en")).toBe("$25.00");
	});
});
```
Run `cd editor && npm test -- format.test` → FAIL. Then add to `editor/src/lib/format.ts`:
```ts
/** cents → localized currency string. */
export function formatMoney(cents: number, currency: string, lang = "en"): string {
	return new Intl.NumberFormat(lang, { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);
}
```
Run again → PASS.

- [ ] **Step 2: `billing.ts` client**

Follow `editor/src/lib/api/aiUser.ts` for `apiUrl()`. All calls use `credentials: "include"` (cookie-auth), no Bearer:

```ts
const apiUrl = (): string => (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:3001";

async function getJson<T>(path: string): Promise<T | null> {
	const res = await fetch(`${apiUrl()}${path}`, { credentials: "include" });
	if (!res.ok) return null;
	return (await res.json()) as T;
}
async function postForUrl(path: string, body: Record<string, unknown>): Promise<string | null> {
	const res = await fetch(`${apiUrl()}${path}`, {
		method: "POST", credentials: "include",
		headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
	});
	if (!res.ok) return null;
	return ((await res.json()) as { url?: string }).url ?? null;
}

export interface BalanceBreakdown { total: number; subscription: number; rollover: number; topup: number; subscriptionQuota?: number; periodEnd?: string | null; }
// ... (all interfaces from the Interfaces block above) ...

export async function getBillingBalance(networkId: string): Promise<BalanceBreakdown | null> {
	return getJson<BalanceBreakdown>(`/api/v1/billing/balance?networkId=${encodeURIComponent(networkId)}`);
}
export async function getPacks(): Promise<PackDto[]> {
	const r = await getJson<{ packs: PackDto[] }>(`/api/v1/billing/packs`);
	return r?.packs ?? [];
}
export async function getPlans(): Promise<PlanDto[]> {
	const r = await getJson<{ plans: PlanDto[] }>(`/api/v1/billing/plans`);
	return r?.plans ?? [];
}
export async function getSubscription(networkId: string): Promise<SubscriptionDto | null> {
	return getJson<SubscriptionDto>(`/api/v1/billing/subscription?networkId=${encodeURIComponent(networkId)}`);
}
export async function getPurchases(networkId: string): Promise<PurchaseDto[]> {
	const r = await getJson<{ purchases: PurchaseDto[] }>(`/api/v1/billing/purchases?networkId=${encodeURIComponent(networkId)}`);
	return r?.purchases ?? [];
}
export async function startPackCheckout(networkId: string, packId: string): Promise<string | null> {
	return postForUrl(`/api/v1/billing/checkout/pack`, { networkId, packId });
}
export async function startSubscriptionCheckout(networkId: string, planId: string): Promise<string | null> {
	return postForUrl(`/api/v1/billing/checkout/subscription`, { networkId, planId });
}
export async function openPortal(networkId: string): Promise<string | null> {
	return postForUrl(`/api/v1/billing/portal`, { networkId });
}
```

- [ ] **Step 3: `billing.test.ts` (mock fetch)**

`editor/src/lib/api/billing.test.ts` — mock global `fetch`, assert URL + `credentials:"include"`, and the unwrap of `{packs}`/`{plans}`/`{purchases}`/`{url}`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { getPacks, getBillingBalance, startPackCheckout } from "./billing";

const okJson = (body: unknown) => Promise.resolve({ ok: true, json: async () => body } as Response);

afterEach(() => vi.restoreAllMocks());

describe("billing client", () => {
	it("getPacks unwraps { packs }", async () => {
		const f = vi.spyOn(globalThis, "fetch").mockReturnValue(okJson({ packs: [{ id: "p1" }] }) as never);
		expect(await getPacks()).toEqual([{ id: "p1" }]);
		expect(f.mock.calls[0][1]).toMatchObject({ credentials: "include" });
	});
	it("getBillingBalance sends networkId + returns breakdown", async () => {
		const f = vi.spyOn(globalThis, "fetch").mockReturnValue(okJson({ total: 10, subscription: 5, rollover: 0, topup: 5 }) as never);
		const b = await getBillingBalance("net1");
		expect(b?.total).toBe(10);
		expect(String(f.mock.calls[0][0])).toContain("networkId=net1");
	});
	it("startPackCheckout returns the url, null on !ok", async () => {
		vi.spyOn(globalThis, "fetch").mockReturnValue(okJson({ url: "https://stripe/x" }) as never);
		expect(await startPackCheckout("net1", "p1")).toBe("https://stripe/x");
		vi.spyOn(globalThis, "fetch").mockReturnValue(Promise.resolve({ ok: false } as Response) as never);
		expect(await startPackCheckout("net1", "p1")).toBeNull();
	});
});
```

- [ ] **Step 4: `aiUser.getBalance` → breakdown**

In `editor/src/lib/api/aiUser.ts`, change `getBalance` to return the breakdown (import the type from billing to avoid duplication):
```ts
import type { BalanceBreakdown } from "./billing";
export async function getBalance(token: string | null, projectId: string): Promise<BalanceBreakdown | null> {
	const res = await fetch(`${apiUrl()}/api/v1/ai/balance?projectId=${encodeURIComponent(projectId)}`, {
		credentials: "include", headers: authHeaders(token),
	});
	if (!res.ok) return null;
	return (await res.json()) as BalanceBreakdown;
}
```
(The ai/balance response now includes `total/subscription/rollover/topup` + legacy `balance`. `BalanceBreakdown` fields all present; `subscriptionQuota`/`periodEnd` stay undefined here.)

- [ ] **Step 5: Run editor tests (client + format) — expect PASS**

Run: `cd editor && npm test -- billing.test format.test`
Expected: PASS.

> ⚠️ Task 4 (composer) depends on this `getBalance` signature change — it currently sets `balance: number`. That migration is Task 4's job; do NOT edit AssistantChat here. `npm run build` will still fail on AssistantChat's `number` usage until Task 4 — so DEFER the full build check to Task 4. Only run the scoped tests here.

- [ ] **Step 6: Commit**

```bash
git add editor/src/lib/api/billing.ts editor/src/lib/api/billing.test.ts editor/src/lib/format.ts editor/src/lib/format.test.ts editor/src/lib/api/aiUser.ts
git commit -m "feat(editor): billing API client + formatMoney + ai balance breakdown type"
```

---

### Task 3: `CreditIndicator` component + i18n keys

**Files:**
- Create: `editor/src/features/billing/CreditIndicator.tsx`
- Modify: `editor/src/locales/en.ts`, `editor/src/locales/fr.ts`
- Test: `editor/src/features/billing/CreditIndicator.test.tsx`

**Interfaces:**
- Consumes: `BalanceBreakdown` from `@/lib/api/billing`, `formatCredits` from `@/lib/format`, `HBar` from `@/components/ui/h-bar`, `DropdownMenu*` from `@/components/ui/dropdown-menu`.
- Produces:
  ```ts
  export type CreditTone = "ok" | "low" | "critical" | "empty";
  export function creditTone(b: BalanceBreakdown): CreditTone; // exported for unit test
  export function CreditIndicator(props: { balance: BalanceBreakdown | null; onRecharge: () => void; compact?: boolean }): JSX.Element | null;
  ```
- Tone rule (pure, testable): `empty` if `total <= 0`; else if `subscriptionQuota && subscriptionQuota > 0` → `critical` if `subscription/subscriptionQuota < 0.05`, `low` if `< 0.20`, else `ok`; else (no quota) → `ok` (total > 0). Tone drives the dot color via a `data-tone` attribute + a token class.

- [ ] **Step 1: i18n keys (en + fr, parité)**

Add a top-level `billing` group in `editor/src/locales/en.ts` (mirror exactly in `fr.ts`):

```ts
	billing: {
		indicator: {
			total: "{{n}} credits",
			ariaLabel: "Credit balance: {{n}} credits",
			breakdownTitle: "Credit balance",
			subscription: "Subscription",
			rollover: "Rollover",
			topup: "Top-up",
			quotaUsed: "{{used}} / {{quota}} this month",
			renews: "Renews {{date}}",
			recharge: "Add credits",
			low: "Running low",
			empty: "Out of credits",
		},
		page: {
			title: "Credits",
			subtitle: "Buy credit packs or subscribe. Credits are shared across your network.",
			pickNetwork: "Select a network to manage its credits.",
			signedOut: "Sign in to manage credits.",
			balanceHeading: "Your balance",
			packsHeading: "Credit packs",
			plansHeading: "Subscriptions",
			buy: "Buy",
			subscribe: "Subscribe",
			creditsFor: "{{credits}} credits",
			bonus: "+{{pct}}% bonus",
			perMonth: "/mo",
			mySubscription: "My subscription",
			noSubscription: "No active subscription.",
			status: "Status",
			renewsOn: "Renews on {{date}}",
			manage: "Manage subscription",
			history: "Purchase history",
			noPurchases: "No purchases yet.",
			invoice: "Invoice",
			colDate: "Date",
			colAmount: "Amount",
			colCredits: "Credits",
			checkoutSuccess: "Payment received — your credits will appear shortly.",
			checkoutCancel: "Checkout cancelled.",
			checkoutError: "Could not start checkout. Try again.",
		},
	},
```

French mirror (same keys) — e.g. `total: "{{n}} crédits"`, `breakdownTitle: "Solde de crédits"`, `subscription: "Abonnement"`, `rollover: "Report"`, `topup: "Recharge"`, `quotaUsed: "{{used}} / {{quota}} ce mois-ci"`, `renews: "Renouvelle le {{date}}"`, `recharge: "Ajouter des crédits"`, `low: "Bientôt épuisé"`, `empty: "Plus de crédits"`, `page.title: "Crédits"`, `page.subtitle: "Achète des packs ou souscris un abonnement. Les crédits sont partagés dans ton réseau."`, `pickNetwork: "Choisis un réseau pour gérer ses crédits."`, `signedOut: "Connecte-toi pour gérer les crédits."`, `balanceHeading: "Ton solde"`, `packsHeading: "Packs de crédits"`, `plansHeading: "Abonnements"`, `buy: "Acheter"`, `subscribe: "Souscrire"`, `creditsFor: "{{credits}} crédits"`, `bonus: "+{{pct}}% bonus"`, `perMonth: "/mois"`, `mySubscription: "Mon abonnement"`, `noSubscription: "Aucun abonnement actif."`, `status: "Statut"`, `renewsOn: "Renouvelle le {{date}}"`, `manage: "Gérer l'abonnement"`, `history: "Historique d'achats"`, `noPurchases: "Aucun achat pour l'instant."`, `invoice: "Facture"`, `colDate: "Date"`, `colAmount: "Montant"`, `colCredits: "Crédits"`, `checkoutSuccess: "Paiement reçu — tes crédits arrivent sous peu."`, `checkoutCancel: "Paiement annulé."`, `checkoutError: "Impossible de démarrer le paiement. Réessaie."`.

- [ ] **Step 2: Test (RED) — tone + render**

`editor/src/features/billing/CreditIndicator.test.tsx`:

```ts
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { creditTone, CreditIndicator } from "./CreditIndicator";

describe("creditTone", () => {
	it("empty when total <= 0", () => {
		expect(creditTone({ total: 0, subscription: 0, rollover: 0, topup: 0 })).toBe("empty");
	});
	it("critical/low/ok by subscription vs quota", () => {
		expect(creditTone({ total: 100, subscription: 4, rollover: 0, topup: 96, subscriptionQuota: 100 })).toBe("critical");
		expect(creditTone({ total: 100, subscription: 15, rollover: 0, topup: 85, subscriptionQuota: 100 })).toBe("low");
		expect(creditTone({ total: 100, subscription: 80, rollover: 0, topup: 20, subscriptionQuota: 100 })).toBe("ok");
	});
	it("ok when positive and no quota", () => {
		expect(creditTone({ total: 50, subscription: 0, rollover: 0, topup: 50 })).toBe("ok");
	});
});

describe("CreditIndicator", () => {
	it("renders null while loading (balance null)", () => {
		const { container } = render(<CreditIndicator balance={null} onRecharge={() => {}} />);
		expect(container.firstChild).toBeNull();
	});
	it("shows the total (FR locale)", () => {
		render(<CreditIndicator balance={{ total: 1200, subscription: 0, rollover: 0, topup: 1200 }} onRecharge={() => {}} />);
		expect(screen.getByText(/1\s?200 crédits/)).toBeTruthy();
	});
	it("exposes a data-tone attribute for the empty state", () => {
		render(<CreditIndicator balance={{ total: 0, subscription: 0, rollover: 0, topup: 0 }} onRecharge={() => {}} />);
		expect(document.querySelector('[data-tone="empty"]')).toBeTruthy();
	});
});
```

Run `cd editor && npm test -- CreditIndicator` → FAIL (module absent).

- [ ] **Step 3: Implement `CreditIndicator.tsx`**

Trigger = a `DropdownMenu` button (follow `editor/src/components/LinkedServersDropdown.tsx`). Colors via tokens only. Tone → dot color class. Segmented bar via `HBar` when `subscriptionQuota > 0`.

```tsx
import { formatCredits } from "@/lib/format";
import type { BalanceBreakdown } from "@/lib/api/billing";
import {
	DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { HBar } from "@/components/ui/h-bar";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";

export type CreditTone = "ok" | "low" | "critical" | "empty";

export function creditTone(b: BalanceBreakdown): CreditTone {
	if (b.total <= 0) return "empty";
	if (b.subscriptionQuota && b.subscriptionQuota > 0) {
		const ratio = b.subscription / b.subscriptionQuota;
		if (ratio < 0.05) return "critical";
		if (ratio < 0.2) return "low";
	}
	return "ok";
}

// tone → token color for the status dot (semantic tokens only, no hex)
const DOT: Record<CreditTone, string> = {
	ok: "var(--sage)",
	low: "var(--amber)",
	critical: "var(--terra)",
	empty: "var(--brick)",
};

export function CreditIndicator({ balance, onRecharge, compact }: { balance: BalanceBreakdown | null; onRecharge: () => void; compact?: boolean }) {
	const { t, i18n } = useTranslation();
	if (balance === null) return null;
	const tone = creditTone(balance);
	const totalStr = formatCredits(balance.total, i18n.language);
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<button
					type="button"
					data-tone={tone}
					aria-label={t("billing.indicator.ariaLabel", { n: totalStr })}
					className="flex h-[34px] shrink-0 items-center gap-1.5 rounded-[10px] border border-[var(--border)] bg-[var(--surface-raised)] px-3 font-mono text-[12px] text-[var(--text-mut)] hover:border-[var(--border-strong)] hover:text-[var(--text)]"
				>
					<span aria-hidden className="h-2 w-2 rounded-full" style={{ background: DOT[tone] }} />
					<span className="tabular-nums">{t("billing.indicator.total", { n: totalStr })}</span>
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="min-w-[16rem]">
				<DropdownMenuLabel>{t("billing.indicator.breakdownTitle")}</DropdownMenuLabel>
				<DropdownMenuSeparator />
				<div className="flex flex-col gap-2 px-2 py-1.5 text-[12.5px]">
					{balance.subscriptionQuota && balance.subscriptionQuota > 0 ? (
						<HBar
							label={t("billing.indicator.subscription")}
							value={balance.subscription}
							max={balance.subscriptionQuota}
							caption={t("billing.indicator.quotaUsed", {
								used: formatCredits(balance.subscription, i18n.language),
								quota: formatCredits(balance.subscriptionQuota, i18n.language),
							})}
						/>
					) : (
						<Row label={t("billing.indicator.subscription")} value={formatCredits(balance.subscription, i18n.language)} />
					)}
					<Row label={t("billing.indicator.rollover")} value={formatCredits(balance.rollover, i18n.language)} />
					<Row label={t("billing.indicator.topup")} value={formatCredits(balance.topup, i18n.language)} />
					{balance.periodEnd ? (
						<p className="text-[11.5px] text-[var(--text-mut)]">
							{t("billing.indicator.renews", { date: new Date(balance.periodEnd).toLocaleDateString(i18n.language) })}
						</p>
					) : null}
					<Button variant="primary" size="sm" className="mt-1 w-full" onClick={onRecharge}>
						{t("billing.indicator.recharge")}
					</Button>
				</div>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function Row({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex items-center justify-between">
			<span className="text-[var(--text-mut)]">{label}</span>
			<span className="tabular-nums text-[var(--text)]">{value}</span>
		</div>
	);
}
```

> If `HBar`'s prop names differ from `{ label, value, max, caption }` (verify against `editor/src/components/ui/h-bar.tsx`), adapt the call to the real API. If `--sage`/`--amber`/`--terra`/`--brick` are not the exact semantic tokens in `globals.css`, use the closest existing status tokens — do NOT introduce hex.

- [ ] **Step 4: Run — expect PASS + i18n parity**

Run: `cd editor && npm test -- CreditIndicator`
Expected: PASS.
Verify en/fr parity: the `billing` key set must be identical in both files (same nested keys). If the repo has an i18n-parity test, it must stay green: `cd editor && npm test -- i18n`.

- [ ] **Step 5: Commit**

```bash
git add editor/src/features/billing/CreditIndicator.tsx editor/src/features/billing/CreditIndicator.test.tsx editor/src/locales/en.ts editor/src/locales/fr.ts
git commit -m "feat(editor): CreditIndicator component (segmented bar + breakdown popover)"
```

---

### Task 4: Brancher `CreditIndicator` dans le composer assistant

**Files:**
- Modify: `editor/src/features/assistant/AssistantChat.tsx`
- Test: `editor/src/features/assistant/AssistantChat.credits.test.tsx` (adapter)

**Interfaces:**
- Consumes: `CreditIndicator` from `@/features/billing/CreditIndicator`, `getBalance` (now returns `BalanceBreakdown | null`) from `@/lib/api/aiUser`.
- Produces: composer renders `<CreditIndicator balance={balance} onRecharge={() => navigate({ to: "/credits" })} compact />` instead of `<BalanceChip .../>`. `balance` state type becomes `BalanceBreakdown | null`. SSE `credits`/`insufficient_credits` events update `balance.total` (rebuild a breakdown preserving buckets or refetch — see step).

- [ ] **Step 1: Adapt state + fetch**

In `AssistantChat.tsx`:
- Change `const [balance, setBalance] = useState<number | null>(null)` → `useState<BalanceBreakdown | null>(null)` (import `BalanceBreakdown`).
- The mount `getBalance(token, projectId).then(setBalance)` now yields a breakdown — assign directly.
- SSE handlers currently do `setBalance(Number(ev.balance))`. The event only carries the new total. Update to preserve the last-known buckets and overwrite `total` (and proportionally you cannot know per-bucket split, so just set `total`; the popover breakdown may lag until next mount — acceptable). Implement:
  ```ts
  } else if (ev.type === "credits") {
    setBalance((b) => (b ? { ...b, total: Number(ev.balance) } : { total: Number(ev.balance), subscription: 0, rollover: 0, topup: Number(ev.balance) }));
  } else if (ev.type === "insufficient_credits") {
    setOutOfCredits(true);
    setBalance((b) => (b ? { ...b, total: Number(ev.balance) } : { total: Number(ev.balance), subscription: 0, rollover: 0, topup: 0 }));
  }
  ```
- Replace `<BalanceChip balance={balance} />` with:
  ```tsx
  <CreditIndicator balance={balance} onRecharge={() => navigate({ to: "/credits" })} compact />
  ```
  (Confirm `navigate` is already in scope — `AssistantChat` uses it for `OutOfCreditsNotice`. If not, `const navigate = useNavigate();`.)
- Remove the now-unused `BalanceChip` import (leave `BalanceChip.tsx` file in place — it may still be referenced by its own tests; if nothing imports it and its test exists, keep both; if you delete the component, delete its test too. Prefer KEEPING the file to minimize churn).

- [ ] **Step 2: Adapt the existing test**

`AssistantChat.credits.test.tsx` mocks `getBalance` to return `500` (a number). Change the mock to return a breakdown: `getBalance: vi.fn(async () => ({ total: 500, subscription: 0, rollover: 0, topup: 500 }))`. The assertion `getByText(/500 crédits/)` still holds via the indicator's `billing.indicator.total` (`{{n}} crédits`). Update any assertion that referenced BalanceChip-specific copy to the indicator copy. Verify the SSE-update test (`488`) asserts the indicator reflects the new total.

- [ ] **Step 3: Run — expect PASS + full build (typecheck)**

Run: `cd editor && npm test -- AssistantChat`
Expected: PASS.
Run: `cd editor && npm run build`
Expected: SUCCESS (this is the first point the `getBalance` signature change from Task 2 is fully consumed — the build MUST be clean here).

- [ ] **Step 4: Commit**

```bash
git add editor/src/features/assistant/AssistantChat.tsx editor/src/features/assistant/AssistantChat.credits.test.tsx
git commit -m "feat(editor): assistant composer uses CreditIndicator (breakdown + recharge CTA)"
```

---

### Task 5: Page `/credits` réelle

**Files:**
- Modify: `editor/src/routes/credits.tsx` (remplace le placeholder)
- Create: `editor/src/features/billing/CreditsPage.tsx` (le composant, importé par la route)
- Test: `editor/src/features/billing/CreditsPage.test.tsx`

**Interfaces:**
- Consumes: `useAuthStore` (currentUser), `useNetworksStore` (activeId), the `billing.ts` client, `CreditIndicator`, `formatMoney`/`formatCredits`, design-system (`Card*`, `Button`, `Badge`, `Table*`, `EmptyState`), `useSearch`/`useNavigate` (TanStack Router) for the `?checkout=` banner.
- Produces: `export function CreditsPage(): JSX.Element`. The route file wires it: `export const Route = createFileRoute("/credits")({ component: CreditsPage });`.

Behavior:
- Signed out (`!currentUser`) → `EmptyState` with `billing.page.signedOut` + a `Link` to `/login`.
- No active network (`!activeId`) → `EmptyState` with `billing.page.pickNetwork`.
- Else fetch (in one `useEffect` keyed on `activeId`): `getBillingBalance`, `getPacks`, `getPlans`, `getSubscription`, `getPurchases`. Render:
  - Header (`billing.page.title` + subtitle) + `<CreditIndicator balance={balance} onRecharge={scrollToPacks or noop} />` under `balanceHeading`.
  - `?checkout=success|cancel` (via `useSearch`) → a dismissible banner (`checkoutSuccess`/`checkoutCancel`); on success, refetch balance once.
  - Packs grid (`grid gap-3 sm:grid-cols-2 lg:grid-cols-3`): each `Card` shows name, `formatMoney(priceCents,currency)`, `creditsFor {credits}`, `bonus` badge if `bonusPct>0`, `Button variant="primary"` → `startPackCheckout(activeId, id)` then `window.location.assign(url)` (on null → set an error banner `checkoutError`).
  - Plans grid: each `Card` shows name, `formatMoney(priceCents,currency)` + `perMonth`, `creditsFor {creditsPerPeriod}`, features, `Button` → `startSubscriptionCheckout`. If the plan is the active subscription (`subscription.planId === plan.id`), show a `Badge` "actif" instead of the subscribe button.
  - My subscription: if `subscription.status` truthy → status `Badge`, `renewsOn {currentPeriodEnd}`, `Button variant="outline"` `manage` → `openPortal(activeId)` → redirect. Else `noSubscription`.
  - Purchase history: `Table` (colDate/colAmount/colCredits + invoice link when `stripeInvoiceUrl`), or `EmptyState noPurchases`.

- [ ] **Step 1: Test (RED)**

`editor/src/features/billing/CreditsPage.test.tsx` — mock `@/lib/api/billing`, set stores, assert render states. Follow `AssistantChat.credits.test.tsx` conventions (FR assertions, store `setState`). Example:

```ts
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CreditsPage } from "./CreditsPage";
import { useAuthStore } from "@/state/authStore";
import { useNetworksStore } from "@/state/networksStore";

vi.mock("@tanstack/react-router", async (orig) => ({
	...(await orig<typeof import("@tanstack/react-router")>()),
	useSearch: () => ({}),
	useNavigate: () => vi.fn(),
	Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));
vi.mock("@/lib/api/billing", () => ({
	getBillingBalance: vi.fn(async () => ({ total: 500, subscription: 300, rollover: 0, topup: 200, subscriptionQuota: 1000, periodEnd: "2999-01-01T00:00:00Z" })),
	getPacks: vi.fn(async () => [{ id: "pk1", name: "Starter", priceCents: 1000, currency: "eur", credits: 500, bonusPct: 20, creditsGranted: 600 }]),
	getPlans: vi.fn(async () => [{ id: "pl1", name: "Pro", interval: "month", priceCents: 2000, currency: "eur", creditsPerPeriod: 5000, rolloverCap: 1000, features: "" }]),
	getSubscription: vi.fn(async () => ({ status: "active", planId: "pl1", planName: "Pro", currentPeriodEnd: "2999-02-01T00:00:00Z", graceUntil: null })),
	getPurchases: vi.fn(async () => [{ id: "pur1", amountCents: 1000, currency: "eur", credits: 600, stripeInvoiceUrl: null, createdAt: "2026-07-01T00:00:00Z" }]),
	startPackCheckout: vi.fn(async () => "https://stripe/checkout"),
	startSubscriptionCheckout: vi.fn(async () => null),
	openPortal: vi.fn(async () => "https://stripe/portal"),
}));

afterEach(() => {
	vi.clearAllMocks();
	useAuthStore.setState({ currentUser: null } as never);
	useNetworksStore.setState({ activeId: null } as never);
});

function signedIn() {
	useAuthStore.setState({ currentUser: { id: "u1", email: "a@b.c" } } as never);
	useNetworksStore.setState({ activeId: "net1", networks: [{ id: "net1", name: "N", tier: "free" }] } as never);
}

describe("CreditsPage", () => {
	it("prompts sign-in when signed out", () => {
		render(<CreditsPage />);
		expect(screen.getByText(/Connecte-toi/)).toBeTruthy();
	});
	it("prompts network pick when no active network", () => {
		useAuthStore.setState({ currentUser: { id: "u1", email: "a@b.c" } } as never);
		render(<CreditsPage />);
		expect(screen.getByText(/Choisis un réseau/)).toBeTruthy();
	});
	it("renders packs and starts checkout on Buy (redirects to Stripe url)", async () => {
		signedIn();
		const assign = vi.fn();
		Object.defineProperty(window, "location", { value: { assign, href: "" }, writable: true });
		const billing = await import("@/lib/api/billing");
		render(<CreditsPage />);
		await waitFor(() => expect(screen.getByText("Starter")).toBeTruthy());
		await userEvent.click(screen.getByRole("button", { name: /Acheter/ }));
		await waitFor(() => expect(billing.startPackCheckout).toHaveBeenCalledWith("net1", "pk1"));
		await waitFor(() => expect(assign).toHaveBeenCalledWith("https://stripe/checkout"));
	});
	it("shows the active subscription + manage button", async () => {
		signedIn();
		render(<CreditsPage />);
		await waitFor(() => expect(screen.getByText(/Mon abonnement/)).toBeTruthy());
		expect(screen.getByRole("button", { name: /Gérer/ })).toBeTruthy();
	});
});
```

Run `cd editor && npm test -- CreditsPage` → FAIL.

- [ ] **Step 2: Implement `CreditsPage.tsx`**

Write the component per the Behavior spec above, design-system-first, i18n via `billing.page.*`, raw fetch in a single `useEffect` keyed on `activeId`, guards for signed-out / no-network / loading. Checkout handlers:
```ts
async function buyPack(packId: string) {
	const url = await startPackCheckout(activeId, packId);
	if (url) window.location.assign(url); else setBanner("error");
}
```
Use `Card`/`CardHeader`/`CardTitle`/`CardContent`/`CardFooter` for pack/plan cards, `Button` for CTAs, `Badge` for status/bonus, `Table` + `THead/TBody/TR/TH/TD` for history, `EmptyState` for the guard/empty states, `CreditIndicator` for the balance. Money via `formatMoney(priceCents, currency, i18n.language)`, credits via `formatCredits`. Dates via `new Date(iso).toLocaleDateString(i18n.language)`.

- [ ] **Step 3: Wire the route**

`editor/src/routes/credits.tsx`:
```tsx
import { createFileRoute } from "@tanstack/react-router";
import { CreditsPage } from "@/features/billing/CreditsPage";
export const Route = createFileRoute("/credits")({ component: CreditsPage });
```

- [ ] **Step 4: Run — expect PASS + build**

Run: `cd editor && npm test -- CreditsPage`
Expected: PASS.
Run: `cd editor && npm run build`
Expected: SUCCESS (typecheck clean).

- [ ] **Step 5: Commit**

```bash
git add editor/src/routes/credits.tsx editor/src/features/billing/CreditsPage.tsx editor/src/features/billing/CreditsPage.test.tsx
git commit -m "feat(editor): real /credits page (packs, subscription, portal, history)"
```

---

### Task 6: Docs + suite finale

**Files:**
- Create: `docs-site/src/content/docs/editor/credits.md` (user doc EN — achat de credits + abo + gestion)
- Modify: `CHANGELOG.md`, `docs/superpowers/specs/2026-07-02-ai-model-system-design.md` (note `/credits` réalisé)

- [ ] **Step 1: CHANGELOG** — `[Unreleased] ### Added`:
```markdown
- Billing UI (sub-project C): `CreditIndicator` (segmented quota bar + per-bucket breakdown popover + color states) in the assistant composer, and a real `/credits` page (buy credit packs → Stripe Checkout, subscribe to a plan, manage subscription via Customer Portal, purchase history). `GET /api/v1/ai/balance` now returns the per-bucket breakdown. Network context from `useNetworksStore.activeId`.
```

- [ ] **Step 2: ai-model-system-design.md** — retirer la mention « `/credits` = placeholder » / ajouter une note : la route `/credits` est désormais réelle (sous-projet billing C), l'achat de credits est branché sur Stripe Checkout.

- [ ] **Step 3: docs-site user doc** — `docs-site/src/content/docs/editor/credits.md` : titre + frontmatter Starlight (suivre un fichier voisin de `docs-site/src/content/docs/editor/` pour le format), sections « Voir mon solde » (indicateur + popover), « Acheter des credits » (packs), « S'abonner » (formules + Portal), « Historique ». EN.

- [ ] **Step 4: Suites complètes finales**

Run: `cd editor && npm test`
Expected: PASS.
Run: `cd editor && npm run build`
Expected: SUCCESS.
Run: `cd backend && bun run test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add CHANGELOG.md docs/superpowers/specs/2026-07-02-ai-model-system-design.md docs-site/src/content/docs/editor/credits.md
git commit -m "docs: billing credit UI (indicator + /credits page)"
```
