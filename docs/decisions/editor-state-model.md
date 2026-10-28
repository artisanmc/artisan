# Editor state model — backend-authoritative with broadcast collaboration

**Status: superseded (phase F, 2026-10)** — no more authoritative backend: the server's disk is the source of truth, the editor publishes by compare-and-swap. See [editor-web-server](editor-web-server.md).

**Status:** accepted (2026-04-29)

## Decision

The **backend is authoritative** over the state of a menu being edited. Every mutation made in a client (browser) is sent over WebSocket to the backend, validated against the canonical state, applied, then rebroadcast to **all clients connected** to that menu — other admin browsers **and** the Minecraft plugin.

Architecture:

- **Browser**: Zustand store with optimistic update on emission, reconciled with the canonical state received in the broadcast. zundo for local undo/redo.
- **localStorage**: synchronous write on every local mutation. Recovery net if the tab crashes between the mutation and its backend ack (rare; the WS RTT is ~30 ms).
- **Backend**: holds the canonical state in memory per active menu. Applies mutations in arrival order (last-writer-wins). Rejects syntactically invalid mutations or vanished targets (e.g. `element.delete` on an already deleted id) with an error message to the originating client only.
- **DB persistence**: the backend snapshots the canonical state to Postgres every 10 s on idle debounce. No write-per-mutation.
- **Plugin**: subscribed like one more client. Receives the same mutations as the browsers, applies them to open inventories.

**No soft-lock, no "Take Over"** — the spec had some, we get rid of it. A **presence indicator** shows who else is connected to the menu (Discord avatar + status). In case of simultaneous editing by two admins (rare at MVP: mostly solo accounts), LWW + visible presence is enough. If it becomes a real problem in V2, we add an "exclusive editing" mode to toggle.

## Why this reversal

The alternative initially chosen (browser-canonical + lock TTL/heartbeat/take-over) cost about as much to build as the broadcast version — lock endpoint, client heartbeat, server-side expiry, WS notification on take/release, Take Over UX. But only the broadcast version is **sellable as a feature**: seeing your co-admin move a slot in real time is the "wow" effect that demos in 5 s. The lock version just avoids conflicts — an invisible benefit.

## Accepted trade-offs

- **Stateful backend.** A Fly instance must host the canonical state of an active menu. Implies sticky session per `menu_id` (routing header or cookie), eviction after N min idle, rebuild from DB at cold start. Moderate infra cost, handled by Fly's session affinity.
- **LWW can overwrite work.** If two admins edit the same slot at the same time, the last one wins without warning. Mitigation: visible presence. To watch in post-launch user feedback; if a real problem, add an exclusive mode.
- **Reconnection mid-edit.** A reconnecting client receives a full snapshot of the canonical menu, discards its local state on divergence (with a prompt if the localStorage timestamp > snapshot timestamp).
- **Backend crash.** Mutations buffered browser-side since the last persistence (≤10 s) are replayed on reconnection. Canonical state rebuilt from DB + replay (limited to the last 10 seconds on the clients).

## Consequences for the rest of the architecture

- The browser→backend→plugin WS channel is no longer just a one-way push; it is a bidirectional mutation bus. The plugin is a subscriber like any other.
- The mutation format must be a **domain event** (see the upcoming ADR on mutation taxonomy) to stay readable in logs and trivial to apply on the Java plugin side.
- The client-side HTTP API `PUT /menus/:id/draft` disappears (persistence is internal to the backend). The REST endpoints remain for non-real-time operations: list, create, fork, publish, history fetch.
