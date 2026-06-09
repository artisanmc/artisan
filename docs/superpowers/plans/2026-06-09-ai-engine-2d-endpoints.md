# Feature IA — sous-plan 2d : endpoints SSE + état conversation (backend)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps en checkbox (`- [ ]`).

**Goal:** La couche HTTP qui rend le moteur utilisable : `POST /api/v1/assistant/conversations` (seed la working-copy depuis un snapshot `menu/v1` du pack), `POST /api/v1/assistant/conversations/:id/messages` (réponse **SSE** : map `EngineEvent`→SSE), sous l'**auth editor-session**. Met `buildSystemPrompt()` (2c) en tête des messages et lance `runTurn` (2b) avec le provider (2a). → **premier truc testable au curl** de bout en bout (avec une clé provider).

**Architecture:** `backend/src/modules/assistant/`:
- `conversations.ts` — `ConversationStore` (Map en mémoire : `{ id, serverKeyId, messages: LlmMessage[], wc: WorkingCopy }`).
- `routes.ts` — sous-routeur Hono : middleware auth (`validateAccessToken` via `Authorization: Bearer`), `POST /conversations`, `POST /conversations/:id/messages` (SSE via `streamSSE`). Hook `__setProviderForTests` pour injecter un provider en test.
- `index.ts` — `assistantModule: BackendModule` (registerRoutes → `app.route("/api/v1/assistant", …)`).
- `app.ts` — ajouter `assistantModule` à `mountModules`.

**Tech Stack:** Bun + Hono (`streamSSE` de `hono/streaming`), `bun run test`. Auth = `validateAccessToken` (`backend/src/lib/auth.ts`).

> ⚠️ **JAMAIS `bun test` direct** — `bun run test [chemin]` (wrapper). Le test d'intégration touche la DB (`artisan_test`) → Postgres doit tourner.

**Prérequis:** 2a+2b+2c mergés.

---

### Task 1 : `ConversationStore` — TDD (pur)

**Files:**
- Create: `backend/src/modules/assistant/conversations.ts`
- Create: `backend/src/modules/assistant/conversations.test.ts`

- [ ] **Step 1 : Test (RED)** :
```ts
import { describe, expect, it } from "bun:test";
import { ConversationStore } from "./conversations";

const menu = { schema: "menu/v1", id: "shop", title: [], size: 27, layers: [] };

describe("ConversationStore", () => {
  it("creates a conversation seeded with a system message + working-copy", () => {
    const s = new ConversationStore();
    const id = s.create({ menus: [menu], attachments: {}, serverKeyId: "srv_1" });
    const conv = s.get(id)!;
    expect(conv.serverKeyId).toBe("srv_1");
    expect(conv.messages[0].role).toBe("system");
    expect(conv.messages[0].content.length).toBeGreaterThan(100);
    expect(conv.wc.get("shop")).toBeTruthy();
  });
  it("returns undefined for unknown id", () => {
    expect(new ConversationStore().get("nope")).toBeUndefined();
  });
  it("reseed replaces the working-copy", () => {
    const s = new ConversationStore();
    const id = s.create({ menus: [], attachments: {}, serverKeyId: "srv_1" });
    s.reseed(s.get(id)!, [menu], {});
    expect(s.get(id)!.wc.get("shop")).toBeTruthy();
  });
});
```

- [ ] **Step 2 : Run (FAIL)** — `bun run test src/modules/assistant/conversations.test.ts`.

- [ ] **Step 3 : `conversations.ts`** :
```ts
import { WorkingCopy, type MenuV1 } from "./workingCopy";
import type { LlmMessage } from "./provider/types";
import { buildSystemPrompt } from "./grounding";

export interface Conversation {
  id: string;
  serverKeyId: string;
  messages: LlmMessage[];
  wc: WorkingCopy;
}

export class ConversationStore {
  private map = new Map<string, Conversation>();

  create(opts: { menus: MenuV1[]; attachments: Record<string, string>; serverKeyId: string }): string {
    const id = crypto.randomUUID();
    this.map.set(id, {
      id,
      serverKeyId: opts.serverKeyId,
      messages: [{ role: "system", content: buildSystemPrompt() }],
      wc: new WorkingCopy(opts.menus, opts.attachments),
    });
    return id;
  }
  get(id: string): Conversation | undefined { return this.map.get(id); }
  reseed(conv: Conversation, menus: MenuV1[], attachments: Record<string, string>): void {
    conv.wc = new WorkingCopy(menus, attachments);
  }
}
```

- [ ] **Step 4 : Run (PASS) + commit** `feat(assistant): in-memory conversation store`.

---

### Task 2 : routes (auth + SSE) + module + register — TDD

**Files:**
- Create: `backend/src/modules/assistant/routes.ts`
- Create: `backend/src/modules/assistant/index.ts`
- Create: `backend/src/modules/assistant/routes.test.ts`
- Modify: `backend/src/app.ts`

- [ ] **Step 1 : `routes.ts`** :
```ts
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { validateAccessToken } from "../../lib/auth";
import { resolveProviderConfig, createProvider } from "./provider/config";
import type { LlmProvider } from "./provider/types";
import { runTurn } from "./loop";
import { ConversationStore } from "./conversations";

const store = new ConversationStore();

let providerOverride: LlmProvider | null = null;
/** Test hook: inject a fake provider (and skip env resolution). */
export function __setProviderForTests(p: LlmProvider | null): void { providerOverride = p; }

function resolve(): { provider: LlmProvider; model: string } | null {
  if (providerOverride) return { provider: providerOverride, model: "test-model" };
  const cfg = resolveProviderConfig(process.env as Record<string, string | undefined>);
  return cfg ? { provider: createProvider(cfg), model: cfg.model } : null;
}

export function buildAssistantRouter(): Hono {
  const r = new Hono();

  r.use("*", async (c, next) => {
    const h = c.req.header("Authorization");
    const token = h?.startsWith("Bearer ") ? h.slice(7) : "";
    const session = token ? await validateAccessToken(token) : null;
    if (!session) return c.json({ error: "Unauthorized" }, 401);
    c.set("serverKeyId", session.serverKeyId);
    return next();
  });

  r.post("/conversations", async (c) => {
    const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
    const menus = Array.isArray((body as any).menus) ? (body as any).menus : [];
    const attachments = (body as any).attachments && typeof (body as any).attachments === "object" ? (body as any).attachments : {};
    const id = store.create({ menus, attachments, serverKeyId: c.get("serverKeyId") as string });
    return c.json({ conversationId: id });
  });

  r.post("/conversations/:id/messages", async (c) => {
    const conv = store.get(c.req.param("id"));
    if (!conv || conv.serverKeyId !== (c.get("serverKeyId") as string)) return c.json({ error: "Not found" }, 404);
    const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
    if (Array.isArray((body as any).menus)) store.reseed(conv, (body as any).menus, (body as any).attachments ?? {});
    const pm = resolve();
    if (!pm) return c.json({ error: "Assistant disabled: no provider configured (set ASSISTANT_API_KEY)." }, 503);

    conv.messages.push({ role: "user", content: typeof (body as any).text === "string" ? (body as any).text : "" });

    return streamSSE(c, async (stream) => {
      try {
        for await (const ev of runTurn({ provider: pm.provider, model: pm.model, messages: conv.messages, wc: conv.wc })) {
          await stream.writeSSE({ event: ev.type, data: JSON.stringify(ev) });
        }
      } catch (e) {
        await stream.writeSSE({ event: "error", data: JSON.stringify({ message: e instanceof Error ? e.message : String(e) }) });
      }
    });
  });

  return r;
}
```

- [ ] **Step 2 : `index.ts`** :
```ts
import type { Hono } from "hono";
import type { BackendModule } from "../api/types";
import { buildAssistantRouter } from "./routes";

export const assistantModule: BackendModule = {
  id: "assistant",
  schemaVersion: "menu/v1",
  registerRoutes: (app: Hono) => {
    app.route("/api/v1/assistant", buildAssistantRouter());
  },
};
```

- [ ] **Step 3 : Register dans `app.ts`** — importer `assistantModule` et l'ajouter : `mountModules(app, [menusModule, commandsModule, assistantModule]);`.

- [ ] **Step 4 : Test (RED→GREEN)** — `routes.test.ts`. Auth 401 (sans DB) + intégration SSE (avec session DB + fake provider) :
```ts
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { app } from "../../app";
import { __setProviderForTests } from "./routes";
import type { LlmProvider, LlmStreamEvent } from "./provider/types";
import { db } from "../../db/index";
import { editorSessions, serverKeys } from "../../db/schema";
import { eq } from "drizzle-orm";

const validMenu = { schema: "menu/v1", id: "shop", title: [{ kind: "plain", value: { key: "k" } }], size: 27, layers: [{ id: "l1", name: "d", elements: [{ id: "e1", positions: "0", appearances: [{ material: "STONE" }] }] }] };

const scripted: LlmStreamEvent[][] = [
  [{ type: "tool_use", id: "c1", name: "upsert_menu", input: { menu: validMenu } }, { type: "done", stopReason: "tool_calls" }],
  [{ type: "text", text: "Created the shop." }, { type: "done", stopReason: "end_turn" }],
];
function fakeProvider(): LlmProvider {
  let i = 0;
  return { async *streamTurn() { const t = scripted[i++] ?? [{ type: "done", stopReason: "end_turn" }]; for (const e of t) yield e; } };
}

// Minimal valid session in the test DB. (Adapt column names to schema.ts:
// serverKeys + editorSessions — follow editorSession.test.ts for the exact
// required columns/inserts. Token must satisfy validateAccessToken:
// not expired, not revoked, accessExpiresAt in the future, accessToken set.)
const SRV = "srv_test_assistant";
const ACCESS = "acc_test_assistant_token";
beforeAll(async () => {
  await db.insert(serverKeys).values({ id: SRV, /* ...required cols per schema */ } as never).onConflictDoNothing();
  const future = new Date(Date.now() + 60 * 60 * 1000);
  await db.insert(editorSessions).values({
    token: "url_test_assistant", serverKeyId: SRV, accessToken: ACCESS,
    accessExpiresAt: future, expiresAt: future, /* ...other required cols */
  } as never).onConflictDoNothing();
  __setProviderForTests(fakeProvider());
});
afterAll(async () => {
  __setProviderForTests(null);
  await db.delete(editorSessions).where(eq(editorSessions.token, "url_test_assistant"));
  await db.delete(serverKeys).where(eq(serverKeys.id, SRV));
});

const auth = { Authorization: `Bearer ${ACCESS}`, "Content-Type": "application/json" };

describe("assistant routes", () => {
  it("401 without a valid token", async () => {
    const res = await app.request("/api/v1/assistant/conversations", { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } });
    expect(res.status).toBe(401);
  });

  it("creates a conversation and streams engine events for a message", async () => {
    const created = await app.request("/api/v1/assistant/conversations", { method: "POST", headers: auth, body: JSON.stringify({ menus: [], attachments: {} }) });
    expect(created.status).toBe(200);
    const { conversationId } = await created.json();
    expect(typeof conversationId).toBe("string");

    const res = await app.request(`/api/v1/assistant/conversations/${conversationId}/messages`, { method: "POST", headers: auth, body: JSON.stringify({ text: "make a shop" }) });
    expect(res.status).toBe(200);
    const sse = await res.text();
    expect(sse).toContain("event: menu_written");
    expect(sse).toContain("event: done");
  });
});
```

- [ ] **Step 5 : Run**

Run (working_directory `backend`): `bun run test src/modules/assistant/routes.test.ts`.
Expected : PASS. **Si les inserts DB échouent** (colonnes requises), ouvrir `backend/src/db/schema.ts` (`serverKeys`, `editorSessions`) et/ou `backend/src/routes/editorSession.test.ts` et reproduire **exactement** les colonnes/inserts requis (FKs, NOT NULL). Le token doit passer `validateAccessToken` (cf. `lib/auth.ts` : `expiresAt` futur, pas `revokedAt`, `accessExpiresAt` futur, `accessToken` = ACCESS).

- [ ] **Step 6 : Commit**

```bash
git add backend/src/modules/assistant/routes.ts backend/src/modules/assistant/index.ts backend/src/modules/assistant/routes.test.ts backend/src/app.ts
git commit -m "feat(assistant): SSE endpoints (conversations/messages) + module registration"
```

---

### Task 3 : suite + docs + curl manuel

**Files:** Modify `docs/architecture/rest-endpoints.md`, `CHANGELOG.md`.

- [ ] **Step 1 : Suite assistant verte** — `bun run test src/modules/assistant/` → tout vert (provider + validate + tools + loop + grounding + conversations + routes ; le smoke 2a reste skip).

- [ ] **Step 2 : Docs**
- `docs/architecture/rest-endpoints.md` : ajouter `/api/v1/assistant/conversations` (POST) + `/api/v1/assistant/conversations/:id/messages` (POST, SSE) — auth editor-session (Bearer access token), events SSE (`text`/`tool`/`menu_written`/`menu_deleted`/`usage`/`error`/`done`).
- `CHANGELOG.md` `[Unreleased]` : endpoints assistant SSE + module enregistré.

- [ ] **Step 3 : Vérification curl manuelle (doc, pas un test auto)** — ajouter un court bloc dans `docs/architecture/modules.md` §assistant : comment tester en réel —
  ```
  # avec un provider configuré (.env: ASSISTANT_PROVIDER, ASSISTANT_API_KEY, ASSISTANT_MODEL)
  # et un access token editor-session valide ($ACCESS) :
  curl -sN -X POST localhost:3001/api/v1/assistant/conversations -H "Authorization: Bearer $ACCESS" -H 'Content-Type: application/json' -d '{"menus":[],"attachments":{}}'
  # -> {"conversationId":"..."}
  curl -sN -X POST localhost:3001/api/v1/assistant/conversations/$CID/messages -H "Authorization: Bearer $ACCESS" -H 'Content-Type: application/json' -d '{"text":"Crée un menu shop 3 lignes avec un bouton diamant qui ouvre le menu spawn"}'
  # -> flux SSE: text..., menu_written, done
  ```

- [ ] **Step 4 : Commit** `docs(assistant): engine 2d — SSE endpoints + rest-endpoints + curl`.

---

## Self-review

- **Premier bout-en-bout testable** : routes → buildSystemPrompt + runTurn + provider ; test d'intégration via `app.request` lit le flux SSE (provider mocké, hermétique). ✓
- **Auth** : `validateAccessToken` (Bearer access token) ; scope `serverKeyId` ; conversation liée au serverKeyId (404 cross-scope). ✓
- **Provider injectable** (`__setProviderForTests`) pour des tests sans réseau ; en prod `resolveProviderConfig(env)`, 503 si non configuré. ✓
- **État conversation en mémoire** (re-seedable) — pas de persistance (cf. non-goals spec). ✓
- **`bun run test` only.** ✓
- **Open items (3/4)** : débit crédits sur les events `usage` (middleware autour de `runTurn`) ; panel éditeur consomme le SSE + applique `menu_written` via `menuV1ToDomain`.

## Suite

- **3 — crédits** : ledger + débit sur `usage` (pré-check avant le tour, blocage à zéro) + octroi admin.
- **4 — panel éditeur** : chat + file-drop + client SSE → applique `menu_written`/`menu_deleted` via le convertisseur (action accountStore) + checkpoint/undo.
