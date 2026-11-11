# Versioning and content negotiation (editor → plugin wire)

**Status: superseded (phase F, 2026-10)** — no more central editor facing plugins of different ages: editor and hub ship in the same jar, and the leaves' `hello` carries `protocol_version` (a different major = server not served). See [editor-web-server](editor-web-server.md).

**Status:** proposed (2026-10-01)

## Context

The editor is **central** (one web app), the plugins are **per server** and
update independently. The **project file format** is a **producer (editor) →
consumer (plugin)** contract.

The `structured-action-wire` ADR changed this format in a **breaking** way in
place (`menu/v1`: DSL string → keyed steps), relying on the assumption "not in
prod yet". That assumption is dead: as soon as there are several servers, a
lagging plugin **can no longer read** what the new editor writes → "the server
does not run this document". "Deploy the plugin first" does not hold at scale.

Yet the platform **already** applies a versioning discipline to REST
(`/api/v1/`), the DB schema (migrations) and the document schemas
(`menu/v1`) — but it has **no negotiation** between editor and plugin: neither
`protocol_version`/`core_version` (sent in `hello`, never persisted), nor
capabilities (in-memory, gated at write time) describe the **content format
version**.

## Decision

1. **The content wire is an explicit `content_version` (integer), announced by
   the plugin in `hello`.** Absent = `1` (old DSL wire). Current version: **2** =
   keyed structured steps (ADR `structured-action-wire`). Any **breaking**
   change to the format increments this version.

2. **The platform declares a minimum** (`MIN_CONTENT_VERSION`). The backend
   **refuses writes** to a server whose `content_version` is lower
   (`plugin_update_required` error, already wired as HTTP 503 + localized
   messages). → We **never** produce files that the target cannot read.

3. **The backend tracks the version per server** (in-memory registry, like
   capabilities) and **exposes** it via `GET /networks/:id/servers-status`. The
   editor shows an **"outdated plugin" banner** and **blocks saving** for that
   server, with the update link.

4. **Defense in depth**: the backend block (2) stays even if the UI does not
   display it — the write is the last barrier.

5. **Never change a format in place.** From now on: a new `content_version`
   **and** a new schema folder (`menu/v2`, `command/v2`), the plugin reading
   **all** the versions it supports; we deprecate in steps of
   `MIN_CONTENT_VERSION`.

*Rejected for now:* **automatic downgrade** (the editor re-emitting the old
format for a lagging plugin) — it requires keeping N serializers and the DSL
codec as a writer forever; we prefer to block/report while the fleet is small.
To reevaluate as the fleet grows.

*Out of scope (follow-ups)*: fine-grained **capability negotiation** (the editor
only emits a construct if the plugin announces it) + **backend translation** (the
editor sends a canonical form, the backend translates to the target version); and
**opt-in auto-update** (signed jar + signature check, staged rollout, rollback,
channels) — never by default.

## Consequences

- Deploying the editor no longer breaks a lagging server: the write is
  **clearly refused** (`plugin_update_required`), not corrupted.
- The admin of a lagging server **cannot edit** until they have updated their
  plugin — intended behavior, with an explicit message.
- The backend now distinguishes **content** (`content_version`) from
  **capabilities/features** (`mixed_project_write_v1`, …); both coexist.
- Draining the "legacy DSL reader" debt (P6 of `structured-action-wire`)
  becomes safe: once `MIN_CONTENT_VERSION = 2` and all servers are ≥ 2, the
  legacy reader can go.
- Fields to add to the protocol: `content_version` in `hello`
  (`WsClient.kt`), `HelloMessage` (`protocol.ts`), tracking + gate (`hub.ts`),
  `servers-status` (REST), `ServerStatusEntry` + banner (editor).
- Docs: `docs/architecture/ws-protocol.md` (hello/hello_ack),
  `docs/architecture/rest-endpoints.md` (`servers-status`).
