# Console admin — plan 1 : accès super-admin + secretBox + table `app_settings`

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps en checkbox (`- [ ]`).

**Goal:** Le socle de la console admin : colonne `users.isAdmin` (+ amorçage env), middleware `requireAdmin`, exposition `isAdmin` dans `/me`, helper de chiffrement `secretBox`, et la table générique `app_settings`. Aucun endpoint admin ni UI ici (plans 2 & 3) — juste l'infra testable.

**Architecture:** Backend (`backend/`):
- `db/schema.ts` — `users.isAdmin` + table `app_settings`. Migration via `bun run db:generate` (committée).
- `lib/secretBox.ts` — AES-256-GCM (`CONFIG_ENC_KEY`).
- `middleware/userAuth.ts` — `AuthUser.isAdmin` + amorçage `ADMIN_BOOTSTRAP_EMAILS`.
- `middleware/requireAdmin.ts` — garde 403.
- `routes/auth.ts` — `/me` renvoie `isAdmin`.

**Tech Stack:** Bun + Hono + Drizzle, `node:crypto`, `bun run test`.

> ⚠️ **JAMAIS `bun test` direct** — `bun run test [chemin]` (wrapper ; auto-migre `artisan_test`).
> **État drizzle** : la migration 0005 (theme) vient d'être complétée → baseline cohérente. La nouvelle migration sera 0006.

**Prérequis :** rien (socle).

---

### Task 1 : schéma — `users.isAdmin` + table `app_settings` + migration

**Files:**
- Modify: `backend/src/db/schema.ts`
- Generated: `backend/drizzle/0006_*.sql` + `meta/_journal.json` + `meta/0006_snapshot.json`

- [ ] **Step 1 : Éditer le schéma**

Dans `users` (après `theme`), ajouter :
```ts
  isAdmin: boolean("is_admin").notNull().default(false),
```
Ajouter la table (près des autres) :
```ts
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),       // JSON stringifié
  updatedAt: timestamp("updated_at").notNull(),
  updatedBy: text("updated_by").references(() => users.id),
});
```
S'assurer que `boolean` est importé de `drizzle-orm/pg-core` (ajouter à l'import si absent).

- [ ] **Step 2 : Générer la migration**

Run (working_directory `backend`): `bun run db:generate`
Expected : crée `backend/drizzle/0006_<name>.sql` (+ met à jour `_journal.json`, crée `0006_snapshot.json`). **Vérifier que le `.sql` ne contient QUE** `ALTER TABLE "users" ADD COLUMN "is_admin" ... DEFAULT false` + `CREATE TABLE "app_settings" (...)` — rien d'autre (sinon la baseline 0005 est mauvaise → STOP, ne pas committer, signaler).

- [ ] **Step 3 : Commit**
```bash
git add backend/src/db/schema.ts backend/drizzle/0006_*.sql backend/drizzle/meta/_journal.json backend/drizzle/meta/0006_snapshot.json
git commit -m "feat(db): users.isAdmin + app_settings table (migration 0006)"
```

---

### Task 2 : `secretBox` (AES-256-GCM) — TDD

**Files:**
- Create: `backend/src/lib/secretBox.ts`
- Create: `backend/src/lib/secretBox.test.ts`

- [ ] **Step 1 : Test (RED)** :
```ts
import { describe, expect, it, beforeAll } from "bun:test";
import { encryptSecret, decryptSecret, isSecretsConfigured } from "./secretBox";

beforeAll(() => { process.env.CONFIG_ENC_KEY = "0".repeat(64); }); // 32 bytes hex

describe("secretBox", () => {
  it("round-trips a secret", () => {
    const ct = encryptSecret("sk-12345");
    expect(ct).not.toContain("sk-12345");
    expect(decryptSecret(ct)).toBe("sk-12345");
  });
  it("uses a fresh iv each time (ciphertext differs)", () => {
    expect(encryptSecret("x")).not.toBe(encryptSecret("x"));
  });
  it("fails to decrypt tampered ciphertext", () => {
    const ct = encryptSecret("secret");
    const parts = ct.split(":");
    const tampered = [parts[0], parts[1], Buffer.from("zzzz").toString("base64")].join(":");
    expect(() => decryptSecret(tampered)).toThrow();
  });
  it("isSecretsConfigured reflects CONFIG_ENC_KEY", () => {
    expect(isSecretsConfigured()).toBe(true);
  });
});
```

- [ ] **Step 2 : Run (FAIL)** — `bun run test src/lib/secretBox.test.ts`.

- [ ] **Step 3 : `secretBox.ts`** :
```ts
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function key(): Buffer {
  const hex = process.env.CONFIG_ENC_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error("CONFIG_ENC_KEY must be a 32-byte hex string (64 chars)");
  }
  return Buffer.from(hex, "hex");
}

/** AES-256-GCM. Returns `iv:tag:ciphertext` (each base64). */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv.toString("base64"), c.getAuthTag().toString("base64"), ct.toString("base64")].join(":");
}

export function decryptSecret(packed: string): string {
  const [ivB, tagB, ctB] = packed.split(":");
  if (!ivB || !tagB || !ctB) throw new Error("malformed ciphertext");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB, "base64"));
  d.setAuthTag(Buffer.from(tagB, "base64"));
  return Buffer.concat([d.update(Buffer.from(ctB, "base64")), d.final()]).toString("utf8");
}

/** True when CONFIG_ENC_KEY is set & well-formed (else DB secret config is disabled). */
export function isSecretsConfigured(): boolean {
  const hex = process.env.CONFIG_ENC_KEY;
  return !!hex && hex.length === 64;
}
```

- [ ] **Step 4 : Run (PASS) + commit** `feat(backend): secretBox AES-256-GCM helper (CONFIG_ENC_KEY)`.

---

### Task 3 : `isAdmin` dans l'auth + amorçage + `requireAdmin` + `/me` — TDD

**Files:**
- Modify: `backend/src/middleware/userAuth.ts`
- Create: `backend/src/middleware/requireAdmin.ts`
- Create: `backend/src/middleware/requireAdmin.test.ts`
- Modify: `backend/src/middleware/userAuth.test.ts`
- Modify: `backend/src/routes/auth.ts`

- [ ] **Step 1 : `userAuth.ts`** — ajouter `isAdmin` à `AuthUser` et l'amorçage. Après avoir récupéré `row` (et avant `c.set("user", …)`) :
```ts
    const bootstrap = (process.env.ADMIN_BOOTSTRAP_EMAILS ?? "")
      .split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
    let isAdmin = row.isAdmin ?? false;
    if (!isAdmin && bootstrap.includes(row.email.toLowerCase())) {
      await db.update(users).set({ isAdmin: true }).where(eq(users.id, row.id));
      isAdmin = true;
    }
```
Ajouter `isAdmin: boolean;` à l'interface `AuthUser`, et `isAdmin` dans l'objet `c.set("user", { … isAdmin })`.

- [ ] **Step 2 : `requireAdmin.ts`** :
```ts
import { createMiddleware } from "hono/factory";

/** Must run AFTER userAuth() (reads c.var.user). 403 if not an admin. */
export const requireAdmin = () => createMiddleware(async (c, next) => {
  const user = c.var.user;
  if (!user?.isAdmin) return c.json({ error: "forbidden" }, 403);
  return next();
});
```

- [ ] **Step 3 : `/me` (auth.ts)** — ajouter `isAdmin: user.isAdmin` dans l'objet `user` renvoyé par `GET /me` (et `PATCH /me` si tu veux la cohérence — au moins le GET).

- [ ] **Step 4 : Tests**

`requireAdmin.test.ts` (app jouet + sessions DB ; suivre `userAuth.test.ts` pour créer users+sessions dans la DB test) :
```ts
import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { userAuth } from "./userAuth";
import { requireAdmin } from "./requireAdmin";
// + helpers d'insertion user+session (cf. userAuth.test.ts)

function appWith() {
  const app = new Hono();
  app.use("*", userAuth());
  app.use("*", requireAdmin());
  app.get("/x", (c) => c.json({ ok: true }));
  return app;
}

describe("requireAdmin", () => {
  it("403 without a session", async () => {
    const res = await appWith().request("/x");
    expect(res.status).toBe(403);
  });
  it("403 for a non-admin user", async () => {
    // insert user (isAdmin false) + session; request with the session cookie
    // expect 403
  });
  it("200 for an admin user", async () => {
    // insert user with isAdmin true + session; request with cookie
    // expect 200
  });
});
```
(Compléter les inserts user+session selon le pattern réel de `userAuth.test.ts` ; le cookie est `artisan_user_session`.)

Dans `userAuth.test.ts`, ajouter un test d'amorçage : un user dont l'email ∈ `ADMIN_BOOTSTRAP_EMAILS` (set `process.env.ADMIN_BOOTSTRAP_EMAILS` dans le test) → après une requête authentifiée, `c.var.user.isAdmin === true` **et** la ligne DB est passée à `isAdmin=true` ; un user hors liste → reste `false`.

- [ ] **Step 5 : Run (PASS)** — `bun run test src/middleware/` (+ `src/routes/auth.test.ts` si présent). Tests verts.

- [ ] **Step 6 : Commit**
```bash
git add backend/src/middleware/userAuth.ts backend/src/middleware/requireAdmin.ts backend/src/middleware/requireAdmin.test.ts backend/src/middleware/userAuth.test.ts backend/src/routes/auth.ts
git commit -m "feat(auth): isAdmin (+ ADMIN_BOOTSTRAP_EMAILS) + requireAdmin middleware + /me exposes isAdmin"
```

---

### Task 4 : Docs / env

**Files:** `.env.example`, `CLAUDE.md`, `docs/architecture/entities.md`, `CHANGELOG.md`.

- [ ] **Step 1** —
- `.env.example` : `ADMIN_BOOTSTRAP_EMAILS=` (CSV, commenté) + `CONFIG_ENC_KEY=` (hex 32 bytes ; commenté, ex de génération `openssl rand -hex 32`).
- `CLAUDE.md` : ajouter ces deux vars au tableau des env vars (backend).
- `docs/architecture/entities.md` : `users.isAdmin` + table `app_settings` (key/value JSON, updatedBy) + note migration 0006.
- `CHANGELOG.md` `[Unreleased]` : super-admin (`isAdmin` + bootstrap), `requireAdmin`, `app_settings`, `secretBox`.

- [ ] **Step 2 : Commit** `docs(admin): plan 1 — access + secrets + app_settings`.

---

## Self-review

- **Migration isolée** : baseline 0005 (theme) complétée → le 0006 ne contient QUE isAdmin + app_settings (vérif Step T1.2). ✓
- **Amorçage robuste** : dans `userAuth` (couvre tous les chemins d'auth — login/signup/discord — et rétroactif), write **une seule fois** (guard `!isAdmin`). ✓
- **`requireAdmin`** : pur garde (assume `userAuth` avant) ; testé 403/200. Câblé aux routes en **plan 2**. ✓
- **secretBox** : GCM (intègre tag d'auth → tamper détecté) ; `isSecretsConfigured` pour le fallback env. ✓
- **`bun run test` only.** ✓
- **Pas d'endpoint/UI ici** — plans 2 (config IA backend) & 3 (UI `/admin`).

## Suite

- **Plan 2** : `loadAssistantProviderConfig` (DB `app_settings["assistant"]` déchiffrée → env fallback) + endpoints `GET/PUT/POST /api/v1/admin/assistant-config` (gardés `userAuth`+`requireAdmin`) + branchement du moteur (`routes.ts` 2d).
- **Plan 3** : UI `/admin` (shell onglets + onglet IA + i18n + entrée gardée par `isAdmin`).
