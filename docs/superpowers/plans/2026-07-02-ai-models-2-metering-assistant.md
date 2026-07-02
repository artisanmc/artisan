# AI Models — Plan 2/4 : Métering, intégration assistant, routes user, analytics

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chaque tour d'assistant est métré et débité (usage_log + ledger transactionnels, SSE `credits`, refus à solde ≤ 0, pas de débit sur erreur provider), le user choisit son modèle (`modelId` par message, routes `/api/v1/ai/*`), l'admin lit les analytics (summary, logs + CSV, focus user).

**Architecture:** Dépend du plan 1 (`2026-07-02-ai-models-1-backend-core.md` — module `ai` : modelRepo, pricing, providers, creditsRepo, settings, routes admin). Ce plan branche le module `assistant` sur le module `ai` (spec `docs/superpowers/specs/2026-07-02-ai-model-system-design.md`). Les routes legacy `assistant-config` + `dbConfig.ts` restent en place — leur suppression arrive au plan 3 avec le remplacement de l'UI admin.

**Tech Stack:** Bun + Hono (streamSSE) + Drizzle. Tests `bun:test` via `bun run test` (JAMAIS `bun test` direct).

## Global Constraints

- Règles §4 du cahier des charges : solde ≤ 0 → **402** `{ error: "insufficient_credits" }` sans tour ; erreur provider → `ai_usage_log.status='error'`, **aucun débit** ; `maxCreditsPerTurn` coupe la boucle proprement (le consommé est débité).
- Le **network** du project de la conversation porte le débit (`projects.networkId`).
- Usage log : snapshots modèle + `prompt_preview` tronqué à 200 chars — jamais plus de contenu.
- Débit et usage_log dans **une transaction**.
- Tout endpoint sous `/api/v1/` ; user routes = dual-auth (`sk:`/`user:` — même middleware que l'assistant).
- Commits conventional ; `cd backend && bun run test` avant chaque commit.

---

### Task 1: `usageRepo.ts` — enregistrement transactionnel des tours

**Files:**
- Create: `backend/src/modules/ai/usageRepo.ts`
- Test: `backend/src/modules/ai/usageRepo.test.ts`

**Interfaces:**
- Consumes: tables `aiUsageLog`/`aiCreditLedger`, `AiModel` + `computeCreditsCharged`/`computeRealCostMicroUsd` (plan 1), `getBalance` (plan 1).
- Produces:
  - `interface UsageInput { networkId: string; userId?: string | null; serverKeyId?: string | null; model: AiModel; actionType?: string; conversationId?: string | null; usage: LlmUsage; durationMs?: number | null; promptPreview: string }`
  - `recordDebitedTurn(input: UsageInput): Promise<{ usageLogId: string; debited: number; balance: number }>` — usage_log `status='success'` + row ledger `reason='debit'` (sautée si 0 credit) en une transaction.
  - `recordErrorTurn(input: UsageInput & { errorMessage: string }): Promise<string>` — usage_log `status='error'`, `creditsCharged=0`, jamais de ledger.

- [ ] **Step 1: Écrire les tests**

`backend/src/modules/ai/usageRepo.test.ts` :

```ts
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../../db/index";
import { aiCreditLedger, aiModels, aiUsageLog, networks } from "../../db/schema";
import { createNetwork } from "../../lib/networkManager";
import { getBalance, grantCredits } from "./creditsRepo";
import { createModel, type AiModel } from "./modelRepo";
import { recordDebitedTurn, recordErrorTurn } from "./usageRepo";

let networkId = "";
let model: AiModel;

beforeAll(async () => {
	networkId = (await createNetwork("usage-test-network")).id;
	model = await createModel({
		displayName: "Meter Test", description: "", badge: "balanced",
		provider: "openai", providerModelId: "gpt-meter",
		creditsPerMInput: 1000, creditsPerMOutput: 2000,
		realUsdPerMInput: 3_000_000, realUsdPerMOutput: 15_000_000, isActive: true,
	});
	await grantCredits({ networkId, amount: 1000 });
});

afterAll(async () => {
	await db.delete(aiUsageLog).where(eq(aiUsageLog.networkId, networkId));
	await db.delete(aiCreditLedger).where(eq(aiCreditLedger.networkId, networkId));
	await db.delete(networks).where(eq(networks.id, networkId));
	await db.delete(aiModels).where(eq(aiModels.id, model.id));
});

describe("recordDebitedTurn", () => {
	it("writes usage log + linked ledger debit; balance drops", async () => {
		const res = await recordDebitedTurn({
			networkId, userId: null, serverKeyId: null, model,
			conversationId: "conv1",
			usage: { inputTokens: 500_000, outputTokens: 100_000, cachedInputTokens: 50_000 },
			durationMs: 1234,
			promptPreview: "x".repeat(500), // must be truncated to 200
		});
		expect(res.debited).toBe(700); // ceil((500k·1000 + 100k·2000)/1M)
		expect(res.balance).toBe(300);
		const [log] = await db.select().from(aiUsageLog).where(eq(aiUsageLog.id, res.usageLogId));
		expect(log.status).toBe("success");
		expect(log.creditsCharged).toBe(700);
		expect(log.modelName).toBe("Meter Test"); // snapshot
		expect(log.cachedInputTokens).toBe(50_000);
		expect(log.promptPreview.length).toBe(200);
		const [debit] = await db.select().from(aiCreditLedger)
			.where(eq(aiCreditLedger.usageLogId, res.usageLogId));
		expect(debit.delta).toBe(-700);
		expect(debit.reason).toBe("debit");
	});

	it("zero usage → usage log but NO ledger row", async () => {
		const before = await getBalance(networkId);
		const res = await recordDebitedTurn({
			networkId, model, usage: { inputTokens: 0, outputTokens: 0 }, promptPreview: "",
		});
		expect(res.debited).toBe(0);
		expect(res.balance).toBe(before);
		const rows = await db.select().from(aiCreditLedger)
			.where(eq(aiCreditLedger.usageLogId, res.usageLogId));
		expect(rows.length).toBe(0);
	});
});

describe("recordErrorTurn", () => {
	it("logs consumed tokens with status=error and never debits", async () => {
		const before = await getBalance(networkId);
		const id = await recordErrorTurn({
			networkId, model, usage: { inputTokens: 9000, outputTokens: 10 },
			promptPreview: "boom", errorMessage: "provider exploded",
		});
		const [log] = await db.select().from(aiUsageLog).where(eq(aiUsageLog.id, id));
		expect(log.status).toBe("error");
		expect(log.errorMessage).toBe("provider exploded");
		expect(log.inputTokens).toBe(9000);
		expect(log.creditsCharged).toBe(0);
		expect(await getBalance(networkId)).toBe(before);
	});
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `cd backend && bun run test src/modules/ai/usageRepo.test.ts`
Expected: FAIL — `Cannot find module './usageRepo'`.

- [ ] **Step 3: Implémenter `usageRepo.ts`**

```ts
import { db } from "../../db/index";
import { aiCreditLedger, aiUsageLog } from "../../db/schema";
import type { LlmUsage } from "../assistant/provider/types";
import { getBalance } from "./creditsRepo";
import type { AiModel } from "./modelRepo";
import { computeCreditsCharged, computeRealCostMicroUsd } from "./pricing";

export interface UsageInput {
	networkId: string;
	userId?: string | null;
	serverKeyId?: string | null;
	model: AiModel;
	actionType?: string;
	conversationId?: string | null;
	usage: LlmUsage;
	durationMs?: number | null;
	promptPreview: string;
}

function baseRow(input: UsageInput, id: string, now: Date) {
	return {
		id,
		networkId: input.networkId,
		userId: input.userId ?? null,
		serverKeyId: input.serverKeyId ?? null,
		modelId: input.model.id,
		modelName: input.model.displayName,
		provider: input.model.provider,
		providerModelId: input.model.providerModelId,
		actionType: input.actionType ?? "chat",
		conversationId: input.conversationId ?? null,
		inputTokens: input.usage.inputTokens,
		outputTokens: input.usage.outputTokens,
		cachedInputTokens: input.usage.cachedInputTokens ?? 0,
		realCostMicroUsd: computeRealCostMicroUsd(input.usage, input.model),
		durationMs: input.durationMs ?? null,
		promptPreview: input.promptPreview.slice(0, 200),
		createdAt: now,
	};
}

/** Success turn: usage log + ledger debit, one transaction. */
export async function recordDebitedTurn(
	input: UsageInput,
): Promise<{ usageLogId: string; debited: number; balance: number }> {
	const credits = computeCreditsCharged(input.usage, input.model);
	const id = crypto.randomUUID();
	const now = new Date();
	await db.transaction(async (tx) => {
		await tx.insert(aiUsageLog).values({
			...baseRow(input, id, now),
			creditsCharged: credits,
			status: "success",
		});
		if (credits > 0) {
			await tx.insert(aiCreditLedger).values({
				id: crypto.randomUUID(),
				networkId: input.networkId,
				delta: -credits,
				reason: "debit",
				usageLogId: id,
				createdAt: now,
			});
		}
	});
	return { usageLogId: id, debited: credits, balance: await getBalance(input.networkId) };
}

/** Provider error: consumed tokens logged for admin visibility — NEVER debited. */
export async function recordErrorTurn(
	input: UsageInput & { errorMessage: string },
): Promise<string> {
	const id = crypto.randomUUID();
	await db.insert(aiUsageLog).values({
		...baseRow(input, id, new Date()),
		creditsCharged: 0,
		status: "error",
		errorMessage: input.errorMessage,
	});
	return id;
}
```

- [ ] **Step 4: Vérifier le passage**

Run: `cd backend && bun run test src/modules/ai/usageRepo.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/ai/usageRepo.ts backend/src/modules/ai/usageRepo.test.ts
git commit -m "feat(backend): transactional usage log + credit debit"
```

---

### Task 2: Intégration du tour d'assistant (pre-check, modelId, débit, SSE `credits`)

**Files:**
- Modify: `backend/src/modules/assistant/routes.ts`
- Modify: `backend/src/modules/assistant/routes.test.ts` (fixtures)
- Test: `backend/src/modules/assistant/creditsIntegration.test.ts` (nouveau)

**Interfaces:**
- Consumes: `resolveModel`, `createProviderFor`, `getBalance`, `getAiSettings`, `computeCreditsCharged`/`sumUsage`, `recordDebitedTurn`/`recordErrorTurn` (module `ai`), table `projects`.
- Produces (contrat plans 3-4) :
  - `POST /api/v1/assistant/conversations/:id/messages` accepte `modelId?: string` dans le body.
  - Réponses : **402** `{ error: "insufficient_credits", balance }` ; **404** `{ error: "project_not_found" }` ; 503 si catalogue/provider inutilisable.
  - Nouvel événement SSE final `credits` : `{ debited: number, balance: number }`.
  - Cap dépassé → événement SSE `error` `{ message: "turn_budget_exceeded" }` puis débit du consommé + `credits`.
  - `__setProviderForTests` inchangé (courtcircuite le provider, PAS la résolution de modèle : le catalogue doit contenir un modèle actif).

- [ ] **Step 1: Mettre à jour les fixtures existantes**

Dans `backend/src/modules/assistant/routes.test.ts` :

Ajouter aux imports :

```ts
import { aiModels, projects } from "../../db/schema";
import { grantCredits } from "../ai/creditsRepo";
import { createModel, setDefaultModel } from "../ai/modelRepo";
```

(et retirer `assistantConversations`/`networks`/etc. de rien — les imports existants restent).

Dans `beforeAll`, après l'insert `editorSessions` :

```ts
	// The turn now debits the network of the conversation's project → the
	// project must exist, the catalog must hold an active default model, and
	// the network needs a positive balance.
	await db
		.insert(projects)
		.values({
			id: PACK_ID,
			networkId,
			serverKeyId: SRV,
			name: "Assistant Test Project",
			hash: "",
			filesJson: "{}",
			createdAt: new Date(),
			updatedAt: new Date(),
		})
		.onConflictDoNothing();
	const testModel = await createModel({
		displayName: "Routes Test Model",
		description: "",
		badge: "balanced",
		provider: "openai",
		providerModelId: "test-model",
		creditsPerMInput: 1000,
		creditsPerMOutput: 2000,
		realUsdPerMInput: 0,
		realUsdPerMOutput: 0,
		isActive: true,
	});
	await setDefaultModel(testModel.id);
	await grantCredits({ networkId, amount: 100_000 });
```

Dans `afterAll`, avant le delete `networks` (le network cascade projects/usage/ledger) :

```ts
	await db.delete(aiModels);
```

- [ ] **Step 2: Lancer les tests existants pour observer l'état**

Run: `cd backend && bun run test src/modules/assistant/routes.test.ts`
Expected: PASS encore (le code n'a pas changé — les fixtures sont additives).

- [ ] **Step 3: Écrire les tests d'intégration credits**

`backend/src/modules/assistant/creditsIntegration.test.ts` :

```ts
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { app } from "../../app";
import { db } from "../../db/index";
import {
	aiCreditLedger,
	aiModels,
	aiUsageLog,
	appSettings,
	editorSessions,
	networks,
	projects,
	serverKeys,
} from "../../db/schema";
import { createNetwork } from "../../lib/networkManager";
import { getBalance, grantCredits } from "../ai/creditsRepo";
import { createModel, setDefaultModel, type AiModel } from "../ai/modelRepo";
import { AI_SETTINGS_KEY } from "../ai/settings";
import { setSetting } from "../../lib/appSettings";
import type { LlmProvider } from "./provider/types";
import { __setProviderForTests } from "./routes";

const SRV = "srv_credits_int";
const ACCESS = "acc_credits_int";
const PROJECT_ID = "proj_credits_int";
let networkId = "";
let defaultModel: AiModel;
let altModel: AiModel;

const auth = { Authorization: `Bearer ${ACCESS}`, "Content-Type": "application/json" };

/** Provider whose turn emits usage worth exactly 700 credits at the default prices. */
function usageProvider(): LlmProvider {
	return {
		async *streamTurn() {
			yield { type: "text", text: "done" };
			yield { type: "usage", usage: { inputTokens: 500_000, outputTokens: 100_000 } };
			yield { type: "done", stopReason: "end_turn" };
		},
	};
}

function throwingProvider(): LlmProvider {
	return {
		async *streamTurn() {
			yield { type: "usage", usage: { inputTokens: 9000, outputTokens: 0 } };
			throw new Error("provider exploded");
		},
	};
}

async function openConversation(): Promise<string> {
	const created = await app.request("/api/v1/assistant/conversations", {
		method: "POST", headers: auth, body: JSON.stringify({ packId: PROJECT_ID }),
	});
	return (await created.json()).conversationId;
}

function sendMessage(convId: string, body: Record<string, unknown>) {
	return app.request(`/api/v1/assistant/conversations/${convId}/messages`, {
		method: "POST", headers: auth, body: JSON.stringify(body),
	});
}

beforeAll(async () => {
	networkId = (await createNetwork("credits-int-network")).id;
	const now = new Date();
	const future = new Date(Date.now() + 3_600_000);
	await db.insert(serverKeys).values({ id: SRV, hash: "h_credits_int", networkId, createdAt: now }).onConflictDoNothing();
	await db.insert(editorSessions).values({
		token: "url_credits_int", serverKeyId: SRV, createdBy: "CONSOLE",
		createdAt: now, expiresAt: future, accessToken: ACCESS, accessExpiresAt: future,
	}).onConflictDoNothing();
	await db.insert(projects).values({
		id: PROJECT_ID, networkId, serverKeyId: SRV, name: "Credits Int",
		hash: "", filesJson: "{}", createdAt: now, updatedAt: now,
	}).onConflictDoNothing();
	defaultModel = await createModel({
		displayName: "Default Int", description: "", badge: "balanced",
		provider: "openai", providerModelId: "default-int",
		creditsPerMInput: 1000, creditsPerMOutput: 2000,
		realUsdPerMInput: 0, realUsdPerMOutput: 0, isActive: true,
	});
	altModel = await createModel({
		displayName: "Alt Int", description: "", badge: "cheap",
		provider: "openai", providerModelId: "alt-int",
		creditsPerMInput: 10, creditsPerMOutput: 20,
		realUsdPerMInput: 0, realUsdPerMOutput: 0, isActive: true,
	});
	await setDefaultModel(defaultModel.id);
	__setProviderForTests(usageProvider());
});

afterAll(async () => {
	__setProviderForTests(null);
	await db.delete(appSettings).where(eq(appSettings.key, AI_SETTINGS_KEY));
	await db.delete(aiModels);
	await db.delete(editorSessions).where(eq(editorSessions.token, "url_credits_int"));
	await db.delete(networks).where(eq(networks.id, networkId)); // cascades serverKeys, projects, usage, ledger
});

describe("assistant credits integration", () => {
	it("zero balance → 402 insufficient_credits, no turn, no usage row", async () => {
		const convId = await openConversation();
		const res = await sendMessage(convId, { text: "hi" });
		expect(res.status).toBe(402);
		expect((await res.json()).error).toBe("insufficient_credits");
		const rows = await db.select().from(aiUsageLog).where(eq(aiUsageLog.networkId, networkId));
		expect(rows.length).toBe(0);
	});

	it("successful turn: usage log + ledger debit + SSE credits event", async () => {
		await grantCredits({ networkId, amount: 1000 });
		const convId = await openConversation();
		const res = await sendMessage(convId, { text: "make something" });
		expect(res.status).toBe(200);
		const sse = await res.text();
		expect(sse).toContain("event: credits");
		expect(sse).toContain('"debited":700');
		expect(sse).toContain('"balance":300');
		expect(await getBalance(networkId)).toBe(300);
		const [log] = await db.select().from(aiUsageLog).where(eq(aiUsageLog.networkId, networkId));
		expect(log.status).toBe("success");
		expect(log.modelName).toBe("Default Int");
		expect(log.conversationId).toBe(convId);
		expect(log.promptPreview).toBe("make something");
		expect(log.userId).toBeNull();
		expect(log.serverKeyId).toBe(SRV); // sk: session actor
	});

	it("body.modelId picks the requested model (snapshot in the log)", async () => {
		const convId = await openConversation();
		const res = await sendMessage(convId, { text: "cheap please", modelId: altModel.id });
		expect(res.status).toBe(200);
		await res.text();
		const rows = await db.select().from(aiUsageLog).where(eq(aiUsageLog.networkId, networkId));
		const log = rows.find((r) => r.modelName === "Alt Int");
		expect(log).toBeTruthy();
		// alt prices: ceil((500k·10 + 100k·20)/1M) = 7
		expect(log?.creditsCharged).toBe(7);
	});

	it("provider error → status=error, tokens logged, balance untouched", async () => {
		__setProviderForTests(throwingProvider());
		try {
			const before = await getBalance(networkId);
			const convId = await openConversation();
			const res = await sendMessage(convId, { text: "boom" });
			expect(res.status).toBe(200); // SSE already started
			const sse = await res.text();
			expect(sse).toContain("event: error");
			expect(sse).not.toContain("event: credits");
			expect(await getBalance(networkId)).toBe(before);
			const rows = await db.select().from(aiUsageLog).where(eq(aiUsageLog.networkId, networkId));
			const errLog = rows.find((r) => r.status === "error");
			expect(errLog?.inputTokens).toBe(9000);
			expect(errLog?.creditsCharged).toBe(0);
		} finally {
			__setProviderForTests(usageProvider());
		}
	});

	it("maxCreditsPerTurn stops the loop and still debits the consumed usage", async () => {
		await setSetting(AI_SETTINGS_KEY, { creditUsdMicroRate: 10_000, maxCreditsPerTurn: 100 }, null);
		const before = await getBalance(networkId);
		const convId = await openConversation();
		const res = await sendMessage(convId, { text: "expensive" });
		const sse = await res.text();
		expect(sse).toContain("turn_budget_exceeded");
		expect(sse).toContain("event: credits");
		expect(await getBalance(networkId)).toBe(before - 700); // one usage event consumed
	});

	it("unknown project on the conversation → 404 project_not_found", async () => {
		const created = await app.request("/api/v1/assistant/conversations", {
			method: "POST", headers: auth, body: JSON.stringify({ packId: "ghost_project" }),
		});
		const { conversationId } = await created.json();
		const res = await sendMessage(conversationId, { text: "hi" });
		expect(res.status).toBe(404);
		expect((await res.json()).error).toBe("project_not_found");
	});
});
```

- [ ] **Step 4: Vérifier l'échec**

Run: `cd backend && bun run test src/modules/assistant/creditsIntegration.test.ts`
Expected: FAIL — pas de 402, pas d'événement `credits` (l'intégration n'existe pas).

- [ ] **Step 5: Implémenter l'intégration dans `routes.ts`**

Dans `backend/src/modules/assistant/routes.ts` :

**5a — imports.** Supprimer les imports `createProvider` (`./provider/config`) et `loadAssistantProviderConfig` (`./provider/dbConfig`). Ajouter :

```ts
import { eq } from "drizzle-orm";
import { db } from "../../db/index";
import { projects } from "../../db/schema";
import { getBalance } from "../ai/creditsRepo";
import { resolveModel, type AiModel } from "../ai/modelRepo";
import { computeCreditsCharged, sumUsage } from "../ai/pricing";
import { createProviderFor } from "../ai/providers";
import { getAiSettings } from "../ai/settings";
import { recordDebitedTurn, recordErrorTurn } from "../ai/usageRepo";
```

et étendre l'import type **existant** de `./provider/types` (ligne 17) en :

```ts
import type { LlmProvider, LlmUsage } from "./provider/types";
```

**5b — remplacer `resolve()`** (garde le hook `providerOverride` intact) :

```ts
/** Model from the catalog (requested → default → fallback), provider from the
 *  model's credentials. providerOverride short-circuits the provider only —
 *  the catalog still resolves, so tests exercise real pricing. */
async function resolveTurn(
	requestedModelId?: string | null,
): Promise<{ provider: LlmProvider; model: AiModel } | null> {
	const model = await resolveModel(requestedModelId);
	if (!model) return null;
	if (providerOverride) return { provider: providerOverride, model };
	const provider = await createProviderFor(model);
	return provider ? { provider, model } : null;
}
```

**5c — dans `r.post("/conversations/:id/messages", ...)`** : remplacer le bloc entre le parse du body et le `streamSSE` (l'actuel `const pm = await resolve(); if (!pm) return c.json({...}, 503);`) par :

```ts
		const modelId =
			typeof (body as any).modelId === "string" ? (body as any).modelId : null;
		const pm = await resolveTurn(modelId);
		if (!pm)
			return c.json(
				{ error: "Assistant disabled: no active model/provider configured." },
				503,
			);

		// The conversation's project carries the debited network (spec 2026-07-02).
		const projRows = await db
			.select({ networkId: projects.networkId })
			.from(projects)
			.where(eq(projects.id, conv.projectId));
		if (projRows.length === 0)
			return c.json({ error: "project_not_found" }, 404);
		const networkId = projRows[0].networkId;

		const balance = await getBalance(networkId);
		if (balance <= 0)
			return c.json({ error: "insufficient_credits", balance }, 402);

		const settings = await getAiSettings();
		const ownerKey = c.get("ownerKey") as string;
		const actorUserId = ownerKey.startsWith("user:") ? ownerKey.slice(5) : null;
		const actorServerKeyId = ownerKey.startsWith("sk:") ? ownerKey.slice(3) : null;
```

**5d — remplacer le corps du `streamSSE`** (l'actuel try/catch/finally) par :

```ts
		return streamSSE(c, async (stream) => {
			const t0 = performance.now();
			const usages: LlmUsage[] = [];
			const usageInput = () => ({
				networkId,
				userId: actorUserId,
				serverKeyId: actorServerKeyId,
				model: pm.model,
				conversationId: conv.id,
				usage: sumUsage(usages),
				durationMs: Math.round(performance.now() - t0),
				promptPreview: text,
			});
			try {
				for await (const ev of runTurn({
					provider: pm.provider,
					model: pm.model.providerModelId,
					messages: conv.messages,
					wc,
					system: buildSystemPrompt(),
				})) {
					if (ev.type === "usage") usages.push(ev.usage);
					await stream.writeSSE({ event: ev.type, data: JSON.stringify(ev) });
					if (
						ev.type === "usage" &&
						settings.maxCreditsPerTurn != null &&
						computeCreditsCharged(sumUsage(usages), pm.model) >=
							settings.maxCreditsPerTurn
					) {
						// Loop guard: stop cleanly after the current iteration's usage
						// lands; the consumed tokens ARE debited below.
						await stream.writeSSE({
							event: "error",
							data: JSON.stringify({ message: "turn_budget_exceeded" }),
						});
						break;
					}
				}
				const { debited, balance: newBalance } = await recordDebitedTurn(usageInput());
				await stream.writeSSE({
					event: "credits",
					data: JSON.stringify({ debited, balance: newBalance }),
				});
			} catch (e) {
				const message = e instanceof Error ? e.message : String(e);
				// Provider failure: log consumed tokens for admin visibility — no debit.
				await recordErrorTurn({ ...usageInput(), errorMessage: message }).catch(() => {});
				await stream.writeSSE({ event: "error", data: JSON.stringify({ message }) });
			} finally {
				// runTurn mutates conv.messages in place; persist the full transcript.
				await saveConversation(conv.id, conv.messages, title);
			}
		});
```

- [ ] **Step 6: Vérifier le passage (nouveaux + existants)**

Run: `cd backend && bun run test src/modules/assistant/creditsIntegration.test.ts src/modules/assistant/routes.test.ts`
Expected: PASS. (Les tests existants passent grâce aux fixtures du Step 1 : model par défaut au catalogue + grant. Le provider scripté n'émet pas d'événement `usage` → `credits {debited: 0}` final, que les assertions `toContain` existantes ignorent.)

Run: `cd backend && bun run test`
Expected: PASS — suite complète.

- [ ] **Step 7: Mettre à jour le doc protocole (SSE)**

`docs/architecture/ws-protocol.md` ne couvre que le WS plugin — le flux SSE assistant est documenté dans `docs/architecture/rest-endpoints.md` : ajouter à la ligne du POST messages la mention des nouveaux comportements :

```markdown
`POST /api/v1/assistant/conversations/:id/messages` — body accepte `modelId?` ; 402 `insufficient_credits` si solde network ≤ 0 ; événement SSE final `credits {debited, balance}` ; erreur provider = loggée non débitée.
```

- [ ] **Step 8: Commit**

```bash
git add backend/src/modules/assistant/routes.ts backend/src/modules/assistant/routes.test.ts backend/src/modules/assistant/creditsIntegration.test.ts docs/architecture/rest-endpoints.md
git commit -m "feat(backend): assistant turns metered + debited (modelId, 402, SSE credits)"
```

---

### Task 3: Routes user — `/api/v1/ai/models`, `/balance`, `/preferred-model`

**Files:**
- Create: `backend/src/lib/ownerKey.ts` (extraction de `resolveOwnerKey`)
- Modify: `backend/src/modules/assistant/routes.ts` (importer depuis lib)
- Create: `backend/src/modules/ai/routes.ts`, `backend/src/modules/ai/index.ts`
- Modify: `backend/src/app.ts` (ajouter `aiModule` à `mountModules`)
- Test: `backend/src/modules/ai/routes.test.ts`

**Interfaces:**
- Consumes: `listModels`/`getModel` + `computeCreditsCharged` + `getBalance` (module `ai`), tables `projects`/`memberships`/`users`.
- Produces (contrat plan 4 — UI user) :
  - `resolveOwnerKey(c: Context): Promise<string | null>` dans `lib/ownerKey.ts` (déplacé tel quel).
  - `GET /api/v1/ai/models` → `{ models: PublicAiModelDto[], defaultModelId: string | null, preferredModelId: string | null }` — modèles **actifs** uniquement ; `PublicAiModelDto = { id, displayName, description, badge, creditsPerMInput, creditsPerMOutput, estimates: { chatMessage: number, menuMigration: number } }` ; `preferredModelId` null en session `sk:`.
  - `TYPICAL_ACTIONS = { chatMessage: { inputTokens: 2000, outputTokens: 500 }, menuMigration: { inputTokens: 10_000, outputTokens: 3000 } }` (constantes V1, exportées).
  - `GET /api/v1/ai/balance?projectId=` → `{ balance }` ; 404 projet inconnu ; 403 si le project n'appartient pas au tenant (sk: `projects.serverKeyId` ≠ session ; user: pas de membership sur le network).
  - `PUT /api/v1/ai/preferred-model` body `{ modelId }` → `{ ok: true }` ; 403 en session `sk:` ; 400 si modèle inconnu/inactif.

- [ ] **Step 1: Extraire `resolveOwnerKey`**

Créer `backend/src/lib/ownerKey.ts` avec la fonction déplacée **verbatim** depuis `assistant/routes.ts` (lignes 39-58, avec ses imports) :

```ts
import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import { validateAccessToken } from "./auth";
import { findSession } from "./sessionManager";

/**
 * Dual-auth tenant key shared by the assistant and ai routes: editor-session
 * Bearer token (`sk:<serverKeyId>`) or user-session cookie (`user:<userId>`).
 */
export async function resolveOwnerKey(c: Context): Promise<string | null> {
	const h = c.req.header("Authorization");
	const bearer = h?.startsWith("Bearer ") ? h.slice(7) : "";
	if (bearer) {
		const session = await validateAccessToken(bearer);
		if (session) return `sk:${session.serverKeyId}`;
	}
	const sessionId = getCookie(c, "artisan_user_session");
	if (sessionId) {
		const us = await findSession(sessionId);
		if (us) return `user:${us.userId}`;
	}
	return null;
}
```

Dans `assistant/routes.ts` : supprimer la fonction locale et ses imports devenus inutiles (`validateAccessToken`, `findSession`, `getCookie`, `Context` si plus utilisés), ajouter `import { resolveOwnerKey } from "../../lib/ownerKey";`.

Run: `cd backend && bun run test src/modules/assistant/routes.test.ts`
Expected: PASS (pur déplacement).

- [ ] **Step 2: Écrire les tests des routes user**

`backend/src/modules/ai/routes.test.ts` :

```ts
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { app } from "../../app";
import { db } from "../../db/index";
import {
	aiCreditLedger,
	aiModels,
	editorSessions,
	memberships,
	networks,
	projects,
	serverKeys,
	users,
} from "../../db/schema";
import { createNetwork } from "../../lib/networkManager";
import { createSession } from "../../lib/sessionManager";
import { grantCredits } from "./creditsRepo";
import { createModel, setDefaultModel, type AiModel } from "./modelRepo";

const SRV = "srv_ai_routes";
const ACCESS = "acc_ai_routes";
const PROJECT_ID = "proj_ai_routes";
const USER_ID = "usr_ai_routes";
const OUTSIDER_ID = "usr_ai_routes_outsider";
let networkId = "";
let userSession = "";
let outsiderSession = "";
let active: AiModel;
let inactive: AiModel;

const bearer = { Authorization: `Bearer ${ACCESS}`, "Content-Type": "application/json" };
const cookie = () => ({ Cookie: `artisan_user_session=${userSession}`, "Content-Type": "application/json" });

beforeAll(async () => {
	networkId = (await createNetwork("ai-routes-network")).id;
	const now = new Date();
	const future = new Date(Date.now() + 3_600_000);
	await db.insert(serverKeys).values({ id: SRV, hash: "h_ai_routes", networkId, createdAt: now }).onConflictDoNothing();
	await db.insert(editorSessions).values({
		token: "url_ai_routes", serverKeyId: SRV, createdBy: "CONSOLE",
		createdAt: now, expiresAt: future, accessToken: ACCESS, accessExpiresAt: future,
	}).onConflictDoNothing();
	await db.insert(projects).values({
		id: PROJECT_ID, networkId, serverKeyId: SRV, name: "AI Routes",
		hash: "", filesJson: "{}", createdAt: now, updatedAt: now,
	}).onConflictDoNothing();
	for (const [id, email] of [[USER_ID, "ai-routes@example.com"], [OUTSIDER_ID, "ai-routes-out@example.com"]] as const) {
		await db.insert(users).values({ id, email, name: id, createdAt: now, updatedAt: now }).onConflictDoNothing();
	}
	await db.insert(memberships).values({
		id: "mem_ai_routes", userId: USER_ID, networkId, role: "owner", createdAt: now,
	}).onConflictDoNothing();
	userSession = (await createSession(USER_ID)).id;
	outsiderSession = (await createSession(OUTSIDER_ID)).id;
	active = await createModel({
		displayName: "Active Model", description: "Fast and cheap", badge: "cheap",
		provider: "openai", providerModelId: "active-x",
		creditsPerMInput: 1000, creditsPerMOutput: 2000,
		realUsdPerMInput: 0, realUsdPerMOutput: 0, isActive: true,
	});
	inactive = await createModel({
		displayName: "Hidden Model", description: "", badge: "premium",
		provider: "openai", providerModelId: "hidden-x",
		creditsPerMInput: 1, creditsPerMOutput: 1,
		realUsdPerMInput: 0, realUsdPerMOutput: 0, isActive: false,
	});
	await setDefaultModel(active.id);
	await grantCredits({ networkId, amount: 250 });
});

afterAll(async () => {
	await db.delete(aiModels);
	await db.delete(editorSessions).where(eq(editorSessions.token, "url_ai_routes"));
	await db.delete(networks).where(eq(networks.id, networkId));
	await db.delete(users).where(eq(users.id, USER_ID));
	await db.delete(users).where(eq(users.id, OUTSIDER_ID));
});

describe("GET /api/v1/ai/models", () => {
	it("401 without auth", async () => {
		expect((await app.request("/api/v1/ai/models")).status).toBe(401);
	});

	it("lists ACTIVE models only, with estimates at the model's prices", async () => {
		const res = await app.request("/api/v1/ai/models", { headers: bearer });
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.models.length).toBe(1);
		expect(body.models[0].displayName).toBe("Active Model");
		expect(body.defaultModelId).toBe(active.id);
		expect(body.preferredModelId).toBeNull(); // sk: session
		// chatMessage: ceil((2000·1000 + 500·2000)/1M) = 3
		expect(body.models[0].estimates.chatMessage).toBe(3);
		// menuMigration: ceil((10000·1000 + 3000·2000)/1M) = 16
		expect(body.models[0].estimates.menuMigration).toBe(16);
		// Never expose real USD prices to users.
		expect(JSON.stringify(body)).not.toContain("realUsd");
	});

	it("returns the user's preferredModelId on cookie sessions", async () => {
		await db.update(users).set({ preferredAiModelId: active.id }).where(eq(users.id, USER_ID));
		const body = await (await app.request("/api/v1/ai/models", { headers: cookie() })).json();
		expect(body.preferredModelId).toBe(active.id);
	});
});

describe("GET /api/v1/ai/balance", () => {
	it("sk: session sees its project's network balance", async () => {
		const res = await app.request(`/api/v1/ai/balance?projectId=${PROJECT_ID}`, { headers: bearer });
		expect(res.status).toBe(200);
		expect((await res.json()).balance).toBe(250);
	});

	it("user session requires a membership on the project's network", async () => {
		const ok = await app.request(`/api/v1/ai/balance?projectId=${PROJECT_ID}`, { headers: cookie() });
		expect(ok.status).toBe(200);
		const out = await app.request(`/api/v1/ai/balance?projectId=${PROJECT_ID}`, {
			headers: { Cookie: `artisan_user_session=${outsiderSession}` },
		});
		expect(out.status).toBe(403);
	});

	it("404 for an unknown project", async () => {
		const res = await app.request("/api/v1/ai/balance?projectId=ghost", { headers: bearer });
		expect(res.status).toBe(404);
	});
});

describe("PUT /api/v1/ai/preferred-model", () => {
	it("persists for user sessions", async () => {
		const res = await app.request("/api/v1/ai/preferred-model", {
			method: "PUT", headers: cookie(), body: JSON.stringify({ modelId: active.id }),
		});
		expect(res.status).toBe(200);
		const [u] = await db.select().from(users).where(eq(users.id, USER_ID));
		expect(u.preferredAiModelId).toBe(active.id);
	});

	it("403 for sk: sessions; 400 for inactive/unknown models", async () => {
		const sk = await app.request("/api/v1/ai/preferred-model", {
			method: "PUT", headers: bearer, body: JSON.stringify({ modelId: active.id }),
		});
		expect(sk.status).toBe(403);
		const bad = await app.request("/api/v1/ai/preferred-model", {
			method: "PUT", headers: cookie(), body: JSON.stringify({ modelId: inactive.id }),
		});
		expect(bad.status).toBe(400);
	});
});
```

- [ ] **Step 3: Vérifier l'échec**

Run: `cd backend && bun run test src/modules/ai/routes.test.ts`
Expected: FAIL — 404 (routes pas montées).

- [ ] **Step 4: Implémenter `modules/ai/routes.ts`**

```ts
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../../db/index";
import { memberships, projects, users } from "../../db/schema";
import { resolveOwnerKey } from "../../lib/ownerKey";
import { getBalance } from "./creditsRepo";
import { getModel, listModels, type AiModel } from "./modelRepo";
import { computeCreditsCharged } from "./pricing";

/** V1 typical-action token profiles for the selector's cost estimates.
 *  Code constants — revisit when real usage data accumulates. */
export const TYPICAL_ACTIONS = {
	chatMessage: { inputTokens: 2000, outputTokens: 500, cachedInputTokens: 0 },
	menuMigration: { inputTokens: 10_000, outputTokens: 3000, cachedInputTokens: 0 },
} as const;

function toPublicDto(m: AiModel) {
	return {
		id: m.id,
		displayName: m.displayName,
		description: m.description,
		badge: m.badge,
		creditsPerMInput: m.creditsPerMInput,
		creditsPerMOutput: m.creditsPerMOutput,
		estimates: {
			chatMessage: computeCreditsCharged(TYPICAL_ACTIONS.chatMessage, m),
			menuMigration: computeCreditsCharged(TYPICAL_ACTIONS.menuMigration, m),
		},
	};
}

export function buildAiRouter(): Hono {
	const r = new Hono();

	r.use("*", async (c, next) => {
		const ownerKey = await resolveOwnerKey(c);
		if (!ownerKey) return c.json({ error: "Unauthorized" }, 401);
		c.set("ownerKey", ownerKey);
		return next();
	});

	r.get("/models", async (c) => {
		const all = await listModels();
		const activeModels = all.filter((m) => m.isActive);
		const def = activeModels.find((m) => m.isDefault) ?? null;
		const ownerKey = c.get("ownerKey") as string;
		let preferredModelId: string | null = null;
		if (ownerKey.startsWith("user:")) {
			const rows = await db
				.select({ preferred: users.preferredAiModelId })
				.from(users)
				.where(eq(users.id, ownerKey.slice(5)));
			preferredModelId = rows[0]?.preferred ?? null;
		}
		return c.json({
			models: activeModels.map(toPublicDto),
			defaultModelId: def?.id ?? null,
			preferredModelId,
		});
	});

	r.get("/balance", async (c) => {
		const projectId = c.req.query("projectId") ?? "";
		const rows = await db
			.select({ networkId: projects.networkId, serverKeyId: projects.serverKeyId })
			.from(projects)
			.where(eq(projects.id, projectId));
		if (rows.length === 0) return c.json({ error: "project_not_found" }, 404);
		const proj = rows[0];
		const ownerKey = c.get("ownerKey") as string;
		if (ownerKey.startsWith("sk:")) {
			if (proj.serverKeyId !== ownerKey.slice(3)) return c.json({ error: "forbidden" }, 403);
		} else {
			const member = await db
				.select({ id: memberships.id })
				.from(memberships)
				.where(
					and(
						eq(memberships.userId, ownerKey.slice(5)),
						eq(memberships.networkId, proj.networkId),
					),
				);
			if (member.length === 0) return c.json({ error: "forbidden" }, 403);
		}
		return c.json({ balance: await getBalance(proj.networkId) });
	});

	r.put("/preferred-model", async (c) => {
		const ownerKey = c.get("ownerKey") as string;
		if (!ownerKey.startsWith("user:"))
			return c.json({ error: "user_session_required" }, 403);
		const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
		const modelId = typeof body.modelId === "string" ? body.modelId : "";
		const m = await getModel(modelId);
		if (!m?.isActive) return c.json({ error: "invalid_model" }, 400);
		await db
			.update(users)
			.set({ preferredAiModelId: m.id, updatedAt: new Date() })
			.where(eq(users.id, ownerKey.slice(5)));
		return c.json({ ok: true });
	});

	return r;
}
```

- [ ] **Step 5: Créer `modules/ai/index.ts` + monter dans `app.ts`**

`backend/src/modules/ai/index.ts` :

```ts
import type { Hono } from "hono";
import type { BackendModule } from "@artisan/backend-sdk";
import { buildAiRouter } from "./routes";

export const aiModule: BackendModule = {
	id: "ai",
	schemaVersion: "none",
	registerRoutes: (app: Hono) => {
		app.route("/api/v1/ai", buildAiRouter());
	},
};
```

Dans `backend/src/app.ts` : `import { aiModule } from "./modules/ai";` et

```ts
mountModules(app, [menusModule, commandsModule, assistantModule, aiModule]);
```

- [ ] **Step 6: Vérifier le passage**

Run: `cd backend && bun run test src/modules/ai/routes.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/lib/ownerKey.ts backend/src/modules/assistant/routes.ts backend/src/modules/ai/routes.ts backend/src/modules/ai/index.ts backend/src/app.ts backend/src/modules/ai/routes.test.ts
git commit -m "feat(backend): user ai routes (models+estimates, balance, preferred-model)"
```

---

### Task 4: Analytics — summary

**Files:**
- Create: `backend/src/modules/ai/analytics.ts`
- Modify: `backend/src/modules/ai/adminRoutes.ts`
- Test: `backend/src/modules/ai/analytics.test.ts`

**Interfaces:**
- Consumes: table `aiUsageLog`, `getAiSettings` (plan 1).
- Produces (contrat plan 3 — dashboards) :
  - `usageSummary(from: Date, to: Date): Promise<UsageSummary>` avec
    ```ts
    interface UsageSummary {
      totals: { inputTokens; outputTokens; cachedInputTokens; creditsCharged; realCostMicroUsd; marginMicroUsd; turns; errors };
      byModel: { modelId: string | null; modelName; provider; inputTokens; outputTokens; creditsCharged; realCostMicroUsd; turns }[];
      byProvider: { provider; inputTokens; outputTokens; creditsCharged; realCostMicroUsd; turns }[];
      daily: { date: string /* YYYY-MM-DD */; inputTokens; outputTokens; creditsCharged; realCostMicroUsd; turns }[];
    }
    ```
  - `GET /api/v1/admin/ai/usage/summary?from=ISO&to=ISO` → `UsageSummary` (défaut : 30 derniers jours).
  - `marginMicroUsd = totals.creditsCharged × creditUsdMicroRate − totals.realCostMicroUsd`.

- [ ] **Step 1: Écrire les tests**

`backend/src/modules/ai/analytics.test.ts` — insère des rows `aiUsageLog` synthétiques directement (pas besoin de modèles réels : les colonnes snapshots suffisent) :

```ts
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../../db/index";
import { aiUsageLog, appSettings, networks, users } from "../../db/schema";
import { createNetwork } from "../../lib/networkManager";
import { createSession } from "../../lib/sessionManager";
import { app } from "../../app";
import { setSetting } from "../../lib/appSettings";
import { AI_SETTINGS_KEY } from "./settings";
import { usageSummary } from "./analytics";

const ADMIN_ID = "user_admin_aianalytics";
let adminSession = "";
let networkId = "";

function row(over: Partial<typeof aiUsageLog.$inferInsert>): typeof aiUsageLog.$inferInsert {
	return {
		id: crypto.randomUUID(), networkId, userId: null, serverKeyId: null,
		modelId: null, modelName: "M1", provider: "openai", providerModelId: "m1",
		actionType: "chat", conversationId: null,
		inputTokens: 1000, outputTokens: 100, cachedInputTokens: 0,
		creditsCharged: 10, realCostMicroUsd: 5000, durationMs: 100,
		status: "success", errorMessage: null, promptPreview: "",
		createdAt: new Date("2026-07-01T10:00:00Z"),
		...over,
	};
}

beforeAll(async () => {
	const now = new Date();
	await db.insert(users).values({ id: ADMIN_ID, email: `${ADMIN_ID}@example.com`, name: "A", isAdmin: true, createdAt: now, updatedAt: now }).onConflictDoNothing();
	adminSession = (await createSession(ADMIN_ID)).id;
	networkId = (await createNetwork("analytics-net")).id;
	await setSetting(AI_SETTINGS_KEY, { creditUsdMicroRate: 10_000, maxCreditsPerTurn: null }, null);
	await db.insert(aiUsageLog).values([
		row({}),
		row({ modelName: "M2", provider: "anthropic", providerModelId: "m2", creditsCharged: 90, realCostMicroUsd: 400_000, createdAt: new Date("2026-07-02T09:00:00Z") }),
		row({ status: "error", creditsCharged: 0 }),
		row({ createdAt: new Date("2026-05-01T00:00:00Z") }), // out of range
	]);
});

afterAll(async () => {
	await db.delete(aiUsageLog).where(eq(aiUsageLog.networkId, networkId));
	await db.delete(networks).where(eq(networks.id, networkId));
	await db.delete(appSettings).where(eq(appSettings.key, AI_SETTINGS_KEY));
	await db.delete(users).where(eq(users.id, ADMIN_ID));
});

describe("usageSummary", () => {
	const from = new Date("2026-06-30T00:00:00Z");
	const to = new Date("2026-07-03T00:00:00Z");

	it("totals within range, margin computed at the credit rate", async () => {
		const s = await usageSummary(from, to);
		expect(s.totals.turns).toBe(3);
		expect(s.totals.errors).toBe(1);
		expect(s.totals.creditsCharged).toBe(100);
		expect(s.totals.realCostMicroUsd).toBe(410_000);
		// 100 credits × 10_000 µ$ − 410_000 µ$ = 590_000 µ$
		expect(s.totals.marginMicroUsd).toBe(590_000);
	});

	it("groups by model, provider, and day", async () => {
		const s = await usageSummary(from, to);
		expect(s.byModel.map((m) => m.modelName).sort()).toEqual(["M1", "M2"]);
		expect(s.byProvider.find((p) => p.provider === "anthropic")?.creditsCharged).toBe(90);
		expect(s.daily.map((d) => d.date)).toEqual(["2026-07-01", "2026-07-02"]);
	});
});

describe("GET /api/v1/admin/ai/usage/summary", () => {
	it("serves the summary to admins", async () => {
		const res = await app.request(
			"/api/v1/admin/ai/usage/summary?from=2026-06-30T00:00:00Z&to=2026-07-03T00:00:00Z",
			{ headers: { Cookie: `artisan_user_session=${adminSession}` } },
		);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.totals.turns).toBe(3);
	});
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `cd backend && bun run test src/modules/ai/analytics.test.ts`
Expected: FAIL — module `./analytics` introuvable.

- [ ] **Step 3: Implémenter `analytics.ts` (summary)**

```ts
import { and, gte, lte, sql } from "drizzle-orm";
import { db } from "../../db/index";
import { aiUsageLog } from "../../db/schema";
import { getAiSettings } from "./settings";

const sums = {
	inputTokens: sql<number>`coalesce(sum(${aiUsageLog.inputTokens}), 0)::int`,
	outputTokens: sql<number>`coalesce(sum(${aiUsageLog.outputTokens}), 0)::int`,
	creditsCharged: sql<number>`coalesce(sum(${aiUsageLog.creditsCharged}), 0)::int`,
	realCostMicroUsd: sql<number>`coalesce(sum(${aiUsageLog.realCostMicroUsd}), 0)::int`,
	turns: sql<number>`count(*)::int`,
};

export interface UsageSummary {
	totals: {
		inputTokens: number; outputTokens: number; cachedInputTokens: number;
		creditsCharged: number; realCostMicroUsd: number; marginMicroUsd: number;
		turns: number; errors: number;
	};
	byModel: ({ modelId: string | null; modelName: string; provider: string } & SumRow)[];
	byProvider: ({ provider: string } & SumRow)[];
	daily: ({ date: string } & SumRow)[];
}
type SumRow = { inputTokens: number; outputTokens: number; creditsCharged: number; realCostMicroUsd: number; turns: number };

export async function usageSummary(from: Date, to: Date): Promise<UsageSummary> {
	const range = and(gte(aiUsageLog.createdAt, from), lte(aiUsageLog.createdAt, to));

	const [totals] = await db
		.select({
			...sums,
			cachedInputTokens: sql<number>`coalesce(sum(${aiUsageLog.cachedInputTokens}), 0)::int`,
			errors: sql<number>`count(*) filter (where ${aiUsageLog.status} = 'error')::int`,
		})
		.from(aiUsageLog)
		.where(range);

	const byModel = await db
		.select({ modelId: aiUsageLog.modelId, modelName: aiUsageLog.modelName, provider: aiUsageLog.provider, ...sums })
		.from(aiUsageLog)
		.where(range)
		.groupBy(aiUsageLog.modelId, aiUsageLog.modelName, aiUsageLog.provider);

	const byProvider = await db
		.select({ provider: aiUsageLog.provider, ...sums })
		.from(aiUsageLog)
		.where(range)
		.groupBy(aiUsageLog.provider);

	const day = sql<string>`to_char(date_trunc('day', ${aiUsageLog.createdAt}), 'YYYY-MM-DD')`;
	const daily = await db
		.select({ date: day, ...sums })
		.from(aiUsageLog)
		.where(range)
		.groupBy(day)
		.orderBy(day);

	const settings = await getAiSettings();
	return {
		totals: {
			...totals,
			marginMicroUsd: totals.creditsCharged * settings.creditUsdMicroRate - totals.realCostMicroUsd,
		},
		byModel,
		byProvider,
		daily,
	};
}
```

- [ ] **Step 4: Ajouter la route dans `adminRoutes.ts`**

Imports : `import { usageSummary } from "./analytics";`

```ts
	r.get("/ai/usage/summary", async (c) => {
		const to = c.req.query("to") ? new Date(c.req.query("to") as string) : new Date();
		const from = c.req.query("from")
			? new Date(c.req.query("from") as string)
			: new Date(to.getTime() - 30 * 24 * 3_600_000);
		if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()))
			return c.json({ error: "invalid_range" }, 400);
		return c.json(await usageSummary(from, to));
	});
```

- [ ] **Step 5: Vérifier le passage**

Run: `cd backend && bun run test src/modules/ai/analytics.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/ai/analytics.ts backend/src/modules/ai/adminRoutes.ts backend/src/modules/ai/analytics.test.ts
git commit -m "feat(backend): ai usage summary analytics (totals, by model/provider, daily, margin)"
```

---

### Task 5: Logs paginés + export CSV

**Files:**
- Modify: `backend/src/modules/ai/analytics.ts` (ajouter `listUsageLogs` + `usageLogsCsv`)
- Modify: `backend/src/modules/ai/adminRoutes.ts` (route logs)
- Test: `backend/src/modules/ai/analytics.logs.test.ts`

**Interfaces:**
- Consumes: table `aiUsageLog`.
- Produces (contrat plan 3) :
  - `interface UsageLogFilters { userId?; modelId?; provider?; actionType?; status?; from?: Date; to?: Date }`
  - `listUsageLogs(filters, cursor?: string, limit = 50): Promise<{ logs: UsageLogDto[]; nextCursor: string | null }>` — tri `createdAt desc, id desc`, cursor opaque `"<epochMs>_<id>"` ; `UsageLogDto` = row avec `createdAt` ISO string.
  - `GET /api/v1/admin/ai/usage/logs?userId&modelId&provider&actionType&status&from&to&cursor&limit` → `{ logs, nextCursor }`.
  - `...&format=csv` → `text/csv` (mêmes filtres, **cap 10 000 rows**, header `Content-Disposition: attachment; filename="ai-usage.csv"`).

- [ ] **Step 1: Écrire les tests**

`backend/src/modules/ai/analytics.logs.test.ts` :

```ts
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { app } from "../../app";
import { db } from "../../db/index";
import { aiUsageLog, networks, users } from "../../db/schema";
import { createNetwork } from "../../lib/networkManager";
import { createSession } from "../../lib/sessionManager";
import { listUsageLogs } from "./analytics";

const ADMIN_ID = "user_admin_ailogs";
let adminSession = "";
let networkId = "";

function row(over: Partial<typeof aiUsageLog.$inferInsert>): typeof aiUsageLog.$inferInsert {
	return {
		id: crypto.randomUUID(), networkId, userId: null, serverKeyId: null,
		modelId: null, modelName: "M1", provider: "openai", providerModelId: "m1",
		actionType: "chat", conversationId: null,
		inputTokens: 1000, outputTokens: 100, cachedInputTokens: 0,
		creditsCharged: 10, realCostMicroUsd: 5000, durationMs: 100,
		status: "success", errorMessage: null, promptPreview: "",
		createdAt: new Date("2026-07-01T10:00:00Z"),
		...over,
	};
}

beforeAll(async () => {
	const now = new Date();
	await db.insert(users).values({ id: ADMIN_ID, email: `${ADMIN_ID}@example.com`, name: "A", isAdmin: true, createdAt: now, updatedAt: now }).onConflictDoNothing();
	adminSession = (await createSession(ADMIN_ID)).id;
	networkId = (await createNetwork("ailogs-net")).id;
	// userId reste null partout (FK users.id) — les filtres testés ici sont
	// provider/status ; le filtre userId est couvert par analytics.user.test.ts.
	await db.insert(aiUsageLog).values([
		row({ createdAt: new Date("2026-07-01T10:00:00Z") }),
		row({ provider: "anthropic", createdAt: new Date("2026-07-01T10:01:00Z") }),
		row({ provider: "anthropic", status: "error", creditsCharged: 0, createdAt: new Date("2026-07-01T10:02:00Z") }),
		row({ createdAt: new Date("2026-07-01T10:03:00Z") }),
		row({ createdAt: new Date("2026-07-01T10:04:00Z") }),
	]);
});

afterAll(async () => {
	await db.delete(aiUsageLog).where(eq(aiUsageLog.networkId, networkId));
	await db.delete(networks).where(eq(networks.id, networkId));
	await db.delete(users).where(eq(users.id, ADMIN_ID));
});

describe("listUsageLogs", () => {
	it("filters by provider + status", async () => {
		const { logs } = await listUsageLogs({ provider: "anthropic", status: "success" });
		expect(logs.every((l) => l.provider === "anthropic" && l.status === "success")).toBe(true);
	});

	it("paginates with a stable cursor (createdAt desc, id desc)", async () => {
		const page1 = await listUsageLogs({}, undefined, 2);
		expect(page1.logs.length).toBe(2);
		expect(page1.nextCursor).toBeTruthy();
		const page2 = await listUsageLogs({}, page1.nextCursor as string, 2);
		const ids1 = page1.logs.map((l) => l.id);
		expect(page2.logs.every((l) => !ids1.includes(l.id))).toBe(true);
		// newest first
		expect(page1.logs[0].createdAt > page1.logs[1].createdAt).toBe(true);
	});
});

describe("GET /api/v1/admin/ai/usage/logs", () => {
	it("serves filtered logs", async () => {
		const res = await app.request("/api/v1/admin/ai/usage/logs?status=error", {
			headers: { Cookie: `artisan_user_session=${adminSession}` },
		});
		expect(res.status).toBe(200);
		const { logs } = await res.json();
		expect(logs.every((l: { status: string }) => l.status === "error")).toBe(true);
	});

	it("format=csv returns an attachment with a header row", async () => {
		const res = await app.request("/api/v1/admin/ai/usage/logs?format=csv", {
			headers: { Cookie: `artisan_user_session=${adminSession}` },
		});
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toContain("text/csv");
		expect(res.headers.get("content-disposition")).toContain("ai-usage.csv");
		const csv = await res.text();
		expect(csv.split("\n")[0]).toBe(
			"id,createdAt,networkId,userId,serverKeyId,modelName,provider,providerModelId,actionType,status,inputTokens,outputTokens,cachedInputTokens,creditsCharged,realCostMicroUsd,durationMs,errorMessage,promptPreview",
		);
	});
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `cd backend && bun run test src/modules/ai/analytics.logs.test.ts`
Expected: FAIL — `listUsageLogs` inexistant.

- [ ] **Step 3: Implémenter dans `analytics.ts`**

Ajouter aux imports drizzle : `desc, eq, lt, or`.

```ts
export interface UsageLogFilters {
	userId?: string;
	modelId?: string;
	provider?: string;
	actionType?: string;
	status?: string;
	from?: Date;
	to?: Date;
}

export type UsageLogDto = Omit<typeof aiUsageLog.$inferSelect, "createdAt"> & { createdAt: string };

function filterConds(f: UsageLogFilters) {
	const conds = [];
	if (f.userId) conds.push(eq(aiUsageLog.userId, f.userId));
	if (f.modelId) conds.push(eq(aiUsageLog.modelId, f.modelId));
	if (f.provider) conds.push(eq(aiUsageLog.provider, f.provider));
	if (f.actionType) conds.push(eq(aiUsageLog.actionType, f.actionType));
	if (f.status) conds.push(eq(aiUsageLog.status, f.status));
	if (f.from) conds.push(gte(aiUsageLog.createdAt, f.from));
	if (f.to) conds.push(lte(aiUsageLog.createdAt, f.to));
	return conds;
}

export async function listUsageLogs(
	filters: UsageLogFilters,
	cursor?: string,
	limit = 50,
): Promise<{ logs: UsageLogDto[]; nextCursor: string | null }> {
	const conds = filterConds(filters);
	if (cursor) {
		const sep = cursor.indexOf("_");
		const ms = Number(cursor.slice(0, sep));
		const id = cursor.slice(sep + 1);
		if (!Number.isNaN(ms) && id) {
			const at = new Date(ms);
			conds.push(
				or(
					lt(aiUsageLog.createdAt, at),
					and(eq(aiUsageLog.createdAt, at), lt(aiUsageLog.id, id)),
				)!,
			);
		}
	}
	const rows = await db
		.select()
		.from(aiUsageLog)
		.where(conds.length > 0 ? and(...conds) : undefined)
		.orderBy(desc(aiUsageLog.createdAt), desc(aiUsageLog.id))
		.limit(limit + 1);
	const page = rows.slice(0, limit);
	const last = page[page.length - 1];
	return {
		logs: page.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
		nextCursor: rows.length > limit && last ? `${last.createdAt.getTime()}_${last.id}` : null,
	};
}

const CSV_COLUMNS = [
	"id", "createdAt", "networkId", "userId", "serverKeyId", "modelName", "provider",
	"providerModelId", "actionType", "status", "inputTokens", "outputTokens",
	"cachedInputTokens", "creditsCharged", "realCostMicroUsd", "durationMs",
	"errorMessage", "promptPreview",
] as const;

function csvCell(v: unknown): string {
	if (v === null || v === undefined) return "";
	const s = String(v);
	return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

/** Filtered export, hard-capped at 10k rows (silent truncation would lie —
 *  the cap is documented in the admin UI). */
export async function usageLogsCsv(filters: UsageLogFilters): Promise<string> {
	const { logs } = await listUsageLogs(filters, undefined, 10_000);
	const lines = [CSV_COLUMNS.join(",")];
	for (const l of logs) {
		lines.push(CSV_COLUMNS.map((c) => csvCell((l as Record<string, unknown>)[c])).join(","));
	}
	return lines.join("\n");
}
```

- [ ] **Step 4: Route dans `adminRoutes.ts`**

Imports : `import { listUsageLogs, usageLogsCsv, type UsageLogFilters } from "./analytics";`

```ts
	r.get("/ai/usage/logs", async (c) => {
		const q = (k: string) => c.req.query(k) || undefined;
		const parseDate = (k: string) => {
			const v = q(k);
			if (!v) return undefined;
			const d = new Date(v);
			return Number.isNaN(d.getTime()) ? undefined : d;
		};
		const filters: UsageLogFilters = {
			userId: q("userId"), modelId: q("modelId"), provider: q("provider"),
			actionType: q("actionType"), status: q("status"),
			from: parseDate("from"), to: parseDate("to"),
		};
		if (q("format") === "csv") {
			c.header("Content-Type", "text/csv; charset=utf-8");
			c.header("Content-Disposition", 'attachment; filename="ai-usage.csv"');
			return c.body(await usageLogsCsv(filters));
		}
		const limit = Math.min(Math.max(Number(q("limit") ?? 50) || 50, 1), 200);
		return c.json(await listUsageLogs(filters, q("cursor"), limit));
	});
```

- [ ] **Step 5: Vérifier le passage**

Run: `cd backend && bun run test src/modules/ai/analytics.logs.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/ai/analytics.ts backend/src/modules/ai/adminRoutes.ts backend/src/modules/ai/analytics.logs.test.ts
git commit -m "feat(backend): paginated ai usage logs + filtered CSV export"
```

---

### Task 6: Focus user

**Files:**
- Modify: `backend/src/modules/ai/analytics.ts` (`userFocus`)
- Modify: `backend/src/modules/ai/adminRoutes.ts` (route)
- Test: `backend/src/modules/ai/analytics.user.test.ts`

**Interfaces:**
- Consumes: `aiUsageLog`, `memberships`, `networks`, `getBalance`, `listLedger`.
- Produces (contrat plan 3 — onglet AI du profil user admin) :
  - `GET /api/v1/admin/ai/users/:userId?from&to` →
    ```ts
    {
      totals: { inputTokens; outputTokens; creditsCharged; realCostMicroUsd; turns; errors };
      byModel: { modelId; modelName; provider; inputTokens; outputTokens; creditsCharged; realCostMicroUsd; turns }[];
      networks: { id; name; balance; grants: { id; delta; reason; note; createdBy; createdAt: string }[] }[];
    }
    ```
  - `grants` = entrées ledger `reason != 'debit'` (l'« historique d'achats » §3.3 en V1).

- [ ] **Step 1: Écrire les tests**

`backend/src/modules/ai/analytics.user.test.ts` :

```ts
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { app } from "../../app";
import { db } from "../../db/index";
import { aiCreditLedger, aiUsageLog, memberships, networks, users } from "../../db/schema";
import { createNetwork } from "../../lib/networkManager";
import { createSession } from "../../lib/sessionManager";
import { grantCredits } from "./creditsRepo";
import { userFocus } from "./analytics";

const ADMIN_ID = "user_admin_aifocus";
const TARGET_ID = "usr_focus_ai";
let adminSession = "";
let networkId = "";
const from = new Date("2026-06-30T00:00:00Z");
const to = new Date("2026-07-03T00:00:00Z");

function row(over: Partial<typeof aiUsageLog.$inferInsert>): typeof aiUsageLog.$inferInsert {
	return {
		id: crypto.randomUUID(), networkId, userId: null, serverKeyId: null,
		modelId: null, modelName: "M1", provider: "openai", providerModelId: "m1",
		actionType: "chat", conversationId: null,
		inputTokens: 1000, outputTokens: 100, cachedInputTokens: 0,
		creditsCharged: 10, realCostMicroUsd: 5000, durationMs: 100,
		status: "success", errorMessage: null, promptPreview: "",
		createdAt: new Date("2026-07-01T10:00:00Z"),
		...over,
	};
}

beforeAll(async () => {
	const now = new Date();
	for (const [id, admin] of [[ADMIN_ID, true], [TARGET_ID, false], ["usr_focus_other", false]] as const) {
		await db.insert(users).values({ id, email: `${id}@example.com`, name: id, isAdmin: admin, createdAt: now, updatedAt: now }).onConflictDoNothing();
	}
	adminSession = (await createSession(ADMIN_ID)).id;
	networkId = (await createNetwork("aifocus-net")).id;
	await db.insert(memberships).values({
		id: "mem_aifocus", userId: TARGET_ID, networkId, role: "owner", createdAt: now,
	}).onConflictDoNothing();
	await db.insert(aiUsageLog).values([
		row({ userId: TARGET_ID }),
		row({ userId: TARGET_ID, status: "error", creditsCharged: 0 }),
		row({ userId: "usr_focus_other" }),
	]);
	await grantCredits({ networkId, amount: 500, note: "starter" });
});

afterAll(async () => {
	await db.delete(aiUsageLog).where(eq(aiUsageLog.networkId, networkId));
	await db.delete(aiCreditLedger).where(eq(aiCreditLedger.networkId, networkId));
	await db.delete(networks).where(eq(networks.id, networkId)); // cascades memberships
	await db.delete(users).where(eq(users.id, ADMIN_ID));
	await db.delete(users).where(eq(users.id, TARGET_ID));
	await db.delete(users).where(eq(users.id, "usr_focus_other"));
});

describe("userFocus", () => {
	it("aggregates only the target user's rows", async () => {
		const f = await userFocus("usr_focus_ai", from, to);
		expect(f.totals.turns).toBe(2);
		expect(f.totals.errors).toBe(1);
	});

	it("lists the user's networks with balance and non-debit ledger entries", async () => {
		const f = await userFocus("usr_focus_ai", from, to);
		expect(f.networks.length).toBe(1);
		expect(f.networks[0].balance).toBe(500);
		expect(f.networks[0].grants.length).toBe(1);
		expect(f.networks[0].grants[0].reason).toBe("grant");
	});
});

describe("GET /api/v1/admin/ai/users/:userId", () => {
	it("serves the focus payload to admins", async () => {
		const res = await app.request("/api/v1/admin/ai/users/usr_focus_ai", {
			headers: { Cookie: `artisan_user_session=${adminSession}` },
		});
		expect(res.status).toBe(200);
		expect((await res.json()).totals.turns).toBe(2);
	});
});
```

(Boilerplate fixtures/cleanup : même structure que les tests des Tasks 4-5 — admin `user_admin_aifocus`, réutiliser le helper `row()` avec `userId` varié, membership insérée à la main comme dans `routes.test.ts` Task 3.)

- [ ] **Step 2: Vérifier l'échec**

Run: `cd backend && bun run test src/modules/ai/analytics.user.test.ts`
Expected: FAIL — `userFocus` inexistant.

- [ ] **Step 3: Implémenter `userFocus` dans `analytics.ts`**

Ajouter aux imports : `memberships, networks` depuis schema, `getBalance` + `listLedger` depuis `./creditsRepo`.

```ts
export async function userFocus(userId: string, from: Date, to: Date) {
	const range = and(
		eq(aiUsageLog.userId, userId),
		gte(aiUsageLog.createdAt, from),
		lte(aiUsageLog.createdAt, to),
	);
	const [totals] = await db
		.select({
			...sums,
			errors: sql<number>`count(*) filter (where ${aiUsageLog.status} = 'error')::int`,
		})
		.from(aiUsageLog)
		.where(range);
	const byModel = await db
		.select({ modelId: aiUsageLog.modelId, modelName: aiUsageLog.modelName, provider: aiUsageLog.provider, ...sums })
		.from(aiUsageLog)
		.where(range)
		.groupBy(aiUsageLog.modelId, aiUsageLog.modelName, aiUsageLog.provider);
	const nets = await db
		.select({ id: networks.id, name: networks.name })
		.from(memberships)
		.innerJoin(networks, eq(memberships.networkId, networks.id))
		.where(eq(memberships.userId, userId));
	const withCredits = await Promise.all(
		nets.map(async (n) => ({
			...n,
			balance: await getBalance(n.id),
			grants: (await listLedger(n.id, 100))
				.filter((e) => e.reason !== "debit")
				.map((e) => ({ ...e, createdAt: e.createdAt.toISOString() })),
		})),
	);
	return { totals, byModel, networks: withCredits };
}
```

Route dans `adminRoutes.ts` (mêmes défauts de période que summary) :

```ts
	r.get("/ai/users/:userId", async (c) => {
		const to = c.req.query("to") ? new Date(c.req.query("to") as string) : new Date();
		const from = c.req.query("from")
			? new Date(c.req.query("from") as string)
			: new Date(to.getTime() - 30 * 24 * 3_600_000);
		if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()))
			return c.json({ error: "invalid_range" }, 400);
		return c.json(await userFocus(c.req.param("userId"), from, to));
	});
```

- [ ] **Step 4: Vérifier le passage + suite complète**

Run: `cd backend && bun run test src/modules/ai/analytics.user.test.ts`
Expected: PASS.
Run: `cd backend && bun run test`
Expected: PASS — suite complète.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/ai/analytics.ts backend/src/modules/ai/adminRoutes.ts backend/src/modules/ai/analytics.user.test.ts
git commit -m "feat(backend): admin user focus (usage, per-model split, networks credits)"
```

---

### Task 7: Docs de clôture backend

**Files:**
- Modify: `docs/architecture/rest-endpoints.md`
- Modify: `CHANGELOG.md`
- Modify: `.env.example`
- Modify: `docs/superpowers/specs/2026-06-08-ai-assistant-design.md` (note d'en-tête)

- [ ] **Step 1: rest-endpoints.md**

Ajouter la ligne des routes user + analytics :

```markdown
| `/api/v1/ai/models`, `/api/v1/ai/balance`, `/api/v1/ai/preferred-model` | Sélecteur user : modèles actifs + estimations, solde network (dual-auth `sk:`/`user:`), modèle préféré | `backend/src/modules/ai/routes.ts` |
| `/api/v1/admin/ai/usage/summary`, `/api/v1/admin/ai/usage/logs[?format=csv]`, `/api/v1/admin/ai/users/:userId` | Analytics consommations (totaux + marge, répartitions, série journalière), logs filtrables + export, focus user | `backend/src/modules/ai/adminRoutes.ts` |
```

- [ ] **Step 2: CHANGELOG**

Sous `[Unreleased]` :

```markdown
### Added
- Assistant turns are metered and debited per network: `modelId` per message, 402 `insufficient_credits`, SSE `credits {debited, balance}`, provider errors logged but never debited. User routes `GET /api/v1/ai/models` (+cost estimates), `GET /api/v1/ai/balance`, `PUT /api/v1/ai/preferred-model`. Admin analytics `GET /api/v1/admin/ai/usage/summary`, `/logs` (+CSV export), `/users/:userId`.
```

- [ ] **Step 3: .env.example**

Sur le bloc `ASSISTANT_*`, remplacer le commentaire existant par :

```
# Legacy assistant provider config — SEED ONLY since 2026-07: read once at boot
# to populate the ai_models catalog when it is empty. Runtime resolution goes
# through the DB catalog (admin > AI models). Safe to remove once seeded.
```

- [ ] **Step 4: Note dans l'ancien spec**

En tête de `docs/superpowers/specs/2026-06-08-ai-assistant-design.md`, dans la ligne **Statut**, ajouter :

```markdown
Le sous-plan (3) crédits est réalisé — étendu en système de modèles complet — par `2026-07-02-ai-model-system-design.md` (plans `2026-07-02-ai-models-1..4`).
```

- [ ] **Step 5: Commit**

```bash
git add docs/architecture/rest-endpoints.md CHANGELOG.md .env.example docs/superpowers/specs/2026-06-08-ai-assistant-design.md
git commit -m "docs: ai metering routes, env seed note, spec cross-links"
```
