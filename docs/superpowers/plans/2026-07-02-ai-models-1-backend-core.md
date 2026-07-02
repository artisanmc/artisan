# AI Models — Plan 1/4 : Backend core (schéma, catalogue, providers, credits, routes admin)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Le module backend `ai` : 3 tables (catalogue, usage log, ledger), repo catalogue + `resolveModel`, credentials providers chiffrées, credits grant/balance, routes admin (CRUD modèles, test live, providers, settings, grant), seed legacy au boot.

**Architecture:** Nouveau module `backend/src/modules/ai/` (spec `docs/superpowers/specs/2026-07-02-ai-model-system-design.md`). Le module `assistant` deviendra consommateur au plan 2 — ce plan ne touche PAS `assistant/` (les routes legacy `assistant-config` restent en place jusqu'au plan 3). Réutilise `OpenAICompatibleProvider`, `appSettings`, `secretBox`, `requireAdmin` tels quels.

**Tech Stack:** Bun + Hono + Drizzle (PostgreSQL). Tests `bun:test` via `bun run test` (JAMAIS `bun test` direct — wrapper `scripts/test.ts` redirige vers `artisan_test`).

## Global Constraints

- Tout endpoint sous `/api/v1/` ; routes admin montées dans `app.ts` derrière `userAuth()` + `requireAdmin()` (pattern existant lignes 57-60).
- Prix en **entiers** : credits par 1M tokens ; coût réel en **micro-USD** par 1M tokens ($0.075 → 75 000). Jamais de flottants en DB.
- Clés API : chiffrées `secretBox` (AES-256-GCM, `CONFIG_ENC_KEY`), **write-only** côté API (réponses exposent `keySet: boolean`, jamais la clé).
- Un seul modèle `is_default` (index unique partiel). Pas de DELETE de modèle — désactivation uniquement.
- Tri déterministe : jamais `localeCompare` (`<`/`>` byte order — invariant maison).
- Migration Drizzle générée (`bun run db:generate`) et **committée** avec le changement de `schema.ts`.
- Commits : conventional commits (`feat:`, `docs:`…).
- Lancer la suite : `cd backend && bun run test` (nécessite Docker PostgreSQL local).

---

### Task 1: Schéma DB + migration + entities.md

**Files:**
- Modify: `backend/src/db/schema.ts` (append en fin de fichier + 1 colonne dans `users`)
- Create: `backend/drizzle/0011_ai_models.sql` (généré)
- Modify: `docs/architecture/entities.md` (section nouvelle « AI models & credits »)

**Interfaces:**
- Produces: tables Drizzle `aiModels`, `aiUsageLog`, `aiCreditLedger`, colonne `users.preferredAiModelId` — importées par tous les tasks suivants depuis `../../db/schema`.

- [ ] **Step 1: Ajouter les tables au schéma**

Dans `backend/src/db/schema.ts`, ajouter dans la table `users` (après la ligne `isAdmin`) :

```ts
		// Last AI model picked in the assistant selector (plain id, no FK:
		// ai_models is declared later in this file and models are never
		// hard-deleted; a dangling id falls back to the default model at read time).
		preferredAiModelId: text("preferred_ai_model_id"),
```

Puis append en fin de fichier :

```ts
// AI model catalog (admin-managed). Prices are integers: credits per 1M tokens,
// real provider cost in micro-USD per 1M tokens ($0.075 → 75_000) — no floats
// in DB. Models referenced by usage history are never hard-deleted: deactivate
// instead. Cf. docs/superpowers/specs/2026-07-02-ai-model-system-design.md.
export const aiModels = pgTable(
	"ai_models",
	{
		id: text("id").primaryKey(),
		displayName: text("display_name").notNull(),
		description: text("description").notNull().default(""),
		badge: text("badge").notNull(), // "cheap" | "balanced" | "premium"
		provider: text("provider").notNull(), // slug into app_settings.ai_providers
		providerModelId: text("provider_model_id").notNull(),
		creditsPerMInput: integer("credits_per_m_input").notNull(),
		creditsPerMOutput: integer("credits_per_m_output").notNull(),
		realUsdPerMInput: integer("real_usd_per_m_input").notNull(),
		realUsdPerMOutput: integer("real_usd_per_m_output").notNull(),
		isActive: boolean("is_active").notNull().default(true),
		isDefault: boolean("is_default").notNull().default(false),
		createdAt: timestamp("created_at").notNull(),
		updatedAt: timestamp("updated_at").notNull(),
	},
	(t) => [
		// Partial unique index: at most ONE row may have is_default = true.
		uniqueIndex("ai_models_default_uniq")
			.on(t.isDefault)
			.where(sql`is_default`),
	],
);

// One row per assistant turn (or future AI action — action_type is extensible).
// model_name/provider/provider_model_id are SNAPSHOTS so history survives
// renames. The only stored content is prompt_preview (~200 chars): full
// transcripts live in assistant_conversations; the admin "full view" links to
// the conversation.
export const aiUsageLog = pgTable(
	"ai_usage_log",
	{
		id: text("id").primaryKey(),
		networkId: text("network_id")
			.notNull()
			.references(() => networks.id, { onDelete: "cascade" }),
		userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
		serverKeyId: text("server_key_id").references(() => serverKeys.id, {
			onDelete: "set null",
		}),
		modelId: text("model_id").references(() => aiModels.id, {
			onDelete: "set null", // snapshots keep the log readable
		}),
		modelName: text("model_name").notNull(),
		provider: text("provider").notNull(),
		providerModelId: text("provider_model_id").notNull(),
		actionType: text("action_type").notNull().default("chat"),
		conversationId: text("conversation_id"),
		inputTokens: integer("input_tokens").notNull().default(0),
		outputTokens: integer("output_tokens").notNull().default(0),
		cachedInputTokens: integer("cached_input_tokens").notNull().default(0),
		creditsCharged: integer("credits_charged").notNull().default(0),
		realCostMicroUsd: integer("real_cost_micro_usd").notNull().default(0),
		durationMs: integer("duration_ms"),
		status: text("status").notNull(), // "success" | "error"
		errorMessage: text("error_message"),
		promptPreview: text("prompt_preview").notNull().default(""),
		createdAt: timestamp("created_at").notNull(),
	},
	(t) => [
		index("ai_usage_network_time_idx").on(t.networkId, t.createdAt),
		index("ai_usage_user_time_idx").on(t.userId, t.createdAt),
		index("ai_usage_model_idx").on(t.modelId),
		index("ai_usage_time_idx").on(t.createdAt),
	],
);

// Credit ledger, one row per grant/debit. Balance(network) = SUM(delta).
// No materialized balance in V1 — the indexed SUM is enough.
export const aiCreditLedger = pgTable(
	"ai_credit_ledger",
	{
		id: text("id").primaryKey(),
		networkId: text("network_id")
			.notNull()
			.references(() => networks.id, { onDelete: "cascade" }),
		delta: integer("delta").notNull(), // grant > 0, debit < 0
		reason: text("reason").notNull(), // "grant" | "debit" | "refund" | "adjustment"
		usageLogId: text("usage_log_id").references(() => aiUsageLog.id, {
			onDelete: "set null",
		}),
		note: text("note"),
		createdBy: text("created_by").references(() => users.id, {
			onDelete: "set null",
		}),
		createdAt: timestamp("created_at").notNull(),
	},
	(t) => [index("ai_ledger_network_time_idx").on(t.networkId, t.createdAt)],
);
```

- [ ] **Step 2: Générer la migration**

Run: `cd backend && bun run db:generate`
Expected: nouveau fichier `backend/drizzle/0011_*.sql` créé (le nom généré peut varier), contenant `CREATE TABLE "ai_models"`, `"ai_usage_log"`, `"ai_credit_ledger"` + `ALTER TABLE "users" ADD COLUMN "preferred_ai_model_id"`.

- [ ] **Step 3: Vérifier que la suite tourne toujours (migration appliquée sur artisan_test)**

Run: `cd backend && bun run test`
Expected: PASS (le wrapper migre `artisan_test` avec le nouveau fichier ; aucun test existant ne casse — le schéma est additif).

- [ ] **Step 4: Documenter dans entities.md**

Dans `docs/architecture/entities.md`, ajouter une section :

```markdown
## AI models & credits (2026-07-02)

- **`ai_models`** — catalogue admin des modèles IA (prix credits + coût réel micro-USD par 1M tokens, badge cheap/balanced/premium, `is_default` unique via index partiel). Jamais supprimés, seulement désactivés.
- **`ai_usage_log`** — une row par tour d'assistant : acteur (`user_id` ou `server_key_id`), `network_id` (porteur du débit), snapshots modèle, tokens, `credits_charged` (0 si `status='error'`), `real_cost_micro_usd`, `prompt_preview` (~200 chars — contenu complet dans `assistant_conversations`).
- **`ai_credit_ledger`** — solde d'un network = `SUM(delta)`. `reason ∈ {grant, debit, refund, adjustment}` ; les débits pointent `usage_log_id`. Le **network** porte les credits (décision spec 2026-07-02) : sessions user ET server-key débitent le network du project.
- `users.preferred_ai_model_id` — dernier modèle choisi (pas de FK, fallback silencieux sur le défaut si dangling).
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/db/schema.ts backend/drizzle/ docs/architecture/entities.md
git commit -m "feat(backend): ai_models + ai_usage_log + ai_credit_ledger schema"
```

---

### Task 2: Catalogue — `modelRepo.ts` + `pricing.ts`

**Files:**
- Create: `backend/src/modules/ai/modelRepo.ts`
- Create: `backend/src/modules/ai/pricing.ts`
- Test: `backend/src/modules/ai/modelRepo.test.ts`, `backend/src/modules/ai/pricing.test.ts`

**Interfaces:**
- Consumes: tables `aiModels` (Task 1), type `LlmUsage` de `../assistant/provider/types`.
- Produces:
  - `type AiBadge = "cheap" | "balanced" | "premium"`
  - `interface AiModel { id; displayName; description; badge: AiBadge; provider; providerModelId; creditsPerMInput; creditsPerMOutput; realUsdPerMInput; realUsdPerMOutput; isActive; isDefault; createdAt: Date; updatedAt: Date }`
  - `interface AiModelInput` (idem sans `id/isDefault/createdAt/updatedAt`)
  - `listModels(): Promise<AiModel[]>`, `getModel(id): Promise<AiModel | null>`, `createModel(input): Promise<AiModel>`, `updateModel(id, patch): Promise<AiModel | null>`, `setDefaultModel(id): Promise<boolean>`, `resolveModel(requestedId?): Promise<AiModel | null>`
  - `computeCreditsCharged(u: LlmUsage, m: AiModel): number`, `computeRealCostMicroUsd(u: LlmUsage, m: AiModel): number`, `sumUsage(events: LlmUsage[]): LlmUsage`

- [ ] **Step 1: Écrire les tests pricing (purs, sans DB)**

`backend/src/modules/ai/pricing.test.ts` :

```ts
import { describe, expect, it } from "bun:test";
import type { AiModel } from "./modelRepo";
import { computeCreditsCharged, computeRealCostMicroUsd, sumUsage } from "./pricing";

const model = {
	creditsPerMInput: 1000,
	creditsPerMOutput: 2000,
	realUsdPerMInput: 3_000_000, // $3 / 1M
	realUsdPerMOutput: 15_000_000, // $15 / 1M
} as AiModel;

describe("computeCreditsCharged", () => {
	it("0 usage → 0 credits (never bill an empty turn)", () => {
		expect(computeCreditsCharged({ inputTokens: 0, outputTokens: 0 }, model)).toBe(0);
	});
	it("ceils so any non-zero usage costs at least 1 credit", () => {
		expect(computeCreditsCharged({ inputTokens: 100, outputTokens: 0 }, model)).toBe(1);
	});
	it("exact formula: ceil((in·cpmIn + out·cpmOut) / 1M)", () => {
		// 500k·1000 + 100k·2000 = 700_000_000_000... /1M → 700
		expect(
			computeCreditsCharged({ inputTokens: 500_000, outputTokens: 100_000 }, model),
		).toBe(700);
	});
});

describe("computeRealCostMicroUsd", () => {
	it("rounds micro-USD", () => {
		// 1M in → $3 = 3_000_000 µ$; 200k out → $3 = 3_000_000 µ$
		expect(
			computeRealCostMicroUsd({ inputTokens: 1_000_000, outputTokens: 200_000 }, model),
		).toBe(6_000_000);
	});
});

describe("sumUsage", () => {
	it("sums including optional cachedInputTokens", () => {
		expect(
			sumUsage([
				{ inputTokens: 10, outputTokens: 5, cachedInputTokens: 3 },
				{ inputTokens: 20, outputTokens: 1 },
			]),
		).toEqual({ inputTokens: 30, outputTokens: 6, cachedInputTokens: 3 });
	});
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `cd backend && bun run test src/modules/ai/pricing.test.ts`
Expected: FAIL — `Cannot find module './pricing'`.

(Note : `bun run test <path>` passe l'argument au wrapper qui le forwarde au runner — c'est le wrapper qui est obligatoire, pas l'absence d'argument.)

- [ ] **Step 3: Implémenter `pricing.ts`**

```ts
import type { LlmUsage } from "../assistant/provider/types";
import type { AiModel } from "./modelRepo";

/** Credits owed for a turn's summed usage. ceil → any non-zero usage costs ≥ 1.
 *  Cached input tokens are INCLUDED in inputTokens by the provider (OpenAI
 *  semantics) — no separate cache pricing in V1. */
export function computeCreditsCharged(u: LlmUsage, m: AiModel): number {
	const raw = u.inputTokens * m.creditsPerMInput + u.outputTokens * m.creditsPerMOutput;
	return raw === 0 ? 0 : Math.ceil(raw / 1_000_000);
}

/** Real provider cost in micro-USD (analytics only — rounded, not billed). */
export function computeRealCostMicroUsd(u: LlmUsage, m: AiModel): number {
	return Math.round(
		(u.inputTokens * m.realUsdPerMInput + u.outputTokens * m.realUsdPerMOutput) / 1_000_000,
	);
}

/** Sum the usage events of one turn (one event per provider round-trip). */
export function sumUsage(events: LlmUsage[]): LlmUsage {
	return events.reduce<LlmUsage>(
		(acc, u) => ({
			inputTokens: acc.inputTokens + u.inputTokens,
			outputTokens: acc.outputTokens + u.outputTokens,
			cachedInputTokens: (acc.cachedInputTokens ?? 0) + (u.cachedInputTokens ?? 0),
		}),
		{ inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 },
	);
}
```

- [ ] **Step 4: Écrire les tests modelRepo (DB)**

`backend/src/modules/ai/modelRepo.test.ts` :

```ts
import { afterEach, describe, expect, it } from "bun:test";
import { db } from "../../db/index";
import { aiModels } from "../../db/schema";
import {
	createModel,
	getModel,
	listModels,
	resolveModel,
	setDefaultModel,
	updateModel,
	type AiModelInput,
} from "./modelRepo";

const base: AiModelInput = {
	displayName: "M",
	description: "",
	badge: "balanced",
	provider: "openai",
	providerModelId: "gpt-test",
	creditsPerMInput: 10,
	creditsPerMOutput: 20,
	realUsdPerMInput: 0,
	realUsdPerMOutput: 0,
	isActive: true,
};

afterEach(async () => {
	await db.delete(aiModels);
});

describe("modelRepo CRUD", () => {
	it("create → get round-trips", async () => {
		const m = await createModel({ ...base, displayName: "Sonnet" });
		const got = await getModel(m.id);
		expect(got?.displayName).toBe("Sonnet");
		expect(got?.isDefault).toBe(false);
	});

	it("updateModel patches fields and bumps updatedAt", async () => {
		const m = await createModel(base);
		const upd = await updateModel(m.id, { creditsPerMInput: 99, isActive: false });
		expect(upd?.creditsPerMInput).toBe(99);
		expect(upd?.isActive).toBe(false);
	});

	it("setDefaultModel unsets the previous default (single-default invariant)", async () => {
		const a = await createModel({ ...base, displayName: "A" });
		const b = await createModel({ ...base, displayName: "B" });
		await setDefaultModel(a.id);
		await setDefaultModel(b.id);
		const all = await listModels();
		expect(all.filter((m) => m.isDefault).map((m) => m.displayName)).toEqual(["B"]);
	});
});

describe("resolveModel", () => {
	it("returns the requested model when active", async () => {
		const m = await createModel(base);
		expect((await resolveModel(m.id))?.id).toBe(m.id);
	});

	it("falls back to the default when the requested model is inactive", async () => {
		const dead = await createModel({ ...base, displayName: "Dead", isActive: false });
		const def = await createModel({ ...base, displayName: "Def" });
		await setDefaultModel(def.id);
		expect((await resolveModel(dead.id))?.id).toBe(def.id);
	});

	it("default inactive → deterministic fallback: badge order (cheap first) then name", async () => {
		const def = await createModel({ ...base, displayName: "Def" });
		await setDefaultModel(def.id);
		await updateModel(def.id, { isActive: false });
		await createModel({ ...base, displayName: "Zeta", badge: "premium" });
		const cheap = await createModel({ ...base, displayName: "Alpha", badge: "cheap" });
		expect((await resolveModel())?.id).toBe(cheap.id);
	});

	it("no active model at all → null", async () => {
		await createModel({ ...base, isActive: false });
		expect(await resolveModel()).toBeNull();
	});
});
```

- [ ] **Step 5: Vérifier l'échec**

Run: `cd backend && bun run test src/modules/ai/modelRepo.test.ts`
Expected: FAIL — `Cannot find module './modelRepo'`.

- [ ] **Step 6: Implémenter `modelRepo.ts`**

```ts
import { eq } from "drizzle-orm";
import { db } from "../../db/index";
import { aiModels } from "../../db/schema";

export type AiBadge = "cheap" | "balanced" | "premium";
export const AI_BADGES: AiBadge[] = ["cheap", "balanced", "premium"];

export interface AiModel {
	id: string;
	displayName: string;
	description: string;
	badge: AiBadge;
	provider: string;
	providerModelId: string;
	creditsPerMInput: number;
	creditsPerMOutput: number;
	realUsdPerMInput: number;
	realUsdPerMOutput: number;
	isActive: boolean;
	isDefault: boolean;
	createdAt: Date;
	updatedAt: Date;
}

export type AiModelInput = Omit<AiModel, "id" | "isDefault" | "createdAt" | "updatedAt">;

const BADGE_ORDER: Record<AiBadge, number> = { cheap: 0, balanced: 1, premium: 2 };

function toModel(r: typeof aiModels.$inferSelect): AiModel {
	return { ...r, badge: r.badge as AiBadge };
}

export async function listModels(): Promise<AiModel[]> {
	const rows = await db.select().from(aiModels);
	// Byte-order name sort (never localeCompare — house invariant).
	return rows.map(toModel).sort((a, b) => (a.displayName < b.displayName ? -1 : 1));
}

export async function getModel(id: string): Promise<AiModel | null> {
	const rows = await db.select().from(aiModels).where(eq(aiModels.id, id));
	return rows.length > 0 ? toModel(rows[0]) : null;
}

export async function createModel(input: AiModelInput): Promise<AiModel> {
	const now = new Date();
	const row = { id: crypto.randomUUID(), ...input, isDefault: false, createdAt: now, updatedAt: now };
	await db.insert(aiModels).values(row);
	return toModel(row as typeof aiModels.$inferSelect);
}

export async function updateModel(
	id: string,
	patch: Partial<AiModelInput>,
): Promise<AiModel | null> {
	const rows = await db
		.update(aiModels)
		.set({ ...patch, updatedAt: new Date() })
		.where(eq(aiModels.id, id))
		.returning();
	return rows.length > 0 ? toModel(rows[0]) : null;
}

/** Make `id` the single default (transaction: unset old, set new). False if unknown. */
export async function setDefaultModel(id: string): Promise<boolean> {
	return db.transaction(async (tx) => {
		await tx.update(aiModels).set({ isDefault: false }).where(eq(aiModels.isDefault, true));
		const rows = await tx
			.update(aiModels)
			.set({ isDefault: true, updatedAt: new Date() })
			.where(eq(aiModels.id, id))
			.returning();
		return rows.length > 0;
	});
}

/**
 * Model resolution for a turn: requested (if active) → active default →
 * deterministic fallback (first active, badge order cheap→premium then byte-order
 * name) → null (no usable catalog).
 */
export async function resolveModel(requestedId?: string | null): Promise<AiModel | null> {
	if (requestedId) {
		const m = await getModel(requestedId);
		if (m?.isActive) return m;
	}
	const all = await listModels();
	const def = all.find((m) => m.isDefault && m.isActive);
	if (def) return def;
	const active = all
		.filter((m) => m.isActive)
		.sort(
			(a, b) =>
				BADGE_ORDER[a.badge] - BADGE_ORDER[b.badge] ||
				(a.displayName < b.displayName ? -1 : 1),
		);
	return active[0] ?? null;
}
```

- [ ] **Step 7: Vérifier le passage**

Run: `cd backend && bun run test src/modules/ai/modelRepo.test.ts src/modules/ai/pricing.test.ts`
Expected: PASS (tous).

- [ ] **Step 8: Commit**

```bash
git add backend/src/modules/ai/modelRepo.ts backend/src/modules/ai/pricing.ts backend/src/modules/ai/modelRepo.test.ts backend/src/modules/ai/pricing.test.ts
git commit -m "feat(backend): ai model catalog repo + pricing helpers"
```

---

### Task 3: Providers + settings — `providers.ts`, `settings.ts`

**Files:**
- Create: `backend/src/modules/ai/providers.ts`
- Create: `backend/src/modules/ai/settings.ts`
- Test: `backend/src/modules/ai/providers.test.ts`

**Interfaces:**
- Consumes: `getSetting`/`setSetting` (`lib/appSettings`), `encryptSecret`/`decryptSecret`/`isSecretsConfigured` (`lib/secretBox`), `OpenAICompatibleProvider` (`../assistant/provider/openaiCompatible`), `AiModel` (Task 2).
- Produces:
  - `AI_PROVIDERS_SETTING_KEY = "ai_providers"`, `AI_SETTINGS_KEY = "ai_settings"`
  - `interface StoredAiProvider { label: string; baseUrl: string; apiKeyEncrypted?: string }` ; `type StoredAiProviders = Record<string, StoredAiProvider>`
  - `PROVIDER_PRESETS: Record<string, { label: string; baseUrl: string }>` (anthropic, openai, deepseek, google)
  - `getStoredProviders(): Promise<StoredAiProviders>`
  - `listProvidersForAdmin(): Promise<Record<string, { label; baseUrl; keySet: boolean; preset: boolean }>>` (presets fusionnés + entrées stockées, clé jamais exposée)
  - `putProvider(slug, input: { label?: string; baseUrl?: string; apiKey?: string }, updatedBy: string | null): Promise<{ ok: true } | { ok: false; error: "encryption_not_configured" }>`
  - `hasUsableKey(slug: string): Promise<boolean>` (clé stockée OU baseUrl locale)
  - `createProviderFor(model: AiModel): Promise<LlmProvider | null>`
  - `getAiSettings(): Promise<AiSettings>`, `putAiSettings(patch, updatedBy)` avec `interface AiSettings { creditUsdMicroRate: number; maxCreditsPerTurn: number | null }` et `DEFAULT_AI_SETTINGS = { creditUsdMicroRate: 10_000, maxCreditsPerTurn: null }`

- [ ] **Step 1: Écrire les tests**

`backend/src/modules/ai/providers.test.ts` :

```ts
import { afterEach, beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../../db/index";
import { appSettings } from "../../db/schema";
import type { AiModel } from "./modelRepo";
import {
	AI_PROVIDERS_SETTING_KEY,
	createProviderFor,
	getStoredProviders,
	hasUsableKey,
	listProvidersForAdmin,
	putProvider,
} from "./providers";
import { AI_SETTINGS_KEY, DEFAULT_AI_SETTINGS, getAiSettings, putAiSettings } from "./settings";

beforeAll(() => {
	process.env.CONFIG_ENC_KEY = "0".repeat(64);
});

afterEach(async () => {
	await db.delete(appSettings).where(eq(appSettings.key, AI_PROVIDERS_SETTING_KEY));
	await db.delete(appSettings).where(eq(appSettings.key, AI_SETTINGS_KEY));
});

describe("providers config", () => {
	it("putProvider encrypts the key; admin listing only exposes keySet", async () => {
		const res = await putProvider("anthropic", { apiKey: "sk-ant-secret" }, null);
		expect(res.ok).toBe(true);
		const stored = await getStoredProviders();
		expect(stored.anthropic.apiKeyEncrypted).toBeDefined();
		expect(JSON.stringify(stored)).not.toContain("sk-ant-secret");
		const admin = await listProvidersForAdmin();
		expect(admin.anthropic.keySet).toBe(true);
		expect(JSON.stringify(admin)).not.toContain("sk-ant-secret");
	});

	it("putProvider with empty apiKey keeps the previously stored key", async () => {
		await putProvider("openai", { apiKey: "sk-first" }, null);
		await putProvider("openai", { baseUrl: "https://proxy.example/v1", apiKey: "" }, null);
		const stored = await getStoredProviders();
		expect(stored.openai.baseUrl).toBe("https://proxy.example/v1");
		expect(stored.openai.apiKeyEncrypted).toBeDefined();
	});

	it("presets appear in the admin listing without a stored entry", async () => {
		const admin = await listProvidersForAdmin();
		expect(admin.deepseek.preset).toBe(true);
		expect(admin.deepseek.keySet).toBe(false);
		expect(admin.deepseek.baseUrl).toContain("deepseek");
	});

	it("hasUsableKey: stored key OR local baseUrl", async () => {
		expect(await hasUsableKey("google")).toBe(false);
		await putProvider("google", { apiKey: "g-key" }, null);
		expect(await hasUsableKey("google")).toBe(true);
		await putProvider("ollama", { label: "Ollama", baseUrl: "http://localhost:11434/v1" }, null);
		expect(await hasUsableKey("ollama")).toBe(true);
	});

	it("createProviderFor returns null when the provider has no usable key", async () => {
		const m = { provider: "openai", providerModelId: "gpt-x" } as AiModel;
		expect(await createProviderFor(m)).toBeNull();
		await putProvider("openai", { apiKey: "sk-yes" }, null);
		expect(await createProviderFor(m)).not.toBeNull();
	});
});

describe("ai settings", () => {
	it("defaults when nothing stored", async () => {
		expect(await getAiSettings()).toEqual(DEFAULT_AI_SETTINGS);
	});
	it("putAiSettings patches and persists", async () => {
		await putAiSettings({ maxCreditsPerTurn: 50 }, null);
		const s = await getAiSettings();
		expect(s.maxCreditsPerTurn).toBe(50);
		expect(s.creditUsdMicroRate).toBe(DEFAULT_AI_SETTINGS.creditUsdMicroRate);
	});
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `cd backend && bun run test src/modules/ai/providers.test.ts`
Expected: FAIL — modules `./providers` / `./settings` introuvables.

- [ ] **Step 3: Implémenter `providers.ts`**

```ts
import { getSetting, setSetting } from "../../lib/appSettings";
import { decryptSecret, encryptSecret, isSecretsConfigured } from "../../lib/secretBox";
import { OpenAICompatibleProvider } from "../assistant/provider/openaiCompatible";
import type { LlmProvider } from "../assistant/provider/types";
import type { AiModel } from "./modelRepo";

export const AI_PROVIDERS_SETTING_KEY = "ai_providers";

export interface StoredAiProvider {
	label: string;
	baseUrl: string;
	apiKeyEncrypted?: string;
}
export type StoredAiProviders = Record<string, StoredAiProvider>;

/** Built-in slugs shown by default in the admin UI. All expose an
 *  OpenAI-compatible chat-completions endpoint. Custom slugs are allowed too. */
export const PROVIDER_PRESETS: Record<string, { label: string; baseUrl: string }> = {
	anthropic: { label: "Anthropic", baseUrl: "https://api.anthropic.com/v1" },
	openai: { label: "OpenAI", baseUrl: "https://api.openai.com/v1" },
	deepseek: { label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1" },
	google: { label: "Google", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai" },
};

function isLocalBaseUrl(u: string): boolean {
	return u.includes("localhost") || u.includes("127.0.0.1");
}

export async function getStoredProviders(): Promise<StoredAiProviders> {
	return (await getSetting<StoredAiProviders>(AI_PROVIDERS_SETTING_KEY)) ?? {};
}

/** Effective baseUrl for a slug: stored override, else preset, else "". */
async function effectiveBaseUrl(slug: string): Promise<string> {
	const stored = (await getStoredProviders())[slug];
	return stored?.baseUrl || PROVIDER_PRESETS[slug]?.baseUrl || "";
}

export async function listProvidersForAdmin(): Promise<
	Record<string, { label: string; baseUrl: string; keySet: boolean; preset: boolean }>
> {
	const stored = await getStoredProviders();
	const out: Record<string, { label: string; baseUrl: string; keySet: boolean; preset: boolean }> = {};
	for (const [slug, p] of Object.entries(PROVIDER_PRESETS)) {
		out[slug] = { label: p.label, baseUrl: p.baseUrl, keySet: false, preset: true };
	}
	for (const [slug, s] of Object.entries(stored)) {
		out[slug] = {
			label: s.label || PROVIDER_PRESETS[slug]?.label || slug,
			baseUrl: s.baseUrl || PROVIDER_PRESETS[slug]?.baseUrl || "",
			keySet: !!s.apiKeyEncrypted,
			preset: slug in PROVIDER_PRESETS,
		};
	}
	return out;
}

/** Upsert a provider entry. Empty apiKey keeps the stored key (write-only). */
export async function putProvider(
	slug: string,
	input: { label?: string; baseUrl?: string; apiKey?: string },
	updatedBy: string | null,
): Promise<{ ok: true } | { ok: false; error: "encryption_not_configured" }> {
	const all = await getStoredProviders();
	const prev = all[slug];
	let apiKeyEncrypted = prev?.apiKeyEncrypted;
	if (input.apiKey) {
		if (!isSecretsConfigured()) return { ok: false, error: "encryption_not_configured" };
		apiKeyEncrypted = encryptSecret(input.apiKey);
	}
	all[slug] = {
		label: input.label ?? prev?.label ?? PROVIDER_PRESETS[slug]?.label ?? slug,
		baseUrl: input.baseUrl ?? prev?.baseUrl ?? "",
		...(apiKeyEncrypted ? { apiKeyEncrypted } : {}),
	};
	await setSetting(AI_PROVIDERS_SETTING_KEY, all, updatedBy);
	return { ok: true };
}

/** A model on this provider can actually run: stored key, or local endpoint. */
export async function hasUsableKey(slug: string): Promise<boolean> {
	const stored = (await getStoredProviders())[slug];
	if (stored?.apiKeyEncrypted) return true;
	const baseUrl = stored?.baseUrl || PROVIDER_PRESETS[slug]?.baseUrl || "";
	return isLocalBaseUrl(baseUrl);
}

/** Instantiate the (single) OpenAI-compat provider for a model's credentials. */
export async function createProviderFor(model: AiModel): Promise<LlmProvider | null> {
	const stored = (await getStoredProviders())[model.provider];
	const baseURL = stored?.baseUrl || PROVIDER_PRESETS[model.provider]?.baseUrl || "";
	if (!baseURL) return null;
	let apiKey = "";
	if (stored?.apiKeyEncrypted && isSecretsConfigured()) {
		try {
			apiKey = decryptSecret(stored.apiKeyEncrypted);
		} catch {
			apiKey = "";
		}
	}
	if (!apiKey && !isLocalBaseUrl(baseURL)) return null;
	return new OpenAICompatibleProvider({ baseURL, model: model.providerModelId, apiKey });
}
```

- [ ] **Step 4: Implémenter `settings.ts`**

```ts
import { getSetting, setSetting } from "../../lib/appSettings";

export const AI_SETTINGS_KEY = "ai_settings";

export interface AiSettings {
	/** Micro-USD value of 1 credit — margin analytics only. Default $0.01. */
	creditUsdMicroRate: number;
	/** Hard cap of credits one turn may burn (agentic-loop guard). null = uncapped. */
	maxCreditsPerTurn: number | null;
}

export const DEFAULT_AI_SETTINGS: AiSettings = {
	creditUsdMicroRate: 10_000,
	maxCreditsPerTurn: null,
};

export async function getAiSettings(): Promise<AiSettings> {
	const stored = await getSetting<Partial<AiSettings>>(AI_SETTINGS_KEY);
	return { ...DEFAULT_AI_SETTINGS, ...(stored ?? {}) };
}

export async function putAiSettings(
	patch: Partial<AiSettings>,
	updatedBy: string | null,
): Promise<AiSettings> {
	const next = { ...(await getAiSettings()), ...patch };
	await setSetting(AI_SETTINGS_KEY, next, updatedBy);
	return next;
}
```

- [ ] **Step 5: Vérifier le passage**

Run: `cd backend && bun run test src/modules/ai/providers.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/ai/providers.ts backend/src/modules/ai/settings.ts backend/src/modules/ai/providers.test.ts
git commit -m "feat(backend): ai provider credentials + ai settings"
```

---

### Task 4: Credits — `creditsRepo.ts`

**Files:**
- Create: `backend/src/modules/ai/creditsRepo.ts`
- Test: `backend/src/modules/ai/creditsRepo.test.ts`

**Interfaces:**
- Consumes: table `aiCreditLedger` (Task 1), `networks` (fixtures).
- Produces:
  - `grantCredits(input: { networkId: string; amount: number; note?: string; createdBy?: string | null; reason?: "grant" | "adjustment" }): Promise<{ id: string; balance: number }>`
  - `getBalance(networkId: string): Promise<number>`
  - `listLedger(networkId: string, limit?: number): Promise<LedgerEntry[]>` avec `interface LedgerEntry { id; networkId; delta; reason; usageLogId: string | null; note: string | null; createdBy: string | null; createdAt: Date }`
  - (Le débit transactionnel lié à un usage_log arrive au plan 2 — `recordDebitedTurn` dans `usageRepo.ts`.)

- [ ] **Step 1: Écrire les tests**

`backend/src/modules/ai/creditsRepo.test.ts` :

```ts
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../../db/index";
import { aiCreditLedger, networks } from "../../db/schema";
import { createNetwork } from "../../lib/networkManager";
import { getBalance, grantCredits, listLedger } from "./creditsRepo";

let networkId = "";

beforeAll(async () => {
	networkId = (await createNetwork("credits-test-network")).id;
});

afterAll(async () => {
	await db.delete(aiCreditLedger).where(eq(aiCreditLedger.networkId, networkId));
	await db.delete(networks).where(eq(networks.id, networkId));
});

describe("creditsRepo", () => {
	it("balance is 0 for a never-granted network", async () => {
		expect(await getBalance(networkId)).toBe(0);
	});

	it("grant → balance = sum of deltas; ledger lists newest first", async () => {
		await grantCredits({ networkId, amount: 500, note: "welcome" });
		await grantCredits({ networkId, amount: 200 });
		expect(await getBalance(networkId)).toBe(700);
		const ledger = await listLedger(networkId);
		expect(ledger.length).toBe(2);
		expect(ledger[0].delta).toBe(200);
		expect(ledger[1].note).toBe("welcome");
	});
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `cd backend && bun run test src/modules/ai/creditsRepo.test.ts`
Expected: FAIL — `Cannot find module './creditsRepo'`.

- [ ] **Step 3: Implémenter `creditsRepo.ts`**

```ts
import { desc, eq, sql } from "drizzle-orm";
import { db } from "../../db/index";
import { aiCreditLedger } from "../../db/schema";

export interface LedgerEntry {
	id: string;
	networkId: string;
	delta: number;
	reason: string;
	usageLogId: string | null;
	note: string | null;
	createdBy: string | null;
	createdAt: Date;
}

export async function getBalance(networkId: string): Promise<number> {
	const rows = await db
		.select({ balance: sql<number>`coalesce(sum(${aiCreditLedger.delta}), 0)::int` })
		.from(aiCreditLedger)
		.where(eq(aiCreditLedger.networkId, networkId));
	return rows[0]?.balance ?? 0;
}

export async function grantCredits(input: {
	networkId: string;
	amount: number;
	note?: string;
	createdBy?: string | null;
	reason?: "grant" | "adjustment";
}): Promise<{ id: string; balance: number }> {
	const id = crypto.randomUUID();
	await db.insert(aiCreditLedger).values({
		id,
		networkId: input.networkId,
		delta: input.amount,
		reason: input.reason ?? "grant",
		note: input.note ?? null,
		createdBy: input.createdBy ?? null,
		createdAt: new Date(),
	});
	return { id, balance: await getBalance(input.networkId) };
}

export async function listLedger(networkId: string, limit = 50): Promise<LedgerEntry[]> {
	return db
		.select()
		.from(aiCreditLedger)
		.where(eq(aiCreditLedger.networkId, networkId))
		.orderBy(desc(aiCreditLedger.createdAt), desc(aiCreditLedger.id))
		.limit(limit);
}
```

- [ ] **Step 4: Vérifier le passage**

Run: `cd backend && bun run test src/modules/ai/creditsRepo.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/ai/creditsRepo.ts backend/src/modules/ai/creditsRepo.test.ts
git commit -m "feat(backend): ai credit ledger (grant/balance)"
```

---

### Task 5: Routes admin — CRUD modèles + défaut

**Files:**
- Create: `backend/src/modules/ai/adminRoutes.ts`
- Modify: `backend/src/app.ts` (monter le router, ligne ~60)
- Test: `backend/src/modules/ai/adminRoutes.models.test.ts`

**Interfaces:**
- Consumes: Task 2 (`modelRepo`), Task 3 (`hasUsableKey`), `requireAdmin` déjà appliqué par `app.ts` sur `/api/v1/admin/*`.
- Produces:
  - `buildAiAdminRouter(): Hono` — sous-chemins `/ai/models*` (ce task), `/ai/providers*` + `/ai/settings` (Task 6), `/ai/models/:id/test` (Task 7), `/ai/credits/grant` (Task 8).
  - DTO JSON `AiModelDto` = `AiModel` avec `createdAt`/`updatedAt` en ISO string — consommé par le plan 3 (UI admin).
  - Corps POST/PUT modèle : `{ displayName, description, badge, provider, providerModelId, creditsPerMInput, creditsPerMOutput, realUsdPerMInput, realUsdPerMOutput, isActive }`.

- [ ] **Step 1: Écrire les tests**

`backend/src/modules/ai/adminRoutes.models.test.ts` (fixtures admin/plain : même pattern que `assistant/adminRoutes.test.ts`) :

```ts
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { app } from "../../app";
import { db } from "../../db/index";
import { aiModels, appSettings, users } from "../../db/schema";
import { createSession } from "../../lib/sessionManager";
import { createModel, getModel, setDefaultModel } from "./modelRepo";
import { AI_PROVIDERS_SETTING_KEY, putProvider } from "./providers";

const ADMIN_ID = "user_admin_aimodels";
const PLAIN_ID = "user_plain_aimodels";
let adminSession = "";
let plainSession = "";

const validBody = {
	displayName: "Sonnet 5",
	description: "Balanced default",
	badge: "balanced" as const, // literal, sinon TS widen en string ≠ AiBadge
	provider: "anthropic",
	providerModelId: "claude-sonnet-5",
	creditsPerMInput: 30,
	creditsPerMOutput: 150,
	realUsdPerMInput: 3_000_000,
	realUsdPerMOutput: 15_000_000,
	isActive: true,
};

beforeAll(async () => {
	process.env.CONFIG_ENC_KEY = "0".repeat(64);
	const now = new Date();
	await db.insert(users).values({ id: ADMIN_ID, email: `${ADMIN_ID}@example.com`, name: "Admin", isAdmin: true, createdAt: now, updatedAt: now }).onConflictDoNothing();
	await db.insert(users).values({ id: PLAIN_ID, email: `${PLAIN_ID}@example.com`, name: "Plain", isAdmin: false, createdAt: now, updatedAt: now }).onConflictDoNothing();
	adminSession = (await createSession(ADMIN_ID)).id;
	plainSession = (await createSession(PLAIN_ID)).id;
	await putProvider("anthropic", { apiKey: "sk-ant-test" }, null);
});

afterEach(async () => {
	await db.delete(aiModels);
});

afterAll(async () => {
	await db.delete(appSettings).where(eq(appSettings.key, AI_PROVIDERS_SETTING_KEY));
	await db.delete(users).where(eq(users.id, ADMIN_ID));
	await db.delete(users).where(eq(users.id, PLAIN_ID));
});

const adminHeaders = () => ({ Cookie: `artisan_user_session=${adminSession}`, "Content-Type": "application/json" });

describe("admin ai models routes", () => {
	it("403 without admin", async () => {
		const anon = await app.request("/api/v1/admin/ai/models");
		expect(anon.status).toBe(403);
		const plain = await app.request("/api/v1/admin/ai/models", {
			headers: { Cookie: `artisan_user_session=${plainSession}` },
		});
		expect(plain.status).toBe(403);
	});

	it("POST creates; GET lists; dates are ISO strings", async () => {
		const post = await app.request("/api/v1/admin/ai/models", {
			method: "POST", headers: adminHeaders(), body: JSON.stringify(validBody),
		});
		expect(post.status).toBe(200);
		const created = await post.json();
		expect(created.id).toBeDefined();
		expect(created.isDefault).toBe(false);
		const list = await (await app.request("/api/v1/admin/ai/models", { headers: adminHeaders() })).json();
		expect(list.models.length).toBe(1);
		expect(typeof list.models[0].createdAt).toBe("string");
	});

	it("POST validates: bad badge → 400; missing displayName → 400", async () => {
		const bad = await app.request("/api/v1/admin/ai/models", {
			method: "POST", headers: adminHeaders(),
			body: JSON.stringify({ ...validBody, badge: "ultra" }),
		});
		expect(bad.status).toBe(400);
		const noName = await app.request("/api/v1/admin/ai/models", {
			method: "POST", headers: adminHeaders(),
			body: JSON.stringify({ ...validBody, displayName: "" }),
		});
		expect(noName.status).toBe(400);
	});

	it("activation requires a usable provider key → 400 provider_key_missing", async () => {
		const res = await app.request("/api/v1/admin/ai/models", {
			method: "POST", headers: adminHeaders(),
			body: JSON.stringify({ ...validBody, provider: "deepseek" }), // no key stored
		});
		expect(res.status).toBe(400);
		expect((await res.json()).error).toBe("provider_key_missing");
		// Inactive creation is allowed without a key.
		const inactive = await app.request("/api/v1/admin/ai/models", {
			method: "POST", headers: adminHeaders(),
			body: JSON.stringify({ ...validBody, provider: "deepseek", isActive: false }),
		});
		expect(inactive.status).toBe(200);
	});

	it("PUT /:id patches; PUT /:id/default enforces single active default", async () => {
		const a = await createModel({ ...validBody, displayName: "A" });
		const b = await createModel({ ...validBody, displayName: "B" });
		await setDefaultModel(a.id);
		const setB = await app.request(`/api/v1/admin/ai/models/${b.id}/default`, {
			method: "PUT", headers: adminHeaders(),
		});
		expect(setB.status).toBe(200);
		expect((await getModel(a.id))?.isDefault).toBe(false);
		expect((await getModel(b.id))?.isDefault).toBe(true);
		// Default must be active.
		const inactive = await createModel({ ...validBody, displayName: "C", isActive: false });
		const setC = await app.request(`/api/v1/admin/ai/models/${inactive.id}/default`, {
			method: "PUT", headers: adminHeaders(),
		});
		expect(setC.status).toBe(400);
		expect((await setC.json()).error).toBe("model_inactive");
	});

	it("no DELETE route (deactivation only)", async () => {
		const m = await createModel(validBody);
		const del = await app.request(`/api/v1/admin/ai/models/${m.id}`, {
			method: "DELETE", headers: adminHeaders(),
		});
		expect(del.status).toBe(404);
	});
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `cd backend && bun run test src/modules/ai/adminRoutes.models.test.ts`
Expected: FAIL — 404 sur `/api/v1/admin/ai/models` (router pas monté).

- [ ] **Step 3: Implémenter `adminRoutes.ts` (partie modèles)**

```ts
import { Hono } from "hono";
import {
	AI_BADGES,
	createModel,
	getModel,
	listModels,
	setDefaultModel,
	updateModel,
	type AiBadge,
	type AiModel,
	type AiModelInput,
} from "./modelRepo";
import { hasUsableKey } from "./providers";

function toDto(m: AiModel) {
	return { ...m, createdAt: m.createdAt.toISOString(), updatedAt: m.updatedAt.toISOString() };
}

/** null si invalide. `partial` autorise les champs manquants (PUT patch). */
function parseModelBody(
	body: Record<string, unknown>,
	partial: boolean,
): Partial<AiModelInput> | null {
	const out: Partial<AiModelInput> = {};
	const str = (k: string) => (typeof body[k] === "string" ? (body[k] as string) : undefined);
	const int = (k: string) =>
		typeof body[k] === "number" && Number.isInteger(body[k]) && (body[k] as number) >= 0
			? (body[k] as number)
			: undefined;
	const strFields = ["displayName", "description", "provider", "providerModelId"] as const;
	for (const k of strFields) {
		const v = str(k);
		if (v !== undefined) (out as Record<string, unknown>)[k] = v;
	}
	const intFields = ["creditsPerMInput", "creditsPerMOutput", "realUsdPerMInput", "realUsdPerMOutput"] as const;
	for (const k of intFields) {
		const v = int(k);
		if (v !== undefined) (out as Record<string, unknown>)[k] = v;
	}
	if (typeof body.badge === "string") {
		if (!AI_BADGES.includes(body.badge as AiBadge)) return null;
		out.badge = body.badge as AiBadge;
	}
	if (typeof body.isActive === "boolean") out.isActive = body.isActive;
	if (!partial) {
		if (!out.displayName || !out.provider || !out.providerModelId || !out.badge) return null;
		for (const k of intFields) if (out[k] === undefined) return null;
		out.description ??= "";
		out.isActive ??= true;
	}
	if (out.displayName === "") return null;
	return out;
}

export function buildAiAdminRouter(): Hono {
	const r = new Hono();

	r.get("/ai/models", async (c) => {
		return c.json({ models: (await listModels()).map(toDto) });
	});

	r.post("/ai/models", async (c) => {
		const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
		const input = parseModelBody(body, false);
		if (!input) return c.json({ error: "invalid_model" }, 400);
		if (input.isActive && !(await hasUsableKey(input.provider as string)))
			return c.json({ error: "provider_key_missing" }, 400);
		const m = await createModel(input as AiModelInput);
		return c.json(toDto(m));
	});

	r.get("/ai/models/:id", async (c) => {
		const m = await getModel(c.req.param("id"));
		return m ? c.json(toDto(m)) : c.json({ error: "not_found" }, 404);
	});

	r.put("/ai/models/:id", async (c) => {
		const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
		const patch = parseModelBody(body, true);
		if (!patch) return c.json({ error: "invalid_model" }, 400);
		const existing = await getModel(c.req.param("id"));
		if (!existing) return c.json({ error: "not_found" }, 404);
		const willBeActive = patch.isActive ?? existing.isActive;
		const provider = (patch.provider as string) ?? existing.provider;
		if (willBeActive && !(await hasUsableKey(provider)))
			return c.json({ error: "provider_key_missing" }, 400);
		const m = await updateModel(existing.id, patch);
		return c.json(toDto(m as AiModel));
	});

	r.put("/ai/models/:id/default", async (c) => {
		const m = await getModel(c.req.param("id"));
		if (!m) return c.json({ error: "not_found" }, 404);
		if (!m.isActive) return c.json({ error: "model_inactive" }, 400);
		await setDefaultModel(m.id);
		return c.json({ ok: true });
	});

	return r;
}
```

- [ ] **Step 4: Monter dans `app.ts`**

Dans `backend/src/app.ts` :

```ts
import { buildAiAdminRouter } from "./modules/ai/adminRoutes";
```

et après `app.route("/api/v1/admin", buildAdminUsersRouter());` (ligne 60) :

```ts
app.route("/api/v1/admin", buildAiAdminRouter());
```

- [ ] **Step 5: Vérifier le passage**

Run: `cd backend && bun run test src/modules/ai/adminRoutes.models.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/ai/adminRoutes.ts backend/src/modules/ai/adminRoutes.models.test.ts backend/src/app.ts
git commit -m "feat(backend): admin ai model CRUD + single-default routes"
```

---

### Task 6: Routes admin — providers + settings

**Files:**
- Modify: `backend/src/modules/ai/adminRoutes.ts` (ajouter 4 routes dans `buildAiAdminRouter`)
- Test: `backend/src/modules/ai/adminRoutes.providers.test.ts`

**Interfaces:**
- Consumes: Task 3 (`listProvidersForAdmin`, `putProvider`, `getAiSettings`, `putAiSettings`).
- Produces (contrat plan 3) :
  - `GET /api/v1/admin/ai/providers` → `{ providers: Record<slug, { label, baseUrl, keySet, preset }> }`
  - `PUT /api/v1/admin/ai/providers/:slug` body `{ label?, baseUrl?, apiKey? }` → `{ ok: true }` | 503 `{ error: "encryption_not_configured" }`
  - `GET /api/v1/admin/ai/settings` → `{ creditUsdMicroRate, maxCreditsPerTurn }`
  - `PUT /api/v1/admin/ai/settings` body partiel → settings mis à jour

- [ ] **Step 1: Écrire les tests**

`backend/src/modules/ai/adminRoutes.providers.test.ts` — mêmes fixtures admin/plain que Task 5 (ids `user_admin_aiprov` / `user_plain_aiprov`, cleanup `appSettings` keys `ai_providers` + `ai_settings` en `afterEach`) :

```ts
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { app } from "../../app";
import { db } from "../../db/index";
import { appSettings, users } from "../../db/schema";
import { createSession } from "../../lib/sessionManager";
import { AI_PROVIDERS_SETTING_KEY } from "./providers";
import { AI_SETTINGS_KEY } from "./settings";

const ADMIN_ID = "user_admin_aiprov";
let adminSession = "";

beforeAll(async () => {
	process.env.CONFIG_ENC_KEY = "0".repeat(64);
	const now = new Date();
	await db.insert(users).values({ id: ADMIN_ID, email: `${ADMIN_ID}@example.com`, name: "Admin", isAdmin: true, createdAt: now, updatedAt: now }).onConflictDoNothing();
	adminSession = (await createSession(ADMIN_ID)).id;
});

afterEach(async () => {
	await db.delete(appSettings).where(eq(appSettings.key, AI_PROVIDERS_SETTING_KEY));
	await db.delete(appSettings).where(eq(appSettings.key, AI_SETTINGS_KEY));
});

afterAll(async () => {
	await db.delete(users).where(eq(users.id, ADMIN_ID));
});

const adminHeaders = () => ({ Cookie: `artisan_user_session=${adminSession}`, "Content-Type": "application/json" });

describe("admin ai providers + settings routes", () => {
	it("GET providers lists presets; PUT stores a key write-only", async () => {
		const before = await (await app.request("/api/v1/admin/ai/providers", { headers: adminHeaders() })).json();
		expect(before.providers.anthropic.preset).toBe(true);
		expect(before.providers.anthropic.keySet).toBe(false);

		const put = await app.request("/api/v1/admin/ai/providers/anthropic", {
			method: "PUT", headers: adminHeaders(), body: JSON.stringify({ apiKey: "sk-ant-xyz" }),
		});
		expect(put.status).toBe(200);

		const after = await (await app.request("/api/v1/admin/ai/providers", { headers: adminHeaders() })).json();
		expect(after.providers.anthropic.keySet).toBe(true);
		expect(JSON.stringify(after)).not.toContain("sk-ant-xyz");
	});

	it("PUT provider with a key while encryption is unconfigured → 503", async () => {
		const saved = process.env.CONFIG_ENC_KEY;
		delete process.env.CONFIG_ENC_KEY;
		const put = await app.request("/api/v1/admin/ai/providers/openai", {
			method: "PUT", headers: adminHeaders(), body: JSON.stringify({ apiKey: "sk-x" }),
		});
		expect(put.status).toBe(503);
		process.env.CONFIG_ENC_KEY = saved;
	});

	it("settings GET returns defaults; PUT patches", async () => {
		const defaults = await (await app.request("/api/v1/admin/ai/settings", { headers: adminHeaders() })).json();
		expect(defaults.creditUsdMicroRate).toBe(10_000);
		expect(defaults.maxCreditsPerTurn).toBeNull();
		const put = await app.request("/api/v1/admin/ai/settings", {
			method: "PUT", headers: adminHeaders(), body: JSON.stringify({ maxCreditsPerTurn: 80 }),
		});
		expect((await put.json()).maxCreditsPerTurn).toBe(80);
	});
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `cd backend && bun run test src/modules/ai/adminRoutes.providers.test.ts`
Expected: FAIL — 404 sur les nouvelles routes.

- [ ] **Step 3: Ajouter les routes dans `buildAiAdminRouter()`**

Dans `adminRoutes.ts`, ajouter les imports :

```ts
import { listProvidersForAdmin, putProvider } from "./providers";
import { getAiSettings, putAiSettings, type AiSettings } from "./settings";
```

et les routes avant le `return r;` :

```ts
	r.get("/ai/providers", async (c) => {
		return c.json({ providers: await listProvidersForAdmin() });
	});

	r.put("/ai/providers/:slug", async (c) => {
		const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
		const res = await putProvider(
			c.req.param("slug"),
			{
				label: typeof body.label === "string" ? body.label : undefined,
				baseUrl: typeof body.baseUrl === "string" ? body.baseUrl : undefined,
				apiKey: typeof body.apiKey === "string" ? body.apiKey : undefined,
			},
			c.get("user")?.id ?? null,
		);
		if (!res.ok) return c.json({ error: res.error }, 503);
		return c.json({ ok: true });
	});

	r.get("/ai/settings", async (c) => c.json(await getAiSettings()));

	r.put("/ai/settings", async (c) => {
		const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
		const patch: Partial<AiSettings> = {};
		if (typeof body.creditUsdMicroRate === "number" && Number.isInteger(body.creditUsdMicroRate) && body.creditUsdMicroRate >= 0)
			patch.creditUsdMicroRate = body.creditUsdMicroRate;
		if (body.maxCreditsPerTurn === null) patch.maxCreditsPerTurn = null;
		else if (typeof body.maxCreditsPerTurn === "number" && Number.isInteger(body.maxCreditsPerTurn) && body.maxCreditsPerTurn > 0)
			patch.maxCreditsPerTurn = body.maxCreditsPerTurn;
		return c.json(await putAiSettings(patch, c.get("user")?.id ?? null));
	});
```

- [ ] **Step 4: Vérifier le passage**

Run: `cd backend && bun run test src/modules/ai/adminRoutes.providers.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/ai/adminRoutes.ts backend/src/modules/ai/adminRoutes.providers.test.ts
git commit -m "feat(backend): admin ai providers + settings routes"
```

---

### Task 7: Route admin — test live d'un modèle

**Files:**
- Modify: `backend/src/modules/ai/adminRoutes.ts`
- Test: `backend/src/modules/ai/adminRoutes.test-model.test.ts`

**Interfaces:**
- Consumes: `createProviderFor` (Task 3), `computeCreditsCharged`/`computeRealCostMicroUsd`/`sumUsage` (Task 2).
- Produces (contrat plan 3) :
  - `POST /api/v1/admin/ai/models/:id/test` → `{ ok: true, latencyMs, inputTokens, outputTokens, creditsCost, realCostMicroUsd }` | `{ ok: false, error }` (200 dans les deux cas, comme l'existant `assistant-config/test`)
  - Hook de test : `__setAiTestProviderForTests(p: LlmProvider | null)`

- [ ] **Step 1: Écrire les tests**

`backend/src/modules/ai/adminRoutes.test-model.test.ts` — fixtures admin (id `user_admin_aitest`), provider anthropic avec clé, un modèle créé via `createModel` (mêmes valeurs que `validBody` du Task 5), cleanup `aiModels` + `appSettings` :

```ts
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { app } from "../../app";
import { db } from "../../db/index";
import { aiModels, appSettings, users } from "../../db/schema";
import { createSession } from "../../lib/sessionManager";
import { __setAiTestProviderForTests } from "./adminRoutes";
import { createModel } from "./modelRepo";
import { AI_PROVIDERS_SETTING_KEY, putProvider } from "./providers";
import type { LlmProvider } from "../assistant/provider/types";

const ADMIN_ID = "user_admin_aitest";
let adminSession = "";
let modelId = "";

function fakeProvider(): LlmProvider {
	return {
		async *streamTurn() {
			yield { type: "text", text: "OK" };
			yield { type: "usage", usage: { inputTokens: 12, outputTokens: 2 } };
			yield { type: "done", stopReason: "end_turn" };
		},
	};
}

beforeAll(async () => {
	process.env.CONFIG_ENC_KEY = "0".repeat(64);
	const now = new Date();
	await db.insert(users).values({ id: ADMIN_ID, email: `${ADMIN_ID}@example.com`, name: "Admin", isAdmin: true, createdAt: now, updatedAt: now }).onConflictDoNothing();
	adminSession = (await createSession(ADMIN_ID)).id;
	await putProvider("anthropic", { apiKey: "sk-ant-test" }, null);
	modelId = (
		await createModel({
			displayName: "Sonnet 5", description: "", badge: "balanced",
			provider: "anthropic", providerModelId: "claude-sonnet-5",
			creditsPerMInput: 1_000_000, creditsPerMOutput: 1_000_000,
			realUsdPerMInput: 3_000_000, realUsdPerMOutput: 15_000_000, isActive: true,
		})
	).id;
	__setAiTestProviderForTests(fakeProvider());
});

afterAll(async () => {
	__setAiTestProviderForTests(null);
	await db.delete(aiModels);
	await db.delete(appSettings).where(eq(appSettings.key, AI_PROVIDERS_SETTING_KEY));
	await db.delete(users).where(eq(users.id, ADMIN_ID));
});

const adminHeaders = () => ({ Cookie: `artisan_user_session=${adminSession}`, "Content-Type": "application/json" });

describe("admin ai model test route", () => {
	it("returns ok + latency + usage + costs computed at the model's prices", async () => {
		const res = await app.request(`/api/v1/admin/ai/models/${modelId}/test`, {
			method: "POST", headers: adminHeaders(),
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.ok).toBe(true);
		expect(typeof body.latencyMs).toBe("number");
		expect(body.inputTokens).toBe(12);
		expect(body.outputTokens).toBe(2);
		// 1 credit per token at these prices: ceil((12+2)·1M/1M)=14
		expect(body.creditsCost).toBe(14);
	});

	it("unknown model → 404", async () => {
		const res = await app.request("/api/v1/admin/ai/models/nope/test", {
			method: "POST", headers: adminHeaders(),
		});
		expect(res.status).toBe(404);
	});
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `cd backend && bun run test src/modules/ai/adminRoutes.test-model.test.ts`
Expected: FAIL — export `__setAiTestProviderForTests` manquant / 404.

- [ ] **Step 3: Implémenter la route**

Dans `adminRoutes.ts`, ajouter les imports :

```ts
import type { LlmProvider, LlmUsage } from "../assistant/provider/types";
import { computeCreditsCharged, computeRealCostMicroUsd, sumUsage } from "./pricing";
import { createProviderFor } from "./providers";
```

le hook au niveau module :

```ts
let aiTestProvider: LlmProvider | null = null;
/** Test hook: inject a fake provider for POST /ai/models/:id/test. */
export function __setAiTestProviderForTests(p: LlmProvider | null): void {
	aiTestProvider = p;
}
```

et la route :

```ts
	r.post("/ai/models/:id/test", async (c) => {
		const m = await getModel(c.req.param("id"));
		if (!m) return c.json({ error: "not_found" }, 404);
		const provider = aiTestProvider ?? (await createProviderFor(m));
		if (!provider) return c.json({ ok: false, error: "provider_key_missing" });
		const t0 = performance.now();
		const usages: LlmUsage[] = [];
		try {
			let sawDone = false;
			for await (const ev of provider.streamTurn({
				messages: [{ role: "user", content: "Reply with OK." }],
				tools: [],
				model: m.providerModelId,
			})) {
				if (ev.type === "usage") usages.push(ev.usage);
				if (ev.type === "done") sawDone = true;
			}
			const usage = sumUsage(usages);
			return c.json({
				ok: sawDone,
				latencyMs: Math.round(performance.now() - t0),
				inputTokens: usage.inputTokens,
				outputTokens: usage.outputTokens,
				creditsCost: computeCreditsCharged(usage, m),
				realCostMicroUsd: computeRealCostMicroUsd(usage, m),
			});
		} catch (e) {
			return c.json({ ok: false, error: e instanceof Error ? e.message : "error" });
		}
	});
```

- [ ] **Step 4: Vérifier le passage**

Run: `cd backend && bun run test src/modules/ai/adminRoutes.test-model.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/ai/adminRoutes.ts backend/src/modules/ai/adminRoutes.test-model.test.ts
git commit -m "feat(backend): live model test route (latency + usage + cost)"
```

---

### Task 8: Route admin — grant de credits

**Files:**
- Modify: `backend/src/modules/ai/adminRoutes.ts`
- Test: `backend/src/modules/ai/adminRoutes.grant.test.ts`

**Interfaces:**
- Consumes: `grantCredits`/`getBalance` (Task 4), table `networks`.
- Produces (contrat plan 3) : `POST /api/v1/admin/ai/credits/grant` body `{ networkId, amount, note? }` → `{ ok: true, balance }` ; 400 `{ error: "invalid_amount" }` ; 404 `{ error: "network_not_found" }`.

- [ ] **Step 1: Écrire les tests**

`backend/src/modules/ai/adminRoutes.grant.test.ts` — fixtures admin (id `user_admin_aigrant`) + network via `createNetwork("grant-test-network")`, cleanup ledger + network + user :

```ts
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { app } from "../../app";
import { db } from "../../db/index";
import { aiCreditLedger, networks, users } from "../../db/schema";
import { createNetwork } from "../../lib/networkManager";
import { createSession } from "../../lib/sessionManager";
import { getBalance, listLedger } from "./creditsRepo";

const ADMIN_ID = "user_admin_aigrant";
let adminSession = "";
let networkId = "";

beforeAll(async () => {
	const now = new Date();
	await db.insert(users).values({ id: ADMIN_ID, email: `${ADMIN_ID}@example.com`, name: "Admin", isAdmin: true, createdAt: now, updatedAt: now }).onConflictDoNothing();
	adminSession = (await createSession(ADMIN_ID)).id;
	networkId = (await createNetwork("grant-test-network")).id;
});

afterAll(async () => {
	await db.delete(aiCreditLedger).where(eq(aiCreditLedger.networkId, networkId));
	await db.delete(networks).where(eq(networks.id, networkId));
	await db.delete(users).where(eq(users.id, ADMIN_ID));
});

const adminHeaders = () => ({ Cookie: `artisan_user_session=${adminSession}`, "Content-Type": "application/json" });

describe("admin ai credits grant", () => {
	it("grants and returns the new balance; ledger records the admin author", async () => {
		const res = await app.request("/api/v1/admin/ai/credits/grant", {
			method: "POST", headers: adminHeaders(),
			body: JSON.stringify({ networkId, amount: 500, note: "starter" }),
		});
		expect(res.status).toBe(200);
		expect((await res.json())).toEqual({ ok: true, balance: 500 });
		expect(await getBalance(networkId)).toBe(500);
		const [entry] = await listLedger(networkId);
		expect(entry.reason).toBe("grant");
		expect(entry.createdBy).toBe(ADMIN_ID);
	});

	it("rejects non-positive / non-integer amounts", async () => {
		for (const amount of [0, -5, 1.5, "10"]) {
			const res = await app.request("/api/v1/admin/ai/credits/grant", {
				method: "POST", headers: adminHeaders(),
				body: JSON.stringify({ networkId, amount }),
			});
			expect(res.status).toBe(400);
		}
	});

	it("unknown network → 404", async () => {
		const res = await app.request("/api/v1/admin/ai/credits/grant", {
			method: "POST", headers: adminHeaders(),
			body: JSON.stringify({ networkId: "nope", amount: 10 }),
		});
		expect(res.status).toBe(404);
	});
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `cd backend && bun run test src/modules/ai/adminRoutes.grant.test.ts`
Expected: FAIL — 404 route.

- [ ] **Step 3: Implémenter la route**

Dans `adminRoutes.ts`, imports :

```ts
import { eq } from "drizzle-orm";
import { db } from "../../db/index";
import { networks } from "../../db/schema";
import { grantCredits } from "./creditsRepo";
```

Route :

```ts
	r.post("/ai/credits/grant", async (c) => {
		const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
		const networkId = typeof body.networkId === "string" ? body.networkId : "";
		const amount = body.amount;
		if (typeof amount !== "number" || !Number.isInteger(amount) || amount <= 0)
			return c.json({ error: "invalid_amount" }, 400);
		const net = await db.select({ id: networks.id }).from(networks).where(eq(networks.id, networkId));
		if (net.length === 0) return c.json({ error: "network_not_found" }, 404);
		const { balance } = await grantCredits({
			networkId,
			amount,
			note: typeof body.note === "string" ? body.note : undefined,
			createdBy: c.get("user")?.id ?? null,
		});
		return c.json({ ok: true, balance });
	});
```

- [ ] **Step 4: Vérifier le passage**

Run: `cd backend && bun run test src/modules/ai/adminRoutes.grant.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/ai/adminRoutes.ts backend/src/modules/ai/adminRoutes.grant.test.ts
git commit -m "feat(backend): admin credit grant route"
```

---

### Task 9: Seed legacy au boot

**Files:**
- Create: `backend/src/modules/ai/seed.ts`
- Modify: `backend/src/index.ts` (appel au boot, à côté des backfills)
- Test: `backend/src/modules/ai/seed.test.ts`

**Interfaces:**
- Consumes: `listModels`/`createModel`/`setDefaultModel` (Task 2), `getStoredProviders`/`AI_PROVIDERS_SETTING_KEY`/`PROVIDER_PRESETS` (Task 3), legacy `ASSISTANT_SETTING_KEY`/`StoredAssistantConfig` (`../assistant/provider/dbConfig`), `presetBaseUrl` (`../assistant/provider/config`).
- Produces: `seedAiCatalogFromLegacy(): Promise<void>` — idempotent (no-op si le catalogue n'est pas vide OU si aucune config legacy).

- [ ] **Step 1: Écrire les tests**

`backend/src/modules/ai/seed.test.ts` :

```ts
import { afterEach, beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../../db/index";
import { aiModels, appSettings } from "../../db/schema";
import { setSetting } from "../../lib/appSettings";
import { ASSISTANT_SETTING_KEY } from "../assistant/provider/dbConfig";
import { createModel, listModels } from "./modelRepo";
import { AI_PROVIDERS_SETTING_KEY, getStoredProviders } from "./providers";
import { seedAiCatalogFromLegacy } from "./seed";

beforeAll(() => {
	process.env.CONFIG_ENC_KEY = "0".repeat(64);
});

afterEach(async () => {
	await db.delete(aiModels);
	await db.delete(appSettings).where(eq(appSettings.key, ASSISTANT_SETTING_KEY));
	await db.delete(appSettings).where(eq(appSettings.key, AI_PROVIDERS_SETTING_KEY));
	delete process.env.ASSISTANT_PROVIDER;
	delete process.env.ASSISTANT_MODEL;
	delete process.env.ASSISTANT_API_KEY;
	delete process.env.ASSISTANT_BASE_URL;
});

describe("seedAiCatalogFromLegacy", () => {
	it("seeds provider entry + default model from stored legacy config", async () => {
		await setSetting(ASSISTANT_SETTING_KEY, {
			provider: "deepseek", baseUrl: "", model: "deepseek-chat", apiKeyEncrypted: "iv:tag:ct",
		}, null);
		await seedAiCatalogFromLegacy();
		const models = await listModels();
		expect(models.length).toBe(1);
		expect(models[0].providerModelId).toBe("deepseek-chat");
		expect(models[0].provider).toBe("deepseek");
		expect(models[0].isDefault).toBe(true);
		expect(models[0].isActive).toBe(true);
		const providers = await getStoredProviders();
		expect(providers.deepseek.apiKeyEncrypted).toBe("iv:tag:ct");
		expect(providers.deepseek.baseUrl).toContain("deepseek");
	});

	it("seeds from env when no stored config", async () => {
		process.env.ASSISTANT_PROVIDER = "openai";
		process.env.ASSISTANT_MODEL = "gpt-4.1-mini";
		process.env.ASSISTANT_API_KEY = "sk-env-key";
		await seedAiCatalogFromLegacy();
		const models = await listModels();
		expect(models.length).toBe(1);
		expect(models[0].providerModelId).toBe("gpt-4.1-mini");
		const providers = await getStoredProviders();
		expect(providers.openai.apiKeyEncrypted).toBeDefined();
		expect(JSON.stringify(providers)).not.toContain("sk-env-key");
	});

	it("no-op when the catalog already has a model", async () => {
		await createModel({
			displayName: "Existing", description: "", badge: "cheap", provider: "openai",
			providerModelId: "x", creditsPerMInput: 1, creditsPerMOutput: 1,
			realUsdPerMInput: 0, realUsdPerMOutput: 0, isActive: true,
		});
		await setSetting(ASSISTANT_SETTING_KEY, { provider: "openai", model: "gpt-4.1-mini" }, null);
		await seedAiCatalogFromLegacy();
		expect((await listModels()).length).toBe(1);
	});

	it("no-op when there is nothing to seed", async () => {
		await seedAiCatalogFromLegacy();
		expect((await listModels()).length).toBe(0);
	});
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `cd backend && bun run test src/modules/ai/seed.test.ts`
Expected: FAIL — `Cannot find module './seed'`.

- [ ] **Step 3: Implémenter `seed.ts`**

```ts
import { getSetting, setSetting } from "../../lib/appSettings";
import { encryptSecret, isSecretsConfigured } from "../../lib/secretBox";
import { presetBaseUrl } from "../assistant/provider/config";
import { ASSISTANT_SETTING_KEY, type StoredAssistantConfig } from "../assistant/provider/dbConfig";
import { createModel, listModels, setDefaultModel } from "./modelRepo";
import { AI_PROVIDERS_SETTING_KEY, getStoredProviders, PROVIDER_PRESETS } from "./providers";

/**
 * One-shot migration of the pre-catalog assistant config (single global model in
 * app_settings.assistant, or ASSISTANT_* env) into the ai_models catalog.
 * Runs at boot; no-op once the catalog has any model. Prices are seeded at 0 —
 * the admin fills them in (debits stay 0 until then, and networks without a
 * grant are blocked anyway).
 */
export async function seedAiCatalogFromLegacy(): Promise<void> {
	if ((await listModels()).length > 0) return;

	const stored = await getSetting<StoredAssistantConfig>(ASSISTANT_SETTING_KEY);
	const slug = stored?.provider ?? process.env.ASSISTANT_PROVIDER ?? "openai";
	const modelId = stored?.model || process.env.ASSISTANT_MODEL || "";
	if (!modelId) return;
	const baseUrl =
		stored?.baseUrl ||
		process.env.ASSISTANT_BASE_URL ||
		PROVIDER_PRESETS[slug]?.baseUrl ||
		presetBaseUrl(slug);
	let apiKeyEncrypted = stored?.apiKeyEncrypted;
	if (!apiKeyEncrypted && process.env.ASSISTANT_API_KEY && isSecretsConfigured()) {
		apiKeyEncrypted = encryptSecret(process.env.ASSISTANT_API_KEY);
	}

	const providers = await getStoredProviders();
	if (!providers[slug]) {
		providers[slug] = {
			label: PROVIDER_PRESETS[slug]?.label ?? slug,
			baseUrl,
			...(apiKeyEncrypted ? { apiKeyEncrypted } : {}),
		};
		await setSetting(AI_PROVIDERS_SETTING_KEY, providers, null);
	}

	const m = await createModel({
		displayName: modelId,
		description: "",
		badge: "balanced",
		provider: slug,
		providerModelId: modelId,
		creditsPerMInput: 0,
		creditsPerMOutput: 0,
		realUsdPerMInput: 0,
		realUsdPerMOutput: 0,
		isActive: true,
	});
	await setDefaultModel(m.id);
	console.log(`[ai] seeded model catalog from legacy assistant config (${slug}/${modelId})`);
}
```

- [ ] **Step 4: Wire au boot**

Dans `backend/src/index.ts`, ajouter l'import :

```ts
import { seedAiCatalogFromLegacy } from "./modules/ai/seed";
```

et après l'appel `backfillSlugs()` :

```ts
seedAiCatalogFromLegacy().catch((err) => console.error("[ai] legacy seed failed:", err));
```

- [ ] **Step 5: Vérifier le passage + suite complète**

Run: `cd backend && bun run test src/modules/ai/seed.test.ts`
Expected: PASS.
Run: `cd backend && bun run test`
Expected: PASS — toute la suite (aucun test existant modifié par ce plan).

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/ai/seed.ts backend/src/modules/ai/seed.test.ts backend/src/index.ts
git commit -m "feat(backend): seed ai catalog from legacy assistant config at boot"
```

---

### Task 10: Docs — rest-endpoints + CHANGELOG

**Files:**
- Modify: `docs/architecture/rest-endpoints.md` (index des routes admin `ai`)
- Modify: `CHANGELOG.md` (`[Unreleased]`)

- [ ] **Step 1: rest-endpoints.md**

Ajouter dans l'index (suivre le format existant du fichier — une ligne par groupe de routes pointant le fichier source) :

```markdown
| `/api/v1/admin/ai/models*`, `/api/v1/admin/ai/providers*`, `/api/v1/admin/ai/settings`, `/api/v1/admin/ai/credits/grant` | Catalogue de modèles IA (CRUD + défaut unique + test live), credentials providers (write-only), settings credits, grant admin | `backend/src/modules/ai/adminRoutes.ts` |
```

- [ ] **Step 2: CHANGELOG**

Sous `[Unreleased]` → `### Added` :

```markdown
- Admin AI model catalog: `GET/POST/PUT /api/v1/admin/ai/models`, `PUT /api/v1/admin/ai/models/:id/default`, `POST /api/v1/admin/ai/models/:id/test`, `GET/PUT /api/v1/admin/ai/providers[/:slug]`, `GET/PUT /api/v1/admin/ai/settings`, `POST /api/v1/admin/ai/credits/grant`. New tables `ai_models`, `ai_usage_log`, `ai_credit_ledger` (spec 2026-07-02).
```

- [ ] **Step 3: Commit**

```bash
git add docs/architecture/rest-endpoints.md CHANGELOG.md
git commit -m "docs: ai model catalog admin routes + schema in rest-endpoints/CHANGELOG"
```
