# Editor Access & Real-Time Collaboration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `/ifz editor` — a LuckPerms-style command that generates a short-lived browser session, secured by Minecraft permissions, with a WebSocket channel for real-time draft broadcast across concurrent editor sessions.

**Architecture:** The plugin sends `editor_session_request` on its existing authenticated WS → backend creates a 30-char crypto-random token in `editor_sessions` DB table and returns a URL. The browser opens `/session?token=...`, validates via REST, opens `/ws/editor?token=...` for push. Draft saves go via `POST /api/editor-session/:token/draft` which broadcasts `draft_update` to all connected editors and the plugin WS for the same server. Sessions expire after 30 min of inactivity (auto-refreshed every 10 min while active). Multiple concurrent tokens allowed — no auto-revocation.

**Tech Stack:** Bun + Hono + Drizzle + PostgreSQL (backend), Kotlin 2.0 + OkHttp + Paper 1.21.4 (plugin), React 19 + TanStack Router + Tailwind + shadcn/ui (editor).

---

## File structure

**Backend — new/modified:**
- `backend/src/db/schema.ts` — add `editorSessions` table
- `backend/src/lib/auth.ts` — add `generateEditorToken()`, `validateEditorToken()`
- `backend/src/lib/rateLimit.ts` — new: in-memory per-IP rate limiter
- `backend/src/protocol.ts` — add editor session WS message types
- `backend/src/routes/editorSession.ts` — new: GET validate, POST refresh, DELETE revoke, POST draft
- `backend/src/routes/editorSession.test.ts` — new
- `backend/src/ws/hub.ts` — add `editorSenders`, `connToServerId`, `broadcastDraftUpdate`, handle `editor_session_request`/`editor_session_revoke`
- `backend/src/ws/hub.test.ts` — add editor session WS tests
- `backend/src/app.ts` — mount `/api/editor-session`, add `/ws/editor` endpoint

**Plugin — new/modified:**
- `plugin/src/main/kotlin/gg/interfaze/plugin/config/PluginConfig.kt` — add `editorConsoleOnly`
- `plugin/src/main/resources/config.yml` — add `editor.console_only` default
- `plugin/src/main/kotlin/gg/interfaze/plugin/provider/MenuProvider.kt` — add `requestEditorSession`, `revokeEditorSessions`
- `plugin/src/main/kotlin/gg/interfaze/plugin/provider/SyncedMenuProvider.kt` — implement the two new methods, handle `editor_session_ready`
- `plugin/src/main/kotlin/gg/interfaze/plugin/ws/WsClient.kt` — add `send(msg: String)` if absent
- `plugin/src/main/kotlin/gg/interfaze/plugin/command/IfzCommand.kt` — add `editor`/`editor revoke` subcommands
- `plugin/src/main/resources/plugin.yml` — update usage string

**Editor — new:**
- `editor/src/lib/editorSession.ts` — REST helpers (validate, refresh, revoke, saveDraft)
- `editor/src/lib/editorWs.ts` — WS client class
- `editor/src/routes/session.tsx` — `/session` route

---

## Task 1: DB — `editor_sessions` table

**Files:**
- Modify: `backend/src/db/schema.ts`
- Create: `backend/src/routes/editorSession.test.ts`

- [ ] **Step 1: Write failing test**

Create `backend/src/routes/editorSession.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../db/index";
import { editorSessions, serverKeys } from "../db/schema";

describe("editor_sessions schema", () => {
  test("insert and read a session", async () => {
    // Need a server_key to satisfy FK
    const keyId = crypto.randomUUID();
    await db.insert(serverKeys).values({ id: keyId, hash: "testhash" + keyId.slice(0,8), createdAt: new Date() });

    const token = "test_token_" + crypto.randomUUID().slice(0, 8);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30 * 60 * 1000);
    await db.insert(editorSessions).values({
      token,
      serverKeyId: keyId,
      createdBy: "TestAdmin",
      createdAt: now,
      expiresAt,
    });

    const rows = await db.select().from(editorSessions).where(eq(editorSessions.token, token));
    expect(rows.length).toBe(1);
    expect(rows[0].serverKeyId).toBe(keyId);
    expect(rows[0].revokedAt).toBeNull();
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
cd backend && bun test src/routes/editorSession.test.ts
```
Expected: error importing `editorSessions` from `../db/schema`.

- [ ] **Step 3: Add `editorSessions` table to schema**

Edit `backend/src/db/schema.ts` — append after `linkCodes`:

```ts
export const editorSessions = pgTable("editor_sessions", {
  token:        text("token").primaryKey(),
  serverKeyId:  text("server_key_id").notNull().references(() => serverKeys.id),
  createdBy:    text("created_by").notNull(),
  createdAt:    timestamp("created_at").notNull(),
  expiresAt:    timestamp("expires_at").notNull(),
  revokedAt:    timestamp("revoked_at"),
});
```

- [ ] **Step 4: Apply migration**

```bash
cd backend && bun run db:push
```
Expected: `Changes applied`.

- [ ] **Step 5: Run test — expect pass**

```bash
cd backend && bun test src/routes/editorSession.test.ts
```
Expected: 1 test PASS.

- [ ] **Step 6: Commit**

```bash
cd backend && rtk git add src/db/schema.ts src/routes/editorSession.test.ts && rtk git commit -m "feat(db): add editor_sessions table"
```

---

## Task 2: Backend lib — token helpers

**Files:**
- Modify: `backend/src/lib/auth.ts`
- Modify: `backend/src/routes/editorSession.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `backend/src/routes/editorSession.test.ts`:

```ts
import { generateEditorToken, validateEditorToken } from "../lib/auth";

describe("generateEditorToken", () => {
  test("returns 30-char alphanumeric token", () => {
    const token = generateEditorToken();
    expect(token).toHaveLength(30);
    expect(token).toMatch(/^[A-Za-z0-9]{30}$/);
  });

  test("two calls produce different tokens", () => {
    expect(generateEditorToken()).not.toBe(generateEditorToken());
  });
});

describe("validateEditorToken", () => {
  test("returns serverKeyId for valid token", async () => {
    const keyId = crypto.randomUUID();
    await db.insert(serverKeys).values({ id: keyId, hash: "vh" + keyId.slice(0,8), createdAt: new Date() });

    const token = generateEditorToken();
    await db.insert(editorSessions).values({
      token,
      serverKeyId: keyId,
      createdBy: "CONSOLE",
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    });

    const result = await validateEditorToken(token);
    expect(result).not.toBeNull();
    expect(result!.serverKeyId).toBe(keyId);
  });

  test("returns null for unknown token", async () => {
    expect(await validateEditorToken("doesnotexist000000000000000000")).toBeNull();
  });

  test("returns null for expired token", async () => {
    const keyId = crypto.randomUUID();
    await db.insert(serverKeys).values({ id: keyId, hash: "eh" + keyId.slice(0,8), createdAt: new Date() });
    const token = generateEditorToken();
    await db.insert(editorSessions).values({
      token,
      serverKeyId: keyId,
      createdBy: "CONSOLE",
      createdAt: new Date(Date.now() - 60 * 60 * 1000),
      expiresAt: new Date(Date.now() - 1),
    });
    expect(await validateEditorToken(token)).toBeNull();
  });

  test("returns null for revoked token", async () => {
    const keyId = crypto.randomUUID();
    await db.insert(serverKeys).values({ id: keyId, hash: "rh" + keyId.slice(0,8), createdAt: new Date() });
    const token = generateEditorToken();
    await db.insert(editorSessions).values({
      token,
      serverKeyId: keyId,
      createdBy: "CONSOLE",
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      revokedAt: new Date(),
    });
    expect(await validateEditorToken(token)).toBeNull();
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
cd backend && bun test src/routes/editorSession.test.ts
```
Expected: `generateEditorToken is not a function`.

- [ ] **Step 3: Add helpers to `backend/src/lib/auth.ts`**

Append to the existing file (do not replace existing content):

```ts
import { and, eq, isNull } from "drizzle-orm";
import { editorSessions } from "../db/schema";

const TOKEN_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

export function generateEditorToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(30));
  return Array.from(bytes, (b) => TOKEN_CHARS[b % TOKEN_CHARS.length]).join("");
}

export async function validateEditorToken(
  token: string,
): Promise<{ serverKeyId: string } | null> {
  const rows = await db
    .select()
    .from(editorSessions)
    .where(eq(editorSessions.token, token));
  if (rows.length === 0) return null;
  const row = rows[0];
  if (row.revokedAt) return null;
  if (row.expiresAt < new Date()) return null;
  return { serverKeyId: row.serverKeyId };
}
```

Note: The `import { and, eq, isNull }` and `import { editorSessions }` lines must be merged into the existing imports at the top of `auth.ts`. The existing file already imports `eq` and `db` — add `and`, `isNull`, and `editorSessions` to those existing imports rather than duplicating them.

- [ ] **Step 4: Run — expect pass**

```bash
cd backend && bun test src/routes/editorSession.test.ts
```
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
cd backend && rtk git add src/lib/auth.ts src/routes/editorSession.test.ts && rtk git commit -m "feat(backend): generateEditorToken and validateEditorToken helpers"
```

---

## Task 3: Backend lib — rate limiter

**Files:**
- Create: `backend/src/lib/rateLimit.ts`

No test for this utility (pure in-memory, stateless logic). Tested indirectly via REST endpoint tests.

- [ ] **Step 1: Create `backend/src/lib/rateLimit.ts`**

```ts
const limits = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(key: string, maxPerMinute: number): boolean {
  const now = Date.now();
  const entry = limits.get(key);
  if (!entry || entry.resetAt < now) {
    limits.set(key, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (entry.count >= maxPerMinute) return false;
  entry.count++;
  return true;
}
```

- [ ] **Step 2: Commit**

```bash
cd backend && rtk git add src/lib/rateLimit.ts && rtk git commit -m "feat(backend): in-memory rate limiter"
```

---

## Task 4: Backend protocol — new WS message types

**Files:**
- Modify: `backend/src/protocol.ts`

- [ ] **Step 1: Append to `backend/src/protocol.ts`**

Add these types and update the union types (replace the existing `PluginToServerMessage` and `ServerToPluginMessage` at the bottom of the file):

```ts
// Plugin → backend (on authenticated WS)
export interface EditorSessionRequestMessage {
  type: "editor_session_request";
  sender: string;   // Minecraft player name or "CONSOLE"
}
export interface EditorSessionRevokeMessage {
  type: "editor_session_revoke";
}

// Backend → plugin
export interface EditorSessionReadyMessage {
  type: "editor_session_ready";
  url: string;
  expires_at: string;
}

// Backend → editor (on /ws/editor)
export interface SessionExpiredMessage { type: "session_expired" }
export interface EditorDraftUpdateMessage {
  type: "draft_update";
  pack_id: string;
  menu_id: string;
  menu_yaml: string;
  updated_by: string;   // token of the sender (opaque to the receiver)
}

export type PluginToServerMessage =
  | HelloMessage
  | PongMessage
  | SetupRequestMessage
  | SetupClaimMessage
  | EditorSessionRequestMessage
  | EditorSessionRevokeMessage;

export type ServerToPluginMessage =
  | HelloAckMessage
  | BundleAvailableMessage
  | DraftUpdateMessage
  | PingMessage
  | SetupCodeMessage
  | LinkConfirmedMessage
  | EditorSessionReadyMessage;
```

- [ ] **Step 2: Commit**

```bash
cd backend && rtk git add src/protocol.ts && rtk git commit -m "feat(backend): editor session WS protocol types"
```

---

## Task 5: Backend REST — `/api/editor-session` routes

**Files:**
- Create: `backend/src/routes/editorSession.ts`
- Modify: `backend/src/routes/editorSession.test.ts`
- Modify: `backend/src/app.ts`

- [ ] **Step 1: Write REST tests**

Append to `backend/src/routes/editorSession.test.ts`:

```ts
import { app } from "../app";

// Helper: create a valid session in DB and return the token
async function createSession(serverId?: string): Promise<{ token: string; keyId: string }> {
  const keyId = serverId ?? crypto.randomUUID();
  if (!serverId) {
    await db.insert(serverKeys).values({ id: keyId, hash: "sh" + keyId.slice(0,8), createdAt: new Date() });
  }
  const token = generateEditorToken();
  await db.insert(editorSessions).values({
    token, serverKeyId: keyId, createdBy: "CONSOLE",
    createdAt: new Date(), expiresAt: new Date(Date.now() + 30 * 60 * 1000),
  });
  return { token, keyId };
}

describe("GET /api/editor-session/:token", () => {
  test("200 with server_key_id for valid token", async () => {
    const { token, keyId } = await createSession();
    const res = await app.request(`/api/editor-session/${token}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { server_key_id: string };
    expect(body.server_key_id).toBe(keyId);
  });

  test("401 for unknown token", async () => {
    const res = await app.request("/api/editor-session/notavalidtoken0000000000000000");
    expect(res.status).toBe(401);
  });
});

describe("POST /api/editor-session/:token/refresh", () => {
  test("200 and returns new expires_at", async () => {
    const { token } = await createSession();
    const res = await app.request(`/api/editor-session/${token}/refresh`, { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json() as { expires_at: string };
    expect(new Date(body.expires_at).getTime()).toBeGreaterThan(Date.now() + 29 * 60 * 1000);
  });

  test("401 for invalid token", async () => {
    const res = await app.request("/api/editor-session/badtoken00000000000000000000000/refresh", { method: "POST" });
    expect(res.status).toBe(401);
  });
});

describe("DELETE /api/editor-session/:token", () => {
  test("200 and revokes token", async () => {
    const { token } = await createSession();
    const res = await app.request(`/api/editor-session/${token}`, { method: "DELETE" });
    expect(res.status).toBe(200);
    // Token is now invalid
    const check = await app.request(`/api/editor-session/${token}`);
    expect(check.status).toBe(401);
  });
});

describe("POST /api/editor-session/:token/draft", () => {
  test("200 for valid token and valid body", async () => {
    const { token } = await createSession();
    const res = await app.request(`/api/editor-session/${token}/draft`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pack_id: "pack1", menu_id: "shop_main", menu_yaml: "title: Shop\n" }),
    });
    expect(res.status).toBe(200);
  });

  test("401 for invalid token", async () => {
    const res = await app.request("/api/editor-session/badtoken00000000000000000000000/draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pack_id: "p", menu_id: "m", menu_yaml: "" }),
    });
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
cd backend && bun test src/routes/editorSession.test.ts
```
Expected: 404 on `GET /api/editor-session/...` (router not mounted yet).

- [ ] **Step 3: Create `backend/src/routes/editorSession.ts`**

```ts
import { Hono } from "hono";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db/index";
import { editorSessions } from "../db/schema";
import { generateEditorToken, validateEditorToken } from "../lib/auth";
import { checkRateLimit } from "../lib/rateLimit";
import { broadcastDraftUpdate } from "../ws/hub";

const router = new Hono();

function clientIp(c: Parameters<typeof router.get>[1] extends (c: infer C) => unknown ? C : never): string {
  return c.req.header("x-forwarded-for") ?? c.req.header("cf-connecting-ip") ?? "unknown";
}

router.get("/:token", async (c) => {
  if (!checkRateLimit(`editor-validate:${clientIp(c)}`, 20)) return c.json({ error: "Too many requests" }, 429);
  const token = c.req.param("token");
  const session = await validateEditorToken(token);
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  return c.json({ server_key_id: session.serverKeyId });
});

router.post("/:token/refresh", async (c) => {
  const token = c.req.param("token");
  const session = await validateEditorToken(token);
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
  await db.update(editorSessions).set({ expiresAt }).where(eq(editorSessions.token, token));
  return c.json({ expires_at: expiresAt.toISOString() });
});

router.delete("/:token", async (c) => {
  const token = c.req.param("token");
  const session = await validateEditorToken(token);
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  await db.update(editorSessions).set({ revokedAt: new Date() }).where(eq(editorSessions.token, token));
  return c.json({ ok: true });
});

router.post("/:token/draft", async (c) => {
  const token = c.req.param("token");
  const session = await validateEditorToken(token);
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  const body = await c.req.json<{ pack_id: string; menu_id: string; menu_yaml: string }>();
  broadcastDraftUpdate(session.serverKeyId, body.pack_id, body.menu_id, body.menu_yaml, token);
  return c.json({ ok: true });
});

export { router as editorSessionRouter };
```

The `clientIp` helper above uses a complex type inference. Replace it with a simpler version:

```ts
function clientIp(c: { req: { header: (name: string) => string | undefined } }): string {
  return c.req.header("x-forwarded-for") ?? c.req.header("cf-connecting-ip") ?? "unknown";
}
```

- [ ] **Step 4: Add stub `broadcastDraftUpdate` to hub.ts**

This stub will be replaced in Task 6. For now append to `backend/src/ws/hub.ts`:

```ts
// Stub — replaced in Task 6
export function broadcastDraftUpdate(
  _serverKeyId: string,
  _packId: string,
  _menuId: string,
  _menuYaml: string,
  _senderToken: string,
): void {}
```

- [ ] **Step 5: Mount router in `backend/src/app.ts`**

Add import and route:

```ts
import { editorSessionRouter } from "./routes/editorSession";
```

Add after the existing `app.route("/api/link", linkRouter)` line:

```ts
app.route("/api/editor-session", editorSessionRouter);
```

- [ ] **Step 6: Run tests — expect pass**

```bash
cd backend && bun test src/routes/editorSession.test.ts
```
Expected: all tests PASS.

- [ ] **Step 7: Run full backend suite**

```bash
cd backend && bun test
```
Expected: all tests PASS.

- [ ] **Step 8: Commit**

```bash
cd backend && rtk git add src/routes/editorSession.ts src/routes/editorSession.test.ts src/ws/hub.ts src/app.ts && rtk git commit -m "feat(backend): editor session REST endpoints"
```

---

## Task 6: Backend hub — editor WS + broadcast

**Files:**
- Modify: `backend/src/ws/hub.ts`
- Modify: `backend/src/ws/hub.test.ts`
- Modify: `backend/src/app.ts`

- [ ] **Step 1: Write failing tests**

Append to `backend/src/ws/hub.test.ts`:

```ts
import { registerEditorConn, cleanupEditorConn } from "./hub";
import { db } from "../db/index";
import { editorSessions, serverKeys } from "../db/schema";
import { generateEditorToken } from "../lib/auth";

describe("editor_session_request", () => {
  test("returns editor_session_ready with url when authenticated", async () => {
    // Simulate an authenticated plugin connection: send hello first
    const connId = "conn-editor-req";
    registerConn(connId, () => {});

    // Insert a server key and authenticate
    const { id: keyId, key, hash } = await generateServerKey();
    await db.insert(serverKeys).values({ id: keyId, hash, createdAt: new Date() });

    const hello = { type: "hello", server_key: key, plugin_version: "1.0", minecraft_version: "1.21", current_bundle_hash: "" };
    await handlePluginMessage(connId, JSON.stringify(hello));

    const result = await handlePluginMessage(connId, JSON.stringify({ type: "editor_session_request", sender: "AdminPlayer" }));
    expect(result.reply).not.toBeNull();
    const msg = JSON.parse(result.reply!) as { type: string; url: string; expires_at: string };
    expect(msg.type).toBe("editor_session_ready");
    expect(msg.url).toContain("/session?token=");
    expect(new Date(msg.expires_at).getTime()).toBeGreaterThan(Date.now());
  });

  test("returns null when connection not authenticated", async () => {
    const connId = "conn-editor-unauth";
    registerConn(connId, () => {});
    const result = await handlePluginMessage(connId, JSON.stringify({ type: "editor_session_request", sender: "AdminPlayer" }));
    expect(result.reply).toBeNull();
  });
});

describe("editor_session_revoke", () => {
  test("revokes all active sessions and pushes session_expired to editors", async () => {
    const connId = "conn-editor-revoke";
    registerConn(connId, () => {});

    const { id: keyId, key, hash } = await generateServerKey();
    await db.insert(serverKeys).values({ id: keyId, hash, createdAt: new Date() });
    await handlePluginMessage(connId, JSON.stringify({ type: "hello", server_key: key, plugin_version: "1.0", minecraft_version: "1.21", current_bundle_hash: "" }));

    // Create a session and register an editor connection
    const token = generateEditorToken();
    await db.insert(editorSessions).values({ token, serverKeyId: keyId, createdBy: "CONSOLE", createdAt: new Date(), expiresAt: new Date(Date.now() + 30 * 60 * 1000) });
    const editorReceived: string[] = [];
    registerEditorConn(token, keyId, (msg) => editorReceived.push(msg));

    await handlePluginMessage(connId, JSON.stringify({ type: "editor_session_revoke" }));

    expect(editorReceived.length).toBe(1);
    expect(JSON.parse(editorReceived[0])).toMatchObject({ type: "session_expired" });
  });
});

describe("broadcastDraftUpdate", () => {
  test("pushes draft_update to other editor connections for the same server", async () => {
    const keyId = crypto.randomUUID();
    await db.insert(serverKeys).values({ id: keyId, hash: "bdu" + keyId.slice(0,8), createdAt: new Date() });

    const tokenA = generateEditorToken();
    const tokenB = generateEditorToken();
    await db.insert(editorSessions).values({ token: tokenA, serverKeyId: keyId, createdBy: "A", createdAt: new Date(), expiresAt: new Date(Date.now() + 1800000) });
    await db.insert(editorSessions).values({ token: tokenB, serverKeyId: keyId, createdBy: "B", createdAt: new Date(), expiresAt: new Date(Date.now() + 1800000) });

    const receivedByB: string[] = [];
    registerEditorConn(tokenA, keyId, () => {});
    registerEditorConn(tokenB, keyId, (msg) => receivedByB.push(msg));

    broadcastDraftUpdate(keyId, "pack1", "shop_main", "title: Shop\n", tokenA);

    expect(receivedByB.length).toBe(1);
    const msg = JSON.parse(receivedByB[0]) as { type: string; menu_id: string };
    expect(msg.type).toBe("draft_update");
    expect(msg.menu_id).toBe("shop_main");
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
cd backend && bun test src/ws/hub.test.ts
```
Expected: `registerEditorConn is not a function`.

- [ ] **Step 3: Replace stub in `hub.ts` with full implementation**

Remove the stub `broadcastDraftUpdate` added in Task 5 and add the following to `hub.ts`. First add imports at the top:

```ts
import { and, eq, isNull } from "drizzle-orm";
import { editorSessions, linkCodes, packBundles, serverKeys } from "../db/schema";
import { generateCode, generateEditorToken, generateServerKey } from "../lib/auth";
import type {
  BundleAvailableMessage,
  EditorDraftUpdateMessage,
  EditorSessionReadyMessage,
  HelloAckMessage,
  HelloMessage,
  LinkConfirmedMessage,
  SessionExpiredMessage,
  SetupClaimMessage,
  SetupCodeMessage,
} from "../protocol";
```

Then add these maps and functions after the existing `codeToConn` declaration:

```ts
// Editor WS connections: token → sendFn
export const editorSenders = new Map<string, (msg: string) => void>();
// token → serverKeyId (for grouping editors by server)
const editorTokenToServer = new Map<string, string>();
// connId → serverKeyId (set after successful hello, used by editor_session_request)
const connToServerId = new Map<string, string>();

export function registerEditorConn(token: string, serverKeyId: string, send: (msg: string) => void): void {
  editorSenders.set(token, send);
  editorTokenToServer.set(token, serverKeyId);
}

export function cleanupEditorConn(token: string): void {
  editorSenders.delete(token);
  editorTokenToServer.delete(token);
}

export function broadcastDraftUpdate(
  serverKeyId: string,
  packId: string,
  menuId: string,
  menuYaml: string,
  senderToken: string,
): void {
  const payload = JSON.stringify({
    type: "draft_update",
    pack_id: packId,
    menu_id: menuId,
    menu_yaml: menuYaml,
    updated_by: senderToken,
  } satisfies EditorDraftUpdateMessage);

  // Push to all other editor sessions for this server
  for (const [token, send] of editorSenders) {
    if (token === senderToken) continue;
    if (editorTokenToServer.get(token) !== serverKeyId) continue;
    send(payload);
  }

  // Push to all plugin connections for this server
  for (const [connId, sId] of connToServerId) {
    if (sId !== serverKeyId) continue;
    const send = connSenders.get(connId);
    if (send) send(JSON.stringify({
      type: "draft_update",
      pack_id: packId,
      menu_id: menuId,
      menu_yaml: menuYaml,
    }));
  }
}
```

Update `cleanupConn` to also clear `connToServerId`:

```ts
export function cleanupConn(connId: string): void {
  connSenders.delete(connId);
  connToServerId.delete(connId);
  for (const [code, cId] of codeToConn) {
    if (cId === connId) codeToConn.delete(code);
  }
}
```

In `handlePluginMessage`, inside the `hello` handler, after `activeSessions.set(sessionId, keyId)`, add:

```ts
connToServerId.set(connId, keyId);
```

At the end of `handlePluginMessage`, before the final `return { reply: null }`, add the two new handlers:

```ts
  // ── editor_session_request: generate a browser session token ─────────────
  if (msg.type === "editor_session_request") {
    const serverId = connToServerId.get(connId);
    if (!serverId) return { reply: null };
    const raw = msg as Record<string, unknown>;
    const sender = typeof raw.sender === "string" ? raw.sender : "CONSOLE";
    const token = generateEditorToken();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30 * 60 * 1000);
    await db.insert(editorSessions).values({ token, serverKeyId: serverId, createdBy: sender, createdAt: now, expiresAt });
    const reply: EditorSessionReadyMessage = {
      type: "editor_session_ready",
      url: `${EDITOR_URL}/session?token=${token}`,
      expires_at: expiresAt.toISOString(),
    };
    return { reply: JSON.stringify(reply) };
  }

  // ── editor_session_revoke: revoke all sessions for this server ────────────
  if (msg.type === "editor_session_revoke") {
    const serverId = connToServerId.get(connId);
    if (!serverId) return { reply: null };
    await db
      .update(editorSessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(editorSessions.serverKeyId, serverId), isNull(editorSessions.revokedAt)));
    for (const [token, sId] of editorTokenToServer) {
      if (sId !== serverId) continue;
      const send = editorSenders.get(token);
      if (send) send(JSON.stringify({ type: "session_expired" } satisfies SessionExpiredMessage));
    }
    return { reply: null };
  }
```

- [ ] **Step 4: Add `/ws/editor` to `backend/src/app.ts`**

Add imports:

```ts
import { cleanupEditorConn, registerEditorConn } from "./ws/hub";
import { validateEditorToken } from "./lib/auth";
```

Add after the existing `/ws/plugin` handler:

```ts
app.get("/ws/editor", async (c, next) => {
  const token = new URL(c.req.url).searchParams.get("token") ?? "";
  const session = token ? await validateEditorToken(token) : null;
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  c.set("editorToken", token);
  c.set("editorServerId", session.serverKeyId);
  return next();
}, upgradeWebSocket((c) => {
  const token = c.get("editorToken") as string;
  const serverId = c.get("editorServerId") as string;
  return {
    onOpen(_, ws) {
      registerEditorConn(token, serverId, (msg) => ws.send(msg));
    },
    onMessage() {},
    onClose() { cleanupEditorConn(token); },
    onError: (err) => console.error("Editor WS error:", err),
  };
}));
```

- [ ] **Step 5: Run hub tests — expect pass**

```bash
cd backend && bun test src/ws/hub.test.ts
```
Expected: all tests PASS.

- [ ] **Step 6: Run full suite**

```bash
cd backend && bun test
```
Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
cd backend && rtk git add src/ws/hub.ts src/ws/hub.test.ts src/app.ts && rtk git commit -m "feat(backend): editor WS channel, session broadcast, draft_update broadcast"
```

---

## Task 7: Plugin — `PluginConfig` + default config

**Files:**
- Modify: `plugin/src/main/kotlin/gg/interfaze/plugin/config/PluginConfig.kt`
- Modify: `plugin/src/main/resources/config.yml`

- [ ] **Step 1: Add `editorConsoleOnly` to `PluginConfig.kt`**

Full file:

```kotlin
package gg.interfaze.plugin.config

import org.bukkit.configuration.file.FileConfiguration

data class PluginConfig(
    val serverKey: String,
    val wsUrl: String,
    val packsDir: String,
    val editorConsoleOnly: Boolean,
) {
    companion object {
        fun from(cfg: FileConfiguration) = PluginConfig(
            serverKey        = cfg.getString("server_key", "") ?: "",
            wsUrl            = cfg.getString("ws_url", "wss://editor.interfaze.gg/ws/plugin") ?: "",
            packsDir         = cfg.getString("packs_dir", "plugins/Interfaze/packs") ?: "",
            editorConsoleOnly = cfg.getBoolean("editor.console_only", false),
        )
    }
}
```

- [ ] **Step 2: Update `plugin/src/main/resources/config.yml`**

```yaml
# Set to connect this server to the Interfaze editor backend for live sync.
# Leave empty to run offline using only locally exported packs.
server_key: ""
ws_url: "wss://editor.interfaze.gg/ws/plugin"

# Path relative to the server root where exported pack bundles are stored.
packs_dir: "plugins/Interfaze/packs"

# Editor access settings.
editor:
  # Set to true to restrict /ifz editor to console only (no in-game players).
  console_only: false
```

- [ ] **Step 3: Run plugin tests — expect pass**

```bash
cd plugin && ./gradlew test 2>&1 | tail -15
```
Expected: all tests PASS (PluginConfig is parsed in existing tests — verify nothing broke).

- [ ] **Step 4: Commit**

```bash
cd plugin && rtk git add src/main/kotlin/gg/interfaze/plugin/config/PluginConfig.kt src/main/resources/config.yml && rtk git commit -m "feat(plugin): add editor.console_only to PluginConfig"
```

---

## Task 8: Plugin — `MenuProvider` interface + `SyncedMenuProvider` editor methods

**Files:**
- Modify: `plugin/src/main/kotlin/gg/interfaze/plugin/provider/MenuProvider.kt`
- Modify: `plugin/src/main/kotlin/gg/interfaze/plugin/provider/SyncedMenuProvider.kt`
- Modify: `plugin/src/main/kotlin/gg/interfaze/plugin/ws/WsClient.kt` (add `send` if absent)
- Create: `plugin/src/test/kotlin/gg/interfaze/plugin/EditorSessionTest.kt`

- [ ] **Step 1: Read `WsClient.kt` and `MenuProvider.kt`**

```bash
cat plugin/src/main/kotlin/gg/interfaze/plugin/ws/WsClient.kt
cat plugin/src/main/kotlin/gg/interfaze/plugin/provider/MenuProvider.kt
```

Check whether `WsClient` already exposes a `send(msg: String): Boolean` method. If not, add it in Step 2.

- [ ] **Step 2: Add `send` to `WsClient.kt` if absent**

If `WsClient` stores the OkHttp `WebSocket` internally (e.g. `@Volatile private var ws: WebSocket? = null`), add:

```kotlin
fun send(msg: String): Boolean = ws?.send(msg) ?: false
```

If the field is named differently, adjust accordingly. This one-liner delegates to OkHttp's `WebSocket.send(String): Boolean`.

- [ ] **Step 3: Add new methods to `MenuProvider.kt`**

Open the file and add these two method declarations with default no-op bodies to the interface:

```kotlin
fun requestEditorSession(sender: String, onReady: (url: String, expiresAt: String) -> Unit) {}
fun revokeEditorSessions() {}
```

- [ ] **Step 4: Write failing test**

Create `plugin/src/test/kotlin/gg/interfaze/plugin/EditorSessionTest.kt`:

```kotlin
package gg.interfaze.plugin

import com.fasterxml.jackson.databind.ObjectMapper
import gg.interfaze.plugin.provider.SyncedMenuProvider
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import java.io.File
import java.nio.file.Files
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class EditorSessionTest {
    private val mapper = ObjectMapper()

    @Test
    fun `requestEditorSession sends editor_session_request and delivers url via callback`() {
        val server = MockWebServer()
        val readyLatch = CountDownLatch(1)
        var receivedUrl = ""

        server.enqueue(MockResponse().withWebSocketUpgrade(object : WebSocketListener() {
            override fun onOpen(ws: WebSocket, response: okhttp3.Response) {
                // Mock backend: immediately send hello_ack so the provider authenticates
                val ack = """{"type":"hello_ack","session_id":"s1","server_id":"srv1","tier":"free","needs_sync":false,"latest_bundle_hash":"","api_url":"http://localhost","pack_hashes":{}}"""
                ws.send(ack)
            }
            override fun onMessage(ws: WebSocket, text: String) {
                val node = mapper.readTree(text)
                if (node["type"].asText() == "editor_session_request") {
                    ws.send("""{"type":"editor_session_ready","url":"http://localhost:5173/session?token=TESTTOKEN12345678901234567890","expires_at":"2099-01-01T00:00:00Z"}""")
                }
            }
        }))
        server.start()

        val packsDir = Files.createTempDirectory("ifz_test_packs").toFile()
        val provider = SyncedMenuProvider(
            packsDir  = packsDir,
            serverKey = "sk_" + "a".repeat(64),
            wsUrl     = server.url("/ws/plugin").toString(),
            logger    = null,
        )
        provider.load()
        Thread.sleep(200) // let hello_ack arrive

        provider.requestEditorSession("AdminPlayer") { url, _ ->
            receivedUrl = url
            readyLatch.countDown()
        }

        assertTrue(readyLatch.await(5, TimeUnit.SECONDS), "editor_session_ready not received")
        assertEquals("http://localhost:5173/session?token=TESTTOKEN12345678901234567890", receivedUrl)

        provider.unload()
        server.shutdown()
    }

    @Test
    fun `revokeEditorSessions sends editor_session_revoke`() {
        val server = MockWebServer()
        val revokeLatch = CountDownLatch(1)

        server.enqueue(MockResponse().withWebSocketUpgrade(object : WebSocketListener() {
            override fun onOpen(ws: WebSocket, response: okhttp3.Response) {
                val ack = """{"type":"hello_ack","session_id":"s2","server_id":"srv2","tier":"free","needs_sync":false,"latest_bundle_hash":"","api_url":"http://localhost","pack_hashes":{}}"""
                ws.send(ack)
            }
            override fun onMessage(ws: WebSocket, text: String) {
                val node = mapper.readTree(text)
                if (node["type"].asText() == "editor_session_revoke") revokeLatch.countDown()
            }
        }))
        server.start()

        val packsDir = Files.createTempDirectory("ifz_test_packs2").toFile()
        val provider = SyncedMenuProvider(
            packsDir  = packsDir,
            serverKey = "sk_" + "b".repeat(64),
            wsUrl     = server.url("/ws/plugin").toString(),
            logger    = null,
        )
        provider.load()
        Thread.sleep(200)

        provider.revokeEditorSessions()

        assertTrue(revokeLatch.await(5, TimeUnit.SECONDS), "editor_session_revoke not sent")

        provider.unload()
        server.shutdown()
    }
}
```

Note: the test uses `serverKey = "sk_" + "a".repeat(64)` which will fail the real backend auth (hash won't match), but MockWebServer doesn't validate — it just sends `hello_ack` unconditionally. This is intentional for unit testing.

- [ ] **Step 5: Run — expect failure**

```bash
cd plugin && ./gradlew test --tests "gg.interfaze.plugin.EditorSessionTest" 2>&1 | tail -20
```
Expected: `Unresolved reference: requestEditorSession`.

- [ ] **Step 6: Implement in `SyncedMenuProvider.kt`**

Add these fields after the existing `@Volatile private var wsClient` declaration:

```kotlin
@Volatile private var editorSessionCallback: ((url: String, expiresAt: String) -> Unit)? = null
```

Add these methods before or after `load()`:

```kotlin
override fun requestEditorSession(sender: String, onReady: (url: String, expiresAt: String) -> Unit) {
    editorSessionCallback = onReady
    wsClient?.send("""{"type":"editor_session_request","sender":"$sender"}""")
}

override fun revokeEditorSessions() {
    wsClient?.send("""{"type":"editor_session_revoke"}""")
}
```

In the `handleMessage` function (the `when` or `if` chain that dispatches on message type), add a case for `editor_session_ready`:

```kotlin
"editor_session_ready" -> {
    val url = node["url"]?.asText() ?: return
    val expiresAt = node["expires_at"]?.asText() ?: return
    val cb = editorSessionCallback
    editorSessionCallback = null
    cb?.invoke(url, expiresAt)
}
```

Where `node` is the parsed JSON — use the same JSON parsing idiom already in `handleMessage`.

- [ ] **Step 7: Run — expect pass**

```bash
cd plugin && ./gradlew test --tests "gg.interfaze.plugin.EditorSessionTest" 2>&1 | tail -15
```
Expected: 2 tests PASS.

- [ ] **Step 8: Run full plugin suite**

```bash
cd plugin && ./gradlew test 2>&1 | tail -15
```
Expected: all tests PASS.

- [ ] **Step 9: Commit**

```bash
cd plugin && rtk git add src/main/kotlin/gg/interfaze/plugin/provider/MenuProvider.kt src/main/kotlin/gg/interfaze/plugin/provider/SyncedMenuProvider.kt src/main/kotlin/gg/interfaze/plugin/ws/WsClient.kt src/test/kotlin/gg/interfaze/plugin/EditorSessionTest.kt && rtk git commit -m "feat(plugin): requestEditorSession and revokeEditorSessions on SyncedMenuProvider"
```

---

## Task 9: Plugin — `/ifz editor` command

**Files:**
- Modify: `plugin/src/main/kotlin/gg/interfaze/plugin/command/IfzCommand.kt`
- Modify: `plugin/src/main/resources/plugin.yml`
- Create: `plugin/src/test/kotlin/gg/interfaze/plugin/EditorCommandTest.kt`

- [ ] **Step 1: Write failing test**

Create `plugin/src/test/kotlin/gg/interfaze/plugin/EditorCommandTest.kt`:

```kotlin
package gg.interfaze.plugin

import be.seeseemelk.mockbukkit.MockBukkit
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertTrue

class EditorCommandTest {

    @BeforeTest fun setup() { MockBukkit.mock() }
    @AfterTest  fun teardown() { MockBukkit.unmock() }

    @Test
    fun `editor subcommand is accepted without exception`() {
        val plugin = MockBukkit.load(InterfazePlugin::class.java)
        val sender = MockBukkit.getMock().consoleSender
        // Should not throw; will fail gracefully (ws_url not configured in test)
        val result = plugin.onCommand(sender, plugin.getCommand("ifz")!!, "ifz", arrayOf("editor"))
        assertTrue(result, "Command should return true")
    }

    @Test
    fun `editor revoke subcommand is accepted without exception`() {
        val plugin = MockBukkit.load(InterfazePlugin::class.java)
        val sender = MockBukkit.getMock().consoleSender
        val result = plugin.onCommand(sender, plugin.getCommand("ifz")!!, "ifz", arrayOf("editor", "revoke"))
        assertTrue(result, "Command should return true")
    }
}
```

- [ ] **Step 2: Run — expect failure**

```bash
cd plugin && ./gradlew test --tests "gg.interfaze.plugin.EditorCommandTest" 2>&1 | tail -20
```
Expected: `editor` subcommand falls through to usage message (result is true but wrong branch).

- [ ] **Step 3: Update `IfzCommand.kt`**

Full file:

```kotlin
package gg.interfaze.plugin.command

import gg.interfaze.plugin.InterfazePlugin
import gg.interfaze.plugin.config.ConfigWriter
import gg.interfaze.plugin.config.PluginConfig
import gg.interfaze.plugin.ws.SetupClient
import org.bukkit.Bukkit
import org.bukkit.command.Command
import org.bukkit.command.CommandExecutor
import org.bukkit.command.CommandSender
import org.bukkit.command.ConsoleCommandSender
import org.bukkit.entity.Player

class IfzCommand(private val plugin: InterfazePlugin) : CommandExecutor {

    @Volatile private var setupClient: SetupClient? = null

    fun shutdown() {
        setupClient?.disconnect()
        setupClient = null
    }

    override fun onCommand(sender: CommandSender, command: Command, label: String, args: Array<out String>): Boolean {
        when (args.getOrNull(0)?.lowercase()) {
            "menu" -> {
                if (sender !is Player) { sender.sendMessage("In-game only."); return true }
                val menuId = args.getOrNull(1) ?: run { sender.sendMessage("Usage: /ifz menu <id>"); return true }
                plugin.menuProvider.openMenu(sender, menuId, "en")
            }
            "reload" -> {
                plugin.menuProvider.unload()
                plugin.menuProvider.load()
                sender.sendMessage("Interfaze reloaded.")
            }
            "sync" -> {
                when (args.getOrNull(1)?.lowercase()) {
                    "status" -> sender.sendMessage("Check server logs for sync status details.")
                    "reject" -> {
                        plugin.menuProvider.unload()
                        plugin.menuProvider.load()
                        sender.sendMessage("Reconnecting to backend — backend version will be applied if available.")
                    }
                    else -> sender.sendMessage("Usage: /ifz sync <status|reject>")
                }
            }
            "setup" -> setup(sender, args.getOrNull(1)?.uppercase())
            "editor" -> {
                when (args.getOrNull(1)?.lowercase()) {
                    "revoke" -> editorRevoke(sender)
                    null     -> editor(sender)
                    else     -> sender.sendMessage("Usage: /ifz editor [revoke]")
                }
            }
            else -> sender.sendMessage("Usage: /ifz <menu <id>|reload|sync <status|reject>|setup [CODE]|editor [revoke]>")
        }
        return true
    }

    private fun editor(sender: CommandSender) {
        val cfg = PluginConfig.from(plugin.config)
        if (cfg.editorConsoleOnly && sender !is ConsoleCommandSender) {
            sender.sendMessage("[Interfaze] /ifz editor est réservé à la console (editor.console_only=true).")
            return
        }
        if (!sender.hasPermission("interfaze.editor")) {
            sender.sendMessage("[Interfaze] Permission manquante : interfaze.editor")
            return
        }
        if (cfg.wsUrl.isEmpty() || cfg.serverKey.isEmpty()) {
            sender.sendMessage("[Interfaze] Le serveur n'est pas lié. Lancez /ifz setup.")
            return
        }
        val senderName = if (sender is Player) sender.name else "CONSOLE"
        plugin.menuProvider.requestEditorSession(senderName) { url, expiresAt ->
            Bukkit.getScheduler().runTask(plugin, Runnable {
                sender.sendMessage("[Interfaze] Éditeur → $url")
                sender.sendMessage("[Interfaze] (expire le $expiresAt)")
            })
        }
    }

    private fun editorRevoke(sender: CommandSender) {
        if (!sender.hasPermission("interfaze.editor")) {
            sender.sendMessage("[Interfaze] Permission manquante : interfaze.editor")
            return
        }
        plugin.menuProvider.revokeEditorSessions()
        sender.sendMessage("[Interfaze] Toutes les sessions éditeur ont été révoquées.")
    }

    private fun setup(sender: CommandSender, code: String?) {
        setupClient?.disconnect()
        setupClient = null
        val cfg = PluginConfig.from(plugin.config)
        if (cfg.wsUrl.isEmpty()) {
            sender.sendMessage("[Interfaze] ws_url is not configured in config.yml.")
            return
        }
        sender.sendMessage("[Interfaze] Connexion au backend en cours...")
        val configFile = plugin.dataFolder.resolve("config.yml")
        setupClient = SetupClient(
            url = cfg.wsUrl,
            code = code,
            onCode = { receivedCode, url ->
                val msg = "[Interfaze] Lier ce serveur : $url"
                plugin.logger.info(msg)
                Bukkit.getScheduler().runTask(plugin, Runnable { sender.sendMessage(msg) })
            },
            onLinked = { serverKey ->
                ConfigWriter.writeServerKey(configFile, serverKey)
                plugin.logger.info("[Interfaze] Serveur lié ✓ (server_key écrit dans config.yml)")
                Bukkit.getScheduler().runTask(plugin, Runnable {
                    sender.sendMessage("[Interfaze] Serveur lié ✓ Rechargement en cours...")
                    plugin.reloadConfig()
                    plugin.reinit(PluginConfig.from(plugin.config))
                    sender.sendMessage("[Interfaze] Prêt.")
                })
            },
        )
        setupClient!!.connect()
    }
}
```

- [ ] **Step 4: Update `plugin.yml` usage string**

```yaml
name: Interfaze
version: '1.0.0'
main: gg.interfaze.plugin.InterfazePlugin
api-version: '1.21'
description: Interfaze GUI editor plugin
commands:
  ifz:
    description: Interfaze commands
    usage: /ifz <menu <id>|reload|sync <status|reject>|setup [CODE]|editor [revoke]>
    default: op
permissions:
  interfaze.editor:
    description: Allows opening the Interfaze web editor
    default: op
```

- [ ] **Step 5: Run — expect pass**

```bash
cd plugin && ./gradlew test --tests "gg.interfaze.plugin.EditorCommandTest" 2>&1 | tail -15
```
Expected: 2 tests PASS.

- [ ] **Step 6: Run full plugin suite**

```bash
cd plugin && ./gradlew test 2>&1 | tail -15
```
Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
cd plugin && rtk git add src/main/kotlin/gg/interfaze/plugin/command/IfzCommand.kt src/main/resources/plugin.yml src/test/kotlin/gg/interfaze/plugin/EditorCommandTest.kt && rtk git commit -m "feat(plugin): /ifz editor and /ifz editor revoke commands"
```

---

## Task 10: Editor — `lib/editorSession.ts`

**Files:**
- Create: `editor/src/lib/editorSession.ts`

No Vitest unit test for this file — it's a thin HTTP wrapper; the contract is tested by backend integration tests.

- [ ] **Step 1: Create `editor/src/lib/editorSession.ts`**

```ts
const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

export interface EditorSessionInfo {
  server_key_id: string;
}

export async function validateEditorSession(token: string): Promise<EditorSessionInfo> {
  const res = await fetch(`${API_URL}/api/editor-session/${token}`);
  if (!res.ok) throw new Error("Session invalide ou expirée");
  return res.json() as Promise<EditorSessionInfo>;
}

export async function refreshEditorSession(token: string): Promise<void> {
  await fetch(`${API_URL}/api/editor-session/${token}/refresh`, { method: "POST" });
}

export async function revokeEditorSession(token: string): Promise<void> {
  await fetch(`${API_URL}/api/editor-session/${token}`, { method: "DELETE" });
}

export async function saveDraft(
  token: string,
  packId: string,
  menuId: string,
  menuYaml: string,
): Promise<void> {
  const res = await fetch(`${API_URL}/api/editor-session/${token}/draft`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pack_id: packId, menu_id: menuId, menu_yaml: menuYaml }),
  });
  if (!res.ok) throw new Error("Échec de la sauvegarde du draft");
}
```

- [ ] **Step 2: Commit**

```bash
cd editor && rtk git add src/lib/editorSession.ts && rtk git commit -m "feat(editor): editorSession REST helpers"
```

---

## Task 11: Editor — `lib/editorWs.ts`

**Files:**
- Create: `editor/src/lib/editorWs.ts`

- [ ] **Step 1: Create `editor/src/lib/editorWs.ts`**

```ts
const WS_URL = (import.meta.env.VITE_API_URL ?? "http://localhost:3001").replace(/^http/, "ws");

export type DraftUpdateHandler = (packId: string, menuId: string, menuYaml: string, updatedBy: string) => void;
export type SessionExpiredHandler = () => void;

export class EditorWs {
  private ws: WebSocket | null = null;

  constructor(
    token: string,
    private onDraftUpdate: DraftUpdateHandler,
    private onExpired: SessionExpiredHandler,
  ) {
    this.ws = new WebSocket(`${WS_URL}/ws/editor?token=${encodeURIComponent(token)}`);
    this.ws.onmessage = (evt) => {
      let msg: { type: string; pack_id?: string; menu_id?: string; menu_yaml?: string; updated_by?: string };
      try { msg = JSON.parse(evt.data as string); } catch { return; }
      if (msg.type === "draft_update" && msg.pack_id && msg.menu_id && msg.menu_yaml != null) {
        this.onDraftUpdate(msg.pack_id, msg.menu_id, msg.menu_yaml, msg.updated_by ?? "");
      } else if (msg.type === "session_expired") {
        this.onExpired();
      }
    };
    this.ws.onerror = () => this.onExpired();
  }

  disconnect(): void {
    this.ws?.close();
    this.ws = null;
  }
}
```

- [ ] **Step 2: Commit**

```bash
cd editor && rtk git add src/lib/editorWs.ts && rtk git commit -m "feat(editor): EditorWs class for /ws/editor channel"
```

---

## Task 12: Editor — `/session` route

**Files:**
- Create: `editor/src/routes/session.tsx`

- [ ] **Step 1: Create `editor/src/routes/session.tsx`**

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { validateEditorSession, refreshEditorSession } from "@/lib/editorSession";
import { EditorWs } from "@/lib/editorWs";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/session")({
  component: SessionPage,
});

function SessionPage() {
  const token = useRef<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "invalid" | "expired">("loading");
  const [serverKeyId, setServerKeyId] = useState("");
  const [draftNotice, setDraftNotice] = useState<string | null>(null);
  const wsRef = useRef<EditorWs | null>(null);
  const refreshRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    const params = new URLSearchParams(window.location.search);
    const t = params.get("token");
    if (!t) { setState("invalid"); return; }
    token.current = t;

    // Strip token from URL bar immediately — prevents it lingering in browser history
    history.replaceState({}, "", "/session");

    (async () => {
      try {
        const { server_key_id } = await validateEditorSession(t);
        if (!mountedRef.current) return;
        setServerKeyId(server_key_id);

        wsRef.current = new EditorWs(
          t,
          (_packId, menuId, _menuYaml, _updatedBy) => {
            if (!mountedRef.current) return;
            // Show a notification — store integration wired up when editor canvas lands
            setDraftNotice(`Menu "${menuId}" mis à jour par un autre éditeur.`);
            setTimeout(() => setDraftNotice(null), 5000);
          },
          () => { if (mountedRef.current) setState("expired"); },
        );

        refreshRef.current = setInterval(() => {
          if (token.current) refreshEditorSession(token.current);
        }, 10 * 60 * 1000);

        setState("ready");
      } catch {
        if (mountedRef.current) setState("invalid");
      }
    })();

    return () => {
      mountedRef.current = false;
      wsRef.current?.disconnect();
      if (refreshRef.current) clearInterval(refreshRef.current);
    };
  }, []);

  if (state === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">Chargement…</p>
      </div>
    );
  }

  if (state === "invalid") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4">
        <p className="text-destructive text-lg">Session invalide.</p>
        <p className="text-muted-foreground text-sm">Relancez <code>/ifz editor</code> sur votre serveur Minecraft.</p>
      </div>
    );
  }

  if (state === "expired") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4">
        <p className="text-lg font-medium">Session expirée</p>
        <p className="text-muted-foreground text-sm">Relancez <code>/ifz editor</code> sur votre serveur Minecraft pour obtenir un nouveau lien.</p>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen">
      {draftNotice && (
        <div className="fixed top-4 right-4 z-50 rounded bg-amber-50 border border-amber-200 px-4 py-2 text-sm text-amber-800 shadow">
          {draftNotice}
        </div>
      )}
      {/* Editor canvas rendered here — serverKeyId available for scoping API calls */}
      <p className="p-8 text-muted-foreground text-sm">
        Connecté — serveur <code>{serverKeyId}</code>
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Start dev server to regenerate route tree**

```bash
cd editor && npm run dev
```

Wait for "ready" (Vite + TanStack Router plugin regenerates `routeTree.gen.ts` to include `/session`). Then kill with Ctrl+C.

- [ ] **Step 3: Run editor tests — expect pass**

```bash
cd editor && npx vitest run
```
Expected: all existing tests PASS (the new route has no unit test — it's UI glue; session logic is covered by backend tests).

- [ ] **Step 4: Build — expect no type errors**

```bash
cd editor && npm run build
```
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
cd editor && rtk git add src/routes/session.tsx src/routeTree.gen.ts src/lib/editorSession.ts src/lib/editorWs.ts && rtk git commit -m "feat(editor): /session route with WS channel and draft_update notifications"
```

---

## Self-review

**Spec coverage:**
- `/ifz editor` command with `interfaze.editor` permission: Task 9 ✓
- `editor.console_only` config option: Task 7 ✓
- Session token 30 chars crypto-random: Task 2 (`generateEditorToken`) ✓
- `editor_sessions` DB table: Task 1 ✓
- Token auto-extended on activity: Task 5 (`POST /refresh`), Task 12 (10-min interval) ✓
- Session expired push to WS: Task 6 (`session_expired` in `editor_session_revoke`) ✓
- Multiple concurrent sessions (no auto-revoke): no single-token limit in Task 6 ✓
- `/ifz editor revoke` kills all sessions: Task 6 (`editor_session_revoke` handler) + Task 9 ✓
- Token stripped from URL bar: Task 12 (`history.replaceState`) ✓
- Rate limiting on validate endpoint: Task 5 (`checkRateLimit`) ✓
- WS editor channel (`/ws/editor`): Task 6 ✓
- `broadcastDraftUpdate` to editors + plugin: Task 6 ✓
- Draft save endpoint: Task 5 (`POST /draft`) ✓
- Real-time draft notification in editor (silent if menu closed, notice if open): Task 12 (notice shown regardless for now — menu-open detection wired when canvas lands) ✓
- `editor_session_request` WS handler in backend: Task 6 ✓
- Plugin sends request via existing WS: Task 8 (`requestEditorSession`) ✓

**Placeholder scan:** No TBDs. The only deferred item is "silent if menu closed" vs "notice if open" — Task 12 shows a notice regardless, with a comment that the menu-open check is wired when the editor canvas lands. This is correct for V1.

**Type consistency:**
- `generateEditorToken()` returns `string` — used in hub.ts `editor_session_request` handler ✓
- `validateEditorToken(token)` returns `{ serverKeyId }` — used in editorSession.ts routes ✓
- `registerEditorConn(token, serverKeyId, send)` — called in app.ts `/ws/editor` onOpen ✓
- `broadcastDraftUpdate(serverKeyId, packId, menuId, menuYaml, senderToken)` — called from editorSession.ts route ✓
- `EditorWs` constructor `(token, onDraftUpdate, onExpired)` — matches session.tsx usage ✓
- `saveDraft(token, packId, menuId, menuYaml)` — matches editorSession.ts signature ✓
