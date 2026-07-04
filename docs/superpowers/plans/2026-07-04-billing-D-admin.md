# Billing — Plan D : Admin (/admin/billing — ventes + CRUD + grant)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Donner au super-admin une page `/admin/billing` pour **suivre les ventes** (CA top-ups + abonnés actifs par formule), **gérer packs & formules** (CRUD — les routes backend existent déjà), et **créditer manuellement** un network (grant bucket `topup`, `reason=adjustment`).

**Architecture:** Backend — ajouter un endpoint de synthèse ventes `GET /api/v1/admin/billing/sales?from&to` (nouveau `salesRepo.ts`) + un endpoint de grant manuel `POST /api/v1/admin/billing/grant` (réutilise `grantCredits`), tous deux dans le `buildBillingAdminRouter` existant (déjà monté, déjà gated `userAuth`+`requireAdmin`). Frontend — une route `admin.billing.tsx` (nichée sous `admin.tsx` → hérite du gating admin + de l'`AdminSidebar`) composée de 4 onglets `Tabs` : **Sales** (dashboard StatCard+HBar+Table, calqué sur `AiUsagePage`), **Packs** / **Plans** (Table + `Sheet` form create/edit, calqué sur `AiModelsPage`/`AiModelForm`, câblé sur les routes CRUD existantes), **Grant** (formulaire networkId+montant+note). Client `adminBilling.ts` suit la convention `mutate<T>()`/`Result<T>` cookie-auth des autres clients admin.

**Tech Stack:** Backend Bun+Hono+Drizzle. Frontend React 19 + Vite + TanStack Router (file-based) + Zustand + react-i18next + Radix `components/ui`. Tests : backend `bun run test`, editor Vitest (locale FR épinglée).

## Global Constraints

- Spec : `docs/superpowers/specs/2026-07-03-billing-subscriptions-topups-design.md` §Admin (D) ligne 115. Facturation **per-network**. Analytics churn/ARPU/MRR = **V1.5** (hors scope).
- **Auth admin** : routes sous `/api/v1/admin/*` déjà gated par `userAuth()` + `requireAdmin()` (403 si `!user.isAdmin`) dans `app.ts`. Côté éditeur, `admin.tsx` (layout) gate sur `useAuthStore.currentUser.isAdmin` (rend un message `admin.forbidden` sinon) ; toute route `admin.*` hérite du gating + de l'`AdminSidebar`. Clients admin = **cookie-auth** (`credentials:"include"`, pas de Bearer).
- **CRUD packs/plans déjà livré (B1)** : `buildBillingAdminRouter` expose `GET/POST/PUT /api/v1/admin/billing/{packs,plans}` + `POST .../:id/deactivate`. D **n'y touche pas** côté routes — il ajoute `sales` + `grant` et construit l'UI par-dessus.
- **`credit_purchases` = top-ups uniquement** aujourd'hui (l'`invoice.paid` d'abo ne crée PAS de ligne purchase). Donc CA top-ups = `SUM(amount_cents)` de `credit_purchases` ; revenu abo = dérivé du **statut** (`network_billing.status='active'` × `plan.price_cents` = MRR courant) + **abonnés actifs par formule**. C'est exactement ce que dit la spec (« depuis `credit_purchases` + statut abo »).
- **Multi-devise** : `credit_purchases.currency` + `plans.currency` existent. V1 : agréger le CA top-up **par devise** (`Record<currency, cents>`) ; la série journalière somme les cents en supposant une devise dominante (documenté). Ne jamais additionner naïvement deux devises dans un même total affiché sans les distinguer.
- **Grant manuel** : `POST /admin/billing/grant` `{ networkId, amount, note? }` → `grantCredits({ networkId, amount, bucket:"topup", reason:"adjustment", note, createdBy: user.id })`. `amount` entier > 0 sinon 400 ; network inexistant → 404.
- **Design-system-first** : réutiliser `StatCard`, `Table/THead/TBody/TR/TH/TD`, `HBar`, `Button`, `Input`, `FormField`, `Badge`, `Sheet(+Header/Title/Body)`, `Tabs(+List/Trigger/Content)`, `EmptyState` de `components/ui`. Convention « card » = `<div className="card">` (pas de `<Card>` React). **Zéro hex/rgba** — `var(--token)`. Argent via un formateur cents→devise (`formatMoney` existe déjà dans `lib/format.ts` depuis plan C : `formatMoney(cents, currency, lang)`), credits via `formatCredits`.
- **i18n en+fr, parité stricte.** Ajouter un groupe `admin.billing.*` sous le groupe `admin` existant (miroir 1-pour-1 en/fr). Label nav = `admin.nav.billing`. **Jamais** de chaîne en dur dans le JSX. Tests assertent le **français** (locale épinglée).
- **Routing** : `admin.billing.tsx` = `createFileRoute("/admin/billing")`, niché sous `admin.tsx` (hérite Outlet+gating+sidebar). Onglets internes via `Tabs` (pas de sous-routes). Nav : ajouter une entrée dans `editor/src/components/AdminSidebar.tsx`.
- Tests : backend `cd backend && bun run test` (JAMAIS `bun test` direct). Editor `cd editor && npm test` + `npm run build` (typecheck) DOIT passer. Commits conventional, trailing `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. Stage explicite — jamais `git add -A` (WIP `backend/src/routes/link.ts`, `.agents/`, `AGENTS.md`).

## Contrats existants réutilisés

- Backend : `grantCredits({networkId, amount, bucket?, reason?, note?, createdBy?})` (`ai/creditsRepo`) ; `listPacks/listPlans` (`packsRepo`/`plansRepo`) ; tables `creditPurchases`, `networkBilling`, `subscriptionPlans`, `networks`. `buildBillingAdminRouter` (`billing/adminRoutes.ts`) — y ajouter les 2 routes.
- Frontend : `mutate<T>()`/`Result<T>` pattern (voir `lib/api/adminModels.ts`) ; `getUsageSummary` shape (voir `lib/api/adminAiUsage.ts`) ; `AiUsagePage.tsx` (dashboard template) ; `AiModelsPage.tsx` + `AiModelForm.tsx` (CRUD template) ; `AdminSidebar.tsx` (nav) ; `StatCard`, `HBar`, `Tabs`, `Sheet`.

---

### Task 1: Backend — endpoints `sales` + `grant`

**Files:**
- Create: `backend/src/modules/billing/salesRepo.ts`
- Modify: `backend/src/modules/billing/adminRoutes.ts`
- Test: `backend/src/modules/billing/sales.test.ts`
- Modify: `docs/architecture/rest-endpoints.md`

**Interfaces:**
- Produces (`salesRepo.ts`):
  ```ts
  export interface SalesSummary {
    from: string; to: string;
    topups: { count: number; byCurrency: Record<string, number> };          // amount_cents summed per currency
    subscriptions: {
      activeCount: number;
      mrrByCurrency: Record<string, number>;                                 // active subs × plan.price_cents per currency
      perPlan: Array<{ planId: string; planName: string; currency: string; priceCents: number; activeCount: number }>;
    };
    daily: Array<{ date: string; topupCents: number; topupCount: number }>;  // top-up revenue per day (cents; single-currency assumption)
  }
  export function salesSummary(from: Date, to: Date): Promise<SalesSummary>;
  ```
- Produces (routes): `GET /api/v1/admin/billing/sales?from&to` → `SalesSummary` (400 `invalid_range` si dates NaN ; défaut : `to`=now, `from`=to-30j). `POST /api/v1/admin/billing/grant` `{networkId, amount, note?}` → `{ ok:true, balance }` (400 `invalid_amount` si non-entier ≤0 ; 404 `network_not_found`).

- [ ] **Step 1: `salesRepo.ts`**

```ts
import { and, gte, lt, eq, sql } from "drizzle-orm";
import { db } from "../../db/index";
import { creditPurchases, networkBilling, subscriptionPlans } from "../../db/schema";

export interface SalesSummary {
	from: string; to: string;
	topups: { count: number; byCurrency: Record<string, number> };
	subscriptions: {
		activeCount: number;
		mrrByCurrency: Record<string, number>;
		perPlan: Array<{ planId: string; planName: string; currency: string; priceCents: number; activeCount: number }>;
	};
	daily: Array<{ date: string; topupCents: number; topupCount: number }>;
}

export async function salesSummary(from: Date, to: Date): Promise<SalesSummary> {
	// Top-ups in [from, to): summed per currency + count.
	const topupRows = await db
		.select({
			currency: creditPurchases.currency,
			cents: sql<number>`coalesce(sum(${creditPurchases.amountCents}), 0)::int`,
			count: sql<number>`count(*)::int`,
		})
		.from(creditPurchases)
		.where(and(gte(creditPurchases.createdAt, from), lt(creditPurchases.createdAt, to)))
		.groupBy(creditPurchases.currency);
	const byCurrency: Record<string, number> = {};
	let topupCount = 0;
	for (const r of topupRows) { byCurrency[r.currency] = r.cents; topupCount += r.count; }

	// Daily top-up revenue series (cents; single-currency assumption for the chart).
	const dailyRows = await db
		.select({
			date: sql<string>`to_char(${creditPurchases.createdAt}, 'YYYY-MM-DD')`,
			cents: sql<number>`coalesce(sum(${creditPurchases.amountCents}), 0)::int`,
			count: sql<number>`count(*)::int`,
		})
		.from(creditPurchases)
		.where(and(gte(creditPurchases.createdAt, from), lt(creditPurchases.createdAt, to)))
		.groupBy(sql`to_char(${creditPurchases.createdAt}, 'YYYY-MM-DD')`)
		.orderBy(sql`to_char(${creditPurchases.createdAt}, 'YYYY-MM-DD')`);

	// Active subscribers per plan (status snapshot — not period-scoped, per spec).
	const planRows = await db
		.select({
			planId: subscriptionPlans.id,
			planName: subscriptionPlans.name,
			currency: subscriptionPlans.currency,
			priceCents: subscriptionPlans.priceCents,
			activeCount: sql<number>`count(${networkBilling.networkId})::int`,
		})
		.from(networkBilling)
		.innerJoin(subscriptionPlans, eq(networkBilling.planId, subscriptionPlans.id))
		.where(eq(networkBilling.status, "active"))
		.groupBy(subscriptionPlans.id, subscriptionPlans.name, subscriptionPlans.currency, subscriptionPlans.priceCents);

	const perPlan = planRows.map((p) => ({ planId: p.planId, planName: p.planName, currency: p.currency, priceCents: p.priceCents, activeCount: p.activeCount }));
	const mrrByCurrency: Record<string, number> = {};
	let activeCount = 0;
	for (const p of perPlan) {
		mrrByCurrency[p.currency] = (mrrByCurrency[p.currency] ?? 0) + p.priceCents * p.activeCount;
		activeCount += p.activeCount;
	}

	return {
		from: from.toISOString(), to: to.toISOString(),
		topups: { count: topupCount, byCurrency },
		subscriptions: { activeCount, mrrByCurrency, perPlan },
		daily: dailyRows.map((d) => ({ date: d.date, topupCents: d.cents, topupCount: d.count })),
	};
}
```

- [ ] **Step 2: Test (RED)**

`backend/src/modules/billing/sales.test.ts` — seed a network + an active plan + a `network_billing` active row + a couple `credit_purchases`, then assert the summary. Mirror the seed helpers used by other billing tests (`createNetwork`, direct `db.insert`). Example core:

```ts
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../../db/index";
import { creditPurchases, networkBilling, networks, subscriptionPlans } from "../../db/schema";
import { createNetwork } from "../../lib/networkManager";
import { salesSummary } from "./salesRepo";

let networkId = ""; const planId = crypto.randomUUID();
beforeAll(async () => {
	networkId = (await createNetwork("sales-net")).id;
	const now = new Date();
	await db.insert(subscriptionPlans).values({ id: planId, name: "Pro", interval: "month", priceCents: 2000, currency: "eur", creditsPerPeriod: 5000, rolloverCap: 1000, features: "", isActive: true, sortOrder: 0, stripeProductId: "p", stripePriceId: "pr", createdAt: now, updatedAt: now });
	await db.insert(networkBilling).values({ networkId, planId, status: "active", stripeCustomerId: "c", stripeSubscriptionId: "s", createdAt: now, updatedAt: now });
	await db.insert(creditPurchases).values([
		{ id: crypto.randomUUID(), networkId, packId: null, stripeSessionId: "cs_a", amountCents: 1000, currency: "eur", credits: 600, createdAt: new Date("2026-07-02T10:00:00Z") },
		{ id: crypto.randomUUID(), networkId, packId: null, stripeSessionId: "cs_b", amountCents: 2500, currency: "eur", credits: 1500, createdAt: new Date("2026-07-03T10:00:00Z") },
	]);
});
afterAll(async () => {
	await db.delete(creditPurchases).where(eq(creditPurchases.networkId, networkId));
	await db.delete(networkBilling).where(eq(networkBilling.networkId, networkId));
	await db.delete(subscriptionPlans).where(eq(subscriptionPlans.id, planId));
	await db.delete(networks).where(eq(networks.id, networkId));
});

describe("salesSummary", () => {
	it("aggregates top-up revenue per currency + active subscribers per plan", async () => {
		const s = await salesSummary(new Date("2026-07-01T00:00:00Z"), new Date("2026-07-04T00:00:00Z"));
		expect(s.topups.count).toBe(2);
		expect(s.topups.byCurrency.eur).toBe(3500);
		expect(s.subscriptions.activeCount).toBe(1);
		expect(s.subscriptions.mrrByCurrency.eur).toBe(2000);
		expect(s.subscriptions.perPlan.find((p) => p.planId === planId)?.activeCount).toBe(1);
		expect(s.daily.length).toBe(2);
	});
	it("excludes purchases outside the window", async () => {
		const s = await salesSummary(new Date("2026-07-03T00:00:00Z"), new Date("2026-07-04T00:00:00Z"));
		expect(s.topups.count).toBe(1);
		expect(s.topups.byCurrency.eur).toBe(2500);
	});
});
```

Run `cd backend && bun run test src/modules/billing/sales.test.ts` → FAIL (module absent).

- [ ] **Step 3: Implement `salesRepo.ts`** (Step 1 code) → run test → PASS.

- [ ] **Step 4: Wire the routes in `adminRoutes.ts`**

Add imports (`salesSummary` from `./salesRepo`; `grantCredits` from `../ai/creditsRepo`; `db`, `networks`, `eq` if not present) and, inside `buildBillingAdminRouter`, before `return r;`:

```ts
	r.get("/billing/sales", async (c) => {
		const to = c.req.query("to") ? new Date(c.req.query("to") as string) : new Date();
		const from = c.req.query("from") ? new Date(c.req.query("from") as string) : new Date(to.getTime() - 30 * 24 * 3_600_000);
		if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return c.json({ error: "invalid_range" }, 400);
		return c.json(await salesSummary(from, to));
	});

	r.post("/billing/grant", async (c) => {
		const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
		const networkId = typeof body.networkId === "string" ? body.networkId : "";
		const amount = body.amount;
		if (typeof amount !== "number" || !Number.isInteger(amount) || amount <= 0) return c.json({ error: "invalid_amount" }, 400);
		const net = await db.select({ id: networks.id }).from(networks).where(eq(networks.id, networkId));
		if (net.length === 0) return c.json({ error: "network_not_found" }, 404);
		const { balance } = await grantCredits({
			networkId, amount, bucket: "topup", reason: "adjustment",
			note: typeof body.note === "string" ? body.note : undefined,
			createdBy: c.get("user")?.id ?? null,
		});
		return c.json({ ok: true, balance });
	});
```

- [ ] **Step 5: Route tests (add to sales.test.ts or an adminRoutes test)**

Add HTTP-level tests hitting the app router as an admin (follow the auth/request helper used by the existing billing admin tests — grep `admin/billing/packs` in `backend/src/modules/billing/*.test.ts` for the admin-session pattern). Assert: `GET /admin/billing/sales` returns the summary; `POST /admin/billing/grant` with a valid `{networkId, amount}` returns `{ok:true}` and the ledger gained a `topup`/`adjustment` entry; invalid amount → 400; unknown network → 404.

Run `cd backend && bun run test src/modules/billing` → PASS.

- [ ] **Step 6: rest-endpoints.md** — on the `modules/billing/adminRoutes.ts` line, append `GET /admin/billing/sales` (synthèse ventes : CA top-up par devise + abonnés actifs/formule + série journalière) and `POST /admin/billing/grant` (grant manuel bucket topup / reason adjustment).

- [ ] **Step 7: Full backend suite + commit**

Run `cd backend && bun run test` → PASS.
```bash
git add backend/src/modules/billing/salesRepo.ts backend/src/modules/billing/adminRoutes.ts backend/src/modules/billing/sales.test.ts docs/architecture/rest-endpoints.md
git commit -m "feat(backend): billing admin sales summary + manual grant endpoints"
```

---

### Task 2: Editor — client `adminBilling.ts`

**Files:**
- Create: `editor/src/lib/api/adminBilling.ts`
- Test: `editor/src/lib/api/adminBilling.test.ts`

**Interfaces:**
- Consumes: the admin billing routes (CRUD already live; sales+grant from Task 1). Cookie-auth.
- Produces (mirror `adminModels.ts` `Result<T>`/`mutate` convention — duplicate `apiUrl`/`mutate` locally, consistent with the other admin clients):
  ```ts
  export type Result<T> = { ok: true; data: T } | { ok: false; status: number; error?: string };
  export interface AdminPack { id: string; name: string; priceCents: number; currency: string; credits: number; bonusPct: number; isActive: boolean; sortOrder: number; stripeProductId: string | null; stripePriceId: string | null; createdAt: string; updatedAt: string; }
  export interface AdminPlan { id: string; name: string; interval: "month" | "year"; priceCents: number; currency: string; creditsPerPeriod: number; rolloverCap: number; features: string; isActive: boolean; sortOrder: number; stripeProductId: string | null; stripePriceId: string | null; createdAt: string; updatedAt: string; }
  export interface PackInput { name: string; priceCents: number; currency?: string; credits: number; bonusPct?: number; isActive?: boolean; sortOrder?: number; }
  export interface PlanInput { name: string; interval: "month" | "year"; priceCents: number; currency?: string; creditsPerPeriod: number; rolloverCap?: number; features?: string; isActive?: boolean; sortOrder?: number; }
  export interface SalesSummary { from: string; to: string; topups: { count: number; byCurrency: Record<string, number> }; subscriptions: { activeCount: number; mrrByCurrency: Record<string, number>; perPlan: Array<{ planId: string; planName: string; currency: string; priceCents: number; activeCount: number }> }; daily: Array<{ date: string; topupCents: number; topupCount: number }>; }

  export function listPacks(): Promise<AdminPack[] | null>;
  export function createPack(input: PackInput): Promise<Result<AdminPack>>;
  export function updatePack(id: string, patch: Partial<PackInput>): Promise<Result<AdminPack>>;
  export function deactivatePack(id: string): Promise<Result<AdminPack>>;
  export function listPlans(): Promise<AdminPlan[] | null>;
  export function createPlan(input: PlanInput): Promise<Result<AdminPlan>>;
  export function updatePlan(id: string, patch: Partial<PlanInput>): Promise<Result<AdminPlan>>;
  export function deactivatePlan(id: string): Promise<Result<AdminPlan>>;
  export function getSales(from?: string, to?: string): Promise<SalesSummary | null>;
  export function grantCredits(networkId: string, amount: number, note?: string): Promise<Result<{ ok: true; balance: number }>>;
  ```

- [ ] **Step 1: Implement** following `editor/src/lib/api/adminModels.ts` verbatim in style: local `apiUrl()`, `mutate<T>(path, method, body?)`, GET helpers returning the unwrapped array (`listPacks` unwraps `{packs}`), `getSales` builds `?from&to` via a small `qs()` and returns `null` on `!ok`. `deactivatePack/Plan` POST to `.../:id/deactivate`. `grantCredits` POSTs `/api/v1/admin/billing/grant`.

- [ ] **Step 2: Test (mock fetch)** — `adminBilling.test.ts`, mirror `adminModels.test.ts`: assert URLs, `credentials:"include"`, `{packs}`/`{plans}` unwrap, `Result` ok/err discrimination, `getSales` query string. RED first if you add a placeholder, else write test then impl.

Run `cd editor && npm test -- adminBilling.test` → PASS.

- [ ] **Step 3: Commit**
```bash
git add editor/src/lib/api/adminBilling.ts editor/src/lib/api/adminBilling.test.ts
git commit -m "feat(editor): adminBilling client (packs/plans CRUD + sales + grant)"
```

---

### Task 3: Editor — page `/admin/billing` shell + Packs/Plans management

**Files:**
- Create: `editor/src/routes/admin.billing.tsx`
- Create: `editor/src/features/admin/billing/BillingPage.tsx` (Tabs shell)
- Create: `editor/src/features/admin/billing/BillingPacksTab.tsx`
- Create: `editor/src/features/admin/billing/BillingPlansTab.tsx`
- Create: `editor/src/features/admin/billing/PackForm.tsx`, `PlanForm.tsx`
- Modify: `editor/src/components/AdminSidebar.tsx` (nav entry)
- Modify: `editor/src/locales/en.ts`, `editor/src/locales/fr.ts` (`admin.nav.billing` + `admin.billing.*`)
- Test: `editor/src/features/admin/billing/BillingPacksTab.test.tsx`

**Interfaces:**
- Consumes: `adminBilling.ts` (Task 2), `formatMoney`/`formatCredits`, design-system (`Tabs*`, `Table*`, `Button`, `Badge`, `Sheet*`, `FormField`, `Input`, `EmptyState`).
- Produces: route `/admin/billing` rendering `<BillingPage/>` with a `Tabs` (values `sales`/`packs`/`plans`/`grant`; **this task wires `packs` + `plans`; Task 4 adds `sales` + `grant`**). `BillingPacksTab`/`BillingPlansTab` = list (Table) + create/edit `Sheet` form + activate/deactivate, mirroring `AiModelsPage`/`AiModelForm`.

- [ ] **Step 1: i18n keys** — add `admin.nav.billing` (en `"Billing"`, fr `"Facturation"`) and an `admin.billing` group in BOTH locale files (strict parity):
```ts
    billing: {
      title: "Billing",             // fr: "Facturation"
      tabs: { sales: "Sales", packs: "Credit packs", plans: "Subscriptions", grant: "Manual grant" },
      packs: {
        title: "Credit packs", new: "New pack", edit: "Edit pack", empty: "No packs yet.",
        columns: { name: "Name", price: "Price", credits: "Credits", bonus: "Bonus", status: "Status" },
        form: { name: "Name", priceCents: "Price (cents)", currency: "Currency", credits: "Credits", bonusPct: "Bonus %", sortOrder: "Sort order", active: "Active" },
        save: "Save", cancel: "Cancel", activate: "Activate", deactivate: "Deactivate",
        saved: "Pack saved.", saveFail: "Could not save the pack.",
      },
      plans: {
        title: "Subscriptions", new: "New plan", edit: "Edit plan", empty: "No plans yet.",
        columns: { name: "Name", price: "Price", credits: "Credits / period", interval: "Interval", status: "Status" },
        form: { name: "Name", priceCents: "Price (cents)", currency: "Currency", interval: "Interval", creditsPerPeriod: "Credits per period", rolloverCap: "Rollover cap", features: "Features", sortOrder: "Sort order", active: "Active" },
        save: "Save", cancel: "Cancel", activate: "Activate", deactivate: "Deactivate",
        saved: "Plan saved.", saveFail: "Could not save the plan.",
      },
      statusActive: "Active",       // fr: "Actif"
      statusInactive: "Inactive",   // fr: "Inactif"
    },
```
French mirror: `title:"Facturation"`, `tabs:{sales:"Ventes",packs:"Packs de crédits",plans:"Abonnements",grant:"Grant manuel"}`, packs/plans labels translated (e.g. `new:"Nouveau pack"`, `deactivate:"Désactiver"`, `saved:"Pack enregistré."`, etc.), `statusActive:"Actif"`, `statusInactive:"Inactif"`. Keep the SAME key structure. If the repo has an i18n-parity test, it must stay green.

- [ ] **Step 2: Nav entry** — in `editor/src/components/AdminSidebar.tsx`, add to `entries`: `{ to: "/admin/billing", label: t("admin.nav.billing"), Icon: CreditCard }` (import `CreditCard` from `lucide-react`).

- [ ] **Step 3: Route + shell** — `admin.billing.tsx`:
```tsx
import { createFileRoute } from "@tanstack/react-router";
import { BillingPage } from "@/features/admin/billing/BillingPage";
export const Route = createFileRoute("/admin/billing")({ component: BillingPage });
```
`BillingPage.tsx` — a `Tabs` with a title header and 4 `TabsTrigger`s; this task renders `<TabsContent value="packs"><BillingPacksTab/></TabsContent>` and `plans`; leave placeholders (or omit the triggers) for `sales`/`grant` that Task 4 fills. Use `t("admin.billing.tabs.*")`.

- [ ] **Step 4: `BillingPacksTab` (mirror `AiModelsPage`)** — `useState<AdminPack[]|null>(null)`, load via `listPacks()` in `useEffect`, render a `Table` (name / `formatMoney(priceCents,currency)` / `formatCredits(credits)` / bonus% / status `Badge`), a per-row Edit (`ghost` button → sets `editing`) + Activate/Deactivate button (`deactivatePack(id)` or `updatePack(id,{isActive:true})`), a "New pack" button (sets `editing="new"`). Render `<PackForm open model={editing==="new"?null:editing} onClose onSaved={reload}/>` when `editing!==null`. Empty → `EmptyState`.

- [ ] **Step 5: `PackForm` (mirror `AiModelForm`)** — `Sheet` with controlled `useState` per field (name, priceCents, currency, credits, bonusPct, sortOrder, active), submit calls `createPack`/`updatePack`; on `ok` → toast success + `onSaved()` + `onClose()`; on error surface `admin.billing.packs.saveFail`. Use `FormField`+`Input`. (`toast` util is used by `AiModelForm` — reuse the same import.)

- [ ] **Step 6: `BillingPlansTab` + `PlanForm`** — same as Steps 4-5 for plans (add `interval` select month/year, `creditsPerPeriod`, `rolloverCap`, `features`). `createPlan`/`updatePlan`/`deactivatePlan`.

- [ ] **Step 7: Test** — `BillingPacksTab.test.tsx`: mock `@/lib/api/adminBilling`, render the tab, assert a pack row renders (FR copy + `formatMoney`), clicking "Nouveau pack" opens the form, submitting calls `createPack`. Follow `AiModelsPage.test.tsx`/`admin.ai.routing.test.tsx` conventions (mock client, FR assertions).

Run `cd editor && npm test -- BillingPacksTab` → PASS. Run `cd editor && npm run build` → SUCCESS.

- [ ] **Step 8: Commit**
```bash
git add editor/src/routes/admin.billing.tsx editor/src/features/admin/billing/ editor/src/components/AdminSidebar.tsx editor/src/locales/en.ts editor/src/locales/fr.ts
git commit -m "feat(editor): /admin/billing shell + packs/plans management"
```

---

### Task 4: Editor — Sales dashboard tab + Manual grant tab

**Files:**
- Create: `editor/src/features/admin/billing/BillingSalesTab.tsx`
- Create: `editor/src/features/admin/billing/BillingGrantTab.tsx`
- Modify: `editor/src/features/admin/billing/BillingPage.tsx` (wire the two new `TabsContent`)
- Modify: `editor/src/locales/en.ts`, `editor/src/locales/fr.ts` (`admin.billing.sales.*`, `admin.billing.grant.*`)
- Test: `editor/src/features/admin/billing/BillingSalesTab.test.tsx`, `BillingGrantTab.test.tsx`

**Interfaces:**
- Consumes: `adminBilling.getSales`/`grantCredits`, `formatMoney`/`formatCredits`, `StatCard`, `HBar`, `Table*`, `Button`, `Input`, `FormField`, `EmptyState`.
- Produces: `BillingSalesTab` (dashboard, mirror `AiUsagePage`) + `BillingGrantTab` (grant form), wired into `BillingPage`'s Tabs.

- [ ] **Step 1: i18n** — add under `admin.billing` (en+fr parity):
```ts
      sales: {
        title: "Sales", subtitle: "Top-up revenue and active subscriptions.",
        range: { "7d": "7 days", "30d": "30 days", custom: "Custom", from: "From", to: "To" },
        stat: { topupRevenue: "Top-up revenue", topupCount: "Top-ups", activeSubs: "Active subscriptions", mrr: "MRR" },
        perPlan: "Active subscribers per plan", daily: "Daily top-up revenue", noData: "No sales in this range.",
        colPlan: "Plan", colSubs: "Subscribers", colMrr: "MRR",
      },
      grant: {
        title: "Manual credit grant", subtitle: "Add top-up credits to a network (recorded as an adjustment).",
        networkId: "Network ID", amount: "Amount (credits)", note: "Note (reason)",
        submit: "Grant credits", ok: "Granted. New balance: {{balance}}", fail: "Grant failed.",
        invalidAmount: "Enter a positive whole number.", networkNotFound: "Network not found.",
      },
```
French mirror (e.g. `sales.title:"Ventes"`, `stat.topupRevenue:"CA top-ups"`, `stat.mrr:"MRR"`, `grant.title:"Grant manuel de crédits"`, `grant.submit:"Créditer"`, `grant.ok:"Crédité. Nouveau solde : {{balance}}"`, etc.). Multi-currency note: render revenue/MRR by iterating the `byCurrency`/`mrrByCurrency` maps (one line per currency via `formatMoney(cents, currency, lang)`), never summing across currencies.

- [ ] **Step 2: `BillingSalesTab` (mirror `AiUsagePage`)** — date-range state (`"7d"|"30d"|"custom"` + from/to, same `selectPeriod`/custom-date handlers), `getSales(from,to)` in `useEffect`, render: a `StatCard` grid (top-up revenue per currency — join `Object.entries(byCurrency).map(formatMoney)`; top-up count; active subs; MRR per currency), a `card` with `HBar` per plan (`perPlan`, value=`activeCount`, caption=`formatMoney(priceCents*activeCount)`), a `card` with `HBar` per day (`daily`, value=`topupCents`), `EmptyState` when everything is zero.

- [ ] **Step 3: `BillingGrantTab`** — a small `card` form: `FormField` `Input` for networkId (text), amount (number), note (text). Submit → `grantCredits(networkId, amount, note)`; on `ok` → success message `grant.ok {balance}`; on `{ok:false,error}` map `invalid_amount`→`grant.invalidAmount`, `network_not_found`→`grant.networkNotFound`, else `grant.fail`. Clear the form on success.

- [ ] **Step 4: Wire into `BillingPage`** — add `<TabsContent value="sales"><BillingSalesTab/></TabsContent>` and `value="grant"><BillingGrantTab/>`. Default tab = `sales`.

- [ ] **Step 5: Tests** — `BillingSalesTab.test.tsx` (mock `getSales` → a summary, assert stat cards render FR copy + `formatMoney` output; assert per-plan row) and `BillingGrantTab.test.tsx` (mock `grantCredits` ok → success message; mock `{ok:false,error:"network_not_found"}` → the mapped FR error). FR assertions.

Run `cd editor && npm test -- BillingSalesTab BillingGrantTab` → PASS. Run `cd editor && npm run build` → SUCCESS.

- [ ] **Step 6: Commit**
```bash
git add editor/src/features/admin/billing/BillingSalesTab.tsx editor/src/features/admin/billing/BillingGrantTab.tsx editor/src/features/admin/billing/BillingPage.tsx editor/src/locales/en.ts editor/src/locales/fr.ts editor/src/features/admin/billing/BillingSalesTab.test.tsx editor/src/features/admin/billing/BillingGrantTab.test.tsx
git commit -m "feat(editor): /admin/billing sales dashboard + manual grant"
```

---

### Task 5: Docs + suites finales

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `docs-site/src/content/docs/getting-started/install-admin.md` (mention `/admin/billing`)
- Modify: `docs/superpowers/specs/2026-07-03-billing-subscriptions-topups-design.md` (marquer D livré)

- [ ] **Step 1: CHANGELOG** — `[Unreleased] ### Added`:
```markdown
- Billing admin (sub-project D): `/admin/billing` page — sales dashboard (top-up revenue per currency, active subscribers per plan, daily series), credit-pack & subscription-plan management (CRUD + activate/deactivate), and manual per-network credit grants (`topup`/`adjustment`). New endpoints `GET /api/v1/admin/billing/sales` + `POST /api/v1/admin/billing/grant`.
```

- [ ] **Step 2: install-admin.md** — add a short "Billing administration" note pointing super-admins to `/admin/billing` for packs/plans, sales, and manual grants (follow the doc's existing section style).

- [ ] **Step 3: spec** — in the billing design spec §D, add a "LIVRÉ 2026-07-04" note (like the other sub-projects if they're annotated), or a one-line status at the top.

- [ ] **Step 4: Final suites**
Run `cd backend && bun run test` → PASS.
Run `cd editor && npm test` → PASS (note any pre-existing flaky `AiModelForm` — verify in isolation).
Run `cd editor && npm run build` → SUCCESS.

- [ ] **Step 5: Commit**
```bash
git add CHANGELOG.md docs-site/src/content/docs/getting-started/install-admin.md docs/superpowers/specs/2026-07-03-billing-subscriptions-topups-design.md
git commit -m "docs: billing admin (/admin/billing sales + grant + management)"
```
