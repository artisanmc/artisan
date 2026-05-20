# Accounts Foundation (Phase 1A) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter des comptes utilisateurs natifs à Interfaze (signup, login email+password, login Discord OAuth, logout, page profil `/account`). Couche additive : rien du flow existant (trust dance, editor sessions, server_keys) n'est touché.

**Architecture:** Cookie HTTP-only `ifz_user_session` qui référence une row dans `user_sessions`. Mot de passe haché en argon2id via `Bun.password`. Discord OAuth2 standard (state cookie pour CSRF). Cookie de session utilisateur coexiste sans heurts avec les cookies éditeur existants (`ifz_refresh`).

**Tech Stack:** Backend = Bun + Hono + Drizzle (PostgreSQL) + bun:test ; Editor = React 19 + Vite + TanStack Router (file-based) + Zustand + Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-05-20-multi-server-networks-exploration.md` (Phase 1, section §8).

**Scope :**
- IN : tables `users` / `user_sessions` / `discord_accounts`, endpoints `POST /api/auth/signup|login|logout` + `GET /api/auth/me`, flow Discord OAuth, store auth éditeur, pages `/login` `/signup` `/account`, traductions, doc.
- OUT (autres plans) : `Network` entity, `Membership`, refactor `Pack`/`Assets`/`ServerKey`, setup flow modifié, retrait UI conflits, billing/Stripe, email verification, password reset, 2FA.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `backend/src/db/schema.ts` | Modify | Ajout tables `users`, `user_sessions`, `discord_accounts`. |
| `backend/src/lib/passwordHasher.ts` | Create | Wrapper minimal `hash(plain)` / `verify(plain, hash)` autour de `Bun.password`. |
| `backend/src/lib/passwordHasher.test.ts` | Create | Round-trip, rejet mauvais mot de passe, hash stable mais différent à chaque appel. |
| `backend/src/lib/sessionManager.ts` | Create | `createSession(userId)`, `findSession(id)`, `destroySession(id)`, `touchSession(id)`. |
| `backend/src/lib/sessionManager.test.ts` | Create | Création, lookup, expiration, touch, destroy. |
| `backend/src/middleware/userAuth.ts` | Create | Middleware Hono qui lit le cookie `ifz_user_session`, charge l'user et l'attache à `c.var.user`. |
| `backend/src/middleware/userAuth.test.ts` | Create | Cookie absent / expiré / valide. |
| `backend/src/lib/emailNormalizer.ts` | Create | Trim + lowercase email pour cohérence index. |
| `backend/src/lib/emailNormalizer.test.ts` | Create | Cas mixed case, trailing space, etc. |
| `backend/src/routes/auth.ts` | Create | `POST /signup`, `POST /login`, `POST /logout`, `GET /me`. |
| `backend/src/routes/auth.test.ts` | Create | Tests des 4 endpoints (happy + error paths). |
| `backend/src/lib/discordOauth.ts` | Create | `buildAuthorizeUrl(state)`, `exchangeCode(code)`, `fetchDiscordUser(accessToken)`. |
| `backend/src/lib/discordOauth.test.ts` | Create | Test `buildAuthorizeUrl` (state, scope, redirect). Le reste est integration manual (Discord API). |
| `backend/src/routes/discordOauth.ts` | Create | `GET /discord/start`, `GET /discord/callback`. |
| `backend/src/routes/discordOauth.test.ts` | Create | start redirige + set cookie state ; callback rejette state invalide ; callback heureux end-to-end avec mock fetch. |
| `backend/src/app.ts` | Modify | Wire `authRouter` et `discordOauthRouter` sur `/api/auth`. |
| `backend/.env.example` | Modify | Ajout `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_REDIRECT_URI`. |
| `editor/src/state/authStore.ts` | Create | Zustand store : `currentUser`, `isLoading`, `hydrate()`, `login()`, `signup()`, `logout()`. |
| `editor/src/state/authStore.test.ts` | Create | Tests des actions + hydrate. |
| `editor/src/lib/api/auth.ts` | Create | Clients fetch : `signup`, `login`, `logout`, `me`. |
| `editor/src/features/auth/LoginForm.tsx` | Create | Formulaire email/password + bouton Discord. |
| `editor/src/features/auth/LoginForm.test.tsx` | Create | Submit success/erreur 401/erreur réseau. |
| `editor/src/features/auth/SignupForm.tsx` | Create | Formulaire email/password/name avec validation client. |
| `editor/src/features/auth/SignupForm.test.tsx` | Create | Validation, submit success, 409 email pris. |
| `editor/src/features/auth/DiscordLoginButton.tsx` | Create | Bouton qui redirige vers `GET /api/auth/discord/start`. |
| `editor/src/features/auth/LogoutButton.tsx` | Create | Bouton qui appelle `logout()` puis redirige vers `/`. |
| `editor/src/routes/login.tsx` | Create | Route TanStack `/login` rendant `LoginForm`. |
| `editor/src/routes/signup.tsx` | Create | Route TanStack `/signup` rendant `SignupForm`. |
| `editor/src/routes/account.tsx` | Create | Route TanStack `/account` (page profil + bouton logout). |
| `editor/src/routes/__root.tsx` | Modify | Hydrate `authStore` au mount. |
| `editor/src/locales/en.ts` | Modify | Clés `auth.*`. |
| `editor/src/locales/fr.ts` | Modify | Idem. |
| `CLAUDE.md` | Modify | Section "Auth endpoints", nouvelles env vars `DISCORD_*`, mise à jour test counts. |

---

# Phase A — Schéma DB + helpers password/session

## Task 1: Ajouter les tables `users`, `user_sessions`, `discord_accounts` au schéma Drizzle

**Files:**
- Modify: `backend/src/db/schema.ts`

- [ ] **Step 1: Ajouter les tables en bas du fichier**

```ts
// Append à la fin de backend/src/db/schema.ts (après packConflicts) :

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  passwordHash: text("password_hash"),       // null = Discord-only users
  avatarUrl: text("avatar_url"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
}, (t) => [
  uniqueIndex("users_email_uniq").on(t.email),
]);

export const userSessions = pgTable("user_sessions", {
  id: text("id").primaryKey(),               // session token (random 32-char)
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull(),
  lastUsedAt: timestamp("last_used_at").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
}, (t) => [
  index("user_sessions_userid_idx").on(t.userId),
]);

export const discordAccounts = pgTable("discord_accounts", {
  discordUserId: text("discord_user_id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  username: text("username").notNull(),
  email: text("email"),
  linkedAt: timestamp("linked_at").notNull(),
}, (t) => [
  uniqueIndex("discord_accounts_userid_uniq").on(t.userId),
]);
```

- [ ] **Step 2: Pousser le schéma**

Run: `cd backend && bun run db:push`
Expected: création des 3 tables, aucun warning de destruction.

- [ ] **Step 3: Vérifier que rien d'autre n'est cassé**

Run: `cd backend && bun test`
Expected: tous les tests existants passent (~314).

- [ ] **Step 4: Commit**

```bash
git add backend/src/db/schema.ts
git commit -m "feat(backend): schéma users + user_sessions + discord_accounts"
```

---

## Task 2: passwordHasher — wrapper Bun.password

**Files:**
- Create: `backend/src/lib/passwordHasher.ts`
- Create: `backend/src/lib/passwordHasher.test.ts`

- [ ] **Step 1: Écrire les tests d'abord**

```ts
// backend/src/lib/passwordHasher.test.ts
import { describe, expect, test } from "bun:test";
import { hashPassword, verifyPassword } from "./passwordHasher";

describe("hashPassword", () => {
  test("returns non-empty string", async () => {
    const hash = await hashPassword("hunter2");
    expect(typeof hash).toBe("string");
    expect(hash.length).toBeGreaterThan(20);
  });

  test("two calls on same input produce different hashes (salt)", async () => {
    const h1 = await hashPassword("hunter2");
    const h2 = await hashPassword("hunter2");
    expect(h1).not.toBe(h2);
  });
});

describe("verifyPassword", () => {
  test("verifies the correct password", async () => {
    const hash = await hashPassword("hunter2");
    expect(await verifyPassword("hunter2", hash)).toBe(true);
  });

  test("rejects an incorrect password", async () => {
    const hash = await hashPassword("hunter2");
    expect(await verifyPassword("hunter3", hash)).toBe(false);
  });

  test("rejects on garbage hash without throwing", async () => {
    expect(await verifyPassword("hunter2", "not-a-hash")).toBe(false);
  });
});
```

- [ ] **Step 2: Run pour vérifier l'échec**

Run: `cd backend && bun test src/lib/passwordHasher.test.ts`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Implémenter**

```ts
// backend/src/lib/passwordHasher.ts
export async function hashPassword(plain: string): Promise<string> {
  return Bun.password.hash(plain, "argon2id");
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  try {
    return await Bun.password.verify(plain, hash);
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run pour confirmer**

Run: `cd backend && bun test src/lib/passwordHasher.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/passwordHasher.ts backend/src/lib/passwordHasher.test.ts
git commit -m "feat(backend): passwordHasher (argon2id via Bun.password)"
```

---

## Task 3: emailNormalizer

**Files:**
- Create: `backend/src/lib/emailNormalizer.ts`
- Create: `backend/src/lib/emailNormalizer.test.ts`

- [ ] **Step 1: Écrire les tests**

```ts
// backend/src/lib/emailNormalizer.test.ts
import { describe, expect, test } from "bun:test";
import { normalizeEmail } from "./emailNormalizer";

describe("normalizeEmail", () => {
  test("lowercases", () => {
    expect(normalizeEmail("User@Example.COM")).toBe("user@example.com");
  });

  test("trims surrounding whitespace", () => {
    expect(normalizeEmail("  alice@example.com  ")).toBe("alice@example.com");
  });

  test("preserves the local part as-is otherwise", () => {
    expect(normalizeEmail("alice+tag@example.com")).toBe("alice+tag@example.com");
  });
});
```

- [ ] **Step 2: Run pour vérifier l'échec**

Run: `cd backend && bun test src/lib/emailNormalizer.test.ts`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Implémenter**

```ts
// backend/src/lib/emailNormalizer.ts
export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}
```

- [ ] **Step 4: Run pour confirmer**

Run: `cd backend && bun test src/lib/emailNormalizer.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/emailNormalizer.ts backend/src/lib/emailNormalizer.test.ts
git commit -m "feat(backend): emailNormalizer"
```

---

## Task 4: sessionManager — création de session

**Files:**
- Create: `backend/src/lib/sessionManager.ts`
- Create: `backend/src/lib/sessionManager.test.ts`

- [ ] **Step 1: Écrire le test (création)**

```ts
// backend/src/lib/sessionManager.test.ts
import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../db/index";
import { users, userSessions } from "../db/schema";
import { createSession } from "./sessionManager";

async function seedUser(): Promise<string> {
  const id = "user_" + crypto.randomUUID().slice(0, 8);
  const now = new Date();
  await db.insert(users).values({
    id, email: `${id}@example.com`, name: "Test", createdAt: now, updatedAt: now,
  });
  return id;
}

describe("createSession", () => {
  test("creates a row in user_sessions with a 32-char id", async () => {
    const userId = await seedUser();
    const session = await createSession(userId);
    expect(session.id).toMatch(/^[A-Za-z0-9]{32}$/);
    expect(session.userId).toBe(userId);

    const rows = await db.select().from(userSessions).where(eq(userSessions.id, session.id));
    expect(rows).toHaveLength(1);
  });

  test("sets expiresAt 30 days in the future by default", async () => {
    const userId = await seedUser();
    const session = await createSession(userId);
    const delta = session.expiresAt.getTime() - Date.now();
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    expect(Math.abs(delta - thirtyDays)).toBeLessThan(5_000);
  });
});
```

- [ ] **Step 2: Run pour échec**

Run: `cd backend && bun test src/lib/sessionManager.test.ts`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Implémenter `createSession`**

```ts
// backend/src/lib/sessionManager.ts
import { db } from "../db/index";
import { userSessions } from "../db/schema";

const TOKEN_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

function generateSessionId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (b) => TOKEN_CHARS[b % TOKEN_CHARS.length]).join("");
}

export interface UserSessionRow {
  id: string;
  userId: string;
  createdAt: Date;
  lastUsedAt: Date;
  expiresAt: Date;
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export async function createSession(userId: string): Promise<UserSessionRow> {
  const now = new Date();
  const row = {
    id: generateSessionId(),
    userId,
    createdAt: now,
    lastUsedAt: now,
    expiresAt: new Date(now.getTime() + THIRTY_DAYS_MS),
  };
  await db.insert(userSessions).values(row);
  return row;
}
```

- [ ] **Step 4: Run pour confirmer**

Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/sessionManager.ts backend/src/lib/sessionManager.test.ts
git commit -m "feat(backend): sessionManager.createSession"
```

---

## Task 5: sessionManager.findSession + touchSession + destroySession

**Files:**
- Modify: `backend/src/lib/sessionManager.ts`
- Modify: `backend/src/lib/sessionManager.test.ts`

- [ ] **Step 1: Ajouter les tests**

```ts
// Append à backend/src/lib/sessionManager.test.ts

import { findSession, touchSession, destroySession } from "./sessionManager";

describe("findSession", () => {
  test("returns the session when valid", async () => {
    const userId = await seedUser();
    const session = await createSession(userId);
    const found = await findSession(session.id);
    expect(found?.userId).toBe(userId);
  });

  test("returns null when expired", async () => {
    const userId = await seedUser();
    const session = await createSession(userId);
    await db.update(userSessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(userSessions.id, session.id));
    expect(await findSession(session.id)).toBeNull();
  });

  test("returns null for unknown id", async () => {
    expect(await findSession("not-a-real-session-id")).toBeNull();
  });
});

describe("touchSession", () => {
  test("updates lastUsedAt", async () => {
    const userId = await seedUser();
    const session = await createSession(userId);
    const before = session.lastUsedAt.getTime();
    await new Promise((r) => setTimeout(r, 10));
    await touchSession(session.id);
    const rows = await db.select().from(userSessions).where(eq(userSessions.id, session.id));
    expect(rows[0].lastUsedAt.getTime()).toBeGreaterThan(before);
  });
});

describe("destroySession", () => {
  test("removes the row", async () => {
    const userId = await seedUser();
    const session = await createSession(userId);
    await destroySession(session.id);
    const rows = await db.select().from(userSessions).where(eq(userSessions.id, session.id));
    expect(rows).toHaveLength(0);
  });

  test("no-ops on unknown id", async () => {
    await destroySession("not-a-real-session-id");
    // pas d'exception = succès
  });
});
```

- [ ] **Step 2: Run pour échec**

Expected: FAIL — fonctions introuvables.

- [ ] **Step 3: Implémenter dans sessionManager.ts**

```ts
// Append à backend/src/lib/sessionManager.ts

import { eq } from "drizzle-orm";

export async function findSession(id: string): Promise<UserSessionRow | null> {
  const rows = await db.select().from(userSessions).where(eq(userSessions.id, id));
  if (rows.length === 0) return null;
  const row = rows[0];
  if (row.expiresAt < new Date()) return null;
  return row;
}

export async function touchSession(id: string): Promise<void> {
  await db.update(userSessions)
    .set({ lastUsedAt: new Date() })
    .where(eq(userSessions.id, id));
}

export async function destroySession(id: string): Promise<void> {
  await db.delete(userSessions).where(eq(userSessions.id, id));
}
```

- [ ] **Step 4: Run pour confirmer**

Expected: PASS (tous les tests sessionManager).

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/sessionManager.ts backend/src/lib/sessionManager.test.ts
git commit -m "feat(backend): sessionManager.findSession + touchSession + destroySession"
```

---

## Task 6: userAuth middleware

**Files:**
- Create: `backend/src/middleware/userAuth.ts`
- Create: `backend/src/middleware/userAuth.test.ts`

- [ ] **Step 1: Écrire les tests**

```ts
// backend/src/middleware/userAuth.test.ts
import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { db } from "../db/index";
import { users } from "../db/schema";
import { createSession } from "../lib/sessionManager";
import { userAuth } from "./userAuth";

async function seedUser(): Promise<{ userId: string; sessionId: string }> {
  const userId = "user_" + crypto.randomUUID().slice(0, 8);
  const now = new Date();
  await db.insert(users).values({
    id: userId, email: `${userId}@example.com`, name: "Test", createdAt: now, updatedAt: now,
  });
  const session = await createSession(userId);
  return { userId, sessionId: session.id };
}

describe("userAuth middleware", () => {
  test("attaches user when cookie is valid", async () => {
    const { userId, sessionId } = await seedUser();
    const app = new Hono();
    app.use("/x", userAuth());
    app.get("/x", (c) => c.json({ userId: c.var.user?.id ?? null }));

    const res = await app.fetch(new Request("http://x/x", {
      headers: { Cookie: `ifz_user_session=${sessionId}` },
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.userId).toBe(userId);
  });

  test("attaches null when no cookie", async () => {
    const app = new Hono();
    app.use("/x", userAuth());
    app.get("/x", (c) => c.json({ userId: c.var.user?.id ?? null }));

    const res = await app.fetch(new Request("http://x/x"));
    const body = await res.json();
    expect(body.userId).toBeNull();
  });

  test("attaches null when cookie references unknown session", async () => {
    const app = new Hono();
    app.use("/x", userAuth());
    app.get("/x", (c) => c.json({ userId: c.var.user?.id ?? null }));

    const res = await app.fetch(new Request("http://x/x", {
      headers: { Cookie: "ifz_user_session=does-not-exist" },
    }));
    const body = await res.json();
    expect(body.userId).toBeNull();
  });
});
```

- [ ] **Step 2: Run pour échec**

Expected: FAIL — module middleware/userAuth.ts introuvable.

- [ ] **Step 3: Implémenter**

```ts
// backend/src/middleware/userAuth.ts
import { eq } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import { getCookie } from "hono/cookie";
import { db } from "../db/index";
import { users } from "../db/schema";
import { findSession, touchSession } from "../lib/sessionManager";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}

declare module "hono" {
  interface ContextVariableMap {
    user: AuthUser | null;
  }
}

export const userAuth = () => createMiddleware(async (c, next) => {
  const sessionId = getCookie(c, "ifz_user_session");
  if (!sessionId) {
    c.set("user", null);
    return next();
  }
  const session = await findSession(sessionId);
  if (!session) {
    c.set("user", null);
    return next();
  }
  const rows = await db.select().from(users).where(eq(users.id, session.userId));
  if (rows.length === 0) {
    c.set("user", null);
    return next();
  }
  const row = rows[0];
  c.set("user", {
    id: row.id,
    email: row.email,
    name: row.name,
    avatarUrl: row.avatarUrl,
  });
  await touchSession(sessionId);
  return next();
});
```

- [ ] **Step 4: Run pour confirmer**

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/middleware/userAuth.ts backend/src/middleware/userAuth.test.ts
git commit -m "feat(backend): middleware userAuth (cookie ifz_user_session)"
```

---

# Phase B — Routes auth (signup / login / logout / me)

## Task 7: POST /api/auth/signup (happy path)

**Files:**
- Create: `backend/src/routes/auth.ts`
- Create: `backend/src/routes/auth.test.ts`
- Modify: `backend/src/app.ts`

- [ ] **Step 1: Écrire le test happy path**

```ts
// backend/src/routes/auth.test.ts
import { afterEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { app } from "../app";
import { db } from "../db/index";
import { users, userSessions } from "../db/schema";

async function cleanupByEmail(email: string) {
  await db.delete(users).where(eq(users.email, email));
}

describe("POST /api/auth/signup", () => {
  test("creates a user and sets the session cookie", async () => {
    const email = `signup_${Date.now()}@example.com`;
    const res = await app.fetch(new Request("http://x/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "correct horse battery staple", name: "Alice" }),
    }));
    expect(res.status).toBe(201);
    const setCookie = res.headers.get("Set-Cookie") ?? "";
    expect(setCookie).toContain("ifz_user_session=");
    expect(setCookie).toContain("HttpOnly");
    const body = await res.json();
    expect(body.user.email).toBe(email);
    expect(body.user.name).toBe("Alice");
    expect(body.user.id).toMatch(/^user_/);
    expect(body.user).not.toHaveProperty("passwordHash");

    const rows = await db.select().from(users).where(eq(users.email, email));
    expect(rows).toHaveLength(1);
    expect(rows[0].passwordHash).toBeTruthy();
    expect(rows[0].passwordHash).not.toContain("correct horse"); // hashed

    await cleanupByEmail(email);
  });
});
```

- [ ] **Step 2: Run pour échec**

Expected: FAIL — route introuvable (404) ou import manquant.

- [ ] **Step 3: Implémenter la route minimale**

```ts
// backend/src/routes/auth.ts
import { Hono } from "hono";
import { setCookie, deleteCookie } from "hono/cookie";
import { db } from "../db/index";
import { users } from "../db/schema";
import { eq } from "drizzle-orm";
import { hashPassword } from "../lib/passwordHasher";
import { normalizeEmail } from "../lib/emailNormalizer";
import { createSession } from "../lib/sessionManager";

const router = new Hono();

function newUserId(): string {
  return "user_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}

function setSessionCookie(c: Parameters<typeof setCookie>[0], sessionId: string, expires: Date) {
  setCookie(c, "ifz_user_session", sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "Lax",
    expires,
    path: "/",
  });
}

router.post("/signup", async (c) => {
  const body = await c.req.json().catch(() => null) as
    | { email?: string; password?: string; name?: string }
    | null;
  if (!body || !body.email || !body.password || !body.name) {
    return c.json({ error: "invalid_body" }, 400);
  }
  const email = normalizeEmail(body.email);
  if (!email.includes("@") || email.length < 3) {
    return c.json({ error: "invalid_email" }, 422);
  }
  if (body.password.length < 8) {
    return c.json({ error: "weak_password" }, 422);
  }
  const existing = await db.select().from(users).where(eq(users.email, email));
  if (existing.length > 0) {
    return c.json({ error: "email_taken" }, 409);
  }
  const id = newUserId();
  const now = new Date();
  const passwordHash = await hashPassword(body.password);
  await db.insert(users).values({
    id, email, name: body.name, passwordHash,
    avatarUrl: null, createdAt: now, updatedAt: now,
  });
  const session = await createSession(id);
  setSessionCookie(c, session.id, session.expiresAt);
  return c.json({ user: { id, email, name: body.name, avatarUrl: null } }, 201);
});

export { router as authRouter };
```

- [ ] **Step 4: Wire dans app.ts**

```ts
// backend/src/app.ts — modifier l'import et la liste route()
// Ajouter avec les autres imports :
import { authRouter } from "./routes/auth";

// Ajouter avec les autres app.route() :
app.route("/api/auth", authRouter);
```

- [ ] **Step 5: Run le test**

Run: `cd backend && bun test src/routes/auth.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/auth.ts backend/src/routes/auth.test.ts backend/src/app.ts
git commit -m "feat(backend): POST /api/auth/signup"
```

---

## Task 8: signup — error paths

**Files:**
- Modify: `backend/src/routes/auth.test.ts`

- [ ] **Step 1: Ajouter les tests d'erreur**

```ts
// Append à backend/src/routes/auth.test.ts inside `describe("POST /api/auth/signup", ...)`

  test("returns 409 when email already taken", async () => {
    const email = `dup_${Date.now()}@example.com`;
    await app.fetch(new Request("http://x/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "longenoughpw", name: "A" }),
    }));
    const res = await app.fetch(new Request("http://x/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "anotherpwwww", name: "B" }),
    }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("email_taken");
    await cleanupByEmail(email);
  });

  test("returns 422 on weak password (<8 chars)", async () => {
    const res = await app.fetch(new Request("http://x/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "weak@example.com", password: "short", name: "W" }),
    }));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("weak_password");
  });

  test("returns 422 on invalid email", async () => {
    const res = await app.fetch(new Request("http://x/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "noatsign", password: "longenoughpw", name: "X" }),
    }));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("invalid_email");
  });

  test("returns 400 on missing fields", async () => {
    const res = await app.fetch(new Request("http://x/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "only@example.com" }),
    }));
    expect(res.status).toBe(400);
  });
```

- [ ] **Step 2: Run**

Expected: PASS (la logique d'erreur est déjà en place dans Task 7 ; on a juste ajouté les tests).

- [ ] **Step 3: Commit**

```bash
git add backend/src/routes/auth.test.ts
git commit -m "test(backend): signup error paths (409/422/400)"
```

---

## Task 9: POST /api/auth/login

**Files:**
- Modify: `backend/src/routes/auth.ts`
- Modify: `backend/src/routes/auth.test.ts`

- [ ] **Step 1: Écrire les tests**

```ts
// Append à backend/src/routes/auth.test.ts

describe("POST /api/auth/login", () => {
  async function createTestUser(email: string, password: string): Promise<void> {
    await app.fetch(new Request("http://x/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, name: "T" }),
    }));
  }

  test("logs in with correct credentials, sets cookie", async () => {
    const email = `login_${Date.now()}@example.com`;
    await createTestUser(email, "longenoughpw");
    const res = await app.fetch(new Request("http://x/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "longenoughpw" }),
    }));
    expect(res.status).toBe(200);
    expect(res.headers.get("Set-Cookie") ?? "").toContain("ifz_user_session=");
    expect((await res.json()).user.email).toBe(email);
    await cleanupByEmail(email);
  });

  test("returns 401 on wrong password", async () => {
    const email = `wpw_${Date.now()}@example.com`;
    await createTestUser(email, "longenoughpw");
    const res = await app.fetch(new Request("http://x/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "wrongpw1234" }),
    }));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("invalid_credentials");
    await cleanupByEmail(email);
  });

  test("returns 401 on unknown email", async () => {
    const res = await app.fetch(new Request("http://x/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "nobody@example.com", password: "whatever1234" }),
    }));
    expect(res.status).toBe(401);
  });

  test("returns 401 for Discord-only user (no password)", async () => {
    const email = `discord_only_${Date.now()}@example.com`;
    const id = "user_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    const now = new Date();
    await db.insert(users).values({
      id, email, name: "DOnly", passwordHash: null,
      avatarUrl: null, createdAt: now, updatedAt: now,
    });
    const res = await app.fetch(new Request("http://x/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "whatever1234" }),
    }));
    expect(res.status).toBe(401);
    await cleanupByEmail(email);
  });
});
```

- [ ] **Step 2: Run pour échec**

Expected: FAIL — route `/login` retourne 404.

- [ ] **Step 3: Ajouter la route**

```ts
// Append à backend/src/routes/auth.ts (avant export { router as authRouter })

import { verifyPassword } from "../lib/passwordHasher";

router.post("/login", async (c) => {
  const body = await c.req.json().catch(() => null) as
    | { email?: string; password?: string }
    | null;
  if (!body || !body.email || !body.password) {
    return c.json({ error: "invalid_body" }, 400);
  }
  const email = normalizeEmail(body.email);
  const rows = await db.select().from(users).where(eq(users.email, email));
  if (rows.length === 0) {
    return c.json({ error: "invalid_credentials" }, 401);
  }
  const row = rows[0];
  if (!row.passwordHash) {
    // Discord-only user; login by password not available
    return c.json({ error: "invalid_credentials" }, 401);
  }
  const ok = await verifyPassword(body.password, row.passwordHash);
  if (!ok) {
    return c.json({ error: "invalid_credentials" }, 401);
  }
  const session = await createSession(row.id);
  setSessionCookie(c, session.id, session.expiresAt);
  return c.json({
    user: {
      id: row.id, email: row.email, name: row.name, avatarUrl: row.avatarUrl,
    },
  });
});
```

- [ ] **Step 4: Run**

Expected: PASS (tous les tests login).

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/auth.ts backend/src/routes/auth.test.ts
git commit -m "feat(backend): POST /api/auth/login"
```

---

## Task 10: POST /api/auth/logout + GET /api/auth/me

**Files:**
- Modify: `backend/src/routes/auth.ts`
- Modify: `backend/src/routes/auth.test.ts`

- [ ] **Step 1: Écrire les tests**

```ts
// Append à backend/src/routes/auth.test.ts

describe("POST /api/auth/logout", () => {
  test("destroys session and clears cookie", async () => {
    const email = `lo_${Date.now()}@example.com`;
    await app.fetch(new Request("http://x/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "longenoughpw", name: "Lo" }),
    }));
    const loginRes = await app.fetch(new Request("http://x/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "longenoughpw" }),
    }));
    const cookieRaw = loginRes.headers.get("Set-Cookie") ?? "";
    const sessionId = /ifz_user_session=([^;]+)/.exec(cookieRaw)?.[1] ?? "";
    expect(sessionId).toBeTruthy();

    const res = await app.fetch(new Request("http://x/api/auth/logout", {
      method: "POST",
      headers: { Cookie: `ifz_user_session=${sessionId}` },
    }));
    expect(res.status).toBe(204);
    expect(res.headers.get("Set-Cookie") ?? "").toMatch(/ifz_user_session=;.*Max-Age=0|ifz_user_session=;.*expires=/i);

    const remain = await db.select().from(userSessions).where(eq(userSessions.id, sessionId));
    expect(remain).toHaveLength(0);
    await cleanupByEmail(email);
  });

  test("returns 204 even without cookie (idempotent)", async () => {
    const res = await app.fetch(new Request("http://x/api/auth/logout", { method: "POST" }));
    expect(res.status).toBe(204);
  });
});

describe("GET /api/auth/me", () => {
  test("returns the user when cookie is valid", async () => {
    const email = `me_${Date.now()}@example.com`;
    await app.fetch(new Request("http://x/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "longenoughpw", name: "Me" }),
    }));
    const loginRes = await app.fetch(new Request("http://x/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "longenoughpw" }),
    }));
    const sessionId = /ifz_user_session=([^;]+)/.exec(loginRes.headers.get("Set-Cookie") ?? "")?.[1] ?? "";

    const res = await app.fetch(new Request("http://x/api/auth/me", {
      headers: { Cookie: `ifz_user_session=${sessionId}` },
    }));
    expect(res.status).toBe(200);
    expect((await res.json()).user.email).toBe(email);
    await cleanupByEmail(email);
  });

  test("returns 401 without cookie", async () => {
    const res = await app.fetch(new Request("http://x/api/auth/me"));
    expect(res.status).toBe(401);
  });

  test("returns 401 with bogus cookie", async () => {
    const res = await app.fetch(new Request("http://x/api/auth/me", {
      headers: { Cookie: "ifz_user_session=does-not-exist" },
    }));
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run pour échec**

Expected: FAIL — routes `/logout` et `/me` retournent 404.

- [ ] **Step 3: Ajouter les routes**

```ts
// Append à backend/src/routes/auth.ts

import { getCookie } from "hono/cookie";
import { destroySession } from "../lib/sessionManager";
import { userAuth } from "../middleware/userAuth";

router.post("/logout", async (c) => {
  const sessionId = getCookie(c, "ifz_user_session");
  if (sessionId) await destroySession(sessionId);
  deleteCookie(c, "ifz_user_session", { path: "/" });
  return c.body(null, 204);
});

router.get("/me", userAuth(), (c) => {
  const user = c.var.user;
  if (!user) return c.json({ error: "unauthorized" }, 401);
  return c.json({ user });
});
```

- [ ] **Step 4: Run**

Expected: PASS (tous les tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/auth.ts backend/src/routes/auth.test.ts
git commit -m "feat(backend): POST /api/auth/logout + GET /api/auth/me"
```

---

# Phase C — Discord OAuth

## Task 11: discordOauth helpers — buildAuthorizeUrl

**Files:**
- Create: `backend/src/lib/discordOauth.ts`
- Create: `backend/src/lib/discordOauth.test.ts`

- [ ] **Step 1: Test pour buildAuthorizeUrl**

```ts
// backend/src/lib/discordOauth.test.ts
import { describe, expect, test } from "bun:test";
import { buildAuthorizeUrl } from "./discordOauth";

describe("buildAuthorizeUrl", () => {
  test("includes client_id, redirect_uri, scope=identify+email, state", () => {
    const url = buildAuthorizeUrl({
      clientId: "abc123",
      redirectUri: "http://localhost:3001/api/auth/discord/callback",
      state: "csrf-token-xyz",
    });
    const parsed = new URL(url);
    expect(parsed.origin).toBe("https://discord.com");
    expect(parsed.pathname).toBe("/api/oauth2/authorize");
    expect(parsed.searchParams.get("client_id")).toBe("abc123");
    expect(parsed.searchParams.get("redirect_uri")).toBe("http://localhost:3001/api/auth/discord/callback");
    expect(parsed.searchParams.get("response_type")).toBe("code");
    expect(parsed.searchParams.get("scope")).toBe("identify email");
    expect(parsed.searchParams.get("state")).toBe("csrf-token-xyz");
    expect(parsed.searchParams.get("prompt")).toBe("none");
  });
});
```

- [ ] **Step 2: Run pour échec**

Expected: FAIL — module introuvable.

- [ ] **Step 3: Implémenter**

```ts
// backend/src/lib/discordOauth.ts
export interface AuthorizeUrlParams {
  clientId: string;
  redirectUri: string;
  state: string;
}

export function buildAuthorizeUrl(p: AuthorizeUrlParams): string {
  const url = new URL("https://discord.com/api/oauth2/authorize");
  url.searchParams.set("client_id", p.clientId);
  url.searchParams.set("redirect_uri", p.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "identify email");
  url.searchParams.set("state", p.state);
  url.searchParams.set("prompt", "none");
  return url.toString();
}
```

- [ ] **Step 4: Run**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/discordOauth.ts backend/src/lib/discordOauth.test.ts
git commit -m "feat(backend): discordOauth.buildAuthorizeUrl"
```

---

## Task 12: discordOauth — exchangeCode + fetchDiscordUser (avec fetch injectable)

**Files:**
- Modify: `backend/src/lib/discordOauth.ts`
- Modify: `backend/src/lib/discordOauth.test.ts`

- [ ] **Step 1: Tests avec fetch injecté**

```ts
// Append à backend/src/lib/discordOauth.test.ts

import { exchangeCode, fetchDiscordUser } from "./discordOauth";

function mockFetch(handlers: Record<string, (req: Request) => Response | Promise<Response>>): typeof fetch {
  return async (input: Request | string | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(input.toString(), init);
    const url = new URL(req.url);
    const key = url.origin + url.pathname;
    const h = handlers[key];
    if (!h) throw new Error(`Unexpected fetch: ${key}`);
    return h(req);
  };
}

describe("exchangeCode", () => {
  test("returns access_token from Discord", async () => {
    const result = await exchangeCode({
      code: "the-code",
      clientId: "cid",
      clientSecret: "csec",
      redirectUri: "http://x/cb",
    }, mockFetch({
      "https://discord.com/api/oauth2/token": async (req) => {
        const body = await req.text();
        expect(body).toContain("code=the-code");
        expect(body).toContain("grant_type=authorization_code");
        expect(body).toContain("client_id=cid");
        return new Response(
          JSON.stringify({ access_token: "AT", refresh_token: "RT", expires_in: 604800, scope: "identify email" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    }));
    expect(result.accessToken).toBe("AT");
    expect(result.refreshToken).toBe("RT");
    expect(result.expiresIn).toBe(604800);
  });

  test("throws on Discord error response", async () => {
    expect(exchangeCode({
      code: "bad", clientId: "cid", clientSecret: "csec", redirectUri: "http://x/cb",
    }, mockFetch({
      "https://discord.com/api/oauth2/token": () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }),
    }))).rejects.toThrow(/invalid_grant/);
  });
});

describe("fetchDiscordUser", () => {
  test("returns id, username, email from Discord", async () => {
    const user = await fetchDiscordUser("AT", mockFetch({
      "https://discord.com/api/users/@me": (req) => {
        expect(req.headers.get("Authorization")).toBe("Bearer AT");
        return new Response(
          JSON.stringify({ id: "123456789", username: "alice", email: "alice@example.com", avatar: "av_hash" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    }));
    expect(user.discordUserId).toBe("123456789");
    expect(user.username).toBe("alice");
    expect(user.email).toBe("alice@example.com");
    expect(user.avatarUrl).toContain("av_hash");
  });
});
```

- [ ] **Step 2: Run pour échec**

Expected: FAIL — fonctions introuvables.

- [ ] **Step 3: Implémenter**

```ts
// Append à backend/src/lib/discordOauth.ts

export interface ExchangeCodeParams {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface ExchangeCodeResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  scope: string;
}

export async function exchangeCode(
  p: ExchangeCodeParams,
  fetchImpl: typeof fetch = fetch,
): Promise<ExchangeCodeResult> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: p.code,
    client_id: p.clientId,
    client_secret: p.clientSecret,
    redirect_uri: p.redirectUri,
  });
  const res = await fetchImpl("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Discord OAuth exchange failed (${res.status}): ${errBody}`);
  }
  const data = await res.json() as { access_token: string; refresh_token: string; expires_in: number; scope: string };
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
    scope: data.scope,
  };
}

export interface DiscordUserInfo {
  discordUserId: string;
  username: string;
  email: string | null;
  avatarUrl: string | null;
}

export async function fetchDiscordUser(
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DiscordUserInfo> {
  const res = await fetchImpl("https://discord.com/api/users/@me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Discord /users/@me failed (${res.status})`);
  }
  const data = await res.json() as { id: string; username: string; email?: string; avatar?: string | null };
  const avatarUrl = data.avatar
    ? `https://cdn.discordapp.com/avatars/${data.id}/${data.avatar}.png`
    : null;
  return {
    discordUserId: data.id,
    username: data.username,
    email: data.email ?? null,
    avatarUrl,
  };
}
```

- [ ] **Step 4: Run**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/discordOauth.ts backend/src/lib/discordOauth.test.ts
git commit -m "feat(backend): discordOauth.exchangeCode + fetchDiscordUser"
```

---

## Task 13: GET /api/auth/discord/start

**Files:**
- Create: `backend/src/routes/discordOauth.ts`
- Create: `backend/src/routes/discordOauth.test.ts`
- Modify: `backend/src/app.ts`

- [ ] **Step 1: Test**

```ts
// backend/src/routes/discordOauth.test.ts
import { beforeAll, afterAll, describe, expect, test } from "bun:test";
import { app } from "../app";

const savedEnv: Record<string, string | undefined> = {};
beforeAll(() => {
  savedEnv.CID = process.env.DISCORD_CLIENT_ID;
  savedEnv.CSECRET = process.env.DISCORD_CLIENT_SECRET;
  savedEnv.REDIR = process.env.DISCORD_REDIRECT_URI;
  process.env.DISCORD_CLIENT_ID = "test_cid";
  process.env.DISCORD_CLIENT_SECRET = "test_csec";
  process.env.DISCORD_REDIRECT_URI = "http://x/api/auth/discord/callback";
});
afterAll(() => {
  process.env.DISCORD_CLIENT_ID = savedEnv.CID;
  process.env.DISCORD_CLIENT_SECRET = savedEnv.CSECRET;
  process.env.DISCORD_REDIRECT_URI = savedEnv.REDIR;
});

describe("GET /api/auth/discord/start", () => {
  test("redirects to Discord with state cookie set", async () => {
    const res = await app.fetch(new Request("http://x/api/auth/discord/start"), { redirect: "manual" } as RequestInit);
    expect(res.status).toBe(302);
    const location = res.headers.get("Location") ?? "";
    expect(location).toContain("https://discord.com/api/oauth2/authorize");
    expect(location).toContain("client_id=test_cid");
    const setCookie = res.headers.get("Set-Cookie") ?? "";
    expect(setCookie).toContain("ifz_oauth_state=");
    expect(setCookie).toContain("HttpOnly");
  });

  test("returns 500 when DISCORD_CLIENT_ID is not configured", async () => {
    delete process.env.DISCORD_CLIENT_ID;
    try {
      const res = await app.fetch(new Request("http://x/api/auth/discord/start"));
      expect(res.status).toBe(500);
    } finally {
      process.env.DISCORD_CLIENT_ID = "test_cid";
    }
  });
});
```

- [ ] **Step 2: Run pour échec**

Expected: FAIL — route 404.

- [ ] **Step 3: Implémenter**

```ts
// backend/src/routes/discordOauth.ts
import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { buildAuthorizeUrl } from "../lib/discordOauth";

const router = new Hono();

function newOauthState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function envOrNull(name: string): string | null {
  const v = process.env[name];
  return v && v.length > 0 ? v : null;
}

router.get("/start", (c) => {
  const clientId = envOrNull("DISCORD_CLIENT_ID");
  const redirectUri = envOrNull("DISCORD_REDIRECT_URI");
  if (!clientId || !redirectUri) {
    return c.json({ error: "discord_not_configured" }, 500);
  }
  const state = newOauthState();
  setCookie(c, "ifz_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "Lax",
    path: "/",
    maxAge: 600, // 10 min
  });
  const url = buildAuthorizeUrl({ clientId, redirectUri, state });
  return c.redirect(url);
});

export { router as discordOauthRouter };
```

- [ ] **Step 4: Wire dans app.ts**

```ts
// backend/src/app.ts — ajouter avec les autres imports + routes :
import { discordOauthRouter } from "./routes/discordOauth";
// ...
app.route("/api/auth/discord", discordOauthRouter);
```

- [ ] **Step 5: Run**

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/discordOauth.ts backend/src/routes/discordOauth.test.ts backend/src/app.ts
git commit -m "feat(backend): GET /api/auth/discord/start (CSRF state cookie)"
```

---

## Task 14: GET /api/auth/discord/callback — état invalide

**Files:**
- Modify: `backend/src/routes/discordOauth.ts`
- Modify: `backend/src/routes/discordOauth.test.ts`

- [ ] **Step 1: Test rejet état**

```ts
// Append à backend/src/routes/discordOauth.test.ts

describe("GET /api/auth/discord/callback (invalid state)", () => {
  test("400 when state cookie missing", async () => {
    const res = await app.fetch(new Request("http://x/api/auth/discord/callback?code=c&state=s"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_state");
  });

  test("400 when state mismatches", async () => {
    const res = await app.fetch(new Request("http://x/api/auth/discord/callback?code=c&state=mismatch", {
      headers: { Cookie: "ifz_oauth_state=actual" },
    }));
    expect(res.status).toBe(400);
  });

  test("400 when code is missing", async () => {
    const res = await app.fetch(new Request("http://x/api/auth/discord/callback?state=s", {
      headers: { Cookie: "ifz_oauth_state=s" },
    }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("missing_code");
  });
});
```

- [ ] **Step 2: Run pour échec**

Expected: FAIL — route /callback retourne 404.

- [ ] **Step 3: Ajouter la route avec validation d'état**

```ts
// Append à backend/src/routes/discordOauth.ts (avant export)

router.get("/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  const stateCookie = getCookie(c, "ifz_oauth_state");

  if (!stateCookie || !state || stateCookie !== state) {
    return c.json({ error: "invalid_state" }, 400);
  }
  if (!code) {
    return c.json({ error: "missing_code" }, 400);
  }
  // Le reste (échange + création user/session) arrive dans Task 15.
  return c.json({ ok: true, debug: "stub" });
});
```

- [ ] **Step 4: Run**

Expected: PASS (les 3 tests d'état).

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/discordOauth.ts backend/src/routes/discordOauth.test.ts
git commit -m "feat(backend): /discord/callback — validation state cookie + code"
```

---

## Task 15: discord/callback — flow heureux (avec fetch mocké)

**Files:**
- Modify: `backend/src/routes/discordOauth.ts`
- Modify: `backend/src/routes/discordOauth.test.ts`

Cette tâche implémente la création d'user et de session post-callback. On rend l'implem testable en exposant un `fetchImpl` réceptionné via une factory.

- [ ] **Step 1: Refactor pour rendre fetch injectable**

Remplacer le contenu de `backend/src/routes/discordOauth.ts` par :

```ts
import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { eq } from "drizzle-orm";
import { db } from "../db/index";
import { users, discordAccounts } from "../db/schema";
import { buildAuthorizeUrl, exchangeCode, fetchDiscordUser } from "../lib/discordOauth";
import { normalizeEmail } from "../lib/emailNormalizer";
import { createSession } from "../lib/sessionManager";

export function createDiscordOauthRouter(fetchImpl: typeof fetch = fetch) {
  const router = new Hono();

  function newOauthState(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  function newUserId(): string {
    return "user_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  }
  function envOrNull(name: string): string | null {
    const v = process.env[name];
    return v && v.length > 0 ? v : null;
  }

  router.get("/start", (c) => {
    const clientId = envOrNull("DISCORD_CLIENT_ID");
    const redirectUri = envOrNull("DISCORD_REDIRECT_URI");
    if (!clientId || !redirectUri) {
      return c.json({ error: "discord_not_configured" }, 500);
    }
    const state = newOauthState();
    setCookie(c, "ifz_oauth_state", state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "Lax",
      path: "/",
      maxAge: 600,
    });
    return c.redirect(buildAuthorizeUrl({ clientId, redirectUri, state }));
  });

  router.get("/callback", async (c) => {
    const code = c.req.query("code");
    const state = c.req.query("state");
    const stateCookie = getCookie(c, "ifz_oauth_state");
    if (!stateCookie || !state || stateCookie !== state) {
      return c.json({ error: "invalid_state" }, 400);
    }
    if (!code) {
      return c.json({ error: "missing_code" }, 400);
    }
    deleteCookie(c, "ifz_oauth_state", { path: "/" });

    const clientId = envOrNull("DISCORD_CLIENT_ID");
    const clientSecret = envOrNull("DISCORD_CLIENT_SECRET");
    const redirectUri = envOrNull("DISCORD_REDIRECT_URI");
    if (!clientId || !clientSecret || !redirectUri) {
      return c.json({ error: "discord_not_configured" }, 500);
    }

    let tokens, user;
    try {
      tokens = await exchangeCode({ code, clientId, clientSecret, redirectUri }, fetchImpl);
      user = await fetchDiscordUser(tokens.accessToken, fetchImpl);
    } catch (err) {
      console.error("Discord OAuth callback failure:", err);
      return c.json({ error: "discord_exchange_failed" }, 502);
    }

    if (!user.email) {
      return c.json({ error: "discord_email_missing" }, 422);
    }
    const email = normalizeEmail(user.email);
    const now = new Date();

    // Cherche un lien Discord existant
    const existingLink = await db.select().from(discordAccounts).where(eq(discordAccounts.discordUserId, user.discordUserId));
    let userId: string;

    if (existingLink.length > 0) {
      userId = existingLink[0].userId;
    } else {
      // Cherche un user existant par email pour relier
      const existingUser = await db.select().from(users).where(eq(users.email, email));
      if (existingUser.length > 0) {
        userId = existingUser[0].id;
      } else {
        // Crée un user (sans password)
        userId = newUserId();
        await db.insert(users).values({
          id: userId, email, name: user.username, passwordHash: null,
          avatarUrl: user.avatarUrl, createdAt: now, updatedAt: now,
        });
      }
      await db.insert(discordAccounts).values({
        discordUserId: user.discordUserId,
        userId,
        username: user.username,
        email: user.email,
        linkedAt: now,
      });
    }

    const session = await createSession(userId);
    setCookie(c, "ifz_user_session", session.id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "Lax",
      expires: session.expiresAt,
      path: "/",
    });

    const editorUrl = process.env.EDITOR_URL ?? "http://localhost:5173";
    return c.redirect(`${editorUrl}/account`);
  });

  return router;
}

export const discordOauthRouter = createDiscordOauthRouter();
```

- [ ] **Step 2: Ajouter le test du happy path**

```ts
// Append à backend/src/routes/discordOauth.test.ts

import { Hono } from "hono";
import { createDiscordOauthRouter } from "./discordOauth";
import { db } from "../db/index";
import { users as usersTable, discordAccounts as discordTable, userSessions } from "../db/schema";
import { eq } from "drizzle-orm";

function buildAppWith(fetchImpl: typeof fetch) {
  const app = new Hono();
  app.route("/api/auth/discord", createDiscordOauthRouter(fetchImpl));
  return app;
}

describe("GET /api/auth/discord/callback (happy path)", () => {
  test("creates user, links Discord account, sets session cookie", async () => {
    const discordUserId = `discord_${Date.now()}`;
    const email = `oa_${Date.now()}@example.com`;
    const mockFetch: typeof fetch = async (input: Request | string | URL) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (url.includes("oauth2/token")) {
        return new Response(JSON.stringify({
          access_token: "AT", refresh_token: "RT", expires_in: 604800, scope: "identify email",
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.includes("users/@me")) {
        return new Response(JSON.stringify({
          id: discordUserId, username: "alice", email, avatar: null,
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      throw new Error("Unexpected fetch in test: " + url);
    };

    const app = buildAppWith(mockFetch);
    const res = await app.fetch(new Request("http://x/api/auth/discord/callback?code=c&state=s", {
      headers: { Cookie: "ifz_oauth_state=s" },
    }));
    expect(res.status).toBe(302);
    expect(res.headers.get("Location") ?? "").toContain("/account");
    expect(res.headers.get("Set-Cookie") ?? "").toContain("ifz_user_session=");

    const userRow = await db.select().from(usersTable).where(eq(usersTable.email, email));
    expect(userRow).toHaveLength(1);
    expect(userRow[0].passwordHash).toBeNull();
    expect(userRow[0].name).toBe("alice");
    const linkRow = await db.select().from(discordTable).where(eq(discordTable.discordUserId, discordUserId));
    expect(linkRow).toHaveLength(1);

    await db.delete(userSessions).where(eq(userSessions.userId, userRow[0].id));
    await db.delete(discordTable).where(eq(discordTable.discordUserId, discordUserId));
    await db.delete(usersTable).where(eq(usersTable.id, userRow[0].id));
  });

  test("re-logs existing Discord-linked user without creating duplicate", async () => {
    const discordUserId = `repeat_${Date.now()}`;
    const email = `repeat_${Date.now()}@example.com`;
    const mockFetch: typeof fetch = async (input) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (url.includes("oauth2/token")) return new Response(JSON.stringify({
        access_token: "AT", refresh_token: "RT", expires_in: 604800, scope: "identify email",
      }), { status: 200, headers: { "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ id: discordUserId, username: "bob", email, avatar: null }),
        { status: 200, headers: { "Content-Type": "application/json" } });
    };

    const app = buildAppWith(mockFetch);
    await app.fetch(new Request("http://x/api/auth/discord/callback?code=c&state=s", {
      headers: { Cookie: "ifz_oauth_state=s" },
    }));
    await app.fetch(new Request("http://x/api/auth/discord/callback?code=c2&state=s", {
      headers: { Cookie: "ifz_oauth_state=s" },
    }));

    const userRows = await db.select().from(usersTable).where(eq(usersTable.email, email));
    expect(userRows).toHaveLength(1);
    const linkRows = await db.select().from(discordTable).where(eq(discordTable.discordUserId, discordUserId));
    expect(linkRows).toHaveLength(1);

    await db.delete(userSessions).where(eq(userSessions.userId, userRows[0].id));
    await db.delete(discordTable).where(eq(discordTable.discordUserId, discordUserId));
    await db.delete(usersTable).where(eq(usersTable.id, userRows[0].id));
  });

  test("links Discord to existing email-only user", async () => {
    // Crée un user via signup classique
    const email = `link_${Date.now()}@example.com`;
    await app.fetch(new Request("http://x/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "longenoughpw", name: "Carol" }),
    }));
    const discordUserId = `link_${Date.now()}`;
    const mockFetch: typeof fetch = async (input) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (url.includes("oauth2/token")) return new Response(JSON.stringify({
        access_token: "AT", refresh_token: "RT", expires_in: 604800, scope: "identify email",
      }), { status: 200, headers: { "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ id: discordUserId, username: "carol-discord", email, avatar: null }),
        { status: 200, headers: { "Content-Type": "application/json" } });
    };

    const tmpApp = buildAppWith(mockFetch);
    await tmpApp.fetch(new Request("http://x/api/auth/discord/callback?code=c&state=s", {
      headers: { Cookie: "ifz_oauth_state=s" },
    }));

    const userRows = await db.select().from(usersTable).where(eq(usersTable.email, email));
    expect(userRows).toHaveLength(1);
    const linkRows = await db.select().from(discordTable).where(eq(discordTable.discordUserId, discordUserId));
    expect(linkRows).toHaveLength(1);
    expect(linkRows[0].userId).toBe(userRows[0].id);

    await db.delete(userSessions).where(eq(userSessions.userId, userRows[0].id));
    await db.delete(discordTable).where(eq(discordTable.discordUserId, discordUserId));
    await db.delete(usersTable).where(eq(usersTable.id, userRows[0].id));
  });
});
```

- [ ] **Step 3: Run pour confirmer**

Expected: PASS (3 nouveaux tests happy path).

- [ ] **Step 4: Mettre à jour .env.example**

```diff
# backend/.env.example (modifier ou ajouter ces lignes)
+ # Discord OAuth — laisser vide pour désactiver le bouton Discord
+ DISCORD_CLIENT_ID=
+ DISCORD_CLIENT_SECRET=
+ DISCORD_REDIRECT_URI=http://localhost:3001/api/auth/discord/callback
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/discordOauth.ts backend/src/routes/discordOauth.test.ts backend/.env.example
git commit -m "feat(backend): Discord OAuth callback complet (création user + lien existant)"
```

---

# Phase D — Editor : authStore + API client

## Task 16: API client auth (signup/login/logout/me)

**Files:**
- Create: `editor/src/lib/api/auth.ts`

- [ ] **Step 1: Implémenter le client (pas de test isolé — testé via authStore)**

```ts
// editor/src/lib/api/auth.ts
export interface AuthUserDto {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}

export interface ApiOptions {
  apiUrl: string;
}

async function postJson<T>(url: string, body: unknown): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }> {
  const res = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status === 204) return { ok: true, data: undefined as unknown as T };
  const data = await res.json().catch(() => ({}));
  if (res.ok) return { ok: true, data: data as T };
  return { ok: false, status: res.status, error: (data as { error?: string }).error ?? "unknown" };
}

export async function signup(
  { apiUrl }: ApiOptions,
  payload: { email: string; password: string; name: string },
) {
  return postJson<{ user: AuthUserDto }>(`${apiUrl}/api/auth/signup`, payload);
}

export async function login(
  { apiUrl }: ApiOptions,
  payload: { email: string; password: string },
) {
  return postJson<{ user: AuthUserDto }>(`${apiUrl}/api/auth/login`, payload);
}

export async function logout({ apiUrl }: ApiOptions) {
  await fetch(`${apiUrl}/api/auth/logout`, { method: "POST", credentials: "include" });
}

export async function getMe({ apiUrl }: ApiOptions): Promise<AuthUserDto | null> {
  const res = await fetch(`${apiUrl}/api/auth/me`, { credentials: "include" });
  if (res.status === 401) return null;
  if (!res.ok) return null;
  const data = await res.json() as { user: AuthUserDto };
  return data.user;
}
```

- [ ] **Step 2: Commit**

```bash
git add editor/src/lib/api/auth.ts
git commit -m "feat(editor): API client auth (signup/login/logout/me)"
```

---

## Task 17: authStore Zustand

**Files:**
- Create: `editor/src/state/authStore.ts`
- Create: `editor/src/state/authStore.test.ts`

NB: nommer le fichier `authStore` (PAS `accountStore` qui existe déjà pour le domaine).

- [ ] **Step 1: Tests du store**

```ts
// editor/src/state/authStore.test.ts
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { useAuthStore } from "./authStore";

const API = "http://x";

beforeEach(() => {
  useAuthStore.setState({ currentUser: null, isLoading: false, error: null });
  vi.restoreAllMocks();
});

describe("authStore.hydrate", () => {
  test("loads the current user when /me succeeds", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(
      JSON.stringify({ user: { id: "u1", email: "a@e.com", name: "Alice", avatarUrl: null } }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ));
    await useAuthStore.getState().hydrate(API);
    expect(useAuthStore.getState().currentUser?.id).toBe("u1");
    expect(useAuthStore.getState().isLoading).toBe(false);
  });

  test("leaves currentUser null when /me returns 401", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 401 }));
    await useAuthStore.getState().hydrate(API);
    expect(useAuthStore.getState().currentUser).toBeNull();
  });
});

describe("authStore.login", () => {
  test("sets currentUser on success", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(
      JSON.stringify({ user: { id: "u2", email: "b@e.com", name: "Bob", avatarUrl: null } }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ));
    const result = await useAuthStore.getState().login(API, { email: "b@e.com", password: "longenoughpw" });
    expect(result.ok).toBe(true);
    expect(useAuthStore.getState().currentUser?.id).toBe("u2");
    expect(useAuthStore.getState().error).toBeNull();
  });

  test("sets error on 401", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(
      JSON.stringify({ error: "invalid_credentials" }), { status: 401, headers: { "Content-Type": "application/json" } },
    ));
    const result = await useAuthStore.getState().login(API, { email: "x@y.z", password: "longenoughpw" });
    expect(result.ok).toBe(false);
    expect(useAuthStore.getState().error).toBe("invalid_credentials");
    expect(useAuthStore.getState().currentUser).toBeNull();
  });
});

describe("authStore.logout", () => {
  test("clears currentUser", async () => {
    useAuthStore.setState({ currentUser: { id: "u", email: "x@y.z", name: "X", avatarUrl: null } });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    await useAuthStore.getState().logout(API);
    expect(useAuthStore.getState().currentUser).toBeNull();
  });
});
```

- [ ] **Step 2: Run pour échec**

Run: `cd editor && npx vitest run src/state/authStore.test.ts`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Implémenter le store**

```ts
// editor/src/state/authStore.ts
import { create } from "zustand";
import type { AuthUserDto } from "@/lib/api/auth";
import { getMe, login as apiLogin, logout as apiLogout, signup as apiSignup } from "@/lib/api/auth";

interface AuthState {
  currentUser: AuthUserDto | null;
  isLoading: boolean;
  error: string | null;
  hydrate: (apiUrl: string) => Promise<void>;
  login: (apiUrl: string, payload: { email: string; password: string })
    => Promise<{ ok: true } | { ok: false; error: string; status: number }>;
  signup: (apiUrl: string, payload: { email: string; password: string; name: string })
    => Promise<{ ok: true } | { ok: false; error: string; status: number }>;
  logout: (apiUrl: string) => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  currentUser: null,
  isLoading: false,
  error: null,
  async hydrate(apiUrl) {
    set({ isLoading: true });
    const user = await getMe({ apiUrl });
    set({ currentUser: user, isLoading: false });
  },
  async login(apiUrl, payload) {
    set({ isLoading: true, error: null });
    const result = await apiLogin({ apiUrl }, payload);
    if (result.ok) {
      set({ currentUser: result.data.user, isLoading: false });
      return { ok: true };
    }
    set({ error: result.error, isLoading: false });
    return { ok: false, error: result.error, status: result.status };
  },
  async signup(apiUrl, payload) {
    set({ isLoading: true, error: null });
    const result = await apiSignup({ apiUrl }, payload);
    if (result.ok) {
      set({ currentUser: result.data.user, isLoading: false });
      return { ok: true };
    }
    set({ error: result.error, isLoading: false });
    return { ok: false, error: result.error, status: result.status };
  },
  async logout(apiUrl) {
    await apiLogout({ apiUrl });
    set({ currentUser: null, error: null });
  },
}));
```

- [ ] **Step 4: Run**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add editor/src/state/authStore.ts editor/src/state/authStore.test.ts
git commit -m "feat(editor): authStore Zustand (hydrate/login/signup/logout)"
```

---

# Phase E — Editor UI (forms + routes)

## Task 18: clés i18n auth (en + fr)

**Files:**
- Modify: `editor/src/locales/en.ts`
- Modify: `editor/src/locales/fr.ts`

- [ ] **Step 1: Ajouter au section principale de chaque fichier**

```ts
// editor/src/locales/en.ts — ajouter dans l'objet exporté :
auth: {
  signupTitle: "Create your account",
  loginTitle: "Sign in",
  email: "Email",
  password: "Password",
  name: "Name",
  signupSubmit: "Sign up",
  loginSubmit: "Sign in",
  logout: "Sign out",
  discordButton: "Continue with Discord",
  errors: {
    email_taken: "An account with this email already exists.",
    invalid_credentials: "Wrong email or password.",
    invalid_email: "Email looks malformed.",
    weak_password: "Password must be at least 8 characters.",
    network: "Couldn't reach the server. Please retry.",
    unknown: "Something went wrong. Please retry.",
  },
  account: {
    title: "Your account",
    signedInAs: "Signed in as",
  },
},
```

```ts
// editor/src/locales/fr.ts — ajouter dans l'objet exporté :
auth: {
  signupTitle: "Créer ton compte",
  loginTitle: "Connexion",
  email: "Email",
  password: "Mot de passe",
  name: "Nom",
  signupSubmit: "S'inscrire",
  loginSubmit: "Se connecter",
  logout: "Déconnexion",
  discordButton: "Continuer avec Discord",
  errors: {
    email_taken: "Un compte existe déjà avec cet email.",
    invalid_credentials: "Email ou mot de passe incorrect.",
    invalid_email: "Email mal formé.",
    weak_password: "Le mot de passe doit faire au moins 8 caractères.",
    network: "Impossible de joindre le serveur, réessaie.",
    unknown: "Une erreur est survenue, réessaie.",
  },
  account: {
    title: "Ton compte",
    signedInAs: "Connecté en tant que",
  },
},
```

- [ ] **Step 2: Vérifier que les imports passent**

Run: `cd editor && npm run build`
Expected: pas d'erreur TS.

- [ ] **Step 3: Commit**

```bash
git add editor/src/locales/en.ts editor/src/locales/fr.ts
git commit -m "i18n(editor): clés auth.* (en/fr)"
```

---

## Task 19: LoginForm

**Files:**
- Create: `editor/src/features/auth/LoginForm.tsx`
- Create: `editor/src/features/auth/LoginForm.test.tsx`

- [ ] **Step 1: Tests**

```tsx
// editor/src/features/auth/LoginForm.test.tsx
import { describe, expect, test, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LoginForm } from "./LoginForm";
import { useAuthStore } from "@/state/authStore";

beforeEach(() => {
  useAuthStore.setState({ currentUser: null, isLoading: false, error: null });
  vi.restoreAllMocks();
});

describe("LoginForm", () => {
  test("submits email + password", async () => {
    const loginSpy = vi.spyOn(useAuthStore.getState(), "login").mockResolvedValue({ ok: true });
    render(<LoginForm apiUrl="http://x" onSuccess={() => {}} />);
    await userEvent.type(screen.getByLabelText(/email/i), "a@e.com");
    await userEvent.type(screen.getByLabelText(/password|mot de passe/i), "longenoughpw");
    await userEvent.click(screen.getByRole("button", { name: /sign in|se connecter/i }));
    expect(loginSpy).toHaveBeenCalledWith("http://x", { email: "a@e.com", password: "longenoughpw" });
  });

  test("displays error on failed login", async () => {
    vi.spyOn(useAuthStore.getState(), "login").mockResolvedValue({ ok: false, error: "invalid_credentials", status: 401 });
    render(<LoginForm apiUrl="http://x" onSuccess={() => {}} />);
    await userEvent.type(screen.getByLabelText(/email/i), "a@e.com");
    await userEvent.type(screen.getByLabelText(/password|mot de passe/i), "longenoughpw");
    await userEvent.click(screen.getByRole("button", { name: /sign in|se connecter/i }));
    expect(await screen.findByText(/wrong email|incorrect/i)).toBeInTheDocument();
  });

  test("calls onSuccess on successful login", async () => {
    vi.spyOn(useAuthStore.getState(), "login").mockResolvedValue({ ok: true });
    const onSuccess = vi.fn();
    render(<LoginForm apiUrl="http://x" onSuccess={onSuccess} />);
    await userEvent.type(screen.getByLabelText(/email/i), "a@e.com");
    await userEvent.type(screen.getByLabelText(/password|mot de passe/i), "longenoughpw");
    await userEvent.click(screen.getByRole("button", { name: /sign in|se connecter/i }));
    expect(onSuccess).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run pour échec**

Run: `cd editor && npx vitest run src/features/auth/LoginForm.test.tsx`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Implémenter**

```tsx
// editor/src/features/auth/LoginForm.tsx
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "@/state/authStore";
import { DiscordLoginButton } from "./DiscordLoginButton";

interface Props {
  apiUrl: string;
  onSuccess: () => void;
}

export function LoginForm({ apiUrl, onSuccess }: Props) {
  const { t } = useTranslation();
  const error = useAuthStore((s) => s.error);
  const isLoading = useAuthStore((s) => s.isLoading);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const result = await useAuthStore.getState().login(apiUrl, { email, password });
    if (result.ok) onSuccess();
  }

  const errorKey = error ?? "";
  const errorMsg = errorKey ? t(`auth.errors.${errorKey}` as const, { defaultValue: t("auth.errors.unknown") }) : "";

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4 max-w-sm mx-auto">
      <h1 className="text-xl font-semibold">{t("auth.loginTitle")}</h1>
      <label className="flex flex-col gap-1">
        <span className="text-sm">{t("auth.email")}</span>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="rounded border px-3 py-2"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm">{t("auth.password")}</span>
        <input
          type="password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="rounded border px-3 py-2"
        />
      </label>
      {errorMsg && <div className="text-sm text-red-600">{errorMsg}</div>}
      <button type="submit" disabled={isLoading} className="rounded bg-black text-white px-4 py-2 disabled:opacity-50">
        {t("auth.loginSubmit")}
      </button>
      <DiscordLoginButton apiUrl={apiUrl} />
    </form>
  );
}
```

- [ ] **Step 4: Run**

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add editor/src/features/auth/LoginForm.tsx editor/src/features/auth/LoginForm.test.tsx
git commit -m "feat(editor): LoginForm"
```

---

## Task 20: DiscordLoginButton

**Files:**
- Create: `editor/src/features/auth/DiscordLoginButton.tsx`

- [ ] **Step 1: Implémenter**

```tsx
// editor/src/features/auth/DiscordLoginButton.tsx
import { useTranslation } from "react-i18next";

interface Props { apiUrl: string }

export function DiscordLoginButton({ apiUrl }: Props) {
  const { t } = useTranslation();
  function onClick() {
    window.location.href = `${apiUrl}/api/auth/discord/start`;
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded bg-[#5865F2] text-white px-4 py-2"
    >
      {t("auth.discordButton")}
    </button>
  );
}
```

- [ ] **Step 2: Commit** (pas de test isolé : l'utilité est triviale et le test est déjà couvert par les tests de LoginForm/SignupForm qui le rendent)

```bash
git add editor/src/features/auth/DiscordLoginButton.tsx
git commit -m "feat(editor): DiscordLoginButton"
```

---

## Task 21: SignupForm

**Files:**
- Create: `editor/src/features/auth/SignupForm.tsx`
- Create: `editor/src/features/auth/SignupForm.test.tsx`

- [ ] **Step 1: Tests**

```tsx
// editor/src/features/auth/SignupForm.test.tsx
import { describe, expect, test, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SignupForm } from "./SignupForm";
import { useAuthStore } from "@/state/authStore";

beforeEach(() => {
  useAuthStore.setState({ currentUser: null, isLoading: false, error: null });
  vi.restoreAllMocks();
});

describe("SignupForm", () => {
  test("submits email + password + name", async () => {
    const signupSpy = vi.spyOn(useAuthStore.getState(), "signup").mockResolvedValue({ ok: true });
    render(<SignupForm apiUrl="http://x" onSuccess={() => {}} />);
    await userEvent.type(screen.getByLabelText(/^email$/i), "n@e.com");
    await userEvent.type(screen.getByLabelText(/password|mot de passe/i), "longenoughpw");
    await userEvent.type(screen.getByLabelText(/^name|^nom/i), "Nathan");
    await userEvent.click(screen.getByRole("button", { name: /sign up|s'inscrire/i }));
    expect(signupSpy).toHaveBeenCalledWith("http://x", { email: "n@e.com", password: "longenoughpw", name: "Nathan" });
  });

  test("shows email_taken error on 409", async () => {
    vi.spyOn(useAuthStore.getState(), "signup").mockResolvedValue({ ok: false, error: "email_taken", status: 409 });
    render(<SignupForm apiUrl="http://x" onSuccess={() => {}} />);
    await userEvent.type(screen.getByLabelText(/^email$/i), "taken@e.com");
    await userEvent.type(screen.getByLabelText(/password|mot de passe/i), "longenoughpw");
    await userEvent.type(screen.getByLabelText(/^name|^nom/i), "T");
    await userEvent.click(screen.getByRole("button", { name: /sign up|s'inscrire/i }));
    expect(await screen.findByText(/already exists|déjà/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run pour échec**

Expected: FAIL — module introuvable.

- [ ] **Step 3: Implémenter**

```tsx
// editor/src/features/auth/SignupForm.tsx
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "@/state/authStore";
import { DiscordLoginButton } from "./DiscordLoginButton";

interface Props {
  apiUrl: string;
  onSuccess: () => void;
}

export function SignupForm({ apiUrl, onSuccess }: Props) {
  const { t } = useTranslation();
  const error = useAuthStore((s) => s.error);
  const isLoading = useAuthStore((s) => s.isLoading);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const result = await useAuthStore.getState().signup(apiUrl, { email, password, name });
    if (result.ok) onSuccess();
  }

  const errorKey = error ?? "";
  const errorMsg = errorKey ? t(`auth.errors.${errorKey}` as const, { defaultValue: t("auth.errors.unknown") }) : "";

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4 max-w-sm mx-auto">
      <h1 className="text-xl font-semibold">{t("auth.signupTitle")}</h1>
      <label className="flex flex-col gap-1">
        <span className="text-sm">{t("auth.email")}</span>
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
          className="rounded border px-3 py-2" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm">{t("auth.password")}</span>
        <input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)}
          className="rounded border px-3 py-2" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm">{t("auth.name")}</span>
        <input type="text" required value={name} onChange={(e) => setName(e.target.value)}
          className="rounded border px-3 py-2" />
      </label>
      {errorMsg && <div className="text-sm text-red-600">{errorMsg}</div>}
      <button type="submit" disabled={isLoading} className="rounded bg-black text-white px-4 py-2 disabled:opacity-50">
        {t("auth.signupSubmit")}
      </button>
      <DiscordLoginButton apiUrl={apiUrl} />
    </form>
  );
}
```

- [ ] **Step 4: Run**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add editor/src/features/auth/SignupForm.tsx editor/src/features/auth/SignupForm.test.tsx
git commit -m "feat(editor): SignupForm"
```

---

## Task 22: LogoutButton

**Files:**
- Create: `editor/src/features/auth/LogoutButton.tsx`
- Create: `editor/src/features/auth/LogoutButton.test.tsx`

- [ ] **Step 1: Test**

```tsx
// editor/src/features/auth/LogoutButton.test.tsx
import { describe, expect, test, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LogoutButton } from "./LogoutButton";
import { useAuthStore } from "@/state/authStore";

beforeEach(() => {
  useAuthStore.setState({ currentUser: { id: "u", email: "x@y.z", name: "X", avatarUrl: null }, isLoading: false, error: null });
  vi.restoreAllMocks();
});

describe("LogoutButton", () => {
  test("calls authStore.logout on click", async () => {
    const spy = vi.spyOn(useAuthStore.getState(), "logout").mockResolvedValue();
    render(<LogoutButton apiUrl="http://x" />);
    await userEvent.click(screen.getByRole("button", { name: /sign out|déconnexion/i }));
    expect(spy).toHaveBeenCalledWith("http://x");
  });
});
```

- [ ] **Step 2: Run pour échec**

Expected: FAIL — module introuvable.

- [ ] **Step 3: Implémenter**

```tsx
// editor/src/features/auth/LogoutButton.tsx
import { useTranslation } from "react-i18next";
import { useAuthStore } from "@/state/authStore";

interface Props { apiUrl: string }

export function LogoutButton({ apiUrl }: Props) {
  const { t } = useTranslation();
  async function onClick() {
    await useAuthStore.getState().logout(apiUrl);
  }
  return (
    <button type="button" onClick={onClick} className="rounded border px-3 py-1 text-sm">
      {t("auth.logout")}
    </button>
  );
}
```

- [ ] **Step 4: Run**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add editor/src/features/auth/LogoutButton.tsx editor/src/features/auth/LogoutButton.test.tsx
git commit -m "feat(editor): LogoutButton"
```

---

## Task 23: Routes TanStack `/login`, `/signup`, `/account`

**Files:**
- Create: `editor/src/routes/login.tsx`
- Create: `editor/src/routes/signup.tsx`
- Create: `editor/src/routes/account.tsx`

- [ ] **Step 1: Login route**

```tsx
// editor/src/routes/login.tsx
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { LoginForm } from "@/features/auth/LoginForm";

export const Route = createFileRoute("/login")({ component: LoginPage });

function LoginPage() {
  const navigate = useNavigate();
  const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:3001";
  return (
    <div className="min-h-screen flex items-center justify-center p-8">
      <LoginForm apiUrl={apiUrl} onSuccess={() => navigate({ to: "/account" })} />
    </div>
  );
}
```

- [ ] **Step 2: Signup route**

```tsx
// editor/src/routes/signup.tsx
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { SignupForm } from "@/features/auth/SignupForm";

export const Route = createFileRoute("/signup")({ component: SignupPage });

function SignupPage() {
  const navigate = useNavigate();
  const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:3001";
  return (
    <div className="min-h-screen flex items-center justify-center p-8">
      <SignupForm apiUrl={apiUrl} onSuccess={() => navigate({ to: "/account" })} />
    </div>
  );
}
```

- [ ] **Step 3: Account route**

```tsx
// editor/src/routes/account.tsx
import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "@/state/authStore";
import { LogoutButton } from "@/features/auth/LogoutButton";

export const Route = createFileRoute("/account")({ component: AccountPage });

function AccountPage() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.currentUser);
  const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-8">
        <p>{t("auth.account.signedInAs")} ?</p>
        <Link to="/login" className="underline">{t("auth.loginSubmit")}</Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-xl font-semibold">{t("auth.account.title")}</h1>
      <p className="text-muted-foreground">{t("auth.account.signedInAs")} <strong>{user.name}</strong> ({user.email})</p>
      <LogoutButton apiUrl={apiUrl} />
    </div>
  );
}
```

- [ ] **Step 4: Régénérer les routes**

Run: `cd editor && npm run generate-routes`
Expected: Met à jour `editor/src/routeTree.gen.ts`.

- [ ] **Step 5: Vérifier la compilation**

Run: `cd editor && npm run build`
Expected: pas d'erreur TS.

- [ ] **Step 6: Commit**

```bash
git add editor/src/routes/login.tsx editor/src/routes/signup.tsx editor/src/routes/account.tsx editor/src/routeTree.gen.ts
git commit -m "feat(editor): routes /login, /signup, /account"
```

---

## Task 24: Hydrate authStore au boot dans `__root.tsx`

**Files:**
- Modify: `editor/src/routes/__root.tsx`

- [ ] **Step 1: Modifier `RootLayout` pour appeler `useAuthStore.getState().hydrate`**

```tsx
// editor/src/routes/__root.tsx

// Ajouter dans les imports (à côté de useEffect, useRef déjà présents) :
import { useAuthStore } from "@/state/authStore";

// Modifier le composant RootLayout :
function RootLayout() {
  usePackAutoSave();
  useEffect(() => {
    const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:3001";
    useAuthStore.getState().hydrate(apiUrl);
  }, []);
  return (
    <div className="h-full">
      <Outlet />
    </div>
  );
}
```

- [ ] **Step 3: Run editor dev**

Run: `cd editor && npm run dev` (background, kill après vérif)
Vérif manuelle : ouvrir `http://localhost:5173/account` non-connecté → voit le lien login. Aller à `/login`, créer un compte via `/signup` d'abord. Après signup → redirect `/account` → voit le profil + bouton logout.

- [ ] **Step 4: Run all editor tests**

Run: `cd editor && npx vitest run`
Expected: pas de régression.

- [ ] **Step 5: Commit**

```bash
git add editor/src/routes/__root.tsx
git commit -m "feat(editor): hydrate authStore au boot"
```

---

# Phase F — Documentation

## Task 25: Update CLAUDE.md (endpoints + env vars + test counts)

**Files:**
- Modify: `CLAUDE.md` (project root)

- [ ] **Step 1: Ajouter une section auth dans le tableau endpoints**

Ajouter dans la section "Custom Items — endpoints et cache" un nouveau bloc avant ou après :

```markdown
## Auth — endpoints

| Endpoint | Description |
|---|---|
| `POST /api/auth/signup` | Crée un user (email+password+name). Body JSON. 201 + Set-Cookie `ifz_user_session`. Erreurs : 400 invalid_body, 409 email_taken, 422 invalid_email / weak_password. |
| `POST /api/auth/login` | Authentifie email+password. 200 + Set-Cookie. Erreur : 401 invalid_credentials. |
| `POST /api/auth/logout` | Détruit la session courante (si présente), clear le cookie. Toujours 204. |
| `GET /api/auth/me` | Retourne le user courant. 200 `{ user }` ou 401 si pas de session. |
| `GET /api/auth/discord/start` | Redirige vers Discord pour OAuth (set cookie `ifz_oauth_state`). 500 si Discord pas configuré. |
| `GET /api/auth/discord/callback?code&state` | Callback OAuth : exchange code, fetch user Discord, crée/lien user + session, redirige vers `${EDITOR_URL}/account`. |

Cookies utilisés :
- `ifz_user_session` (HttpOnly, 30 jours) — référence la row `user_sessions.id`.
- `ifz_oauth_state` (HttpOnly, 10 min) — anti-CSRF pour le flow Discord.

Tables Drizzle ajoutées : `users`, `user_sessions`, `discord_accounts`.

Distinct du flow trust dance existant (server_keys + editor_sessions) — les deux cookies (`ifz_user_session` et `ifz_refresh`) coexistent.
```

- [ ] **Step 2: Ajouter les env vars dans la section "Variables d'environnement"**

```markdown
| `DISCORD_CLIENT_ID` | (vide) | OAuth Discord — laisser vide désactive le bouton "Continue with Discord" |
| `DISCORD_CLIENT_SECRET` | (vide) | OAuth Discord |
| `DISCORD_REDIRECT_URI` | `http://localhost:3001/api/auth/discord/callback` | URI de callback configurée dans la Discord Developer Portal |
```

- [ ] **Step 3: Bump le test count**

Trouver la section "Tests — ce qui est couvert" et bumper la ligne backend de `~314 total` à un nombre actualisé (~340 après ce plan). Préciser dans la liste : "`auth.test.ts`, `passwordHasher.test.ts`, `sessionManager.test.ts`, `emailNormalizer.test.ts`, `discordOauth.test.ts`, `routes/discordOauth.test.ts`, `userAuth.test.ts`". Idem côté editor : ajout de `authStore.test.ts`, `LoginForm.test.tsx`, `SignupForm.test.tsx`, `LogoutButton.test.tsx`.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: endpoints auth, env vars Discord OAuth, bump test counts"
```

---

## Task 26: Update doc-impact-map.yaml (sync-docs)

**Files:**
- Modify: `.claude/skills/sync-docs/doc-impact-map.yaml` (si présent)

- [ ] **Step 1: Vérifier l'existence du fichier**

Run: `ls .claude/skills/sync-docs/doc-impact-map.yaml 2>/dev/null || echo "absent"`

- [ ] **Step 2: Si présent, ajouter une entrée**

```yaml
# .claude/skills/sync-docs/doc-impact-map.yaml — append :
- pattern: "backend/src/routes/auth.ts"
  docs:
    - "CLAUDE.md#auth"
- pattern: "backend/src/routes/discordOauth.ts"
  docs:
    - "CLAUDE.md#auth"
- pattern: "backend/src/db/schema.ts"
  docs:
    - "CLAUDE.md#auth"
    - "CLAUDE.md#tables"
```

(Si le fichier n'existe pas ou utilise un format différent, sauter cette tâche.)

- [ ] **Step 3: Commit (si modifié)**

```bash
git add .claude/skills/sync-docs/doc-impact-map.yaml
git commit -m "docs: sync-docs map — auth routes"
```

---

# Vérification finale

## Task 27: Full test runs

- [ ] **Step 1: Backend**

Run: `cd backend && bun test`
Expected: tous les tests passent (existants + ~30 nouveaux).

- [ ] **Step 2: Editor**

Run: `cd editor && npx vitest run`
Expected: tous les tests passent (existants + ~10 nouveaux).

- [ ] **Step 3: Editor build**

Run: `cd editor && npm run build`
Expected: build TS+Vite sans erreur.

- [ ] **Step 4: Smoke manuel end-to-end (recommandé)**

1. Backend up : `cd backend && bun run dev`
2. Editor up : `cd editor && npm run dev`
3. `http://localhost:5173/signup` → créer compte → redirect `/account` → voir profil.
4. Logout → `/account` montre lien `/login`.
5. `/login` → re-login avec les mêmes creds → `/account`.
6. (Optionnel) Configurer DISCORD_CLIENT_ID/SECRET/REDIRECT, redémarrer backend, tester bouton "Continue with Discord".

- [ ] **Step 5: Commit final si quoi que ce soit a bougé pendant les vérif**

```bash
git status
# si rien : passe
# sinon : git add <fichier> && git commit -m "chore: vérif finale Phase 1A"
```

---

# Récap des tâches

27 tâches au total, organisées en 6 phases :
- **A (Tasks 1-6)** : schéma + helpers password/session + middleware
- **B (Tasks 7-10)** : routes signup/login/logout/me
- **C (Tasks 11-15)** : Discord OAuth (helpers + routes)
- **D (Tasks 16-17)** : editor API client + authStore
- **E (Tasks 18-24)** : i18n + LoginForm + SignupForm + DiscordLoginButton + LogoutButton + routes
- **F (Tasks 25-27)** : docs + vérif finale

Estimation : 2-4 jours en sub-agent driven (parallélisable B/C/D/E), ~5-7 jours en exécution inline.

Plans suivants pour compléter Phase 1 du design exploratoire :
- **Plan 1B** : Network + Membership + Pack first-class + Assets per-pack + ServerKey ownership + PackBinding + migration wipe
- **Plan 1C** : Setup flow login→network→pack + retrait UI conflits récente
