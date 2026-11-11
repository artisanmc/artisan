# Accounts × Networks UX — Design

**Date**: 2026-05-22
**Status**: Approved, ready for planning
**Author**: Iban + Claude (brainstorming session)

## Context

Plan 1A (accounts foundation), 1B (Multi-server Networks), 1C (logged-in pack management), Phase 2 (branches), Phase 3 (merge) are all merged on `main`. On the backend side, the model is complete: `users`, `user_sessions`, `discord_accounts`, `networks`, `memberships`, `packs`, `pack_bindings`, `server_keys`, `editor_sessions`. On the editor side, the auth routes (`/login`, `/signup`, `/account`) and the editor session (trust dance via `/session?token=XXX`) work.

**The gap**: the plugin's `/artisan setup` command creates **anonymous** Networks (no login required, the `claim` does not ask for a user cookie). Consequences:

- A successful setup leaves a Network without an owner Membership → invisible in the future `/networks`.
- The `/api/networks/*` routes expose the logged-in user's Networks via `memberships`. Anonymous Networks are inaccessible.
- No editor UI to: list one's Networks, create one, see/manage the server_keys, transfer ownership.
- No mechanism to bootstrap the editor with packs already present on disk (the plugin has a `local_push` but it is manual via `/artisan pushLocal`).

## Decisions (from the brainstorming)

| # | Decision | Rationale |
|---|---|---|
| 1 | **Hard break** on the legacy `/artisan setup`: login required | Young project, few users, we avoid debt and "ghost networks" |
| 2 | Non-logged-in `/link?code=...` link → redirect `/login?next=...` | Reuse of the existing auth UI, 10-min TTL code covers the detour |
| 3 | Destination network choice **smart by count** | 0 → auto-create, 1 → confirm, 2+ → picker |
| 4 | Networks UI via dedicated routes `/networks`, `/networks/:id`, `/networks/:id/settings` | Architecture that scales; `/account` stays light (profile) |
| 5 | Memberships UI **deferred** ("1 member, you" section + placeholder) | Iban solo for now, table already exists on the backend |
| 6 | Transfer via **dedicated UI command** (not `/artisan setup`) | Separates responsibility: setup = addition, transfer = ownership change |
| 7 | Transfer = **whole Network** (server_keys + packs as a block) | Coarse granularity, avoids the complexity of per-pack cross-network mutation |
| 8 | Detaching a server without transfer = delete server_key + re-setup | Reuses the auto-push bootstrap, no destructive cross-account logic |
| 9 | **Auto-push bootstrap on hello** | No more manual `/artisan pushLocal` for the first time |
| 10 | Transfer initiation = **shareable link** (24h TTL), no transactional email | Minimal MVP, no SMTP/Resend infra to set up |

## Architecture

### Flow 1 — Setting up a new server (`/artisan setup`)

```
[Plugin]  /artisan setup
   ↓ setup_request (WS) → backend generates link_code (10min TTL)
   ↓ Plugin chat: clickable link → ${EDITOR_URL}/link?code=ABC123

[Browser hits /link?code=ABC123]
   ↓ Auth gate:
      • No `artisan_user_session` cookie → redirect /login?next=/link?code=ABC123
      • Logged in → continue
   ↓ Fetch GET /api/networks → claim wizard:
      • 0 networks → auto-creates "My Network", proceed
      • 1 network  → "Link this server to <name>?" + confirm button
      • 2+         → picker (cards) + "+ Create new" button

[On submit]
   ↓ POST /api/link/:code/claim { network_id }
   ↓ Backend:
      • Require user_session cookie (401 otherwise)
      • Membership check on network_id (403 otherwise)
      • Creates server_key in the chosen network (label = "Server <prefix>")
      • Broadcasts link_confirmed (WS) to the plugin
   ↓ Plugin writes server_key into config.yml + reinit
```

**Errors handled**:
- Expired code → page: "Link expired, retype `/artisan setup`"
- Code already claimed → "This setup has already been used"
- Not a member of the chosen network → 403 + UI message
- 401 if no cookie → redirect /login (covers the case of a session expiring during the wizard)

### Flow 2 — Transferring a whole Network

```
[Initiator — current owner]
   /networks/:id/settings → "Transfer ownership" section
   Shows a warning: "Transferring the Network <name> will give another user
   ownership of X packs + Y server_keys. You will lose all your rights on it."
   "Generate a transfer link" button

[Backend]
   POST /api/networks/:id/transfer/init
   → INSERT INTO network_transfers (token, networkId, initiatedByUserId, expiresAt = now+24h)
   → Return { url: "${EDITOR_URL}/transfer?token=XXX", expiresAt }

[Initiator copies the link and shares it off-platform (Discord/email)]

[Recipient opens /transfer?token=XXX]
   ↓ Auth gate (login required)
   ↓ Fetch GET /api/networks/transfer/:token
      → Return { networkName, packCount, serverKeyCount, initiatedBy: email } or 410 if expired/consumed
   ↓ Confirmation page: "Do you accept becoming owner of <networkName>?"
   ↓ "Accept" button

[On submit]
   POST /api/networks/transfer/:token/accept
   → Backend:
     • Validates token (not expired, not consumed)
     • DELETE FROM memberships WHERE networkId = X (old owner loses access — clean break)
     • INSERT INTO memberships (userId = current, networkId = X, role = 'owner')
     • UPDATE network_transfers SET consumedAt = NOW(), consumedByUserId = current
   → Plugin runtime intact: the server_keys did not change, the plugins keep their WS
```

### Flow 3 — Detaching a server without transferring the Network

```
[Owner — decides one of their servers is no longer part of their network]
   /networks/:id → list of server_keys → "Delete" button on the key concerned
   DELETE /api/networks/:id/server-keys/:keyId
   → Backend: DELETE pack_bindings WHERE serverKeyId = X, DELETE server_keys WHERE id = X
   → Plugin on this server loses the connection (backend no longer recognizes the key on the next hello)

[New admin on the recovered server]
   /artisan setup → normal claim into THEIR network
   → Auto-push bootstrap (Flow 4) reloads the disk packs into the new network
   → The old owner keeps their copy of the packs intact in their network
```

### Flow 4 — Auto-push bootstrap on hello

Modification of the `hello` handler on the **plugin** side:

```kotlin
// SyncedMenuProvider.handleHelloAck (after receiving the hello_ack)
val packHashes = ackPackHashes  // from hello_ack.pack_hashes
for (packDir in packsDir.listFiles { it.isDirectory && !it.name.startsWith(".") }) {
    val packId = packDir.name
    val diskHash = BundleHasher.hash(packDir)
    if (diskHash == "") continue  // empty disk pack → skip
    val backendHash = packHashes[packId] ?: ""
    if (backendHash == "") {
        // Backend does not know this pack OR it is empty on the backend → auto-push
        sendLocalPush(packId, packDir)
        logger?.info("Auto-pushed local pack '$packId' (backend was empty)")
    } else if (backendHash != diskHash) {
        // Both have different content → conflict, do not overwrite
        logger?.warning("Local pack '$packId' diverges from backend — NOT auto-pushed (use /artisan pushLocal to force)")
    }
}
```

**Backend**: the existing `local_push` handler (Plan 1C) is reused as is — it creates pack + binding if missing, upserts content, broadcasts `bundle_available`.

## Editor UI

| Route | Content | Status |
|---|---|---|
| `/` | Not logged in → redirect `/login`. Logged in → render `/networks` (or redirect) | **REVAMP** |
| `/login` | Email + password OR "Continue with Discord". "Create an account" link. Support `?next=` after login | **EXTEND** (`?next=`) |
| `/signup` | Existing | No change |
| `/account` | User profile (email, name, avatar, logout). "My Networks" link → `/networks` | **EXTEND** (link) |
| `/networks` | **NEW** — List of the user's networks (`GET /api/networks`). One card per network with: name, nb packs, nb server_keys. "+ Create a Network" button |
| `/networks/:id` | **NEW** — Detail: sections Packs (links to `/pack/:id`), Server Keys (list + "Generate new key" button + delete per key), Members (read-only "1 member: you" + placeholder "Invitations coming soon") |
| `/networks/:id/settings` | **NEW** — Rename, Delete, Transfer ownership |
| `/link?code=ABC` | **REVAMP** — Claim wizard (Flow 1) |
| `/transfer?token=XXX` | **NEW** — Accept transfer page (Flow 2) |
| `/session?token=XYZ` | **EXTEND** — "Network: <name>" header banner (retrieved via `validateEditorSession`, which now returns `networkId`) |

## Backend changes

### Modified endpoints

| Endpoint | Change |
|---|---|
| `POST /api/link/:code/claim` | Require `artisan_user_session` cookie. Body `{network_id?}`. If absent: 0 networks → auto-creates "My Network", 1 → use it, 2+ → 400 `must_choose_network`. Check membership (403). Removes the "anonymous network auto-create" code path. |
| `GET /api/editor-session/:token` | Adds `network_id` to the response |
| `GET /api/networks` | Existing — no change |
| `POST /api/networks` | Existing — no change |

### New endpoints

| Endpoint | Description |
|---|---|
| `POST /api/networks/:id/transfer/init` | Owner-only. Creates a `network_transfers` row. Returns `{url, expiresAt}`. |
| `GET /api/networks/transfer/:token` | Public auth-required. Returns info about the transfer for the confirmation page, or 410 if expired/consumed. |
| `POST /api/networks/transfer/:token/accept` | Auth required. Swaps memberships: old → deleted, new → owner. Marks `consumedAt`. |
| `DELETE /api/networks/:id/server-keys/:keyId` | Owner-only. Deletes server_key + cascades pack_bindings. |

### New table

```sql
CREATE TABLE network_transfers (
    token TEXT PRIMARY KEY,
    network_id TEXT NOT NULL REFERENCES networks(id) ON DELETE CASCADE,
    initiated_by_user_id TEXT NOT NULL REFERENCES users(id),
    expires_at TIMESTAMP NOT NULL,
    consumed_at TIMESTAMP,
    consumed_by_user_id TEXT REFERENCES users(id),
    created_at TIMESTAMP NOT NULL
);
CREATE INDEX network_transfers_network_idx ON network_transfers(network_id);
```

Tokens: 32 random chars, base62 (reuses `generateEditorToken` or an equivalent helper).

### Plugin (Kotlin) changes

- `SyncedMenuProvider.handleHelloAck`: after receiving the `hello_ack`, walk `packsDir`, for each pack that is non-empty on disk but empty on the backend → auto-send `local_push` (Flow 4).
- No change to `/artisan setup` (plugin side) — the command already sends `setup_request` to the backend, the backend handles the rest.

## Migration of the existing state

Iban's current state (the only affected user for now):
- 1 anonymous Network `net_ebe57cf700fd` (created via the legacy `/artisan setup` today)
- 1 server_key in it
- 1 pack `test` with content
- No membership row → without intervention, Iban would lose access after the hard break

**Chosen option**: one-shot SQL in the deployment session, to run manually after merge:

```sql
-- To adapt with Iban's real user_id
INSERT INTO memberships (user_id, network_id, role, created_at)
VALUES ('<iban_user_id>', 'net_ebe57cf700fd', 'owner', NOW());
```

Documented in the implementation plan (final step).

## Tests

### Backend

- `claim 401` without `artisan_user_session` cookie
- `claim` auto-creates Network if the user has 0 networks
- `claim 400 must_choose_network` if the user has 2+ networks and the body has no `network_id`
- `claim 403` if `network_id` belongs to another user (no membership)
- `claim` creates server_key in the chosen network + returns success
- `transfer/init` owner-only (403 otherwise)
- `transfer/accept` swaps memberships correctly
- `transfer/accept 410` if token expired or consumed
- `transfer/accept` succeeds even if the user has 0 networks beforehand (becomes owner of an existing Network)
- `DELETE server-keys` cascades the bindings, does not touch the packs (they may stay bound to other server_keys or orphaned)
- Hello handler: auto-push received if disk non-empty + backend empty

### Editor

- `/link?code=ABC` redirects to `/login?next=/link?code=ABC` if not authenticated
- After login, return to `/link` and normal claim
- `/link` smart count: 0 networks (auto-create), 1 (confirm), 2+ (picker)
- `/networks` list + loading state + empty state + error state
- `/networks/:id` rendering (packs, server_keys, members)
- `/networks/:id/settings` rename + delete + transfer init
- `/transfer?token=XXX` end-to-end accept flow (mock backend)
- `/transfer` 410 page if invalid token

### Plugin

- On hello, pack with non-empty disk + `pack_hashes[id] = ""` → sends `local_push`
- On hello, pack with disk == backend → no-op
- On hello, pack with disk ≠ backend (both non-empty) → WARN, no auto-push

## Out of scope (post-MVP)

- **Memberships UI** (invitations, editor/viewer roles). Table already exists on the DB side. To add when a user asks for multi-person collaboration.
- **Transactional email** for transfers and invitations. MVP uses a manually shared link.
- **Global sidebar** network switcher (Discord/Slack style). Dedicated routes are enough for now.
- **Audit log** of transfers and server_key creations.
- **Rate limiting** on claims and transfers.
- **Network deletion** UI (the route may already exist on the backend side, to expose on the UI side in a future iteration).
- **Manual server key rotation** (without transfer).
- **In-app notifications** for transfers (alternative to email).
