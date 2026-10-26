# Linked-servers topbar badge + dropdown

**Date:** 2026-06-19
**Status:** Design approved, pending implementation plan

## Problem

The editor topbar shows a `ServerStatusBadge` for the **current project's** target server only. An admin running several Minecraft servers in a Network has no at-a-glance view of how many servers are linked, which are online, and when offline ones were last seen. The data model already records this (server keys + a hello audit log) but nothing surfaces it.

## Goal

Replace `ServerStatusBadge` with a network-scoped **linked-servers badge + dropdown** in the project topbar:

- Badge shows `online / total` (e.g. `2/3`) with an online/offline dot.
- Dropdown lists every server key in the current Network with: online/offline state, last-seen time (for offline), last IP, MC version, and a marker for the currently-open project's server.

Read-only this iteration — no rotate/rename/disconnect actions from the dropdown.

## What the model supports (feasibility)

| Field | Source | Available? |
|---|---|---|
| Linked count | `serverKeys` rows for the network | ✅ |
| Online / instance count | `getInstanceCount(serverKeyId)` (in-memory, `ws/hub.ts`) | ✅ |
| Last seen (offline) | latest accepted `server_key_helloes.helloAt` | ✅ |
| Last IP | latest accepted `server_key_helloes.ip` | ✅ |
| MC version | `serverKeys.lastMcVersion` | ✅ |
| **Port** | not captured anywhere | ❌ — IP only |

"Last seen" = timestamp of the last **accepted** hello (connection establishment), not a periodic heartbeat. For online servers we show "online", so the staleness of `helloAt` is irrelevant; for offline servers it is the meaningful "last connected" time. A true heartbeat `lastSeen` was considered and deferred (would need protocol + DB changes).

Multiple plugin instances on one key is tolerated by design (see `CONTEXT.md` Server/Presence). `instanceCount > 1` is surfaced as `×N` next to the online state.

## Backend

New endpoint, network-scoped, same ownership guard as the other `userNetworks.ts` routes:

```
GET /api/v1/networks/:id/servers-status?current=<serverKeyId>
```

Response:

```ts
{
  servers: Array<{
    id: string;
    label: string | null;
    online: boolean;          // getInstanceCount(id) > 0
    instanceCount: number;
    lastMcVersion: string | null;
    lastSeenAt: string | null; // last accepted hello helloAt, ISO
    lastSeenIp: string | null; // last accepted hello ip
    isCurrent: boolean;        // id === current query param
  }>;
  online: number;              // count of servers with online === true
  total: number;               // servers.length
}
```

Implementation:
1. `serverKeys` rows where `networkId = :id`.
2. Latest accepted hello per key: `server_key_helloes` `where rejectedReason IS NULL`, `distinctOn(serverKeyId)`, `order by serverKeyId, helloAt desc`.
3. `getInstanceCount(id)` per key (in-memory, free).
4. Assemble + compute `online`/`total`.

One round-trip serves both the badge count and the dropdown. Polled, so it stays light — does not return projects (unlike `GET /networks/:id`).

## Frontend

New component `editor/src/components/LinkedServersDropdown.tsx`:

- **Badge**: `online/total` text + dot (green if `online > 0`, grey otherwise). Built on the design-system `DropdownMenu` / `Badge`.
- **Dropdown rows** (one per server):
  - dot · `label` (fallback: short `id`) · "current" tag when `isCurrent`.
  - online → "Online" (`×N` if `instanceCount > 1`) · IP · MC version.
  - offline with `lastSeenAt` → "Last seen X ago" (relative) · last IP.
  - offline with `lastSeenAt === null` → "Never connected".
- **Polling**: 15s interval, cleared on unmount (mirrors current `ServerStatusBadge`).
- API client: `getNetworkServersStatus(networkId, currentServerKeyId)` in `editor/src/lib/api/networks.ts`.

All user-facing strings via react-i18next (en.ts + fr.ts, same commit). Colours via `var(--token)` only.

### Removal

`ServerStatusBadge.tsx` and its use in `ProjectTopBarControls.tsx` are removed (superseded). Verify no other usage before deleting.

## Testing (TDD)

- **Backend** (`bun run test`): online vs offline mapping; last accepted hello chosen; rejected hello ignored; `isCurrent`; `online`/`total` counts; empty network.
- **Editor** (`npm test`): badge renders `2/3`; dropdown lists online / offline / never-connected rows; relative "vu il y a X" formatting; current-server marker.

## Docs to update (same commit)

- `docs/architecture/rest-endpoints.md` — new route entry.

No WS / DB-schema / protocol changes.

## Out of scope

- Port display (not captured).
- Heartbeat `lastSeen`.
- Actions from the dropdown (rotate / rename / disconnect).
- Multi-IP / anomaly warnings.
