# Console admin — plan 2 : config IA backend (loader DB→env + endpoints + branchement moteur)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps en checkbox (`- [ ]`).

**Goal:** Rendre la config IA éditable/lue côté backend : un store générique `app_settings`, un loader `loadAssistantProviderConfig()` (DB déchiffrée → env fallback), les endpoints admin `GET/PUT/POST /api/v1/admin/assistant-config` (gardés `requireAdmin`), et brancher le moteur (2d) sur ce loader.

**Architecture:** Backend (`backend/`):
- `lib/appSettings.ts` — `getSetting`/`setSetting` (clé → JSON).
- `modules/assistant/provider/dbConfig.ts` — `loadAssistantProviderConfig()` (DB `app_settings["assistant"]` déchiffrée, sinon `resolveProviderConfig(env)`).
- `modules/assistant/adminRoutes.ts` — sous-routeur `GET/PUT/POST .../assistant-config`.
- `app.ts` — `userAuth()` + `requireAdmin()` sur `/api/v1/admin/*` + montage du routeur admin.
- `modules/assistant/routes.ts` (2d) — `resolve()` utilise `loadAssistantProviderConfig`.

**Tech Stack:** Bun + Hono + Drizzle, `bun run test`.

> ⚠️ **JAMAIS `bun test` direct** — `bun run test [chemin]`.

**Prérequis :** plan 1 mergé (`isAdmin`, `requireAdmin`, `secretBox`, `app_settings`) + moteur 2a/2d.

---

### Task 1 : store `app_settings` — TDD

**Files:**
- Create: `backend/src/lib/appSettings.ts`
- Create: `backend/src/lib/appSettings.test.ts`

- [ ] **Step 1 : `appSettings.ts`** :
```ts
import { eq } from "drizzle-orm";
import { db } from "../db/index";
import { appSettings } from "../db/schema";

export async function getSetting<T = unknown>(key: string): Promise<T | null> {
  const rows = await db.select().from(appSettings).where(eq(appSettings.key, key));
  if (rows.length === 0) return null;
  try { return JSON.parse(rows[0].value) as T; } catch { return null; }
}

export async function setSetting(key: string, value: unknown, updatedBy: string | null): Promise<void> {
  const v = JSON.stringify(value);
  const now = new Date();
  await db.insert(appSettings)
    .values({ key, value: v, updatedAt: now, updatedBy })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: v, updatedAt: now, updatedBy } });
}
```

- [ ] **Step 2 : Test** (DB test) :
```ts
import { afterEach, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../db/index";
import { appSettings } from "../db/schema";
import { getSetting, setSetting } from "./appSettings";

afterEach(async () => { await db.delete(appSettings).where(eq(appSettings.key, "k_test")); });

describe("appSettings", () => {
  it("returns null for an absent key", async () => { expect(await getSetting("k_test")).toBeNull(); });
  it("round-trips a JSON value", async () => {
    await setSetting("k_test", { a: 1, b: "x" }, null);
    expect(await getSetting("k_test")).toEqual({ a: 1, b: "x" });
  });
  it("upserts (overwrites) on the same key", async () => {
    await setSetting("k_test", { v: 1 }, "user_1");
    await setSetting("k_test", { v: 2 }, "user_2");
    expect(await getSetting("k_test")).toEqual({ v: 2 });
  });
});
```
- [ ] **Step 3 : Run (PASS) + commit** `feat(backend): app_settings store (getSetting/setSetting)`.

---

### Task 2 : `loadAssistantProviderConfig` (DB→env) — TDD

**Files:**
- Modify: `backend/src/modules/assistant/provider/config.ts` (exporter les presets)
- Create: `backend/src/modules/assistant/provider/dbConfig.ts`
- Create: `backend/src/modules/assistant/provider/dbConfig.test.ts`

- [ ] **Step 1 : Exporter les presets de `config.ts`** — y ajouter (à partir du `PRESETS` interne) :
```ts
export function presetBaseUrl(provider: string | undefined): string {
  return (PRESETS[provider ?? "openai"] ?? PRESETS.openai).baseURL;
}
```
(Garder `resolveProviderConfig(env)` inchangé.)

- [ ] **Step 2 : `dbConfig.ts`** :
```ts
import { getSetting } from "../../../lib/appSettings";
import { decryptSecret, isSecretsConfigured } from "../../../lib/secretBox";
import { presetBaseUrl, resolveProviderConfig, type ProviderConfig } from "./config";

export const ASSISTANT_SETTING_KEY = "assistant";
export interface StoredAssistantConfig {
  provider?: string; baseUrl?: string; model?: string; apiKeyEncrypted?: string;
}

/** DB config (decrypted) when present & usable; otherwise the env fallback. */
export async function loadAssistantProviderConfig(): Promise<ProviderConfig | null> {
  const stored = await getSetting<StoredAssistantConfig>(ASSISTANT_SETTING_KEY);
  if (stored && isSecretsConfigured()) {
    const baseURL = stored.baseUrl || presetBaseUrl(stored.provider);
    const model = stored.model ?? "";
    let apiKey = "";
    if (stored.apiKeyEncrypted) { try { apiKey = decryptSecret(stored.apiKeyEncrypted); } catch { apiKey = ""; } }
    const isLocal = baseURL.includes("localhost") || baseURL.includes("127.0.0.1");
    if (model && (apiKey || isLocal)) return { baseURL, model, apiKey };
  }
  return resolveProviderConfig(process.env as Record<string, string | undefined>);
}
```

- [ ] **Step 3 : Test** (DB + secretBox) :
```ts
import { afterEach, beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../../../db/index";
import { appSettings } from "../../../db/schema";
import { setSetting } from "../../../lib/appSettings";
import { encryptSecret } from "../../../lib/secretBox";
import { ASSISTANT_SETTING_KEY, loadAssistantProviderConfig } from "./dbConfig";

beforeAll(() => { process.env.CONFIG_ENC_KEY = "0".repeat(64); });
afterEach(async () => {
  await db.delete(appSettings).where(eq(appSettings.key, ASSISTANT_SETTING_KEY));
  delete process.env.ASSISTANT_API_KEY; delete process.env.ASSISTANT_PROVIDER; delete process.env.ASSISTANT_MODEL;
});

describe("loadAssistantProviderConfig", () => {
  it("uses DB config with a decrypted key", async () => {
    await setSetting(ASSISTANT_SETTING_KEY, { provider: "deepseek", model: "deepseek-chat", apiKeyEncrypted: encryptSecret("sk-db") }, null);
    const cfg = await loadAssistantProviderConfig();
    expect(cfg).toEqual({ baseURL: "https://api.deepseek.com/v1", model: "deepseek-chat", apiKey: "sk-db" });
  });
  it("falls back to env when no DB config", async () => {
    process.env.ASSISTANT_API_KEY = "sk-env"; process.env.ASSISTANT_PROVIDER = "openai";
    const cfg = await loadAssistantProviderConfig();
    expect(cfg?.apiKey).toBe("sk-env");
    expect(cfg?.baseURL).toBe("https://api.openai.com/v1");
  });
});
```
- [ ] **Step 4 : Run (PASS) + commit** `feat(assistant): loadAssistantProviderConfig (DB over env)`.

---

### Task 3 : endpoints admin + montage + branchement moteur — TDD

**Files:**
- Create: `backend/src/modules/assistant/adminRoutes.ts`
- Create: `backend/src/modules/assistant/adminRoutes.test.ts`
- Modify: `backend/src/app.ts`
- Modify: `backend/src/modules/assistant/routes.ts`

- [ ] **Step 1 : `adminRoutes.ts`** :
```ts
import { Hono } from "hono";
import { getSetting, setSetting } from "../../lib/appSettings";
import { encryptSecret, isSecretsConfigured } from "../../lib/secretBox";
import { createProvider, presetBaseUrl } from "./provider/config";
import type { LlmProvider } from "./provider/types";
import { ASSISTANT_SETTING_KEY, type StoredAssistantConfig } from "./provider/dbConfig";

let testProvider: LlmProvider | null = null;
export function __setTestProviderForTests(p: LlmProvider | null): void { testProvider = p; }

export function buildAssistantAdminRouter(): Hono {
  const r = new Hono();

  r.get("/assistant-config", async (c) => {
    const stored = await getSetting<StoredAssistantConfig>(ASSISTANT_SETTING_KEY);
    return c.json({
      provider: stored?.provider ?? process.env.ASSISTANT_PROVIDER ?? "openai",
      baseUrl: stored?.baseUrl ?? "",
      model: stored?.model ?? process.env.ASSISTANT_MODEL ?? "",
      keySet: !!stored?.apiKeyEncrypted || !!process.env.ASSISTANT_API_KEY,
    });
  });

  r.put("/assistant-config", async (c) => {
    const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
    const provider = typeof body.provider === "string" ? body.provider : "openai";
    const baseUrl = typeof body.baseUrl === "string" ? body.baseUrl : "";
    const model = typeof body.model === "string" ? body.model : "";
    const apiKey = typeof body.apiKey === "string" ? body.apiKey : "";

    const prev = await getSetting<StoredAssistantConfig>(ASSISTANT_SETTING_KEY);
    let apiKeyEncrypted = prev?.apiKeyEncrypted; // keep existing if no new key
    if (apiKey) {
      if (!isSecretsConfigured()) return c.json({ error: "encryption_not_configured" }, 503);
      apiKeyEncrypted = encryptSecret(apiKey);
    }
    const next: StoredAssistantConfig = { provider, baseUrl, model, apiKeyEncrypted };
    await setSetting(ASSISTANT_SETTING_KEY, next, c.get("user")?.id ?? null);
    return c.json({ provider, baseUrl, model, keySet: !!apiKeyEncrypted });
  });

  r.post("/assistant-config/test", async (c) => {
    const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
    const provider = typeof body.provider === "string" ? body.provider : "openai";
    const baseURL = (typeof body.baseUrl === "string" && body.baseUrl) || presetBaseUrl(provider);
    const model = typeof body.model === "string" ? body.model : "";
    const apiKey = typeof body.apiKey === "string" ? body.apiKey : "";
    if (!model) return c.json({ ok: false, error: "model_required" });
    try {
      const prov = testProvider ?? createProvider({ baseURL, model, apiKey });
      let sawDone = false;
      for await (const ev of prov.streamTurn({ messages: [{ role: "user", content: "Reply with OK." }], tools: [], model })) {
        if (ev.type === "done") sawDone = true;
      }
      return c.json({ ok: sawDone });
    } catch (e) {
      return c.json({ ok: false, error: e instanceof Error ? e.message : "error" });
    }
  });

  return r;
}
```

- [ ] **Step 2 : Montage dans `app.ts`** — importer `requireAdmin` + `buildAssistantAdminRouter`, et ajouter :
```ts
app.use("/api/v1/admin/*", userAuth());
app.use("/api/v1/admin/*", requireAdmin());
app.route("/api/v1/admin", buildAssistantAdminRouter());
```

- [ ] **Step 3 : Brancher le moteur** — dans `routes.ts` (2d), remplacer le `resolve()` synchrone par async utilisant le loader DB :
```ts
import { loadAssistantProviderConfig } from "./provider/dbConfig";
// ...
async function resolve(): Promise<{ provider: LlmProvider; model: string } | null> {
  if (providerOverride) return { provider: providerOverride, model: "test-model" };
  const cfg = await loadAssistantProviderConfig();
  return cfg ? { provider: createProvider(cfg), model: cfg.model } : null;
}
```
et dans le handler messages : `const pm = await resolve();` (le reste inchangé). (`resolveProviderConfig`/`createProvider` imports restent.)

- [ ] **Step 4 : Tests `adminRoutes.test.ts`** — via `app` + session admin DB (suivre le pattern `routes.test.ts` 2d / `requireAdmin.test.ts` pour insérer un user admin + session) :
```ts
// beforeAll: CONFIG_ENC_KEY set; insert admin user + session (cookie artisan_user_session);
//            __setTestProviderForTests(fakeProvider yielding a done event).
// tests:
//  - GET /api/v1/admin/assistant-config without admin session -> 403
//  - PUT then GET: keySet=true, key never returned; provider/model persisted
//  - PUT with empty apiKey after a prior key -> keeps keySet true (key preserved)
//  - POST /assistant-config/test -> { ok: true } (fake provider)
```
(Le user doit avoir `isAdmin=true` à l'insert. Le cookie de session passe `userAuth`+`requireAdmin`.)

- [ ] **Step 5 : Run (PASS)** — `bun run test src/modules/assistant/ src/lib/appSettings.test.ts` (toute la suite assistant + lib verte). Commit `feat(assistant): admin config endpoints + engine reads DB config`.

---

### Task 4 : Docs

- [ ] **Step 1** — `docs/architecture/rest-endpoints.md` : `/api/v1/admin/assistant-config` (GET/PUT) + `/test` (POST), gardés requireAdmin. `CHANGELOG.md` `[Unreleased]` : config IA en DB (loader DB→env) + endpoints admin.
- [ ] **Step 2 : Commit** `docs(admin): plan 2 — config endpoints`.

---

## Self-review

- **DB→env** : `loadAssistantProviderConfig` lit la DB déchiffrée, retombe sur `resolveProviderConfig(env)` (inchangé) si absente / pas de `CONFIG_ENC_KEY`. ✓
- **Secret jamais exposé** : GET renvoie `keySet` (booléen), jamais la clé ; PUT ne l'écrase pas si champ vide ; `/test` n'inclut pas la clé dans l'erreur. ✓
- **Gardes** : `userAuth`+`requireAdmin` sur tout `/api/v1/admin/*`. ✓
- **Moteur branché** : `resolve()` (2d) passe par le loader → la config admin prend effet immédiatement (pas de redeploy). ✓
- **Testable** : provider injectable (`__setTestProviderForTests`) pour `/test` sans réseau. ✓
- **`bun run test` only.** ✓

## Suite

- **Plan 3 — UI `/admin`** : shell onglets + onglet IA (form provider/baseURL/model/clé write-only + bouton « Tester » → `/test` + Enregistrer → `PUT`) + entrée gardée par `isAdmin` (via `/me`) + i18n.
