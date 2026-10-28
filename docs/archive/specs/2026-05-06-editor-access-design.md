# Editor Access & Real-Time Collaboration — Design

> **Date:** 2026-05-06
> **Scope:** `/artisan editor` command, session tokens, WebSocket editor channel, menu-level real-time collaboration, security hardening.
> **Prerequisite:** server linking (B1/B2) implemented — the plugin has a `server_key` and an authenticated WS to the backend.

---

## 1. Guiding principle

No account required to use the editor. The model is that of LuckPerms: `/artisan editor` generates a temporary URL, the admin opens it in their browser, full access immediately. A Pro account will be introduced later for advanced features — that is not in the scope of this design.

---

## 2. `/artisan editor` command

### Usage

```
/artisan editor          # generates a session and shows the URL
/artisan editor revoke   # revokes all active sessions of the server
```

### Permissions

- Guarded by the `artisan.editor` permission node (configurable via LuckPerms, etc.)
- `editor.console_only: true` option in `config.yml` → refuses if the sender is not the console

### Plugin config

```yaml
# plugins/Artisan/config.yml
server_key: "sk_..."
ws_url: "wss://editor.artisanmc.net/ws/plugin"
editor:
  console_only: false
```

### Flow

```
Admin types /artisan editor
        │
        ▼  (over the existing authenticated WS)
Plugin → backend : { type: "editor_session_request", sender: "PlayerName|CONSOLE" }
        │
        ▼
Backend generates token (30 chars crypto-random), inserts into editor_sessions
(server_key_id, expires_at = now + 30 min)
        │
        ▼
Backend → plugin : { type: "editor_session_ready", url: "...", expires_at: "..." }
        │
        ▼
Plugin shows in chat / console:
  [Artisan] Editor → https://editor.artisanmc.net/session?token=XXXXX
  (expires after 30 min of inactivity)
        │
        ▼
Admin opens the URL → editor loads, validates the token via GET /api/editor-session/:token,
opens WS /ws/editor, full access to the server's packs
```

---

## 3. Backend

### `editor_sessions` table

```sql
editor_sessions (
  token          text      PRIMARY KEY,        -- 30 chars crypto-random
  server_key_id  text      NOT NULL,           -- FK → server_keys.id
  created_by     text      NOT NULL,           -- "PlayerName" or "CONSOLE"
  created_at     timestamp NOT NULL,
  expires_at     timestamp NOT NULL,           -- reset on each activity
  revoked_at     timestamp                     -- nullable
)
```

### New plugin ↔ backend WS messages

```ts
// Plugin → backend (over authenticated WS)
{ type: "editor_session_request"; sender: string }
{ type: "editor_session_revoke" }   // triggered by /artisan editor revoke

// Backend → plugin
{ type: "editor_session_ready"; url: string; expires_at: string }
```

### New REST endpoints

| Method | Route | Auth | Usage |
|---|---|---|---|
| `GET` | `/api/editor-session/:token` | token | Validates the token, returns `{ server_key_id }` — called when the editor opens |
| `POST` | `/api/editor-session/:token/refresh` | token | Extends `expires_at` by 30 min — called every 10 min by the active editor |
| `DELETE` | `/api/editor-session` | token | Revokes the current session (called by the editor on explicit logout — optional) |

All other editor API calls (read/write packs, publish) pass `Authorization: Bearer <token>`. The backend validates the token and systematically scopes all responses to the associated `server_key_id`.

### Editor WebSocket

```
GET /ws/editor?token=<token>
```

- Validated at the HTTP → WS upgrade (invalid token = 401, connection refused)
- The backend registers the sender in `editorSenders: Map<server_key_id, Set<sendFn>>`
- Used for: pushing `session_expired`, broadcasting `draft_update` (collaboration), future notifications

### Editor ↔ backend WS messages

```ts
// Backend → editor (push)
{ type: "session_expired" }
{ type: "draft_update"; menu_id: string; menu_yaml: string; updated_by: string }

// Editor → backend (future, V1.5+)
// Saves stay on REST for now
```

---

## 4. Real-time collaboration (menu-level)

### Principle

When an admin saves a menu, the backend broadcasts the new `menu_yaml` to all active editors of the same server (except the sender).

### Editor-side behavior

| Situation | Behavior |
|---|---|
| Received menu = closed menu (not open in the editor) | Silent store update |
| Received menu = menu currently open | Notification: "Admin X modified this menu — reload?" (not applied automatically) |

### No OT/CRDT

Last write wins if two admins save the same menu at the same time. The "currently editing" notification limits this case in practice. OT/CRDT is explicitly out of scope (V2+).

### Presence (V1.5)

A cursor/badge "Admin X is on this menu" in the sidebar — fed by an `editor_presence { menu_id }` WS message sent when an editor opens a menu. Not in V1 scope — the "currently editing" notification is enough to avoid conflicts in practice.

---

## 5. Security

### Token

- 30 characters, 62-char alphabet (A-Z a-z 0-9), `crypto.getRandomValues` → ~178 bits of entropy
- Stored in clear in the DB (it is a bearer token, not a persistent secret — it expires quickly)
- Opaque: the backend answers identically to "nonexistent", "expired" and "revoked" → `401 Unauthorized`
- Removed from the URL as soon as the editor loads via `history.replaceState` (does not linger in browser history)

### Transport

- HTTPS mandatory in production (the token is in clear in the URL on first load — TLS protects this transit)
- `Authorization: Bearer <token>` header for all subsequent API calls → CSRF-immune (no cookies)
- OkHttp verifies the backend's TLS certificate by default (plugin side)

### Multiple sessions

- Several tokens active at the same time = OK (no automatic revocation on generation)
- An admin can work for 1h without fearing that a colleague cuts their session
- `/artisan editor revoke` = the only explicit kill switch, shows the list of active sessions before confirmation

### Rate limiting

| Endpoint / message | Limit |
|---|---|
| `GET /api/editor-session/:token` | 20 req/min per IP → 429 |
| `POST /api/link` | 5 req/min per IP |
| `editor_session_request` WS | 1 per 30s per connection |

### Strict scope

Each token is tied to a `server_key_id`. The backend refuses any response outside this scope, even with a valid token from another server.

### Audit

Each session generation logs: Minecraft username + UUID (or "CONSOLE"), timestamp, backend IP (via WS). Gives the admin visibility on who opened the editor.

---

## 6. `/session` editor route

```tsx
// editor/src/routes/session.tsx
// Loading:
// 1. GET /api/editor-session/:token → validates, gets server_key_id
// 2. Opens WS /ws/editor?token=...
// 3. Loads the server's packs
// 4. history.replaceState → removes the token from the URL
// 5. Starts POST /api/editor-session/:token/refresh every 10 min
```

---

## 7. New files

**Backend:**
- `backend/src/db/schema.ts` — `editor_sessions` table
- `backend/src/routes/editorSession.ts` — REST endpoints
- `backend/src/ws/hub.ts` — `editorSenders` map, handle `editor_session_request`, broadcast `draft_update`
- `backend/src/protocol.ts` — new WS types

**Plugin:**
- `plugin/.../command/ArtisanCommand.kt` — add `editor` and `editor revoke` subcommands
- `plugin/.../config/PluginConfig.kt` — add `editor.console_only`

**Editor:**
- `editor/src/routes/session.tsx` — `/session` route
- `editor/src/lib/editorSession.ts` — REST helpers (validate, refresh)
- `editor/src/lib/editorWs.ts` — editor WS (connect, handle draft_update, session_expired)

---

## 8. Out of scope (notes for later)

- **Pro account / billing**: separate design — no dependency on this plan
- **OT/CRDT**: field-level collaboration (same menu, same moment) — V2+
- **Advanced presence**: "Admin X is typing in slot 14" — V2+
- **MCModels import**: Pro feature, separate design
