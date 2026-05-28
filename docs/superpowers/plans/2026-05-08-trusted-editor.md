# Trusted Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sécuriser les sessions éditeur via refresh tokens (sessions 7 jours safe), trust in-game obligatoire avant deploy, et IP binding sur le trust.

**Architecture:** Le token dans l'URL devient one-time (consommé à la 1ère visite via `/exchange`). L'éditeur obtient un `access_token` 5 min (mémoire JS) + `refresh_token` HttpOnly cookie 7 jours. Le deploy est bloqué tant que `/artisan trusteditor <code>` n'a pas été tapé in-game — ce qui pose `trusted_ip`. Si l'IP change, il faut re-truster (session intacte, juste deploy re-bloqué).

**Tech Stack:** Bun + Hono + Drizzle/PostgreSQL (backend) · Kotlin 2.0 + Paper (plugin) · React 19 + Vite + Zustand (editor)

---

## File Map

| Fichier | Action | Rôle |
|---|---|---|
| `backend/src/db/schema.ts` | Modify | 7 nouvelles colonnes sur `editor_sessions` |
| `backend/src/lib/auth.ts` | Modify | `generateTrustCode`, `validateAccessToken`, `findSessionByTrustCode`, `trackEditorIp` |
| `backend/src/protocol.ts` | Modify | `EditorTrustRequestMessage`, `SessionTrustedMessage`, update `EditorSessionReadyMessage` |
| `backend/src/routes/editorSession.ts` | Modify | exchange route, cookie refresh route, update toutes les routes → access_token, deploy gate |
| `backend/src/ws/hub.ts` | Modify | `editorTokenToIp` map, handler `editor_trust_request`, export `trackEditorIp` |
| `backend/src/app.ts` | Modify | IP capture sur connexion WS éditeur |
| `backend/src/routes/editorSession.test.ts` | Modify | Update `createSession`, nouveaux tests exchange/refresh/trust/deploy |
| `backend/src/ws/hub.test.ts` | Modify | Test trust flow |
| `plugin/.../provider/MenuProvider.kt` | Modify | Ajout `sendTrustRequest(code: String)` |
| `plugin/.../provider/SyncedMenuProvider.kt` | Modify | Store trust_code, envoie trust_request, gère session_trusted |
| `plugin/.../command/ArtisanCommand.kt` | Modify | Subcommand `trusteditor` |
| `editor/src/lib/editorSession.ts` | Modify | `exchangeEditorSession`, `refreshEditorSession` sans token (cookie) |
| `editor/src/state/sessionStore.ts` | Modify | Ajoute `accessToken`, `trustCode`, `trusted`; enlève persist |
| `editor/src/routes/session.tsx` | Modify | Exchange/refresh au chargement, intervalle 4 min |
| `editor/src/lib/editorWs.ts` | Modify | Handler `session_trusted` |
| `editor/src/lib/packApi.ts` | Modify | `deployPack` throw `DeployError` typé sur 403 |
| `editor/src/features/trust/TrustBanner.tsx` | Create | Bandeau "Tapez /artisan trusteditor <code>" |
| `editor/src/routes/pack.$packId.tsx` | Modify | Intègre TrustBanner, gère `DeployError` |

---

## Task 1: DB schema — 7 nouvelles colonnes

**Files:**
- Modify: `backend/src/db/schema.ts`

- [ ] **Écrire le test qui vérifie que les nouvelles colonnes existent et sont nullables par défaut**

Dans `backend/src/routes/editorSession.test.ts`, ajouter dans le `describe("editor_sessions schema")` existant :

```typescript
test("new security columns default to null", async () => {
  const keyId = crypto.randomUUID();
  await db.insert(serverKeys).values({ id: keyId, hash: "sc" + keyId.slice(0,8), createdAt: new Date() });
  const token = "schema_test_" + crypto.randomUUID().slice(0, 8);
  await db.insert(editorSessions).values({
    token, serverKeyId: keyId, createdBy: "test",
    createdAt: new Date(), expiresAt: new Date(Date.now() + 30 * 60 * 1000),
  });
  const rows = await db.select().from(editorSessions).where(eq(editorSessions.token, token));
  expect(rows[0].exchangedAt).toBeNull();
  expect(rows[0].refreshToken).toBeNull();
  expect(rows[0].accessToken).toBeNull();
  expect(rows[0].accessExpiresAt).toBeNull();
  expect(rows[0].trustCode).toBeNull();
  expect(rows[0].trustedAt).toBeNull();
  expect(rows[0].trustedIp).toBeNull();
});
```

- [ ] **Lancer le test — il doit échouer (colonnes inexistantes)**

```bash
cd backend && bun test src/routes/editorSession.test.ts --testNamePattern "new security columns"
```

Attendu : erreur "column does not exist" ou TypeScript error.

- [ ] **Mettre à jour le schéma**

Dans `backend/src/db/schema.ts`, remplacer la table `editorSessions` par :

```typescript
export const editorSessions = pgTable("editor_sessions", {
  token:           text("token").primaryKey(),
  serverKeyId:     text("server_key_id").notNull().references(() => serverKeys.id),
  createdBy:       text("created_by").notNull(),
  createdAt:       timestamp("created_at").notNull(),
  expiresAt:       timestamp("expires_at").notNull(),
  revokedAt:       timestamp("revoked_at"),
  exchangedAt:     timestamp("exchanged_at"),
  refreshToken:    text("refresh_token"),
  accessToken:     text("access_token"),
  accessExpiresAt: timestamp("access_expires_at"),
  trustCode:       text("trust_code"),
  trustedAt:       timestamp("trusted_at"),
  trustedIp:       text("trusted_ip"),
});
```

- [ ] **Appliquer la migration**

```bash
cd backend && bun run db:push
```

Attendu : "Changes applied" avec les 7 nouvelles colonnes.

- [ ] **Lancer le test — il doit passer**

```bash
cd backend && bun test src/routes/editorSession.test.ts --testNamePattern "new security columns"
```

- [ ] **Vérifier que tous les tests existants passent encore**

```bash
cd backend && bun test
```

Attendu : tous les tests existants passent (nouvelles colonnes sont nullable, les inserts existants sont compatibles).

- [ ] **Commit**

```bash
git add backend/src/db/schema.ts backend/src/routes/editorSession.test.ts
git commit -m "feat(backend): add trusted editor columns to editor_sessions schema"
```

---

## Task 2: Protocol — nouveaux types de messages

**Files:**
- Modify: `backend/src/protocol.ts`

- [ ] **Ajouter les nouveaux messages au protocole**

Dans `backend/src/protocol.ts`, ajouter après `EditorSessionRevokeMessage` :

```typescript
// Plugin → backend : demande de trust d'une session éditeur
export interface EditorTrustRequestMessage {
  type: "editor_trust_request";
  trust_code: string;
}

// Backend → éditeur WS : la session vient d'être trustée
export interface SessionTrustedMessage { type: "session_trusted" }
```

Mettre à jour `EditorSessionReadyMessage` :

```typescript
export interface EditorSessionReadyMessage {
  type: "editor_session_ready";
  url: string;
  expires_at: string;
  trust_code: string;
}
```

Mettre à jour les unions de types :

```typescript
export type PluginToServerMessage =
  | HelloMessage
  | PongMessage
  | SetupRequestMessage
  | SetupClaimMessage
  | EditorSessionRequestMessage
  | EditorSessionRevokeMessage
  | EditorTrustRequestMessage;

export type ServerToPluginMessage =
  | HelloAckMessage
  | BundleAvailableMessage
  | DraftUpdateMessage
  | PingMessage
  | SetupCodeMessage
  | LinkConfirmedMessage
  | EditorSessionReadyMessage;
```

- [ ] **Vérifier que le projet compile sans erreur TypeScript**

```bash
cd backend && bun run --bun tsc --noEmit 2>&1 | head -20
```

Attendu : aucune erreur.

- [ ] **Commit**

```bash
git add backend/src/protocol.ts
git commit -m "feat(backend): add EditorTrustRequest and SessionTrusted protocol messages"
```

---

## Task 3: Auth — helpers sécurité

**Files:**
- Modify: `backend/src/lib/auth.ts`

- [ ] **Écrire les tests pour les nouveaux helpers**

Ajouter dans `backend/src/routes/editorSession.test.ts` (section imports en haut) :

```typescript
import { generateTrustCode, validateAccessToken, findSessionByTrustCode } from "../lib/auth";
```

Ajouter un nouveau `describe` :

```typescript
describe("generateTrustCode", () => {
  test("returns 6-char uppercase alphanumeric code", () => {
    const code = generateTrustCode();
    expect(code).toHaveLength(6);
    expect(code).toMatch(/^[A-Z2-9]{6}$/);
  });

  test("two calls produce different codes", () => {
    expect(generateTrustCode()).not.toBe(generateTrustCode());
  });
});

describe("validateAccessToken", () => {
  test("returns session for valid access token", async () => {
    const keyId = crypto.randomUUID();
    await db.insert(serverKeys).values({ id: keyId, hash: "vat" + keyId.slice(0,8), createdAt: new Date() });
    const urlToken = "url_" + crypto.randomUUID().slice(0, 8);
    const accessToken = generateEditorToken();
    await db.insert(editorSessions).values({
      token: urlToken, serverKeyId: keyId, createdBy: "test",
      createdAt: new Date(), expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      exchangedAt: new Date(), accessToken, accessExpiresAt: new Date(Date.now() + 5 * 60 * 1000),
      trustCode: "ABC123",
    });
    const result = await validateAccessToken(accessToken);
    expect(result).not.toBeNull();
    expect(result!.serverKeyId).toBe(keyId);
    expect(result!.sessionId).toBe(urlToken);
    expect(result!.trusted).toBe(false);
    expect(result!.trustCode).toBe("ABC123");
    expect(result!.trustedIp).toBeNull();
  });

  test("returns null for unknown access token", async () => {
    expect(await validateAccessToken("notavalidaccesstoken000000000")).toBeNull();
  });

  test("returns null for expired access token", async () => {
    const keyId = crypto.randomUUID();
    await db.insert(serverKeys).values({ id: keyId, hash: "exp" + keyId.slice(0,8), createdAt: new Date() });
    const urlToken = "url_exp_" + crypto.randomUUID().slice(0, 8);
    const accessToken = generateEditorToken();
    await db.insert(editorSessions).values({
      token: urlToken, serverKeyId: keyId, createdBy: "test",
      createdAt: new Date(), expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      exchangedAt: new Date(), accessToken,
      accessExpiresAt: new Date(Date.now() - 1),
    });
    expect(await validateAccessToken(accessToken)).toBeNull();
  });

  test("returns trusted=true when trustedAt is set", async () => {
    const keyId = crypto.randomUUID();
    await db.insert(serverKeys).values({ id: keyId, hash: "tr" + keyId.slice(0,8), createdAt: new Date() });
    const urlToken = "url_tr_" + crypto.randomUUID().slice(0, 8);
    const accessToken = generateEditorToken();
    await db.insert(editorSessions).values({
      token: urlToken, serverKeyId: keyId, createdBy: "test",
      createdAt: new Date(), expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      exchangedAt: new Date(), accessToken, accessExpiresAt: new Date(Date.now() + 5 * 60 * 1000),
      trustCode: "XYZ789", trustedAt: new Date(), trustedIp: "1.2.3.4",
    });
    const result = await validateAccessToken(accessToken);
    expect(result!.trusted).toBe(true);
    expect(result!.trustedIp).toBe("1.2.3.4");
  });
});

describe("findSessionByTrustCode", () => {
  test("finds a session by trust_code", async () => {
    const keyId = crypto.randomUUID();
    await db.insert(serverKeys).values({ id: keyId, hash: "fc" + keyId.slice(0,8), createdAt: new Date() });
    const urlToken = "url_fc_" + crypto.randomUUID().slice(0, 8);
    const accessToken = generateEditorToken();
    await db.insert(editorSessions).values({
      token: urlToken, serverKeyId: keyId, createdBy: "test",
      createdAt: new Date(), expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      exchangedAt: new Date(), accessToken, accessExpiresAt: new Date(Date.now() + 5 * 60 * 1000),
      trustCode: "FIND42",
    });
    const result = await findSessionByTrustCode("FIND42");
    expect(result).not.toBeNull();
    expect(result!.urlToken).toBe(urlToken);
    expect(result!.accessToken).toBe(accessToken);
    expect(result!.serverKeyId).toBe(keyId);
  });

  test("returns null for unknown code", async () => {
    expect(await findSessionByTrustCode("XXXXXX")).toBeNull();
  });
});
```

- [ ] **Lancer les tests — ils doivent échouer**

```bash
cd backend && bun test src/routes/editorSession.test.ts --testNamePattern "generateTrustCode|validateAccessToken|findSessionByTrustCode"
```

Attendu : erreur "is not a function".

- [ ] **Implémenter les helpers dans `backend/src/lib/auth.ts`**

Ajouter après `generateEditorToken` :

```typescript
export function generateTrustCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => CODE_CHARS[b % CODE_CHARS.length]).join("");
}

export async function validateAccessToken(
  token: string,
): Promise<{ serverKeyId: string; sessionId: string; trusted: boolean; trustCode: string; trustedIp: string | null } | null> {
  const rows = await db.select().from(editorSessions).where(eq(editorSessions.accessToken, token));
  if (rows.length === 0) return null;
  const row = rows[0];
  if (row.revokedAt) return null;
  if (!row.accessExpiresAt || row.accessExpiresAt < new Date()) return null;
  return {
    serverKeyId: row.serverKeyId,
    sessionId: row.token,
    trusted: row.trustedAt != null,
    trustCode: row.trustCode ?? "",
    trustedIp: row.trustedIp ?? null,
  };
}

export async function findSessionByTrustCode(
  trustCode: string,
): Promise<{ urlToken: string; accessToken: string | null; serverKeyId: string } | null> {
  const rows = await db.select().from(editorSessions).where(eq(editorSessions.trustCode, trustCode));
  if (rows.length === 0) return null;
  const row = rows[0];
  if (row.revokedAt || row.expiresAt < new Date()) return null;
  return { urlToken: row.token, accessToken: row.accessToken, serverKeyId: row.serverKeyId };
}
```

Ajouter l'import de `findSessionByTrustCode` manquant dans les imports en haut de `auth.ts` (déjà importé `editorSessions` + `eq` + `db`).

- [ ] **Lancer les tests — ils doivent passer**

```bash
cd backend && bun test src/routes/editorSession.test.ts --testNamePattern "generateTrustCode|validateAccessToken|findSessionByTrustCode"
```

- [ ] **Commit**

```bash
git add backend/src/lib/auth.ts backend/src/routes/editorSession.test.ts
git commit -m "feat(backend): generateTrustCode, validateAccessToken, findSessionByTrustCode"
```

---

## Task 4: Exchange endpoint

**Files:**
- Modify: `backend/src/routes/editorSession.ts`
- Modify: `backend/src/routes/editorSession.test.ts`

- [ ] **Écrire les tests**

Ajouter dans `editorSession.test.ts` un nouveau helper et describe :

```typescript
async function createRawSession(): Promise<{ urlToken: string; keyId: string }> {
  const keyId = crypto.randomUUID();
  await db.insert(serverKeys).values({ id: keyId, hash: "raw" + keyId.slice(0,8), createdAt: new Date() });
  const urlToken = "url_" + generateEditorToken();
  const trustCode = generateTrustCode();
  await db.insert(editorSessions).values({
    token: urlToken, serverKeyId: keyId, createdBy: "CONSOLE",
    createdAt: new Date(), expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    trustCode,
  });
  return { urlToken, keyId };
}

describe("POST /api/editor-session/:urlToken/exchange", () => {
  test("200 returns access_token + trust_code, sets cookie", async () => {
    const { urlToken } = await createRawSession();
    const res = await app.request(`/api/editor-session/${urlToken}/exchange`, { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json() as { access_token: string; expires_in: number; trust_code: string };
    expect(typeof body.access_token).toBe("string");
    expect(body.access_token.length).toBeGreaterThan(0);
    expect(body.expires_in).toBe(300);
    expect(typeof body.trust_code).toBe("string");
    expect(body.trust_code.length).toBe(6);
    const cookie = res.headers.get("set-cookie");
    expect(cookie).toContain("artisan_refresh=");
    expect(cookie).toContain("HttpOnly");
  });

  test("401 already_used on second call", async () => {
    const { urlToken } = await createRawSession();
    await app.request(`/api/editor-session/${urlToken}/exchange`, { method: "POST" });
    const res2 = await app.request(`/api/editor-session/${urlToken}/exchange`, { method: "POST" });
    expect(res2.status).toBe(401);
    const body = await res2.json() as { error: string };
    expect(body.error).toBe("already_used");
  });

  test("401 for unknown url token", async () => {
    const res = await app.request("/api/editor-session/unknowntoken000000000000000000/exchange", { method: "POST" });
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Lancer les tests — ils doivent échouer**

```bash
cd backend && bun test src/routes/editorSession.test.ts --testNamePattern "exchange"
```

Attendu : 404 (route inexistante).

- [ ] **Implémenter l'endpoint exchange dans `editorSession.ts`**

Ajouter en haut du fichier :

```typescript
import { getCookie, setCookie } from "hono/cookie";
import { generateEditorToken, generateTrustCode, validateAccessToken, findSessionByTrustCode } from "../lib/auth";
```

Remplacer l'import existant de `validateEditorToken` par `validateAccessToken` (on va l'utiliser dans toutes les routes). Ajouter avant les routes existantes :

```typescript
router.post("/refresh", async (c) => {
  // Implémenté en Task 5 — placeholder pour l'ordre des routes
});

router.post("/:urlToken/exchange", async (c) => {
  const urlToken = c.req.param("urlToken");
  const rows = await db.select().from(editorSessions).where(eq(editorSessions.token, urlToken));
  if (rows.length === 0) return c.json({ error: "Unauthorized" }, 401);
  const row = rows[0];
  if (row.revokedAt || row.expiresAt < new Date()) return c.json({ error: "Unauthorized" }, 401);
  if (row.exchangedAt) return c.json({ error: "already_used" }, 401);

  const accessToken = generateEditorToken();
  const refreshToken = generateEditorToken();
  const accessExpiresAt = new Date(Date.now() + 5 * 60 * 1000);
  const trustCode = row.trustCode ?? generateTrustCode();

  await db.update(editorSessions)
    .set({ exchangedAt: new Date(), accessToken, accessExpiresAt, refreshToken, trustCode })
    .where(eq(editorSessions.token, urlToken));

  setCookie(c, "artisan_refresh", refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "Strict",
    maxAge: 7 * 24 * 60 * 60,
    path: "/api/editor-session/refresh",
  });

  return c.json({ access_token: accessToken, expires_in: 300, trust_code: trustCode });
});
```

- [ ] **Lancer les tests exchange**

```bash
cd backend && bun test src/routes/editorSession.test.ts --testNamePattern "exchange"
```

- [ ] **Mettre à jour `createSession` pour utiliser exchange**

Remplacer le helper `createSession` dans `editorSession.test.ts` par :

```typescript
async function createSession(serverId?: string): Promise<{ token: string; keyId: string }> {
  const keyId = serverId ?? crypto.randomUUID();
  if (!serverId) {
    await db.insert(serverKeys).values({ id: keyId, hash: "sh" + keyId.slice(0,8), createdAt: new Date() });
  }
  const urlToken = "url_" + generateEditorToken();
  const trustCode = generateTrustCode();
  await db.insert(editorSessions).values({
    token: urlToken, serverKeyId: keyId, createdBy: "CONSOLE",
    createdAt: new Date(), expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    trustCode,
  });
  const res = await app.request(`/api/editor-session/${urlToken}/exchange`, { method: "POST" });
  const { access_token } = await res.json() as { access_token: string };
  return { token: access_token, keyId };
}
```

Ajouter aussi un helper `createTrustedSession` (utilisé en Task 7) :

```typescript
async function createTrustedSession(): Promise<{ token: string; keyId: string }> {
  const { token, keyId } = await createSession();
  const rows = await db.select().from(editorSessions).where(eq(editorSessions.accessToken, token));
  await db.update(editorSessions)
    .set({ trustedAt: new Date(), trustedIp: "unknown" })
    .where(eq(editorSessions.token, rows[0].token));
  return { token, keyId };
}
```

- [ ] **Lancer tous les tests backend pour vérifier que les tests existants passent toujours**

```bash
cd backend && bun test
```

Certains tests vont maintenant échouer parce que `GET /:token` attend un access_token mais reçoit le vieux url_token — c'est attendu, on les fixe en Task 6.

- [ ] **Commit**

```bash
git add backend/src/routes/editorSession.ts backend/src/routes/editorSession.test.ts
git commit -m "feat(backend): POST /exchange endpoint — one-time url token → access + refresh"
```

---

## Task 5: Cookie-based refresh endpoint

**Files:**
- Modify: `backend/src/routes/editorSession.ts`
- Modify: `backend/src/routes/editorSession.test.ts`

- [ ] **Écrire les tests**

Ajouter dans `editorSession.test.ts` :

```typescript
describe("POST /api/editor-session/refresh", () => {
  test("200 returns new access_token and rotates cookie", async () => {
    const { urlToken } = await createRawSession();
    // Exchange d'abord pour obtenir le refresh cookie
    const exchangeRes = await app.request(`/api/editor-session/${urlToken}/exchange`, { method: "POST" });
    const cookie = exchangeRes.headers.get("set-cookie") ?? "";
    const refreshToken = cookie.match(/artisan_refresh=([^;]+)/)?.[1] ?? "";
    expect(refreshToken).not.toBe("");

    const res = await app.request("/api/editor-session/refresh", {
      method: "POST",
      headers: { "Cookie": `artisan_refresh=${refreshToken}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { access_token: string; expires_in: number };
    expect(typeof body.access_token).toBe("string");
    expect(body.expires_in).toBe(300);
    // Le nouveau cookie est bien set
    expect(res.headers.get("set-cookie")).toContain("artisan_refresh=");
  });

  test("401 for unknown refresh token", async () => {
    const res = await app.request("/api/editor-session/refresh", {
      method: "POST",
      headers: { "Cookie": "artisan_refresh=unknowntoken000000000000000" },
    });
    expect(res.status).toBe(401);
  });

  test("401 when no cookie", async () => {
    const res = await app.request("/api/editor-session/refresh", { method: "POST" });
    expect(res.status).toBe(401);
  });

  test("old refresh token rejected after rotation", async () => {
    const { urlToken } = await createRawSession();
    const exchangeRes = await app.request(`/api/editor-session/${urlToken}/exchange`, { method: "POST" });
    const cookie = exchangeRes.headers.get("set-cookie") ?? "";
    const refreshToken = cookie.match(/artisan_refresh=([^;]+)/)?.[1] ?? "";

    // Premier refresh
    await app.request("/api/editor-session/refresh", {
      method: "POST",
      headers: { "Cookie": `artisan_refresh=${refreshToken}` },
    });

    // Deuxième refresh avec l'ancien token → 401
    const res2 = await app.request("/api/editor-session/refresh", {
      method: "POST",
      headers: { "Cookie": `artisan_refresh=${refreshToken}` },
    });
    expect(res2.status).toBe(401);
  });
});
```

- [ ] **Lancer les tests — ils doivent échouer**

```bash
cd backend && bun test src/routes/editorSession.test.ts --testNamePattern "POST /api/editor-session/refresh"
```

- [ ] **Implémenter le refresh endpoint (remplacer le placeholder de Task 4)**

Dans `editorSession.ts`, remplacer le placeholder `router.post("/refresh", ...)` par :

```typescript
router.post("/refresh", async (c) => {
  const token = getCookie(c, "artisan_refresh");
  if (!token) return c.json({ error: "Unauthorized" }, 401);

  const rows = await db.select().from(editorSessions).where(eq(editorSessions.refreshToken, token));
  if (rows.length === 0) return c.json({ error: "Unauthorized" }, 401);
  const row = rows[0];
  if (row.revokedAt || row.expiresAt < new Date()) return c.json({ error: "Unauthorized" }, 401);

  const newAccessToken = generateEditorToken();
  const newRefreshToken = generateEditorToken();
  const accessExpiresAt = new Date(Date.now() + 5 * 60 * 1000);

  await db.update(editorSessions)
    .set({ accessToken: newAccessToken, accessExpiresAt, refreshToken: newRefreshToken })
    .where(eq(editorSessions.token, row.token));

  setCookie(c, "artisan_refresh", newRefreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "Strict",
    maxAge: 7 * 24 * 60 * 60,
    path: "/api/editor-session/refresh",
  });

  return c.json({ access_token: newAccessToken, expires_in: 300 });
});
```

- [ ] **Lancer les tests refresh**

```bash
cd backend && bun test src/routes/editorSession.test.ts --testNamePattern "POST /api/editor-session/refresh"
```

- [ ] **Commit**

```bash
git add backend/src/routes/editorSession.ts backend/src/routes/editorSession.test.ts
git commit -m "feat(backend): POST /refresh — cookie-based token rotation"
```

---

## Task 6: Migrer toutes les routes → access_token + update GET response

**Files:**
- Modify: `backend/src/routes/editorSession.ts`
- Modify: `backend/src/app.ts`

L'objectif : toutes les routes `/:token/...` valident maintenant l'`access_token` via `validateAccessToken`. `GET /:token` retourne `{ server_key_id, trusted, trust_code }`. L'ancien `POST /:token/refresh` est supprimé. L'endpoint `/ws/editor` accepte l'access_token.

- [ ] **Mettre à jour `GET /:token`** dans `editorSession.ts` :

```typescript
router.get("/:token", async (c) => {
  if (!checkRateLimit(`editor-validate:${clientIp(c)}`, 20)) return c.json({ error: "Too many requests" }, 429);
  const token = c.req.param("token");
  const session = await validateAccessToken(token);
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  trackEditorIp(token, clientIp(c));
  return c.json({ server_key_id: session.serverKeyId, trusted: session.trusted, trust_code: session.trustCode });
});
```

Ajouter `trackEditorIp` à l'import depuis `hub.ts` :

```typescript
import { broadcastDraftUpdate, pushBundleAvailable, getMcVersion, trackEditorIp } from "../ws/hub";
```

- [ ] **Supprimer `POST /:token/refresh`** (remplacé par `/refresh` cookie-based).

Supprimer le bloc :
```typescript
router.post("/:token/refresh", async (c) => { ... });
```

- [ ] **Mettre à jour toutes les autres routes** pour utiliser `validateAccessToken` au lieu de `validateEditorToken`.

Remplacer dans toutes les routes de `editorSession.ts` :
```typescript
const session = await validateEditorToken(token);
```
par :
```typescript
const session = await validateAccessToken(token);
```

- [ ] **Mettre à jour `DELETE /:token`** — ce n'est plus une révocation par access_token mais par session_id :

```typescript
router.delete("/:token", async (c) => {
  const token = c.req.param("token");
  const session = await validateAccessToken(token);
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  await db.update(editorSessions).set({ revokedAt: new Date() })
    .where(eq(editorSessions.token, session.sessionId));
  return c.json({ ok: true });
});
```

- [ ] **Mettre à jour `/ws/editor` dans `app.ts`** — valider l'access_token (pas le url_token) et capturer l'IP :

```typescript
import { cleanupConn, cleanupEditorConn, cleanupSession, handlePluginMessage, registerConn, registerEditorConn, trackEditorIp } from "./ws/hub";
import { validateEditorToken, validateAccessToken } from "./lib/auth";
```

Dans la route `/ws/editor`, remplacer `validateEditorToken` par `validateAccessToken`, et ajouter IP tracking dans `onOpen` :

```typescript
app.get(
  "/ws/editor",
  async (c, next) => {
    const token = new URL(c.req.url).searchParams.get("token") ?? "";
    const session = token ? await validateAccessToken(token) : null;
    if (!session) return c.json({ error: "Unauthorized" }, 401);
    c.set("editorToken", token);
    c.set("editorServerId", session.serverKeyId);
    c.set("editorIp", c.req.header("x-forwarded-for") ?? c.req.header("cf-connecting-ip") ?? "unknown");
    return next();
  },
  upgradeWebSocket((c) => {
    const token = c.get("editorToken") as string;
    const serverId = c.get("editorServerId") as string;
    const ip = c.get("editorIp") as string;
    return {
      onOpen(_, ws) {
        registerEditorConn(token, serverId, (msg) => ws.send(msg));
        trackEditorIp(token, ip);
      },
      onMessage() {},
      onClose() { cleanupEditorConn(token); },
      onError: (err) => console.error("Editor WS error:", err),
    };
  }),
);
```

- [ ] **Lancer tous les tests backend**

```bash
cd backend && bun test
```

Attendu : tous les tests passent. Les tests qui utilisaient `createSession` reçoivent maintenant un access_token et toutes les routes le valident correctement.

- [ ] **Commit**

```bash
git add backend/src/routes/editorSession.ts backend/src/app.ts
git commit -m "feat(backend): migrate all routes to access_token, update GET response with trusted+trust_code"
```

---

## Task 7: Deploy gate — trusted_at + IP check

**Files:**
- Modify: `backend/src/routes/editorSession.ts`
- Modify: `backend/src/routes/editorSession.test.ts`

- [ ] **Écrire les tests**

Ajouter dans `editorSession.test.ts` :

```typescript
describe("POST /api/editor-session/:token/packs/:packId/deploy — trust gate", () => {
  const fakePayload = {
    pack: { id: "p_trust", name: "Trust Test", menus: [] },
    files: { "manifest.yaml": "pack_id: p_trust\n" },
  };

  test("403 session_not_trusted when not trusted", async () => {
    const { token } = await createSession();
    const res = await app.request(`/api/editor-session/${token}/packs/p_trust/deploy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fakePayload),
    });
    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("session_not_trusted");
  });

  test("403 session_not_trusted when trusted_ip differs", async () => {
    const { token } = await createSession();
    // Truster avec une IP différente
    const rows = await db.select().from(editorSessions).where(eq(editorSessions.accessToken, token));
    await db.update(editorSessions)
      .set({ trustedAt: new Date(), trustedIp: "5.5.5.5" })
      .where(eq(editorSessions.token, rows[0].token));

    const res = await app.request(`/api/editor-session/${token}/packs/p_trust/deploy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fakePayload),
    });
    expect(res.status).toBe(403);
    expect((await res.json() as { error: string }).error).toBe("session_not_trusted");
  });

  test("201 when session is trusted with matching IP", async () => {
    const { token } = await createTrustedSession();
    const res = await app.request(`/api/editor-session/${token}/packs/p_trust_ok/deploy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pack: { id: "p_trust_ok", name: "ok" }, files: { "manifest.yaml": "" } }),
    });
    expect(res.status).toBe(201);
  });
});
```

- [ ] **Lancer les tests — le test "403 not trusted" doit échouer (renvoie 201 actuellement)**

```bash
cd backend && bun test src/routes/editorSession.test.ts --testNamePattern "trust gate"
```

- [ ] **Ajouter le gate dans `POST /:token/packs/:packId/deploy`**

Dans `editorSession.ts`, au début du handler deploy, ajouter après la validation du token :

```typescript
router.post("/:token/packs/:packId/deploy", async (c) => {
  const token = c.req.param("token");
  const packId = c.req.param("packId");
  const session = await validateAccessToken(token);
  if (!session) return c.json({ error: "Unauthorized" }, 401);

  if (!session.trusted) return c.json({ error: "session_not_trusted" }, 403);
  if (session.trustedIp !== clientIp(c)) return c.json({ error: "session_not_trusted" }, 403);

  // ... reste du code inchangé
```

- [ ] **Lancer les tests deploy gate + tests deploy existants**

```bash
cd backend && bun test src/routes/editorSession.test.ts --testNamePattern "deploy"
```

Attendu : les 3 nouveaux tests passent. L'ancien test "201 deploys pack" passe aussi (il utilise `createTrustedSession` maintenant — vérifier et mettre à jour si nécessaire).

Mettre à jour le test "201 deploys pack, sets deployed_editor_json, pushes bundle" pour utiliser `createTrustedSession` :

```typescript
test("201 deploys pack, sets deployed_editor_json, pushes bundle", async () => {
  const { token } = await createTrustedSession(); // ← changé
  ...
```

- [ ] **Lancer tous les tests backend**

```bash
cd backend && bun test
```

- [ ] **Commit**

```bash
git add backend/src/routes/editorSession.ts backend/src/routes/editorSession.test.ts
git commit -m "feat(backend): deploy gate — blocks deploy when session not trusted or IP mismatch"
```

---

## Task 8: Hub — IP tracking + trust request handler

**Files:**
- Modify: `backend/src/ws/hub.ts`
- Modify: `backend/src/ws/hub.test.ts`

- [ ] **Écrire le test du flow trust dans `hub.test.ts`**

Ajouter après les tests existants :

```typescript
describe("editor_trust_request", () => {
  test("sets trusted_at + trusted_ip, pushes session_trusted to editor WS", async () => {
    const connId = "conn-trust-test";
    registerConn(connId, () => {});

    const { id: keyId, key, hash } = await generateServerKey();
    await db.insert(serverKeys).values({ id: keyId, hash, createdAt: new Date() });
    await handlePluginMessage(connId, JSON.stringify({
      type: "hello", server_key: key, plugin_version: "1.0", minecraft_version: "1.21", current_bundle_hash: "",
    }));

    // Créer une session avec trust_code
    const urlToken = "url_trust_" + crypto.randomUUID().slice(0, 8);
    const accessToken = generateEditorToken();
    const trustCode = generateTrustCode();
    await db.insert(editorSessions).values({
      token: urlToken, serverKeyId: keyId, createdBy: "CONSOLE",
      createdAt: new Date(), expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      exchangedAt: new Date(), accessToken, accessExpiresAt: new Date(Date.now() + 5 * 60 * 1000),
      trustCode,
    });

    // Enregistrer l'éditeur WS et son IP
    const editorReceived: string[] = [];
    registerEditorConn(accessToken, keyId, (msg) => editorReceived.push(msg));
    trackEditorIp(accessToken, "10.0.0.1");

    // Plugin envoie le trust request
    await handlePluginMessage(connId, JSON.stringify({ type: "editor_trust_request", trust_code: trustCode }));

    // L'éditeur doit avoir reçu session_trusted
    expect(editorReceived.length).toBe(1);
    expect(JSON.parse(editorReceived[0])).toMatchObject({ type: "session_trusted" });

    // La session doit être trustée en DB
    const rows = await db.select().from(editorSessions).where(eq(editorSessions.token, urlToken));
    expect(rows[0].trustedAt).not.toBeNull();
    expect(rows[0].trustedIp).toBe("10.0.0.1");
  });

  test("ignores trust request with unknown code", async () => {
    const connId = "conn-trust-unknown";
    registerConn(connId, () => {});
    const { id: keyId, key, hash } = await generateServerKey();
    await db.insert(serverKeys).values({ id: keyId, hash, createdAt: new Date() });
    await handlePluginMessage(connId, JSON.stringify({
      type: "hello", server_key: key, plugin_version: "1.0", minecraft_version: "1.21", current_bundle_hash: "",
    }));
    const result = await handlePluginMessage(connId, JSON.stringify({ type: "editor_trust_request", trust_code: "XXXXXX" }));
    expect(result.reply).toBeNull();
  });
});
```

- [ ] **Lancer les tests — ils doivent échouer**

```bash
cd backend && bun test src/ws/hub.test.ts --testNamePattern "editor_trust_request"
```

- [ ] **Implémenter dans `hub.ts`**

Ajouter en haut du fichier (dans les Maps) :

```typescript
const editorTokenToIp = new Map<string, string>();
```

Ajouter la fonction exportée :

```typescript
export function trackEditorIp(token: string, ip: string): void {
  editorTokenToIp.set(token, ip);
}
```

Mettre à jour `cleanupEditorConn` pour purger la map IP :

```typescript
export function cleanupEditorConn(token: string): void {
  editorSenders.delete(token);
  editorTokenToServer.delete(token);
  editorTokenToIp.delete(token);
}
```

Ajouter le handler dans `handlePluginMessage`, après `editor_session_revoke` :

```typescript
if (msg.type === "editor_trust_request") {
  const raw = msg as Record<string, unknown>;
  if (typeof raw.trust_code !== "string") return { reply: null };
  const serverId = connToServerId.get(connId);
  if (!serverId) return { reply: null };

  const session = await findSessionByTrustCode(raw.trust_code as string);
  if (!session || session.serverKeyId !== serverId) return { reply: null };

  const ip = session.accessToken ? editorTokenToIp.get(session.accessToken) : undefined;
  if (!ip) return { reply: null };

  await db.update(editorSessions)
    .set({ trustedAt: new Date(), trustedIp: ip })
    .where(eq(editorSessions.token, session.urlToken));

  if (session.accessToken) {
    const send = editorSenders.get(session.accessToken);
    if (send) send(JSON.stringify({ type: "session_trusted" } satisfies SessionTrustedMessage));
  }

  return { reply: null };
}
```

Ajouter les imports manquants dans `hub.ts` :

```typescript
import { findSessionByTrustCode } from "../lib/auth";
import type { ..., SessionTrustedMessage } from "../protocol";
```

- [ ] **Lancer les tests hub**

```bash
cd backend && bun test src/ws/hub.test.ts
```

- [ ] **Lancer tous les tests backend**

```bash
cd backend && bun test
```

- [ ] **Commit**

```bash
git add backend/src/ws/hub.ts backend/src/ws/hub.test.ts
git commit -m "feat(backend): hub trust request handler + editorTokenToIp tracking"
```

---

## Task 9: Plugin — trust_code + /artisan trusteditor

**Files:**
- Modify: `plugin/src/main/kotlin/net/artisanmc/plugin/provider/MenuProvider.kt`
- Modify: `plugin/src/main/kotlin/net/artisanmc/plugin/provider/SyncedMenuProvider.kt`
- Modify: `plugin/src/main/kotlin/net/artisanmc/plugin/command/ArtisanCommand.kt`

- [ ] **Ajouter `sendTrustRequest` à l'interface `MenuProvider`**

Ouvrir `MenuProvider.kt`, ajouter après `revokeEditorSessions()` :

```kotlin
fun sendTrustRequest(code: String)
```

- [ ] **Implémenter dans `SyncedMenuProvider`**

Ajouter un champ pour stocker le trust_code reçu :

```kotlin
@Volatile private var lastTrustCode: String? = null
```

Dans `handleMessage`, dans le cas `"editor_session_ready"`, ajouter l'extraction du trust_code :

```kotlin
"editor_session_ready" -> {
    val url = node["url"]?.asText() ?: return
    val expiresAt = node["expires_at"]?.asText() ?: return
    lastTrustCode = node["trust_code"]?.asText()
    val cb = editorSessionCallback
    editorSessionCallback = null
    cb?.invoke(url, expiresAt)
}
```

Ajouter l'override de `sendTrustRequest` :

```kotlin
override fun sendTrustRequest(code: String) {
    wsClient?.send(mapOf("type" to "editor_trust_request", "trust_code" to code))
}
```

- [ ] **Ajouter `trusteditor` dans `ArtisanCommand`**

Dans `onTabComplete`, ajouter `"trusteditor"` à la liste des subcommands :

```kotlin
args.size == 1 -> listOf("menu", "reload", "sync", "setup", "editor", "trusteditor")
    .filter { it.startsWith(args[0].lowercase()) }
```

Dans `onCommand`, ajouter le cas :

```kotlin
"trusteditor" -> {
    val code = args.getOrNull(1) ?: run {
        sender.sendMessage("[Artisan] Usage: /artisan trusteditor <code>")
        return true
    }
    if (!sender.hasPermission("artisan.editor")) {
        sender.sendMessage("[Artisan] Permission manquante : artisan.editor")
        return true
    }
    plugin.menuProvider.sendTrustRequest(code.uppercase())
    sender.sendMessage("[Artisan] Demande de trust envoyée.")
}
```

Dans l'affichage d'usage en bas :

```kotlin
else -> sender.sendMessage("Usage: /artisan <menu <id>|reload|sync <status|reject>|setup [CODE]|editor [revoke]|trusteditor <code>>")
```

- [ ] **Builder le plugin**

```bash
cd plugin && ./gradlew test
```

Attendu : tous les 25 tests passent.

- [ ] **Commit**

```bash
git add plugin/src/main/kotlin/net/artisanmc/plugin/provider/MenuProvider.kt
git add plugin/src/main/kotlin/net/artisanmc/plugin/provider/SyncedMenuProvider.kt
git add plugin/src/main/kotlin/net/artisanmc/plugin/command/ArtisanCommand.kt
git commit -m "feat(plugin): /artisan trusteditor command + editor_trust_request WS message"
```

---

## Task 10: Hub — inclure trust_code dans editor_session_ready

**Files:**
- Modify: `backend/src/ws/hub.ts`
- Modify: `backend/src/ws/hub.test.ts`

- [ ] **Mettre à jour le test `editor_session_request`** pour vérifier que `trust_code` est dans la réponse

Dans `hub.test.ts`, dans le test "returns editor_session_ready with url when authenticated", ajouter :

```typescript
expect(msg.url).toContain("/session?token=");
const body = msg as { type: string; url: string; expires_at: string; trust_code: string };
expect(typeof body.trust_code).toBe("string");
expect(body.trust_code.length).toBe(6);
```

- [ ] **Lancer le test — il doit échouer**

```bash
cd backend && bun test src/ws/hub.test.ts --testNamePattern "editor_session_request"
```

- [ ] **Mettre à jour `handlePluginMessage` dans `hub.ts`** — le cas `editor_session_request`

Dans le cas `editor_session_request`, générer le `trustCode` à la création de la session et l'inclure dans le message :

```typescript
if (msg.type === "editor_session_request") {
  const serverId = connToServerId.get(connId);
  if (!serverId) return { reply: null };
  const raw = msg as Record<string, unknown>;
  const sender = typeof raw.sender === "string" ? raw.sender : "CONSOLE";
  const token = generateEditorToken();
  const trustCode = generateTrustCode();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  await db.insert(editorSessions).values({
    token, serverKeyId: serverId, createdBy: sender, createdAt: now, expiresAt, trustCode,
  });
  const reply: EditorSessionReadyMessage = {
    type: "editor_session_ready",
    url: `${EDITOR_URL}/session?token=${token}`,
    expires_at: expiresAt.toISOString(),
    trust_code: trustCode,
  };
  return { reply: JSON.stringify(reply) };
}
```

Ajouter `generateTrustCode` à l'import de `auth.ts` dans `hub.ts` :

```typescript
import { generateCode, generateEditorToken, generateTrustCode, generateServerKey, findSessionByTrustCode } from "../lib/auth";
```

- [ ] **Lancer tous les tests backend**

```bash
cd backend && bun test
```

- [ ] **Commit**

```bash
git add backend/src/ws/hub.ts backend/src/ws/hub.test.ts
git commit -m "feat(backend): include trust_code in editor_session_ready message"
```

---

## Task 11: Editor — exchange + refresh + session state

**Files:**
- Modify: `editor/src/lib/editorSession.ts`
- Modify: `editor/src/state/sessionStore.ts`
- Modify: `editor/src/routes/session.tsx`

- [ ] **Mettre à jour `editorSession.ts`**

Remplacer le contenu par :

```typescript
const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

export interface EditorSessionInfo {
  server_key_id: string;
  trusted: boolean;
  trust_code: string;
}

export interface ExchangeResult {
  access_token: string;
  expires_in: number;
  trust_code: string;
}

export async function exchangeEditorSession(urlToken: string): Promise<ExchangeResult> {
  const res = await fetch(`${API_URL}/api/editor-session/${urlToken}/exchange`, { method: "POST" });
  if (!res.ok) {
    const body = await res.json() as { error?: string };
    throw new Error(body.error === "already_used" ? "already_used" : "Session invalide ou expirée");
  }
  return res.json() as Promise<ExchangeResult>;
}

export async function refreshEditorSession(): Promise<string | null> {
  const res = await fetch(`${API_URL}/api/editor-session/refresh`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) return null;
  const body = await res.json() as { access_token: string };
  return body.access_token;
}

export async function validateEditorSession(accessToken: string): Promise<EditorSessionInfo> {
  const res = await fetch(`${API_URL}/api/editor-session/${accessToken}`, { credentials: "include" });
  if (!res.ok) throw new Error("Session invalide ou expirée");
  return res.json() as Promise<EditorSessionInfo>;
}

export async function revokeEditorSession(accessToken: string): Promise<void> {
  await fetch(`${API_URL}/api/editor-session/${accessToken}`, {
    method: "DELETE",
    credentials: "include",
  });
}

export async function saveDraft(
  accessToken: string,
  packId: string,
  menuId: string,
  menuYaml: string,
): Promise<void> {
  const res = await fetch(`${API_URL}/api/editor-session/${accessToken}/draft`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pack_id: packId, menu_id: menuId, menu_yaml: menuYaml }),
    credentials: "include",
  });
  if (!res.ok) throw new Error("Échec de la sauvegarde du draft");
}
```

- [ ] **Mettre à jour `sessionStore.ts`** — supprimer persist, ajouter `accessToken`, `trustCode`, `trusted`

```typescript
import { create } from "zustand";

interface SessionState {
  accessToken: string | null;
  serverKeyId: string | null;
  trustCode: string | null;
  trusted: boolean;
  setSession: (accessToken: string, serverKeyId: string, trustCode: string, trusted: boolean) => void;
  setTrusted: (trusted: boolean) => void;
  clearSession: () => void;
}

export const useSessionStore = create<SessionState>()((set) => ({
  accessToken: null,
  serverKeyId: null,
  trustCode: null,
  trusted: false,
  setSession: (accessToken, serverKeyId, trustCode, trusted) =>
    set({ accessToken, serverKeyId, trustCode, trusted }),
  setTrusted: (trusted) => set({ trusted }),
  clearSession: () => set({ accessToken: null, serverKeyId: null, trustCode: null, trusted: false }),
}));
```

- [ ] **Fixer les références à `s.token`** dans `pack.$packId.tsx` : remplacer `useSessionStore((s) => s.token)` par `useSessionStore((s) => s.accessToken)`.

Dans `pack.$packId.tsx`, ligne ~522 :
```typescript
const token = useSessionStore((s) => s.accessToken);
```

- [ ] **Mettre à jour `session.tsx`** — exchange/refresh au chargement, intervalle 4 min

Remplacer la logique d'initialisation dans `SessionPage` :

```typescript
useEffect(() => {
  mountedRef.current = true;

  const params = new URLSearchParams(window.location.search);
  const urlToken = params.get("token");

  (async () => {
    try {
      let accessToken: string;

      if (urlToken) {
        // Fresh link — exchange the one-time url token
        history.replaceState({}, "", "/session");
        try {
          const result = await exchangeEditorSession(urlToken);
          accessToken = result.access_token;
        } catch (e) {
          if (!mountedRef.current) return;
          setState(e instanceof Error && e.message === "already_used" ? "already_used" : "invalid");
          return;
        }
      } else {
        // Page refresh — try cookie-based refresh
        const newToken = await refreshEditorSession();
        if (!newToken) {
          if (mountedRef.current) setState("expired");
          return;
        }
        accessToken = newToken;
      }

      if (!mountedRef.current) return;
      tokenRef.current = accessToken;

      const info = await validateEditorSession(accessToken);
      if (!mountedRef.current) return;
      const trustCode = info.trust_code;

      const packs = await loadPacks(accessToken);
      if (!mountedRef.current) return;

      useAccountStore.getState().setAccount({
        id: info.server_key_id as AccountId,
        packs,
        packOrder: packs.map((p) => p.id as PackId),
      });

      setSession(accessToken, info.server_key_id, trustCode, info.trusted);

      wsRef.current = new EditorWs(
        accessToken,
        (_packId, menuId, _menuYaml, _updatedBy) => {
          if (!mountedRef.current) return;
          setDraftNotice(`Menu "${menuId}" mis à jour par un autre éditeur.`);
          setTimeout(() => setDraftNotice(null), 5000);
        },
        () => {
          if (!mountedRef.current) return;
          clearSession();
          setState("expired");
        },
        () => {
          if (!mountedRef.current) return;
          setTrusted(true);
        },
      );

      // Refresh silencieux toutes les 4 min
      refreshRef.current = setInterval(async () => {
        const newToken = await refreshEditorSession();
        if (!newToken) { clearSession(); setState("expired"); return; }
        tokenRef.current = newToken;
        setSession(newToken, info.server_key_id, trustCode, useSessionStore.getState().trusted);
      }, 4 * 60 * 1000);

      const firstPack = packs[0];
      if (firstPack) {
        await navigate({ to: "/pack/$packId", params: { packId: firstPack.id } });
      } else {
        setState("empty");
      }
    } catch {
      if (mountedRef.current) {
        clearSession();
        setState("invalid");
      }
    }
  })();

  return () => {
    mountedRef.current = false;
    wsRef.current?.disconnect();
    if (refreshRef.current) clearInterval(refreshRef.current);
  };
}, [navigate, setSession, clearSession, setTrusted]);
```

Mettre à jour les imports en haut de `session.tsx` :

```typescript
import { exchangeEditorSession, validateEditorSession, refreshEditorSession } from "@/lib/editorSession";
```

Ajouter `"already_used"` aux états possibles :

```typescript
const [state, setState] = useState<"loading" | "invalid" | "expired" | "already_used" | "empty">("loading");
```

Ajouter le cas d'affichage pour `"already_used"` avant le cas `"expired"` :

```typescript
if (state === "already_used") {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4">
      <p className="text-destructive text-lg">Lien déjà utilisé.</p>
      <p className="text-muted-foreground text-sm">
        Relancez <code>/artisan editor</code> sur votre serveur Minecraft.
      </p>
    </div>
  );
}
```

Ajouter `setTrusted` dans les sélecteurs Zustand :

```typescript
const setTrusted = useSessionStore((s) => s.setTrusted);
```

- [ ] **Lancer les tests vitest**

```bash
cd editor && npx vitest run
```

Corriger les éventuels TypeScript errors (principalement les refs à `s.token` → `s.accessToken`).

- [ ] **Commit**

```bash
git add editor/src/lib/editorSession.ts editor/src/state/sessionStore.ts editor/src/routes/session.tsx editor/src/routes/pack.$packId.tsx
git commit -m "feat(editor): exchange/refresh session flow, accessToken in store (no persist)"
```

---

## Task 12: Editor — trust banner + deploy error handling

**Files:**
- Create: `editor/src/features/trust/TrustBanner.tsx`
- Modify: `editor/src/lib/editorWs.ts`
- Modify: `editor/src/lib/packApi.ts`
- Modify: `editor/src/routes/pack.$packId.tsx`

- [ ] **Créer `TrustBanner.tsx`**

```typescript
// editor/src/features/trust/TrustBanner.tsx
interface TrustBannerProps {
  trustCode: string;
}

export function TrustBanner({ trustCode }: TrustBannerProps) {
  return (
    <div className="fixed top-0 left-0 right-0 z-50 flex items-center justify-center gap-3 bg-amber-500/10 border-b border-amber-500/30 px-4 py-2 text-sm text-amber-300">
      <span className="font-semibold">Deploy désactivé.</span>
      <span>
        Tapez en jeu :{" "}
        <code className="rounded bg-amber-500/20 px-2 py-0.5 font-mono text-amber-200">
          /artisan trusteditor {trustCode}
        </code>
      </span>
    </div>
  );
}
```

- [ ] **Mettre à jour `editorWs.ts`** — ajouter handler `session_trusted`

Ajouter `onTrusted: () => void` comme 3ème paramètre du constructeur :

```typescript
export class EditorWs {
  private ws: WebSocket | null = null;

  constructor(
    token: string,
    private onDraftUpdate: DraftUpdateHandler,
    private onExpired: SessionExpiredHandler,
    private onTrusted: () => void,
  ) {
    this.ws = new WebSocket(`${WS_URL}/ws/editor?token=${encodeURIComponent(token)}`);
    this.ws.onmessage = (evt) => {
      let msg: { type: string; pack_id?: string; menu_id?: string; menu_yaml?: string; updated_by?: string };
      try { msg = JSON.parse(evt.data as string); } catch { return; }
      if (msg.type === "draft_update" && msg.pack_id && msg.menu_id && msg.menu_yaml != null) {
        this.onDraftUpdate(msg.pack_id, msg.menu_id, msg.menu_yaml, msg.updated_by ?? "");
      } else if (msg.type === "session_expired") {
        this.onExpired();
      } else if (msg.type === "session_trusted") {
        this.onTrusted();
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

- [ ] **Mettre à jour `packApi.ts`** — `deployPack` throw `DeployError` typé sur 403

```typescript
export class DeployError extends Error {
  constructor(public readonly code: "session_not_trusted" | "unknown") {
    super(code === "session_not_trusted" ? "session_not_trusted" : "Échec du déploiement");
  }
}

export async function deployPack(
  token: string,
  pack: Pack,
  files: Record<string, string>,
): Promise<void> {
  const res = await fetch(`${API_URL}/api/editor-session/${token}/packs/${pack.id}/deploy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pack, files }),
    credentials: "include",
  });
  if (res.status === 403) {
    const body = await res.json() as { error?: string };
    throw new DeployError(body.error === "session_not_trusted" ? "session_not_trusted" : "unknown");
  }
  if (!res.ok) throw new DeployError("unknown");
}
```

- [ ] **Intégrer `TrustBanner` dans `pack.$packId.tsx`**

Ajouter l'import :

```typescript
import { TrustBanner } from "@/features/trust/TrustBanner";
import { DeployError } from "@/lib/packApi";
```

Dans `PackCanvasPage` (ou la fonction qui rend le layout principal), récupérer `trusted` et `trustCode` depuis le store, et afficher `TrustBanner` :

```typescript
// Dans PackCanvasPage, avant le return
const trusted = useSessionStore((s) => s.trusted);
const trustCode = useSessionStore((s) => s.trustCode);
```

Ajouter `TrustBanner` au début du rendu :

```tsx
return (
  <>
    {!trusted && trustCode && <TrustBanner trustCode={trustCode} />}
    {/* ... reste du rendu ... */}
  </>
);
```

- [ ] **Mettre à jour `handleDeploy` dans `DeployButtons`** pour gérer `DeployError`

```typescript
const handleDeploy = async () => {
  if (!token || deploying) return;
  setDeploying(true);
  try {
    const cloned = structuredClone(pack);
    for (const menu of cloned.menus) rekeyMenuLTexts(cloned, menu);
    for (const cmd of cloned.commands) rekeyCommandLTexts(cloned, cmd);
    const files = transform(cloned);
    await deployPack(token, pack, files);
    toast.success("Déployé ✓");
  } catch (e) {
    if (e instanceof DeployError && e.code === "session_not_trusted") {
      // Le banner s'affiche déjà — pas besoin de toast
    } else {
      toast.error(e instanceof Error ? e.message : "Échec du déploiement");
    }
  } finally {
    setDeploying(false);
  }
};
```

- [ ] **Lancer les tests vitest**

```bash
cd editor && npx vitest run
```

Attendu : tous les tests passent.

- [ ] **Commit**

```bash
git add editor/src/features/trust/TrustBanner.tsx editor/src/lib/editorWs.ts editor/src/lib/packApi.ts editor/src/routes/pack.$packId.tsx
git commit -m "feat(editor): TrustBanner + session_trusted WS handler + typed DeployError"
```

---

## Task 13: Test de fumée end-to-end

- [ ] **Builder et démarrer la stack**

```bash
cd plugin && ./gradlew shadowJar
docker compose up -d
```

- [ ] **Vérifier que le flow complet fonctionne**

1. `/artisan editor` en jeu → lien dans le chat
2. Ouvrir le lien dans le navigateur → page de chargement
3. Vérifier que le bandeau "Tapez /artisan trusteditor <code>" apparaît
4. Taper `/artisan trusteditor <code>` en jeu → bandeau disparaît
5. Cliquer "Deploy" → succès ✓
6. Changer de VPN / d'IP → le bandeau réapparaît
7. Re-taper `/artisan trusteditor <code>` → deploy fonctionne à nouveau
8. Recharger la page → la session est restaurée via cookie refresh

- [ ] **Commit final si ajustements**

```bash
git add -A
git commit -m "fix: e2e adjustments after smoke test"
```
