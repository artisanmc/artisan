# No `LiveSessions` port until multi-instance is committed to

**Status: superseded (phase F, 2026-10)** — `ws/hub.ts` and the backend are removed; real-time state lives in the plugin's hub (`Servers`, `Sessions`, `EditorChannel`). See [editor-web-server](editor-web-server.md).

**Status:** accepted (2026-06-17)

## Decision

`ws/hub.ts` stays the **only in-memory adapter** of the real-time state (plugin/editor connections, broadcast, presence). We **do not introduce** a `LiveSessions` interface (port) with a swappable adapter as long as the backend is single-instance.

Routes keep consuming the hub through its **exported functions** (`pushBundleAvailable`, `broadcastDraftUpdate`, `pushPackDeleted`, `pushResourcePackUpdated`, `pushLinkConfirmed`, `getInstanceCount`, `getMcVersion`, `disconnectServerKey`, `trackEditorIp`). The in-memory maps (`connSenders`, `connToServerId`, `editorSenders`, `editorTokenToServer`) stay private to the module, exported **only** to inject `send` in tests.

## Why

An architecture review (2026-06-17) proposed extracting a `LiveSessions` port to "stop routes from reaching into the in-memory maps". On checking, the premise is false:

1. **No leak in production.** All routes import **functions** from the hub, never the maps. The maps are only imported by `hub.test.ts`, `editorSession.test.ts` and the WS wiring (`app.ts`). The hub therefore already presents a functional interface.
2. **Testability already achieved.** Without live connections, the broadcasters iterate over empty maps (no-op), `getInstanceCount`→0, `getMcVersion`→DB fallback. Routes are testable without WS. Tests that must assert a broadcast inject a fake `send` into the maps — a legitimate **internal test seam**, not a leak.
3. **A single adapter = a hypothetical seam.** The only real driver of a port would be **multi-instance** (shared state in Redis / a PostgreSQL table), explicitly noted as a future "if" in `decisions/stack.md` (§ WS sessions). It is not committed to. Introducing the port now would create an interface for a second adapter that does not exist — exactly the "one adapter = hypothetical seam" to avoid.

`hub.ts` is **wide** (≈581 LOC, ~16 functions) but **not shallow**: each function carries real behavior (broadcast targeted by `server_key`, protocol handshake, presence). "Wide" does not imply "to be deepened".

## Consequences

- The hub stays a singleton module with module-level state. Acceptable in single-instance.
- **Reopening condition**: the day multi-instance is really committed to (several backend processes behind an LB, sticky sessions insufficient). At that point two adapters really exist (in-memory + shared) → the seam becomes real: extract a `LiveSessions` interface, make the hub the in-memory adapter, add the shared adapter. Design the interface **against both adapters**, not in a vacuum.

## Rejected alternatives

- **Extract the port now.** Rejected: a hypothetical seam with a single adapter, with no testability gain (already achieved) nor real locality.
- **Split `handlePluginMessage` (protocol handler) from the registry/broadcast.** The handler is deeply entangled with the maps (it reads and mutates them in almost every branch); separating them amounts to injecting the registry — that is, the same speculative port. Deferred with this decision.
