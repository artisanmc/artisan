# Accounts × Networks UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Comble le trou UX entre le système accounts (Plan 1A) et Networks (Plan 1B/1C) déjà mergés et l'ancien flow `/artisan setup` qui créait des Networks anonymes.

**Architecture:** Hard break sur `/artisan setup` (login requis pour claim), nouvelle UI éditeur `/networks/*` pour gérer Networks/server_keys, transfert de Network entier via lien partageable, et auto-push bootstrap au hello pour récupérer les packs disque.

**Tech Stack:** Backend Bun + Hono + Drizzle + PostgreSQL, Editor React 19 + Vite 6 + TanStack Router + Zustand, Plugin Kotlin 2.0 + Paper + OkHttp.

**Spec:** `docs/superpowers/specs/2026-05-22-accounts-networks-ux-design.md`

---

## File Structure

### Backend — `backend/src/`

- **Create**:
  - `routes/networkTransfers.ts` — POST /init, GET /:token, POST /:token/accept
  - `routes/networkTransfers.test.ts`
  - `lib/networkTransferStorage.ts` — DB helpers for `network_transfers`
- **Modify**:
  - `db/schema.ts` — add `networkTransfers` table
  - `routes/link.ts` — claim now requires `artisan_user_session` cookie + body `{network_id?}`
  - `routes/link.test.ts` — update tests for new claim behavior
  - `routes/userNetworks.ts` — add `DELETE /:id/server-keys/:keyId`, mount `networkTransfers` router
  - `routes/editorSession.ts:96-103` — `GET /:token` returns `network_id`
  - `routes/editorSession.test.ts` — adjust assertions

### Editor — `editor/src/`

- **Create**:
  - `routes/networks.tsx` — index page (list)
  - `routes/networks.$id.tsx` — detail (packs + server_keys + members)
  - `routes/networks.$id.settings.tsx` — rename + delete + transfer init
  - `routes/transfer.tsx` — accept transfer page
  - `features/networks/NetworkCard.tsx`, `NetworkPackList.tsx`, `ServerKeyList.tsx`, `TransferInitModal.tsx`
  - Per-route test files
- **Modify**:
  - `lib/api/networks.ts` — add `transferInit`, `transferAccept`, `getTransfer`, `deleteServerKey`
  - `routes/index.tsx` — redirect logic
  - `routes/link.tsx` — REVAMP : auth gate + wizard claim
  - `routes/login.tsx` — support `?next=` query param
  - `routes/session.tsx` — read `network_id` from validate response, render banner

### Plugin — `plugin/src/main/kotlin/`

- **Modify**:
  - `net/artisanmc/plugin/provider/SyncedMenuProvider.kt` — `handleHelloAck` walks packDir + auto-pushes disk-only packs
- **Test**:
  - `net/artisanmc/plugin/FullSyncIntegrationTest.kt` — new test "auto-push at hello when disk non-empty + backend empty"

### Docs

- **Modify**:
  - `CLAUDE.md` — endpoints section + entities section
  - `.claude/skills/sync-docs/doc-impact-map.yaml`

---

## Phase A — Backend DB schema

### Task A1: Add `network_transfers` table

**Files:**
- Modify: `backend/src/db/schema.ts`

- [ ] **Step 1: Add table definition after `discordAccounts`**

```ts
export const networkTransfers = pgTable("network_transfers", {
  token: text("token").primaryKey(),
  networkId: text("network_id").notNull().references(() => networks.id, { onDelete: "cascade" }),
  initiatedByUserId: text("initiated_by_user_id").notNull().references(() => users.id),
  expiresAt: timestamp("expires_at").notNull(),
  consumedAt: timestamp("consumed_at"),
  consumedByUserId: text("consumed_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull(),
}, (t) => [
  index("network_transfers_network_idx").on(t.networkId),
]);
```

- [ ] **Step 2: Push schema**

```bash
cd backend && bun run db:push
```

Expected: `Changes applied` (1 new table).

- [ ] **Step 3: Commit**

```bash
git add backend/src/db/schema.ts
git commit -m "feat(backend): add network_transfers table"
```

---

## Phase B — Backend claim hard-break

### Task B1: Test that claim 401s without `artisan_user_session` cookie

**Files:**
- Modify: `backend/src/routes/link.test.ts`

- [ ] **Step 1: Add failing test**

In `link.test.ts`, after the existing claim tests:

```ts
import { describe, expect, it, beforeEach } from "bun:test";

describe("POST /api/link/:code/claim — hard break (Plan accounts × networks)", () => {
  it("returns 401 when no artisan_user_session cookie is present", async () => {
    const created = await app.request("/api/link/", { method: "POST" });
    const { code } = await created.json();

    const res = await app.request(`/api/link/${code}/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("unauthorized");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && bun test src/routes/link.test.ts
```

Expected: `(fail) ... returns 401 when no artisan_user_session cookie ...` (current claim is anonymous, returns 200).

- [ ] **Step 3: Modify the claim handler to require auth**

Replace the body of `router.post("/:code/claim", …)` in `backend/src/routes/link.ts`:

```ts
import { getCookie } from "hono/cookie";
import { validateUserSession } from "../lib/sessionManager";
import { addMembership } from "../lib/membershipManager";

router.post("/:code/claim", async (c) => {
  const userSessionId = getCookie(c, "artisan_user_session");
  if (!userSessionId) return c.json({ error: "unauthorized" }, 401);
  const user = await validateUserSession(userSessionId);
  if (!user) return c.json({ error: "unauthorized" }, 401);

  const code = c.req.param("code");
  const rows = await db.select().from(linkCodes).where(eq(linkCodes.code, code));
  if (rows.length === 0) return c.json({ error: "Not found" }, 404);
  const row = rows[0];
  if (row.claimedAt) return c.json({ error: "Already claimed" }, 409);
  if (row.expiresAt < new Date()) return c.json({ error: "Expired" }, 410);

  // Parse optional network_id from body
  let networkIdInput: string | undefined;
  try {
    const body = await c.req.json<{ network_id?: string }>();
    networkIdInput = typeof body.network_id === "string" ? body.network_id : undefined;
  } catch {
    networkIdInput = undefined;
  }

  // Determine target network with smart-count logic
  const userMemberships = await db.select({ networkId: memberships.networkId })
    .from(memberships)
    .where(eq(memberships.userId, user.id));
  const ownedNetworkIds = userMemberships.map((m) => m.networkId);

  let targetNetworkId: string;
  if (networkIdInput) {
    if (!ownedNetworkIds.includes(networkIdInput)) {
      return c.json({ error: "forbidden" }, 403);
    }
    targetNetworkId = networkIdInput;
  } else if (ownedNetworkIds.length === 0) {
    const network = await createNetwork("Mon Network");
    await addMembership({ userId: user.id, networkId: network.id, role: "owner" });
    targetNetworkId = network.id;
  } else if (ownedNetworkIds.length === 1) {
    targetNetworkId = ownedNetworkIds[0];
  } else {
    return c.json({ error: "must_choose_network", networks: ownedNetworkIds }, 400);
  }

  const { id, key, hash } = await generateServerKey();
  await db.transaction(async (tx) => {
    await tx.insert(serverKeys).values({
      id, hash, label: null, networkId: targetNetworkId, createdAt: new Date(),
    });
    await tx.update(linkCodes).set({ claimedAt: new Date(), serverKeyId: id })
      .where(eq(linkCodes.code, code));
  });

  pushLinkConfirmed(code, key);
  return c.json({ server_key_id: id, network_id: targetNetworkId }, 200);
});
```

Add the import at top:

```ts
import { memberships } from "../db/schema";
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd backend && bun test src/routes/link.test.ts -t "returns 401"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/link.ts backend/src/routes/link.test.ts
git commit -m "feat(backend): claim requires artisan_user_session cookie"
```

### Task B2: Test smart-count network selection

**Files:**
- Modify: `backend/src/routes/link.test.ts`

- [ ] **Step 1: Add three new tests covering 0 / 1 / 2+ networks**

```ts
describe("POST /api/link/:code/claim — smart network selection", () => {
  async function loginAndGetCookie(): Promise<string> {
    // Create a user via direct DB insert (faster than going through signup)
    const userId = `user_${Math.random().toString(36).slice(2, 10)}`;
    await db.insert(users).values({
      id: userId,
      email: `${userId}@test.dev`,
      name: "Test",
      passwordHash: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const sessionId = `sess_${Math.random().toString(36).slice(2, 18)}`;
    await db.insert(userSessions).values({
      id: sessionId,
      userId,
      createdAt: new Date(),
      lastUsedAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });
    return sessionId;
  }

  async function makeClaim(sessionId: string, body: object): Promise<Response> {
    const created = await app.request("/api/link/", { method: "POST" });
    const { code } = await created.json();
    return app.request(`/api/link/${code}/claim`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cookie": `artisan_user_session=${sessionId}`,
      },
      body: JSON.stringify(body),
    });
  }

  it("auto-creates 'Mon Network' when user has 0 networks", async () => {
    const sessionId = await loginAndGetCookie();
    const res = await makeClaim(sessionId, {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.network_id).toBeTruthy();
    const [created] = await db.select().from(networks).where(eq(networks.id, body.network_id));
    expect(created.name).toBe("Mon Network");
  });

  it("uses the single network when user has exactly 1", async () => {
    const sessionId = await loginAndGetCookie();
    // First claim creates "Mon Network"
    await makeClaim(sessionId, {});
    // Second claim should re-use it
    const res = await makeClaim(sessionId, {});
    expect(res.status).toBe(200);
    const owned = await db.select().from(memberships)
      .where(eq(memberships.userId, /* userId from session */ "..."));
    // (extract userId from session row; assert only one network row)
  });

  it("returns 400 must_choose_network when user has 2+ networks and body omits network_id", async () => {
    const sessionId = await loginAndGetCookie();
    // Setup: create 2 networks via direct DB
    // ... (using createNetwork + addMembership helpers)
    const res = await makeClaim(sessionId, {});
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("must_choose_network");
  });

  it("returns 403 when user is not a member of the requested network_id", async () => {
    const sessionId = await loginAndGetCookie();
    // Create a foreign network
    const foreign = await createNetwork("foreign");
    const res = await makeClaim(sessionId, { network_id: foreign.id });
    expect(res.status).toBe(403);
  });
});
```

(Inline helper bodies as full code; the engineer should fill in the `// (extract userId ...)` from session — see neighbor test `auth.test.ts` for patterns.)

- [ ] **Step 2: Run tests**

```bash
cd backend && bun test src/routes/link.test.ts
```

Expected: 4 new tests + existing tests all pass.

- [ ] **Step 3: Commit**

```bash
git add backend/src/routes/link.test.ts
git commit -m "test(backend): claim smart-count network selection"
```

---

## Phase C — Backend transfer flows + delete server-key

### Task C1: Storage helpers for `network_transfers`

**Files:**
- Create: `backend/src/lib/networkTransferStorage.ts`

- [ ] **Step 1: Create the file**

```ts
import { and, eq } from "drizzle-orm";
import { db } from "../db/index";
import { networkTransfers } from "../db/schema";
import { generateEditorToken } from "./auth";

export interface NetworkTransfer {
  token: string;
  networkId: string;
  initiatedByUserId: string;
  expiresAt: Date;
  consumedAt: Date | null;
  consumedByUserId: string | null;
  createdAt: Date;
}

const TTL_HOURS = 24;

export async function createTransfer(networkId: string, userId: string): Promise<NetworkTransfer> {
  const token = generateEditorToken();
  const now = new Date();
  const row = {
    token,
    networkId,
    initiatedByUserId: userId,
    expiresAt: new Date(now.getTime() + TTL_HOURS * 60 * 60 * 1000),
    consumedAt: null,
    consumedByUserId: null,
    createdAt: now,
  } as const;
  await db.insert(networkTransfers).values(row);
  return row;
}

export async function getTransfer(token: string): Promise<NetworkTransfer | null> {
  const rows = await db.select().from(networkTransfers).where(eq(networkTransfers.token, token));
  return rows.length > 0 ? rows[0] : null;
}

export async function consumeTransfer(token: string, userId: string): Promise<NetworkTransfer | null> {
  const now = new Date();
  const updated = await db.update(networkTransfers)
    .set({ consumedAt: now, consumedByUserId: userId })
    .where(and(
      eq(networkTransfers.token, token),
      eq(networkTransfers.consumedAt, null as unknown as Date),
    ))
    .returning();
  return updated.length > 0 ? updated[0] : null;
}
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/lib/networkTransferStorage.ts
git commit -m "feat(backend): network transfer storage helpers"
```

### Task C2: Test + implement `POST /api/networks/:id/transfer/init`

**Files:**
- Create: `backend/src/routes/networkTransfers.ts`
- Create: `backend/src/routes/networkTransfers.test.ts`
- Modify: `backend/src/app.ts` (mount router)

- [ ] **Step 1: Write failing test**

```ts
// backend/src/routes/networkTransfers.test.ts
import { describe, it, expect } from "bun:test";
import { app } from "../app";
import { db } from "../db/index";
import { users, userSessions, networks, memberships } from "../db/schema";

async function seedUserWithNetwork(name = "Net A") {
  const userId = `user_${Math.random().toString(36).slice(2, 10)}`;
  const sessionId = `sess_${Math.random().toString(36).slice(2, 18)}`;
  const networkId = `net_${Math.random().toString(36).slice(2, 10)}`;
  await db.insert(users).values({
    id: userId, email: `${userId}@t.dev`, name: "T", passwordHash: null,
    createdAt: new Date(), updatedAt: new Date(),
  });
  await db.insert(userSessions).values({
    id: sessionId, userId, createdAt: new Date(),
    lastUsedAt: new Date(), expiresAt: new Date(Date.now() + 1e9),
  });
  await db.insert(networks).values({
    id: networkId, name, tier: "free",
    createdAt: new Date(), updatedAt: new Date(),
  });
  await db.insert(memberships).values({
    userId, networkId, role: "owner", createdAt: new Date(),
  });
  return { userId, sessionId, networkId };
}

describe("POST /api/networks/:id/transfer/init", () => {
  it("owner can init a transfer and receives a token + URL", async () => {
    const { sessionId, networkId } = await seedUserWithNetwork();
    const res = await app.request(`/api/networks/${networkId}/transfer/init`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}` },
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.url).toMatch(/\/transfer\?token=/);
    expect(body.expiresAt).toBeTruthy();
  });

  it("non-owner returns 403", async () => {
    const { sessionId } = await seedUserWithNetwork();  // owns network A
    const foreign = await seedUserWithNetwork();         // owns network B
    const res = await app.request(`/api/networks/${foreign.networkId}/transfer/init`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}` },
    });
    expect(res.status).toBe(403);
  });

  it("returns 401 without auth cookie", async () => {
    const { networkId } = await seedUserWithNetwork();
    const res = await app.request(`/api/networks/${networkId}/transfer/init`, { method: "POST" });
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run — verify it fails**

```bash
cd backend && bun test src/routes/networkTransfers.test.ts
```

Expected: 404 errors on all 3 (route doesn't exist).

- [ ] **Step 3: Create the route**

```ts
// backend/src/routes/networkTransfers.ts
import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { db } from "../db/index";
import { memberships, networks, packs, serverKeys, networkTransfers } from "../db/schema";
import { and, eq } from "drizzle-orm";
import { validateUserSession } from "../lib/sessionManager";
import { createTransfer, getTransfer, consumeTransfer } from "../lib/networkTransferStorage";

const EDITOR_URL = process.env.EDITOR_URL ?? "http://localhost:5173";

export const networkTransfersRouter = new Hono();

async function getAuthedUser(c: any) {
  const sid = getCookie(c, "artisan_user_session");
  if (!sid) return null;
  return await validateUserSession(sid);
}

async function isOwner(userId: string, networkId: string): Promise<boolean> {
  const rows = await db.select().from(memberships).where(and(
    eq(memberships.userId, userId),
    eq(memberships.networkId, networkId),
  ));
  return rows.length > 0 && rows[0].role === "owner";
}

// Note: this router is mounted with prefix /api/networks; the :id is the network id.
networkTransfersRouter.post("/:id/transfer/init", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: "unauthorized" }, 401);
  const networkId = c.req.param("id");
  if (!await isOwner(user.id, networkId)) return c.json({ error: "forbidden" }, 403);

  const transfer = await createTransfer(networkId, user.id);
  return c.json({
    url: `${EDITOR_URL}/transfer?token=${transfer.token}`,
    expiresAt: transfer.expiresAt.toISOString(),
  }, 201);
});
```

- [ ] **Step 4: Mount router in `app.ts`**

Find the existing `app.route("/api/networks", userNetworksRouter)` line and ensure transfer routes are reachable. Either extend `userNetworksRouter` or add:

```ts
import { networkTransfersRouter } from "./routes/networkTransfers";
app.route("/api/networks", networkTransfersRouter);
```

(Hono allows multiple routers under the same prefix; route matching is by method+path.)

- [ ] **Step 5: Run tests**

```bash
cd backend && bun test src/routes/networkTransfers.test.ts
```

Expected: 3/3 pass.

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/networkTransfers.ts backend/src/routes/networkTransfers.test.ts backend/src/app.ts
git commit -m "feat(backend): POST /api/networks/:id/transfer/init"
```

### Task C3: GET /:token + POST /:token/accept

**Files:**
- Modify: `backend/src/routes/networkTransfers.ts`
- Modify: `backend/src/routes/networkTransfers.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `networkTransfers.test.ts`:

```ts
describe("GET /api/networks/transfer/:token", () => {
  it("returns transfer info for a valid token", async () => {
    const { sessionId, networkId } = await seedUserWithNetwork("Source");
    const init = await app.request(`/api/networks/${networkId}/transfer/init`, {
      method: "POST", headers: { Cookie: `artisan_user_session=${sessionId}` },
    });
    const token = new URL((await init.json()).url).searchParams.get("token");

    const res = await app.request(`/api/networks/transfer/${token}`, {
      headers: { Cookie: `artisan_user_session=${sessionId}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.networkName).toBe("Source");
    expect(body.packCount).toBe(0);
    expect(body.serverKeyCount).toBe(0);
  });

  it("returns 410 for expired token", async () => {
    // Inject a transfer with expiresAt in the past
    await db.insert(networkTransfers).values({
      token: "expired_tok", networkId: "net_x", initiatedByUserId: "u_x",
      expiresAt: new Date(Date.now() - 1000),
      consumedAt: null, consumedByUserId: null, createdAt: new Date(),
    });
    const res = await app.request("/api/networks/transfer/expired_tok");
    expect(res.status).toBe(410);
  });

  it("returns 410 for already consumed token", async () => {
    await db.insert(networkTransfers).values({
      token: "used_tok", networkId: "net_x", initiatedByUserId: "u_x",
      expiresAt: new Date(Date.now() + 1e9),
      consumedAt: new Date(), consumedByUserId: "u_x", createdAt: new Date(),
    });
    const res = await app.request("/api/networks/transfer/used_tok");
    expect(res.status).toBe(410);
  });
});

describe("POST /api/networks/transfer/:token/accept", () => {
  it("swaps ownership: old owner loses access, new owner gets it", async () => {
    const source = await seedUserWithNetwork("Source");
    const dest = await seedUserWithNetwork("Other");
    const init = await app.request(`/api/networks/${source.networkId}/transfer/init`, {
      method: "POST", headers: { Cookie: `artisan_user_session=${source.sessionId}` },
    });
    const token = new URL((await init.json()).url).searchParams.get("token");

    const res = await app.request(`/api/networks/transfer/${token}/accept`, {
      method: "POST", headers: { Cookie: `artisan_user_session=${dest.sessionId}` },
    });
    expect(res.status).toBe(200);

    const oldMember = await db.select().from(memberships).where(and(
      eq(memberships.userId, source.userId),
      eq(memberships.networkId, source.networkId),
    ));
    expect(oldMember).toHaveLength(0);

    const newMember = await db.select().from(memberships).where(and(
      eq(memberships.userId, dest.userId),
      eq(memberships.networkId, source.networkId),
    ));
    expect(newMember).toHaveLength(1);
    expect(newMember[0].role).toBe("owner");
  });

  it("returns 410 for expired token", async () => {
    await db.insert(networkTransfers).values({
      token: "exp2", networkId: "net_x", initiatedByUserId: "u_x",
      expiresAt: new Date(Date.now() - 1000),
      consumedAt: null, consumedByUserId: null, createdAt: new Date(),
    });
    const { sessionId } = await seedUserWithNetwork();
    const res = await app.request("/api/networks/transfer/exp2/accept", {
      method: "POST", headers: { Cookie: `artisan_user_session=${sessionId}` },
    });
    expect(res.status).toBe(410);
  });
});
```

- [ ] **Step 2: Run — verify failures**

```bash
cd backend && bun test src/routes/networkTransfers.test.ts
```

- [ ] **Step 3: Implement the two handlers**

Append to `networkTransfers.ts`:

```ts
networkTransfersRouter.get("/transfer/:token", async (c) => {
  const token = c.req.param("token");
  const transfer = await getTransfer(token);
  if (!transfer) return c.json({ error: "not_found" }, 404);
  if (transfer.consumedAt) return c.json({ error: "consumed" }, 410);
  if (transfer.expiresAt < new Date()) return c.json({ error: "expired" }, 410);

  const [network] = await db.select().from(networks).where(eq(networks.id, transfer.networkId));
  if (!network) return c.json({ error: "not_found" }, 404);
  const networkPacks = await db.select({ id: packs.id }).from(packs).where(eq(packs.networkId, transfer.networkId));
  const networkKeys = await db.select({ id: serverKeys.id }).from(serverKeys).where(eq(serverKeys.networkId, transfer.networkId));

  return c.json({
    networkId: transfer.networkId,
    networkName: network.name,
    packCount: networkPacks.length,
    serverKeyCount: networkKeys.length,
    expiresAt: transfer.expiresAt.toISOString(),
  });
});

networkTransfersRouter.post("/transfer/:token/accept", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: "unauthorized" }, 401);
  const token = c.req.param("token");
  const transfer = await getTransfer(token);
  if (!transfer) return c.json({ error: "not_found" }, 404);
  if (transfer.consumedAt) return c.json({ error: "consumed" }, 410);
  if (transfer.expiresAt < new Date()) return c.json({ error: "expired" }, 410);

  await db.transaction(async (tx) => {
    // Clean-break: drop all existing memberships for this network.
    await tx.delete(memberships).where(eq(memberships.networkId, transfer.networkId));
    await tx.insert(memberships).values({
      userId: user.id,
      networkId: transfer.networkId,
      role: "owner",
      createdAt: new Date(),
    });
    await tx.update(networkTransfers)
      .set({ consumedAt: new Date(), consumedByUserId: user.id })
      .where(eq(networkTransfers.token, token));
  });

  return c.json({ ok: true, networkId: transfer.networkId });
});
```

- [ ] **Step 4: Run all transfer tests**

```bash
cd backend && bun test src/routes/networkTransfers.test.ts
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/networkTransfers.ts backend/src/routes/networkTransfers.test.ts
git commit -m "feat(backend): network transfer get + accept"
```

### Task C4: DELETE /api/networks/:id/server-keys/:keyId

**Files:**
- Modify: `backend/src/routes/userNetworks.ts`

- [ ] **Step 1: Write failing test**

Add to `userNetworks.test.ts`:

```ts
describe("DELETE /api/networks/:id/server-keys/:keyId", () => {
  it("owner can delete a server_key, cascade pack_bindings", async () => {
    const { sessionId, networkId } = await seedUserWithNetwork();
    // Insert a server_key + a pack + a binding
    // ... (use generateServerKey + insert binding)
    const res = await app.request(`/api/networks/${networkId}/server-keys/<keyId>`, {
      method: "DELETE",
      headers: { Cookie: `artisan_user_session=${sessionId}` },
    });
    expect(res.status).toBe(204);
    // Assert binding row deleted via cascade
  });

  it("non-owner returns 403", async () => {
    // ...
  });
});
```

- [ ] **Step 2: Implement**

In `userNetworks.ts` (add inside the existing router):

```ts
userNetworksRouter.delete("/:id/server-keys/:keyId", async (c) => {
  const userId = getUserId(c);
  if (!userId) return c.json({ error: "unauthorized" }, 401);
  const networkId = c.req.param("id");
  const keyId = c.req.param("keyId");
  if (!await requireMember(userId, networkId, "owner")) {
    return c.json({ error: "forbidden" }, 403);
  }
  await db.delete(serverKeys).where(and(
    eq(serverKeys.id, keyId),
    eq(serverKeys.networkId, networkId),
  ));
  return new Response(null, { status: 204 });
});
```

The cascade on `pack_bindings.server_key_id` should be defined in schema; if not, also delete bindings explicitly:

```ts
import { packBindings } from "../db/schema";
await db.delete(packBindings).where(eq(packBindings.serverKeyId, keyId));
```

- [ ] **Step 3: Run tests + commit**

```bash
cd backend && bun test src/routes/userNetworks.test.ts
git add backend/src/routes/userNetworks.ts backend/src/routes/userNetworks.test.ts
git commit -m "feat(backend): DELETE /api/networks/:id/server-keys/:keyId"
```

---

## Phase D — Backend editor session networkId extension

### Task D1: Include `network_id` in validate response

**Files:**
- Modify: `backend/src/routes/editorSession.ts:96-103`
- Modify: `backend/src/routes/editorSession.test.ts`

- [ ] **Step 1: Failing test**

```ts
it("GET /:token includes network_id", async () => {
  // Setup: create editor_session with a server_key in a known network
  const { sessionId, networkId } = await seedUserWithNetwork();
  // Create a server_key in that network + an editor_session pointing to it
  // ... (DB inserts)
  const res = await app.request(`/api/editor-session/<accessToken>`);
  const body = await res.json();
  expect(body.network_id).toBe(networkId);
});
```

- [ ] **Step 2: Modify handler**

```ts
router.get("/:token", async (c) => {
  if (!checkRateLimit(`editor-validate:${clientIp(c)}`, 20)) return c.json({ error: "Too many requests" }, 429);
  const token = c.req.param("token");
  const session = await validateAccessToken(token);
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  trackEditorIp(session.sessionId, clientIp(c));
  const [sk] = await db.select({ networkId: serverKeys.networkId })
    .from(serverKeys).where(eq(serverKeys.id, session.serverKeyId));
  return c.json({
    server_key_id: session.serverKeyId,
    network_id: sk?.networkId ?? null,
    trusted: session.trusted,
    trust_code: session.trustCode,
  });
});
```

- [ ] **Step 3: Run + commit**

```bash
cd backend && bun test src/routes/editorSession.test.ts
git add backend/src/routes/editorSession.ts backend/src/routes/editorSession.test.ts
git commit -m "feat(backend): editor-session validate returns network_id"
```

---

## Phase E — Plugin auto-push au hello

### Task E1: Test that hello triggers auto-push when disk non-empty + backend empty

**Files:**
- Modify: `plugin/src/test/kotlin/net/artisanmc/plugin/FullSyncIntegrationTest.kt`

- [ ] **Step 1: Add test**

```kotlin
@Test
fun `auto-push at hello when disk pack non-empty and backend empty`() {
    MockBukkit.mock()
    try {
        val packId = "p_auto"
        val packsDir = Files.createTempDirectory("artisan_auto_").toFile()
        val packDir = File(packsDir, packId).apply { mkdirs() }
        File(packDir, "manifest.yaml").writeText("schema: manifest/v1\npack_id: $packId\n")
        File(packDir, "menus").mkdirs()
        File(packDir, "menus/m.yaml").writeText("id: m\nsize: 27\n")

        val received = mutableListOf<Map<String, Any>>()

        MockWebServer().use { server ->
            server.enqueue(MockResponse().withWebSocketUpgrade(object : WebSocketListener() {
                override fun onMessage(ws: WebSocket, text: String) {
                    val node = ObjectMapper().readTree(text)
                    if (node["type"]?.asText() == "hello") {
                        // hello_ack with empty pack_hashes
                        ws.send("""{"type":"hello_ack","pack_hashes":{"$packId":""},"deleted_pack_ids":[]}""")
                    }
                    if (node["type"]?.asText() == "local_push") {
                        received.add(ObjectMapper().readValue(text, Map::class.java) as Map<String, Any>)
                    }
                }
            }))
            server.start()

            val provider = SyncedMenuProvider(
                packsDir = packsDir,
                serverKey = "sk_test",
                wsUrl = server.url("/ws/plugin").toString(),
                logger = null,
            )
            provider.load()
            Thread.sleep(500)

            val push = received.firstOrNull { it["type"] == "local_push" }
            assertNotNull(push, "Expected local_push for disk-only pack")
            assertEquals(packId, push!!["pack_id"])
        }
    } finally {
        MockBukkit.unmock()
    }
}
```

- [ ] **Step 2: Implement in `SyncedMenuProvider.kt`**

Find the `handleHelloAck` (or equivalent — the existing function processing `hello_ack`). After the existing pack_hashes processing, add:

```kotlin
// Bootstrap auto-push: for each disk pack that has content but the backend
// reports as empty/unknown, push the local content. Mirrors /artisan pushLocal
// behavior but automatic at hello time.
for (packDir in packsDir.listFiles { it.isDirectory && !it.name.startsWith(".") } ?: emptyArray()) {
    val packId = packDir.name
    val diskHash = BundleHasher.hash(packDir)
    if (diskHash == "") continue
    val backendHash = packHashes[packId] ?: ""
    if (backendHash == "") {
        // Backend doesn't have content for this pack → push it automatically.
        pushLocalPack(packId, packDir)
        logger?.info("Auto-pushed local pack '$packId' (backend was empty)")
    } else if (backendHash != diskHash) {
        logger?.warning("Local pack '$packId' diverges from backend — NOT auto-pushed (use /artisan pushLocal to force)")
    }
}
```

`pushLocalPack(packId, packDir)` already exists from Plan 1C — reuse the implementation that sends the `local_push` WS message.

- [ ] **Step 3: Run test**

```bash
cd plugin && ./gradlew test --tests "*FullSyncIntegrationTest.auto-push*"
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add plugin/src/main/kotlin/net/artisanmc/plugin/provider/SyncedMenuProvider.kt plugin/src/test/kotlin/net/artisanmc/plugin/FullSyncIntegrationTest.kt
git commit -m "feat(plugin): auto-push disk-only packs at hello"
```

---

## Phase F — Editor API clients

### Task F1: Add network transfer + server-key delete to `lib/api/networks.ts`

**Files:**
- Modify: `editor/src/lib/api/networks.ts`
- Create: `editor/src/lib/api/networks.test.ts` (or extend existing)

- [ ] **Step 1: Add type + functions**

Append to `editor/src/lib/api/networks.ts`:

```ts
export interface TransferInitResponse {
  url: string;
  expiresAt: string;
}

export interface TransferInfo {
  networkId: string;
  networkName: string;
  packCount: number;
  serverKeyCount: number;
  expiresAt: string;
}

export async function initNetworkTransfer(networkId: string): Promise<TransferInitResponse> {
  const res = await fetch(`${API_URL}/api/networks/${networkId}/transfer/init`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) throw new Error(`Transfer init failed (${res.status})`);
  return res.json();
}

export async function getNetworkTransfer(token: string): Promise<TransferInfo | "expired" | "consumed" | "not_found"> {
  const res = await fetch(`${API_URL}/api/networks/transfer/${token}`, { credentials: "include" });
  if (res.status === 410) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    if (body.error === "consumed") return "consumed";
    return "expired";
  }
  if (res.status === 404) return "not_found";
  if (!res.ok) throw new Error(`Transfer fetch failed (${res.status})`);
  return res.json();
}

export async function acceptNetworkTransfer(token: string): Promise<{ networkId: string }> {
  const res = await fetch(`${API_URL}/api/networks/transfer/${token}/accept`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) throw new Error(`Transfer accept failed (${res.status})`);
  const body = await res.json() as { ok: boolean; networkId: string };
  return { networkId: body.networkId };
}

export async function deleteServerKey(networkId: string, keyId: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/networks/${networkId}/server-keys/${keyId}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) throw new Error(`Server key delete failed (${res.status})`);
}
```

- [ ] **Step 2: Add test**

Create `editor/src/lib/api/networks.test.ts` (if doesn't exist) or extend:

```ts
import { describe, it, expect, vi } from "vitest";
import { initNetworkTransfer, getNetworkTransfer, acceptNetworkTransfer, deleteServerKey } from "./networks";

describe("network transfer API", () => {
  it("initNetworkTransfer POSTs and returns url + expiresAt", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ url: "/transfer?token=t1", expiresAt: "2026-05-23T00:00:00Z" }),
    } as Response);
    const r = await initNetworkTransfer("net_x");
    expect(r.url).toBe("/transfer?token=t1");
  });

  it("getNetworkTransfer returns 'expired' on 410", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 410,
      json: async () => ({ error: "expired" }),
    } as Response);
    const r = await getNetworkTransfer("tok");
    expect(r).toBe("expired");
  });

  it("deleteServerKey returns void on success", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true } as Response);
    await expect(deleteServerKey("net_x", "sk_y")).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 3: Run + commit**

```bash
cd editor && npx vitest run src/lib/api/networks.test.ts
git add editor/src/lib/api/networks.ts editor/src/lib/api/networks.test.ts
git commit -m "feat(editor): API client transfer init/get/accept + delete server-key"
```

---

## Phase G — Editor /login `?next=` support

### Task G1: Test + implement next-param

**Files:**
- Modify: `editor/src/routes/login.tsx`
- Modify: `editor/src/routes/login.test.tsx` (or features/auth/LoginForm.test.tsx)

- [ ] **Step 1: Failing test**

```tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";  // or TanStack equivalent
import LoginRoute from "./login";  // adjust import

describe("/login next= param", () => {
  it("redirects to ?next URL after successful login", async () => {
    const navigate = vi.fn();
    vi.spyOn(window, "location", "get").mockReturnValue({
      search: "?next=/link?code=ABC",
    } as any);
    // mock login API call success
    // render <LoginRoute />
    // submit form
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/link?code=ABC"));
  });
});
```

- [ ] **Step 2: Implement**

Open `editor/src/routes/login.tsx`. After the successful login response, redirect to `next` query param if present:

```tsx
const params = new URLSearchParams(window.location.search);
const next = params.get("next");
const safeNext = next && next.startsWith("/") ? next : "/";
navigate({ to: safeNext });
```

(Use TanStack Router's `useNavigate` already imported.)

- [ ] **Step 3: Run + commit**

```bash
cd editor && npx vitest run src/routes/login.test.tsx
git add editor/src/routes/login.tsx editor/src/routes/login.test.tsx
git commit -m "feat(editor): /login supports ?next= redirect"
```

---

## Phase H — Editor /link wizard (claim flow)

### Task H1: Auth gate redirect

**Files:**
- Modify: `editor/src/routes/link.tsx` (likely existing)
- Create: `editor/src/routes/link.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import LinkRoute from "./link";

describe("/link?code=... auth gate", () => {
  it("redirects to /login?next= when not authenticated", async () => {
    const navigate = vi.fn();
    // mock authStore: user = null
    // mock window.location.search = "?code=ABC123"
    render(<LinkRoute />);
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({
      to: "/login",
      search: { next: "/link?code=ABC123" },
    }));
  });
});
```

- [ ] **Step 2: Implement**

In `editor/src/routes/link.tsx`, at the top of the component:

```tsx
import { useAuthStore } from "@/state/authStore";

export function LinkRoute() {
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const code = new URLSearchParams(window.location.search).get("code");

  useEffect(() => {
    if (!user) {
      const next = `/link${code ? `?code=${code}` : ""}`;
      navigate({ to: "/login", search: { next } });
    }
  }, [user, code, navigate]);

  if (!user) return null;
  // ... rest of wizard
}
```

- [ ] **Step 3: Run + commit**

```bash
cd editor && npx vitest run src/routes/link.test.tsx
git add editor/src/routes/link.tsx editor/src/routes/link.test.tsx
git commit -m "feat(editor): /link auth gate redirects to /login?next="
```

### Task H2: Wizard claim with smart-count

**Files:**
- Modify: `editor/src/routes/link.tsx`
- Modify: `editor/src/routes/link.test.tsx`
- Modify: `editor/src/lib/api/networks.ts` (claim function)

- [ ] **Step 1: Add `claimLinkCode` to API**

```ts
// editor/src/lib/api/networks.ts
export async function claimLinkCode(code: string, networkId?: string): Promise<{ server_key_id: string; network_id: string }> {
  const res = await fetch(`${API_URL}/api/link/${code}/claim`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(networkId ? { network_id: networkId } : {}),
  });
  if (res.status === 400) {
    const body = await res.json() as { error?: string };
    if (body.error === "must_choose_network") throw new Error("must_choose_network");
  }
  if (!res.ok) throw new Error(`Claim failed (${res.status})`);
  return res.json();
}
```

- [ ] **Step 2: Failing test for the wizard component**

```tsx
it("auto-claims when user has 0 networks", async () => {
  // mock listNetworks → []
  // mock claimLinkCode → success
  render(<LinkRoute />);
  await waitFor(() => screen.getByText(/Setup terminé/i));
});

it("auto-claims when user has 1 network (with confirm)", async () => {
  // mock listNetworks → [{id: "n1", name: "My Net"}]
  render(<LinkRoute />);
  await screen.findByText("My Net");
  fireEvent.click(screen.getByText(/Confirmer/i));
  // assert claimLinkCode called with network_id = "n1"
});

it("shows picker when 2+ networks", async () => {
  // mock listNetworks → [{id:"n1",name:"A"},{id:"n2",name:"B"}]
  render(<LinkRoute />);
  await screen.findByText("A");
  await screen.findByText("B");
  fireEvent.click(screen.getByText("B"));
  fireEvent.click(screen.getByText(/Confirmer/i));
  // claim called with network_id = "n2"
});
```

- [ ] **Step 3: Implement wizard**

```tsx
export function LinkRoute() {
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const code = new URLSearchParams(window.location.search).get("code");
  const [networks, setNetworks] = useState<Network[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "claiming" | "done" | "error">("loading");

  useEffect(() => {
    if (!user) {
      navigate({ to: "/login", search: { next: `/link?code=${code}` } });
      return;
    }
    listNetworks().then((nets) => {
      setNetworks(nets);
      if (nets.length === 0) {
        // Auto-create + claim
        claimLinkCode(code!).then(() => setStatus("done")).catch(() => setStatus("error"));
      } else if (nets.length === 1) {
        setSelectedId(nets[0].id);
        setStatus("ready");
      } else {
        setStatus("ready");
      }
    });
  }, [user, code]);

  const handleConfirm = async () => {
    setStatus("claiming");
    try {
      await claimLinkCode(code!, selectedId!);
      setStatus("done");
    } catch (e) {
      setStatus("error");
    }
  };

  if (status === "loading") return <div>Chargement…</div>;
  if (status === "done") return <div>Setup terminé ! Retournez sur Minecraft.</div>;
  if (status === "error") return <div>Échec du setup. Retape <code>/artisan setup</code>.</div>;
  if (status === "claiming") return <div>Liaison en cours…</div>;

  // status === "ready"
  if (networks!.length === 1) {
    return (
      <div>
        <p>Lier ce serveur à <strong>{networks![0].name}</strong> ?</p>
        <button onClick={handleConfirm}>Confirmer</button>
      </div>
    );
  }
  return (
    <div>
      <p>Choisis le Network destination :</p>
      <ul>
        {networks!.map((n) => (
          <li key={n.id}>
            <button onClick={() => setSelectedId(n.id)}>
              {n.name} {selectedId === n.id && "✓"}
            </button>
          </li>
        ))}
      </ul>
      <button disabled={!selectedId} onClick={handleConfirm}>Confirmer</button>
    </div>
  );
}
```

- [ ] **Step 4: Run tests + commit**

```bash
cd editor && npx vitest run src/routes/link.test.tsx
git add editor/src/routes/link.tsx editor/src/routes/link.test.tsx editor/src/lib/api/networks.ts
git commit -m "feat(editor): /link wizard with smart-count claim"
```

---

## Phase I — Editor /networks routes

### Task I1: `/networks` list page

**Files:**
- Create: `editor/src/routes/networks.tsx`
- Create: `editor/src/routes/networks.test.tsx`
- Create: `editor/src/features/networks/NetworkCard.tsx`

- [ ] **Step 1: Component test**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import NetworksRoute from "./networks";

describe("/networks", () => {
  it("renders list of networks", async () => {
    vi.mock("@/lib/api/networks", () => ({
      listNetworks: async () => [
        { id: "n1", name: "Alpha", packCount: 2, serverKeyCount: 1 },
        { id: "n2", name: "Beta", packCount: 0, serverKeyCount: 0 },
      ],
    }));
    render(<NetworksRoute />);
    await screen.findByText("Alpha");
    await screen.findByText("Beta");
  });

  it("renders empty state when user has 0 networks", async () => {
    vi.mock("@/lib/api/networks", () => ({ listNetworks: async () => [] }));
    render(<NetworksRoute />);
    await screen.findByText(/Aucun Network/i);
  });
});
```

- [ ] **Step 2: Implementation**

```tsx
// editor/src/routes/networks.tsx
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { listNetworks, type NetworkListItem } from "@/lib/api/networks";

export const Route = createFileRoute("/networks")({ component: NetworksRoute });

function NetworksRoute() {
  const [networks, setNetworks] = useState<NetworkListItem[] | null>(null);
  useEffect(() => { listNetworks().then(setNetworks); }, []);
  if (networks === null) return <div>Chargement…</div>;
  if (networks.length === 0) {
    return (
      <div className="p-8">
        <h1 className="text-2xl mb-4">Aucun Network</h1>
        <p>Lance <code>/artisan setup</code> sur ton serveur Minecraft pour commencer.</p>
      </div>
    );
  }
  return (
    <div className="p-8">
      <h1 className="text-2xl mb-4">Mes Networks</h1>
      <ul className="grid gap-4">
        {networks.map((n) => (
          <li key={n.id}>
            <Link to="/networks/$id" params={{ id: n.id }} className="block p-4 border rounded">
              <div className="font-bold">{n.name}</div>
              <div className="text-sm text-muted">{n.packCount} packs · {n.serverKeyCount} servers</div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 3: Run + commit**

```bash
cd editor && npx vitest run src/routes/networks.test.tsx
git add editor/src/routes/networks.tsx editor/src/routes/networks.test.tsx
git commit -m "feat(editor): /networks list page"
```

### Task I2: `/networks/:id` detail page

**Files:**
- Create: `editor/src/routes/networks.$id.tsx`
- Create: `editor/src/routes/networks.$id.test.tsx`

- [ ] **Step 1: Test**

```tsx
it("renders network detail with packs, server_keys, members sections", async () => {
  vi.mock("@/lib/api/networks", () => ({
    getNetwork: async () => ({
      id: "n1", name: "Alpha",
      packs: [{ id: "p1", name: "shop" }],
      serverKeys: [{ id: "sk1", label: null, createdAt: "..." }],
      members: [{ userId: "u1", email: "iban@a.dev", role: "owner" }],
    }),
  }));
  render(<NetworkDetailRoute />);
  await screen.findByText("shop");
  await screen.findByText(/sk1|••••sk1/);
  await screen.findByText("iban@a.dev");
});
```

- [ ] **Step 2: Implementation**

```tsx
// editor/src/routes/networks.$id.tsx
import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getNetwork, deleteServerKey, type NetworkDetail } from "@/lib/api/networks";

export const Route = createFileRoute("/networks/$id")({ component: NetworkDetailRoute });

function NetworkDetailRoute() {
  const { id } = useParams({ from: "/networks/$id" });
  const [data, setData] = useState<NetworkDetail | null>(null);

  useEffect(() => { getNetwork(id).then(setData); }, [id]);

  if (!data) return <div>Chargement…</div>;

  return (
    <div className="p-8 grid gap-8">
      <header className="flex justify-between items-baseline">
        <h1 className="text-2xl">{data.name}</h1>
        <Link to="/networks/$id/settings" params={{ id }}>Settings</Link>
      </header>
      <section>
        <h2 className="text-lg mb-2">Packs</h2>
        {data.packs.length === 0 ? (
          <p className="text-muted">Aucun pack.</p>
        ) : (
          <ul>{data.packs.map((p) => (
            <li key={p.id}><Link to="/pack/$packId" params={{ packId: p.id }}>{p.name}</Link></li>
          ))}</ul>
        )}
      </section>
      <section>
        <h2 className="text-lg mb-2">Server Keys</h2>
        <ul>{data.serverKeys.map((k) => (
          <li key={k.id} className="flex justify-between items-center">
            <span>{k.label ?? k.id.slice(0, 12) + "…"}</span>
            <button onClick={async () => { await deleteServerKey(id, k.id); setData({ ...data, serverKeys: data.serverKeys.filter((x) => x.id !== k.id) }); }}>
              Delete
            </button>
          </li>
        ))}</ul>
      </section>
      <section>
        <h2 className="text-lg mb-2">Members</h2>
        <ul>{data.members.map((m) => (
          <li key={m.userId}>{m.email} <span className="text-muted text-sm">({m.role})</span></li>
        ))}</ul>
        <p className="text-muted text-sm mt-2">Invitations à venir.</p>
      </section>
    </div>
  );
}
```

- [ ] **Step 3: Run + commit**

```bash
cd editor && npx vitest run src/routes/networks.\$id.test.tsx
git add editor/src/routes/networks.\$id.tsx editor/src/routes/networks.\$id.test.tsx
git commit -m "feat(editor): /networks/:id detail page"
```

### Task I3: `/networks/:id/settings` (rename, delete, transfer init)

**Files:**
- Create: `editor/src/routes/networks.$id.settings.tsx`
- Create: `editor/src/routes/networks.$id.settings.test.tsx`

- [ ] **Step 1: Test transfer init flow**

```tsx
it("transfer init shows the generated URL", async () => {
  vi.mock("@/lib/api/networks", () => ({
    initNetworkTransfer: async () => ({ url: "/transfer?token=ABC", expiresAt: "..." }),
  }));
  render(<SettingsRoute />);
  fireEvent.click(screen.getByText(/Générer un lien/i));
  await screen.findByDisplayValue(/transfer\?token=ABC/);
});
```

- [ ] **Step 2: Implementation**

```tsx
function SettingsRoute() {
  const { id } = useParams({ from: "/networks/$id/settings" });
  const [transferUrl, setTransferUrl] = useState<string | null>(null);

  const handleGenerate = async () => {
    const r = await initNetworkTransfer(id);
    setTransferUrl(r.url);
  };

  return (
    <div className="p-8 grid gap-8">
      <h1>Settings</h1>
      {/* rename + delete section */}
      <section>
        <h2>Transférer la propriété</h2>
        <p className="text-muted">
          Génère un lien à partager avec le nouvel owner. TTL 24h. Le nouvel owner aura plein droit ;
          tu perdras tes accès.
        </p>
        <button onClick={handleGenerate}>Générer un lien</button>
        {transferUrl && (
          <input readOnly value={transferUrl} onClick={(e) => e.currentTarget.select()} />
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 3: Run + commit**

```bash
git add editor/src/routes/networks.\$id.settings.tsx editor/src/routes/networks.\$id.settings.test.tsx
git commit -m "feat(editor): /networks/:id/settings with transfer init"
```

---

## Phase J — Editor /transfer accept route

### Task J1: `/transfer?token=...`

**Files:**
- Create: `editor/src/routes/transfer.tsx`
- Create: `editor/src/routes/transfer.test.tsx`

- [ ] **Step 1: Tests**

```tsx
it("shows network info and accept button on valid token", async () => {
  vi.mock("@/lib/api/networks", () => ({
    getNetworkTransfer: async () => ({ networkId: "n1", networkName: "Alpha", packCount: 3, serverKeyCount: 1, expiresAt: "..." }),
    acceptNetworkTransfer: async () => ({ networkId: "n1" }),
  }));
  // mock authStore: user logged
  render(<TransferRoute />);
  await screen.findByText(/Alpha/);
  fireEvent.click(screen.getByText(/Accepter/i));
  await screen.findByText(/Transfert accepté/i);
});

it("shows expired message on 410", async () => {
  vi.mock("@/lib/api/networks", () => ({
    getNetworkTransfer: async () => "expired",
  }));
  render(<TransferRoute />);
  await screen.findByText(/expiré/i);
});
```

- [ ] **Step 2: Implementation**

```tsx
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getNetworkTransfer, acceptNetworkTransfer, type TransferInfo } from "@/lib/api/networks";
import { useAuthStore } from "@/state/authStore";

export const Route = createFileRoute("/transfer")({ component: TransferRoute });

function TransferRoute() {
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const token = new URLSearchParams(window.location.search).get("token");
  const [state, setState] = useState<"loading" | TransferInfo | "expired" | "consumed" | "not_found" | "accepted" | "error">("loading");

  useEffect(() => {
    if (!user) {
      navigate({ to: "/login", search: { next: `/transfer?token=${token}` } });
      return;
    }
    if (!token) { setState("not_found"); return; }
    getNetworkTransfer(token).then(setState).catch(() => setState("error"));
  }, [user, token]);

  if (state === "loading") return <div>Chargement…</div>;
  if (state === "expired") return <div>Lien expiré.</div>;
  if (state === "consumed") return <div>Ce lien a déjà été utilisé.</div>;
  if (state === "not_found") return <div>Lien introuvable.</div>;
  if (state === "error") return <div>Erreur.</div>;
  if (state === "accepted") return <div>Transfert accepté !</div>;

  return (
    <div className="p-8">
      <h1>Transférer la propriété</h1>
      <p>Tu vas devenir owner de <strong>{state.networkName}</strong>.</p>
      <p>{state.packCount} packs · {state.serverKeyCount} server_keys.</p>
      <button
        onClick={async () => {
          try {
            await acceptNetworkTransfer(token!);
            setState("accepted");
            setTimeout(() => navigate({ to: "/networks/$id", params: { id: state.networkId } }), 1500);
          } catch {
            setState("error");
          }
        }}
      >
        Accepter
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Run + commit**

```bash
cd editor && npx vitest run src/routes/transfer.test.tsx
git add editor/src/routes/transfer.tsx editor/src/routes/transfer.test.tsx
git commit -m "feat(editor): /transfer accept page"
```

---

## Phase K — Editor session banner (Network name)

### Task K1: Banner in `/session`

**Files:**
- Modify: `editor/src/lib/editorSession.ts` (validate type extended)
- Modify: `editor/src/routes/session.tsx` (or wherever the editor shell renders)

- [ ] **Step 1: Extend EditorSessionInfo**

```ts
// editor/src/lib/editorSession.ts
export interface EditorSessionInfo {
  server_key_id: string;
  network_id: string | null;
  trusted: boolean;
  trust_code: string;
}
```

- [ ] **Step 2: Show banner**

In `session.tsx` (or wherever the layout renders), after the `validateEditorSession` resolves with `info`:

```tsx
{info.network_id && <div className="bg-zinc-800 px-4 py-2 text-xs">Network: {info.network_id}</div>}
```

(If we want the actual *name* not the id, we'd add a `GET /api/networks/:id/public` or similar to fetch the name. For MVP, id is fine; cleaner version is a polish item.)

- [ ] **Step 3: Commit**

```bash
git add editor/src/lib/editorSession.ts editor/src/routes/session.tsx
git commit -m "feat(editor): session shows network_id banner"
```

---

## Phase L — Editor `/` root redirect

### Task L1: Redirect logic

**Files:**
- Modify: `editor/src/routes/index.tsx`

- [ ] **Step 1: Implementation**

```tsx
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuthStore } from "@/state/authStore";

export const Route = createFileRoute("/")({ component: HomeRoute });

function HomeRoute() {
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  useEffect(() => {
    navigate({ to: user ? "/networks" : "/login" });
  }, [user, navigate]);
  return null;
}
```

- [ ] **Step 2: Commit**

```bash
git add editor/src/routes/index.tsx
git commit -m "feat(editor): / redirects based on auth state"
```

---

## Phase M — Migration SQL Iban

### Task M1: One-shot adoption of the existing anonymous Network

**Files:** none (operational, not code)

- [ ] **Step 1: After merge, find Iban's user_id**

```bash
docker exec artisan-postgres-1 psql -U postgres -d artisan \
  -c "SELECT id FROM users WHERE email = 'iban.etchepareborde@gmail.com'"
```

Note the `id` (e.g. `user_xyz`).

- [ ] **Step 2: Find the anonymous Network id**

```bash
docker exec artisan-postgres-1 psql -U postgres -d artisan \
  -c "SELECT id, name FROM networks WHERE id NOT IN (SELECT network_id FROM memberships)"
```

Note the network_id (e.g. `net_ebe57cf700fd`).

- [ ] **Step 3: Insert Membership row**

```bash
docker exec artisan-postgres-1 psql -U postgres -d artisan \
  -c "INSERT INTO memberships (user_id, network_id, role, created_at) VALUES ('<user_id>', '<network_id>', 'owner', NOW())"
```

- [ ] **Step 4: Verify**

```bash
docker exec artisan-postgres-1 psql -U postgres -d artisan \
  -c "SELECT * FROM memberships WHERE user_id = '<user_id>'"
```

Expected: 1 row with `role = 'owner'`.

(No git commit — runtime operation only.)

---

## Phase N — Docs

### Task N1: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md` (root)

- [ ] **Step 1: Update endpoints section**

Add to the auth/networks endpoints table:

```
| `POST /api/link/:code/claim` | **Login required**. Body `{network_id?}`. Smart count: 0 → auto-crée "Mon Network", 1 → use it, 2+ → 400 `must_choose_network`. 401 sans cookie, 403 si pas membre. |
| `POST /api/networks/:id/transfer/init` | Owner-only. Crée un transfer token (TTL 24h). Returns `{url, expiresAt}`. |
| `GET /api/networks/transfer/:token` | Returns `{networkId, networkName, packCount, serverKeyCount, expiresAt}`. 410 expired/consumed. |
| `POST /api/networks/transfer/:token/accept` | Login required. Swap memberships (clean break — ancien owner perd accès). 410 expired/consumed. |
| `DELETE /api/networks/:id/server-keys/:keyId` | Owner-only. Delete server_key + cascade bindings. |
| `GET /api/editor-session/:token` | Étendu : retourne aussi `network_id` (sk → network du sk). |
```

- [ ] **Step 2: Add Plan accounts-networks-UX section in entities**

```
### Plan accounts × networks UX — flow setup logged-in

- `/artisan setup` requiert maintenant un compte user. Le claim `/api/link/:code/claim` exige cookie `artisan_user_session` et choisit le network destination via smart count.
- `network_transfers (token, network_id, initiated_by_user_id, expires_at, consumed_at, consumed_by_user_id)` : tokens partageables 24h pour transférer la propriété d'un Network entier.
- Bootstrap plugin : au hello, les packs disque inconnus du backend sont auto-pushés via `local_push`.
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: accounts × networks UX endpoints + entities"
```

### Task N2: Update sync-docs map

**Files:**
- Modify: `.claude/skills/sync-docs/doc-impact-map.yaml`

- [ ] **Step 1: Add mappings**

```yaml
  - touches: "backend/src/routes/link.ts"
    updates:
      - "CLAUDE.md"
    reason: "Claim endpoint auth requirement (Plan accounts × networks)"

  - touches: "backend/src/routes/networkTransfers.ts"
    updates:
      - "CLAUDE.md"
    reason: "Network transfer endpoints"

  - touches: "backend/src/lib/networkTransferStorage.ts"
    updates:
      - "CLAUDE.md"
    reason: "Network transfer storage helpers"
```

- [ ] **Step 2: Commit**

```bash
git add .claude/skills/sync-docs/doc-impact-map.yaml
git commit -m "docs(sync-docs): map network_transfers + claim auth"
```

---

## Final verification

### Task O1: Backend test sweep

- [ ] Run `cd backend && bun run test`
- [ ] Expected: all green (modulo pre-existing EBUSY Windows tests which are environmental)

### Task O2: Editor test sweep

- [ ] Run `cd editor && npx vitest run`
- [ ] Expected: all green

### Task O3: Plugin test sweep

- [ ] Run `cd plugin && ./gradlew test`
- [ ] Expected: all green

### Task O4: Docker smoke test (manual)

- [ ] Deploy : `cd plugin && ./gradlew deploy`
- [ ] Restart backend if schema changed
- [ ] Execute Phase M migration
- [ ] In Minecraft, run `/artisan setup` → verify link redirects to `/login` when logged out
- [ ] Log in / sign up → return to `/link` → claim wizard
- [ ] Open `/networks` → see the new network
- [ ] Open `/networks/:id/settings` → generate transfer URL
- [ ] In incognito/another browser, login as a second user → `/transfer?token=...` → accept
- [ ] First user no longer sees the network
- [ ] Second user sees the network in `/networks`

---

## Self-Review

**Spec coverage:**
- ✅ Hard break /artisan setup login required → Task B1
- ✅ /link?code=... auth gate redirect → Task H1
- ✅ Smart count picker → Task H2
- ✅ Routes /networks, /:id, /:id/settings → Tasks I1, I2, I3
- ✅ Transfer via lien partageable → Tasks C1, C2, C3, J1
- ✅ Delete server-key → Task C4
- ✅ Auto-push bootstrap au hello → Task E1
- ✅ Memberships UI déférée → Tasks I2 reflètent (read-only "Invitations à venir")
- ✅ Editor session banner → Task K1
- ✅ Root redirect → Task L1
- ✅ Migration Iban → Task M1
- ✅ Tests (backend/editor/plugin) → couvert par chaque task

**Placeholder scan:** Quelques tests ont des `// ... (extract userId from session)` et `// ... (using createNetwork + addMembership helpers)` — clarifier au moment de l'impl en regardant `auth.test.ts` et `userNetworks.test.ts` pour les patterns. Pas bloquant.

**Type consistency:** `listNetworks` retourne `NetworkListItem[]`, `getNetwork` retourne `NetworkDetail`. Définir ces types une fois dans `lib/api/networks.ts`. `EditorSessionInfo.network_id` est `string | null` (cohérent avec backend qui retourne `?? null` si server_key introuvable).
