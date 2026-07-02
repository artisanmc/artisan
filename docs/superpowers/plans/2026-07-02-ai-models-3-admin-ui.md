# AI Models — Plan 3/4 : UI admin (catalogue, providers, settings, dashboards, focus user)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Le panel admin du système de modèles IA : page `/admin/ai` (table catalogue + édition + test live + cards providers + settings), page `/admin/ai/usage` (dashboards conso/marge, barres maison), page `/admin/ai/usage/logs` (logs filtrables + export CSV), onglet AI sur le profil user admin (conso + grant de credits). Remplace l'ancienne `AssistantConfigForm`.

**Architecture:** Frontend React 19 + TanStack Router (file-based) + Zustand. Consomme les routes backend `/api/v1/admin/ai/*` shippées par les plans 1-2. Design-system-first : primitives réutilisables (Table, StatCard, HBar) ajoutées à `components/ui/` + spécimen `/admin/design` dans le même commit ; tout string via react-i18next (en + fr). Clients API par-module (cookie auth `credentials: "include"`), pattern de `src/lib/api/adminConfig.ts`.

**Tech Stack:** React 19, Vite, TanStack Router, Zustand, lucide-react, sonner (toasts), vitest + @testing-library/react + user-event. Pas de lib de charts (barres CSS maison).

## Global Constraints

- **Emplacements** : stores dans `src/state/` ; locales `src/locales/en.ts` + `src/locales/fr.ts` (objet nested, un seul namespace `translation`) ; CSS `src/styles/globals.css` ; primitives `src/components/ui/` ; features `src/features/admin/` ; routes `src/routes/admin.*` ; clients `src/lib/api/`.
- **Clients admin** : `const apiUrl = () => (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:3001";` ; GET → `DTO | null` sur `!res.ok` ; mutations → `{ ok: true; data } | { ok: false; status; error? }`. Toujours `credentials: "include"`. Jamais de bearer sur les routes admin.
- **i18n** : chaque clé ajoutée aux DEUX locales dans le même commit (tests `src/lib/i18nKeys.test.ts` valident la parité). Nouveau bloc top-level = même clé en/fr. Jamais de français/anglais en dur dans le JSX.
- **Design-system-first** : toute nouvelle primitive UI vit dans `components/ui/` + spécimen ajouté à `DesignSystemPage.tsx` (+ clé `adminDesign.sections.*`) dans le même commit. Couleurs via `var(--token)` uniquement — jamais de hex/rgba en dur.
- **Route boilerplate** : `export const Route = createFileRoute("/admin/xxx")({ component: XxxPage });`. Le gate admin est déjà appliqué par `admin.tsx` (layout parent) — les leaves ne re-gatent pas.
- **Prix** : credits par 1M tokens (entiers) ; coût réel micro-USD par 1M tokens ($0.075 → 75 000). Le formulaire édite les micro-USD via un champ USD lisible (voir Task 4). Marge/coût affichés via un formatteur USD.
- **Tests** : `cd editor && npm test` (vitest). Mock du module client API (`vi.mock("@/lib/api/xxx", ...)`) pour les tests de composants ; `vi.stubGlobal("fetch", ...)` pour les tests de clients. Requêtes de labels bilingues (`/api key|clé api/i`).
- Commits conventional ; `npm test` vert avant chaque commit. Stage explicite des fichiers — jamais `git add -A` (WIP non lié dans l'arbre).

## DTOs backend consommés (contrats figés, plans 1-2)

```ts
// GET /api/v1/admin/ai/models → { models: AiModelDto[] }
interface AiModelDto {
  id: string; displayName: string; description: string;
  badge: "cheap" | "balanced" | "premium";
  provider: string; providerModelId: string;
  creditsPerMInput: number; creditsPerMOutput: number;
  realUsdPerMInput: number; realUsdPerMOutput: number; // micro-USD / 1M tokens
  isActive: boolean; isDefault: boolean;
  createdAt: string; updatedAt: string; // ISO
}
// POST /models body: {displayName,description,badge,provider,providerModelId,credits*,realUsd*,isActive} → AiModelDto | 400 {error:"invalid_model"|"provider_key_missing"}
// PUT /models/:id body: Partial<above> → AiModelDto | 400 | 404
// PUT /models/:id/default → {ok:true} | 404 | 400 {error:"model_inactive"}
// POST /models/:id/test → {ok:boolean, latencyMs, inputTokens, outputTokens, creditsCost, realCostMicroUsd} | {ok:false, error}
// GET /api/v1/admin/ai/providers → { providers: Record<slug, {label,baseUrl,keySet,preset}> }
// PUT /api/v1/admin/ai/providers/:slug body {label?,baseUrl?,apiKey?} → {ok:true} | 503 {error:"encryption_not_configured"}
// GET /api/v1/admin/ai/settings → { creditUsdMicroRate, maxCreditsPerTurn }
// PUT /api/v1/admin/ai/settings body Partial → settings
// GET /api/v1/admin/ai/usage/summary?from&to → UsageSummary
interface UsageSummary {
  totals: { inputTokens; outputTokens; cachedInputTokens; creditsCharged; realCostMicroUsd; marginMicroUsd; turns; errors };
  byModel: { modelId: string|null; modelName: string; provider: string; inputTokens; outputTokens; creditsCharged; realCostMicroUsd; turns }[];
  byProvider: { provider: string; inputTokens; outputTokens; creditsCharged; realCostMicroUsd; turns }[];
  daily: { date: string; inputTokens; outputTokens; creditsCharged; realCostMicroUsd; turns }[];
}
// GET /api/v1/admin/ai/usage/logs?userId&modelId&provider&actionType&status&from&to&cursor&limit → { logs: UsageLogDto[], nextCursor: string|null }
//   &format=csv → text/csv attachment
interface UsageLogDto {
  id; createdAt; networkId; userId: string|null; serverKeyId: string|null;
  modelId: string|null; modelName; provider; providerModelId; actionType;
  status: "success"|"error"; inputTokens; outputTokens; cachedInputTokens;
  creditsCharged; realCostMicroUsd; durationMs: number|null; errorMessage: string|null; promptPreview: string;
}
// GET /api/v1/admin/ai/users/:userId?from&to → { totals, byModel, networks: {id,name,balance,grants:{id,delta,reason,note,createdBy,createdAt}[]}[] }
// POST /api/v1/admin/ai/credits/grant body {networkId,amount,note?} → {ok:true, balance} | 400 {error:"invalid_amount"} | 404 {error:"network_not_found"}
```

---

### Task 1: Formatteurs partagés (`src/lib/format.ts`)

**Files:**
- Create: `editor/src/lib/format.ts`
- Test: `editor/src/lib/format.test.ts`

**Interfaces:**
- Produces:
  - `formatCredits(n: number, lang?: string): string` — entier localisé (`Intl.NumberFormat`), ex. `1 250` (fr) / `1,250` (en).
  - `formatUsdFromMicro(micro: number, lang?: string): string` — micro-USD → `$X.XX` (2 décimales, style currency USD).
  - `formatTokens(n: number, lang?: string): string` — entier localisé (comme credits, alias sémantique).

- [ ] **Step 1: Test**

`editor/src/lib/format.test.ts` :

```ts
import { describe, expect, it } from "vitest";
import { formatCredits, formatTokens, formatUsdFromMicro } from "./format";

describe("format", () => {
  it("formatCredits groups thousands", () => {
    expect(formatCredits(1250, "en")).toBe("1,250");
    expect(formatCredits(0, "en")).toBe("0");
  });
  it("formatUsdFromMicro renders 2-decimal USD", () => {
    // 6_000_000 µ$ = $6.00
    expect(formatUsdFromMicro(6_000_000, "en")).toBe("$6.00");
    // 75_000 µ$ = $0.08 (rounded)
    expect(formatUsdFromMicro(75_000, "en")).toBe("$0.08");
    // negative margin
    expect(formatUsdFromMicro(-500_000, "en")).toBe("-$0.50");
  });
  it("formatTokens groups thousands", () => {
    expect(formatTokens(1_000_000, "en")).toBe("1,000,000");
  });
});
```

- [ ] **Step 2: Run — expect FAIL (module missing)**

Run: `cd editor && npm test -- src/lib/format.test.ts`
Expected: FAIL (cannot resolve `./format`).

- [ ] **Step 3: Implement `src/lib/format.ts`**

```ts
/** Localized integer (credits / tokens). */
export function formatCredits(n: number, lang = "en"): string {
  return new Intl.NumberFormat(lang).format(Math.round(n));
}
export const formatTokens = formatCredits;

/** micro-USD → "$X.XX" in the given locale. Negative renders "-$X.XX". */
export function formatUsdFromMicro(micro: number, lang = "en"): string {
  return new Intl.NumberFormat(lang, { style: "currency", currency: "USD" }).format(
    micro / 1_000_000,
  );
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `cd editor && npm test -- src/lib/format.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add editor/src/lib/format.ts editor/src/lib/format.test.ts
git commit -m "feat(editor): credits/tokens/usd formatters"
```

---

### Task 2: Client API catalogue + providers + settings (`src/lib/api/adminModels.ts`)

**Files:**
- Create: `editor/src/lib/api/adminModels.ts`
- Test: `editor/src/lib/api/adminModels.test.ts`

**Interfaces:**
- Consumes: DTOs ci-dessus.
- Produces (types exportés + fonctions) :
  - `AiModelDto`, `AiModelBadge = "cheap"|"balanced"|"premium"`, `AiModelInput` (le body POST), `ProviderDto = { label; baseUrl; keySet; preset }`, `AiSettingsDto = { creditUsdMicroRate; maxCreditsPerTurn: number | null }`, `ModelTestResult = { ok; latencyMs?; inputTokens?; outputTokens?; creditsCost?; realCostMicroUsd?; error?: string }`.
  - `type Result<T> = { ok: true; data: T } | { ok: false; status: number; error?: string }`.
  - `listModels(): Promise<AiModelDto[] | null>`
  - `createModel(input: AiModelInput): Promise<Result<AiModelDto>>`
  - `updateModel(id: string, patch: Partial<AiModelInput>): Promise<Result<AiModelDto>>`
  - `setDefaultModel(id: string): Promise<Result<{ ok: true }>>`
  - `testModel(id: string): Promise<ModelTestResult>` (200 dans les deux cas ; 404 → `{ ok: false, error: "not_found" }`)
  - `listProviders(): Promise<Record<string, ProviderDto> | null>`
  - `putProvider(slug: string, body: { label?; baseUrl?; apiKey? }): Promise<Result<{ ok: true }>>`
  - `getAiSettings(): Promise<AiSettingsDto | null>`
  - `putAiSettings(patch: Partial<AiSettingsDto>): Promise<Result<AiSettingsDto>>`

- [ ] **Step 1: Test (stub global fetch, mirror `adminConfig.test.ts`)**

`editor/src/lib/api/adminModels.test.ts` :

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { createModel, listModels, putProvider, setDefaultModel, testModel } from "./adminModels";

afterEach(() => vi.unstubAllGlobals());

function stub(status: number, body: unknown) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("adminModels client", () => {
  it("listModels returns models array on 200", async () => {
    stub(200, { models: [{ id: "m1", displayName: "M" }] });
    const models = await listModels();
    expect(models?.[0].id).toBe("m1");
  });

  it("listModels returns null on error", async () => {
    stub(500, {});
    expect(await listModels()).toBeNull();
  });

  it("createModel posts with credentials + JSON body, returns ok+data", async () => {
    const f = stub(200, { id: "m2", displayName: "New" });
    const res = await createModel({
      displayName: "New", description: "", badge: "balanced", provider: "anthropic",
      providerModelId: "claude", creditsPerMInput: 1, creditsPerMOutput: 1,
      realUsdPerMInput: 0, realUsdPerMOutput: 0, isActive: true,
    });
    expect(res).toEqual({ ok: true, data: { id: "m2", displayName: "New" } });
    const [, init] = f.mock.calls[0];
    expect(init).toMatchObject({ method: "POST", credentials: "include" });
    expect(JSON.parse((init as RequestInit).body as string).displayName).toBe("New");
  });

  it("createModel surfaces backend error code on 400", async () => {
    stub(400, { error: "provider_key_missing" });
    const res = await createModel({} as never);
    expect(res).toEqual({ ok: false, status: 400, error: "provider_key_missing" });
  });

  it("setDefaultModel PUTs to /:id/default", async () => {
    const f = stub(200, { ok: true });
    await setDefaultModel("m1");
    expect(f.mock.calls[0][0]).toContain("/admin/ai/models/m1/default");
    expect(f.mock.calls[0][1]).toMatchObject({ method: "PUT" });
  });

  it("testModel returns the result payload", async () => {
    stub(200, { ok: true, latencyMs: 120, inputTokens: 12, outputTokens: 2, creditsCost: 3, realCostMicroUsd: 66 });
    const r = await testModel("m1");
    expect(r.ok).toBe(true);
    expect(r.creditsCost).toBe(3);
  });

  it("putProvider returns encryption_not_configured on 503", async () => {
    stub(503, { error: "encryption_not_configured" });
    const res = await putProvider("openai", { apiKey: "sk" });
    expect(res).toEqual({ ok: false, status: 503, error: "encryption_not_configured" });
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `cd editor && npm test -- src/lib/api/adminModels.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `src/lib/api/adminModels.ts`**

```ts
const apiUrl = (): string =>
  (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:3001";

export type AiModelBadge = "cheap" | "balanced" | "premium";

export interface AiModelDto {
  id: string; displayName: string; description: string; badge: AiModelBadge;
  provider: string; providerModelId: string;
  creditsPerMInput: number; creditsPerMOutput: number;
  realUsdPerMInput: number; realUsdPerMOutput: number;
  isActive: boolean; isDefault: boolean; createdAt: string; updatedAt: string;
}
export type AiModelInput = Omit<AiModelDto, "id" | "isDefault" | "createdAt" | "updatedAt">;
export interface ProviderDto { label: string; baseUrl: string; keySet: boolean; preset: boolean }
export interface AiSettingsDto { creditUsdMicroRate: number; maxCreditsPerTurn: number | null }
export interface ModelTestResult {
  ok: boolean; latencyMs?: number; inputTokens?: number; outputTokens?: number;
  creditsCost?: number; realCostMicroUsd?: number; error?: string;
}
export type Result<T> = { ok: true; data: T } | { ok: false; status: number; error?: string };

async function mutate<T>(path: string, method: string, body?: unknown): Promise<Result<T>> {
  const res = await fetch(`${apiUrl()}${path}`, {
    method,
    credentials: "include",
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, status: res.status, error: err.error };
  }
  return { ok: true, data: (await res.json()) as T };
}

export async function listModels(): Promise<AiModelDto[] | null> {
  const res = await fetch(`${apiUrl()}/api/v1/admin/ai/models`, { credentials: "include" });
  if (!res.ok) return null;
  return ((await res.json()) as { models: AiModelDto[] }).models;
}
export const createModel = (input: AiModelInput) => mutate<AiModelDto>("/api/v1/admin/ai/models", "POST", input);
export const updateModel = (id: string, patch: Partial<AiModelInput>) =>
  mutate<AiModelDto>(`/api/v1/admin/ai/models/${id}`, "PUT", patch);
export const setDefaultModel = (id: string) =>
  mutate<{ ok: true }>(`/api/v1/admin/ai/models/${id}/default`, "PUT");

export async function testModel(id: string): Promise<ModelTestResult> {
  const res = await fetch(`${apiUrl()}/api/v1/admin/ai/models/${id}/test`, {
    method: "POST", credentials: "include",
  });
  if (res.status === 404) return { ok: false, error: "not_found" };
  return (await res.json()) as ModelTestResult;
}

export async function listProviders(): Promise<Record<string, ProviderDto> | null> {
  const res = await fetch(`${apiUrl()}/api/v1/admin/ai/providers`, { credentials: "include" });
  if (!res.ok) return null;
  return ((await res.json()) as { providers: Record<string, ProviderDto> }).providers;
}
export const putProvider = (slug: string, body: { label?: string; baseUrl?: string; apiKey?: string }) =>
  mutate<{ ok: true }>(`/api/v1/admin/ai/providers/${slug}`, "PUT", body);

export async function getAiSettings(): Promise<AiSettingsDto | null> {
  const res = await fetch(`${apiUrl()}/api/v1/admin/ai/settings`, { credentials: "include" });
  if (!res.ok) return null;
  return (await res.json()) as AiSettingsDto;
}
export const putAiSettings = (patch: Partial<AiSettingsDto>) =>
  mutate<AiSettingsDto>("/api/v1/admin/ai/settings", "PUT", patch);
```

- [ ] **Step 4: Run — expect PASS**

Run: `cd editor && npm test -- src/lib/api/adminModels.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add editor/src/lib/api/adminModels.ts editor/src/lib/api/adminModels.test.ts
git commit -m "feat(editor): admin ai models/providers/settings api client"
```

---

### Task 3: Client analytics + grant (`src/lib/api/adminAiUsage.ts`)

**Files:**
- Create: `editor/src/lib/api/adminAiUsage.ts`
- Test: `editor/src/lib/api/adminAiUsage.test.ts`

**Interfaces:**
- Produces:
  - Types `UsageSummary`, `UsageLogDto`, `UsageFilters = { userId?; modelId?; provider?; actionType?; status?; from?; to? }`, `UserFocusDto = { totals; byModel; networks: { id; name; balance; grants: LedgerGrant[] }[] }`, `LedgerGrant = { id; delta; reason; note: string|null; createdBy: string|null; createdAt: string }`.
  - `getUsageSummary(from?: string, to?: string): Promise<UsageSummary | null>`
  - `getUsageLogs(filters: UsageFilters, cursor?: string, limit?: number): Promise<{ logs: UsageLogDto[]; nextCursor: string | null } | null>`
  - `usageLogsCsvUrl(filters: UsageFilters): string` — construit l'URL `...&format=csv` (l'export se fait via un `<a download>` / `window.open`, cookie envoyé automatiquement par le navigateur).
  - `getUserFocus(userId: string, from?: string, to?: string): Promise<UserFocusDto | null>`
  - `grantCredits(networkId: string, amount: number, note?: string): Promise<Result<{ ok: true; balance: number }>>` (réutilise `Result` de adminModels — importer le type).

- [ ] **Step 1: Test**

`editor/src/lib/api/adminAiUsage.test.ts` :

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { getUsageLogs, getUsageSummary, grantCredits, usageLogsCsvUrl } from "./adminAiUsage";

afterEach(() => vi.unstubAllGlobals());
function stub(status: number, body: unknown) {
  const f = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", f);
  return f;
}

describe("adminAiUsage client", () => {
  it("getUsageSummary passes from/to as query params", async () => {
    const f = stub(200, { totals: { turns: 3 }, byModel: [], byProvider: [], daily: [] });
    const s = await getUsageSummary("2020-01-01T00:00:00Z", "2020-02-01T00:00:00Z");
    expect(s?.totals.turns).toBe(3);
    const url = f.mock.calls[0][0] as string;
    expect(url).toContain("from=2020-01-01");
    expect(url).toContain("to=2020-02-01");
  });

  it("getUsageLogs threads filters + cursor + limit", async () => {
    const f = stub(200, { logs: [], nextCursor: null });
    await getUsageLogs({ provider: "openai", status: "error" }, "cur1", 25);
    const url = f.mock.calls[0][0] as string;
    expect(url).toContain("provider=openai");
    expect(url).toContain("status=error");
    expect(url).toContain("cursor=cur1");
    expect(url).toContain("limit=25");
  });

  it("usageLogsCsvUrl appends format=csv and filters", () => {
    const url = usageLogsCsvUrl({ status: "success" });
    expect(url).toContain("/admin/ai/usage/logs");
    expect(url).toContain("format=csv");
    expect(url).toContain("status=success");
  });

  it("grantCredits posts amount and returns balance", async () => {
    const f = stub(200, { ok: true, balance: 500 });
    const res = await grantCredits("net1", 500, "starter");
    expect(res).toEqual({ ok: true, data: { ok: true, balance: 500 } });
    expect(JSON.parse((f.mock.calls[0][1] as RequestInit).body as string)).toEqual({
      networkId: "net1", amount: 500, note: "starter",
    });
  });

  it("grantCredits surfaces invalid_amount on 400", async () => {
    stub(400, { error: "invalid_amount" });
    const res = await grantCredits("net1", -5);
    expect(res).toEqual({ ok: false, status: 400, error: "invalid_amount" });
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `cd editor && npm test -- src/lib/api/adminAiUsage.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/lib/api/adminAiUsage.ts`**

```ts
import type { Result } from "./adminModels";

const apiUrl = (): string =>
  (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:3001";

export interface SumRow { inputTokens: number; outputTokens: number; creditsCharged: number; realCostMicroUsd: number; turns: number }
export interface UsageSummary {
  totals: { inputTokens: number; outputTokens: number; cachedInputTokens: number; creditsCharged: number; realCostMicroUsd: number; marginMicroUsd: number; turns: number; errors: number };
  byModel: (SumRow & { modelId: string | null; modelName: string; provider: string })[];
  byProvider: (SumRow & { provider: string })[];
  daily: (SumRow & { date: string })[];
}
export interface UsageLogDto {
  id: string; createdAt: string; networkId: string; userId: string | null; serverKeyId: string | null;
  modelId: string | null; modelName: string; provider: string; providerModelId: string; actionType: string;
  status: "success" | "error"; inputTokens: number; outputTokens: number; cachedInputTokens: number;
  creditsCharged: number; realCostMicroUsd: number; durationMs: number | null; errorMessage: string | null; promptPreview: string;
}
export interface UsageFilters {
  userId?: string; modelId?: string; provider?: string; actionType?: string;
  status?: string; from?: string; to?: string;
}
export interface LedgerGrant { id: string; delta: number; reason: string; note: string | null; createdBy: string | null; createdAt: string }
export interface UserFocusDto {
  totals: { inputTokens: number; outputTokens: number; creditsCharged: number; realCostMicroUsd: number; turns: number; errors: number };
  byModel: (SumRow & { modelId: string | null; modelName: string; provider: string })[];
  networks: { id: string; name: string; balance: number; grants: LedgerGrant[] }[];
}

function qs(params: Record<string, string | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : "";
}

export async function getUsageSummary(from?: string, to?: string): Promise<UsageSummary | null> {
  const res = await fetch(`${apiUrl()}/api/v1/admin/ai/usage/summary${qs({ from, to })}`, { credentials: "include" });
  if (!res.ok) return null;
  return (await res.json()) as UsageSummary;
}

export async function getUsageLogs(
  filters: UsageFilters, cursor?: string, limit?: number,
): Promise<{ logs: UsageLogDto[]; nextCursor: string | null } | null> {
  const res = await fetch(
    `${apiUrl()}/api/v1/admin/ai/usage/logs${qs({ ...filters, cursor, limit: limit?.toString() })}`,
    { credentials: "include" },
  );
  if (!res.ok) return null;
  return (await res.json()) as { logs: UsageLogDto[]; nextCursor: string | null };
}

export function usageLogsCsvUrl(filters: UsageFilters): string {
  return `${apiUrl()}/api/v1/admin/ai/usage/logs${qs({ ...filters, format: "csv" })}`;
}

export async function getUserFocus(userId: string, from?: string, to?: string): Promise<UserFocusDto | null> {
  const res = await fetch(`${apiUrl()}/api/v1/admin/ai/users/${userId}${qs({ from, to })}`, { credentials: "include" });
  if (!res.ok) return null;
  return (await res.json()) as UserFocusDto;
}

export async function grantCredits(networkId: string, amount: number, note?: string): Promise<Result<{ ok: true; balance: number }>> {
  const res = await fetch(`${apiUrl()}/api/v1/admin/ai/credits/grant`, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ networkId, amount, ...(note ? { note } : {}) }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, status: res.status, error: err.error };
  }
  return { ok: true, data: (await res.json()) as { ok: true; balance: number } };
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `cd editor && npm test -- src/lib/api/adminAiUsage.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add editor/src/lib/api/adminAiUsage.ts editor/src/lib/api/adminAiUsage.test.ts
git commit -m "feat(editor): admin ai usage analytics + grant api client"
```

---

### Task 4: Primitives design-system — `Table`, `StatCard`, `HBar` + spécimens

**Files:**
- Create: `editor/src/components/ui/table.tsx`, `editor/src/components/ui/stat-card.tsx`, `editor/src/components/ui/h-bar.tsx`
- Modify: `editor/src/features/design-system/DesignSystemPage.tsx` (nouvelle Section + specimens)
- Modify: `editor/src/locales/en.ts`, `editor/src/locales/fr.ts` (`adminDesign.sections.dataViz`)
- Test: `editor/src/components/ui/dataviz.test.tsx`

**Interfaces:**
- Produces (design-system primitives, couleurs via tokens uniquement) :
  - `Table`, `THead`, `TBody`, `TR`, `TH`, `TD` — wrappers stylés autour de `<table>/<thead>/<tbody>/<tr>/<th>/<td>` (className `.card` overflow-auto container + `text-left text-[13px]`, `TH` = `.eyebrow` sticky header, `TR` hover `bg-[var(--surface-raised)]`). `TH`/`TD` acceptent `align?: "left"|"right"` (numérique = right).
  - `StatCard` : `{ label: ReactNode; value: ReactNode; sub?: ReactNode; tone?: "default"|"positive"|"negative" }` — `.card p-4`, label `.eyebrow`, value `display text-[24px]`, `tone` colore la value (`--success`/`--danger`).
  - `HBar` : `{ label: ReactNode; value: number; max: number; caption?: ReactNode }` — barre horizontale (`--brand` fill sur track `--surface-raised`), largeur `Math.round(value/max*100)%` (max 0 → 0%), label au-dessus + caption à droite.

- [ ] **Step 1: Test**

`editor/src/components/ui/dataviz.test.tsx` :

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HBar } from "./h-bar";
import { StatCard } from "./stat-card";
import { TBody, TD, TH, THead, TR, Table } from "./table";

describe("dataviz primitives", () => {
  it("StatCard renders label, value, negative tone class", () => {
    render(<StatCard label="Marge" value="-$0.50" tone="negative" />);
    expect(screen.getByText("Marge")).toBeInTheDocument();
    const v = screen.getByText("-$0.50");
    expect(v.className).toContain("--danger");
  });

  it("HBar clamps width to 0 when max is 0", () => {
    const { container } = render(<HBar label="x" value={5} max={0} />);
    const fill = container.querySelector("[data-bar-fill]") as HTMLElement;
    expect(fill.style.width).toBe("0%");
  });

  it("HBar computes percentage width", () => {
    const { container } = render(<HBar label="x" value={25} max={100} />);
    const fill = container.querySelector("[data-bar-fill]") as HTMLElement;
    expect(fill.style.width).toBe("25%");
  });

  it("Table renders rows", () => {
    render(
      <Table>
        <THead><TR><TH>Col</TH></TR></THead>
        <TBody><TR><TD>Val</TD></TR></TBody>
      </Table>,
    );
    expect(screen.getByText("Col")).toBeInTheDocument();
    expect(screen.getByText("Val")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `cd editor && npm test -- src/components/ui/dataviz.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement the three primitives**

`table.tsx` — mirror the style conventions of existing `card.tsx` (forwardRef, `cx` from `@/lib/cx`). `Table` wraps in a `.card overflow-auto` div. Example shape:

```tsx
import * as React from "react";
import { cx } from "@/lib/cx";

export const Table = React.forwardRef<HTMLTableElement, React.HTMLAttributes<HTMLTableElement>>(
  ({ className, ...p }, ref) => (
    <div className="card overflow-auto p-0">
      <table ref={ref} className={cx("w-full border-collapse text-left text-[13px]", className)} {...p} />
    </div>
  ),
);
Table.displayName = "Table";

export const THead = (p: React.HTMLAttributes<HTMLTableSectionElement>) => <thead {...p} />;
export const TBody = (p: React.HTMLAttributes<HTMLTableSectionElement>) => <tbody {...p} />;
export const TR = ({ className, ...p }: React.HTMLAttributes<HTMLTableRowElement>) => (
  <tr className={cx("border-[var(--border-soft)] border-b hover:bg-[var(--surface-raised)]", className)} {...p} />
);
export const TH = ({ align = "left", className, ...p }: React.ThHTMLAttributes<HTMLTableCellElement> & { align?: "left" | "right" }) => (
  <th className={cx("eyebrow px-3 py-2", align === "right" ? "text-right" : "text-left", className)} {...p} />
);
export const TD = ({ align = "left", className, ...p }: React.TdHTMLAttributes<HTMLTableCellElement> & { align?: "left" | "right" }) => (
  <td className={cx("px-3 py-2", align === "right" ? "text-right tabular-nums" : "text-left", className)} {...p} />
);
```

`stat-card.tsx`:

```tsx
import * as React from "react";
import { cx } from "@/lib/cx";

export interface StatCardProps { label: React.ReactNode; value: React.ReactNode; sub?: React.ReactNode; tone?: "default" | "positive" | "negative" }
export function StatCard({ label, value, sub, tone = "default" }: StatCardProps) {
  const toneClass = tone === "positive" ? "text-[var(--success)]" : tone === "negative" ? "text-[var(--danger)]" : "text-[var(--text)]";
  return (
    <div className="card flex flex-col gap-1 p-4">
      <span className="eyebrow">{label}</span>
      <span className={cx("display text-[24px] tabular-nums", toneClass)} style={{ fontFamily: "var(--font-display)" }}>{value}</span>
      {sub != null && <span className="text-[12px] text-[var(--text-mut)]">{sub}</span>}
    </div>
  );
}
```

`h-bar.tsx`:

```tsx
import * as React from "react";

export interface HBarProps { label: React.ReactNode; value: number; max: number; caption?: React.ReactNode }
export function HBar({ label, value, max, caption }: HBarProps) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between text-[12px]">
        <span className="text-[var(--text)]">{label}</span>
        {caption != null && <span className="text-[var(--text-mut)] tabular-nums">{caption}</span>}
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-[var(--surface-raised)]">
        <div data-bar-fill className="h-full rounded-full bg-[var(--brand)]" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Add specimens to `DesignSystemPage.tsx`**

Add a new `<Section id="dataViz" title={t("adminDesign.sections.dataViz")}>` (mirror the existing Section pattern) rendering: a `StatCard` trio in a grid, two `HBar`s, and a small `Table` with 2 columns. Add `adminDesign.sections.dataViz` to both locales (`"Data viz"` / `"Data viz"` — keep short; the section title only).

- [ ] **Step 5: Run — expect PASS**

Run: `cd editor && npm test -- src/components/ui/dataviz.test.tsx`
Expected: PASS.
Run: `cd editor && npm test -- src/lib/i18nKeys.test.ts`
Expected: PASS (parity holds).

- [ ] **Step 6: Commit**

```bash
git add editor/src/components/ui/table.tsx editor/src/components/ui/stat-card.tsx editor/src/components/ui/h-bar.tsx editor/src/components/ui/dataviz.test.tsx editor/src/features/design-system/DesignSystemPage.tsx editor/src/locales/en.ts editor/src/locales/fr.ts
git commit -m "feat(editor): Table/StatCard/HBar design-system primitives + specimens"
```

---

### Task 5: i18n — bloc `admin.ai` complet (les deux locales)

**Files:**
- Modify: `editor/src/locales/en.ts`, `editor/src/locales/fr.ts`

**Interfaces:**
- Produces : sous `admin`, un sous-objet `ai` couvrant toutes les vues des tasks 6-10, plus `admin.nav.aiModels` / `admin.nav.aiUsage` (les deux entrées sidebar). Cette task centralise les clés pour que les tasks UI suivantes ne touchent qu'au JSX + logique.

- [ ] **Step 1: Ajouter les clés (mêmes chemins dans en.ts et fr.ts)**

Sous `admin.nav` : `aiModels`, `aiUsage` (remplacent l'usage de l'ancienne entrée `ai` unique — garder `ai` pour rétrocompat de `admin.index`). Nouveau bloc `admin.ai` :

```
admin.ai.models.title / .subtitle
admin.ai.models.columns.{name,provider,badge,creditsIn,creditsOut,realCost,active,default,actions}
admin.ai.models.badge.{cheap,balanced,premium}
admin.ai.models.new / .edit / .save / .cancel / .test / .setDefault / .isDefault / .activate / .deactivate
admin.ai.models.testRunning / .testOk / .testFail  (interpolations: {latency},{credits},{cost} ; {error})
admin.ai.models.providerKeyMissing  // toast quand activation refusée
admin.ai.models.empty  // EmptyState
admin.ai.models.form.{displayName,description,badge,provider,providerModelId,creditsPerMInput,creditsPerMOutput,realUsdInput,realUsdOutput,active}
admin.ai.models.form.usdHint  // "prix réel API en $/1M tokens"
admin.ai.providers.title / .subtitle / .baseUrl / .apiKey / .keySet / .keyUnset / .save / .saved / .encNotConfigured / .addCustom / .slug
admin.ai.settings.title / .creditUsdRate / .creditUsdRateHint / .maxCreditsPerTurn / .maxCreditsPerTurnHint / .uncapped / .save / .saved
admin.ai.usage.title / .subtitle
admin.ai.usage.range.{7d,30d,custom,from,to}
admin.ai.usage.stat.{inputTokens,outputTokens,creditsCharged,realCost,margin,turns,errors}
admin.ai.usage.byModel / .byProvider / .daily / .noData
admin.ai.logs.title / .filters.{user,model,provider,action,status,from,to,all,apply,reset}
admin.ai.logs.status.{success,error}
admin.ai.logs.columns.{time,user,model,provider,action,status,tokens,credits,cost}
admin.ai.logs.export / .loadMore / .empty / .detail.{preview,openConversation,error}
admin.ai.user.tab  // "AI" tab label
admin.ai.user.{totalTurns,totalCredits,tokensInOut,byModel,networks,balance,grants,grantBtn,grantAmount,grantNote,grantOk,grantFail,noGrants,noUsage}
```

Fournir des libellés EN et FR concrets pour CHAQUE clé (pas de placeholder). Exemples : `admin.nav.aiModels` = `"AI Models"` / `"Modèles IA"` ; `admin.nav.aiUsage` = `"Usage"` / `"Consommation"` ; `admin.ai.usage.stat.margin` = `"Margin"` / `"Marge"` ; `admin.ai.models.testOk` = `"OK · {{latency}}ms · {{credits}} cr · {{cost}}"` / `"OK · {{latency}}ms · {{credits}} cr · {{cost}}"`.

- [ ] **Step 2: Vérifier la parité**

Run: `cd editor && npm test -- src/lib/i18nKeys.test.ts`
Expected: PASS (en/fr symétriques).

- [ ] **Step 3: Commit**

```bash
git add editor/src/locales/en.ts editor/src/locales/fr.ts
git commit -m "i18n(editor): admin ai models/usage/logs/user keys (en+fr)"
```

---

### Task 6: Page `/admin/ai` — table catalogue + set-default + test + activation

**Files:**
- Create: `editor/src/features/admin/AiModelsPage.tsx`, `editor/src/routes/admin.ai.tsx`
- Modify: `editor/src/routes/admin.index.tsx` (rediriger vers `/admin/ai` — voir note), `editor/src/components/AdminSidebar.tsx` (entrées)
- Test: `editor/src/features/admin/AiModelsPage.test.tsx`

**Interfaces:**
- Consumes: `listModels`, `setDefaultModel`, `testModel`, `updateModel` (Task 2), `formatUsdFromMicro` (Task 1), primitives `Table` etc. (Task 4), `Badge`, `Button`, `EmptyState`, i18n (Task 5).
- Produces: la page catalogue. **Note routing** : garder `admin.index.tsx` mais y remplacer `<AssistantConfigForm/>` par un `<Navigate to="/admin/ai" replace/>` (TanStack `redirect` via `beforeLoad`, ou simple render du même composant). Le plus simple : faire de `/admin/ai` la page, et `admin.index.tsx` monte `<AiModelsPage/>` aussi (ou redirige). Choisir : **`admin.index.tsx` rend `<AiModelsPage/>`** (la racine admin = modèles) et `admin.ai.tsx` rend aussi `<AiModelsPage/>` — non, éviter le doublon. Décision : **`admin.index.tsx` redirige vers `/admin/ai`** via `beforeLoad: () => { throw redirect({ to: "/admin/ai" }); }` ; toute la logique vit dans `AiModelsPage` monté par `admin.ai.tsx`.

- [ ] **Step 1: Test (mock du module client)**

`editor/src/features/admin/AiModelsPage.test.tsx` — mock `@/lib/api/adminModels`, render `<AiModelsPage/>` (le composant, pas la route), assert :
- charge et affiche les modèles (nom, badge traduit, provider, coût réel formaté) ;
- un modèle `isDefault` montre le marqueur défaut ; un autre a un bouton "définir par défaut" qui appelle `setDefaultModel(id)` ;
- le bouton Test appelle `testModel(id)` et affiche un toast succès (mock `sonner`) ;
- toggle actif appelle `updateModel(id, { isActive })` ;
- liste vide → EmptyState.

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AiModelsPage } from "./AiModelsPage";

const listMock = vi.fn();
const setDefaultMock = vi.fn(async () => ({ ok: true, data: { ok: true } }));
const testMock = vi.fn(async () => ({ ok: true, latencyMs: 100, inputTokens: 10, outputTokens: 2, creditsCost: 3, realCostMicroUsd: 66 }));
const updateMock = vi.fn(async () => ({ ok: true, data: {} }));
vi.mock("@/lib/api/adminModels", () => ({
  listModels: () => listMock(),
  setDefaultModel: (id: string) => setDefaultMock(id),
  testModel: (id: string) => testMock(id),
  updateModel: (id: string, p: unknown) => updateMock(id, p),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const model = (over: Record<string, unknown> = {}) => ({
  id: "m1", displayName: "Sonnet 5", description: "", badge: "balanced",
  provider: "anthropic", providerModelId: "claude-sonnet-5",
  creditsPerMInput: 30, creditsPerMOutput: 150, realUsdPerMInput: 3_000_000, realUsdPerMOutput: 15_000_000,
  isActive: true, isDefault: false, createdAt: "2020-01-01T00:00:00Z", updatedAt: "2020-01-01T00:00:00Z", ...over,
});

afterEach(() => vi.clearAllMocks());

describe("AiModelsPage", () => {
  it("lists models with formatted real cost", async () => {
    listMock.mockResolvedValue([model({ isDefault: true }), model({ id: "m2", displayName: "Cheap", badge: "cheap" })]);
    render(<AiModelsPage />);
    expect(await screen.findByText("Sonnet 5")).toBeInTheDocument();
    expect(screen.getByText("Cheap")).toBeInTheDocument();
  });

  it("sets a non-default model as default", async () => {
    listMock.mockResolvedValue([model({ id: "m2", displayName: "Cheap", isDefault: false })]);
    render(<AiModelsPage />);
    await screen.findByText("Cheap");
    await userEvent.click(screen.getByRole("button", { name: /default|défaut/i }));
    await waitFor(() => expect(setDefaultMock).toHaveBeenCalledWith("m2"));
  });

  it("runs a live test", async () => {
    listMock.mockResolvedValue([model()]);
    render(<AiModelsPage />);
    await screen.findByText("Sonnet 5");
    await userEvent.click(screen.getByRole("button", { name: /test/i }));
    await waitFor(() => expect(testMock).toHaveBeenCalledWith("m1"));
  });

  it("shows empty state with no models", async () => {
    listMock.mockResolvedValue([]);
    render(<AiModelsPage />);
    expect(await screen.findByText(/no model|aucun mod/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `cd editor && npm test -- src/features/admin/AiModelsPage.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement `AiModelsPage.tsx`**

Structure : `useState<AiModelDto[]|null>`, `useEffect` → `listModels()`. Rendu : `<Table>` avec colonnes (nom+description, provider, `<Badge>` du badge, credits in/out, coût réel `formatUsdFromMicro(realUsdPerMInput)`, actif toggle, défaut, actions Test/Edit). Actions par ligne : bouton Test (spinner pendant `testModel`, toast `admin.ai.models.testOk`/`testFail`), bouton "définir défaut" (sauf si `isDefault`), bouton Edit (ouvre le Sheet — Task 7, pour l'instant no-op prop `onEdit`), toggle actif via `updateModel`. EmptyState si `[]`. Provider column + a "manage providers" + "settings" link/section come in Task 8. Utiliser `Button variant`, primitives Table. Tri client par `displayName` (byte order comme backend, `< ? -1 : 1`).

- [ ] **Step 4: Route + sidebar + redirect**

- `admin.ai.tsx` : `export const Route = createFileRoute("/admin/ai")({ component: () => (<div className="h-full overflow-auto"><div className="mx-auto flex max-w-5xl flex-col gap-6 px-8 py-12"><AiModelsPage/></div></div>) });`
- `admin.index.tsx` : remplacer par redirect — `export const Route = createFileRoute("/admin/")({ beforeLoad: () => { throw redirect({ to: "/admin/ai" }); } });` (import `redirect` de `@tanstack/react-router`). Supprimer l'import de `AssistantConfigForm` (le composant reste sur disque, retiré en Task 8/plan cleanup).
- `AdminSidebar.tsx` : remplacer l'entrée `{ to: "/admin", label: t("admin.nav.ai"), Icon: Bot }` par deux entrées : `{ to: "/admin/ai", label: t("admin.nav.aiModels"), Icon: Bot }` et `{ to: "/admin/ai/usage", label: t("admin.nav.aiUsage"), Icon: BarChart3 }` (import `BarChart3` de lucide-react). Le special-case actif de `/admin` devient `/admin/ai`.

- [ ] **Step 5: Run — expect PASS + full admin suite green**

Run: `cd editor && npm test -- src/features/admin/AiModelsPage.test.tsx src/components/AdminSidebar.test.tsx`
Expected: PASS (mettre à jour `AdminSidebar.test.tsx` si il asserte l'ancienne entrée AI — adapter au nouveau label).

- [ ] **Step 6: Commit**

```bash
git add editor/src/features/admin/AiModelsPage.tsx editor/src/routes/admin.ai.tsx editor/src/routes/admin.index.tsx editor/src/components/AdminSidebar.tsx editor/src/features/admin/AiModelsPage.test.tsx editor/src/components/AdminSidebar.test.tsx
git commit -m "feat(editor): /admin/ai model catalog table + sidebar entries"
```

---

### Task 7: Édition/création de modèle (Sheet) + intégration dans la page

**Files:**
- Create: `editor/src/features/admin/AiModelForm.tsx`
- Modify: `editor/src/features/admin/AiModelsPage.tsx` (bouton "Nouveau" + Edit ouvrent le Sheet)
- Test: `editor/src/features/admin/AiModelForm.test.tsx`

**Interfaces:**
- Consumes: `createModel`, `updateModel`, `AiModelDto`, `AiModelInput` (Task 2), `Sheet` primitives, `FormField`, `Input`, `Button`, i18n.
- Produces: `<AiModelForm open onClose model?={AiModelDto | null} onSaved={() => void} />` — Sheet côté droit. `model` null = création. Champs : displayName, description, badge (`<select className="input">` cheap/balanced/premium), provider (`<select>` alimenté par `listProviders` — ou input libre + datalist), providerModelId, creditsPerMInput/Output (number), realUsd in/out **saisis en $/1M** (l'utilisateur tape `3.00`, on stocke `Math.round(dollars * 1_000_000)`), active (checkbox). Submit → `createModel`/`updateModel`, toast, `onSaved()`. Sur erreur `provider_key_missing` → toast `admin.ai.models.providerKeyMissing`.

- [ ] **Step 1: Test**

`AiModelForm.test.tsx` — mock `@/lib/api/adminModels` (`createModel`, `updateModel`, `listProviders`), mock sonner. Assert :
- création : remplir les champs, submit → `createModel` appelé avec le body attendu, **realUsd converti** (taper `3` dans le champ USD input → body `realUsdPerMInput: 3_000_000`) ;
- édition : `model` fourni pré-remplit les champs ; submit → `updateModel(id, patch)` ;
- erreur `provider_key_missing` → `toast.error` appelé.

```tsx
// key assertion for the USD conversion:
await userEvent.type(screen.getByLabelText(/real.*input|coût.*entrée/i), "3");
await userEvent.click(screen.getByRole("button", { name: /save|enregistrer/i }));
await waitFor(() => expect(createMock).toHaveBeenCalled());
expect(createMock.mock.calls[0][0].realUsdPerMInput).toBe(3_000_000);
```

- [ ] **Step 2: Run — expect FAIL**
Run: `cd editor && npm test -- src/features/admin/AiModelForm.test.tsx` → FAIL.

- [ ] **Step 3: Implement `AiModelForm.tsx`** (Sheet + controlled fields ; conversion USD `dollars → micro` à l'affichage `micro/1_000_000` et au submit `Math.round(dollars*1_000_000)`).

- [ ] **Step 4: Wire into `AiModelsPage`** — state `editing: AiModelDto | null | "new"`, bouton "Nouveau" en tête, Edit par ligne ; `onSaved` re-fetch `listModels`.

- [ ] **Step 5: Run — expect PASS**
Run: `cd editor && npm test -- src/features/admin/AiModelForm.test.tsx src/features/admin/AiModelsPage.test.tsx` → PASS.

- [ ] **Step 6: Commit**
```bash
git add editor/src/features/admin/AiModelForm.tsx editor/src/features/admin/AiModelsPage.tsx editor/src/features/admin/AiModelForm.test.tsx
git commit -m "feat(editor): ai model create/edit sheet with USD price entry"
```

---

### Task 8: Section Providers + Settings sur `/admin/ai`

**Files:**
- Create: `editor/src/features/admin/AiProvidersSection.tsx`, `editor/src/features/admin/AiSettingsSection.tsx`
- Modify: `editor/src/features/admin/AiModelsPage.tsx` (monter les deux sections sous la table)
- Delete: `editor/src/features/admin/AssistantConfigForm.tsx` + `AssistantConfigForm.test.tsx` ; `editor/src/lib/api/adminConfig.ts` + `adminConfig.test.ts` (remplacés)
- Test: `editor/src/features/admin/AiProvidersSection.test.tsx`, `editor/src/features/admin/AiSettingsSection.test.tsx`

**Interfaces:**
- Consumes: `listProviders`, `putProvider`, `getAiSettings`, `putAiSettings` (Task 2), `PROVIDER_PRESETS` labels via the DTO (`preset`/`label`), `Card`, `FormField`, `Input`, `Button`, i18n.
- Produces:
  - `AiProvidersSection` : une `Card` par provider (presets + custom stockés), champ baseUrl + champ apiKey write-only (placeholder "•••• set" si `keySet`), bouton Save → `putProvider`. Erreur 503 `encryption_not_configured` → toast `admin.ai.providers.encNotConfigured`. Bouton "Ajouter un provider custom" (slug + label + baseUrl + key).
  - `AiSettingsSection` : deux champs — `creditUsdMicroRate` (édité en $/credit lisible : afficher `micro/1_000_000`, stocker `Math.round(dollars*1_000_000)`), `maxCreditsPerTurn` (number, vide = null/uncapped). Save → `putAiSettings`.

- [ ] **Step 1: Tests** — mock `@/lib/api/adminModels` (providers+settings fns) + sonner. Providers : liste les presets, PUT sur save, toast 503. Settings : charge, édite maxCreditsPerTurn (vide→null), PUT.

- [ ] **Step 2: Run — expect FAIL** (`npm test -- src/features/admin/AiProvidersSection.test.tsx src/features/admin/AiSettingsSection.test.tsx`).

- [ ] **Step 3: Implement both sections** (mirror the old `AssistantConfigForm` field/save/toast pattern with `input`/`field-label`/`btn` classes; key write-only logic identical to old form).

- [ ] **Step 4: Mount under the table in `AiModelsPage`** (headings via `admin.ai.providers.title` / `admin.ai.settings.title`).

- [ ] **Step 5: Delete legacy** — remove `AssistantConfigForm.tsx`/`.test.tsx` and `adminConfig.ts`/`.test.ts`. Grep for remaining imports of either (`git grep AssistantConfigForm`, `git grep adminConfig`) and remove them (admin.index already redirected in Task 6).

- [ ] **Step 6: Run — expect PASS + full suite**
Run: `cd editor && npm test`
Expected: PASS (no dangling import of the deleted modules).

- [ ] **Step 7: Commit**
```bash
git add editor/src/features/admin/AiProvidersSection.tsx editor/src/features/admin/AiSettingsSection.tsx editor/src/features/admin/AiModelsPage.tsx editor/src/features/admin/AiProvidersSection.test.tsx editor/src/features/admin/AiSettingsSection.test.tsx
git rm editor/src/features/admin/AssistantConfigForm.tsx editor/src/features/admin/AssistantConfigForm.test.tsx editor/src/lib/api/adminConfig.ts editor/src/lib/api/adminConfig.test.ts
git commit -m "feat(editor): ai providers + settings sections, drop legacy AssistantConfigForm"
```

---

### Task 9: Page `/admin/ai/usage` — dashboards conso + marge

**Files:**
- Create: `editor/src/features/admin/AiUsagePage.tsx`, `editor/src/routes/admin.ai.usage.tsx`
- Test: `editor/src/features/admin/AiUsagePage.test.tsx`

**Interfaces:**
- Consumes: `getUsageSummary` (Task 3), `StatCard`/`HBar` (Task 4), `formatCredits`/`formatTokens`/`formatUsdFromMicro` (Task 1), i18n.
- Produces: la page dashboards. Sélecteur de période (boutons 7j/30j + inputs date custom → recompute `from`/`to` ISO). `StatCard` grid : tokens in, tokens out, credits facturés, coût réel (`formatUsdFromMicro`), **marge** (`tone` positive/negative selon signe), turns, errors. `HBar` lists : répartition par modèle (value=creditsCharged, max=Math.max(...)), par provider. Barres journalières : une rangée d'`HBar` (ou barres verticales simples) sur `daily` (value=creditsCharged). `noData` si tout vide.

- [ ] **Step 1: Test** — mock `@/lib/api/adminAiUsage`, render, assert : stat cards affichent les totaux formatés, marge négative a la classe danger, byModel/byProvider rendent des barres, changement de période re-fetch avec nouveaux from/to.

```tsx
// margin sign:
summaryMock.mockResolvedValue({ totals: { ...zero, marginMicroUsd: -500_000, creditsCharged: 100 }, byModel: [...], byProvider: [], daily: [] });
// assert the margin StatCard value node has --danger class
```

- [ ] **Step 2: Run — expect FAIL**.

- [ ] **Step 3: Implement `AiUsagePage.tsx`** (period state defaults to 30d ; `useEffect` on [from,to] → `getUsageSummary`).

- [ ] **Step 4: Route** `admin.ai.usage.tsx` — `createFileRoute("/admin/ai/usage")`, `max-w-5xl` shell, mounts `<AiUsagePage/>`.

- [ ] **Step 5: Run — expect PASS**.

- [ ] **Step 6: Commit**
```bash
git add editor/src/features/admin/AiUsagePage.tsx editor/src/routes/admin.ai.usage.tsx editor/src/features/admin/AiUsagePage.test.tsx
git commit -m "feat(editor): /admin/ai/usage dashboards (stats, margin, breakdowns)"
```

---

### Task 10: Page logs `/admin/ai/usage/logs` — filtres + CSV + détail

**Files:**
- Create: `editor/src/features/admin/AiLogsPage.tsx`, `editor/src/routes/admin.ai.usage.logs.tsx`
- Test: `editor/src/features/admin/AiLogsPage.test.tsx`

**Interfaces:**
- Consumes: `getUsageLogs`, `usageLogsCsvUrl` (Task 3), `Table` primitives, `formatCredits`/`formatUsdFromMicro`, i18n.
- Produces: table paginée. Barre de filtres (user id input, model id, provider, action, status select, from/to dates) → bouton Apply refetch (reset cursor). Colonnes : time (`toLocaleString(i18n.language)`), user/serverKey, model, provider, action, status `<Badge>`, tokens (in/out), credits, coût. "Load more" (cursor). Bouton Export CSV → ouvre `usageLogsCsvUrl(filters)` dans un nouvel onglet (`window.open` — le cookie part avec la requête). Clic ligne → détail (prompt_preview + errorMessage + lien "ouvrir la conversation" si `conversationId`... note: le DTO logs n'inclut pas conversationId ; afficher preview + error uniquement).

- [ ] **Step 1: Test** — mock `@/lib/api/adminAiUsage`, assert : logs rendus, filtre status appliqué re-appelle `getUsageLogs` avec `{status}`, "load more" appelle avec le `nextCursor`, bouton export construit l'URL CSV (mock `window.open`), clic ligne ouvre le détail avec le preview.

- [ ] **Step 2: Run — expect FAIL**.

- [ ] **Step 3: Implement `AiLogsPage.tsx`** (filters state, logs accumulés sur load-more, détail via `useState<UsageLogDto|null>` + `Dialog` ou ligne expandable).

- [ ] **Step 4: Route** `admin.ai.usage.logs.tsx` — `createFileRoute("/admin/ai/usage/logs")`, mounts `<AiLogsPage/>`. Ajouter un lien "Logs" depuis `AiUsagePage` (bouton en tête).

- [ ] **Step 5: Run — expect PASS**.

- [ ] **Step 6: Commit**
```bash
git add editor/src/features/admin/AiLogsPage.tsx editor/src/routes/admin.ai.usage.logs.tsx editor/src/features/admin/AiLogsPage.test.tsx
git commit -m "feat(editor): /admin/ai/usage/logs filterable table + CSV export"
```

---

### Task 11: Onglet AI sur le profil user (`UserProfile`) + grant de credits

**Files:**
- Modify: `editor/src/features/admin/UserProfile.tsx` (introduire `Tabs`, ajouter l'onglet AI)
- Create: `editor/src/features/admin/UserAiTab.tsx`
- Test: `editor/src/features/admin/UserAiTab.test.tsx`, mise à jour `UserProfile.test.tsx`

**Interfaces:**
- Consumes: `getUserFocus`, `grantCredits` (Task 3), `Tabs` primitives, `StatCard`/`HBar`, `formatCredits`/`formatTokens`/`formatUsdFromMicro`, i18n.
- Produces:
  - `UserProfile` gagne une structure `<Tabs defaultValue="profile">` : onglet "Profil" (les sections existantes identity/account/networks) + onglet "AI" (`admin.ai.user.tab`) montant `<UserAiTab userId={profile.id} />`.
  - `UserAiTab` : période (réutilise le pattern 7j/30j de la page usage — extraire un petit `usePeriodRange()` hook optionnel, sinon dupliquer), `StatCard` (turns, credits, tokens in/out), `HBar` par modèle. Section "Networks" : par network du user → nom, **solde** (`formatCredits`), historique grants (liste `delta`/`reason`/`note`/date), bouton **"Créditer"** → petit form inline (amount + note) appelant `grantCredits(networkId, amount, note)` → toast + refetch focus.

- [ ] **Step 1: Test `UserAiTab.test.tsx`** — mock `@/lib/api/adminAiUsage` + sonner. Assert : charge le focus, affiche turns/credits, liste les networks avec solde, le bouton Créditer soumet `grantCredits(networkId, amount, note)` et re-fetch. Erreur `invalid_amount` → toast.error.

- [ ] **Step 2: Run — expect FAIL**.

- [ ] **Step 3: Implement `UserAiTab.tsx`** + wrap `UserProfile` sections in `<Tabs>`.

- [ ] **Step 4: Update `UserProfile.test.tsx`** — les sections existantes sont maintenant sous l'onglet "Profil" (cliquer l'onglet si nécessaire ; ou `defaultValue="profile"` les rend visibles par défaut). Ajuster les queries si besoin.

- [ ] **Step 5: Run — expect PASS + full suite**
Run: `cd editor && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**
```bash
git add editor/src/features/admin/UserProfile.tsx editor/src/features/admin/UserAiTab.tsx editor/src/features/admin/UserAiTab.test.tsx editor/src/features/admin/UserProfile.test.tsx
git commit -m "feat(editor): user profile AI tab (usage focus + credit grant)"
```

---

### Task 12: Docs — editor-internals + rest-endpoints note + build check

**Files:**
- Modify: `docs/architecture/editor-internals.md` (section Design system : nouvelles primitives Table/StatCard/HBar ; nouvelles pages admin AI)
- Modify: `CHANGELOG.md` (`[Unreleased]`)

- [ ] **Step 1: editor-internals** — ajouter à la section Design system la mention des primitives `Table`/`StatCard`/`HBar` (spécimen `/admin/design`), et une courte sous-section "Admin AI" listant les pages (`/admin/ai`, `/admin/ai/usage`, `/admin/ai/usage/logs`, onglet AI du profil user) + leurs clients (`adminModels.ts`, `adminAiUsage.ts`).

- [ ] **Step 2: CHANGELOG** — sous `[Unreleased] ### Added` : "Panel admin système de modèles IA (éditeur) : catalogue `/admin/ai` (table + édition + test live + providers + settings), dashboards `/admin/ai/usage` (conso/marge/répartitions), logs filtrables + export CSV `/admin/ai/usage/logs`, onglet AI du profil user (conso + grant de credits). Nouvelles primitives design-system Table/StatCard/HBar."

- [ ] **Step 3: Build check**
Run: `cd editor && npm run build`
Expected: build succeeds (types OK, routes générées).

- [ ] **Step 4: Commit**
```bash
git add docs/architecture/editor-internals.md CHANGELOG.md
git commit -m "docs: admin ai model system UI (editor-internals, CHANGELOG)"
```
