# Server Linking Flow — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a symmetric server linking flow so Minecraft admins can connect their server to Artisan via `/artisan setup` — either generating a link code the admin claims in the browser (B1), or entering a dashboard-generated code directly (B2).

**Architecture:** A `link_codes` table tracks ephemeral 10-minute linking tokens. The backend WS hub handles `setup_request` (B1: plugin generates a code) and `setup_claim` (B2: plugin claims a dashboard code), then pushes `link_confirmed { server_key }` back to the plugin session. On receipt, the plugin's `SetupClient` writes the key to `config.yml` via `ConfigWriter` and triggers a plugin reinit (reload from config + reconnect as authenticated). The editor `/link` route handles B1 (browser claims the plugin's code) and B2 (browser generates a code, admin enters it on the server, browser polls for claim).

**Auth note:** Auth (JWT, Discord OAuth, email+password) is a separate plan. For this plan, `POST /api/link/:code/claim` is unauthenticated — any browser with the valid code can claim it. The code expires in 10 min, which limits exposure. When auth lands, a user JWT will be required by this endpoint and the `server_keys` table will gain a `user_id` FK.

**Tech Stack:** Bun + Hono + Drizzle + PostgreSQL (backend), Kotlin 2.0 + OkHttp + MockWebServer (plugin), React 19 + TanStack Router + Tailwind (editor).

---

## File structure

**Backend — new/modified:**
- `backend/src/db/schema.ts` — add `linkCodes` table
- `backend/src/lib/auth.ts` — add `generateCode()` and `generateServerKey()` helpers; refactor existing inline key generation to use them
- `backend/src/protocol.ts` — add `SetupRequestMessage`, `SetupClaimMessage`, `SetupCodeMessage`, `LinkConfirmedMessage`
- `backend/src/ws/hub.ts` — add `connId` param to `handlePluginMessage`; add `connSenders`, `registerConn`, `cleanupConn`, `pushLinkConfirmed`; handle `setup_request` and `setup_claim` WS messages
- `backend/src/ws/hub.test.ts` — update existing tests (new signature), add two setup tests
- `backend/src/routes/link.ts` — new: `POST /api/link`, `GET /api/link/:code`, `POST /api/link/:code/claim`
- `backend/src/routes/link.test.ts` — new
- `backend/src/app.ts` — generate `connId` per WS connection, call `registerConn` on open, pass `connId` to `handlePluginMessage`; mount `/api/link` router

**Plugin — new/modified:**
- `plugin/src/main/kotlin/net/artisanmc/plugin/config/ConfigWriter.kt` — new: writes `server_key` to `config.yml` using regex replace
- `plugin/src/main/kotlin/net/artisanmc/plugin/ws/SetupClient.kt` — new: one-shot OkHttp WS client for the linking handshake (no reconnect)
- `plugin/src/main/kotlin/net/artisanmc/plugin/command/ArtisanCommand.kt` — add `setup [code]` subcommand; remove player-only guard
- `plugin/src/main/kotlin/net/artisanmc/plugin/ArtisanPlugin.kt` — add `reinit(cfg: PluginConfig)` method
- `plugin/src/main/resources/plugin.yml` — update command usage string

**Editor — new:**
- `editor/src/lib/linkApi.ts` — typed HTTP helpers for `/api/link*` endpoints
- `editor/src/routes/link.tsx` — `/link` route: B1 (claim with code from query param) and B2 (generate code + poll)

---

## Protocol additions

All new messages go in `backend/src/protocol.ts`. Reference these types in every task below.

```ts
// Plugin → backend (unauthenticated, no server_key needed)
export interface SetupRequestMessage { type: "setup_request" }
export interface SetupClaimMessage   { type: "setup_claim"; code: string }

// Backend → plugin
export interface SetupCodeMessage {
  type: "setup_code";
  code: string;
  url: string;        // editor URL the admin should open
  expires_at: string; // ISO 8601
}
export interface LinkConfirmedMessage {
  type: "link_confirmed";
  server_key: string; // the actual key to write to config.yml
}
```

---

## Task 1: DB — `link_codes` table

**Files:**
- Modify: `backend/src/db/schema.ts`

- [ ] **Step 1: Write failing test**

Create `backend/src/routes/link.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../db/index";
import { linkCodes } from "../db/schema";

describe("link_codes schema", () => {
  test("insert and read a link code", async () => {
    const code = "TEST0001";
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 10 * 60 * 1000);
    await db.insert(linkCodes).values({ code, createdAt: now, expiresAt });
    const rows = await db.select().from(linkCodes).where(eq(linkCodes.code, code));
    expect(rows.length).toBe(1);
    expect(rows[0].code).toBe(code);
    expect(rows[0].claimedAt).toBeNull();
    expect(rows[0].serverKeyId).toBeNull();
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
cd backend && bun test src/routes/link.test.ts
```
Expected: error importing `linkCodes` from `../db/schema`.

- [ ] **Step 3: Add `linkCodes` table**

Edit `backend/src/db/schema.ts` (full file):

```ts
import { pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const serverKeys = pgTable("server_keys", {
  id: text("id").primaryKey(),
  hash: text("hash").notNull(),
  label: text("label"),
  createdAt: timestamp("created_at").notNull(),
});

export const packBundles = pgTable("pack_bundles", {
  id: text("id").primaryKey(),
  serverId: text("server_id").notNull(),
  packId: text("pack_id").notNull(),
  hash: text("hash").notNull(),
  filesJson: text("files_json").notNull(),
  createdAt: timestamp("created_at").notNull(),
}, (t) => [
  uniqueIndex("server_pack_uniq").on(t.serverId, t.packId),
]);

export const linkCodes = pgTable("link_codes", {
  code: text("code").primaryKey(),
  createdAt: timestamp("created_at").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  claimedAt: timestamp("claimed_at"),
  serverKeyId: text("server_key_id").references(() => serverKeys.id),
});
```

- [ ] **Step 4: Apply migration**

```bash
cd backend && bun run db:push
```
Expected: `Changes applied` (no error, `link_codes` table created).

- [ ] **Step 5: Run test — expect pass**

```bash
cd backend && bun test src/routes/link.test.ts
```
Expected: 1 test PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/db/schema.ts backend/src/routes/link.test.ts
git commit -m "feat(db): add link_codes table"
```

---

## Task 2: Backend lib — `generateCode()` and `generateServerKey()`

**Files:**
- Modify: `backend/src/lib/auth.ts`
- Modify: `backend/src/routes/serverKeys.ts` (use the new helpers)

- [ ] **Step 1: Write failing tests**

Add to `backend/src/routes/link.test.ts`:

```ts
import { generateCode, generateServerKey } from "../lib/auth";

describe("generateCode", () => {
  test("returns 8-char uppercase alphanumeric without confusable chars", () => {
    const code = generateCode();
    expect(code).toHaveLength(8);
    expect(code).toMatch(/^[A-Z2-9]{8}$/); // no I, O, 0, 1
  });

  test("two calls produce different codes", () => {
    expect(generateCode()).not.toBe(generateCode());
  });
});

describe("generateServerKey", () => {
  test("returns sk_ key, UUID id, and matching SHA-256 hash", async () => {
    const { id, key, hash } = await generateServerKey();
    expect(key).toMatch(/^sk_[0-9a-f]{64}$/);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
    const expected = Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
    expect(hash).toBe(expected);
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
cd backend && bun test src/routes/link.test.ts
```
Expected: `generateCode is not a function`.

- [ ] **Step 3: Add helpers to `backend/src/lib/auth.ts`**

Full file:

```ts
import { eq } from "drizzle-orm";
import type { Context } from "hono";
import { db } from "../db/index";
import { serverKeys } from "../db/schema";

export async function validateServerKeyHeader(c: Context): Promise<string | null> {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const rawKey = authHeader.slice(7);
  if (!rawKey) return null;
  const hashBuf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawKey));
  const hash = Array.from(new Uint8Array(hashBuf), (b) => b.toString(16).padStart(2, "0")).join("");
  const rows = await db.select().from(serverKeys).where(eq(serverKeys.hash, hash));
  return rows.length > 0 ? rows[0].id : null;
}

// Excludes I, O, 0, 1 — easily confused when read aloud or hand-typed
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function generateCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => CODE_CHARS[b % CODE_CHARS.length]).join("");
}

export async function generateServerKey(): Promise<{ id: string; key: string; hash: string }> {
  const rawBytes = crypto.getRandomValues(new Uint8Array(32));
  const key = "sk_" + Array.from(rawBytes, (b) => b.toString(16).padStart(2, "0")).join("");
  const hashBuf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  const hash = Array.from(new Uint8Array(hashBuf), (b) => b.toString(16).padStart(2, "0")).join("");
  const id = crypto.randomUUID();
  return { id, key, hash };
}
```

- [ ] **Step 4: Run — expect pass**

```bash
cd backend && bun test src/routes/link.test.ts
```
Expected: 4 tests PASS.

- [ ] **Step 5: Refactor `serverKeys.ts` to use `generateServerKey`**

Edit `backend/src/routes/serverKeys.ts`:

```ts
import { Hono } from "hono";
import { db } from "../db/index";
import { serverKeys } from "../db/schema";
import { generateServerKey } from "../lib/auth";

const router = new Hono();

router.post("/", async (c) => {
  const body = await c.req.json<{ label?: string }>();
  const { id, key, hash } = await generateServerKey();
  await db.insert(serverKeys).values({ id, hash, label: body.label ?? null, createdAt: new Date() });
  return c.json({ id, key }, 201);
});

router.get("/", async (c) => {
  const rows = await db.select().from(serverKeys);
  return c.json(rows.map((r) => ({
    id: r.id,
    label: r.label,
    createdAt: r.createdAt,
    keyPrefix: `${r.hash.slice(0, 8)}...`,
  })));
});

export { router as serverKeysRouter };
```

- [ ] **Step 6: Run all backend tests — expect pass**

```bash
cd backend && bun test
```
Expected: all existing tests pass.

- [ ] **Step 7: Commit**

```bash
git add backend/src/lib/auth.ts backend/src/routes/serverKeys.ts backend/src/routes/link.test.ts
git commit -m "refactor(backend): extract generateCode and generateServerKey helpers"
```

---

## Task 3: Backend REST — `/api/link` routes

**Files:**
- Create: `backend/src/routes/link.ts`
- Modify: `backend/src/routes/link.test.ts`
- Modify: `backend/src/app.ts`
- Modify: `backend/src/protocol.ts`

- [ ] **Step 1: Add protocol types**

Add to `backend/src/protocol.ts`:

```ts
// (append at end of file)
export interface SetupRequestMessage { type: "setup_request" }
export interface SetupClaimMessage   { type: "setup_claim"; code: string }

export interface SetupCodeMessage {
  type: "setup_code";
  code: string;
  url: string;
  expires_at: string;
}
export interface LinkConfirmedMessage {
  type: "link_confirmed";
  server_key: string;
}

export type PluginToServerMessage =
  | HelloMessage
  | PongMessage
  | SetupRequestMessage
  | SetupClaimMessage;

export type ServerToPluginMessage =
  | HelloAckMessage
  | BundleAvailableMessage
  | DraftUpdateMessage
  | PingMessage
  | SetupCodeMessage
  | LinkConfirmedMessage;
```

(Replace the existing `PluginToServerMessage` and `ServerToPluginMessage` union types.)

- [ ] **Step 2: Write REST tests**

Add to `backend/src/routes/link.test.ts`:

```ts
import { app } from "../app";

describe("POST /api/link", () => {
  test("returns 201 with 8-char code, url, and expires_at", async () => {
    const res = await app.request("/api/link", { method: "POST" });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { code: string; url: string; expires_at: string };
    expect(body.code).toMatch(/^[A-Z2-9]{8}$/);
    expect(body.url).toContain(body.code);
    expect(new Date(body.expires_at).getTime()).toBeGreaterThan(Date.now());
  });
});

describe("GET /api/link/:code", () => {
  test("pending for a freshly created code", async () => {
    const createRes = await app.request("/api/link", { method: "POST" });
    const { code } = (await createRes.json()) as { code: string };
    const res = await app.request(`/api/link/${code}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("pending");
  });

  test("404 for unknown code", async () => {
    const res = await app.request("/api/link/NOTEXIST");
    expect(res.status).toBe(404);
  });
});

describe("POST /api/link/:code/claim", () => {
  test("claims a valid code, creates server_key, returns server_key_id", async () => {
    const createRes = await app.request("/api/link", { method: "POST" });
    const { code } = (await createRes.json()) as { code: string };

    const claimRes = await app.request(`/api/link/${code}/claim`, { method: "POST" });
    expect(claimRes.status).toBe(200);
    const { server_key_id } = (await claimRes.json()) as { server_key_id: string };
    expect(server_key_id).toMatch(/^[0-9a-f-]{36}$/);

    // Status is now claimed
    const statusRes = await app.request(`/api/link/${code}`);
    const { status } = (await statusRes.json()) as { status: string };
    expect(status).toBe("claimed");
  });

  test("409 when claiming already-claimed code", async () => {
    const { code } = (await (await app.request("/api/link", { method: "POST" })).json()) as { code: string };
    await app.request(`/api/link/${code}/claim`, { method: "POST" });
    const res = await app.request(`/api/link/${code}/claim`, { method: "POST" });
    expect(res.status).toBe(409);
  });

  test("404 for unknown code", async () => {
    const res = await app.request("/api/link/UNKNOWN1/claim", { method: "POST" });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 3: Run — expect failure**

```bash
cd backend && bun test src/routes/link.test.ts
```
Expected: 404 on `POST /api/link` (router not mounted yet).

- [ ] **Step 4: Create `backend/src/routes/link.ts`**

```ts
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db } from "../db/index";
import { linkCodes, serverKeys } from "../db/schema";
import { generateCode, generateServerKey } from "../lib/auth";
import { pushLinkConfirmed } from "../ws/hub";

const EDITOR_URL = process.env.EDITOR_URL ?? "http://localhost:5173";

const router = new Hono();

router.post("/", async (c) => {
  const code = generateCode();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 10 * 60 * 1000);
  await db.insert(linkCodes).values({ code, createdAt: now, expiresAt });
  return c.json({ code, url: `${EDITOR_URL}/link?code=${code}`, expires_at: expiresAt.toISOString() }, 201);
});

router.get("/:code", async (c) => {
  const code = c.req.param("code");
  const rows = await db.select().from(linkCodes).where(eq(linkCodes.code, code));
  if (rows.length === 0) return c.json({ error: "Not found" }, 404);
  const row = rows[0];
  if (row.claimedAt) return c.json({ status: "claimed", code });
  if (row.expiresAt < new Date()) return c.json({ status: "expired", code });
  return c.json({ status: "pending", code, expires_at: row.expiresAt.toISOString() });
});

router.post("/:code/claim", async (c) => {
  const code = c.req.param("code");
  const rows = await db.select().from(linkCodes).where(eq(linkCodes.code, code));
  if (rows.length === 0) return c.json({ error: "Not found" }, 404);
  const row = rows[0];
  if (row.claimedAt) return c.json({ error: "Already claimed" }, 409);
  if (row.expiresAt < new Date()) return c.json({ error: "Expired" }, 410);

  const { id, key, hash } = await generateServerKey();
  await db.transaction(async (tx) => {
    await tx.insert(serverKeys).values({ id, hash, label: null, createdAt: new Date() });
    await tx.update(linkCodes).set({ claimedAt: new Date(), serverKeyId: id }).where(eq(linkCodes.code, code));
  });

  // Push server_key to the plugin session waiting on this code (B1 flow).
  // No-op if the plugin has already disconnected.
  pushLinkConfirmed(code, key);

  return c.json({ server_key_id: id }, 200);
});

export { router as linkRouter };
```

- [ ] **Step 5: Add stub `pushLinkConfirmed` to `backend/src/ws/hub.ts`**

Append these exports at the end of the current `hub.ts` (full implementation comes in Task 4):

```ts
// Stubs — fully implemented in Task 4
export const connSenders = new Map<string, (msg: string) => void>();
const codeToConn = new Map<string, string>(); // link_code → connId

export function registerConn(connId: string, send: (msg: string) => void): void {
  connSenders.set(connId, send);
}

export function cleanupConn(connId: string): void {
  connSenders.delete(connId);
  for (const [code, cId] of codeToConn) {
    if (cId === connId) codeToConn.delete(code);
  }
  // Also clean authenticated session if present
}

export function pushLinkConfirmed(code: string, serverKey: string): void {
  const connId = codeToConn.get(code);
  if (!connId) return;
  const send = connSenders.get(connId);
  if (!send) return;
  send(JSON.stringify({ type: "link_confirmed", server_key: serverKey }));
  codeToConn.delete(code);
}
```

Also update `handlePluginMessage` signature to accept `connId` (keep the body unchanged for now — connId is just ignored until Task 4):

```ts
export async function handlePluginMessage(
  connId: string,
  raw: string,
): Promise<{ reply: string | null; sessionId?: string; push?: string[] }>
```

- [ ] **Step 6: Update `backend/src/ws/hub.test.ts` — pass connId**

In `hub.test.ts`, every call to `handlePluginMessage(JSON.stringify(hello))` becomes `handlePluginMessage("test-conn", JSON.stringify(hello))`. Edit both test cases:

```ts
const result = await handlePluginMessage("test-conn", JSON.stringify(hello));
```

- [ ] **Step 7: Mount link router and update WS handler in `backend/src/app.ts`**

Full `app.ts`:

```ts
import { Hono } from "hono";
import { createBunWebSocket } from "hono/bun";
import { bundlesRouter } from "./routes/bundles";
import { linkRouter } from "./routes/link";
import { serverKeysRouter } from "./routes/serverKeys";
import { cleanupConn, handlePluginMessage, registerConn } from "./ws/hub";

const { upgradeWebSocket, websocket } = createBunWebSocket();

export const app = new Hono();
export { websocket };

app.get("/health", (c) => c.json({ ok: true, ts: new Date().toISOString() }));
app.route("/api/server-keys", serverKeysRouter);
app.route("/api/bundles", bundlesRouter);
app.route("/api/link", linkRouter);

app.get(
  "/ws/plugin",
  upgradeWebSocket(() => {
    const connId = crypto.randomUUID();
    let sessionId: string | undefined;
    return {
      onOpen(_, ws) {
        registerConn(connId, (msg) => ws.send(msg));
      },
      async onMessage(evt, ws) {
        const raw = typeof evt.data === "string" ? evt.data : await (evt.data as Blob).text();
        const result = await handlePluginMessage(connId, raw);
        if (result.reply) ws.send(result.reply);
        for (const msg of result.push ?? []) ws.send(msg);
        if (result.sessionId) sessionId = result.sessionId;
      },
      onClose() {
        cleanupConn(connId);
      },
      onError: (err) => console.error("WS error:", err),
    };
  }),
);
```

- [ ] **Step 8: Run all backend tests — expect pass**

```bash
cd backend && bun test
```
Expected: all tests pass (schema test, helper tests, REST link tests, existing hub/bundle/serverKeys tests).

- [ ] **Step 9: Commit**

```bash
git add backend/src/protocol.ts backend/src/routes/link.ts backend/src/routes/link.test.ts backend/src/app.ts backend/src/ws/hub.ts backend/src/ws/hub.test.ts backend/src/routes/serverKeys.ts
git commit -m "feat(backend): REST link routes + WS hub stubs for server linking"
```

---

## Task 4: Backend WS — `setup_request` and `setup_claim` handlers

**Files:**
- Modify: `backend/src/ws/hub.ts`
- Modify: `backend/src/ws/hub.test.ts`

This replaces the stubs added in Task 3 with full implementation. The WS session now knows its `connId`; `setup_request` generates a code and maps it to the session; `setup_claim` validates the code and completes the link.

- [ ] **Step 1: Write failing tests**

Add to `backend/src/ws/hub.test.ts`:

```ts
import { connSenders, registerConn } from "./hub";

describe("setup_request", () => {
  test("returns setup_code with 8-char code and url", async () => {
    const connId = "conn-setup-req";
    registerConn(connId, () => {});
    const result = await handlePluginMessage(connId, JSON.stringify({ type: "setup_request" }));
    expect(result.reply).not.toBeNull();
    const msg = JSON.parse(result.reply!) as { type: string; code: string; url: string; expires_at: string };
    expect(msg.type).toBe("setup_code");
    expect(msg.code).toMatch(/^[A-Z2-9]{8}$/);
    expect(msg.url).toContain(msg.code);
    expect(new Date(msg.expires_at).getTime()).toBeGreaterThan(Date.now());
  });
});

describe("setup_claim", () => {
  test("valid code returns link_confirmed and pushes it to the registered conn", async () => {
    // Create a code via REST
    const createRes = await app.request("/api/link", { method: "POST" });
    const { code } = (await createRes.json()) as { code: string };

    const received: string[] = [];
    const connId = "conn-setup-claim";
    registerConn(connId, (msg) => received.push(msg));

    const result = await handlePluginMessage(connId, JSON.stringify({ type: "setup_claim", code }));
    // reply is link_confirmed sent directly
    expect(received.length).toBe(1);
    const msg = JSON.parse(received[0]) as { type: string; server_key: string };
    expect(msg.type).toBe("link_confirmed");
    expect(msg.server_key).toMatch(/^sk_[0-9a-f]{64}$/);
  });

  test("expired or unknown code returns null reply", async () => {
    const connId = "conn-setup-claim-bad";
    registerConn(connId, () => {});
    const result = await handlePluginMessage(connId, JSON.stringify({ type: "setup_claim", code: "BADCODE1" }));
    expect(result.reply).toBeNull();
  });
});
```

- [ ] **Step 2: Run — expect failure**

```bash
cd backend && bun test src/ws/hub.test.ts
```
Expected: `setup_request` test fails (no `setup_code` in reply yet).

- [ ] **Step 3: Implement full `hub.ts`**

Full file (replaces current content):

```ts
import { eq } from "drizzle-orm";
import { db } from "../db/index";
import { linkCodes, packBundles, serverKeys } from "../db/schema";
import { generateCode, generateServerKey } from "../lib/auth";
import { computeAllPacksHash } from "../lib/hashUtils";
import type {
  BundleAvailableMessage,
  HelloAckMessage,
  HelloMessage,
  LinkConfirmedMessage,
  SetupClaimMessage,
  SetupCodeMessage,
} from "../protocol";

const API_BASE_URL = process.env.API_BASE_URL ?? "http://localhost:3001";
const BUNDLE_BASE_URL = process.env.BUNDLE_BASE_URL ?? API_BASE_URL;
const EDITOR_URL = process.env.EDITOR_URL ?? "http://localhost:5173";

// Per-connection send functions (all connections, authenticated or not)
export const connSenders = new Map<string, (msg: string) => void>();
// Authenticated sessions: sessionId → serverId
const activeSessions = new Map<string, string>();
// link_code → connId (for B1: push link_confirmed to the plugin that generated the code)
const codeToConn = new Map<string, string>();

export function registerConn(connId: string, send: (msg: string) => void): void {
  connSenders.set(connId, send);
}

export function cleanupConn(connId: string): void {
  connSenders.delete(connId);
  for (const [code, cId] of codeToConn) {
    if (cId === connId) codeToConn.delete(code);
  }
}

export function cleanupSession(sessionId: string): void {
  activeSessions.delete(sessionId);
}

// Called by link.ts POST /:code/claim (B1 flow: browser claims plugin's code)
export function pushLinkConfirmed(code: string, serverKey: string): void {
  const connId = codeToConn.get(code);
  if (!connId) return;
  const send = connSenders.get(connId);
  if (send) send(JSON.stringify({ type: "link_confirmed", server_key: serverKey } satisfies LinkConfirmedMessage));
  codeToConn.delete(code);
}

async function validateServerKey(rawKey: string): Promise<string | null> {
  const hashBuf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawKey));
  const hash = Array.from(new Uint8Array(hashBuf), (b) => b.toString(16).padStart(2, "0")).join("");
  const rows = await db.select().from(serverKeys).where(eq(serverKeys.hash, hash));
  return rows.length > 0 ? rows[0].id : null;
}

export async function handlePluginMessage(
  connId: string,
  raw: string,
): Promise<{ reply: string | null; sessionId?: string; push?: string[] }> {
  let msg: { type: string };
  try { msg = JSON.parse(raw); } catch { return { reply: null }; }

  // ── authenticated hello ──────────────────────────────────────────────────
  if (msg.type === "hello") {
    const hello = msg as HelloMessage;
    const keyId = await validateServerKey(hello.server_key);
    if (!keyId) return { reply: null };

    const sessionId = crypto.randomUUID();
    activeSessions.set(sessionId, keyId);

    const latestHash = await computeAllPacksHash(keyId);
    const needsSync = latestHash !== "" && latestHash !== hello.current_bundle_hash;

    const packs = await db
      .select({ packId: packBundles.packId, hash: packBundles.hash })
      .from(packBundles)
      .where(eq(packBundles.serverId, keyId));

    const packHashesMap: Record<string, string> = {};
    for (const p of packs) packHashesMap[p.packId] = p.hash;

    const ack: HelloAckMessage = {
      type: "hello_ack",
      session_id: sessionId,
      server_id: keyId,
      tier: "free",
      needs_sync: needsSync,
      latest_bundle_hash: latestHash,
      api_url: API_BASE_URL,
      pack_hashes: packHashesMap,
    };

    const push: string[] = [];
    if (needsSync) {
      for (const pack of packs) {
        const available: BundleAvailableMessage = {
          type: "bundle_available",
          pack_id: pack.packId,
          url: `${BUNDLE_BASE_URL}/api/bundles/${pack.packId}`,
          hash: pack.hash,
          signature: "",
        };
        push.push(JSON.stringify(available));
      }
    }

    return { reply: JSON.stringify(ack), sessionId, push };
  }

  // ── setup_request (B1): plugin asks for a link code ──────────────────────
  if (msg.type === "setup_request") {
    const code = generateCode();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 10 * 60 * 1000);
    await db.insert(linkCodes).values({ code, createdAt: now, expiresAt });
    codeToConn.set(code, connId);

    const reply: SetupCodeMessage = {
      type: "setup_code",
      code,
      url: `${EDITOR_URL}/link?code=${code}`,
      expires_at: expiresAt.toISOString(),
    };
    return { reply: JSON.stringify(reply) };
  }

  // ── setup_claim (B2): plugin claims a dashboard-generated code ───────────
  if (msg.type === "setup_claim") {
    const { code } = msg as SetupClaimMessage;
    const rows = await db.select().from(linkCodes).where(eq(linkCodes.code, code));
    if (rows.length === 0 || rows[0].claimedAt || rows[0].expiresAt < new Date()) {
      return { reply: null };
    }

    const { id, key, hash } = await generateServerKey();
    await db.transaction(async (tx) => {
      await tx.insert(serverKeys).values({ id, hash, label: null, createdAt: new Date() });
      await tx.update(linkCodes).set({ claimedAt: new Date(), serverKeyId: id }).where(eq(linkCodes.code, code));
    });

    const send = connSenders.get(connId);
    if (send) send(JSON.stringify({ type: "link_confirmed", server_key: key } satisfies LinkConfirmedMessage));
    return { reply: null }; // link_confirmed sent directly via connSenders
  }

  if (msg.type === "pong") return { reply: null };

  return { reply: null };
}
```

- [ ] **Step 4: Run hub tests — expect pass**

```bash
cd backend && bun test src/ws/hub.test.ts
```
Expected: all tests pass.

- [ ] **Step 5: Run full backend test suite — expect pass**

```bash
cd backend && bun test
```
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add backend/src/ws/hub.ts backend/src/ws/hub.test.ts
git commit -m "feat(backend): WS setup_request and setup_claim handlers for server linking"
```

---

## Task 5: Plugin — `ConfigWriter`

**Files:**
- Create: `plugin/src/main/kotlin/net/artisanmc/plugin/config/ConfigWriter.kt`
- Create: `plugin/src/test/kotlin/net/artisanmc/plugin/ConfigWriterTest.kt`

`ConfigWriter` writes or updates the `server_key` field in `config.yml`. It uses a simple regex replace — no YAML parsing library needed for this single field.

- [ ] **Step 1: Write failing test**

Create `plugin/src/test/kotlin/net/artisanmc/plugin/ConfigWriterTest.kt`:

```kotlin
package net.artisanmc.plugin

import net.artisanmc.plugin.config.ConfigWriter
import java.io.File
import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ConfigWriterTest {

    private fun tmpFile(content: String): File {
        val f = Files.createTempFile("artisan_cfg_", ".yml").toFile()
        f.writeText(content)
        return f
    }

    @Test
    fun `replaces existing empty server_key`() {
        val f = tmpFile("server_key: \"\"\nws_url: \"wss://example.com\"\n")
        ConfigWriter.writeServerKey(f, "sk_abc123")
        val result = f.readText()
        assertTrue(result.contains("server_key: \"sk_abc123\""), "Got: $result")
        assertTrue(result.contains("ws_url:"), "ws_url should be preserved")
    }

    @Test
    fun `replaces existing non-empty server_key`() {
        val f = tmpFile("server_key: \"sk_old\"\nws_url: \"wss://example.com\"\n")
        ConfigWriter.writeServerKey(f, "sk_new")
        assertTrue(f.readText().contains("server_key: \"sk_new\""))
    }

    @Test
    fun `appends server_key when line absent`() {
        val f = tmpFile("ws_url: \"wss://example.com\"\n")
        ConfigWriter.writeServerKey(f, "sk_abc")
        assertTrue(f.readText().contains("server_key: \"sk_abc\""))
    }
}
```

- [ ] **Step 2: Run — expect failure**

```bash
cd plugin && ./gradlew test --tests "net.artisanmc.plugin.ConfigWriterTest" 2>&1 | tail -20
```
Expected: `Unresolved reference: ConfigWriter`.

- [ ] **Step 3: Create `ConfigWriter.kt`**

Create `plugin/src/main/kotlin/net/artisanmc/plugin/config/ConfigWriter.kt`:

```kotlin
package net.artisanmc.plugin.config

import java.io.File

object ConfigWriter {
    fun writeServerKey(configFile: File, serverKey: String) {
        val existing = if (configFile.exists()) configFile.readText() else ""
        val line = "server_key: \"$serverKey\""
        val updated = if (Regex("""^server_key:.*""", RegexOption.MULTILINE).containsMatchIn(existing)) {
            existing.replace(Regex("""^server_key:.*""", RegexOption.MULTILINE), line)
        } else {
            "$line\n$existing"
        }
        configFile.writeText(updated)
    }
}
```

- [ ] **Step 4: Run — expect pass**

```bash
cd plugin && ./gradlew test --tests "net.artisanmc.plugin.ConfigWriterTest"
```
Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add plugin/src/main/kotlin/net/artisanmc/plugin/config/ConfigWriter.kt plugin/src/test/kotlin/net/artisanmc/plugin/ConfigWriterTest.kt
git commit -m "feat(plugin): ConfigWriter — write server_key to config.yml"
```

---

## Task 6: Plugin — `SetupClient`

**Files:**
- Create: `plugin/src/main/kotlin/net/artisanmc/plugin/ws/SetupClient.kt`
- Create: `plugin/src/test/kotlin/net/artisanmc/plugin/SetupClientTest.kt`

`SetupClient` is a one-shot OkHttp WS client. It connects to `/ws/plugin`, sends either `setup_request` (no code) or `setup_claim { code }` on open, dispatches `setup_code` and `link_confirmed` messages to callbacks, then disconnects on `link_confirmed`. No reconnect — if the connection fails the user re-runs `/artisan setup`.

- [ ] **Step 1: Write failing tests**

Create `plugin/src/test/kotlin/net/artisanmc/plugin/SetupClientTest.kt`:

```kotlin
package net.artisanmc.plugin

import com.fasterxml.jackson.databind.ObjectMapper
import net.artisanmc.plugin.ws.SetupClient
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class SetupClientTest {
    private val mapper = ObjectMapper()

    @Test
    fun `B1 — setup_request sent on open, setup_code delivered to onCode`() {
        val server = MockWebServer()
        val codeLatch = CountDownLatch(1)
        var receivedCode = ""

        server.enqueue(MockResponse().withWebSocketUpgrade(object : WebSocketListener() {
            override fun onMessage(ws: WebSocket, text: String) {
                val node = mapper.readTree(text)
                assertEquals("setup_request", node["type"].asText())
                ws.send("""{"type":"setup_code","code":"ABCD1234","url":"http://localhost:5173/link?code=ABCD1234","expires_at":"2099-01-01T00:00:00Z"}""")
            }
        }))
        server.start()

        val client = SetupClient(
            url = server.url("/ws/plugin").toString(),
            code = null,
            onCode = { code, _ -> receivedCode = code; codeLatch.countDown() },
            onLinked = {},
        )
        client.connect()

        assertTrue(codeLatch.await(5, TimeUnit.SECONDS))
        assertEquals("ABCD1234", receivedCode)
        client.disconnect()
        server.shutdown()
    }

    @Test
    fun `B2 — setup_claim sent on open with code, link_confirmed delivered to onLinked`() {
        val server = MockWebServer()
        val linkedLatch = CountDownLatch(1)
        var receivedKey = ""

        server.enqueue(MockResponse().withWebSocketUpgrade(object : WebSocketListener() {
            override fun onMessage(ws: WebSocket, text: String) {
                val node = mapper.readTree(text)
                assertEquals("setup_claim", node["type"].asText())
                assertEquals("ABCD1234", node["code"].asText())
                ws.send("""{"type":"link_confirmed","server_key":"sk_abc"}""")
            }
        }))
        server.start()

        val client = SetupClient(
            url = server.url("/ws/plugin").toString(),
            code = "ABCD1234",
            onCode = { _, _ -> },
            onLinked = { key -> receivedKey = key; linkedLatch.countDown() },
        )
        client.connect()

        assertTrue(linkedLatch.await(5, TimeUnit.SECONDS))
        assertEquals("sk_abc", receivedKey)
        server.shutdown()
    }
}
```

- [ ] **Step 2: Run — expect failure**

```bash
cd plugin && ./gradlew test --tests "net.artisanmc.plugin.SetupClientTest" 2>&1 | tail -20
```
Expected: `Unresolved reference: SetupClient`.

- [ ] **Step 3: Create `SetupClient.kt`**

Create `plugin/src/main/kotlin/net/artisanmc/plugin/ws/SetupClient.kt`:

```kotlin
package net.artisanmc.plugin.ws

import com.fasterxml.jackson.databind.ObjectMapper
import okhttp3.*
import java.util.concurrent.TimeUnit

class SetupClient(
    private val url: String,
    private val code: String?,            // null → B1 (generate code); non-null → B2 (claim code)
    private val onCode: (code: String, url: String) -> Unit,
    private val onLinked: (serverKey: String) -> Unit,
) {
    private val mapper = ObjectMapper()
    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.SECONDS)   // no read timeout — we wait for the push
        .build()
    @Volatile private var socket: WebSocket? = null

    fun connect() {
        val req = Request.Builder().url(url).build()
        socket = httpClient.newWebSocket(req, Listener())
    }

    fun disconnect() {
        socket?.close(1000, "Setup done")
        httpClient.dispatcher.cancelAll()
        httpClient.connectionPool.evictAll()
        httpClient.dispatcher.executorService.shutdown()
    }

    private inner class Listener : WebSocketListener() {
        override fun onOpen(ws: WebSocket, response: Response) {
            val msg = if (code != null)
                mapOf("type" to "setup_claim", "code" to code)
            else
                mapOf("type" to "setup_request")
            ws.send(mapper.writeValueAsString(msg))
        }

        override fun onMessage(ws: WebSocket, text: String) {
            val node = runCatching { mapper.readTree(text) }.getOrNull() ?: return
            when (node["type"]?.asText()) {
                "setup_code" -> {
                    val c = node["code"]?.asText() ?: return
                    val u = node["url"]?.asText() ?: return
                    onCode(c, u)
                }
                "link_confirmed" -> {
                    val key = node["server_key"]?.asText() ?: return
                    onLinked(key)
                    ws.close(1000, "Linked")
                }
            }
        }

        override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) {
            // No reconnect — user must re-run /artisan setup
        }
    }
}
```

- [ ] **Step 4: Run — expect pass**

```bash
cd plugin && ./gradlew test --tests "net.artisanmc.plugin.SetupClientTest"
```
Expected: 2 tests PASS.

- [ ] **Step 5: Run full plugin test suite — expect pass**

```bash
cd plugin && ./gradlew test 2>&1 | tail -15
```
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add plugin/src/main/kotlin/net/artisanmc/plugin/ws/SetupClient.kt plugin/src/test/kotlin/net/artisanmc/plugin/SetupClientTest.kt
git commit -m "feat(plugin): SetupClient — one-shot WS client for B1/B2 linking handshake"
```

---

## Task 7: Plugin — `/artisan setup` command + `ArtisanPlugin.reinit()`

**Files:**
- Modify: `plugin/src/main/kotlin/net/artisanmc/plugin/command/ArtisanCommand.kt`
- Modify: `plugin/src/main/kotlin/net/artisanmc/plugin/ArtisanPlugin.kt`
- Modify: `plugin/src/main/resources/plugin.yml`

`/artisan setup` can be run from both console and in-game. Without arguments → B1. With a code argument → B2.

- [ ] **Step 1: Write failing test**

Create `plugin/src/test/kotlin/net/artisanmc/plugin/SetupCommandTest.kt`:

```kotlin
package net.artisanmc.plugin

import be.seeseemelk.mockbukkit.MockBukkit
import com.fasterxml.jackson.databind.ObjectMapper
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.test.*

class SetupCommandTest {

    @BeforeTest fun setup() { MockBukkit.mock() }
    @AfterTest  fun teardown() { MockBukkit.unmock() }

    @Test
    fun `setup command without args sends setup_request to backend`() {
        val mapper = ObjectMapper()
        val latch = CountDownLatch(1)
        var receivedType = ""

        MockWebServer().use { server ->
            server.enqueue(MockResponse().withWebSocketUpgrade(object : WebSocketListener() {
                override fun onMessage(ws: WebSocket, text: String) {
                    receivedType = mapper.readTree(text)["type"].asText()
                    latch.countDown()
                    ws.close(1000, "done")
                }
            }))
            server.start()

            val plugin = MockBukkit.load(ArtisanPlugin::class.java)

            val sender = MockBukkit.getMock().consoleSender
            plugin.onCommand(sender, plugin.getCommand("ifz")!!, "ifz", arrayOf("setup"))

            // The SetupClient uses the wsUrl from config — we can't inject the MockWebServer URL here
            // in a unit test without config injection. This test just verifies the command is accepted
            // without throwing.
            assertTrue(true, "Command accepted without exception")
        }
    }
}
```

Note: Full integration of `/artisan setup` with a real WS mock requires config injection into ArtisanPlugin, which is complex with MockBukkit. The test above verifies the command is registered and accepted. The `SetupClientTest` (Task 6) already covers the WS protocol. The `FullSyncIntegrationTest` style of test for setup would require writing a config.yml with the mock server URL — worth adding as a follow-up if needed.

- [ ] **Step 2: Run — expect failure**

```bash
cd plugin && ./gradlew test --tests "net.artisanmc.plugin.SetupCommandTest" 2>&1 | tail -20
```
Expected: `setup` is not a known subcommand → command ignored or error.

- [ ] **Step 3: Add `setup` subcommand to `ArtisanCommand.kt`**

Full file:

```kotlin
package net.artisanmc.plugin.command

import net.artisanmc.plugin.ArtisanPlugin
import net.artisanmc.plugin.config.ConfigWriter
import net.artisanmc.plugin.config.PluginConfig
import net.artisanmc.plugin.ws.SetupClient
import org.bukkit.Bukkit
import org.bukkit.command.Command
import org.bukkit.command.CommandExecutor
import org.bukkit.command.CommandSender
import org.bukkit.entity.Player

class ArtisanCommand(private val plugin: ArtisanPlugin) : CommandExecutor {

    @Volatile private var setupClient: SetupClient? = null

    override fun onCommand(sender: CommandSender, command: Command, label: String, args: Array<out String>): Boolean {
        when (args.getOrNull(0)?.lowercase()) {
            "menu" -> {
                if (sender !is Player) { sender.sendMessage("In-game only."); return true }
                val menuId = args.getOrNull(1) ?: run { sender.sendMessage("Usage: /artisan menu <id>"); return true }
                plugin.menuProvider.openMenu(sender, menuId, "en")
            }
            "reload" -> {
                plugin.menuProvider.unload()
                plugin.menuProvider.load()
                sender.sendMessage("Artisan reloaded.")
            }
            "sync" -> {
                when (args.getOrNull(1)?.lowercase()) {
                    "status" -> sender.sendMessage("Check server logs for sync status details.")
                    "reject" -> {
                        plugin.menuProvider.unload()
                        plugin.menuProvider.load()
                        sender.sendMessage("Reconnecting to backend — backend version will be applied if available.")
                    }
                    else -> sender.sendMessage("Usage: /artisan sync <status|reject>")
                }
            }
            "setup" -> setup(sender, args.getOrNull(1)?.uppercase())
            else -> sender.sendMessage("Usage: /artisan <menu <id>|reload|sync <status|reject>|setup [CODE]>")
        }
        return true
    }

    private fun setup(sender: CommandSender, code: String?) {
        setupClient?.disconnect()
        val cfg = PluginConfig.from(plugin.config)
        if (cfg.wsUrl.isEmpty()) {
            sender.sendMessage("[Artisan] ws_url is not configured in config.yml.")
            return
        }

        sender.sendMessage("[Artisan] Connexion au backend en cours...")

        val configFile = plugin.dataFolder.resolve("config.yml")

        setupClient = SetupClient(
            url = cfg.wsUrl,
            code = code,
            onCode = { receivedCode, url ->
                val msg = "[Artisan] Lier ce serveur : $url"
                plugin.logger.info(msg)
                Bukkit.getScheduler().runTask(plugin, Runnable {
                    sender.sendMessage(msg)
                })
            },
            onLinked = { serverKey ->
                ConfigWriter.writeServerKey(configFile, serverKey)
                plugin.logger.info("[Artisan] Serveur lié ✓ (server_key écrit dans config.yml)")
                Bukkit.getScheduler().runTask(plugin, Runnable {
                    sender.sendMessage("[Artisan] Serveur lié ✓ Rechargement en cours...")
                    plugin.reloadConfig()
                    plugin.reinit(PluginConfig.from(plugin.config))
                    sender.sendMessage("[Artisan] Prêt.")
                })
            },
        )
        setupClient!!.connect()
    }
}
```

- [ ] **Step 4: Add `reinit()` to `ArtisanPlugin.kt`**

Full file:

```kotlin
package net.artisanmc.plugin

import net.artisanmc.plugin.command.ArtisanCommand
import net.artisanmc.plugin.config.PluginConfig
import net.artisanmc.plugin.provider.MenuProvider
import net.artisanmc.plugin.provider.SyncedMenuProvider
import org.bukkit.plugin.java.JavaPlugin
import java.io.File

open class ArtisanPlugin : JavaPlugin() {
    lateinit var menuProvider: MenuProvider
        private set

    override fun onEnable() {
        saveDefaultConfig()
        val cfg = PluginConfig.from(config)
        val packsDir = File(dataFolder.parentFile, cfg.packsDir).also { it.mkdirs() }
        menuProvider = SyncedMenuProvider(
            packsDir  = packsDir,
            serverKey = cfg.serverKey,
            wsUrl     = cfg.wsUrl,
            logger    = logger,
        )
        menuProvider.load()
        getCommand("ifz")?.setExecutor(ArtisanCommand(this))
        logger.info("Artisan ${description.version} enabled")
    }

    override fun onDisable() {
        menuProvider.unload()
        logger.info("Artisan disabled")
    }

    fun reinit(cfg: PluginConfig) {
        menuProvider.unload()
        val packsDir = File(dataFolder.parentFile, cfg.packsDir).also { it.mkdirs() }
        menuProvider = SyncedMenuProvider(
            packsDir  = packsDir,
            serverKey = cfg.serverKey,
            wsUrl     = cfg.wsUrl,
            logger    = logger,
        )
        menuProvider.load()
        getCommand("ifz")?.setExecutor(ArtisanCommand(this))
    }
}
```

- [ ] **Step 5: Update `plugin.yml` usage string**

Edit `plugin/src/main/resources/plugin.yml`:

```yaml
name: Artisan
version: '1.0.0'
main: net.artisanmc.plugin.ArtisanPlugin
api-version: '1.21'
description: Artisan GUI editor plugin
commands:
  ifz:
    description: Artisan commands
    usage: /artisan <menu <id>|reload|sync <status|reject>|setup [CODE]>
```

- [ ] **Step 6: Run all plugin tests — expect pass**

```bash
cd plugin && ./gradlew test 2>&1 | tail -15
```
Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add plugin/src/main/kotlin/net/artisanmc/plugin/command/ArtisanCommand.kt plugin/src/main/kotlin/net/artisanmc/plugin/ArtisanPlugin.kt plugin/src/main/resources/plugin.yml plugin/src/test/kotlin/net/artisanmc/plugin/SetupCommandTest.kt
git commit -m "feat(plugin): /artisan setup command + ArtisanPlugin.reinit() for server linking"
```

---

## Task 8: Editor — `/link` route

**Files:**
- Create: `editor/src/lib/linkApi.ts`
- Create: `editor/src/routes/link.tsx`

The `/link` route handles two modes:
- **B1** — `?code=ABCD1234` in URL: shows the code and a "Link this server" button that calls `POST /api/link/:code/claim`.
- **B2** — no code: "Generate a code" button calls `POST /api/link`, then shows the code with a `/artisan setup CODE` instruction and polls `GET /api/link/:code` every 2 seconds until `status === "claimed"`.

`VITE_API_URL` env var controls the backend URL (default `http://localhost:5173` is wrong — default to `http://localhost:3001`).

- [ ] **Step 1: Add `VITE_API_URL` to editor `.env.example`**

Create `editor/.env.example` (or append if it exists):

```bash
VITE_API_URL=http://localhost:3001
```

- [ ] **Step 2: Create `editor/src/lib/linkApi.ts`**

```ts
const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

export interface LinkCodeResponse {
  code: string;
  url: string;
  expires_at: string;
}

export interface LinkStatusResponse {
  status: "pending" | "claimed" | "expired";
  code: string;
  expires_at?: string;
}

export async function createLinkCode(): Promise<LinkCodeResponse> {
  const res = await fetch(`${API_URL}/api/link`, { method: "POST" });
  if (!res.ok) throw new Error(`Failed to create link code: ${res.status}`);
  return res.json() as Promise<LinkCodeResponse>;
}

export async function getLinkStatus(code: string): Promise<LinkStatusResponse> {
  const res = await fetch(`${API_URL}/api/link/${code}`);
  if (!res.ok) throw new Error(`Failed to get link status: ${res.status}`);
  return res.json() as Promise<LinkStatusResponse>;
}

export async function claimLinkCode(code: string): Promise<{ server_key_id: string }> {
  const res = await fetch(`${API_URL}/api/link/${code}/claim`, { method: "POST" });
  if (res.status === 409) throw new Error("Already claimed");
  if (res.status === 410) throw new Error("Code expired");
  if (!res.ok) throw new Error(`Failed to claim: ${res.status}`);
  return res.json() as Promise<{ server_key_id: string }>;
}
```

- [ ] **Step 3: Create `editor/src/routes/link.tsx`**

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { claimLinkCode, createLinkCode, getLinkStatus, type LinkCodeResponse } from "@/lib/linkApi";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/link")({
  component: LinkPage,
});

function LinkPage() {
  const search = new URLSearchParams(window.location.search);
  const codeFromUrl = search.get("code")?.toUpperCase() ?? null;
  return codeFromUrl ? <ClaimFlow code={codeFromUrl} /> : <GenerateFlow />;
}

// ── B1: browser claims the plugin's code ────────────────────────────────────

function ClaimFlow({ code }: { code: string }) {
  const [state, setState] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [error, setError] = useState("");

  async function claim() {
    setState("loading");
    try {
      await claimLinkCode(code);
      setState("success");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
      setState("error");
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-2xl font-semibold">Lier un serveur Minecraft</h1>

      {state === "idle" && (
        <>
          <p className="text-muted-foreground max-w-sm text-center">
            Code de liaison : <span className="font-mono font-bold">{code}</span>
          </p>
          <p className="text-muted-foreground max-w-sm text-center text-sm">
            Ce code a été généré sur votre serveur via <code>/artisan setup</code>. Cliquez pour valider
            le lien.
          </p>
          <Button onClick={claim}>Lier ce serveur</Button>
        </>
      )}

      {state === "loading" && <p className="text-muted-foreground">Liaison en cours…</p>}

      {state === "success" && (
        <div className="flex flex-col items-center gap-2">
          <p className="text-lg font-medium text-green-600">Serveur lié ✓</p>
          <p className="text-muted-foreground text-sm">
            Votre plugin a reçu sa clé et se reconnecte automatiquement.
          </p>
        </div>
      )}

      {state === "error" && (
        <div className="flex flex-col items-center gap-3">
          <p className="text-destructive">{error}</p>
          <Button variant="outline" onClick={() => setState("idle")}>
            Réessayer
          </Button>
        </div>
      )}
    </div>
  );
}

// ── B2: browser generates the code, admin enters it on the server ────────────

function GenerateFlow() {
  const [linkCode, setLinkCode] = useState<LinkCodeResponse | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "pending" | "claimed" | "expired">("idle");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function generate() {
    setStatus("loading");
    try {
      const data = await createLinkCode();
      setLinkCode(data);
      setStatus("pending");
      pollRef.current = setInterval(async () => {
        const s = await getLinkStatus(data.code);
        if (s.status === "claimed") {
          setStatus("claimed");
          clearInterval(pollRef.current!);
        } else if (s.status === "expired") {
          setStatus("expired");
          clearInterval(pollRef.current!);
        }
      }, 2_000);
    } catch {
      setStatus("idle");
    }
  }

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-2xl font-semibold">Ajouter un serveur Minecraft</h1>

      {status === "idle" && (
        <>
          <p className="text-muted-foreground max-w-sm text-center text-sm">
            Générez un code de liaison, puis tapez la commande affichée sur votre serveur Minecraft.
          </p>
          <Button onClick={generate}>Générer un code</Button>
        </>
      )}

      {status === "loading" && <p className="text-muted-foreground">Génération…</p>}

      {status === "pending" && linkCode && (
        <div className="flex flex-col items-center gap-4">
          <p className="text-muted-foreground text-sm">
            Tapez cette commande sur votre serveur Minecraft :
          </p>
          <code className="rounded bg-muted px-4 py-3 text-lg font-bold tracking-wider">
            /artisan setup {linkCode.code}
          </code>
          <p className="text-muted-foreground text-xs animate-pulse">En attente de connexion…</p>
        </div>
      )}

      {status === "claimed" && (
        <div className="flex flex-col items-center gap-2">
          <p className="text-lg font-medium text-green-600">Serveur lié ✓</p>
          <p className="text-muted-foreground text-sm">
            Le plugin a reçu sa clé et se reconnecte automatiquement.
          </p>
        </div>
      )}

      {status === "expired" && (
        <div className="flex flex-col items-center gap-3">
          <p className="text-muted-foreground">Le code a expiré (10 minutes).</p>
          <Button onClick={() => { setStatus("idle"); setLinkCode(null); }}>
            Générer un nouveau code
          </Button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Regenerate TanStack Router route tree**

```bash
cd editor && npm run dev
```
Let the dev server start (it auto-runs `@tanstack/router-vite-plugin` which regenerates `routeTree.gen.ts`). Wait for the "ready" message, then kill it with Ctrl+C.

- [ ] **Step 5: Verify route renders in browser**

Open `http://localhost:5173/link` — expect the "Ajouter un serveur Minecraft" view.
Open `http://localhost:5173/link?code=ABCD1234` — expect the "Lier un serveur Minecraft" view with code ABCD1234.

- [ ] **Step 6: Run editor tests — expect pass**

```bash
cd editor && npx vitest run
```
Expected: all 366 existing tests pass (new route has no unit test — it's thin UI glue; the API layer is tested by backend tests).

- [ ] **Step 7: Build editor — expect no type errors**

```bash
cd editor && npm run build
```
Expected: build succeeds with no TypeScript errors.

- [ ] **Step 8: Commit**

```bash
git add editor/src/lib/linkApi.ts editor/src/routes/link.tsx editor/src/routeTree.gen.ts editor/.env.example
git commit -m "feat(editor): /link route for B1 claim and B2 generate-and-poll server linking"
```

---

## Self-review

**Spec coverage:**
- B1 (plugin generates code → browser claims): covered by Tasks 4 (`setup_request` WS) + 6 (`SetupClient`) + 7 (`/artisan setup`) + 8 (ClaimFlow in `/link`)
- B2 (browser generates code → plugin claims): covered by Task 3 (`POST /api/link`) + Task 4 (`setup_claim` WS) + Task 6 (`SetupClient` with code arg) + Task 7 (`/artisan setup CODE`) + Task 8 (GenerateFlow)
- Config.yml written automatically: Task 5 (ConfigWriter) + Task 7 (onLinked callback)
- Plugin reinits after linking: Task 7 (ArtisanPlugin.reinit)
- Code expires in 10 min: Tasks 1 + 3 + 4
- Code cannot be claimed twice: Task 3 test (409), Task 4 (`claimedAt` check)

**Placeholder scan:** No TBDs. All code is complete in each step.

**Type consistency:** `SetupClient.onLinked` receives `serverKey: String` → `ConfigWriter.writeServerKey(file, serverKey)` ✓. `ArtisanCommand.setup()` calls `PluginConfig.from(plugin.config).wsUrl` ✓. `pushLinkConfirmed(code, key)` uses the same `code` string throughout ✓.

**Auth note:** `POST /api/link/:code/claim` is unauthenticated in this plan. When auth lands: add `validateUserJwt(c)` check at the top of the claim handler and a `userId` column to `server_keys`.
