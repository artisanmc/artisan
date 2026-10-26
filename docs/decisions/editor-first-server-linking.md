# Editor-first server linking — a single `link` path, `setup` removed

**Status: superseded (phase F, 2026-10)** — no more linking to the cloud: `/artisan link` and server keys are removed; a leaf connects to the hub through `web.hub-url` and the network secret. See [editor-web-server](editor-web-server.md).

**Status: accepted (2026-07-15).** Follows the accounts-only cutover (`accounts-only-editing.md`), which had already pointed at "orphan server keys created by `/artisan setup` rerun against an incomprehensible UI".

Linking a Server to a Network now goes through **a single flow, initiated from the editor**:

1. In the editor, **"Add a server"** creates an *unredeemed* `server_key` (no secret yet, `hash` NULL) + a short `link_code` tied to that key, and displays the **code**.
2. On the Minecraft server, **`/artisan link <code>`** exchanges the code for the secret via `POST /api/v1/link/:code/redeem` (unauthenticated, the code = bearer). The backend **generates the secret at that moment**, sets the `hash`, marks the code consumed, and returns the secret **only once**. The plugin writes it to `config.yml` (`ConfigWriter.writeServerKey`) then connects.
3. **Re-link / rotation** = same path: "Regenerate a code" on the server card → new code tied to the **same** `server_key` → `/artisan link` = secret rotation. No new row is ever created.

`/artisan setup` (+ the `SetupClient` WS pairing) and the web `claim` flow (`POST /link`, `POST /link/:code/claim`) are **removed in one go** (pre-launch project, no clients to migrate).

## Why

There were **two** link paths, in opposite directions:

- **WS pairing** (`/artisan setup`): the plugin opens a WS, mints a code (`setup_request`), the admin claims it in the web UI (`/link?code=`), the backend creates the key and pushes the secret (`link_confirmed`).
- **Editor wizard** (`SetupWizard` Step2): the admin generates a key in the web UI, copies the raw `sk_…`, pastes it by hand into `config.yml`.

Two models = double surface (routes, WS messages, UI) for a single act. Above all, **each re-link minted a new `server_key`** without reusing or cleaning up the old one: a server re-linked N times left N keys in the Network (real incident 2026-07-15: 3 keys for 1 server, projects split across two of them). The "linked servers" badge counted all keys, so the user saw "3 servers" for a single machine.

The editor-first flow fixes both: a single model, and re-link **rotates** an existing key instead of creating one.

## Key semantics

- **Unredeemed key**: `server_keys.hash` becomes **nullable**. `hash = NULL` ⇒ key created in the editor but never redeemed ⇒ never authenticates (`validateServerKeyHeader` only matches real hashes). A Server can therefore exist "pending link" before the plugin connects.
- **Secret never stored in clear**: generated only in the `redeem` response (like the old WS push). The code carries the guarantees: high entropy, 10 min TTL, atomic single use.
- **`/artisan link <code>` on an already linked server**: **overwrites** the key in config (rotation or switch to another editor Server). The code is explicit, so no blocking — a WARN log for post-mortem.
- **`/artisan editor`**: linked → `server_url` deep link; not linked → editor home (after login) to create a server. No longer starts a setup.

## Rejected alternatives

- **Keep both paths**: this is exactly the duality that the accounts-only cutover condemned elsewhere — a permanent structural tax.
- **Reuse the key on the web `claim` side** (`server_key_id` param): fixes the duplicates but keeps the double path and the plugin-mints-code direction. Prototyped on 2026-07-15 then reverted in favor of this design.
- **Store the secret in clear on the server while waiting for the redeem**: useless — generating at redeem avoids any secret at rest.
- **Dedicated credential file** (outside `config.yml`): `ConfigWriter.writeServerKey` already writes to `config.yml`; no reason to introduce a second file.

## Consequences

- Forward-only DB migration: `server_keys.hash` nullable.
- Domain term: **`setup` → `link`** (see `CONTEXT.md`). `/artisan link <code>` replaces `/artisan setup [code]`.
- The plugin derives its HTTP base from the config `ws_url` (`wss://host/ws/plugin` → `https://host`) to call `redeem` before being linked — no new config key.
- Surface removed: WS `setup_request`/`setup_code`/`setup_claim`/`link_confirmed`, REST `POST /link` + `POST /link/:code/claim`, editor route `/link`, `SetupClient`.
