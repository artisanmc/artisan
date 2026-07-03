# Billing — Plan A : Moteur de buckets de credits

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformer le ledger de credits plat par network en 3 buckets typés (`subscription` / `rollover` / `topup`) avec expiration, ordre de débit §4.1 (abo → rollover → top-up), et logique de renouvellement/rollover — sans aucune dépendance Stripe.

**Architecture:** Extension append-only de la table `ai_credit_ledger` (colonnes `bucket`, `expires_at`, `period_id`). Le solde d'un bucket = `SUM(delta)` des entrées de ce bucket non expirées. Le débit marche les buckets dans l'ordre et écrit une entrée négative par bucket ponctionné. Le renouvellement écrit un lot d'entrées (bascule rollover plafonné + nouveau lot subscription). Tout vit dans `backend/src/modules/ai/`.

**Tech Stack:** Bun + Hono + Drizzle (PostgreSQL). Tests `bun:test` via `bun run test` (JAMAIS `bun test` direct — wrapper `scripts/test.ts` redirige vers `artisan_test`).

## Global Constraints

- Spec : `docs/superpowers/specs/2026-07-03-billing-subscriptions-topups-design.md`.
- Buckets : `subscription | rollover | topup`. Ordre de débit **subscription → rollover → topup** (§4.1).
- Solde d'un bucket = `SUM(delta)` filtré sur ce bucket avec `expires_at IS NULL OR expires_at > now()`. Aucune ligne n'est jamais supprimée (append-only).
- Les entrées legacy (grants admin déjà en base) = bucket `topup`, `expires_at` null.
- Migration Drizzle générée (`bun run db:generate`) et **committée** avec le changement de `schema.ts`.
- Aucun débit sur erreur provider (invariant déjà en place, ne pas régresser).
- Lancer la suite : `cd backend && bun run test` (Docker PostgreSQL requis — déjà up).
- Commits conventional (`feat:`, `test:`, `docs:`).

---

### Task 1: Schéma — colonnes buckets + migration + backfill

**Files:**
- Modify: `backend/src/db/schema.ts` (table `aiCreditLedger`)
- Create: `backend/drizzle/00NN_*.sql` (généré + un backfill ajouté à la main)
- Modify: `docs/architecture/entities.md` (note buckets)

**Interfaces:**
- Produces: colonnes `aiCreditLedger.bucket` (text notNull default `"topup"`), `.expiresAt` (timestamp nullable), `.periodId` (text nullable) — consommées par toutes les tasks suivantes.

- [ ] **Step 1: Ajouter les colonnes au schéma**

Dans `backend/src/db/schema.ts`, table `aiCreditLedger`, ajouter après `reason` :

```ts
		// Credit bucket (billing). "subscription" = monthly quota (expires),
		// "rollover" = carried-over subscription credits (capped), "topup" =
		// permanent purchased/granted credits. Debit order: subscription →
		// rollover → topup (spec 2026-07-03 §4.1). Legacy grants default to topup.
		bucket: text("bucket").notNull().default("topup"),
		// Validity end for the entry (subscription bucket = period end). A bucket's
		// balance excludes entries with expires_at <= now(). null = never expires.
		expiresAt: timestamp("expires_at"),
		// Links an entry to a subscription billing period (renewal / rollover).
		periodId: text("period_id"),
```

- [ ] **Step 2: Générer la migration**

Run: `cd backend && bun run db:generate`
Expected: nouveau fichier `backend/drizzle/00NN_<name>.sql` avec `ALTER TABLE "ai_credit_ledger" ADD COLUMN "bucket" ... DEFAULT 'topup'`, `ADD COLUMN "expires_at"`, `ADD COLUMN "period_id"`.

- [ ] **Step 3: Ajouter le backfill au fichier de migration**

À la fin du fichier `backend/drizzle/00NN_<name>.sql` généré, ajouter (les lignes existantes ont déjà `topup` via le default, mais on l'inscrit explicitement pour la clarté et l'idempotence) :

```sql
--> statement-breakpoint
UPDATE "ai_credit_ledger" SET "bucket" = 'topup' WHERE "bucket" IS NULL OR "bucket" = '';
```

- [ ] **Step 4: Appliquer + suite verte**

Run: `cd backend && bun run test`
Expected: PASS (schéma additif ; le wrapper migre `artisan_test`). Les tests existants de `creditsRepo` / `usageRepo` passent encore.

- [ ] **Step 5: Documenter dans entities.md**

Dans `docs/architecture/entities.md`, section AI models & credits, ajouter :

```markdown
- **Buckets de credits (2026-07-03)** — `ai_credit_ledger` porte `bucket` (`subscription`/`rollover`/`topup`), `expires_at` (bucket subscription expire en fin de période), `period_id`. Solde d'un bucket = `SUM(delta)` non expiré. Débit dans l'ordre subscription → rollover → topup. Spec `2026-07-03-billing-subscriptions-topups-design.md`.
```

- [ ] **Step 6: Commit**

```bash
git add backend/src/db/schema.ts backend/drizzle/ docs/architecture/entities.md
git commit -m "feat(backend): credit ledger buckets (bucket/expires_at/period_id)"
```

---

### Task 2: Soldes par bucket + grants typés (`creditsRepo`)

**Files:**
- Modify: `backend/src/modules/ai/creditsRepo.ts`
- Test: `backend/src/modules/ai/creditsRepo.test.ts` (étendre)

**Interfaces:**
- Consumes: colonnes Task 1.
- Produces:
  - `type BucketType = "subscription" | "rollover" | "topup"` ; `const DEBIT_ORDER: BucketType[] = ["subscription", "rollover", "topup"]`.
  - `interface BucketBalances { subscription: number; rollover: number; topup: number; total: number }`.
  - `getBucketBalances(networkId: string): Promise<BucketBalances>` — SUM par bucket, entrées non expirées uniquement.
  - `getBalance` (existant) modifié pour **exclure les entrées expirées**.
  - `grantCredits` (existant) gagne `bucket?: BucketType` (défaut `"topup"`), `expiresAt?: Date | null`, `periodId?: string | null`.

- [ ] **Step 1: Écrire les tests**

Dans `backend/src/modules/ai/creditsRepo.test.ts`, ajouter (le fichier a déjà `networkId`, `createNetwork`, cleanup — réutiliser ; importer `getBucketBalances`, `BucketType`) :

```ts
	it("getBucketBalances sums each bucket, excluding expired entries", async () => {
		const past = new Date("2020-01-01T00:00:00Z");
		const future = new Date("2999-01-01T00:00:00Z");
		await grantCredits({ networkId, amount: 100, bucket: "subscription", expiresAt: future });
		await grantCredits({ networkId, amount: 40, bucket: "subscription", expiresAt: past }); // expired → ignored
		await grantCredits({ networkId, amount: 30, bucket: "rollover" });
		await grantCredits({ networkId, amount: 200, bucket: "topup" });
		const b = await getBucketBalances(networkId);
		expect(b.subscription).toBe(100);
		expect(b.rollover).toBe(30);
		expect(b.topup).toBe(200);
		expect(b.total).toBe(330);
	});

	it("getBalance excludes expired entries", async () => {
		await grantCredits({ networkId, amount: 50, bucket: "topup" });
		await grantCredits({ networkId, amount: 999, bucket: "subscription", expiresAt: new Date("2020-01-01T00:00:00Z") });
		expect(await getBalance(networkId)).toBe(50);
	});

	it("grantCredits defaults to the topup bucket", async () => {
		const { id } = await grantCredits({ networkId, amount: 10 });
		const [row] = await db.select().from(aiCreditLedger).where(eq(aiCreditLedger.id, id));
		expect(row.bucket).toBe("topup");
		expect(row.expiresAt).toBeNull();
	});
```

(Le fichier importe déjà `db`, `aiCreditLedger`, `eq` — sinon les ajouter aux imports.)

- [ ] **Step 2: Run — expect FAIL**

Run: `cd backend && bun run test src/modules/ai/creditsRepo.test.ts`
Expected: FAIL — `getBucketBalances` non exporté ; `grantCredits` ne connaît pas `bucket`.

- [ ] **Step 3: Implémenter dans `creditsRepo.ts`**

Ajouter en haut (après les imports) :

```ts
export type BucketType = "subscription" | "rollover" | "topup";
export const DEBIT_ORDER: BucketType[] = ["subscription", "rollover", "topup"];

export interface BucketBalances {
	subscription: number;
	rollover: number;
	topup: number;
	total: number;
}

/** SQL predicate: entry still valid (not expired). */
const notExpired = sql`(${aiCreditLedger.expiresAt} is null or ${aiCreditLedger.expiresAt} > now())`;
```

Remplacer `getBalance` par :

```ts
export async function getBalance(networkId: string): Promise<number> {
	const rows = await db
		.select({ balance: sql<number>`coalesce(sum(${aiCreditLedger.delta}), 0)::int` })
		.from(aiCreditLedger)
		.where(and(eq(aiCreditLedger.networkId, networkId), notExpired));
	return rows[0]?.balance ?? 0;
}

export async function getBucketBalances(networkId: string): Promise<BucketBalances> {
	const rows = await db
		.select({
			bucket: aiCreditLedger.bucket,
			balance: sql<number>`coalesce(sum(${aiCreditLedger.delta}), 0)::int`,
		})
		.from(aiCreditLedger)
		.where(and(eq(aiCreditLedger.networkId, networkId), notExpired))
		.groupBy(aiCreditLedger.bucket);
	const by: Record<string, number> = {};
	for (const r of rows) by[r.bucket] = r.balance;
	const subscription = by.subscription ?? 0;
	const rollover = by.rollover ?? 0;
	const topup = by.topup ?? 0;
	return { subscription, rollover, topup, total: subscription + rollover + topup };
}
```

Remplacer `grantCredits` par (ajout des 3 params, insertion des colonnes) :

```ts
export async function grantCredits(input: {
	networkId: string;
	amount: number;
	note?: string;
	createdBy?: string | null;
	reason?: "grant" | "adjustment";
	bucket?: BucketType;
	expiresAt?: Date | null;
	periodId?: string | null;
}): Promise<{ id: string; balance: number }> {
	const id = crypto.randomUUID();
	await db.insert(aiCreditLedger).values({
		id,
		networkId: input.networkId,
		delta: input.amount,
		reason: input.reason ?? "grant",
		bucket: input.bucket ?? "topup",
		expiresAt: input.expiresAt ?? null,
		periodId: input.periodId ?? null,
		note: input.note ?? null,
		createdBy: input.createdBy ?? null,
		createdAt: new Date(),
	});
	return { id, balance: await getBalance(input.networkId) };
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `cd backend && bun run test src/modules/ai/creditsRepo.test.ts`
Expected: PASS (nouveaux + existants).

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/ai/creditsRepo.ts backend/src/modules/ai/creditsRepo.test.ts
git commit -m "feat(backend): per-bucket balances + typed grants, expiry-aware getBalance"
```

---

### Task 3: Moteur de débit ordonné (`debitBuckets`)

**Files:**
- Modify: `backend/src/modules/ai/creditsRepo.ts`
- Test: `backend/src/modules/ai/creditsRepo.test.ts`

**Interfaces:**
- Consumes: `BucketType`, `DEBIT_ORDER`, `notExpired`, table `aiCreditLedger`.
- Produces:
  - `interface DebitBreakdown { subscription: number; rollover: number; topup: number; total: number }`.
  - `debitBuckets(tx, networkId: string, amount: number, opts: { usageLogId?: string | null; now: Date }): Promise<DebitBreakdown>` — écrit une entrée négative (`reason="debit"`) par bucket ponctionné, dans l'ordre `DEBIT_ORDER`, à hauteur du solde disponible de chaque bucket ; le reliquat éventuel (solde insuffisant) est mis en négatif sur `topup` pour que la somme débitée = `amount`. `tx` est le handle de transaction Drizzle (mais accepte aussi `db`).

- [ ] **Step 1: Écrire les tests**

```ts
	it("debitBuckets consumes subscription → rollover → topup in order", async () => {
		const now = new Date();
		await grantCredits({ networkId, amount: 30, bucket: "subscription" });
		await grantCredits({ networkId, amount: 20, bucket: "rollover" });
		await grantCredits({ networkId, amount: 100, bucket: "topup" });
		// debit 65 → 30 sub + 20 rollover + 15 topup
		const br = await db.transaction((tx) => debitBuckets(tx, networkId, 65, { now }));
		expect(br).toEqual({ subscription: 30, rollover: 20, topup: 15, total: 65 });
		const b = await getBucketBalances(networkId);
		expect(b.subscription).toBe(0);
		expect(b.rollover).toBe(0);
		expect(b.topup).toBe(85);
	});

	it("debitBuckets puts the shortfall on topup (can go negative) when funds are insufficient", async () => {
		const now = new Date();
		await grantCredits({ networkId, amount: 10, bucket: "subscription" });
		const br = await db.transaction((tx) => debitBuckets(tx, networkId, 25, { now }));
		expect(br.subscription).toBe(10);
		expect(br.topup).toBe(15); // 15 debited from topup even though it was 0 → -15
		expect(br.total).toBe(25);
		expect(await getBalance(networkId)).toBe(-15);
	});

	it("debitBuckets writes one negative ledger entry per consumed bucket, tagged", async () => {
		const now = new Date();
		await grantCredits({ networkId, amount: 5, bucket: "subscription" });
		await grantCredits({ networkId, amount: 5, bucket: "topup" });
		await db.transaction((tx) => debitBuckets(tx, networkId, 8, { now, usageLogId: "u1" }));
		const debits = await db.select().from(aiCreditLedger)
			.where(and(eq(aiCreditLedger.networkId, networkId), eq(aiCreditLedger.reason, "debit")));
		const byBucket = Object.fromEntries(debits.map((d) => [d.bucket, d.delta]));
		expect(byBucket.subscription).toBe(-5);
		expect(byBucket.topup).toBe(-3);
		expect(debits.every((d) => d.usageLogId === "u1")).toBe(true);
	});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `cd backend && bun run test src/modules/ai/creditsRepo.test.ts`
Expected: FAIL — `debitBuckets` non exporté.

- [ ] **Step 3: Implémenter `debitBuckets` dans `creditsRepo.ts`**

```ts
export interface DebitBreakdown {
	subscription: number;
	rollover: number;
	topup: number;
	total: number;
}

type DbOrTx = typeof db;

/**
 * Debit `amount` credits from a network, walking buckets in DEBIT_ORDER
 * (subscription → rollover → topup). Writes one negative ledger entry per
 * consumed bucket. Any shortfall (insufficient funds) is applied to topup,
 * which may go negative — consistent with the pre-check-then-debit model where
 * concurrent turns can briefly overshoot. Runs inside the caller's transaction.
 */
export async function debitBuckets(
	tx: DbOrTx,
	networkId: string,
	amount: number,
	opts: { usageLogId?: string | null; now: Date },
): Promise<DebitBreakdown> {
	// Available balance per bucket (non-expired), within the caller's tx.
	const rows = await tx
		.select({
			bucket: aiCreditLedger.bucket,
			balance: sql<number>`coalesce(sum(${aiCreditLedger.delta}), 0)::int`,
		})
		.from(aiCreditLedger)
		.where(and(eq(aiCreditLedger.networkId, networkId), notExpired))
		.groupBy(aiCreditLedger.bucket);
	const avail: Record<BucketType, number> = { subscription: 0, rollover: 0, topup: 0 };
	for (const r of rows) if (r.bucket in avail) avail[r.bucket as BucketType] = r.balance;

	const taken: Record<BucketType, number> = { subscription: 0, rollover: 0, topup: 0 };
	let remaining = amount;
	for (const bucket of DEBIT_ORDER) {
		if (remaining <= 0) break;
		const take = Math.min(Math.max(avail[bucket], 0), remaining);
		if (take > 0) {
			taken[bucket] = take;
			remaining -= take;
		}
	}
	// Shortfall → topup (may go negative).
	if (remaining > 0) taken.topup += remaining;

	for (const bucket of DEBIT_ORDER) {
		if (taken[bucket] > 0) {
			await tx.insert(aiCreditLedger).values({
				id: crypto.randomUUID(),
				networkId,
				delta: -taken[bucket],
				reason: "debit",
				bucket,
				usageLogId: opts.usageLogId ?? null,
				createdAt: opts.now,
			});
		}
	}
	return {
		subscription: taken.subscription,
		rollover: taken.rollover,
		topup: taken.topup,
		total: taken.subscription + taken.rollover + taken.topup,
	};
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `cd backend && bun run test src/modules/ai/creditsRepo.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/ai/creditsRepo.ts backend/src/modules/ai/creditsRepo.test.ts
git commit -m "feat(backend): ordered bucket debit engine (subscription→rollover→topup)"
```

---

### Task 4: Brancher `recordDebitedTurn` sur `debitBuckets`

**Files:**
- Modify: `backend/src/modules/ai/usageRepo.ts`
- Test: `backend/src/modules/ai/usageRepo.test.ts` (étendre)

**Interfaces:**
- Consumes: `debitBuckets` (Task 3), `getBalance` (existant).
- Produces: `recordDebitedTurn` inchangé côté signature/retour (`{ usageLogId, debited, balance }`) mais les débits passent désormais par les buckets (entrées taguées). Zéro-crédit → aucune entrée (inchangé).

- [ ] **Step 1: Écrire un test d'intégration bucket**

Dans `backend/src/modules/ai/usageRepo.test.ts` (a déjà `networkId`, `model`, `grantCredits`, cleanup — importer `debitBuckets`/`getBucketBalances` si besoin) :

```ts
	it("recordDebitedTurn draws from subscription before topup", async () => {
		// model prices: 1000 cpmIn / 2000 cpmOut (from the test fixture). Usage
		// 500k in / 100k out → ceil((500k·1000 + 100k·2000)/1M) = 700 credits.
		await grantCredits({ networkId, amount: 400, bucket: "subscription" });
		await grantCredits({ networkId, amount: 1000, bucket: "topup" });
		const res = await recordDebitedTurn({
			networkId, model,
			usage: { inputTokens: 500_000, outputTokens: 100_000 },
			promptPreview: "x",
		});
		expect(res.debited).toBe(700);
		const b = await getBucketBalances(networkId);
		expect(b.subscription).toBe(0); // 400 consumed
		expect(b.topup).toBe(700); // 1000 − 300 remainder
	});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `cd backend && bun run test src/modules/ai/usageRepo.test.ts`
Expected: FAIL — le débit actuel est un seul `bucket=topup` (default), donc subscription reste à 400.

- [ ] **Step 3: Refactorer `recordDebitedTurn`**

Dans `backend/src/modules/ai/usageRepo.ts`, changer l'import :

```ts
import { debitBuckets, getBalance } from "./creditsRepo";
```

et remplacer le corps de la transaction (l'insert `aiUsageLog` + le bloc `if (credits > 0) { tx.insert(aiCreditLedger)... }`) par :

```ts
	await db.transaction(async (tx) => {
		await tx.insert(aiUsageLog).values({
			...baseRow(input, id, now),
			creditsCharged: credits,
			status: "success",
		});
		if (credits > 0) {
			await debitBuckets(tx, input.networkId, credits, { usageLogId: id, now });
		}
	});
```

Supprimer l'import désormais inutile de `aiCreditLedger` dans `usageRepo.ts` s'il n'est plus référencé ailleurs (il l'est encore ? vérifier — `recordErrorTurn` n'insère pas de ledger ; le seul usage de `aiCreditLedger` était le bloc débit remplacé → retirer de l'import `import { aiUsageLog } from "../../db/schema";`).

- [ ] **Step 4: Run — expect PASS + suite complète**

Run: `cd backend && bun run test src/modules/ai/usageRepo.test.ts`
Expected: PASS (nouveaux + existants — l'ancien test « écrit usage_log + ledger debit » vérifie toujours une entrée `reason=debit` liée, qui existe encore, taguée `topup` quand pas de subscription).
Run: `cd backend && bun run test`
Expected: PASS — suite complète (l'intégration assistant `creditsIntegration.test.ts` continue de passer : le débit total est identique, seul le tag bucket change).

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/ai/usageRepo.ts backend/src/modules/ai/usageRepo.test.ts
git commit -m "feat(backend): assistant debits walk credit buckets in order"
```

---

### Task 5: Renouvellement d'abonnement + rollover (`subscriptionCredits.ts`)

**Files:**
- Create: `backend/src/modules/ai/subscriptionCredits.ts`
- Test: `backend/src/modules/ai/subscriptionCredits.test.ts`

**Interfaces:**
- Consumes: `getBucketBalances` (Task 2), table `aiCreditLedger`, `BucketType`.
- Produces:
  - `renewSubscriptionPeriod(input: { networkId; creditsPerPeriod: number; rolloverCap: number; newPeriodId: string; newPeriodEnd: Date; now?: Date }): Promise<{ granted: number; rolledOver: number }>` — en une transaction append-only :
    1. bascule le reste du bucket `subscription` en `rollover` à hauteur de `min(reste, rolloverCap)` (une entrée négative subscription + une positive rollover) ;
    2. crédite `creditsPerPeriod` en `subscription` avec `expires_at = newPeriodEnd`, `period_id = newPeriodId`.
  - (Le webhook Stripe du sous-projet B appellera cette fonction ; ici on la teste isolément.)

- [ ] **Step 1: Écrire les tests**

`backend/src/modules/ai/subscriptionCredits.test.ts` :

```ts
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../../db/index";
import { aiCreditLedger, networks } from "../../db/schema";
import { createNetwork } from "../../lib/networkManager";
import { getBucketBalances } from "./creditsRepo";
import { renewSubscriptionPeriod } from "./subscriptionCredits";

let networkId = "";

beforeAll(async () => {
	networkId = (await createNetwork("sub-renewal-net")).id;
});

afterAll(async () => {
	await db.delete(aiCreditLedger).where(eq(aiCreditLedger.networkId, networkId));
	await db.delete(networks).where(eq(networks.id, networkId));
});

describe("renewSubscriptionPeriod", () => {
	const future = new Date("2999-01-01T00:00:00Z");

	it("rolls leftover subscription into rollover (capped) and grants the new period", async () => {
		// Start: 50 subscription left, cap 30.
		await db.insert(aiCreditLedger).values({
			id: crypto.randomUUID(), networkId, delta: 50, reason: "grant",
			bucket: "subscription", expiresAt: future, createdAt: new Date(),
		});
		const res = await renewSubscriptionPeriod({
			networkId, creditsPerPeriod: 500, rolloverCap: 30,
			newPeriodId: "p2", newPeriodEnd: future,
		});
		expect(res.granted).toBe(500);
		expect(res.rolledOver).toBe(30);
		const b = await getBucketBalances(networkId);
		expect(b.subscription).toBe(500); // old 50 zeroed, new 500 granted
		expect(b.rollover).toBe(30); // capped at 30, 20 dropped
	});

	it("rolls nothing when cap is 0", async () => {
		const net = (await createNetwork("sub-renewal-net2")).id;
		try {
			await db.insert(aiCreditLedger).values({
				id: crypto.randomUUID(), networkId: net, delta: 40, reason: "grant",
				bucket: "subscription", expiresAt: future, createdAt: new Date(),
			});
			const res = await renewSubscriptionPeriod({
				networkId: net, creditsPerPeriod: 100, rolloverCap: 0,
				newPeriodId: "p1", newPeriodEnd: future,
			});
			expect(res.rolledOver).toBe(0);
			const b = await getBucketBalances(net);
			expect(b.subscription).toBe(100);
			expect(b.rollover).toBe(0);
		} finally {
			await db.delete(aiCreditLedger).where(eq(aiCreditLedger.networkId, net));
			await db.delete(networks).where(eq(networks.id, net));
		}
	});
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `cd backend && bun run test src/modules/ai/subscriptionCredits.test.ts`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Implémenter `subscriptionCredits.ts`**

```ts
import { db } from "../../db/index";
import { aiCreditLedger } from "../../db/schema";
import { getBucketBalances } from "./creditsRepo";

/**
 * Append-only subscription renewal: roll the leftover of the closing period's
 * subscription bucket into rollover (capped at `rolloverCap`), then grant the
 * new period's subscription credits (expiring at `newPeriodEnd`). Called by the
 * Stripe `invoice.paid` webhook (sub-project B). Returns what was granted/rolled.
 */
export async function renewSubscriptionPeriod(input: {
	networkId: string;
	creditsPerPeriod: number;
	rolloverCap: number;
	newPeriodId: string;
	newPeriodEnd: Date;
	now?: Date;
}): Promise<{ granted: number; rolledOver: number }> {
	const now = input.now ?? new Date();
	const before = await getBucketBalances(input.networkId);
	const leftover = Math.max(before.subscription, 0);
	const rolledOver = Math.min(leftover, Math.max(input.rolloverCap, 0));

	await db.transaction(async (tx) => {
		// Zero the closing period's subscription bucket (append a matching negative).
		if (leftover > 0) {
			await tx.insert(aiCreditLedger).values({
				id: crypto.randomUUID(), networkId: input.networkId, delta: -leftover,
				reason: "adjustment", bucket: "subscription", note: "period close",
				createdAt: now,
			});
		}
		// Carry the capped amount into rollover (permanent).
		if (rolledOver > 0) {
			await tx.insert(aiCreditLedger).values({
				id: crypto.randomUUID(), networkId: input.networkId, delta: rolledOver,
				reason: "grant", bucket: "rollover", note: "rollover", createdAt: now,
			});
		}
		// Grant the new period's subscription credits (expiring at period end).
		await tx.insert(aiCreditLedger).values({
			id: crypto.randomUUID(), networkId: input.networkId, delta: input.creditsPerPeriod,
			reason: "grant", bucket: "subscription", expiresAt: input.newPeriodEnd,
			periodId: input.newPeriodId, note: "subscription renewal", createdAt: now,
		});
	});

	return { granted: input.creditsPerPeriod, rolledOver };
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `cd backend && bun run test src/modules/ai/subscriptionCredits.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/ai/subscriptionCredits.ts backend/src/modules/ai/subscriptionCredits.test.ts
git commit -m "feat(backend): subscription renewal + capped rollover (append-only)"
```

---

### Task 6: Docs de clôture

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `docs/architecture/entities.md` (compléter si besoin)

- [ ] **Step 1: CHANGELOG**

Sous `[Unreleased] ### Added` :

```markdown
- Credit buckets (billing foundation): `ai_credit_ledger` gains `bucket` (`subscription`/`rollover`/`topup`), `expires_at`, `period_id`. Balances are per-bucket and expiry-aware; assistant debits walk buckets in order (subscription → rollover → topup, spec 2026-07-03 §4.1); `renewSubscriptionPeriod` handles capped rollover. No Stripe yet (sub-project A of the billing spec).
```

- [ ] **Step 2: Vérifier entities.md** — la note de Task 1 suffit ; compléter d'une phrase sur `renewSubscriptionPeriod` si absente.

- [ ] **Step 3: Suite complète finale**

Run: `cd backend && bun run test`
Expected: PASS (toute la suite backend).

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md docs/architecture/entities.md
git commit -m "docs: credit buckets foundation (CHANGELOG, entities)"
```
