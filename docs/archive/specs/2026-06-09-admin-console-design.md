# Platform super-admin console — AI config (v1), extensible tabs

**Status:** design approved, ready for the implementation plan
**Author:** brainstorm 2026-06-09
**Trigger:** the AI config (`ASSISTANT_*`) lives in env vars; we need an admin space to edit it (and, later, manage users/logs).
**Related code:** `backend/src/db/schema.ts` (users, new `app_settings` table), `backend/src/middleware/userAuth.ts`, `backend/src/modules/assistant/provider/config.ts` (config loading), `editor/src/routes/` (`/admin` route).

## Context

- **Auth**: `users` table (email/Discord login) → `AuthUser {id,email,…}` via the `artisan_user_session` cookie + `userAuth` middleware. The `memberships.role` role is **network-level** (owner/member), **not** a platform admin. → **no super-admin today.**
- **AI config**: env vars `ASSISTANT_PROVIDER`/`ASSISTANT_BASE_URL`/`ASSISTANT_API_KEY`/`ASSISTANT_MODEL`, read by `resolveProviderConfig(env)`. The provider is **platform-global** (the admin supplies the key/credits) — not per network.
- **Audit**: `serverKeyHelloes` (plugin hellos, per server) — basis of a future "logs" tab.

This spec covers a **platform super-admin console**: v1 = one **AI config** tab; the tab structure is ready for `users`/`logs` later (out of v1).

## Brainstorm decisions

| Question | Choice |
|---|---|
| Access model | **`users.isAdmin` (DB)** + bootstrap via env `ADMIN_BOOTSTRAP_EMAILS` (at login). |
| AI config storage | **A single generic `app_settings` table (key/value JSON)**. API key **encrypted at-rest** (AES-256-GCM, `CONFIG_ENC_KEY`). Env `ASSISTANT_*` = bootstrap default (DB overrides). |
| v1 scope | Admin shell + **AI tab only**. `users`/`logs` = out of scope, structure ready. |

## Goals

- A **`/admin` space** (editor) guarded by super-admin, with **extensible tabs**.
- Configure the AI provider (**provider / baseURL / model / key**) from the UI, without touching env or redeploying.
- **Key never exposed** (encrypted at-rest, never sent back to the client, never logged).
- The AI engine reads the config **DB first, env as fallback**.

## Non-goals (v1)

- **users** tabs (account management / admin promotion) and **logs** (audit) — structure ready, not built.
- Fine-grained RBAC / multi admin roles (a single `isAdmin` boolean).
- External secret manager (at-rest encryption in DB is enough in v1).
- Automatic rotation of `CONFIG_ENC_KEY`.

## Architecture

### 1. Access control

- **Migration**: `users.isAdmin` column (boolean, default false). Generated via `bun run db:generate`, committed.
- **Bootstrap**: at login (auth route), if the user's email ∈ `ADMIN_BOOTSTRAP_EMAILS` (env, CSV) and `isAdmin` is false → set it to true. Guarantees a first admin exists without manual DB intervention.
- **`requireAdmin` middleware** (`backend/src/middleware/`): applies `userAuth`, then 403 if `!user?.isAdmin`. Guards all of `/api/v1/admin/*`.
- **UI exposure**: `/api/v1/auth/me` (existing or added route) returns `isAdmin` in the profile. The editor shows the admin entry **only if** `isAdmin`, and the `/admin` route redirects otherwise.

### 2. Persistence — generic `app_settings` table

- **Table**: `app_settings (key text PK, value text NOT NULL, updatedAt timestamp, updatedBy text → users.id)`. `value` = stringified JSON (consistent with the repo's `filesJson` pattern).
- **AI config**: one row `key = "assistant"`, `value` = JSON `{ provider, baseUrl, model, apiKeyEncrypted }`. `apiKeyEncrypted` = base64 ciphertext (the key is never stored in clear).
- **Extensibility**: a future global setting = a new `key` (no migration).

### 3. Secret encryption

- `backend/src/lib/secretBox.ts`: `encryptSecret(plain): string` / `decryptSecret(cipher): string` in **AES-256-GCM** with `CONFIG_ENC_KEY` (env, 32 bytes hex). Format `iv:tag:ciphertext` base64.
- If `CONFIG_ENC_KEY` is absent: the **DB config is disabled** (reading/writing the key is impossible) → the engine falls back to env. (WARN log at boot.)

### 4. Config loading by the engine (DB → env)

- New `loadAssistantProviderConfig(): Promise<ProviderConfig | null>` (in `provider/config.ts` or `provider/dbConfig.ts`):
  1. reads `app_settings["assistant"]`; if present + `CONFIG_ENC_KEY` set → `{ baseURL, model, apiKey: decryptSecret(apiKeyEncrypted) }` (baseURL resolved via preset if `provider` has no explicit baseURL).
  2. otherwise → `resolveProviderConfig(process.env)` (the existing sync env resolver, **unchanged**).
- The assistant routes (2d, `resolve()`) call this **async** loader (they are already async). `resolveProviderConfig(env)` stays as is (reused as fallback + in tests).

### 5. Admin endpoints (`/api/v1/admin/*`, `requireAdmin`)

| Method | Route | Effect |
|---|---|---|
| `GET` | `/api/v1/admin/assistant-config` | `{ provider, baseUrl, model, keySet: boolean }` — **never the key**. |
| `PUT` | `/api/v1/admin/assistant-config` | upsert `app_settings["assistant"]`; if `apiKey` supplied (non-empty) → encrypt + store; if empty/absent → keep the existing one. `updatedBy = user.id`. |
| `POST` | `/api/v1/admin/assistant-config/test` | mini-call via `OpenAICompatibleProvider` (current config or the body's) → `{ ok, error? }`. |

`/api/v1/auth/me` extended with `isAdmin`.

### 6. Admin UI (`editor/`)

- **`/admin`** route (TanStack Router) = **tabbed shell**: v1 = one **"AI"** tab; adding a tab = one entry + one child route (`/admin/users`, `/admin/logs`). Guarded: redirects to `/networks` if `!isAdmin`.
- **AI tab**: provider `<select>` (presets openai/deepseek/mistral/openrouter/local), baseURL (optional) + model inputs, **write-only** key field (placeholder "•••• set" if `keySet`, empty = unchanged), **"Test connection"** button (calls `/test`), Save button (PUT). Success/error toasts. All strings i18n (en+fr, same commit).
- **Entry to `/admin`**: link in the account menu/topbar, visible if `isAdmin`.

## Security

- `requireAdmin` on **all** of `/api/v1/admin/*`.
- Key: encrypted at-rest; **never** returned by `GET`; never logged (not even in `/test` errors).
- `CONFIG_ENC_KEY` required for the DB config of secrets; absent → env fallback + WARN.
- `isAdmin` not auto-granted outside `ADMIN_BOOTSTRAP_EMAILS`.

## Error handling

| Case | Behavior |
|---|---|
| Non-admin on `/api/v1/admin/*` | 403. |
| `/admin` UI without `isAdmin` | redirect `/networks`. |
| `CONFIG_ENC_KEY` absent on key `PUT` | 503 "encryption not configured"; provider/model still editable. |
| `/test` fails (provider) | `{ ok:false, error }` (provider message without secret). |
| DB config absent | engine = env fallback (assistant disabled if neither DB nor env). |

## Environment variables (backend)

| Variable | Default | Usage |
|---|---|---|
| `ADMIN_BOOTSTRAP_EMAILS` | (empty) | CSV of emails promoted `isAdmin` at login. |
| `CONFIG_ENC_KEY` | (empty) | 32-byte hex key to encrypt secrets in DB. Empty → DB config of secrets disabled (env fallback). |
| (existing `ASSISTANT_*`) | — | Bootstrap default, overridden by the DB config. |

## Tests

| Layer | Coverage |
|---|---|
| `secretBox` | encrypt→decrypt round-trip; ciphertext ≠ plain; decryption fails on missing/tampered key. |
| `requireAdmin` | 403 anonymous / 403 non-admin user / pass if `isAdmin`. |
| Login bootstrap | email ∈ `ADMIN_BOOTSTRAP_EMAILS` → `isAdmin` true; not in the list → unchanged. |
| `loadAssistantProviderConfig` | DB present → DB (key decrypted); DB absent → env; `CONFIG_ENC_KEY` absent → env. |
| Config routes | `GET` masks the key (`keySet`); `PUT` encrypts + upserts + does not overwrite the key if empty; `/test` ok/error. |
| UI | admin form (testing-library): loads `keySet`, masks the key, PUT on Save, test button; `/admin` route redirects if non-admin. |

## Docs to update

- `docs/architecture/entities.md`: `app_settings` table + `users.isAdmin` + migration.
- `docs/architecture/rest-endpoints.md`: `/api/v1/admin/*`.
- `.env.example` + `CLAUDE.md`: `ADMIN_BOOTSTRAP_EMAILS`, `CONFIG_ENC_KEY`.
- `docs-site/.../admin/console.md` (admin doc, to create).
- `CHANGELOG.md` `[Unreleased]`.

## Breakdown / next

- **Plan 1**: access (`users.isAdmin` + bootstrap + `requireAdmin` + `auth/me`) + `secretBox` + `app_settings` table. *(foundation, testable on its own)*
- **Plan 2**: backend AI config (`loadAssistantProviderConfig` DB→env + GET/PUT/test endpoints + wiring the engine).
- **Plan 3**: `/admin` UI (tabbed shell + AI tab + i18n + guarded entry).
- **Next (out of v1)**: **users** tab (list/promote, link to the credits of AI sub-plan 3), **logs** tab (`serverKeyHelloes` audit + admin actions), RBAC.
