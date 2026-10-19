# Multi-Server Networks — Phase 1C Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Livrer le modèle "backend = source de vérité" complet : retrait UI conflits (backend + éditeur + plugin), setup wizard logged-in pour générer Network + Pack + server_key, gestion REST des Networks par les users, ouverture/édition de packs en mode logged-in, et nouvelle commande `/artisan pushLocal` pour les admins qui éditent via FTP.

**Architecture:**
- **Backend** : nouveau routeur `userNetworks` exposant `/api/networks/*` (gated par cookie `artisan_user_session` + membership check). Nouveau routeur `userPacks` exposant `/api/user/packs/*` pour l'édition logged-in. Table `pack_conflicts` + `conflictDiff.ts` + `conflicts.ts` supprimés. Message WS `pack_divergence_detected` retiré du hub (no-op accepté). Nouveau message WS `local_push` pour le flow `/artisan pushLocal`.
- **Editor** : nouvelles routes `/setup`, `/networks`, `/networks/$networkId`. `Account` page liste les Networks. `pack.$packId` route détecte le mode (session-token vs user-cookie) et route les API calls. `ConflictBanner`/`Modal`/`conflictsStore`/conflict client supprimés. Nouveau store `networksStore`.
- **Plugin** : `SyncedMenuProvider.handleMessage` ne fire plus `pack_divergence_detected` (juste un WARN une fois sur mismatch + auto-overwrite local). Nouvelle subcommand `ArtisanCommand.pushLocal(packId|--all)` qui envoie un message WS `local_push` au backend.

**Tech Stack:** TypeScript, Bun, Hono, Drizzle ORM (PostgreSQL), React 19, Vite 6, Zustand, TanStack Router, Vitest, Kotlin 2.0, Paper 1.21, JUnit 5.

**Hors scope (Plan 1D ou plus tard) :**
- Membership invitations (lien email / invite by username).
- Server_key sharing for autoscale (le data model le supporte mais aucune UI).
- Trust dance UX pour server_keys partagées.
- Email verification (signup direct).
- Tier free limits (Stripe = Phase 4).
- `branch_name` sur PackBindings (Phase 2).
- Clone-bindings-from-existing-server_key dans le wizard (just "new server_key" pour 1C).
- Asset dedup cross-pack au niveau Network.

**Pré-requis :** Plan 1A (auth, sessions, Discord OAuth) et Plan 1B (Network + Pack + PackBinding + assets pack-scopés) sont mergés sur `main` (tip = `a93c29e0`).

---

## File Structure

### Nouveaux fichiers (backend)

- `backend/src/routes/userNetworks.ts` + `.test.ts` — `/api/networks/*` (gated par userAuth)
- `backend/src/routes/userPacks.ts` + `.test.ts` — `/api/user/packs/*` (édition logged-in)
- `backend/src/lib/membershipGuard.ts` + `.test.ts` — helper `requireMembership(userId, networkId, role?)` + `getNetworkOfPack(packId)`
- `backend/src/scripts/wipe-phase-1c.ts` — drop pack_conflicts

### Fichiers modifiés (backend)

- `backend/src/db/schema.ts` — supprimer `packConflicts`
- `backend/src/app.ts` — mount `userNetworksRouter` + `userPacksRouter`, unmount `conflictsRouter`
- `backend/src/ws/hub.ts` — retirer handler `pack_divergence_detected` ; retirer freeze check ; ajouter handler `local_push`
- `backend/src/routes/editorSession.ts` — retirer auto-resolution conflits dans DELETE pack
- `backend/src/protocol.ts` — retirer types `PackConflictDetectedMessage` / `PackConflictResolvedMessage` ; ajouter type `LocalPushMessage`
- `backend/src/lib/networkManager.ts` — ajouter `listNetworksForUser(userId)` (déjà en lib `membershipManager.ts` en Plan 1B — vérifier réutilisable)
- `backend/src/lib/packStorage.ts` — pas de changement (les routes user utilisent les helpers existants)

### Fichiers supprimés (backend)

- `backend/src/routes/conflicts.ts` + `.test.ts`
- `backend/src/lib/conflictDiff.ts` + `.test.ts`

### Nouveaux fichiers (editor)

- `editor/src/routes/setup.tsx` — wizard
- `editor/src/routes/networks.tsx` — liste user's networks
- `editor/src/routes/networks.$networkId.tsx` — Network detail
- `editor/src/state/networksStore.ts` + `.test.ts` — Zustand store user-side networks
- `editor/src/lib/api/networks.ts` + `.test.ts` — wrappers `/api/networks/*`
- `editor/src/lib/api/userPacks.ts` + `.test.ts` — wrappers `/api/user/packs/*`
- `editor/src/features/setup/SetupWizard.tsx` + `.test.tsx` — composant wizard multi-step
- `editor/src/features/setup/SetupWizardSteps/` — sous-composants step1Network, step2Pack, step3ServerKey, step4Install (chacun + test)

### Fichiers modifiés (editor)

- `editor/src/routes/account.tsx` — ajout section "Your Networks" + lien /setup + lien /networks
- `editor/src/routes/pack.$packId.tsx` — détection mode (session vs user-auth), supprimer mount ConflictBanner + Modal
- `editor/src/lib/packApi.ts` — ajouter helpers user-auth (load/save pack via /api/user/packs)
- `editor/src/state/wsStore.ts` — retirer handlers `pack_conflict_detected` + `pack_conflict_resolved`
- `editor/src/state/uiStore.ts` — retirer `selectedConflictId` si présent
- `editor/src/i18n/locales/{en,fr}.ts` — nouvelles clés `setup.*`, `networks.*` ; retrait clés `sync.banner.*`, `sync.modal.*`

### Fichiers supprimés (editor)

- `editor/src/features/sync/ConflictBanner.tsx` + `.test.tsx`
- `editor/src/features/sync/ConflictResolutionModal.tsx` + `.test.tsx`
- `editor/src/state/conflictsStore.ts` + `.test.ts`
- `editor/src/lib/api/conflicts.ts`
- `editor/src/features/sync/DeletePackDialog.tsx` — **garder** (utilisé pour suppression user-initiée de pack ; déplacer hors du dossier `sync/` vers `features/account/` si nécessaire pour clarté)

### Fichiers modifiés (plugin)

- `plugin/src/main/kotlin/.../provider/SyncedMenuProvider.kt` — retirer émission `pack_divergence_detected` ; ajouter WARN log unique sur mismatch
- `plugin/src/main/kotlin/.../command/ArtisanCommand.kt` — ajouter subcommand `pushLocal`
- `plugin/src/main/kotlin/.../sync/LocalPushSender.kt` (nouveau) — lecture fichiers locaux + envoi WS `local_push`
- `plugin/src/test/kotlin/.../sync/LocalPushSenderTest.kt` (nouveau)
- `plugin/src/test/kotlin/.../ConflictDetectionTest.kt` — supprimé (l'émission disparaît)

### Doc updates (Section K)

- `Artisan/CLAUDE.md` — table commandes plugin (ajouter `pushLocal`), table protocole WS (retrait `pack_conflict_*`, ajout `local_push`), table endpoints (ajouter `/api/networks/*` et `/api/user/packs/*`, retirer `/api/.../conflicts/*`)
- `docs-site/src/content/docs/getting-started/install-admin.md` — mentionner `/artisan pushLocal` et la procédure FTP
- `.claude/skills/sync-docs/doc-impact-map.yaml` — ajouter les nouveaux chemins

---

## Migration / wipe procedure

Plan 1C ne nécessite que de drop `pack_conflicts` (les autres tables ne sont pas touchées structurellement). Pas de wipe complet ; Iban garde son env de test après Plan 1B.

```sql
DROP TABLE IF EXISTS pack_conflicts CASCADE;
```

Exécuté par Task C1.

---

## Section A — Backend: Network management REST API (user-auth)

### Task A1 : `lib/membershipGuard.ts` — helpers

**Files:**
- Create: `backend/src/lib/membershipGuard.ts`
- Test: `backend/src/lib/membershipGuard.test.ts`

- [ ] **Step 1 : Test**

```ts
// backend/src/lib/membershipGuard.test.ts
import { describe, it, expect, beforeEach } from "bun:test";
import { db } from "../db/index";
import { networks, memberships, packs, users } from "../db/schema";
import { isMember, requireMember, getNetworkOfPack } from "./membershipGuard";
import { createNetwork } from "./networkManager";
import { addMembership } from "./membershipManager";
import { createPack } from "./packStorage";

async function seedUser(id = "u1") {
  await db.insert(users).values({
    id, email: `${id}@a.b`, name: id, passwordHash: null, avatarUrl: null,
    createdAt: new Date(), updatedAt: new Date(),
  });
}

describe("membershipGuard", () => {
  beforeEach(async () => {
    await db.delete(memberships);
    await db.delete(packs);
    await db.delete(networks);
    await db.delete(users);
  });

  it("isMember returns true when user has membership", async () => {
    await seedUser("u1");
    const net = await createNetwork("N");
    await addMembership("u1", net.id, "owner");
    expect(await isMember("u1", net.id)).toBe(true);
  });

  it("isMember returns false when user has no membership", async () => {
    await seedUser("u1");
    const net = await createNetwork("N");
    expect(await isMember("u1", net.id)).toBe(false);
  });

  it("requireMember throws 'forbidden' when not member", async () => {
    await seedUser("u1");
    const net = await createNetwork("N");
    await expect(requireMember("u1", net.id)).rejects.toThrow(/forbidden/i);
  });

  it("requireMember enforces role when role argument given", async () => {
    await seedUser("u1");
    const net = await createNetwork("N");
    await addMembership("u1", net.id, "admin");
    await expect(requireMember("u1", net.id, "owner")).rejects.toThrow(/forbidden/i);
    await expect(requireMember("u1", net.id, "admin")).resolves.toBeUndefined();
  });

  it("getNetworkOfPack returns the pack's network", async () => {
    await seedUser("u1");
    const net = await createNetwork("N");
    const p = await createPack({ networkId: net.id, name: "main" });
    expect(await getNetworkOfPack(p.id)).toBe(net.id);
  });

  it("getNetworkOfPack returns null when pack not found", async () => {
    expect(await getNetworkOfPack("pack_nope")).toBeNull();
  });
});
```

- [ ] **Step 2 : Run — expect FAIL**

```bash
cd backend && bun test src/lib/membershipGuard.test.ts
```

- [ ] **Step 3 : Implement**

```ts
// backend/src/lib/membershipGuard.ts
import { and, eq } from "drizzle-orm";
import { db } from "../db/index";
import { memberships, packs } from "../db/schema";

export type Role = "owner" | "admin";

export async function isMember(userId: string, networkId: string, role?: Role): Promise<boolean> {
  const rows = await db.select().from(memberships).where(and(
    eq(memberships.userId, userId),
    eq(memberships.networkId, networkId),
  ));
  if (rows.length === 0) return false;
  if (role !== undefined && rows[0].role !== role) return false;
  return true;
}

export async function requireMember(userId: string, networkId: string, role?: Role): Promise<void> {
  if (!(await isMember(userId, networkId, role))) {
    const err = new Error("forbidden");
    (err as Error & { code?: string }).code = "forbidden";
    throw err;
  }
}

export async function getNetworkOfPack(packId: string): Promise<string | null> {
  const rows = await db.select({ networkId: packs.networkId }).from(packs).where(eq(packs.id, packId));
  return rows[0]?.networkId ?? null;
}
```

- [ ] **Step 4 : Run — expect PASS**

- [ ] **Step 5 : Commit**

```bash
git add backend/src/lib/membershipGuard.ts backend/src/lib/membershipGuard.test.ts
git commit -m "feat(backend): membershipGuard (isMember + requireMember + getNetworkOfPack)"
```

---

### Task A2 : `userNetworksRouter` — GET /api/networks + POST /api/networks

**Files:**
- Create: `backend/src/routes/userNetworks.ts`
- Test: `backend/src/routes/userNetworks.test.ts`

The router mounts at `/api/networks` and is gated by `userAuth` middleware (from Plan 1A) which validates `artisan_user_session` cookie and sets `c.var.userId`.

- [ ] **Step 1 : Test**

```ts
// backend/src/routes/userNetworks.test.ts
import { beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { db } from "../db/index";
import {
  memberships, networks, packs, packBindings, serverKeys,
  editorSessions, linkCodes, packConflicts, assets, users, userSessions,
} from "../db/schema";
import { userNetworksRouter } from "./userNetworks";
import { userAuth } from "../middleware/userAuth";
import { createSession } from "../lib/sessionManager";
import { eq } from "drizzle-orm";

async function clearAll() {
  await db.delete(packConflicts).catch(() => {});  // may not exist after Plan 1C
  await db.delete(packBindings);
  await db.delete(assets);
  await db.delete(packs);
  await db.delete(editorSessions);
  await db.delete(linkCodes);
  await db.delete(serverKeys);
  await db.delete(memberships);
  await db.delete(networks);
  await db.delete(userSessions);
  await db.delete(users);
}

async function seedUser(id = "u1") {
  await db.insert(users).values({
    id, email: `${id}@a.b`, name: id, passwordHash: null, avatarUrl: null,
    createdAt: new Date(), updatedAt: new Date(),
  });
  const session = await createSession(id);
  return { userId: id, sessionId: session.id };
}

function makeApp() {
  const app = new Hono();
  app.use("/api/networks/*", userAuth);
  app.route("/api/networks", userNetworksRouter);
  return app;
}

describe("userNetworksRouter", () => {
  beforeEach(clearAll);

  test("GET /api/networks returns empty array for new user", async () => {
    const { sessionId } = await seedUser();
    const app = makeApp();
    const res = await app.request("/api/networks", {
      headers: { Cookie: `artisan_user_session=${sessionId}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.networks).toEqual([]);
  });

  test("GET /api/networks 401 without cookie", async () => {
    const app = makeApp();
    const res = await app.request("/api/networks");
    expect(res.status).toBe(401);
  });

  test("POST /api/networks creates Network and owner Membership", async () => {
    const { userId, sessionId } = await seedUser();
    const app = makeApp();
    const res = await app.request("/api/networks", {
      method: "POST",
      headers: {
        Cookie: `artisan_user_session=${sessionId}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "My Network" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.network.name).toBe("My Network");

    const memb = await db.select().from(memberships).where(eq(memberships.userId, userId));
    expect(memb).toHaveLength(1);
    expect(memb[0].role).toBe("owner");
    expect(memb[0].networkId).toBe(body.network.id);
  });

  test("POST /api/networks 422 when name missing", async () => {
    const { sessionId } = await seedUser();
    const app = makeApp();
    const res = await app.request("/api/networks", {
      method: "POST",
      headers: {
        Cookie: `artisan_user_session=${sessionId}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(422);
  });

  test("GET /api/networks returns user's networks", async () => {
    const { sessionId } = await seedUser();
    const app = makeApp();
    await app.request("/api/networks", {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "N1" }),
    });
    await app.request("/api/networks", {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "N2" }),
    });

    const list = await (await app.request("/api/networks", {
      headers: { Cookie: `artisan_user_session=${sessionId}` },
    })).json();
    expect(list.networks).toHaveLength(2);
    expect(list.networks.map((n: { name: string }) => n.name).sort()).toEqual(["N1", "N2"]);
  });
});
```

- [ ] **Step 2 : Run — expect FAIL**

- [ ] **Step 3 : Implement**

```ts
// backend/src/routes/userNetworks.ts
import { Hono } from "hono";
import type { Context } from "hono";
import { db } from "../db/index";
import { networks } from "../db/schema";
import { eq, inArray } from "drizzle-orm";
import { memberships } from "../db/schema";
import { createNetwork } from "../lib/networkManager";
import { addMembership } from "../lib/membershipManager";

type Vars = { userId: string };

export const userNetworksRouter = new Hono<{ Variables: Vars }>();

userNetworksRouter.get("/", async (c: Context<{ Variables: Vars }>) => {
  const userId = c.get("userId");
  const memb = await db.select({ networkId: memberships.networkId })
    .from(memberships).where(eq(memberships.userId, userId));
  if (memb.length === 0) return c.json({ networks: [] });
  const list = await db.select().from(networks)
    .where(inArray(networks.id, memb.map((m) => m.networkId)));
  return c.json({ networks: list });
});

userNetworksRouter.post("/", async (c: Context<{ Variables: Vars }>) => {
  const userId = c.get("userId");
  let body: { name?: unknown };
  try { body = await c.req.json(); } catch { return c.json({ error: "invalid_body" }, 400); }
  if (typeof body.name !== "string" || body.name.trim().length === 0) {
    return c.json({ error: "invalid_name" }, 422);
  }
  const network = await createNetwork(body.name.trim());
  await addMembership(userId, network.id, "owner");
  return c.json({ network }, 201);
});
```

- [ ] **Step 4 : Mount in `app.ts`**

```ts
// backend/src/app.ts — add after Plan 1A's auth mounts
import { userNetworksRouter } from "./routes/userNetworks";
import { userAuth } from "./middleware/userAuth";

app.use("/api/networks/*", userAuth);
app.route("/api/networks", userNetworksRouter);
```

- [ ] **Step 5 : Run — expect PASS**

```bash
cd backend && bun test src/routes/userNetworks.test.ts
```

- [ ] **Step 6 : Commit**

```bash
git add backend/src/routes/userNetworks.ts backend/src/routes/userNetworks.test.ts backend/src/app.ts
git commit -m "feat(backend): GET + POST /api/networks (user-auth)"
```

---

### Task A3 : GET /api/networks/:id (detail with packs + serverKeys)

**Files:**
- Modify: `backend/src/routes/userNetworks.ts`
- Modify: `backend/src/routes/userNetworks.test.ts`

- [ ] **Step 1 : Test**

```ts
// Append to userNetworks.test.ts:
test("GET /api/networks/:id returns detail with packs + serverKeys", async () => {
  const { userId, sessionId } = await seedUser();
  const app = makeApp();

  // Create network
  const create = await app.request("/api/networks", {
    method: "POST",
    headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "N1" }),
  });
  const { network } = await create.json();

  // Seed a pack and a server_key in this network directly via DB
  const { createPack } = await import("../lib/packStorage");
  await createPack({ networkId: network.id, name: "p1" });
  await db.insert(serverKeys).values({
    id: "sk_test_a3",
    hash: "hash_a3",
    networkId: network.id,
    createdAt: new Date(),
    label: null,
  });

  const res = await app.request(`/api/networks/${network.id}`, {
    headers: { Cookie: `artisan_user_session=${sessionId}` },
  });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.network.id).toBe(network.id);
  expect(body.packs).toHaveLength(1);
  expect(body.packs[0].name).toBe("p1");
  expect(body.serverKeys).toHaveLength(1);
  expect(body.serverKeys[0].id).toBe("sk_test_a3");
});

test("GET /api/networks/:id 403 when not member", async () => {
  const { sessionId: sessA } = await seedUser("uA");
  await seedUser("uB");
  const app = makeApp();

  // uA creates a network
  const create = await app.request("/api/networks", {
    method: "POST",
    headers: { Cookie: `artisan_user_session=${sessA}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "N" }),
  });
  const { network } = await create.json();

  // uB tries to read it
  const { createSession } = await import("../lib/sessionManager");
  const sessB = (await createSession("uB")).id;
  const res = await app.request(`/api/networks/${network.id}`, {
    headers: { Cookie: `artisan_user_session=${sessB}` },
  });
  expect(res.status).toBe(403);
});
```

- [ ] **Step 2 : Run — expect FAIL**

- [ ] **Step 3 : Implement**

```ts
// backend/src/routes/userNetworks.ts — append:
import { serverKeys } from "../db/schema";
import { requireMember } from "../lib/membershipGuard";
import { listPacksForNetwork } from "../lib/packStorage";

userNetworksRouter.get("/:id", async (c: Context<{ Variables: Vars }>) => {
  const userId = c.get("userId");
  const networkId = c.req.param("id");
  try {
    await requireMember(userId, networkId);
  } catch {
    return c.json({ error: "forbidden" }, 403);
  }
  const netRows = await db.select().from(networks).where(eq(networks.id, networkId));
  if (netRows.length === 0) return c.json({ error: "not_found" }, 404);
  const packsList = await listPacksForNetwork(networkId);
  const skList = await db.select().from(serverKeys).where(eq(serverKeys.networkId, networkId));
  return c.json({ network: netRows[0], packs: packsList, serverKeys: skList });
});
```

- [ ] **Step 4 : Run — expect PASS**

- [ ] **Step 5 : Commit**

```bash
git add backend/src/routes/userNetworks.ts backend/src/routes/userNetworks.test.ts
git commit -m "feat(backend): GET /api/networks/:id (detail + membership check)"
```

---

### Task A4 : POST /api/networks/:id/server-keys (create server_key in Network)

**Files:**
- Modify: `backend/src/routes/userNetworks.ts`
- Modify: `backend/src/routes/userNetworks.test.ts`

- [ ] **Step 1 : Test**

```ts
test("POST /api/networks/:id/server-keys creates server_key and returns plaintext", async () => {
  const { sessionId } = await seedUser();
  const app = makeApp();
  const { network } = await (await app.request("/api/networks", {
    method: "POST",
    headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "N" }),
  })).json();

  const res = await app.request(`/api/networks/${network.id}/server-keys`, {
    method: "POST",
    headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
    body: JSON.stringify({ label: "test-server" }),
  });
  expect(res.status).toBe(201);
  const body = await res.json();
  expect(body.key).toMatch(/^sk_[0-9a-f]{64}$/);
  expect(body.id).toBeDefined();

  const sk = await db.select().from(serverKeys).where(eq(serverKeys.id, body.id));
  expect(sk[0].networkId).toBe(network.id);
  expect(sk[0].label).toBe("test-server");
});

test("POST /api/networks/:id/server-keys 403 when not member", async () => {
  const { sessionId: sessA } = await seedUser("uA");
  await seedUser("uB");
  const app = makeApp();
  const { network } = await (await app.request("/api/networks", {
    method: "POST",
    headers: { Cookie: `artisan_user_session=${sessA}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "N" }),
  })).json();

  const { createSession } = await import("../lib/sessionManager");
  const sessB = (await createSession("uB")).id;
  const res = await app.request(`/api/networks/${network.id}/server-keys`, {
    method: "POST",
    headers: { Cookie: `artisan_user_session=${sessB}`, "Content-Type": "application/json" },
    body: JSON.stringify({ label: "x" }),
  });
  expect(res.status).toBe(403);
});
```

- [ ] **Step 2 : Run — expect FAIL**

- [ ] **Step 3 : Implement**

```ts
// backend/src/routes/userNetworks.ts — append:
import { generateServerKey } from "../lib/auth";

userNetworksRouter.post("/:id/server-keys", async (c: Context<{ Variables: Vars }>) => {
  const userId = c.get("userId");
  const networkId = c.req.param("id");
  try { await requireMember(userId, networkId); } catch { return c.json({ error: "forbidden" }, 403); }
  let body: { label?: unknown } = {};
  try { body = await c.req.json(); } catch { /* empty body ok */ }
  const label = typeof body.label === "string" ? body.label : null;
  const { id, key, hash } = await generateServerKey();
  await db.insert(serverKeys).values({
    id, hash, label, networkId, createdAt: new Date(),
  });
  return c.json({ id, key, label }, 201);
});
```

- [ ] **Step 4 : Run — expect PASS**

- [ ] **Step 5 : Commit**

```bash
git add backend/src/routes/userNetworks.ts backend/src/routes/userNetworks.test.ts
git commit -m "feat(backend): POST /api/networks/:id/server-keys"
```

---

### Task A5 : POST /api/networks/:id/packs (create pack)

**Files:**
- Modify: `backend/src/routes/userNetworks.ts`
- Modify: `backend/src/routes/userNetworks.test.ts`

- [ ] **Step 1 : Test**

```ts
test("POST /api/networks/:id/packs creates pack in network", async () => {
  const { sessionId } = await seedUser();
  const app = makeApp();
  const { network } = await (await app.request("/api/networks", {
    method: "POST",
    headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "N" }),
  })).json();

  const res = await app.request(`/api/networks/${network.id}/packs`, {
    method: "POST",
    headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "my-pack", description: "desc" }),
  });
  expect(res.status).toBe(201);
  const body = await res.json();
  expect(body.pack.name).toBe("my-pack");
  expect(body.pack.description).toBe("desc");
  expect(body.pack.networkId).toBe(network.id);
});
```

- [ ] **Step 2 : Run — expect FAIL**

- [ ] **Step 3 : Implement**

```ts
// backend/src/routes/userNetworks.ts — append:
import { createPack } from "../lib/packStorage";

userNetworksRouter.post("/:id/packs", async (c: Context<{ Variables: Vars }>) => {
  const userId = c.get("userId");
  const networkId = c.req.param("id");
  try { await requireMember(userId, networkId); } catch { return c.json({ error: "forbidden" }, 403); }
  const body = await c.req.json<{ name?: string; description?: string }>();
  if (typeof body.name !== "string" || body.name.trim().length === 0) {
    return c.json({ error: "invalid_name" }, 422);
  }
  const pack = await createPack({
    networkId,
    name: body.name.trim(),
    description: body.description ?? null,
  });
  return c.json({ pack }, 201);
});
```

- [ ] **Step 4 : Run — expect PASS**

- [ ] **Step 5 : Commit**

```bash
git add backend/src/routes/userNetworks.ts backend/src/routes/userNetworks.test.ts
git commit -m "feat(backend): POST /api/networks/:id/packs"
```

---

### Task A6 : POST + DELETE /api/networks/:id/packs/:packId/bindings/:serverKeyId

**Files:**
- Modify: `backend/src/routes/userNetworks.ts`
- Modify: `backend/src/routes/userNetworks.test.ts`

- [ ] **Step 1 : Test**

```ts
test("POST + DELETE bindings — bind/unbind a server_key to a pack", async () => {
  const { sessionId } = await seedUser();
  const app = makeApp();
  const { network } = await (await app.request("/api/networks", {
    method: "POST",
    headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "N" }),
  })).json();

  const skRes = await app.request(`/api/networks/${network.id}/server-keys`, {
    method: "POST",
    headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  const { id: skId } = await skRes.json();

  const packRes = await app.request(`/api/networks/${network.id}/packs`, {
    method: "POST",
    headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "p" }),
  });
  const { pack } = await packRes.json();

  // Bind
  const bind = await app.request(`/api/networks/${network.id}/packs/${pack.id}/bindings/${skId}`, {
    method: "POST",
    headers: { Cookie: `artisan_user_session=${sessionId}` },
  });
  expect(bind.status).toBe(201);

  const bindings = await db.select().from(packBindings).where(eq(packBindings.packId, pack.id));
  expect(bindings).toHaveLength(1);
  expect(bindings[0].serverKeyId).toBe(skId);

  // Unbind
  const unbind = await app.request(`/api/networks/${network.id}/packs/${pack.id}/bindings/${skId}`, {
    method: "DELETE",
    headers: { Cookie: `artisan_user_session=${sessionId}` },
  });
  expect(unbind.status).toBe(204);

  const after = await db.select().from(packBindings).where(eq(packBindings.packId, pack.id));
  expect(after).toHaveLength(0);
});
```

- [ ] **Step 2 : Run — expect FAIL**

- [ ] **Step 3 : Implement**

```ts
// backend/src/routes/userNetworks.ts — append:
import { createBinding, deleteBinding } from "../lib/packBindingManager";

userNetworksRouter.post("/:id/packs/:packId/bindings/:serverKeyId", async (c: Context<{ Variables: Vars }>) => {
  const userId = c.get("userId");
  const networkId = c.req.param("id");
  const packId = c.req.param("packId");
  const skId = c.req.param("serverKeyId");
  try { await requireMember(userId, networkId); } catch { return c.json({ error: "forbidden" }, 403); }

  // Verify pack and server_key both belong to this network
  const packRows = await db.select().from(packs).where(eq(packs.id, packId));
  if (packRows.length === 0 || packRows[0].networkId !== networkId) return c.json({ error: "pack_not_in_network" }, 404);
  const skRows = await db.select().from(serverKeys).where(eq(serverKeys.id, skId));
  if (skRows.length === 0 || skRows[0].networkId !== networkId) return c.json({ error: "server_key_not_in_network" }, 404);

  await createBinding(skId, packId);
  return c.json({ ok: true }, 201);
});

userNetworksRouter.delete("/:id/packs/:packId/bindings/:serverKeyId", async (c: Context<{ Variables: Vars }>) => {
  const userId = c.get("userId");
  const networkId = c.req.param("id");
  const packId = c.req.param("packId");
  const skId = c.req.param("serverKeyId");
  try { await requireMember(userId, networkId); } catch { return c.json({ error: "forbidden" }, 403); }
  await deleteBinding(skId, packId);
  return c.body(null, 204);
});
```

> Note : `createBinding` peut violer le contraint unique si déjà bindé. Pour Plan 1C MVP on retourne 500 dans ce cas (rare) ; on peut le wrapper plus tard.

- [ ] **Step 4 : Run — expect PASS**

- [ ] **Step 5 : Commit**

```bash
git add backend/src/routes/userNetworks.ts backend/src/routes/userNetworks.test.ts
git commit -m "feat(backend): POST + DELETE /api/networks/:id/packs/:packId/bindings/:serverKeyId"
```

---

## Section B — Backend: User-auth pack edit API

### Task B1 : `userPacksRouter` — GET /api/user/packs/:packId

**Files:**
- Create: `backend/src/routes/userPacks.ts`
- Test: `backend/src/routes/userPacks.test.ts`

- [ ] **Step 1 : Test**

```ts
// backend/src/routes/userPacks.test.ts
import { beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { db } from "../db/index";
import {
  memberships, networks, packs, packBindings, serverKeys,
  editorSessions, linkCodes, assets, users, userSessions,
} from "../db/schema";
import { userPacksRouter } from "./userPacks";
import { userAuth } from "../middleware/userAuth";
import { createSession } from "../lib/sessionManager";
import { createNetwork } from "../lib/networkManager";
import { addMembership } from "../lib/membershipManager";
import { createPack, upsertPackContent } from "../lib/packStorage";

async function clearAll() {
  await db.delete(packBindings);
  await db.delete(assets);
  await db.delete(packs);
  await db.delete(editorSessions);
  await db.delete(linkCodes);
  await db.delete(serverKeys);
  await db.delete(memberships);
  await db.delete(networks);
  await db.delete(userSessions);
  await db.delete(users);
}

async function seedUserWithPack(userId = "u1") {
  await db.insert(users).values({
    id: userId, email: `${userId}@a.b`, name: userId, passwordHash: null, avatarUrl: null,
    createdAt: new Date(), updatedAt: new Date(),
  });
  const session = await createSession(userId);
  const net = await createNetwork("N");
  await addMembership(userId, net.id, "owner");
  const pack = await createPack({ networkId: net.id, name: "p" });
  await upsertPackContent(pack.id, {
    hash: "h1",
    filesJson: JSON.stringify({ "menus/m.yaml": "id: m" }),
    editorJson: JSON.stringify({ id: pack.id, menus: [] }),
  });
  return { userId, sessionId: session.id, networkId: net.id, packId: pack.id };
}

function makeApp() {
  const app = new Hono();
  app.use("/api/user/packs/*", userAuth);
  app.route("/api/user/packs", userPacksRouter);
  return app;
}

describe("userPacksRouter — GET", () => {
  beforeEach(clearAll);

  test("GET /api/user/packs/:packId returns full pack content for member", async () => {
    const { sessionId, packId } = await seedUserWithPack();
    const app = makeApp();
    const res = await app.request(`/api/user/packs/${packId}`, {
      headers: { Cookie: `artisan_user_session=${sessionId}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pack.id).toBe(packId);
    expect(body.pack.hash).toBe("h1");
    expect(body.files).toEqual({ "menus/m.yaml": "id: m" });
    expect(body.editor.id).toBe(packId);
  });

  test("GET /api/user/packs/:packId 403 for non-member", async () => {
    const { packId } = await seedUserWithPack("uA");
    // Different user
    await db.insert(users).values({
      id: "uB", email: "uB@a.b", name: "uB", passwordHash: null, avatarUrl: null,
      createdAt: new Date(), updatedAt: new Date(),
    });
    const sessB = (await createSession("uB")).id;
    const app = makeApp();
    const res = await app.request(`/api/user/packs/${packId}`, {
      headers: { Cookie: `artisan_user_session=${sessB}` },
    });
    expect(res.status).toBe(403);
  });

  test("GET /api/user/packs/:packId 404 when pack does not exist", async () => {
    const { sessionId } = await seedUserWithPack();
    const app = makeApp();
    const res = await app.request("/api/user/packs/pack_nope", {
      headers: { Cookie: `artisan_user_session=${sessionId}` },
    });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2 : Run — expect FAIL**

- [ ] **Step 3 : Implement**

```ts
// backend/src/routes/userPacks.ts
import { Hono } from "hono";
import type { Context } from "hono";
import { getPack } from "../lib/packStorage";
import { getNetworkOfPack, requireMember } from "../lib/membershipGuard";

type Vars = { userId: string };

export const userPacksRouter = new Hono<{ Variables: Vars }>();

userPacksRouter.get("/:packId", async (c: Context<{ Variables: Vars }>) => {
  const userId = c.get("userId");
  const packId = c.req.param("packId");
  const networkId = await getNetworkOfPack(packId);
  if (!networkId) return c.json({ error: "not_found" }, 404);
  try { await requireMember(userId, networkId); } catch { return c.json({ error: "forbidden" }, 403); }
  const pack = await getPack(packId);
  if (!pack) return c.json({ error: "not_found" }, 404);
  return c.json({
    pack,
    files: JSON.parse(pack.filesJson) as Record<string, string>,
    editor: pack.editorJson ? JSON.parse(pack.editorJson) : null,
  });
});
```

- [ ] **Step 4 : Mount in app.ts**

```ts
// backend/src/app.ts — add:
import { userPacksRouter } from "./routes/userPacks";
app.use("/api/user/packs/*", userAuth);
app.route("/api/user/packs", userPacksRouter);
```

- [ ] **Step 5 : Run — expect PASS**

- [ ] **Step 6 : Commit**

```bash
git add backend/src/routes/userPacks.ts backend/src/routes/userPacks.test.ts backend/src/app.ts
git commit -m "feat(backend): GET /api/user/packs/:packId (logged-in pack read)"
```

---

### Task B2 : PUT /api/user/packs/:packId (logged-in pack write)

**Files:**
- Modify: `backend/src/routes/userPacks.ts`
- Modify: `backend/src/routes/userPacks.test.ts`

- [ ] **Step 1 : Test**

```ts
describe("userPacksRouter — PUT", () => {
  beforeEach(clearAll);

  test("PUT /api/user/packs/:packId updates filesJson + editorJson + hash", async () => {
    const { sessionId, packId } = await seedUserWithPack();
    const app = makeApp();
    const res = await app.request(`/api/user/packs/${packId}`, {
      method: "PUT",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        hash: "newhash",
        files: { "a.yaml": "x" },
        editor: { id: packId, menus: [{ id: "m1" }] },
      }),
    });
    expect(res.status).toBe(200);
    const { getPack } = await import("../lib/packStorage");
    const updated = await getPack(packId);
    expect(updated?.hash).toBe("newhash");
    expect(JSON.parse(updated!.filesJson)).toEqual({ "a.yaml": "x" });
  });

  test("PUT /api/user/packs/:packId 403 for non-member", async () => {
    const { packId } = await seedUserWithPack("uA");
    await db.insert(users).values({
      id: "uB", email: "uB@a.b", name: "uB", passwordHash: null, avatarUrl: null,
      createdAt: new Date(), updatedAt: new Date(),
    });
    const sessB = (await createSession("uB")).id;
    const app = makeApp();
    const res = await app.request(`/api/user/packs/${packId}`, {
      method: "PUT",
      headers: { Cookie: `artisan_user_session=${sessB}`, "Content-Type": "application/json" },
      body: JSON.stringify({ hash: "x", files: {}, editor: {} }),
    });
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2 : Run — expect FAIL**

- [ ] **Step 3 : Implement**

```ts
// backend/src/routes/userPacks.ts — append:
import { upsertPackContent } from "../lib/packStorage";
import { pushBundleAvailable } from "../ws/hub";

userPacksRouter.put("/:packId", async (c: Context<{ Variables: Vars }>) => {
  const userId = c.get("userId");
  const packId = c.req.param("packId");
  const networkId = await getNetworkOfPack(packId);
  if (!networkId) return c.json({ error: "not_found" }, 404);
  try { await requireMember(userId, networkId); } catch { return c.json({ error: "forbidden" }, 403); }

  const body = await c.req.json<{ hash: string; files: Record<string, string>; editor: unknown }>();
  await upsertPackContent(packId, {
    hash: body.hash,
    filesJson: JSON.stringify(body.files),
    editorJson: body.editor ? JSON.stringify(body.editor) : null,
  });
  // Broadcast to any bound plugins so they pick up the new content.
  await pushBundleAvailable(packId, body.hash);
  return c.json({ ok: true });
});
```

- [ ] **Step 4 : Run — expect PASS**

- [ ] **Step 5 : Commit**

```bash
git add backend/src/routes/userPacks.ts backend/src/routes/userPacks.test.ts
git commit -m "feat(backend): PUT /api/user/packs/:packId (logged-in pack write + broadcast)"
```

---

## Section C — Backend: Retrait conflits

### Task C1 : Wipe script + drop pack_conflicts table

**Files:**
- Create: `backend/scripts/wipe-phase-1c.ts`
- Modify: `backend/src/db/schema.ts`

- [ ] **Step 1 : Write wipe script**

```ts
// backend/scripts/wipe-phase-1c.ts
import { db } from "../src/db/index";
import { sql } from "drizzle-orm";

async function main() {
  console.log("[wipe-1c] Dropping pack_conflicts...");
  await db.execute(sql`DROP TABLE IF EXISTS pack_conflicts CASCADE`);
  console.log("[wipe-1c] Done. Run `bun run db:push` to apply the schema.");
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2 : Remove `packConflicts` from `backend/src/db/schema.ts`**

Locate the `export const packConflicts = pgTable("pack_conflicts", { ... })` block (~20 lines) and delete it entirely.

- [ ] **Step 3 : Execute wipe + push**

```bash
cd backend
bun run scripts/wipe-phase-1c.ts
bun run db:push
```

Expected: `bun run db:push` applies cleanly. Verify with:

```bash
bun -e "import { db } from './src/db/index'; import { sql } from 'drizzle-orm'; const rs = await db.execute(sql\`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename='pack_conflicts'\`); console.log(rs.length === 0 ? 'gone' : 'still present'); process.exit(0);"
```

Expected: `gone`.

- [ ] **Step 4 : Commit**

```bash
git add backend/scripts/wipe-phase-1c.ts backend/src/db/schema.ts
git commit -m "chore(backend): wipe script + drop pack_conflicts from schema"
```

---

### Task C2 : Remove `conflictsRouter` + `conflictDiff`

**Files:**
- Delete: `backend/src/routes/conflicts.ts`
- Delete: `backend/src/routes/conflicts.test.ts`
- Delete: `backend/src/lib/conflictDiff.ts`
- Delete: `backend/src/lib/conflictDiff.test.ts`
- Modify: `backend/src/app.ts`

- [ ] **Step 1 : Delete the 4 files**

```bash
rm backend/src/routes/conflicts.ts backend/src/routes/conflicts.test.ts
rm backend/src/lib/conflictDiff.ts backend/src/lib/conflictDiff.test.ts
```

- [ ] **Step 2 : Unmount `conflictsRouter` from `app.ts`**

Locate the line `import { conflictsRouter } from "./routes/conflicts";` and the corresponding `app.route("/api/editor-session", conflictsRouter)` (or similar). Remove both.

- [ ] **Step 3 : Verify backend compiles**

```bash
cd backend && bun -e "import './src/app'; console.log('ok'); process.exit(0);"
```

Expected: `ok`.

- [ ] **Step 4 : Commit**

```bash
git add backend/src/routes backend/src/lib backend/src/app.ts
git commit -m "refactor(backend): remove conflictsRouter + conflictDiff (Plan 1C: backend-as-truth)"
```

---

### Task C3 : Remove `pack_divergence_detected` handler + freeze check from hub.ts

**Files:**
- Modify: `backend/src/ws/hub.ts`
- Modify: `backend/src/ws/hub.test.ts`

- [ ] **Step 1 : Modify `hub.ts` — drop the `pack_divergence_detected` block**

Locate the block `if (msg.type === "pack_divergence_detected") { ... }` in `handlePluginMessage`. Replace with:

```ts
// Plan 1C: backend = source of truth. We accept (but ignore) divergence reports
// from older plugin versions for backward compatibility. New plugins (1C+) no
// longer emit this message — they WARN locally and auto-overwrite from backend.
if (msg.type === "pack_divergence_detected") {
  return { reply: null };
}
```

- [ ] **Step 2 : Remove the freeze check from `pushBundleAvailable`**

Locate:
```ts
// Freeze: per-target skip if an open conflict exists for (server, pack).
const open = await db.select(...).from(packConflicts).where(...);
if (open.length > 0) continue;
```

Delete those lines. Also remove the `import { packConflicts } from "../db/schema"` line if it's no longer used. `grep -n packConflicts backend/src/ws/hub.ts` must return nothing.

- [ ] **Step 3 : Update `editorSession.ts` — remove conflict auto-resolution from DELETE pack**

Locate the DELETE pack handler:

```ts
await softDeletePack(packId);
await db.update(packConflicts)
  .set({ resolvedAt: new Date(), resolution: "editor" })
  .where(and(eq(packConflicts.packId, packId), isNull(packConflicts.resolvedAt)));
await pushPackDeleted(packId);
```

Replace with:

```ts
await softDeletePack(packId);
await pushPackDeleted(packId);
```

Remove the `packConflicts` import from `editorSession.ts` if no longer used.

- [ ] **Step 4 : Update `hub.test.ts` — drop pack_divergence_detected tests**

Delete the entire `describe("pack_divergence_detected", () => { ... })` block (3 tests).

- [ ] **Step 5 : Run remaining hub.test.ts and editorSession.test.ts**

```bash
cd backend && bun test src/ws/hub.test.ts src/routes/editorSession.test.ts
```

Expected: all green.

- [ ] **Step 6 : Commit**

```bash
git add backend/src/ws/hub.ts backend/src/ws/hub.test.ts backend/src/routes/editorSession.ts
git commit -m "refactor(backend): drop pack_divergence_detected handler + freeze check + conflict auto-resolve"
```

---

### Task C4 : Update `protocol.ts` — remove conflict message types

**Files:**
- Modify: `backend/src/protocol.ts`

- [ ] **Step 1 : Find and remove** `PackConflictDetectedMessage` and `PackConflictResolvedMessage` type definitions, plus any union-member references.

- [ ] **Step 2 : Verify**

```bash
cd backend && grep -n "PackConflict\|pack_conflict_detected\|pack_conflict_resolved" src/
```

Expected: no matches in `src/` (matches in `data/` etc. are OK).

- [ ] **Step 3 : Commit**

```bash
git add backend/src/protocol.ts
git commit -m "refactor(backend): drop PackConflict* message types from protocol"
```

---

## Section D — Backend: WS `local_push` handler for /artisan pushLocal

### Task D1 : Add `local_push` message handler

**Files:**
- Modify: `backend/src/ws/hub.ts`
- Modify: `backend/src/ws/hub.test.ts`
- Modify: `backend/src/protocol.ts`

- [ ] **Step 1 : Add `LocalPushMessage` to `protocol.ts`**

```ts
// backend/src/protocol.ts — add:
export interface LocalPushMessage {
  type: "local_push";
  pack_id: string;
  files: Record<string, string>;
  hash: string;
}
```

- [ ] **Step 2 : Test**

```ts
// backend/src/ws/hub.test.ts — append:
describe("local_push", () => {
  test("creates pack + binding if missing, upserts content, broadcasts bundle_available", async () => {
    const { id: keyId, key, networkId } = await seedServerKey();
    const connId = "conn-local-push";
    const received: string[] = [];
    registerConn(connId, (msg) => received.push(msg));

    // Authenticate via hello first
    await handlePluginMessage(connId, JSON.stringify({
      type: "hello", server_key: key, plugin_version: "1.0", minecraft_version: "1.21", current_bundle_hash: "",
    }));

    const result = await handlePluginMessage(connId, JSON.stringify({
      type: "local_push",
      pack_id: "p_pushed",
      files: { "menus/m.yaml": "id: m" },
      hash: "abc123",
    }));
    expect(result.reply).toBeNull();

    const { getPack } = await import("../lib/packStorage");
    const pack = await getPack("p_pushed");
    expect(pack).not.toBeNull();
    expect(pack!.networkId).toBe(networkId);
    expect(pack!.hash).toBe("abc123");

    const { listPacksForServerKey } = await import("../lib/packBindingManager");
    const bound = await listPacksForServerKey(keyId);
    expect(bound.map((p) => p.id)).toContain("p_pushed");
  });

  test("local_push unauthenticated → ignored", async () => {
    const connId = "conn-local-push-unauth";
    registerConn(connId, () => {});
    const result = await handlePluginMessage(connId, JSON.stringify({
      type: "local_push", pack_id: "p", files: {}, hash: "h",
    }));
    expect(result.reply).toBeNull();
  });
});
```

- [ ] **Step 3 : Run — expect FAIL**

- [ ] **Step 4 : Implement in `hub.ts` — add handler before `return { reply: null }` fallback**

```ts
// backend/src/ws/hub.ts — inside handlePluginMessage:
if (msg.type === "local_push") {
  const serverId = connToServerId.get(connId);
  if (!serverId) return { reply: null };
  const raw = msg as Record<string, unknown>;
  const packId = raw.pack_id as string | undefined;
  const files = raw.files as Record<string, string> | undefined;
  const hash = raw.hash as string | undefined;
  if (!packId || !files || !hash) return { reply: null };

  const sk = (await db.select().from(serverKeys).where(eq(serverKeys.id, serverId)))[0];
  if (!sk) return { reply: null };

  let pack = await getPackById(packId);
  if (!pack) {
    pack = await createPack({ networkId: sk.networkId, name: packId, id: packId });
  }
  // Ensure binding exists for this server_key.
  const bound = await listPacksForServerKey(serverId);
  if (!bound.find((p) => p.id === packId)) {
    await createBinding(serverId, packId);
  }
  await upsertPackContent(packId, { hash, filesJson: JSON.stringify(files) });
  await pushBundleAvailable(packId, hash);
  return { reply: null };
}
```

Imports needed at top of file (if not already present):
```ts
import { getPack as getPackById, createPack, upsertPackContent } from "../lib/packStorage";
import { createBinding, listPacksForServerKey } from "../lib/packBindingManager";
```

> Note : `getPack` is already imported by Plan 1B; alias to `getPackById` to avoid collision with any local variable named `pack`. Adjust to existing imports.

- [ ] **Step 5 : Run — expect PASS**

- [ ] **Step 6 : Commit**

```bash
git add backend/src/ws/hub.ts backend/src/ws/hub.test.ts backend/src/protocol.ts
git commit -m "feat(backend): WS local_push handler (/artisan pushLocal flow)"
```

---

## Section E — Editor: API clients + stores

### Task E1 : `lib/api/networks.ts` — user-scoped Network API

**Files:**
- Create: `editor/src/lib/api/networks.ts`
- Test: `editor/src/lib/api/networks.test.ts`

- [ ] **Step 1 : Test**

```ts
// editor/src/lib/api/networks.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  listNetworks, createNetwork, getNetwork,
  createServerKey, createPack, bindPackToServerKey, unbindPack,
} from "./networks";

describe("networks API client", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("listNetworks GET /api/networks returns the list", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ networks: [{ id: "n1", name: "N1" }] }), { status: 200 }));
    const list = await listNetworks();
    expect(list).toEqual([{ id: "n1", name: "N1" }]);
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/api/networks"), expect.objectContaining({ credentials: "include" }));
  });

  it("createNetwork POST returns the new network", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ network: { id: "n1", name: "X" } }), { status: 201 }));
    const net = await createNetwork("X");
    expect(net).toEqual({ id: "n1", name: "X" });
  });

  it("getNetwork GET /api/networks/:id returns detail", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({
      network: { id: "n1", name: "N" }, packs: [], serverKeys: [],
    }), { status: 200 }));
    const detail = await getNetwork("n1");
    expect(detail.network.id).toBe("n1");
  });

  it("createServerKey POST /api/networks/:id/server-keys returns plaintext key", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ id: "sk_1", key: "sk_abc", label: "x" }), { status: 201 }));
    const res = await createServerKey("n1", "x");
    expect(res.key).toBe("sk_abc");
  });

  it("createPack POST /api/networks/:id/packs returns the pack", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ pack: { id: "pack_1", name: "p" } }), { status: 201 }));
    const p = await createPack("n1", "p");
    expect(p.id).toBe("pack_1");
  });

  it("bindPackToServerKey returns ok", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 201 }));
    await bindPackToServerKey("n1", "p1", "sk_1");
    expect(fetch).toHaveBeenCalledWith(expect.stringMatching(/\/api\/networks\/n1\/packs\/p1\/bindings\/sk_1$/), expect.objectContaining({ method: "POST" }));
  });

  it("unbindPack returns ok", async () => {
    global.fetch = vi.fn(async () => new Response(null, { status: 204 }));
    await unbindPack("n1", "p1", "sk_1");
    expect(fetch).toHaveBeenCalledWith(expect.stringMatching(/\/api\/networks\/n1\/packs\/p1\/bindings\/sk_1$/), expect.objectContaining({ method: "DELETE" }));
  });
});
```

- [ ] **Step 2 : Run — expect FAIL**

- [ ] **Step 3 : Implement**

```ts
// editor/src/lib/api/networks.ts
const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

export interface NetworkSummary { id: string; name: string; tier: string; }
export interface ServerKeySummary { id: string; label: string | null; }
export interface PackSummary { id: string; name: string; hash: string; }

export async function listNetworks(): Promise<NetworkSummary[]> {
  const res = await fetch(`${API_URL}/api/networks`, { credentials: "include" });
  if (!res.ok) throw new Error(`listNetworks failed: ${res.status}`);
  return ((await res.json()) as { networks: NetworkSummary[] }).networks;
}

export async function createNetwork(name: string): Promise<NetworkSummary> {
  const res = await fetch(`${API_URL}/api/networks`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`createNetwork failed: ${res.status}`);
  return ((await res.json()) as { network: NetworkSummary }).network;
}

export async function getNetwork(id: string): Promise<{
  network: NetworkSummary;
  packs: PackSummary[];
  serverKeys: ServerKeySummary[];
}> {
  const res = await fetch(`${API_URL}/api/networks/${id}`, { credentials: "include" });
  if (!res.ok) throw new Error(`getNetwork failed: ${res.status}`);
  return res.json();
}

export async function createServerKey(
  networkId: string,
  label?: string,
): Promise<{ id: string; key: string; label: string | null }> {
  const res = await fetch(`${API_URL}/api/networks/${networkId}/server-keys`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(label !== undefined ? { label } : {}),
  });
  if (!res.ok) throw new Error(`createServerKey failed: ${res.status}`);
  return res.json();
}

export async function createPack(
  networkId: string,
  name: string,
  description?: string,
): Promise<PackSummary> {
  const res = await fetch(`${API_URL}/api/networks/${networkId}/packs`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, ...(description !== undefined && { description }) }),
  });
  if (!res.ok) throw new Error(`createPack failed: ${res.status}`);
  return ((await res.json()) as { pack: PackSummary }).pack;
}

export async function bindPackToServerKey(
  networkId: string,
  packId: string,
  serverKeyId: string,
): Promise<void> {
  const res = await fetch(
    `${API_URL}/api/networks/${networkId}/packs/${packId}/bindings/${serverKeyId}`,
    { method: "POST", credentials: "include" },
  );
  if (!res.ok) throw new Error(`bind failed: ${res.status}`);
}

export async function unbindPack(
  networkId: string,
  packId: string,
  serverKeyId: string,
): Promise<void> {
  const res = await fetch(
    `${API_URL}/api/networks/${networkId}/packs/${packId}/bindings/${serverKeyId}`,
    { method: "DELETE", credentials: "include" },
  );
  if (!res.ok) throw new Error(`unbind failed: ${res.status}`);
}
```

- [ ] **Step 4 : Run — expect PASS**

```bash
cd editor && npx vitest run src/lib/api/networks.test.ts
```

- [ ] **Step 5 : Commit**

```bash
git add editor/src/lib/api/networks.ts editor/src/lib/api/networks.test.ts
git commit -m "feat(editor): API client for /api/networks/*"
```

---

### Task E2 : `lib/api/userPacks.ts` — logged-in pack edit client

**Files:**
- Create: `editor/src/lib/api/userPacks.ts`
- Test: `editor/src/lib/api/userPacks.test.ts`

- [ ] **Step 1 : Test**

```ts
// editor/src/lib/api/userPacks.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { loadUserPack, saveUserPack } from "./userPacks";

describe("userPacks API client", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("loadUserPack GET /api/user/packs/:packId returns content", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({
      pack: { id: "p1", hash: "h1" },
      files: { "a.yaml": "x" },
      editor: { id: "p1", menus: [] },
    }), { status: 200 }));
    const res = await loadUserPack("p1");
    expect(res.pack.id).toBe("p1");
    expect(res.files["a.yaml"]).toBe("x");
  });

  it("saveUserPack PUT /api/user/packs/:packId sends body", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await saveUserPack("p1", { hash: "h2", files: { "a": "y" }, editor: { id: "p1", menus: [] } });
    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toContain("/api/user/packs/p1");
    expect(call[1].method).toBe("PUT");
    expect(JSON.parse(call[1].body as string).hash).toBe("h2");
  });
});
```

- [ ] **Step 2 : Run — expect FAIL**

- [ ] **Step 3 : Implement**

```ts
// editor/src/lib/api/userPacks.ts
const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

export interface UserPackLoadResult {
  pack: { id: string; name: string; hash: string };
  files: Record<string, string>;
  editor: unknown;
}

export async function loadUserPack(packId: string): Promise<UserPackLoadResult> {
  const res = await fetch(`${API_URL}/api/user/packs/${packId}`, { credentials: "include" });
  if (!res.ok) throw new Error(`loadUserPack failed: ${res.status}`);
  return res.json();
}

export async function saveUserPack(
  packId: string,
  body: { hash: string; files: Record<string, string>; editor: unknown },
): Promise<void> {
  const res = await fetch(`${API_URL}/api/user/packs/${packId}`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`saveUserPack failed: ${res.status}`);
}
```

- [ ] **Step 4 : Run — expect PASS**

- [ ] **Step 5 : Commit**

```bash
git add editor/src/lib/api/userPacks.ts editor/src/lib/api/userPacks.test.ts
git commit -m "feat(editor): API client for /api/user/packs/*"
```

---

### Task E3 : `networksStore` — Zustand store

**Files:**
- Create: `editor/src/state/networksStore.ts`
- Test: `editor/src/state/networksStore.test.ts`

- [ ] **Step 1 : Test**

```ts
// editor/src/state/networksStore.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { useNetworksStore } from "./networksStore";

describe("networksStore", () => {
  beforeEach(() => { useNetworksStore.getState().reset(); });

  it("setNetworks replaces the list", () => {
    useNetworksStore.getState().setNetworks([{ id: "n1", name: "N1", tier: "free" }]);
    expect(useNetworksStore.getState().networks).toHaveLength(1);
  });

  it("upsertNetwork adds or replaces a network", () => {
    useNetworksStore.getState().setNetworks([{ id: "n1", name: "N1", tier: "free" }]);
    useNetworksStore.getState().upsertNetwork({ id: "n1", name: "N1-renamed", tier: "free" });
    expect(useNetworksStore.getState().networks[0].name).toBe("N1-renamed");
    useNetworksStore.getState().upsertNetwork({ id: "n2", name: "N2", tier: "free" });
    expect(useNetworksStore.getState().networks).toHaveLength(2);
  });

  it("reset empties the store", () => {
    useNetworksStore.getState().setNetworks([{ id: "n1", name: "N1", tier: "free" }]);
    useNetworksStore.getState().reset();
    expect(useNetworksStore.getState().networks).toHaveLength(0);
  });
});
```

- [ ] **Step 2 : Run — expect FAIL**

- [ ] **Step 3 : Implement**

```ts
// editor/src/state/networksStore.ts
import { create } from "zustand";
import type { NetworkSummary } from "@/lib/api/networks";

interface NetworksState {
  networks: NetworkSummary[];
  setNetworks: (n: NetworkSummary[]) => void;
  upsertNetwork: (n: NetworkSummary) => void;
  reset: () => void;
}

export const useNetworksStore = create<NetworksState>((set) => ({
  networks: [],
  setNetworks: (networks) => set({ networks }),
  upsertNetwork: (n) => set((state) => {
    const idx = state.networks.findIndex((x) => x.id === n.id);
    if (idx === -1) return { networks: [...state.networks, n] };
    const next = [...state.networks];
    next[idx] = n;
    return { networks: next };
  }),
  reset: () => set({ networks: [] }),
}));
```

- [ ] **Step 4 : Run — expect PASS**

- [ ] **Step 5 : Commit**

```bash
git add editor/src/state/networksStore.ts editor/src/state/networksStore.test.ts
git commit -m "feat(editor): networksStore (Zustand)"
```

---

## Section F — Editor: Routes /networks + /networks/$id

### Task F1 : Route `/networks` (list user's networks)

**Files:**
- Create: `editor/src/routes/networks.tsx`
- Test: `editor/src/routes/networks.test.tsx`

- [ ] **Step 1 : Test**

```tsx
// editor/src/routes/networks.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { NetworksPage } from "./networks";
import { useNetworksStore } from "@/state/networksStore";
import * as networksApi from "@/lib/api/networks";

vi.mock("@/state/authStore", () => ({
  useAuthStore: (sel: (s: { currentUser: { id: string; name: string } | null }) => unknown) =>
    sel({ currentUser: { id: "u1", name: "Iban" } }),
}));

describe("NetworksPage", () => {
  beforeEach(() => {
    useNetworksStore.getState().reset();
    vi.restoreAllMocks();
  });

  it("fetches and displays the user's networks", async () => {
    vi.spyOn(networksApi, "listNetworks").mockResolvedValue([
      { id: "n1", name: "Survival Network", tier: "free" },
      { id: "n2", name: "Creative Network", tier: "free" },
    ]);
    render(<NetworksPage />);
    await waitFor(() => expect(screen.getByText("Survival Network")).toBeTruthy());
    expect(screen.getByText("Creative Network")).toBeTruthy();
  });

  it("shows empty state with 'Create your first network' CTA", async () => {
    vi.spyOn(networksApi, "listNetworks").mockResolvedValue([]);
    render(<NetworksPage />);
    await waitFor(() => expect(screen.getByText(/no networks yet/i)).toBeTruthy());
  });
});
```

- [ ] **Step 2 : Run — expect FAIL**

- [ ] **Step 3 : Implement**

```tsx
// editor/src/routes/networks.tsx
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { useNetworksStore } from "@/state/networksStore";
import { listNetworks } from "@/lib/api/networks";

export const Route = createFileRoute("/networks")({ component: NetworksPage });

export function NetworksPage() {
  const networks = useNetworksStore((s) => s.networks);
  const setNetworks = useNetworksStore((s) => s.setNetworks);

  useEffect(() => {
    listNetworks().then(setNetworks).catch(console.error);
  }, [setNetworks]);

  return (
    <div className="min-h-screen p-8">
      <h1 className="text-xl font-semibold mb-4">Your Networks</h1>
      {networks.length === 0 ? (
        <div className="text-muted-foreground">
          No networks yet. <Link to="/setup" className="underline">Create your first network</Link>.
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {networks.map((n) => (
            <li key={n.id}>
              <Link to="/networks/$networkId" params={{ networkId: n.id }} className="block p-3 border rounded hover:bg-muted">
                <div className="font-medium">{n.name}</div>
                <div className="text-xs text-muted-foreground">Tier: {n.tier}</div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Link to="/setup" className="mt-4 inline-block underline">+ New network / server</Link>
    </div>
  );
}
```

- [ ] **Step 4 : Run — expect PASS**

- [ ] **Step 5 : Commit**

```bash
git add editor/src/routes/networks.tsx editor/src/routes/networks.test.tsx
git commit -m "feat(editor): route /networks (list)"
```

---

### Task F2 : Route `/networks/$networkId` (detail)

**Files:**
- Create: `editor/src/routes/networks.$networkId.tsx`
- Test: `editor/src/routes/networks.$networkId.test.tsx`

- [ ] **Step 1 : Test**

```tsx
// editor/src/routes/networks.$networkId.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { NetworkDetailPage } from "./networks.$networkId";
import * as networksApi from "@/lib/api/networks";

vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return { ...actual, useParams: () => ({ networkId: "n1" }) };
});

describe("NetworkDetailPage", () => {
  it("renders the network detail with packs + serverKeys", async () => {
    vi.spyOn(networksApi, "getNetwork").mockResolvedValue({
      network: { id: "n1", name: "N1", tier: "free" },
      packs: [{ id: "p1", name: "shop", hash: "h" }],
      serverKeys: [{ id: "sk_1", label: "test-server" }],
    });
    render(<NetworkDetailPage />);
    await waitFor(() => expect(screen.getByText("N1")).toBeTruthy());
    expect(screen.getByText("shop")).toBeTruthy();
    expect(screen.getByText("test-server")).toBeTruthy();
  });
});
```

- [ ] **Step 2 : Run — expect FAIL**

- [ ] **Step 3 : Implement**

```tsx
// editor/src/routes/networks.$networkId.tsx
import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getNetwork } from "@/lib/api/networks";

export const Route = createFileRoute("/networks/$networkId")({ component: NetworkDetailPage });

export function NetworkDetailPage() {
  const { networkId } = useParams({ strict: false }) as { networkId: string };
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof getNetwork>> | null>(null);

  useEffect(() => {
    if (!networkId) return;
    getNetwork(networkId).then(setDetail).catch(console.error);
  }, [networkId]);

  if (!detail) return <div className="p-8">Loading…</div>;

  return (
    <div className="min-h-screen p-8 flex flex-col gap-6">
      <h1 className="text-xl font-semibold">{detail.network.name}</h1>

      <section>
        <h2 className="text-sm uppercase tracking-wider text-muted-foreground mb-2">Packs</h2>
        {detail.packs.length === 0 ? (
          <div className="text-muted-foreground">No packs yet.</div>
        ) : (
          <ul className="flex flex-col gap-2">
            {detail.packs.map((p) => (
              <li key={p.id}>
                <Link to="/pack/$packId" params={{ packId: p.id }} className="block p-2 border rounded hover:bg-muted">
                  {p.name}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-sm uppercase tracking-wider text-muted-foreground mb-2">Server keys</h2>
        {detail.serverKeys.length === 0 ? (
          <div className="text-muted-foreground">No server keys yet.</div>
        ) : (
          <ul className="flex flex-col gap-2">
            {detail.serverKeys.map((sk) => (
              <li key={sk.id} className="p-2 border rounded">
                <div className="font-mono text-xs">{sk.id}</div>
                <div className="text-xs text-muted-foreground">{sk.label ?? "(no label)"}</div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 4 : Run — expect PASS**

- [ ] **Step 5 : Commit**

```bash
git add editor/src/routes/networks.\$networkId.tsx editor/src/routes/networks.\$networkId.test.tsx
git commit -m "feat(editor): route /networks/:networkId (detail)"
```

---

## Section G — Editor: Setup wizard

### Task G1 : `SetupWizard` shell + state machine

**Files:**
- Create: `editor/src/features/setup/SetupWizard.tsx`
- Test: `editor/src/features/setup/SetupWizard.test.tsx`

- [ ] **Step 1 : Test**

```tsx
// editor/src/features/setup/SetupWizard.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SetupWizard } from "./SetupWizard";

vi.mock("@/state/authStore", () => ({
  useAuthStore: (sel: (s: { currentUser: { id: string; name: string } | null }) => unknown) =>
    sel({ currentUser: { id: "u1", name: "Iban" } }),
}));

describe("SetupWizard", () => {
  it("starts on step 1 (network)", () => {
    render(<SetupWizard />);
    expect(screen.getByText(/step 1/i)).toBeTruthy();
    expect(screen.getByText(/network/i)).toBeTruthy();
  });

  it("disables next when network not chosen", () => {
    render(<SetupWizard />);
    const next = screen.getByRole("button", { name: /next/i }) as HTMLButtonElement;
    expect(next.disabled).toBe(true);
  });
});
```

- [ ] **Step 2 : Run — expect FAIL**

- [ ] **Step 3 : Implement (shell only — steps come next)**

```tsx
// editor/src/features/setup/SetupWizard.tsx
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Step1Network } from "./SetupWizardSteps/Step1Network";

type Step = 1 | 2 | 3 | 4;

export interface WizardState {
  networkId: string | null;
  packId: string | null;
  serverKey: string | null;
  serverKeyId: string | null;
}

export function SetupWizard() {
  const [step, setStep] = useState<Step>(1);
  const [state, setState] = useState<WizardState>({
    networkId: null, packId: null, serverKey: null, serverKeyId: null,
  });

  const canNext = (() => {
    if (step === 1) return state.networkId !== null;
    if (step === 2) return state.packId !== null;
    if (step === 3) return state.serverKeyId !== null;
    return false;  // step 4 is terminal
  })();

  return (
    <div className="min-h-screen p-8 max-w-xl mx-auto flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Setup — Step {step} of 4</h1>
      <div className="text-sm text-muted-foreground">
        {step === 1 && "Pick or create a Network"}
        {step === 2 && "Pick or create a Pack"}
        {step === 3 && "Generate a Server Key"}
        {step === 4 && "Install the plugin"}
      </div>

      {step === 1 && <Step1Network state={state} setState={setState} />}
      {/* Steps 2-4 added in G2-G4 */}

      <div className="flex justify-between">
        <Button variant="outline" disabled={step === 1} onClick={() => setStep((step - 1) as Step)}>Back</Button>
        <Button disabled={!canNext} onClick={() => setStep((step + 1) as Step)}>Next</Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4 : Create stub `Step1Network`** (will be filled in G2)

```tsx
// editor/src/features/setup/SetupWizardSteps/Step1Network.tsx
import type { WizardState } from "../SetupWizard";

interface Props {
  state: WizardState;
  setState: React.Dispatch<React.SetStateAction<WizardState>>;
}

export function Step1Network(_props: Props) {
  return <div>Network step (G2 will fill this in)</div>;
}
```

- [ ] **Step 5 : Run — expect PASS** (shell test only checks heading + disabled Next)

- [ ] **Step 6 : Commit**

```bash
git add editor/src/features/setup
git commit -m "feat(editor): SetupWizard shell + state machine"
```

---

### Task G2 : Step 1 — pick or create Network

**Files:**
- Modify: `editor/src/features/setup/SetupWizardSteps/Step1Network.tsx`
- Test: `editor/src/features/setup/SetupWizardSteps/Step1Network.test.tsx`

- [ ] **Step 1 : Test**

```tsx
// editor/src/features/setup/SetupWizardSteps/Step1Network.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Step1Network } from "./Step1Network";
import * as networksApi from "@/lib/api/networks";

describe("Step1Network", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("lists existing networks and lets user pick one", async () => {
    vi.spyOn(networksApi, "listNetworks").mockResolvedValue([
      { id: "n1", name: "N1", tier: "free" },
    ]);
    const setState = vi.fn();
    render(<Step1Network state={{ networkId: null, packId: null, serverKey: null, serverKeyId: null }} setState={setState} />);
    await waitFor(() => expect(screen.getByText("N1")).toBeTruthy());
    fireEvent.click(screen.getByText("N1"));
    expect(setState).toHaveBeenCalled();
  });

  it("create form posts new network and updates state", async () => {
    vi.spyOn(networksApi, "listNetworks").mockResolvedValue([]);
    const createSpy = vi.spyOn(networksApi, "createNetwork").mockResolvedValue({ id: "n_new", name: "X", tier: "free" });
    const setState = vi.fn();
    render(<Step1Network state={{ networkId: null, packId: null, serverKey: null, serverKeyId: null }} setState={setState} />);
    await waitFor(() => expect(screen.getByPlaceholderText(/network name/i)).toBeTruthy());
    fireEvent.change(screen.getByPlaceholderText(/network name/i), { target: { value: "X" } });
    fireEvent.click(screen.getByRole("button", { name: /create/i }));
    await waitFor(() => expect(createSpy).toHaveBeenCalledWith("X"));
  });
});
```

- [ ] **Step 2 : Run — expect FAIL**

- [ ] **Step 3 : Implement**

```tsx
// editor/src/features/setup/SetupWizardSteps/Step1Network.tsx
import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { listNetworks, createNetwork, type NetworkSummary } from "@/lib/api/networks";
import type { WizardState } from "../SetupWizard";

interface Props {
  state: WizardState;
  setState: React.Dispatch<React.SetStateAction<WizardState>>;
}

export function Step1Network({ state, setState }: Props) {
  const [networks, setNetworks] = useState<NetworkSummary[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { listNetworks().then(setNetworks).catch(console.error); }, []);

  const onPick = (n: NetworkSummary) => setState((s) => ({ ...s, networkId: n.id }));

  const onCreate = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const n = await createNetwork(name.trim());
      setNetworks((prev) => [...prev, n]);
      setState((s) => ({ ...s, networkId: n.id }));
      setName("");
    } finally { setBusy(false); }
  };

  return (
    <div className="flex flex-col gap-4">
      {networks.length > 0 && (
        <div>
          <div className="text-xs text-muted-foreground mb-2">Or pick existing:</div>
          <ul className="flex flex-col gap-1">
            {networks.map((n) => (
              <li key={n.id}>
                <button type="button"
                  className={`block w-full text-left p-2 border rounded hover:bg-muted ${state.networkId === n.id ? "border-emerald-500" : ""}`}
                  onClick={() => onPick(n)}>
                  {n.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex gap-2">
        <Input placeholder="New network name" value={name} onChange={(e) => setName(e.target.value)} />
        <Button onClick={onCreate} disabled={busy || !name.trim()}>Create</Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4 : Run — expect PASS**

- [ ] **Step 5 : Commit**

```bash
git add editor/src/features/setup/SetupWizardSteps/Step1Network.tsx editor/src/features/setup/SetupWizardSteps/Step1Network.test.tsx
git commit -m "feat(editor): SetupWizard Step1 (pick or create Network)"
```

---

### Task G3 : Step 2 — pick or create Pack

**Files:**
- Create: `editor/src/features/setup/SetupWizardSteps/Step2Pack.tsx`
- Test: `editor/src/features/setup/SetupWizardSteps/Step2Pack.test.tsx`
- Modify: `editor/src/features/setup/SetupWizard.tsx` (mount Step2)

- [ ] **Step 1 : Test**

```tsx
// editor/src/features/setup/SetupWizardSteps/Step2Pack.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Step2Pack } from "./Step2Pack";
import * as networksApi from "@/lib/api/networks";

describe("Step2Pack", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("lists existing packs in selected network", async () => {
    vi.spyOn(networksApi, "getNetwork").mockResolvedValue({
      network: { id: "n1", name: "N", tier: "free" },
      packs: [{ id: "p1", name: "shop", hash: "h" }],
      serverKeys: [],
    });
    const setState = vi.fn();
    render(<Step2Pack state={{ networkId: "n1", packId: null, serverKey: null, serverKeyId: null }} setState={setState} />);
    await waitFor(() => expect(screen.getByText("shop")).toBeTruthy());
    fireEvent.click(screen.getByText("shop"));
    expect(setState).toHaveBeenCalled();
  });

  it("create form posts new pack", async () => {
    vi.spyOn(networksApi, "getNetwork").mockResolvedValue({
      network: { id: "n1", name: "N", tier: "free" }, packs: [], serverKeys: [],
    });
    const createSpy = vi.spyOn(networksApi, "createPack").mockResolvedValue({ id: "p_new", name: "x", hash: "" });
    const setState = vi.fn();
    render(<Step2Pack state={{ networkId: "n1", packId: null, serverKey: null, serverKeyId: null }} setState={setState} />);
    await waitFor(() => expect(screen.getByPlaceholderText(/new pack name/i)).toBeTruthy());
    fireEvent.change(screen.getByPlaceholderText(/new pack name/i), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: /create/i }));
    await waitFor(() => expect(createSpy).toHaveBeenCalledWith("n1", "x"));
  });
});
```

- [ ] **Step 2 : Run — expect FAIL**

- [ ] **Step 3 : Implement**

```tsx
// editor/src/features/setup/SetupWizardSteps/Step2Pack.tsx
import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { getNetwork, createPack, type PackSummary } from "@/lib/api/networks";
import type { WizardState } from "../SetupWizard";

interface Props {
  state: WizardState;
  setState: React.Dispatch<React.SetStateAction<WizardState>>;
}

export function Step2Pack({ state, setState }: Props) {
  const [packs, setPacks] = useState<PackSummary[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!state.networkId) return;
    getNetwork(state.networkId).then((d) => setPacks(d.packs)).catch(console.error);
  }, [state.networkId]);

  const onPick = (p: PackSummary) => setState((s) => ({ ...s, packId: p.id }));
  const onCreate = async () => {
    if (!state.networkId || !name.trim()) return;
    setBusy(true);
    try {
      const p = await createPack(state.networkId, name.trim());
      setPacks((prev) => [...prev, p]);
      setState((s) => ({ ...s, packId: p.id }));
      setName("");
    } finally { setBusy(false); }
  };

  return (
    <div className="flex flex-col gap-4">
      {packs.length > 0 && (
        <ul className="flex flex-col gap-1">
          {packs.map((p) => (
            <li key={p.id}>
              <button type="button"
                className={`block w-full text-left p-2 border rounded hover:bg-muted ${state.packId === p.id ? "border-emerald-500" : ""}`}
                onClick={() => onPick(p)}>
                {p.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <Input placeholder="New pack name" value={name} onChange={(e) => setName(e.target.value)} />
        <Button onClick={onCreate} disabled={busy || !name.trim()}>Create</Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4 : Mount in `SetupWizard.tsx`**

Inside the JSX block, after `{step === 1 && <Step1Network ... />}` add:

```tsx
{step === 2 && <Step2Pack state={state} setState={setState} />}
```

And add the import: `import { Step2Pack } from "./SetupWizardSteps/Step2Pack";`

- [ ] **Step 5 : Run — expect PASS**

- [ ] **Step 6 : Commit**

```bash
git add editor/src/features/setup/SetupWizardSteps/Step2Pack.tsx editor/src/features/setup/SetupWizardSteps/Step2Pack.test.tsx editor/src/features/setup/SetupWizard.tsx
git commit -m "feat(editor): SetupWizard Step2 (pick or create Pack)"
```

---

### Task G4 : Step 3 — generate server_key + bind to pack

**Files:**
- Create: `editor/src/features/setup/SetupWizardSteps/Step3ServerKey.tsx`
- Test: `editor/src/features/setup/SetupWizardSteps/Step3ServerKey.test.tsx`
- Modify: `editor/src/features/setup/SetupWizard.tsx`

- [ ] **Step 1 : Test**

```tsx
// editor/src/features/setup/SetupWizardSteps/Step3ServerKey.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Step3ServerKey } from "./Step3ServerKey";
import * as networksApi from "@/lib/api/networks";

describe("Step3ServerKey", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("generates a server_key and binds it to the pack", async () => {
    const createKey = vi.spyOn(networksApi, "createServerKey").mockResolvedValue({ id: "sk_new", key: "sk_abc123", label: null });
    const bind = vi.spyOn(networksApi, "bindPackToServerKey").mockResolvedValue();
    const setState = vi.fn();
    render(<Step3ServerKey state={{ networkId: "n1", packId: "p1", serverKey: null, serverKeyId: null }} setState={setState} />);
    fireEvent.click(screen.getByRole("button", { name: /generate/i }));
    await waitFor(() => expect(createKey).toHaveBeenCalled());
    await waitFor(() => expect(bind).toHaveBeenCalledWith("n1", "p1", "sk_new"));
  });
});
```

- [ ] **Step 2 : Run — expect FAIL**

- [ ] **Step 3 : Implement**

```tsx
// editor/src/features/setup/SetupWizardSteps/Step3ServerKey.tsx
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { createServerKey, bindPackToServerKey } from "@/lib/api/networks";
import type { WizardState } from "../SetupWizard";

interface Props {
  state: WizardState;
  setState: React.Dispatch<React.SetStateAction<WizardState>>;
}

export function Step3ServerKey({ state, setState }: Props) {
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onGenerate = async () => {
    if (!state.networkId || !state.packId) return;
    setBusy(true);
    setError(null);
    try {
      const sk = await createServerKey(state.networkId, label || undefined);
      await bindPackToServerKey(state.networkId, state.packId, sk.id);
      setState((s) => ({ ...s, serverKey: sk.key, serverKeyId: sk.id }));
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(false); }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="text-sm">A fresh server key will be generated and bound to your pack. Save it — you'll only see it once.</div>
      <Input placeholder="Label (optional)" value={label} onChange={(e) => setLabel(e.target.value)} />
      <Button onClick={onGenerate} disabled={busy || state.serverKey !== null}>
        {state.serverKey ? "Generated ✓" : "Generate server key"}
      </Button>
      {error && <div className="text-red-500 text-sm">{error}</div>}
      {state.serverKey && (
        <div className="font-mono text-xs p-2 bg-muted border rounded break-all">{state.serverKey}</div>
      )}
    </div>
  );
}
```

- [ ] **Step 4 : Mount in `SetupWizard.tsx`** : `{step === 3 && <Step3ServerKey ... />}` + import.

- [ ] **Step 5 : Run — expect PASS**

- [ ] **Step 6 : Commit**

```bash
git add editor/src/features/setup/SetupWizardSteps/Step3ServerKey.tsx editor/src/features/setup/SetupWizardSteps/Step3ServerKey.test.tsx editor/src/features/setup/SetupWizard.tsx
git commit -m "feat(editor): SetupWizard Step3 (generate + bind server_key)"
```

---

### Task G5 : Step 4 — install instructions + finish

**Files:**
- Create: `editor/src/features/setup/SetupWizardSteps/Step4Install.tsx`
- Test: `editor/src/features/setup/SetupWizardSteps/Step4Install.test.tsx`
- Modify: `editor/src/features/setup/SetupWizard.tsx`

- [ ] **Step 1 : Test**

```tsx
// editor/src/features/setup/SetupWizardSteps/Step4Install.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Step4Install } from "./Step4Install";

describe("Step4Install", () => {
  it("displays the server_key and config snippet", () => {
    render(<Step4Install state={{
      networkId: "n1", packId: "p1", serverKey: "sk_abc123", serverKeyId: "sk_id",
    }} setState={() => {}} />);
    expect(screen.getByText(/sk_abc123/)).toBeTruthy();
    expect(screen.getByText(/server_key:/)).toBeTruthy();
    expect(screen.getByText(/ws_url:/)).toBeTruthy();
  });

  it("shows '/artisan reload' instruction", () => {
    render(<Step4Install state={{
      networkId: "n1", packId: "p1", serverKey: "sk_abc", serverKeyId: "id",
    }} setState={() => {}} />);
    expect(screen.getByText(/artisan reload/)).toBeTruthy();
  });
});
```

- [ ] **Step 2 : Run — expect FAIL**

- [ ] **Step 3 : Implement**

```tsx
// editor/src/features/setup/SetupWizardSteps/Step4Install.tsx
import type { WizardState } from "../SetupWizard";

interface Props {
  state: WizardState;
  setState: React.Dispatch<React.SetStateAction<WizardState>>;
}

const WS_URL = import.meta.env.VITE_PLUGIN_WS_URL ?? "wss://editor.artisanmc.net/ws/plugin";

export function Step4Install({ state }: Props) {
  if (!state.serverKey) return <div>No server key generated.</div>;
  const snippet = `server_key: "${state.serverKey}"\nws_url: "${WS_URL}"`;
  return (
    <div className="flex flex-col gap-4">
      <div className="text-sm">Add the following to your <code>plugins/Artisan/config.yml</code>:</div>
      <pre className="bg-muted p-3 rounded text-xs font-mono whitespace-pre-wrap break-all">{snippet}</pre>
      <div className="text-sm">Then, in your MC server console: <code>/artisan reload</code></div>
      <div className="text-xs text-muted-foreground">The server will connect to the backend and start syncing your pack.</div>
    </div>
  );
}
```

- [ ] **Step 4 : Mount in `SetupWizard.tsx`** : `{step === 4 && <Step4Install ... />}` + import. Adjust `canNext` so step 4 hides Next button or shows "Finish" → navigate to `/networks`.

- [ ] **Step 5 : Run — expect PASS**

- [ ] **Step 6 : Commit**

```bash
git add editor/src/features/setup/SetupWizardSteps/Step4Install.tsx editor/src/features/setup/SetupWizardSteps/Step4Install.test.tsx editor/src/features/setup/SetupWizard.tsx
git commit -m "feat(editor): SetupWizard Step4 (install instructions)"
```

---

### Task G6 : Route `/setup`

**Files:**
- Create: `editor/src/routes/setup.tsx`

- [ ] **Step 1 : Implement**

```tsx
// editor/src/routes/setup.tsx
import { createFileRoute, redirect } from "@tanstack/react-router";
import { SetupWizard } from "@/features/setup/SetupWizard";
import { useAuthStore } from "@/state/authStore";

export const Route = createFileRoute("/setup")({
  beforeLoad: () => {
    const user = useAuthStore.getState().currentUser;
    if (!user) throw redirect({ to: "/login" });
  },
  component: SetupPage,
});

function SetupPage() {
  return <SetupWizard />;
}
```

- [ ] **Step 2 : Manual smoke test**

```bash
cd editor && npm run dev
```

Open `http://localhost:5173/setup`. If not logged in → redirects to `/login`. If logged in → wizard appears.

- [ ] **Step 3 : Commit**

```bash
git add editor/src/routes/setup.tsx
git commit -m "feat(editor): route /setup (auth-gated wizard entry)"
```

---

## Section H — Editor: Account page expansion

### Task H1 : Account page lists user's Networks

**Files:**
- Modify: `editor/src/routes/account.tsx`
- Test: `editor/src/routes/account.test.tsx` (create if doesn't exist)

- [ ] **Step 1 : Test**

```tsx
// editor/src/routes/account.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { AccountPage } from "./account";
import * as networksApi from "@/lib/api/networks";

vi.mock("@/state/authStore", () => ({
  useAuthStore: (sel: (s: { currentUser: { id: string; name: string; email: string } | null }) => unknown) =>
    sel({ currentUser: { id: "u1", name: "Iban", email: "i@a.b" } }),
}));

describe("AccountPage", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("displays user info + user's networks", async () => {
    vi.spyOn(networksApi, "listNetworks").mockResolvedValue([
      { id: "n1", name: "Survival", tier: "free" },
    ]);
    render(<AccountPage />);
    expect(screen.getByText(/Iban/)).toBeTruthy();
    await waitFor(() => expect(screen.getByText("Survival")).toBeTruthy());
  });

  it("shows setup CTA when no networks", async () => {
    vi.spyOn(networksApi, "listNetworks").mockResolvedValue([]);
    render(<AccountPage />);
    await waitFor(() => expect(screen.getByText(/set up your first server/i)).toBeTruthy());
  });
});
```

- [ ] **Step 2 : Run — expect FAIL**

- [ ] **Step 3 : Modify `account.tsx`**

```tsx
// editor/src/routes/account.tsx
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "@/state/authStore";
import { useNetworksStore } from "@/state/networksStore";
import { listNetworks } from "@/lib/api/networks";
import { LogoutButton } from "@/features/auth/LogoutButton";

export const Route = createFileRoute("/account")({ component: AccountPage });

export function AccountPage() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.currentUser);
  const networks = useNetworksStore((s) => s.networks);
  const setNetworks = useNetworksStore((s) => s.setNetworks);
  const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

  useEffect(() => {
    if (!user) return;
    listNetworks().then(setNetworks).catch(console.error);
  }, [user, setNetworks]);

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-8">
        <p>{t("auth.account.signedInAs")} ?</p>
        <Link to="/login" className="underline">{t("auth.loginSubmit")}</Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-8 max-w-2xl mx-auto flex flex-col gap-6">
      <h1 className="text-xl font-semibold">{t("auth.account.title")}</h1>
      <p className="text-muted-foreground">{t("auth.account.signedInAs")} <strong>{user.name}</strong> ({user.email})</p>

      <section>
        <h2 className="text-sm uppercase tracking-wider text-muted-foreground mb-2">Networks</h2>
        {networks.length === 0 ? (
          <Link to="/setup" className="underline">Set up your first server</Link>
        ) : (
          <ul className="flex flex-col gap-2">
            {networks.map((n) => (
              <li key={n.id}>
                <Link to="/networks/$networkId" params={{ networkId: n.id }} className="block p-2 border rounded hover:bg-muted">
                  {n.name}
                </Link>
              </li>
            ))}
          </ul>
        )}
        <Link to="/setup" className="mt-3 inline-block text-sm underline">+ Add another server</Link>
      </section>

      <LogoutButton apiUrl={apiUrl} />
    </div>
  );
}
```

- [ ] **Step 4 : Run — expect PASS**

- [ ] **Step 5 : Commit**

```bash
git add editor/src/routes/account.tsx editor/src/routes/account.test.tsx
git commit -m "feat(editor): /account lists user's Networks + setup CTA"
```

---

## Section I — Editor: Logged-in pack opening

### Task I1 : Pack route detects auth mode

**Files:**
- Modify: `editor/src/routes/pack.$packId.tsx`

Currently `pack.$packId.tsx` assumes a session token from `useSessionStore`. We need to support a second mode where the user is logged in (cookie-auth) and there's no session token.

Strategy: keep `useSessionStore.accessToken` for trust-dance flow. Add a fallback: if no session token AND user is logged in, use `loadUserPack(packId)` from `lib/api/userPacks`.

- [ ] **Step 1 : Read current `pack.$packId.tsx`** to identify the load + save points (the pack data is loaded via `loadPacks` and saved via `savePack`/`deployPack`).

- [ ] **Step 2 : Add `usePackLoader` hook that picks the right API**

```tsx
// editor/src/features/pack/usePackLoader.ts (NEW)
import { useEffect, useState } from "react";
import { useSessionStore } from "@/state/sessionStore";
import { useAuthStore } from "@/state/authStore";
import { loadPacks } from "@/lib/packApi";
import { loadUserPack } from "@/lib/api/userPacks";
import type { Pack } from "@/domain/types";

export function usePackLoader(packId: string) {
  const token = useSessionStore((s) => s.accessToken);
  const user = useAuthStore((s) => s.currentUser);
  const [pack, setPack] = useState<Pack | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"session" | "user" | null>(null);

  useEffect(() => {
    if (token) {
      // Trust-dance flow
      setMode("session");
      loadPacks(token).then((packs) => {
        const found = packs.find((p) => p.id === packId);
        if (found) setPack(found);
        else setError("Pack not bound to this session");
      }).catch((e) => setError((e as Error).message));
    } else if (user) {
      // Logged-in flow
      setMode("user");
      loadUserPack(packId).then((res) => {
        setPack({ id: res.pack.id, ...(res.editor as object) } as Pack);
      }).catch((e) => setError((e as Error).message));
    } else {
      setError("Not authenticated");
    }
  }, [packId, token, user]);

  return { pack, error, mode };
}
```

> Note : the existing `pack.$packId.tsx` has a complex load + save flow. This task adds a small abstraction layer. **Do not refactor the whole route in one go** — only inject the dual-mode load and save handlers.

- [ ] **Step 3 : Use the hook in `pack.$packId.tsx` (minimal edit)**

Find the line that loads the pack (currently uses `loadPacks(token)`). Replace with `const { pack, error, mode } = usePackLoader(packId);` and adapt downstream code accordingly. Keep all UI rendering identical.

- [ ] **Step 4 : Add a similar `usePackSaver` for the save flow** (mirroring loader pattern; routes to `savePack(token, ...)` or `saveUserPack(packId, ...)`).

```tsx
// editor/src/features/pack/usePackSaver.ts (NEW)
import { useSessionStore } from "@/state/sessionStore";
import { useAuthStore } from "@/state/authStore";
import { savePack } from "@/lib/packApi";
import { saveUserPack } from "@/lib/api/userPacks";
import type { Pack } from "@/domain/types";

export function usePackSaver() {
  const token = useSessionStore((s) => s.accessToken);
  const user = useAuthStore((s) => s.currentUser);

  return async function save(pack: Pack, files: Record<string, string>): Promise<void> {
    if (token) await savePack(token, pack, files);
    else if (user) await saveUserPack(pack.id, {
      hash: "",  // computed server-side
      files,
      editor: pack,
    });
    else throw new Error("Not authenticated");
  };
}
```

- [ ] **Step 5 : Inject `usePackSaver` in `pack.$packId.tsx`** — find the save call site, replace with the hook's `save()`.

- [ ] **Step 6 : Run editor tests**

```bash
cd editor && npx vitest run src/routes/pack.\$packId.test.tsx
```

Expected: tests pass (some may need fixture updates for the new hooks — mock the load/save APIs).

- [ ] **Step 7 : Commit**

```bash
git add editor/src/features/pack editor/src/routes/pack.\$packId.tsx
git commit -m "feat(editor): pack route supports user-auth (logged-in) mode"
```

---

## Section J — Editor: Retrait conflits UI

### Task J1 : Delete conflict files + cleanup imports

**Files:**
- Delete: `editor/src/features/sync/ConflictBanner.tsx` + `.test.tsx`
- Delete: `editor/src/features/sync/ConflictResolutionModal.tsx` + `.test.tsx`
- Delete: `editor/src/state/conflictsStore.ts` + `.test.ts`
- Delete: `editor/src/lib/api/conflicts.ts`
- Modify: `editor/src/routes/pack.$packId.tsx`
- Modify: `editor/src/state/wsStore.ts`
- Modify: `editor/src/i18n/locales/en.ts` + `fr.ts`

- [ ] **Step 1 : Delete files**

```bash
rm editor/src/features/sync/ConflictBanner.tsx editor/src/features/sync/ConflictBanner.test.tsx
rm editor/src/features/sync/ConflictResolutionModal.tsx editor/src/features/sync/ConflictResolutionModal.test.tsx
rm editor/src/state/conflictsStore.ts editor/src/state/conflictsStore.test.ts
rm editor/src/lib/api/conflicts.ts
```

- [ ] **Step 2 : Unmount `<ConflictBanner />` and `<ConflictResolutionModal />` from `pack.$packId.tsx`**

Find and remove the two JSX usages and their imports.

- [ ] **Step 3 : Remove conflict handlers from `wsStore.ts`**

Locate `if (msg.type === "pack_conflict_detected")` and `if (msg.type === "pack_conflict_resolved")` branches. Delete both. Also remove the conflicts API import and any code that calls into `conflictsStore`.

- [ ] **Step 4 : Remove i18n keys**

In `editor/src/i18n/locales/en.ts` and `fr.ts`, locate keys matching `sync.banner.*` and `sync.modal.*` and delete them. Keep `sync.deletePackDialog.*` if it's used by `DeletePackDialog` (we keep that component).

- [ ] **Step 5 : Run editor tests**

```bash
cd editor && npx vitest run
```

Expected: all green. Some tests may have referenced the deleted files — update them to remove those references.

- [ ] **Step 6 : Commit**

```bash
git add editor
git commit -m "refactor(editor): remove conflict UI (Plan 1C: backend-as-truth)"
```

---

## Section K — Plugin: backend-as-truth + /artisan pushLocal

### Task K1 : Remove `pack_divergence_detected` emission

**Files:**
- Modify: `plugin/src/main/kotlin/net/artisanmc/plugin/provider/SyncedMenuProvider.kt`
- Modify: `plugin/src/test/kotlin/net/artisanmc/plugin/ConflictDetectionTest.kt` (likely delete)

- [ ] **Step 1 : Read `SyncedMenuProvider.kt`** to locate the `pack_divergence_detected` emission (lines 278-289 per prior exploration, may have shifted).

- [ ] **Step 2 : Replace the emission with a WARN log**

Find the block that sends `pack_divergence_detected` on `SyncAction.LOCAL_ONLY` or `SyncAction.CONFLICT` and replace with:

```kotlin
// Plan 1C: backend = source of truth. Local divergence will be overwritten
// by the next bundle_available. We log a single WARN line for post-mortem
// tracing — no UI, no prompt, no delay. Admins who edited via FTP must use
// `/artisan pushLocal <pack_id>` to upload before reconnecting.
plugin.logger.warning(
    "[Artisan] Local pack '$packId' differs from backend (action=$action). " +
    "Backend version will overwrite local. Use /artisan pushLocal $packId if local edits were intentional."
)
```

- [ ] **Step 3 : Delete `ConflictDetectionTest.kt`** if it exclusively tests the now-removed emission. If it tests other detection logic that's still valid (e.g. `detectSyncAction` itself), keep those tests and delete only the emission-related ones.

```bash
# Inspect first; delete only if appropriate.
cat plugin/src/test/kotlin/net/artisanmc/plugin/ConflictDetectionTest.kt
```

- [ ] **Step 4 : Run plugin tests**

```bash
cd plugin && ./gradlew test
```

Expected: passes (with one fewer test class if deleted).

- [ ] **Step 5 : Commit**

```bash
git add plugin/src
git commit -m "refactor(plugin): drop pack_divergence_detected emission (Plan 1C: backend-as-truth)"
```

---

### Task K2 : Add `LocalPushSender` helper

**Files:**
- Create: `plugin/src/main/kotlin/net/artisanmc/plugin/sync/LocalPushSender.kt`
- Create: `plugin/src/test/kotlin/net/artisanmc/plugin/sync/LocalPushSenderTest.kt`

- [ ] **Step 1 : Test**

```kotlin
// plugin/src/test/kotlin/net/artisanmc/plugin/sync/LocalPushSenderTest.kt
package net.artisanmc.plugin.sync

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Files
import java.nio.file.Path

class LocalPushSenderTest {
    @Test
    fun `buildPushMessage reads all files under a pack dir`(@TempDir tmp: Path) {
        val packDir = tmp.resolve("p_test")
        Files.createDirectories(packDir.resolve("menus"))
        Files.writeString(packDir.resolve("manifest.yaml"), "schema: manifest/v1\n")
        Files.writeString(packDir.resolve("menus/shop.yaml"), "id: shop\n")

        val msg = LocalPushSender.buildPushMessage("p_test", packDir)
        assertEquals("local_push", msg["type"])
        assertEquals("p_test", msg["pack_id"])
        val files = msg["files"] as Map<String, String>
        assertEquals(2, files.size)
        assertTrue(files.containsKey("plugins/Artisan/packs/p_test/manifest.yaml"))
        assertTrue(files["plugins/Artisan/packs/p_test/manifest.yaml"]!!.contains("manifest/v1"))
        assertTrue((msg["hash"] as String).matches(Regex("[0-9a-f]{64}")))
    }
}
```

- [ ] **Step 2 : Run — expect FAIL**

```bash
cd plugin && ./gradlew test --tests net.artisanmc.plugin.sync.LocalPushSenderTest
```

- [ ] **Step 3 : Implement**

```kotlin
// plugin/src/main/kotlin/net/artisanmc/plugin/sync/LocalPushSender.kt
package net.artisanmc.plugin.sync

import java.nio.file.Files
import java.nio.file.Path
import java.security.MessageDigest
import kotlin.io.path.relativeTo
import kotlin.io.path.walk

object LocalPushSender {
    /**
     * Walks the pack dir and produces a `local_push` message body. The file paths
     * are normalized to `plugins/Artisan/packs/<packId>/<relative>` to match the
     * canonical form the backend stores.
     */
    @OptIn(kotlin.io.path.ExperimentalPathApi::class)
    fun buildPushMessage(packId: String, packDir: Path): Map<String, Any> {
        val files = mutableMapOf<String, String>()
        for (file in packDir.walk()) {
            if (!Files.isRegularFile(file)) continue
            val rel = file.relativeTo(packDir).toString().replace('\\', '/')
            if (rel.startsWith(".artisan")) continue   // skip sync metadata
            val key = "plugins/Artisan/packs/$packId/$rel"
            files[key] = Files.readString(file)
        }
        return mapOf(
            "type" to "local_push",
            "pack_id" to packId,
            "files" to files.toSortedMap(),
            "hash" to computeHash(files),
        )
    }

    private fun computeHash(files: Map<String, String>): String {
        // Match backend hashUtils.computeBundleHash: sort keys, concat path + content with newline.
        val sb = StringBuilder()
        for (key in files.keys.sorted()) {
            sb.append(key).append('\n').append(files[key]).append('\n')
        }
        val digest = MessageDigest.getInstance("SHA-256").digest(sb.toString().toByteArray())
        return digest.joinToString("") { "%02x".format(it) }
    }
}
```

- [ ] **Step 4 : Run — expect PASS**

- [ ] **Step 5 : Commit**

```bash
git add plugin/src/main/kotlin/net/artisanmc/plugin/sync/LocalPushSender.kt plugin/src/test/kotlin/net/artisanmc/plugin/sync/LocalPushSenderTest.kt
git commit -m "feat(plugin): LocalPushSender helper"
```

---

### Task K3 : `/artisan pushLocal` subcommand

**Files:**
- Modify: `plugin/src/main/kotlin/net/artisanmc/plugin/command/ArtisanCommand.kt`

- [ ] **Step 1 : Add `pushLocal` to the subcommand list and wire to handler**

```kotlin
// In ArtisanCommand.kt, find the subcommand dispatcher (likely a `when (args[0])` block)
"pushLocal" -> handlePushLocal(sender, args.drop(1))
```

And implement:

```kotlin
private fun handlePushLocal(sender: CommandSender, args: List<String>) {
    if (args.isEmpty()) {
        sender.sendMessage("Usage: /artisan pushLocal <pack_id|--all>")
        return
    }
    val target = args[0]
    val packsDir = plugin.dataFolder.toPath().resolve("packs")
    val packIds = if (target == "--all") {
        Files.list(packsDir).use { stream ->
            stream.filter { Files.isDirectory(it) && !it.fileName.toString().startsWith(".") }
                .map { it.fileName.toString() }
                .toList()
        }
    } else {
        listOf(target)
    }

    for (packId in packIds) {
        val dir = packsDir.resolve(packId)
        if (!Files.isDirectory(dir)) {
            sender.sendMessage("Pack '$packId' not found on disk; skipping.")
            continue
        }
        val msg = LocalPushSender.buildPushMessage(packId, dir)
        wsClient.send(msg)
        sender.sendMessage("Pushed pack '$packId' (hash=${msg["hash"]}).")
    }
}
```

> Note : `wsClient.send(msg)` assumes `ArtisanCommand` has access to the WS client. Check the actual structure; you may need to inject it via constructor or get it from `plugin`.

- [ ] **Step 2 : Manual integration check**

The full E2E test (plugin sends `local_push`, backend creates pack + binding + broadcast) needs a live Docker environment. Skip unit test here; the backend handler is unit-tested in Task D1.

- [ ] **Step 3 : Build plugin JAR**

```bash
cd plugin && ./gradlew shadowJar
```

Expected: builds without errors.

- [ ] **Step 4 : Commit**

```bash
git add plugin/src/main/kotlin/net/artisanmc/plugin/command/ArtisanCommand.kt
git commit -m "feat(plugin): /artisan pushLocal command (FTP scenario for backend-as-truth)"
```

---

## Section L — Wrap-up

### Task L1 : Full backend test sweep

- [ ] **Step 1 : Wipe DB + run**

```bash
cd backend
bun -e "import { db } from './src/db/index'; import { editorSessions, packBindings, packs, assets, serverKeys, networks, linkCodes, memberships, users, userSessions } from './src/db/schema'; await db.delete(packBindings); await db.delete(assets); await db.delete(packs); await db.delete(editorSessions); await db.delete(linkCodes); await db.delete(serverKeys); await db.delete(memberships); await db.delete(networks); await db.delete(userSessions); await db.delete(users); process.exit(0);"
bun test
```

Expected: all green.

- [ ] **Step 2 : Commit any test-fixture fixes**

```bash
git add backend
git commit -m "test(backend): fix residual fixtures for Plan 1C"
```

(Skip if no changes.)

---

### Task L2 : Full editor test sweep

- [ ] **Step 1 : Run**

```bash
cd editor && npx vitest run
```

Expected: all green.

- [ ] **Step 2 : Fix any residual issues + commit**

---

### Task L3 : Plugin test sweep

- [ ] **Step 1 : Run**

```bash
cd plugin && ./gradlew test
```

Expected: all green.

---

### Task L4 : Docker smoke test (manual)

- [ ] **Step 1 : Build plugin + deploy**

```bash
cd plugin && ./gradlew shadowJar
cp build/libs/artisan-plugin-1.0.0-SNAPSHOT-all.jar ../docker/server/plugins/ArtisanPlugin.jar
```

- [ ] **Step 2 : Restart stack**

```bash
cd .. && docker compose down && docker compose up -d --build
```

- [ ] **Step 3 : End-to-end flow**

1. Open editor http://localhost:5173/signup — create a user.
2. Click "Setup" → wizard.
3. Step 1 : create Network "Test Network".
4. Step 2 : create Pack "test-pack".
5. Step 3 : generate server key, copy plaintext.
6. Step 4 : copy snippet, paste into `docker/server/plugins/Artisan/config.yml` :
   ```yaml
   server_key: "<paste here>"
   ws_url: "ws://backend:3001/ws/plugin"
   ```
7. Restart MC: `docker compose restart minecraft`
8. From MC console: `/artisan reload`
9. Verify in editor `/networks/<networkId>` the pack appears with the server_key bound.

- [ ] **Step 4 : Test `/artisan pushLocal`**

1. Edit `docker/server/plugins/Artisan/packs/test-pack/manifest.yaml` directly on host.
2. From MC console: `/artisan pushLocal test-pack`
3. Verify backend received the change (curl `/api/user/packs/<packId>` while logged-in user is authenticated).

---

### Task L5 : Doc updates

**Files:**
- Modify: `Artisan/CLAUDE.md` — endpoints, commandes plugin, protocole WS
- Modify: `.claude/skills/sync-docs/doc-impact-map.yaml`

- [ ] **Step 1 : Update endpoint table in `CLAUDE.md`**

Add :
```
| `GET /api/networks` | Liste les Networks de l'utilisateur connecté. Requires cookie `artisan_user_session`. |
| `POST /api/networks` | Crée un Network + Membership owner. Body `{name}`. 201 ou 422. |
| `GET /api/networks/:id` | Détail (network + packs + serverKeys). 403 si pas membre. |
| `POST /api/networks/:id/server-keys` | Crée un server_key dans le Network. Body `{label?}`. Returns plaintext key. |
| `POST /api/networks/:id/packs` | Crée un pack. Body `{name, description?}`. |
| `POST /api/networks/:id/packs/:packId/bindings/:serverKeyId` | Bind pack ↔ server_key. |
| `DELETE /api/networks/:id/packs/:packId/bindings/:serverKeyId` | Unbind. 204. |
| `GET /api/user/packs/:packId` | Lecture pack (user-auth, membership check). |
| `PUT /api/user/packs/:packId` | Écriture pack (user-auth). Broadcast bundle_available. |
```

Remove rows for `/api/.../conflicts/*` and `/api/textures/asset-font/:assetId/:path*` only if changed (kept in 1B).

- [ ] **Step 2 : Update protocole WS table**

Remove `pack_conflict_detected` and `pack_conflict_resolved`. Remove `pack_divergence_detected` (or note it as "ignored by 1C+ backends"). Add `local_push`.

- [ ] **Step 3 : Update commandes plugin**

Add `pushLocal` to the ArtisanCommand table.

- [ ] **Step 4 : Update doc-impact-map.yaml**

Add paths : `backend/src/routes/userNetworks.ts`, `backend/src/routes/userPacks.ts`, `backend/src/lib/membershipGuard.ts`, `plugin/src/main/kotlin/.../sync/LocalPushSender.kt`.

- [ ] **Step 5 : Commit**

```bash
git add Artisan/CLAUDE.md .claude/skills/sync-docs/doc-impact-map.yaml
git commit -m "docs(plan-1c): endpoints + WS protocol + plugin commands + entities"
```

---

## Self-review checklist

**1. Spec coverage**
- ✅ Setup flow (Section G)
- ✅ Retrait UI conflits — backend (Section C) + editor (Section J) + plugin (Section K1)
- ✅ Backend = source of truth — auto-overwrite via existing bundle_available + WARN log (K1)
- ✅ /artisan pushLocal (K2, K3) + WS local_push (D1)
- ✅ Logged-in pack opening (Section I) + user-auth pack APIs (Section B)
- ✅ Network/Pack management REST (Section A)
- ✅ /account expansion (Section H)

**2. Placeholder scan**
- No "TBD", no "implement later", no "similar to Task N".
- Step 3 in some tasks references "find the line" — acceptable for refactor tasks where exact line numbers may shift.

**3. Type consistency**
- `getPack(packId)` used uniformly (from `packStorage`).
- `loadUserPack` vs `loadPacks` — distinct functions, distinct purposes. OK.
- `requireMember(userId, networkId, role?)` signature consistent in all uses.

**4. Function signature cross-task**
- `pushBundleAvailable(packId, hash)` (Plan 1B signature) is called from B2 user-write — confirmed.
- `LocalPushSender.buildPushMessage(packId, packDir)` returns Map — JSON-serializable. OK.
- `usePackLoader(packId)` returns `{ pack, error, mode }` — used by `pack.$packId.tsx`.

**5. Plan 1A/1B interactions**
- `users`, `user_sessions`, `discord_accounts` (1A) untouched.
- `networks`, `memberships`, `packs`, `pack_bindings`, `assets.packId` (1B) untouched.
- Only `pack_conflicts` (1B kept-temp) is dropped.

---

## Notes d'exécution

- **Order matters** : A → B → C → D → E → F → G → H → I → J → K → L. Some sections can be parallel (E/F are editor-only, no backend interactions ; K is plugin-only) but I/J depend on E + H.
- **Plugin code change requires rebuild** : Plan 1C requires `./gradlew shadowJar` to refresh the JAR in `docker/server/plugins/`.
- **DB shape change** : just drop `pack_conflicts`. No wipe, no data loss for users/networks/packs.
- **Commit convention** : `feat(backend|editor|plugin):` / `refactor(...):` / `test(...):` / `docs(plan-1c):` consistent with Plan 1A + 1B.
- **No `git push --force`** without explicit confirmation. Plan 1C lands via PR or fast-forward merge to main (same workflow as 1B).

**Fin du plan.**
