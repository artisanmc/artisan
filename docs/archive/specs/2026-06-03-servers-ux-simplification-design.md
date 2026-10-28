# Servers UX Simplification — Design

> Spec brainstormed on 2026-06-03 to clarify the server and workspace management model in the editor. Source of truth for the associated implementation plan.

**Status** — Spec validated. Implementation phased in 7 steps (P1 → P7), each independently shippable.

---

## 1. Goal

The current model exposes an M:N relation between `server_keys` and `packs` (via `pack_bindings`), branches + commits + promote/merge on the surface, and a "server_key" vocabulary that does not match the user's mental model. UX consequences:

- Confusing `/networks/:id` page: cards of "server_keys" with technical UUIDs, ambiguous bindings lists, the term "server_key" in every label.
- The setup wizard and the Network page mix concepts.
- A branch toolbar permanently in the workspace top bar for a use case (staging/prod) that nobody uses.

**This spec radically simplifies the user model**:

```
Network → Servers (1:N)
Server  → Workspaces (1:N — direct FK `packs.server_key_id`)
Server  → Modules (1:N, V1.5+)
```

No more M:N in the UI. No more "binding" as an exposed concept. No more branch toolbar. The `main` branch stays implicit in the backend to preserve snapshot/restore via a `History` tab.

## 2. Non-goals (explicit out-of-scope)

| Item | Reason |
|---|---|
| Syncing a workspace between several servers | V2. The user duplicates manually if they want the same content on 2 servers. An explicit "Sync to..." action will come later, with manual then automatic configuration. |
| Multiple branches per workspace (Promote, Merge) | V2 if a real need emerges. The backend code stays dormant. |
| Multi-server topology view with edges | The canvas stays workspace-scoped. |
| Sophisticated migration of existing multi-server bindings | No user in prod today. The migration takes the 1st binding and DELETEs orphan packs. |
| Refactoring the plugin↔backend WS protocol | The plugin still sends `hello` with a server_key, receives `bundle_available`. No protocol change. |

## 3. New mental model

```
User
 └── Network(s)          (membership-based access)
       └── Server(s)     (= 1 physical MC server, auth identity)
             ├── Workspace(s) (packs: menus + dialogs + commands)
             └── Module(s)    (shop, quests, etc. — V1.5+)
```

**Relations:**
- `User ↔ Network`: M:N via `memberships` (unchanged)
- `Network → Server`: 1:N (`server_keys.networkId` FK)
- `Server → Workspace`: **1:N (new)** via `packs.serverKeyId` FK
- `Server → Module`: 1:N (coming V1.5+, same pattern)

**Disappears from the user-facing language:**
- "server_key" as a term. Replaced by "Server" everywhere.
- "binding" as a concept. The workspace belongs to the server, period.
- "branch" as a primary concept. Stays in the backend, exposed only via History (snapshot/restore).

## 4. Data model

### 4.1 Schema changes

```sql
ALTER TABLE packs ADD COLUMN server_key_id text NOT NULL
  REFERENCES server_keys(id) ON DELETE CASCADE;

DROP TABLE pack_bindings;
```

Tables touched:
- `packs`: new `server_key_id` column, cascade FK. `network_id` stays (denormalized, simplifies permission queries without a JOIN).
- `pack_bindings`: disappears.
- `pack_branches`, `pack_commits`: unchanged. Each pack has its `main` branch at creation (already the case).

### 4.2 Endpoints that disappear

- `POST /networks/:id/packs/:packId/bindings/:serverKeyId`
- `DELETE /networks/:id/packs/:packId/bindings/:serverKeyId`
- `PATCH /networks/:id/packs/:packId/bindings/:serverKeyId`
- `GET /networks/:id/packs/:packId/bindings`

### 4.3 Endpoints that change

- `POST /networks/:id/packs`: the body now requires `serverKeyId` (in addition to `name`, `description?`). 422 `missing_server_key` if absent. 403 if the `serverKeyId` does not belong to the network.
- `GET /networks/:id`: the response now contains `packs` with their `serverKeyId` inline. The frontend filters by `activeServerId`.

### 4.4 New endpoint

- `GET /networks/:id/packs/:packId/commits/:commitId/content` → `{ commit, editor, files }` (same shape as the existing `/branches/:branch/head`, but by commit id). For the per-commit Restore button in the History tab.

### 4.5 WS hub impact

- `hello_ack.pack_hashes`: built by looking up `packs WHERE server_key_id = thisKey.id`, no longer going through `pack_bindings`.
- `pushBundleAvailable(packId)`: looks up `serverKeyId` directly on the pack row, broadcasts to the (now unique) connection for that server_key.
- Plugin↔backend protocol: **unchanged**. No plugin migration needed.

## 5. `/networks/:id` page redesign

### 5.1 Layout

```
┌─ Network: my_net ──────────────────────── ⚙ Settings ─┐
│                                                       │
│  ┌──────────────────────────────────────────────────┐ │
│  │ 🟢 Survival                                 [⋮]  │ │
│  │ 2 workspaces                                     │ │
│  │ ──────                                           │ │
│  │  📋 Shop                              → Open     │ │
│  │  📋 Lobby                             → Open     │ │
│  │  + New workspace                                 │ │
│  └──────────────────────────────────────────────────┘ │
│                                                       │
│  ┌──────────────────────────────────────────────────┐ │
│  │ ⚫ Hub                                       [⋮]  │ │
│  │ offline · last connected 3h ago                  │ │
│  │ ──────                                           │ │
│  │  📋 Welcome                           → Open     │ │
│  │  + New workspace                                 │ │
│  └──────────────────────────────────────────────────┘ │
│                                                       │
│  + Add server                                         │
│                                                       │
│  Members  (V2)                                        │
└───────────────────────────────────────────────────────┘
```

### 5.2 Server card anatomy

- **Header**: online/offline dot + label + kebab menu `[⋮]`
- **Subtitle**: "X workspaces"; for offline, adds "last connected ..." (from the hello audit log)
- **Workspaces list**: each row clickable → `/workspace/$packId`
- **Inline CTA**: "+ New workspace" at the bottom of the card

### 5.3 Kebab menu

```
⋮
├── Show server key…       (reveals plaintext key — modal one-time)
├── Rotate key…            (regenerates, modal one-time, see below)
├── ─────
├── Connection history     (opens ConnectionHistoryModal)
├── IP allowlist           (opens IpAllowlistModal)
├── ─────
└── Delete server…         (opens DeleteServerDialog with confirm-by-label)
```

### 5.4 Empty state

When the network has no server:

```
No server.
Type /artisan setup in your MC console to link one.

  [+ Add server (manual)]   ← link to the /setup wizard
```

### 5.5 Components

- **New**:
  - `ServerCard` — header + workspaces + kebab
  - `WorkspaceRow` — clickable workspace row
  - `ServerKebabMenu` — shadcn DropdownMenu
  - `ConnectionHistoryModal` — extraction of the existing HelloAuditPanel
  - `IpAllowlistModal` — extraction of the existing AllowlistPanel
  - `DeleteServerDialog` — confirm-by-typing-label (reuses the DeletePackDialog pattern)
  - `NewServerModal` — label + submit
  - `NewWorkspaceModal` — name + description (serverKeyId passed as a prop)
- **Survivors reused**:
  - `RotatedKeyModal` — serves for "Show key" AND "Rotate key" (one-time modal with copy-to-clipboard)
- **Removals**:
  - The old inline "Server Keys" section with collapse panels
  - The old separate "Packs" section
  - Any bindings listing; no reference to the word "binding"

## 6. Sidebar navigation

### 6.1 Layout

```
┌─ Sidebar ──────────────┐
│ [My Network ▾]         │   network dropdown (existing)
│                        │
│ [🟢 Survival ▾]        │   server dropdown (NEW, ≥2 servers)
│                        │
│ WORKSPACES             │
│  📋 Shop               │
│  📋 Lobby              │
│  + New workspace       │
│                        │
│ MODULES                │
│  (empty — V1.5+)       │
│                        │
│ ─────                  │
│ ⚙ Settings             │
└────────────────────────┘
```

### 6.2 Server selector behavior

- **0 servers in the network**: selector hidden. The workspaces section shows a CTA "Add a server to add workspaces" pointing to `/setup`.
- **1 server**: selector hidden (nothing to choose). Workspaces of the only server displayed.
- **≥2 servers**: dropdown visible under the network dropdown. Selection persisted in a new `useServersStore` store via `zustand/middleware/persist` (key `activeServerId`).

### 6.3 Auto-pick + transitions

- On arriving at a network with ≥2 servers: selects the 1st alphabetically if no `activeServerId` is cached, otherwise the persisted one.
- Creating a new server: auto-switch to that new server.
- Deleting the active server: switch to the 1st remaining, or clear if none is left.

### 6.4 Components

- `WorkspaceSidebar` (modified) — adds the server dropdown + the `pack.serverKeyId === activeServerId` filter
- `ServerDropdown` (new) — copy of the existing `NetworkDropdown` pattern
- `useServersStore` (new) — `{ activeServerId: string | null, setActiveServerId(id) }`, persisted

## 7. Creation / deletion

### 7.1 Server creation

**"+ Add server"** button on `/networks/:id`. Opens `NewServerModal`:

```
┌─ Add a server ────────────────────────────┐
│  Label                                    │
│  [_________________________________]      │
│           [Cancel]  [Create server]       │
└───────────────────────────────────────────┘
```

Submit → `POST /networks/:id/server-keys` (existing endpoint, unchanged) → opens `RotatedKeyModal` with the plaintext key + instructions "Paste in your plugin config.yml then run /artisan reload". Sidebar auto-switches to the new server.

### 7.2 Server deletion

From the kebab of a Server card → `DeleteServerDialog`:

```
┌─ Delete server "Survival" ?  ─────────────┐
│  This action is irreversible.             │
│  The plugin will lose access on next      │
│  hello. The following workspaces will     │
│  also be deleted :                        │
│   • Shop     (3 menus)                    │
│   • Lobby    (1 menu)                     │
│                                           │
│  Type the server label to confirm:        │
│  [_________________________________]      │
│         [Cancel]  [Delete server + 2 ws]  │
└───────────────────────────────────────────┘
```

Backend: `DELETE /networks/:id/server-keys/:keyId` (existing). The FK cascade on `packs` after the P1 migration is enough to delete the workspaces — no need to orchestrate on the frontend side.

### 7.3 Workspace creation

Two entry points:
- "+ New workspace" on a Server card (serverKeyId implicit = the card's)
- "+ New workspace" in the sidebar (serverKeyId = `activeServerId`)

`NewWorkspaceModal` modal:

```
┌─ New workspace on "Survival" ─────────────┐
│  Name                                     │
│  [_________________________________]      │
│  Description (optional)                   │
│  [_________________________________]      │
│           [Cancel]  [Create]              │
└───────────────────────────────────────────┘
```

Submit → `POST /networks/:id/packs` with `{ name, description?, serverKeyId }` → `navigate({ to: "/workspace/$packId", params })`.

### 7.4 Workspace deletion

**Unchanged.** `DeletePackDialog` + endpoints `DELETE /api/editor-session/:token/packs/:packId` (session) or `DELETE /api/networks/:id/packs/:packId` (user-auth, to add if not already there).

### 7.5 Setup wizard reorder

The current order (Network → Pack → ServerKey → Install) no longer works since the pack now needs `serverKeyId` at creation. New flow:

| Step | Before | After |
|---|---|---|
| 1 | Network | Network (unchanged) |
| 2 | Pack | **Server** (generate + reveal key) |
| 3 | Server Key | **Workspace** (with the serverKeyId from step 2) |
| 4 | Install | Install (unchanged) |

Purely a data-flow swap. `Step2Server` / `Step3Workspace` components reuse ~80% of the existing code of `Step2Pack` / `Step3ServerKey`.

## 8. Branches → History tab

### 8.1 Workspace tabs after refactor

```
Before: overview | translations | data-sources | servers
After:  overview | translations | data-sources | history
```

`servers` tab removed (the "this workspace is on server X" info moves to the header). `history` tab added.

### 8.2 Simplified workspace top bar

```
Before: [← Back] | <name> | [lang] [↶↷] [Branch ▾] [Commit] [Promote] [Merge] [⋮] [Deploy]
After:  [← Back] | <name> · on 🟢 Survival | [lang] [↶↷] [🟢1] [⋮] [Deploy]
```

- Disappears: `BranchSwitcher`, `DirtyBadge`, inline `Commit` button, `PromoteButton`, `MergeButton`, inline `HistoryPanel`, `CommitDialog` (moved into the History tab)
- Stays: `LangSwitcher`, `UndoRedoButtons`, `ServerStatusBadge` (simplified for 1 server), `TopBarKebabMenu`, `DeployButtons`
- Appears in the header: "on 🟢 Survival" with a clickable link to `/networks/:id`

### 8.3 History tab content

```
HISTORY                                            [Snapshot now]
────

▣ HEAD  ·  Deploy  ·  2 min ago  ·  iban           [Restore]
         "Deploy"
    Deploy  ·  1h ago  ·  iban                     [Restore]
         "Deploy"
    Manual snapshot  ·  3h ago  ·  iban            [Restore]
         "before refactor"
    Initial commit  ·  2d ago  ·  iban
    (current state — nothing to restore)
```

Implementation: extension of the existing `HistoryPanel` + a per-commit Restore button. "Snapshot now" opens the existing `CommitDialog`.

### 8.4 Restore action

Dual-mode, like Deploy/Revert:
- **Session mode**: HEAD-only Restore uses the existing `getDeployedPack` endpoint. Restoring an older commit is disabled in session mode V1 (the legacy session snapshot can only restore the head).
- **User-auth mode**: uses the new `GET /commits/:commitId/content` then `replacePack(restored)`. Works for HEAD and all past commits.

### 8.5 Dead code after this section

Files deleted:
- `editor/src/features/branches/BranchSwitcher.tsx`
- `editor/src/features/branches/PromoteButton.tsx`
- `editor/src/features/branches/MergeButton.tsx`
- `editor/src/features/branches/MergeConflictModal.tsx`
- `editor/src/state/branchesStore.ts` (nothing consumes `currentBranch` on the UI side any more)

Survivors: `CommitDialog.tsx`, `HistoryPanel.tsx`, `editor/src/lib/api/branches.ts` (listCommits, createCommit, getBranchHead are used).

Dormant backend code (kept for V2): `promote`, `merge-into`, `merge-into/.../resolve` endpoints + `mergeEngine.ts`. Not used in the V1 UI.

## 9. Migration

### 9.1 Strategy

```sql
-- 1. Add nullable column
ALTER TABLE packs ADD COLUMN server_key_id text REFERENCES server_keys(id);

-- 2. Backfill: pick the oldest binding per pack
UPDATE packs p SET server_key_id = (
  SELECT pb.server_key_id
  FROM pack_bindings pb
  WHERE pb.pack_id = p.id
  ORDER BY pb.created_at ASC
  LIMIT 1
)
WHERE p.server_key_id IS NULL;

-- 3. DELETE orphan packs (no binding ever existed = unreachable from any plugin)
DELETE FROM packs WHERE server_key_id IS NULL;

-- 4. Enforce NOT NULL + cascade
ALTER TABLE packs ALTER COLUMN server_key_id SET NOT NULL;
ALTER TABLE packs ADD CONSTRAINT packs_server_key_fk
  FOREIGN KEY (server_key_id) REFERENCES server_keys(id) ON DELETE CASCADE;

-- 5. Drop the M:N table
DROP TABLE pack_bindings;
```

Migration generated via `bun run db:generate`. Commit the `drizzle/00NN_*.sql` file. The Docker backend runs `db:migrate` at boot → applies on the next restart.

### 9.2 Multi-binding case (accepted data loss)

If a pack has several bindings:
- The 1st binding (by `createdAt` ASC) wins, its other bindings are silently lost.
- No warning to the user (V1 — no multi-binding power user in prod today).
- V2 can expose a sophisticated migration tool if the need emerges.

## 10. i18n vocabulary

Mass rename in `editor/src/locales/{en,fr}.ts`.

| Before | After | EN | FR |
|---|---|---|---|
| `networkDetail.serverKeys` | `networkDetail.servers` | Servers | Serveurs |
| `networkDetail.deleteKey` | `networkDetail.deleteServer` | Delete server | Supprimer le serveur |
| `networkDetail.confirmDeleteKey` | `networkDetail.confirmDeleteServer` | Delete this server? N workspaces will also be deleted. | Supprimer ce serveur ? N workspaces seront aussi supprimés. |
| `networkDetail.serverKeyNoPacks` | DEL | — | — |
| `networkDetail.noServerKeys` | `networkDetail.noServers` | No server. Run `/artisan setup` in your MC console. | Aucun serveur. Tape `/artisan setup` dans ta console MC. |
| `networkDetail.helloAudit*` | moved under `connectionHistoryModal.*` | (modal context) | (modal context) |
| `networkDetail.allowlist*` | moved under `ipAllowlistModal.*` | (modal context) | (modal context) |
| `setupWizard.step2/step3.*` | swap step2 ↔ step3 keys | — | — |
| `servers.*` (workspace tab) | DEL | — | — |
| (new) `newServerModal.*` | — | (modal labels) | — |
| (new) `newWorkspaceModal.*` | — | (modal labels) | — |
| (new) `serverCard.*` | — | (card labels) | — |
| (new) `deleteServerDialog.*` | — | (dialog labels) | — |
| (new) `historyTab.*` | — | (tab + snapshot/restore labels) | — |

The `rotateKey`, `rotateRevealTitle/Hint/KeyLabel/ShownOnce` keys (RotatedKeyModal) stay — "key" is a legitimate term in this technical context (the user copy-pastes a key).

Tests that assert by regex (`/Supprimer/i`, etc.) to update or replace with testids.

## 11. Tests

### Backend

- **Update**: `userNetworks.test.ts` — remove 4 binding endpoint cases (create, delete, list, patch branch). Keep rotation, audit log, allowlist (unchanged at the API surface).
- **Update**: `userPacks.test.ts` — `POST /packs` now requires `serverKeyId`; add 422 `missing_server_key` + 403 cross-network.
- **Update**: `hub.test.ts` — `hello_ack.pack_hashes` looks up by `packs.serverKeyId` instead of `pack_bindings`.
- **New**: test of the `GET /commits/:commitId/content` endpoint (200 with editor+files, 404 unknown commit, 403 non-member).
- **Migration test**: an isolated test that seeds a pre-migration dump (with multi-bindings), applies the Drizzle migration, checks the result (oldest binding wins, orphan packs deleted).

### Editor

- **Update**: `networks.$networkId.test.tsx` — assertions on Server cards instead of server_keys + bindings. Test of the kebab menu, of the extracted modals.
- **Update**: tests that mock `listPackBindings` become obsolete (deleted).
- **Update**: `ServerStatusBadge.test.tsx` — becomes 1-server logic, not N.
- **New**: tests for `ServerCard`, `ConnectionHistoryModal`, `IpAllowlistModal`, `NewServerModal`, `NewWorkspaceModal`, `ServerDropdown`, History tab Restore action (HEAD + per-commit).

**Target baseline**: at least equivalent to the current baseline (~971 editor + ~511 backend) after the refactor — the removals are offset by the new components.

## 12. Phasing

7 phases, each separately shippable. Test suite green between each.

| Phase | Scope | Risk |
|---|---|---|
| **P1** | Schema migration + backend endpoints (`packs.serverKeyId` FK, drop binding endpoints, update pack creation + hub.ts) + backend tests | Medium — migration |
| **P2** | Sidebar refactor: `ServerDropdown` + filter workspaces by active server + `useServersStore` | Medium |
| **P3** | `/networks/:id` redesign: Server cards + nested workspaces + kebab menu + `NewServerModal` + `NewWorkspaceModal` | Medium-high |
| **P4** | Modals extraction: `ConnectionHistoryModal`, `IpAllowlistModal`, `DeleteServerDialog` (with confirm-by-typing-label) | Low |
| **P5** | Drop branch toolbar UI + add History tab + `GET /commits/:id/content` endpoint + dual-mode Restore action | Medium |
| **P6** | `WorkspaceTopBarControls` cleanup (drop branch toolbar code, simplify ServerStatusBadge) + workspace tabs (drop `servers` tab) | Low |
| **P7** | Setup wizard step reorder + i18n vocabulary shift + delete dead components (BranchSwitcher, Promote, Merge, MergeConflictModal, branchesStore) | Low |

Rough estimate: P1 = 1 day (migration + endpoints + tests), P2-P3 = 1 day each, P4-P5 = 1 day each, P6-P7 = ½ day each. Total ~5-6 focused days.

## 13. Future considerations (V2+)

**Sync workspaces between servers**
- Explicit "Sync this workspace to..." action in a workspace's kebab or via a button in the top bar
- Picker of the target server + target workspace name (overwrite if it exists with confirmation, or new)
- V2.1: configurable auto-sync (cron, on-deploy hook)
- V2.2: conflict resolution if both servers were edited since the last sync (the dormant backend merge engine can be woken up)

**Multiple branches + Promote/Merge**
- Reintroduce if a real user asks for a staging/prod pattern
- Backend endpoints already exist, just to rewire in the UI

**Modules (V1.5+)**
- Same pattern: 1 module instance = 1 server (direct FK)
- Module cards nested under the workspaces on the Server card

**Cross-server visibility**
- An "all workspaces of the network" view that transcends the server selector, useful when the user has many servers
- Filter/search across all workspaces
- Out of scope V1; simple addition later if user demand emerges

**Server fingerprinting / multi-instance**
- Deliberately unsupported in V1 (cf. the server_key security model spec, commit e0d4b94a)
- If V2 reintroduces multi-instance, the UI can surface it as "advanced" without breaking the default 1:1 model
