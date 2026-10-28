# Trusted Editor — Design

**Date:** 2026-05-08  
**Scope:** Securing editor sessions via refresh tokens + in-game trust + IP binding

---

## Problem

The current editor session token is a single 30-min token in the URL. If this token is accidentally shared or stolen, anyone can trigger a deploy on the Minecraft server with no other check.

---

## Goals

1. Long sessions (7 days) without sacrificing security
2. The editor URL is one-time — unusable after the first visit
3. Deploy requires in-game confirmation (`/artisan trusteditor`) even with a valid token
4. An IP change re-triggers the in-game confirmation (without invalidating the session)

---

## Token architecture

### Before
```
url_token (30 min) → used for all API calls
```

### After
```
url_token (one-time) → exchanged on the 1st visit
    ↓
access_token (5 min, JS memory) → API calls
refresh_token (7 days, HttpOnly cookie) → renews the access token
```

---

## DB schema — `editor_sessions` (added columns)

| Column | Type | Description |
|---|---|---|
| `exchanged_at` | timestamp nullable | Set when the url_token is exchanged — blocks any reuse |
| `refresh_token` | text nullable | Refresh token (HttpOnly cookie, 7 days) |
| `access_token` | text nullable | Current access token (5 min) |
| `access_expires_at` | timestamp nullable | Access token expiry |
| `trust_code` | text nullable | 6-char code generated at creation, shown in the editor |
| `trusted_at` | timestamp nullable | Set when `/artisan trusteditor` is typed |
| `trusted_ip` | text nullable | IP captured at the time of trust |

`expires_at` goes from 30 min to **7 days**.

---

## Flows

### A. Exchange (initial visit)

```
/artisan editor
    → backend creates session: url_token + trust_code (6 chars), expires_at = now + 7d
    → editorSessionReadyMessage includes trust_code

Editor loads /session?token=<url_token>
    → POST /api/editor-session/exchange { url_token }
    → IF exchanged_at IS NOT NULL → 401 { error: "already_used" }
    → IF token expired or nonexistent → 401
    → sets exchanged_at, generates access_token (5 min) + refresh_token (7d)
    → returns { access_token, expires_in: 300, trust_code }
    → Set-Cookie: refresh=<refresh_token>; HttpOnly; Secure; SameSite=Strict; Max-Age=604800
```

### B. Refresh (every 4 min, silent)

```
POST /api/editor-session/refresh
    → reads the refresh_token cookie
    → IF not found or revoked → 401 { error: "session_expired" }
    → invalidates the old refresh_token (rotation)
    → generates new access_token (5 min) + new refresh_token (7d)
    → returns { access_token, expires_in: 300 }
    → Set-Cookie: refresh=<new_refresh_token>; HttpOnly; ...
```

### C. In-game trust

```
Editor shows banner: "Type /artisan trusteditor <trust_code> in game"

Admin → /artisan trusteditor <code>
    → plugin sends WS: editor_trust_request { trust_code }
    → backend: looks up session by trust_code
    → captures IP from editorTokenToIp[session.access_token]
    → sets trusted_at + trusted_ip in DB
    → pushes editor WS: session_trusted {}

Editor: banner disappears, deploy unblocked
```

### D. Re-trust on IP change

```
POST /:token/packs/:packId/deploy
    → IF trusted_ip ≠ request_ip → 403 { error: "session_not_trusted" }

Editor: shows the trust banner again (same flow as C)
Admin retypes /artisan trusteditor → trusted_ip updated
```

---

## Modified / added endpoints

| Endpoint | Change |
|---|---|
| `POST /api/editor-session/:url_token/exchange` | **New** — exchanges url_token → access + refresh. `:url_token` is the one-time token from the URL. |
| `POST /api/editor-session/refresh` | **New** (fixed path, no token) — reads HttpOnly cookie, rotates the refresh token |
| `POST /api/editor-session/:token/refresh` | **Removed** — replaced by the `/refresh` route above |
| `GET /api/editor-session/:token` | **Modified** — accepts access_token, returns `{ server_key_id, trusted, trust_code }` |
| `POST /:token/packs/:packId/deploy` | **Modified** — checks trusted_at + trusted_ip |
| All `/:token/...` (except exchange) | **Modified** — the token in the path is now the access_token |

---

## IP capture

The hub maintains `editorTokenToIp: Map<string, string>` (access_token → IP). Fed by two sources:
1. **HTTP**: `trackEditorIp(access_token, ip)` called in `validateEditorToken` on every authenticated call
2. **WS**: on `onOpen` of `/ws/editor`, the IP is read from the HTTP headers of the upgrade and stored in the map (fallback if no HTTP call has been received yet)

On the trust request, the backend resolves `session.access_token` → `editorTokenToIp.get(access_token)` to get the IP to persist. If the map does not yet contain the IP (extremely rare case), trust is refused with `{ error: "editor_not_connected" }`.

The `trust_code` is valid for the whole session duration (7 days). It has no expiry of its own. "Invalid code" in the plugin feedback means: session not found, already revoked, or code not matching any active session.

---

## WS protocol — new messages

| Message | Direction | Fields |
|---|---|---|
| `editor_trust_request` | plugin → backend | `trust_code: string` |
| `session_trusted` | backend → editor WS | `{}` |

`EditorSessionReadyMessage` (backend → plugin): added `trust_code: string` field.

---

## Editor — UX changes

- **Exchange on load** of `/session?token=...`: POST exchange → `access_token` in Zustand memory
- **Error states**:
  - `already_used` → page "This link has already been used — rerun `/artisan editor`"
  - refresh 401 → "Session expired — rerun `/artisan editor`"
- **Trust banner**: shown if `trusted: false` at validation, or on 403 `session_not_trusted` after a deploy
- **WS `session_trusted`** → banner disappears
- **Silent refresh**: `setInterval` 4 min, transparent rotation

---

## Plugin — changes

- `/artisan trusteditor <code>`: new subcommand
- Sends `editor_trust_request { trust_code }` via the main WS
- Feedback: "Session éditeur autorisée." / "Code invalide ou expiré."
- Tab-complete on `trusteditor`
- `EditorSessionReadyMessage`: `trust_code` field read and stored for in-game display if needed

---

## Security coverage

| Scenario | Protection |
|---|---|
| URL accidentally shared | ✅ One-time token, unusable after the 1st visit |
| Access token stolen, session not trusted | ✅ Deploy blocked (trusted_at null) |
| Access token stolen, session trusted, same IP | ⚠️ 5-min window (acceptable) |
| Refresh token stolen (other machine = other IP) | ✅ Re-trust required, impossible without Minecraft server access |
| Legitimate IP change (VPN, 4G) | ✅ Session intact, re-trust is enough |

---

## Tests to write

| Scope | Cases |
|---|---|
| Backend unit | exchange consumes the token (2nd call → 401), refresh rotates the cookie, trust sets trusted_ip, deploy blocked if not trusted, deploy blocked on IP mismatch |
| Backend integration | full flow exchange → trust → deploy |
| Editor unit | sessionStore exchange flow, trust banner shown/hidden, silent refresh |
| Plugin unit | trusteditor command sends the right WS message |
