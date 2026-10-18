# Servers UX Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the M:N `pack_bindings` model with 1:N `packs.serverKeyId`, hide branches/server_key technical terms from UI, and reorganize `/networks/:id` + sidebar around Server-as-first-class with workspaces nested per server.

**Architecture:** Backend schema migration first (drop `pack_bindings`, add `packs.serverKeyId` FK with cascade) so the new contract is in place before frontend refactor. Editor work in 6 subsequent phases: sidebar server selector, Network detail redesign with Server cards, modal extractions, History tab replacing branch toolbar, top-bar cleanup, then i18n + setup wizard reorder + dead component deletions.

**Tech Stack:** Bun + Hono + Drizzle (backend), React 19 + Vite + TanStack Router + Zustand (editor), vitest. Plugin protocol unchanged.

**Spec:** `docs/superpowers/specs/2026-06-03-servers-ux-simplification-design.md` (commit `b783afcd`).

---

## File Structure

### New files

| Path | Responsibility |
|---|---|
| `backend/drizzle/00NN_drop_pack_bindings.sql` | Generated migration: add FK, backfill, drop bindings table |
| `editor/src/state/serversStore.ts` | `{ activeServerId, setActiveServerId }`, persisted via zustand middleware |
| `editor/src/components/ServerDropdown.tsx` | Server selector below network dropdown (≥2 servers only) |
| `editor/src/components/network-detail/ServerCard.tsx` | Server card: header + workspaces list + kebab |
| `editor/src/components/network-detail/ServerKebabMenu.tsx` | Dropdown menu for Show/Rotate/History/Allowlist/Delete |
| `editor/src/components/network-detail/ConnectionHistoryModal.tsx` | Modal version of HelloAuditPanel |
| `editor/src/components/network-detail/IpAllowlistModal.tsx` | Modal version of AllowlistPanel |
| `editor/src/components/network-detail/DeleteServerDialog.tsx` | Confirm-by-typing-label dialog |
| `editor/src/components/network-detail/NewServerModal.tsx` | Label + create |
| `editor/src/components/network-detail/NewWorkspaceModal.tsx` | Name + description, scoped to serverKeyId |
| `editor/src/features/workspace/HistoryTab.tsx` | List of commits + Snapshot now + per-commit Restore |
| `editor/src/lib/api/commits.ts` | `getCommitContent(networkId, packId, commitId)` |

### Modified files (substantial)

| Path | Why |
|---|---|
| `backend/src/db/schema.ts` | Add `packs.serverKeyId` FK column, drop `packBindings` |
| `backend/src/routes/userNetworks.ts` | Remove 4 binding endpoints |
| `backend/src/routes/userPacks.ts` | `POST /packs` requires `serverKeyId` |
| `backend/src/routes/userBranches.ts` | New `GET /commits/:commitId/content` endpoint |
| `backend/src/lib/packStorage.ts` | `createPack` takes `serverKeyId` |
| `backend/src/lib/packBindingManager.ts` | Helpers updated to use new shape (or replaced) |
| `backend/src/ws/hub.ts` | `pack_hashes` lookup direct, no binding traversal |
| `backend/src/routes/link.ts` | `/api/link/:code/claim` updates: pack still optional, but with `serverKeyId` if creating |
| `editor/src/components/WorkspaceSidebar.tsx` | Server selector + workspace filter |
| `editor/src/routes/networks.$networkId.tsx` | Full redesign with ServerCard list |
| `editor/src/components/WorkspaceTopBarControls.tsx` | Drop branch toolbar, simplify ServerStatusBadge |
| `editor/src/routes/workspace.$workspaceId.tsx` | Drop `servers` tab, add `history` tab |
| `editor/src/features/setup/SetupWizard.tsx` | Reorder Step2/Step3 (Server before Workspace) |
| `editor/src/features/setup/SetupWizardSteps/Step2Pack.tsx` → `Step3Workspace.tsx` | Rename + adapt to take serverKeyId |
| `editor/src/features/setup/SetupWizardSteps/Step3ServerKey.tsx` → `Step2Server.tsx` | Rename + push serverKeyId/key up to wizard state |
| `editor/src/locales/en.ts`, `editor/src/locales/fr.ts` | Mass-rename of vocabulary |

### Deleted files

| Path | Why |
|---|---|
| `editor/src/features/branches/BranchSwitcher.tsx` | Branch toolbar gone |
| `editor/src/features/branches/PromoteButton.tsx` | Branch toolbar gone |
| `editor/src/features/branches/MergeButton.tsx` | Branch toolbar gone |
| `editor/src/features/branches/MergeConflictModal.tsx` | Merge gone from UI (V2) |
| `editor/src/state/branchesStore.ts` | Nothing in UI consumes `currentBranch` anymore |
| `editor/src/features/servers/ServersPanelContent.tsx` | The workspace `servers` tab content (M:N panel) |
| `editor/src/features/servers/BindServerDialog.tsx` | Binding UI gone |

### Conventions

- TDD where behavior is new; test-suite-pass gate for refactors.
- One commit per task with conventional commit prefix (`feat:`, `refactor:`, `test:`, `docs:`).
- Explicit `git add <paths>`. NEVER `git add -A`.
- i18n strings added to BOTH `editor/src/locales/en.ts` AND `fr.ts` in the same commit.
- Backend tests run via `bun run test` from `backend/`. NEVER `bun test` direct (wipes dev DB; guard in `db/index.ts` will throw).
- Editor tests run via `npx vitest run` from `editor/`.
- Migrations generated via `bun run db:generate` from `backend/`; commit the `drizzle/*.sql` + `drizzle/meta/*` files.

---

## Phase 1 — Schema migration + backend endpoints

**Goal:** Drop `pack_bindings`, add `packs.serverKeyId` FK with cascade, update endpoints + WS hub, update + remove backend tests. After P1, the backend exposes the new 1:N contract; frontend still expects M:N and will be patched in P2-P7.

### Task 1.1: Schema change — add `serverKeyId` to packs, drop packBindings

**Files:**
- Modify: `backend/src/db/schema.ts`
- Generate: `backend/drizzle/00NN_*.sql` + `backend/drizzle/meta/*.json`

- [ ] **Step 1: Edit `backend/src/db/schema.ts` — modify packs table and remove packBindings**

In `packs` table definition, add the new column. In the same file, delete the `packBindings` export entirely.

```ts
// In schema.ts, find the existing `packs` table and add `serverKeyId`:
export const packs = pgTable("packs", {
  id: text("id").primaryKey(),
  networkId: text("network_id").notNull().references(() => networks.id, { onDelete: "cascade" }),
  serverKeyId: text("server_key_id").notNull().references(() => serverKeys.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  hash: text("hash").notNull(),
  filesJson: text("files_json").notNull(),
  editorJson: text("editor_json"),
  deployedEditorJson: text("deployed_editor_json"),
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
}, (t) => [
  index("packs_network_idx").on(t.networkId),
  index("packs_server_key_idx").on(t.serverKeyId),
]);

// DELETE the entire `export const packBindings = pgTable(...)` block.
```

- [ ] **Step 2: Generate the migration**

Run from `backend/`: `bun run db:generate`
Expected: a new file at `backend/drizzle/00NN_<name>.sql` is created.

- [ ] **Step 3: Inspect the generated SQL and patch the backfill**

Drizzle's autogen will likely produce a destructive sequence that DROPs `pack_bindings` and ADDs the NOT NULL column without backfilling — Postgres will reject the ALTER on a non-empty `packs` table. Open the generated file and replace its body with:

```sql
-- Add nullable column first so existing rows aren't rejected
ALTER TABLE "packs" ADD COLUMN "server_key_id" text;

-- Backfill: pick the oldest binding per pack
UPDATE "packs" p SET "server_key_id" = (
  SELECT pb."server_key_id"
  FROM "pack_bindings" pb
  WHERE pb."pack_id" = p."id"
  ORDER BY pb."created_at" ASC
  LIMIT 1
)
WHERE p."server_key_id" IS NULL;

-- Drop orphan packs (no binding ever existed = unreachable from any plugin)
DELETE FROM "packs" WHERE "server_key_id" IS NULL;

-- Enforce NOT NULL + cascade FK
ALTER TABLE "packs" ALTER COLUMN "server_key_id" SET NOT NULL;
ALTER TABLE "packs" ADD CONSTRAINT "packs_server_key_id_server_keys_id_fk"
  FOREIGN KEY ("server_key_id") REFERENCES "public"."server_keys"("id") ON DELETE cascade;

CREATE INDEX IF NOT EXISTS "packs_server_key_idx" ON "packs" USING btree ("server_key_id");

-- Drop the M:N table (and its indexes/constraints implicitly)
DROP TABLE "pack_bindings";
```

- [ ] **Step 4: Apply the migration to the dev DB**

Run from `backend/`: `bun run db:push`
Expected: schema sync succeeds. If it errors, the generated SQL needs further tuning.

- [ ] **Step 5: Verify the dev DB state**

Run: `docker compose exec postgres psql -U postgres -d artisan -c "\d packs"`
Expected output contains: `server_key_id | text | | not null` and a FK constraint to `server_keys(id)`.

Run: `docker compose exec postgres psql -U postgres -d artisan -c "\d pack_bindings"`
Expected: `Did not find any relation named "pack_bindings"`.

- [ ] **Step 6: Commit**

```bash
git add backend/src/db/schema.ts backend/drizzle/00NN_*.sql backend/drizzle/meta
git commit -m "refactor(backend): packs.serverKeyId FK replaces pack_bindings M:N"
```

(Replace `00NN_*.sql` with the actual filename generated.)

### Task 1.2: Update `createPack` to take serverKeyId

**Files:**
- Modify: `backend/src/lib/packStorage.ts`

- [ ] **Step 1: Update the `createPack` signature**

In `backend/src/lib/packStorage.ts`, modify `createPack`:

```ts
export async function createPack(input: {
  networkId: string;
  serverKeyId: string;   // NEW: required
  name: string;
  description?: string | null;
  id?: string;
}): Promise<Pack> {
  const id = input.id ?? "pack_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  const now = new Date();
  const initialEditor = defaultEditorJson(id, input.name, now);
  await db.insert(packs).values({
    id,
    networkId: input.networkId,
    serverKeyId: input.serverKeyId,   // NEW
    name: input.name,
    description: input.description ?? null,
    hash: "",
    filesJson: "{}",
    editorJson: initialEditor,
    deployedEditorJson: null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  });
  const root = await createCommit({
    packId: id,
    parentId: null,
    files: {},
    editor: JSON.parse(initialEditor),
    authorUserId: null,
    message: "Initial commit",
  });
  await createBranch(id, "main", root.id);
  return (await getPack(id))!;
}
```

- [ ] **Step 2: Update all in-tree callers of `createPack`**

Grep for callers: `grep -rn "createPack({" backend/src/ --include="*.ts" | grep -v test`

Each caller now must pass `serverKeyId`. Read the call site, infer the right server key from context:

- `backend/src/routes/userNetworks.ts` — `POST /:id/packs` will be modified in Task 1.3.
- `backend/src/routes/link.ts` — `/api/link/:code/claim` creates a pack alongside a fresh server_key; pass the fresh `serverKeyId`.
- `backend/src/ws/hub.ts` — `setup_claim` handler may auto-create a pack; use the hello's `serverKeyId`.
- `backend/src/routes/userPacks.ts` — if `POST /api/user/packs` exists, it must take `serverKeyId` from body.

For each, add the field. If the caller doesn't already know which server_key, accept it as a parameter or pull from existing context.

- [ ] **Step 3: Update test fixtures that call `createPack`**

Grep for test callers: `grep -rn "createPack({" backend/src/ --include="*.test.ts"`

Each test that creates a pack must now seed a `server_key` first and pass its id. Example pattern to add at the top of test files:

```ts
async function seedServerKey(networkId: string): Promise<string> {
  const { id, hash } = await generateServerKey();
  await db.insert(serverKeys).values({
    id, hash, label: null, networkId, createdAt: new Date(),
  });
  return id;
}
```

Then in each test:
```ts
const serverKeyId = await seedServerKey(network.id);
const pack = await createPack({ networkId: network.id, serverKeyId, name: "test" });
```

- [ ] **Step 4: Run backend tests, fix until green**

Run from `backend/`: `bun run test`
Expected: all tests pass. Iterate fixing any callers / fixtures.

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/packStorage.ts backend/src/routes backend/src/ws backend/src/lib
git commit -m "refactor(backend): createPack requires serverKeyId; update callers"
```

### Task 1.3: Remove binding endpoints + update `POST /packs`

**Files:**
- Modify: `backend/src/routes/userNetworks.ts`
- Modify: `backend/src/routes/userNetworks.test.ts`

- [ ] **Step 1: Identify the binding endpoints to delete**

In `backend/src/routes/userNetworks.ts`, locate these route definitions:
- `userNetworksRouter.get("/:id/packs/:packId/bindings", ...)`
- `userNetworksRouter.patch("/:id/packs/:packId/bindings/:serverKeyId", ...)`
- `userNetworksRouter.post("/:id/packs/:packId/bindings/:serverKeyId", ...)`
- `userNetworksRouter.delete("/:id/packs/:packId/bindings/:serverKeyId", ...)`

Delete all four blocks entirely.

- [ ] **Step 2: Update `POST /:id/packs` to require serverKeyId**

Find the existing `userNetworksRouter.post("/:id/packs", ...)` handler and modify the body parsing:

```ts
userNetworksRouter.post("/:id/packs", async (c: Context<{ Variables: Vars }>) => {
  const userId = getUserId(c);
  if (!userId) return c.json({ error: "unauthorized" }, 401);

  const networkId = c.req.param("id");
  try { await requireMember(userId, networkId); } catch { return c.json({ error: "forbidden" }, 403); }

  const body = await c.req.json<{ name?: string; description?: string; serverKeyId?: string }>();
  if (typeof body.name !== "string" || body.name.trim().length === 0) {
    return c.json({ error: "invalid_name" }, 422);
  }
  if (typeof body.serverKeyId !== "string" || body.serverKeyId.length === 0) {
    return c.json({ error: "missing_server_key" }, 422);
  }
  // Verify the server_key belongs to this network.
  const skRows = await db.select().from(serverKeys).where(and(
    eq(serverKeys.id, body.serverKeyId),
    eq(serverKeys.networkId, networkId),
  ));
  if (skRows.length === 0) return c.json({ error: "server_key_not_in_network" }, 403);

  const pack = await createPack({
    networkId,
    serverKeyId: body.serverKeyId,
    name: body.name.trim(),
    description: body.description ?? null,
  });
  return c.json({ pack }, 201);
});
```

- [ ] **Step 3: Remove the now-unused `getInstanceCount` import if present**

After deleting binding endpoints, `getInstanceCount` from `../ws/hub` may be unused. Remove from imports if so.

- [ ] **Step 4: Update `userNetworks.test.ts` — delete binding tests**

Find and delete these describe blocks / test cases:
- Any test in a `describe("POST /:id/packs/:packId/bindings/...")` block
- Any test in a `describe("DELETE /:id/packs/:packId/bindings/...")` block
- Any test in a `describe("PATCH ... /bindings/...")` block
- Any test in a `describe("GET /:id/packs/:packId/bindings")` block

For tests that exercise pack creation, update them to include `serverKeyId` in the request body:

```ts
const res = await app.request(`/api/v1/networks/${network.id}/packs`, {
  method: "POST",
  headers: { Cookie: ..., "Content-Type": "application/json" },
  body: JSON.stringify({ name: "p1", serverKeyId: skId }),
});
```

- [ ] **Step 5: Add new test for `POST /packs` 422 missing_server_key**

In `userNetworks.test.ts`, add inside the existing networks router describe:

```ts
test("POST /:id/packs returns 422 when serverKeyId is missing", async () => {
  const { sessionId } = await seedUser(`u_p_${Math.random().toString(36).slice(2, 8)}`);
  const app = makeApp();
  const { network } = await (await app.request("/api/v1/networks", {
    method: "POST",
    headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "N" }),
  })).json();

  const res = await app.request(`/api/v1/networks/${network.id}/packs`, {
    method: "POST",
    headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "p1" }),  // no serverKeyId
  });
  expect(res.status).toBe(422);
  expect((await res.json()).error).toBe("missing_server_key");
});

test("POST /:id/packs returns 403 when serverKey is in another network", async () => {
  const suffix = Math.random().toString(36).slice(2, 8);
  const { sessionId: sessA } = await seedUser(`uA_p_${suffix}`);
  const { sessionId: sessB } = await seedUser(`uB_p_${suffix}`);
  const app = makeApp();

  // uA creates a network + server_key
  const { network: netA } = await (await app.request("/api/v1/networks", {
    method: "POST", headers: { Cookie: `artisan_user_session=${sessA}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "NA" }),
  })).json();
  const skRes = await app.request(`/api/v1/networks/${netA.id}/server-keys`, {
    method: "POST", headers: { Cookie: `artisan_user_session=${sessA}`, "Content-Type": "application/json" }, body: "{}",
  });
  const { id: skId } = await skRes.json();

  // uB creates its own network and tries to use uA's serverKeyId
  const { network: netB } = await (await app.request("/api/v1/networks", {
    method: "POST", headers: { Cookie: `artisan_user_session=${sessB}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "NB" }),
  })).json();
  const res = await app.request(`/api/v1/networks/${netB.id}/packs`, {
    method: "POST", headers: { Cookie: `artisan_user_session=${sessB}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "p1", serverKeyId: skId }),
  });
  expect(res.status).toBe(403);
  expect((await res.json()).error).toBe("server_key_not_in_network");
});
```

- [ ] **Step 6: Run tests**

Run from `backend/`: `bun run test src/routes/userNetworks.test.ts`
Expected: all tests pass (including the 2 new ones).

- [ ] **Step 7: Commit**

```bash
git add backend/src/routes/userNetworks.ts backend/src/routes/userNetworks.test.ts
git commit -m "refactor(backend): remove pack-binding endpoints, POST /packs now requires serverKeyId"
```

### Task 1.4: Update WS hub `pack_hashes` lookup

**Files:**
- Modify: `backend/src/ws/hub.ts`
- Modify: `backend/src/ws/hub.test.ts`

- [ ] **Step 1: Locate the binding traversal**

In `backend/src/ws/hub.ts`, find the block that builds `packHashesMap` from `pack_bindings` (around the `hello` handler, after `validateServerKey` returns). The current code joins `pack_bindings` to find packs for this server_key, then looks up each pack's branch + head commit.

- [ ] **Step 2: Rewrite to query packs directly by serverKeyId**

Replace the binding-traversal block with:

```ts
// Build pack_hashes via branch → commit content hash. Packs are now owned
// 1:N by server_key (no more pack_bindings table).
const ownedPacks = await db
  .select({ id: packs.id })
  .from(packs)
  .where(and(eq(packs.serverKeyId, keyId), isNull(packs.deletedAt)));

const packHashesMap: Record<string, string> = {};
for (const p of ownedPacks) {
  const branch = await db.select().from(packBranches).where(and(
    eq(packBranches.packId, p.id), eq(packBranches.name, "main"),
  ));
  if (branch.length === 0) continue;
  const cmt = await db.select({ contentHash: packCommits.contentHash })
    .from(packCommits)
    .where(eq(packCommits.id, branch[0].headCommitId));
  if (cmt.length === 0) continue;
  packHashesMap[p.id] = cmt[0].contentHash;
}
```

- [ ] **Step 3: Update `pushBundleAvailable` similarly**

Find the existing `pushBundleAvailable` function (or wherever bundles are pushed to plugins) and replace any `pack_bindings` join with a direct `packs.serverKeyId` lookup:

```ts
export async function pushBundleAvailable(packId: string, hash: string): Promise<void> {
  const rows = await db.select({ serverKeyId: packs.serverKeyId }).from(packs).where(eq(packs.id, packId));
  if (rows.length === 0) return;
  const serverKeyId = rows[0].serverKeyId;
  // ... push to the conn(s) for this serverKeyId, unchanged ...
}
```

Same pattern for `pushPackDeleted` if it exists.

- [ ] **Step 4: Update `hello_ack.deleted_pack_ids` query**

If hub.ts has a query joining `packs` + `pack_bindings` + `isNotNull(packs.deletedAt)`, replace with direct:

```ts
const deletedRows = await db
  .select({ id: packs.id })
  .from(packs)
  .where(and(eq(packs.serverKeyId, keyId), isNotNull(packs.deletedAt)));
const deletedPackIds = deletedRows.map((r) => r.id);
```

- [ ] **Step 5: Remove now-unused `packBindings` import**

In `backend/src/ws/hub.ts` imports, remove `packBindings` from the `../db/schema` import line.

- [ ] **Step 6: Update `hub.test.ts` fixtures**

Find test helpers that seed bindings (e.g. `seedBoundPack`). They probably call `createBinding`. Replace with direct `serverKeyId` on the pack:

```ts
async function seedBoundPack(
  networkId: string,
  serverKeyId: string,
  packId: string,
  hash: string,
  files: Record<string, string> = {},
  editor: Record<string, unknown> = {},
  deleted = false,
): Promise<void> {
  await createPack({ networkId, serverKeyId, name: packId, id: packId });
  await upsertPackContent(packId, {
    hash,
    filesJson: JSON.stringify(files),
    editorJson: JSON.stringify(editor),
  });
  if (deleted) await softDeletePack(packId);
}
```

(The `createBinding` call disappears.)

- [ ] **Step 7: Update `clearAll` in hub.test.ts**

Find `clearAll` and remove `await db.delete(packBindings);` (the table no longer exists). Also remove the `packBindings` import.

- [ ] **Step 8: Run hub tests**

Run from `backend/`: `bun run test src/ws/hub.test.ts`
Expected: all tests pass.

- [ ] **Step 9: Commit**

```bash
git add backend/src/ws/hub.ts backend/src/ws/hub.test.ts
git commit -m "refactor(backend): hub queries packs by serverKeyId directly, no binding traversal"
```

### Task 1.5: Delete `packBindingManager.ts` + remove all imports

**Files:**
- Delete: `backend/src/lib/packBindingManager.ts`
- Modify: any file importing from it

- [ ] **Step 1: Find all imports of packBindingManager**

Run: `grep -rn "packBindingManager" backend/src/ --include="*.ts"`

- [ ] **Step 2: Remove each import line and the imported helper calls**

The helpers (`createBinding`, `deleteBinding`, `listPacksForServerKey`, `listServerKeysForPack`) are no longer needed. Where they were called:

- `listPacksForServerKey(keyId)` → replace with `db.select().from(packs).where(eq(packs.serverKeyId, keyId))`
- Other helpers: similar inline rewrites.

Verify all callers compile after the removal.

- [ ] **Step 3: Delete the file**

```bash
rm backend/src/lib/packBindingManager.ts
```

- [ ] **Step 4: Run full backend test suite**

Run from `backend/`: `bun run test`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add -u  # captures the deletion + modified files
git commit -m "refactor(backend): remove packBindingManager (dead after binding endpoints dropped)"
```

(Exception to "no `-u`": this commit only touches files already deleted or modified in P1; verify with `git status` first.)

### Task 1.6: Update `/api/link/:code/claim` to handle 1:N model

**Files:**
- Modify: `backend/src/routes/link.ts`
- Modify: `backend/src/routes/link.test.ts`

- [ ] **Step 1: Read the current claim logic**

The endpoint creates server_key + maybe creates pack + maybe binds them. With the new model, "binding" disappears — `createPack` must just be called with the fresh `serverKeyId`.

Find the call to `createPack(...)` in the claim handler and ensure it now passes the fresh `serverKeyId` (which the handler just created).

- [ ] **Step 2: Remove any `createBinding(...)` calls**

If the claim handler called `createBinding(serverKeyId, packId)` after creating the pack, delete that call — no longer needed.

- [ ] **Step 3: Update claim tests**

In `backend/src/routes/link.test.ts`, find tests that verify post-claim state. Replace assertions on `pack_bindings` rows with assertions on `packs.serverKeyId`:

```ts
const packRows = await db.select().from(packs).where(eq(packs.id, claimResult.pack_id));
expect(packRows[0].serverKeyId).toBe(claimResult.server_key_id);
```

- [ ] **Step 4: Run tests**

Run from `backend/`: `bun run test src/routes/link.test.ts`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/link.ts backend/src/routes/link.test.ts
git commit -m "refactor(backend): link claim creates pack with serverKeyId directly"
```

### Task 1.7: Final P1 verification

- [ ] **Step 1: Run full backend test suite**

Run from `backend/`: `bun run test`
Expected: all tests pass.

- [ ] **Step 2: Restart backend container and check it boots**

```bash
docker compose restart backend
sleep 5
docker compose logs backend --tail 20
```
Expected: `[migrate] done` then `Artisan backend on http://localhost:3001`. No errors.

- [ ] **Step 3: Manual API smoke**

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001/api/v1/networks
```
Expected: 401 (unauth without cookie).

If anything from Steps 1-3 fails, fix before proceeding to P2.

---

## Phase 2 — Sidebar refactor: server selector + workspace filter

**Goal:** The sidebar now shows a server dropdown below the network dropdown (when ≥2 servers), and the workspace list filters by the active server's id.

### Task 2.1: Add `useServersStore`

**Files:**
- Create: `editor/src/state/serversStore.ts`

- [ ] **Step 1: Create the store**

```ts
// editor/src/state/serversStore.ts
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface State {
  activeServerId: string | null;
  setActiveServerId: (id: string | null) => void;
  reset: () => void;
}

export const useServersStore = create<State>()(
  persist(
    (set) => ({
      activeServerId: null,
      setActiveServerId: (id) => set({ activeServerId: id }),
      reset: () => set({ activeServerId: null }),
    }),
    {
      name: "artisan.serversStore",
      partialize: (s) => ({ activeServerId: s.activeServerId }),
    },
  ),
);
```

- [ ] **Step 2: Add a focused test**

```ts
// editor/src/state/serversStore.test.ts
import { describe, expect, it } from "vitest";
import { useServersStore } from "./serversStore";

describe("useServersStore", () => {
  it("starts with null and updates via setActiveServerId", () => {
    useServersStore.getState().reset();
    expect(useServersStore.getState().activeServerId).toBeNull();
    useServersStore.getState().setActiveServerId("sk_1");
    expect(useServersStore.getState().activeServerId).toBe("sk_1");
  });
});
```

- [ ] **Step 3: Run the test, commit**

Run: `cd editor && npx vitest run src/state/serversStore.test.ts`
Expected: PASS.

```bash
git add editor/src/state/serversStore.ts editor/src/state/serversStore.test.ts
git commit -m "feat(editor): add useServersStore (persisted activeServerId)"
```

### Task 2.2: Create `ServerDropdown` component

**Files:**
- Create: `editor/src/components/ServerDropdown.tsx`
- Create: `editor/src/components/ServerDropdown.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// editor/src/components/ServerDropdown.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ServerDropdown } from "./ServerDropdown";
import { useServersStore } from "@/state/serversStore";

describe("ServerDropdown", () => {
  beforeEach(() => useServersStore.getState().reset());

  it("renders nothing when 0 or 1 servers", () => {
    const { container } = render(<ServerDropdown servers={[]} />);
    expect(container.firstChild).toBeNull();
    const { container: c2 } = render(<ServerDropdown servers={[{ id: "sk1", label: "Solo" }]} />);
    expect(c2.firstChild).toBeNull();
  });

  it("renders a select when ≥2 servers, updates store on change", () => {
    render(<ServerDropdown servers={[
      { id: "sk1", label: "Survival" },
      { id: "sk2", label: "Hub" },
    ]} />);
    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "sk2" } });
    expect(useServersStore.getState().activeServerId).toBe("sk2");
  });
});
```

- [ ] **Step 2: Implement**

```tsx
// editor/src/components/ServerDropdown.tsx
import { useEffect } from "react";
import { useServersStore } from "@/state/serversStore";

interface ServerSummary { id: string; label: string | null; }
interface Props { servers: ServerSummary[]; }

export function ServerDropdown({ servers }: Props) {
  const activeServerId = useServersStore((s) => s.activeServerId);
  const setActiveServerId = useServersStore((s) => s.setActiveServerId);

  // Auto-pick the first server alphabetically if none selected OR the
  // selected one is no longer in the list.
  useEffect(() => {
    if (servers.length === 0) return;
    const stillValid = servers.some((s) => s.id === activeServerId);
    if (!stillValid) {
      const sorted = [...servers].sort((a, b) =>
        (a.label ?? a.id).localeCompare(b.label ?? b.id),
      );
      setActiveServerId(sorted[0]!.id);
    }
  }, [servers, activeServerId, setActiveServerId]);

  if (servers.length < 2) return null;

  return (
    <select
      className="mono h-[34px] w-full appearance-none rounded-[10px] border border-[var(--line)] bg-[var(--raised)] px-3 text-[12px] text-[var(--ink-2)] hover:border-[var(--line-strong)]"
      value={activeServerId ?? ""}
      onChange={(e) => setActiveServerId(e.target.value)}
    >
      {servers.map((s) => (
        <option key={s.id} value={s.id}>{s.label ?? s.id.slice(0, 12)}</option>
      ))}
    </select>
  );
}
```

- [ ] **Step 3: Run + commit**

Run: `cd editor && npx vitest run src/components/ServerDropdown.test.tsx`
Expected: PASS.

```bash
git add editor/src/components/ServerDropdown.tsx editor/src/components/ServerDropdown.test.tsx
git commit -m "feat(editor): ServerDropdown — server selector for ≥2 servers"
```

### Task 2.3: Wire `ServerDropdown` + workspace filter into `WorkspaceSidebar`

**Files:**
- Modify: `editor/src/components/WorkspaceSidebar.tsx`

- [ ] **Step 1: Read the current sidebar to find the workspace list rendering**

Open `editor/src/components/WorkspaceSidebar.tsx`. Note where `serverPacks` is rendered and how `getNetwork(activeNetworkId)` populates them.

- [ ] **Step 2: Update `getNetwork()` consumer to extract servers**

The current `getNetwork` response already returns `serverKeys: ServerKeySummary[]`. Capture them into state:

```ts
const [serverPacks, setServerPacks] = useState<PackSummary[]>([]);
const [networkServers, setNetworkServers] = useState<{ id: string; label: string | null }[]>([]);
// ... inside the existing useEffect for refetch:
.then((d) => {
  if (!cancelled) {
    setServerPacks(d.packs);
    setNetworkServers(d.serverKeys);
  }
})
```

- [ ] **Step 3: Mount the ServerDropdown + filter packs by activeServerId**

Below the existing network dropdown, add:

```tsx
import { ServerDropdown } from "@/components/ServerDropdown";
import { useServersStore } from "@/state/serversStore";

// inside the component:
const activeServerId = useServersStore((s) => s.activeServerId);

// in JSX, below the network dropdown:
<ServerDropdown servers={networkServers} />

// In the existing block that builds `allPacks`, filter by activeServerId.
// The PackSummary from the API needs a `serverKeyId` field — verify the
// API response includes it (Task 1.3 made packs include it server-side).
// If PackSummary doesn't have it, add it to the type:
//   editor/src/lib/api/networks.ts — PackSummary { id, name, hash, serverKeyId, updatedAt? }
const filteredServerPacks = activeServerId
  ? serverPacks.filter((p) => p.serverKeyId === activeServerId)
  : serverPacks;
// Use filteredServerPacks everywhere serverPacks was used below this point.
```

- [ ] **Step 4: Update `PackSummary` type in `editor/src/lib/api/networks.ts`**

```ts
export interface PackSummary {
  id: string;
  name: string;
  hash: string;
  serverKeyId: string;   // NEW
  updatedAt?: string;
}
```

- [ ] **Step 5: Run editor tests**

Run from `editor/`: `npx vitest run`
Expected: pass. Some sidebar tests may need updates if they mock the API response — add `serverKeyId: "sk_test"` to fixture packs.

- [ ] **Step 6: Manual smoke**

Open the editor in browser. With ≥2 servers in a network: dropdown appears, switching changes the workspace list. With 1 or 0 servers: dropdown hidden, list works as before.

- [ ] **Step 7: Commit**

```bash
git add editor/src/components/WorkspaceSidebar.tsx editor/src/lib/api/networks.ts
git commit -m "feat(editor): sidebar shows ServerDropdown + filters workspaces by activeServerId"
```

### Task 2.4: `New workspace` flow from sidebar uses `activeServerId`

**Files:**
- Modify: `editor/src/components/WorkspaceSidebar.tsx`

The existing "+ New workspace" path (whatever it does today — likely opens a dialog) must now pass `serverKeyId = activeServerId` to the create endpoint.

- [ ] **Step 1: Find the existing new-workspace call site**

In `WorkspaceSidebar.tsx`, find where the "+" link/button triggers pack creation (it might delegate to `accountStore.createPack` or a route).

- [ ] **Step 2: Ensure `activeServerId` flows into the create call**

If the existing flow uses an API like `createPack({ networkId, name })`, change to `createPack({ networkId, serverKeyId: activeServerId, name })`. The full API-client change is in Task 3.x (creation modals); for now, ensure the sidebar passes activeServerId through.

If the sidebar's `+ New workspace` opens a modal handled elsewhere, defer to that task — just note here.

- [ ] **Step 3: Commit (if changes made)**

```bash
git add editor/src/components/WorkspaceSidebar.tsx
git commit -m "feat(editor): sidebar New workspace passes activeServerId"
```

(If no changes were needed because the flow lives elsewhere, skip this task and document why in the working notes.)

---

## Phase 3 — /networks/:id redesign

### Task 3.1: Extract `ServerCard` component

**Files:**
- Create: `editor/src/components/network-detail/ServerCard.tsx`
- Create: `editor/src/components/network-detail/ServerCard.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// editor/src/components/network-detail/ServerCard.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ServerCard } from "./ServerCard";

vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return { ...actual, Link: ({ children, ...p }: any) => <a {...p}>{children}</a> };
});

const server = { id: "sk1", label: "Survival", online: true } as any;
const workspaces = [
  { id: "p1", name: "Shop" },
  { id: "p2", name: "Lobby" },
] as any;

describe("ServerCard", () => {
  it("shows label, online dot, workspaces, count, and 'new workspace' CTA", () => {
    render(<ServerCard server={server} workspaces={workspaces} onAction={() => {}} onCreateWorkspace={() => {}} />);
    expect(screen.getByText("Survival")).toBeInTheDocument();
    expect(screen.getByText(/2 workspaces/i)).toBeInTheDocument();
    expect(screen.getByText("Shop")).toBeInTheDocument();
    expect(screen.getByText("Lobby")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /new workspace/i })).toBeInTheDocument();
  });

  it("invokes onCreateWorkspace when CTA clicked", () => {
    const onCreate = vi.fn();
    render(<ServerCard server={server} workspaces={[]} onAction={() => {}} onCreateWorkspace={onCreate} />);
    fireEvent.click(screen.getByRole("button", { name: /new workspace/i }));
    expect(onCreate).toHaveBeenCalledWith("sk1");
  });
});
```

- [ ] **Step 2: Implement**

```tsx
// editor/src/components/network-detail/ServerCard.tsx
import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";

interface Server { id: string; label: string | null; online: boolean; lastSeen?: string | null; }
interface Workspace { id: string; name: string; }

interface Props {
  server: Server;
  workspaces: Workspace[];
  onAction: (action: "show-key" | "rotate" | "history" | "allowlist" | "delete", serverId: string) => void;
  onCreateWorkspace: (serverId: string) => void;
}

export function ServerCard({ server, workspaces, onAction, onCreateWorkspace }: Props) {
  const { t } = useTranslation();
  return (
    <div className="card flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{
              background: server.online ? "var(--sage)" : "var(--ink-faint)",
              boxShadow: server.online ? "0 0 6px var(--sage)" : "none",
            }}
          />
          <span className="truncate text-[14px] font-semibold text-[var(--ink)]">
            {server.label ?? server.id.slice(0, 12)}
          </span>
        </div>
        {/* Kebab menu — full implementation in Task 3.2 */}
        <button
          type="button"
          className="btn btn-icon btn-sm btn-ghost"
          onClick={() => onAction("show-key", server.id)}
          aria-label="actions"
        >
          ⋮
        </button>
      </div>

      <p className="text-[11.5px] text-[var(--ink-faint)]">
        {t("serverCard.workspaceCount", { count: workspaces.length })}
        {!server.online && server.lastSeen && (
          <>
            {" · "}
            {t("serverCard.lastConnected", { ago: server.lastSeen })}
          </>
        )}
      </p>

      <div className="flex flex-col gap-1 border-t border-[var(--line-soft)] pt-2.5">
        {workspaces.map((w) => (
          <Link
            key={w.id}
            to="/workspace/$workspaceId"
            params={{ workspaceId: w.id }}
            className="group flex items-center justify-between gap-2 rounded-[8px] px-2 py-1.5 transition-colors hover:bg-[var(--hover)]"
          >
            <span className="truncate text-[12.5px] text-[var(--ink-2)] group-hover:text-[var(--ink)]">
              📋 {w.name}
            </span>
            <ArrowRight className="size-[13px] text-[var(--ink-faint)]" />
          </Link>
        ))}
        <button
          type="button"
          onClick={() => onCreateWorkspace(server.id)}
          className="flex items-center gap-1.5 rounded-[8px] px-2 py-1.5 text-left text-[12px] text-[var(--ink-mut)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"
        >
          + {t("serverCard.newWorkspace")}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add i18n keys**

In `editor/src/locales/en.ts`, add:
```ts
serverCard: {
  workspaceCount_one: "{{count}} workspace",
  workspaceCount_other: "{{count}} workspaces",
  lastConnected: "last connected {{ago}}",
  newWorkspace: "New workspace",
},
```

In `editor/src/locales/fr.ts`:
```ts
serverCard: {
  workspaceCount_one: "{{count}} workspace",
  workspaceCount_other: "{{count}} workspaces",
  lastConnected: "dernière connexion {{ago}}",
  newWorkspace: "Nouveau workspace",
},
```

- [ ] **Step 4: Run + commit**

Run: `cd editor && npx vitest run src/components/network-detail/ServerCard.test.tsx`
Expected: PASS.

```bash
git add editor/src/components/network-detail/ServerCard.tsx editor/src/components/network-detail/ServerCard.test.tsx editor/src/locales/en.ts editor/src/locales/fr.ts
git commit -m "feat(network-detail): ServerCard component (header + workspaces + CTA)"
```

### Task 3.2: `ServerKebabMenu` component

**Files:**
- Create: `editor/src/components/network-detail/ServerKebabMenu.tsx`
- Create: `editor/src/components/network-detail/ServerKebabMenu.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// editor/src/components/network-detail/ServerKebabMenu.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ServerKebabMenu } from "./ServerKebabMenu";

describe("ServerKebabMenu", () => {
  it("renders all menu items on open and dispatches on click", () => {
    const onAction = vi.fn();
    render(<ServerKebabMenu serverId="sk1" onAction={onAction} />);
    fireEvent.click(screen.getByRole("button", { name: /actions/i }));
    expect(screen.getByRole("menuitem", { name: /show.*key/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /rotate/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /connection history/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /allowlist/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /delete/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("menuitem", { name: /rotate/i }));
    expect(onAction).toHaveBeenCalledWith("rotate", "sk1");
  });
});
```

- [ ] **Step 2: Implement**

```tsx
// editor/src/components/network-detail/ServerKebabMenu.tsx
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

type Action = "show-key" | "rotate" | "history" | "allowlist" | "delete";

interface Props {
  serverId: string;
  onAction: (action: Action, serverId: string) => void;
}

export function ServerKebabMenu({ serverId, onAction }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const item = (action: Action, label: string, danger = false) => (
    <button
      key={action}
      type="button"
      role="menuitem"
      className={`px-3 py-1.5 text-left text-[12px] hover:bg-[var(--hover)] ${danger ? "text-[var(--brick)]" : ""}`}
      onClick={() => {
        onAction(action, serverId);
        setOpen(false);
      }}
    >
      {label}
    </button>
  );

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        className="btn btn-icon btn-sm btn-ghost"
        onClick={() => setOpen((o) => !o)}
        aria-label={t("serverKebab.actions")}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        ⋮
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-10 mt-1 flex min-w-[200px] flex-col rounded-md border border-[var(--line)] bg-[var(--bg)] py-1 shadow-md">
          {item("show-key", t("serverKebab.showKey"))}
          {item("rotate", t("serverKebab.rotate"))}
          <div className="my-1 border-t border-[var(--line-soft)]" />
          {item("history", t("serverKebab.history"))}
          {item("allowlist", t("serverKebab.allowlist"))}
          <div className="my-1 border-t border-[var(--line-soft)]" />
          {item("delete", t("serverKebab.delete"), true)}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: i18n keys**

en:
```ts
serverKebab: {
  actions: "Server actions",
  showKey: "Show server key…",
  rotate: "Rotate key…",
  history: "Connection history",
  allowlist: "IP allowlist",
  delete: "Delete server…",
},
```

fr:
```ts
serverKebab: {
  actions: "Actions du serveur",
  showKey: "Voir la clé du serveur…",
  rotate: "Renouveler la clé…",
  history: "Historique de connexion",
  allowlist: "Allowlist d'IP",
  delete: "Supprimer le serveur…",
},
```

- [ ] **Step 4: Wire into `ServerCard`**

In `ServerCard.tsx`, replace the placeholder kebab button with `<ServerKebabMenu serverId={server.id} onAction={onAction} />`.

- [ ] **Step 5: Run + commit**

Run: `cd editor && npx vitest run src/components/network-detail/`
Expected: pass.

```bash
git add editor/src/components/network-detail/ServerKebabMenu.tsx editor/src/components/network-detail/ServerKebabMenu.test.tsx editor/src/components/network-detail/ServerCard.tsx editor/src/locales/en.ts editor/src/locales/fr.ts
git commit -m "feat(network-detail): ServerKebabMenu with 5 actions wired to ServerCard"
```

### Task 3.3: `NewServerModal` + `NewWorkspaceModal`

**Files:**
- Create: `editor/src/components/network-detail/NewServerModal.tsx`
- Create: `editor/src/components/network-detail/NewWorkspaceModal.tsx`
- Create: tests for both

- [ ] **Step 1: NewServerModal**

```tsx
// editor/src/components/network-detail/NewServerModal.tsx
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface Props {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  onCreate: (label: string) => Promise<void> | void;
}

export function NewServerModal({ open, onOpenChange, onCreate }: Props) {
  const { t } = useTranslation();
  const [label, setLabel] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    const trimmed = label.trim();
    if (!trimmed) return;
    setSubmitting(true);
    try {
      await onCreate(trimmed);
      setLabel("");
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("newServerModal.title")}</DialogTitle>
        </DialogHeader>
        <label className="flex flex-col gap-1 text-[12px]">
          <span className="text-[var(--ink-mut)]">{t("newServerModal.labelField")}</span>
          <input
            className="input"
            placeholder={t("newServerModal.labelPlaceholder")}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            autoFocus
          />
        </label>
        <div className="mt-3 flex justify-end gap-2">
          <button className="btn btn-sm btn-ghost" onClick={() => onOpenChange(false)}>
            {t("newServerModal.cancel")}
          </button>
          <button
            className="btn btn-sm btn-primary"
            onClick={submit}
            disabled={submitting || label.trim().length === 0}
          >
            {submitting ? t("newServerModal.creating") : t("newServerModal.create")}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: NewWorkspaceModal**

```tsx
// editor/src/components/network-detail/NewWorkspaceModal.tsx
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface Props {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  serverLabel: string;
  onCreate: (input: { name: string; description?: string }) => Promise<void> | void;
}

export function NewWorkspaceModal({ open, onOpenChange, serverLabel, onCreate }: Props) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSubmitting(true);
    try {
      await onCreate({
        name: trimmed,
        description: description.trim() || undefined,
      });
      setName("");
      setDescription("");
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {t("newWorkspaceModal.title", { server: serverLabel })}
          </DialogTitle>
        </DialogHeader>
        <label className="mt-2 flex flex-col gap-1 text-[12px]">
          <span className="text-[var(--ink-mut)]">{t("newWorkspaceModal.nameField")}</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        <label className="mt-2 flex flex-col gap-1 text-[12px]">
          <span className="text-[var(--ink-mut)]">{t("newWorkspaceModal.descriptionField")}</span>
          <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <div className="mt-3 flex justify-end gap-2">
          <button className="btn btn-sm btn-ghost" onClick={() => onOpenChange(false)}>
            {t("newWorkspaceModal.cancel")}
          </button>
          <button className="btn btn-sm btn-primary" onClick={submit} disabled={submitting || name.trim().length === 0}>
            {submitting ? t("newWorkspaceModal.creating") : t("newWorkspaceModal.create")}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: i18n keys**

en:
```ts
newServerModal: {
  title: "Add a server",
  labelField: "Label",
  labelPlaceholder: "e.g. Survival",
  cancel: "Cancel",
  create: "Create server",
  creating: "Creating…",
},
newWorkspaceModal: {
  title: "New workspace on \"{{server}}\"",
  nameField: "Name",
  descriptionField: "Description (optional)",
  cancel: "Cancel",
  create: "Create",
  creating: "Creating…",
},
```

fr:
```ts
newServerModal: {
  title: "Ajouter un serveur",
  labelField: "Label",
  labelPlaceholder: "ex. Survival",
  cancel: "Annuler",
  create: "Créer le serveur",
  creating: "Création…",
},
newWorkspaceModal: {
  title: "Nouveau workspace sur « {{server}} »",
  nameField: "Nom",
  descriptionField: "Description (optionnel)",
  cancel: "Annuler",
  create: "Créer",
  creating: "Création…",
},
```

- [ ] **Step 4: Tests for both modals**

```tsx
// editor/src/components/network-detail/NewServerModal.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NewServerModal } from "./NewServerModal";

describe("NewServerModal", () => {
  it("calls onCreate with trimmed label when submit clicked", async () => {
    const onCreate = vi.fn();
    render(<NewServerModal open onOpenChange={() => {}} onCreate={onCreate} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "  Survival  " } });
    fireEvent.click(screen.getByRole("button", { name: /create server/i }));
    expect(onCreate).toHaveBeenCalledWith("Survival");
  });

  it("disables submit when label is empty", () => {
    render(<NewServerModal open onOpenChange={() => {}} onCreate={() => {}} />);
    expect(screen.getByRole("button", { name: /create server/i })).toBeDisabled();
  });
});
```

```tsx
// editor/src/components/network-detail/NewWorkspaceModal.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NewWorkspaceModal } from "./NewWorkspaceModal";

describe("NewWorkspaceModal", () => {
  it("invokes onCreate with name + description", async () => {
    const onCreate = vi.fn();
    render(<NewWorkspaceModal open onOpenChange={() => {}} serverLabel="Survival" onCreate={onCreate} />);
    const inputs = screen.getAllByRole("textbox");
    fireEvent.change(inputs[0]!, { target: { value: "Shop" } });
    fireEvent.change(inputs[1]!, { target: { value: "Main shop" } });
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));
    expect(onCreate).toHaveBeenCalledWith({ name: "Shop", description: "Main shop" });
  });
});
```

- [ ] **Step 5: Run + commit**

Run: `cd editor && npx vitest run src/components/network-detail/`
Expected: pass.

```bash
git add editor/src/components/network-detail/NewServerModal.tsx editor/src/components/network-detail/NewServerModal.test.tsx editor/src/components/network-detail/NewWorkspaceModal.tsx editor/src/components/network-detail/NewWorkspaceModal.test.tsx editor/src/locales/en.ts editor/src/locales/fr.ts
git commit -m "feat(network-detail): NewServerModal + NewWorkspaceModal"
```

### Task 3.4: Redesign `/networks/:id` page using ServerCard

**Files:**
- Modify: `editor/src/routes/networks.$networkId.tsx`
- Modify: `editor/src/routes/networks.$networkId.test.tsx`
- Modify: `editor/src/lib/api/networks.ts` (createPack now passes serverKeyId)

- [ ] **Step 1: Update `createPack` API client to pass serverKeyId**

In `editor/src/lib/api/networks.ts`:

```ts
export async function createPack(
  networkId: string,
  serverKeyId: string,   // NEW
  name: string,
  description?: string,
): Promise<PackSummary> {
  const res = await fetch(`${API_URL}/api/v1/networks/${networkId}/packs`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, serverKeyId, ...(description !== undefined && { description }) }),
  });
  if (!res.ok) throw new Error(`createPack failed: ${res.status}`);
  return ((await res.json()) as { pack: PackSummary }).pack;
}
```

- [ ] **Step 2: Rewrite the route component**

Open `editor/src/routes/networks.$networkId.tsx` and replace its body with a Server-card-driven layout. The Packs section disappears (packs nest under their Server); the Server Keys section becomes the primary list.

Key parts of the new component:

```tsx
export function NetworkDetailPage() {
  const { t } = useTranslation();
  const { networkId } = useParams({ strict: false }) as { networkId: string };
  const [detail, setDetail] = useState<NetworkDetail | null>(null);
  const [newServerOpen, setNewServerOpen] = useState(false);
  const [newWsForServer, setNewWsForServer] = useState<string | null>(null);
  const [historyServer, setHistoryServer] = useState<string | null>(null);
  const [allowlistServer, setAllowlistServer] = useState<string | null>(null);
  const [deleteServer, setDeleteServer] = useState<{ id: string; label: string; workspaceCount: number } | null>(null);
  const [revealedKey, setRevealedKey] = useState<{ keyId: string; key: string } | null>(null);

  useEffect(() => {
    if (!networkId) return;
    getNetwork(networkId).then(setDetail).catch(console.error);
  }, [networkId]);

  if (!detail) return /* loading */ null;

  // Group packs by server (1:N).
  const packsByServer = new Map<string, PackSummary[]>();
  for (const p of detail.packs) {
    const list = packsByServer.get(p.serverKeyId) ?? [];
    list.push(p);
    packsByServer.set(p.serverKeyId, list);
  }

  const handleAction = async (action: string, serverId: string) => {
    if (action === "show-key") {
      // V1: rotation = the only way to surface a plaintext key. "Show key"
      // opens the same modal as Rotate (generates a fresh one).
      const result = await rotateServerKey(networkId, serverId);
      setRevealedKey({ keyId: serverId, key: result.key });
    } else if (action === "rotate") {
      if (!window.confirm(t("networkDetail.confirmRotateKey"))) return;
      const result = await rotateServerKey(networkId, serverId);
      setRevealedKey({ keyId: serverId, key: result.key });
    } else if (action === "history") {
      setHistoryServer(serverId);
    } else if (action === "allowlist") {
      setAllowlistServer(serverId);
    } else if (action === "delete") {
      const sk = detail.serverKeys.find((k) => k.id === serverId);
      if (!sk) return;
      const count = (packsByServer.get(serverId) ?? []).length;
      setDeleteServer({ id: serverId, label: sk.label ?? sk.id.slice(0, 12), workspaceCount: count });
    }
  };

  const handleCreateServer = async (label: string) => {
    const created = await createServerKey(networkId, label);
    setRevealedKey({ keyId: created.id, key: created.key });
    // Optimistically add to local detail
    setDetail({
      ...detail,
      serverKeys: [...detail.serverKeys, { id: created.id, label: created.label }],
    });
  };

  const handleCreateWorkspace = async (input: { name: string; description?: string }) => {
    if (!newWsForServer) return;
    const created = await createPack(networkId, newWsForServer, input.name, input.description);
    setDetail({ ...detail, packs: [...detail.packs, created] });
  };

  const handleDeleteConfirmed = async () => {
    if (!deleteServer) return;
    await deleteServerKey(networkId, deleteServer.id);
    setDetail({
      ...detail,
      serverKeys: detail.serverKeys.filter((k) => k.id !== deleteServer.id),
      packs: detail.packs.filter((p) => p.serverKeyId !== deleteServer.id),
    });
    setDeleteServer(null);
  };

  return (
    <div className="grain relative min-h-screen bg-[var(--bg)]">
      <div className="mx-auto flex max-w-4xl flex-col gap-8 px-8 py-12">
        <header className="flex items-baseline justify-between">
          <h1 className="display text-[36px] tracking-tight text-[var(--ink)]" style={{ fontFamily: "var(--font-display)" }}>
            {detail.network.name}
          </h1>
          <Link
            to="/networks/$networkId/settings"
            params={{ networkId }}
            className="flex items-center gap-1.5 text-[13px] text-[var(--ink-mut)] hover:text-[var(--terra)]"
          >
            {t("networkDetail.settings")} <ArrowRight className="size-[14px]" />
          </Link>
        </header>

        <section className="flex flex-col gap-3">
          {detail.serverKeys.length === 0 ? (
            <div className="card flex flex-col gap-3 p-6">
              <p className="text-[13.5px] text-[var(--ink-2)]">{t("networkDetail.noServers")}</p>
              <button onClick={() => setNewServerOpen(true)} className="btn btn-sm btn-primary self-start">
                {t("networkDetail.addServer")}
              </button>
            </div>
          ) : (
            <>
              {detail.serverKeys.map((sk) => (
                <ServerCard
                  key={sk.id}
                  server={{ id: sk.id, label: sk.label, online: false /* fed from listPackBindings/serverStatus */ }}
                  workspaces={(packsByServer.get(sk.id) ?? []).map((p) => ({ id: p.id, name: p.name }))}
                  onAction={handleAction}
                  onCreateWorkspace={(serverId) => setNewWsForServer(serverId)}
                />
              ))}
              <button onClick={() => setNewServerOpen(true)} className="btn btn-sm btn-ghost self-start">
                + {t("networkDetail.addServer")}
              </button>
            </>
          )}
        </section>

        <Section title={t("networkDetail.members")}>
          <p className="text-[12px] text-[var(--ink-faint)]">{t("networkDetail.membersComingSoon")}</p>
        </Section>
      </div>

      <NewServerModal open={newServerOpen} onOpenChange={setNewServerOpen} onCreate={handleCreateServer} />
      {newWsForServer && (
        <NewWorkspaceModal
          open
          onOpenChange={(o) => !o && setNewWsForServer(null)}
          serverLabel={detail.serverKeys.find((k) => k.id === newWsForServer)?.label ?? ""}
          onCreate={handleCreateWorkspace}
        />
      )}
      {historyServer && (
        <ConnectionHistoryModal
          open
          onOpenChange={(o) => !o && setHistoryServer(null)}
          networkId={networkId}
          serverId={historyServer}
        />
      )}
      {allowlistServer && (
        <IpAllowlistModal
          open
          onOpenChange={(o) => !o && setAllowlistServer(null)}
          networkId={networkId}
          serverId={allowlistServer}
        />
      )}
      {deleteServer && (
        <DeleteServerDialog
          server={deleteServer}
          onCancel={() => setDeleteServer(null)}
          onConfirm={handleDeleteConfirmed}
        />
      )}
      {revealedKey && (
        <RotatedKeyModal plainKey={revealedKey.key} onClose={() => setRevealedKey(null)} />
      )}
    </div>
  );
}
```

The `ConnectionHistoryModal`, `IpAllowlistModal`, and `DeleteServerDialog` are implemented in Phase 4 — for now, stub them as `() => null` so the imports compile.

- [ ] **Step 3: Add fallback i18n keys used by the redesign**

In `editor/src/locales/en.ts`, ensure:
```ts
networkDetail: {
  // ... existing keys
  noServers: "No server. Run /artisan setup in your MC console.",
  addServer: "Add a server",
  // ... keep existing settings/members/membersComingSoon
},
```

In `editor/src/locales/fr.ts`:
```ts
networkDetail: {
  noServers: "Aucun serveur. Tape /artisan setup dans ta console MC.",
  addServer: "Ajouter un serveur",
},
```

- [ ] **Step 4: Stub the missing P4 modal components**

Create minimal placeholders so the route compiles:

```tsx
// editor/src/components/network-detail/ConnectionHistoryModal.tsx (P4 will fill)
export function ConnectionHistoryModal(_: { open: boolean; onOpenChange: (next: boolean) => void; networkId: string; serverId: string }) {
  return null;
}

// editor/src/components/network-detail/IpAllowlistModal.tsx
export function IpAllowlistModal(_: { open: boolean; onOpenChange: (next: boolean) => void; networkId: string; serverId: string }) {
  return null;
}

// editor/src/components/network-detail/DeleteServerDialog.tsx
interface DeleteServerDialogProps {
  server: { id: string; label: string; workspaceCount: number };
  onCancel: () => void;
  onConfirm: () => void;
}
export function DeleteServerDialog(_: DeleteServerDialogProps) {
  return null;
}
```

- [ ] **Step 5: Update the existing networks.$networkId.test.tsx**

The existing tests likely assert on the old card structure (with rotate button at top level, bindings list, etc.). Rewrite for the new structure:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NetworkDetailPage } from "./networks.$networkId";
import * as networksApi from "@/lib/api/networks";

vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return { ...actual, useParams: () => ({ networkId: "n1" }), Link: ({ children, ...p }: any) => <a {...p}>{children}</a> };
});

describe("NetworkDetailPage", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("renders network name + one server card per server, with workspaces nested", async () => {
    vi.spyOn(networksApi, "getNetwork").mockResolvedValue({
      network: { id: "n1", name: "Alpha", tier: "free" },
      packs: [
        { id: "p1", name: "Shop", hash: "h", serverKeyId: "sk1" },
        { id: "p2", name: "Lobby", hash: "h", serverKeyId: "sk1" },
        { id: "p3", name: "Welcome", hash: "h", serverKeyId: "sk2" },
      ],
      serverKeys: [
        { id: "sk1", label: "Survival" },
        { id: "sk2", label: "Hub" },
      ],
    });
    render(<NetworkDetailPage />);
    await screen.findByText("Alpha");
    expect(screen.getByText("Survival")).toBeInTheDocument();
    expect(screen.getByText("Hub")).toBeInTheDocument();
    expect(screen.getByText("Shop")).toBeInTheDocument();
    expect(screen.getByText("Lobby")).toBeInTheDocument();
    expect(screen.getByText("Welcome")).toBeInTheDocument();
  });

  it("shows empty state when network has no servers", async () => {
    vi.spyOn(networksApi, "getNetwork").mockResolvedValue({
      network: { id: "n1", name: "Empty", tier: "free" },
      packs: [],
      serverKeys: [],
    });
    render(<NetworkDetailPage />);
    await screen.findByText(/Aucun serveur|No server/i);
  });
});
```

Delete any old tests that asserted on the bindings list, the inline HelloAuditPanel toggle, the inline AllowlistPanel — those flows move to P4 modals.

- [ ] **Step 6: Run editor tests**

Run: `cd editor && npx vitest run src/routes/networks.\$networkId.test.tsx src/components/network-detail/`
Expected: all pass.

- [ ] **Step 7: Run full editor suite + commit**

Run: `cd editor && npx vitest run`
Expected: total green (some workspace tests may need updates if they mock `listPackBindings`, which now returns empty since the endpoint was removed — handle in those test files individually).

```bash
git add editor/src/routes/networks.\$networkId.tsx editor/src/routes/networks.\$networkId.test.tsx editor/src/lib/api/networks.ts editor/src/components/network-detail/ConnectionHistoryModal.tsx editor/src/components/network-detail/IpAllowlistModal.tsx editor/src/components/network-detail/DeleteServerDialog.tsx editor/src/locales/en.ts editor/src/locales/fr.ts
git commit -m "feat(network-detail): redesign /networks/:id with ServerCard list + stubbed modals"
```

---

## Phase 4 — Modal extractions

### Task 4.1: `ConnectionHistoryModal`

**Files:**
- Replace stub: `editor/src/components/network-detail/ConnectionHistoryModal.tsx`
- Create: `editor/src/components/network-detail/ConnectionHistoryModal.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// editor/src/components/network-detail/ConnectionHistoryModal.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ConnectionHistoryModal } from "./ConnectionHistoryModal";
import * as networksApi from "@/lib/api/networks";

describe("ConnectionHistoryModal", () => {
  it("fetches helloes when opened and renders them", async () => {
    vi.spyOn(networksApi, "listServerKeyHelloes").mockResolvedValue([
      { id: "h1", ip: "1.2.3.4", mcVersion: "1.21.4", helloAt: "2026-06-01T08:00:00Z", rejectedReason: null },
    ]);
    render(<ConnectionHistoryModal open onOpenChange={() => {}} networkId="n1" serverId="sk1" />);
    await waitFor(() => expect(networksApi.listServerKeyHelloes).toHaveBeenCalledWith("n1", "sk1"));
    await screen.findByText("1.2.3.4");
  });
});
```

- [ ] **Step 2: Implement (port HelloAuditPanel logic into a modal shell)**

```tsx
// editor/src/components/network-detail/ConnectionHistoryModal.tsx
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { listServerKeyHelloes, type ServerKeyHello } from "@/lib/api/networks";

interface Props {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  networkId: string;
  serverId: string;
}

export function ConnectionHistoryModal({ open, onOpenChange, networkId, serverId }: Props) {
  const { t, i18n } = useTranslation();
  const [helloes, setHelloes] = useState<ServerKeyHello[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!open) return;
    setHelloes(null);
    setError(false);
    listServerKeyHelloes(networkId, serverId)
      .then(setHelloes)
      .catch(() => setError(true));
  }, [open, networkId, serverId]);

  const fmt = (iso: string) => {
    try { return new Date(iso).toLocaleString(i18n.language); } catch { return iso; }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("connectionHistoryModal.title")}</DialogTitle>
        </DialogHeader>
        <div className="mt-2">
          {error ? (
            <p className="text-[12px] text-[var(--ink-faint)]">{t("connectionHistoryModal.error")}</p>
          ) : helloes === null ? (
            <p className="text-[12px] text-[var(--ink-faint)]">{t("connectionHistoryModal.loading")}</p>
          ) : helloes.length === 0 ? (
            <p className="text-[12px] text-[var(--ink-faint)]">{t("connectionHistoryModal.empty")}</p>
          ) : (
            <ul className="flex max-h-[50vh] flex-col gap-1 overflow-auto">
              {helloes.map((h) => (
                <li
                  key={h.id}
                  className="flex items-center justify-between gap-2 rounded-[8px] px-2 py-1.5 text-[11.5px] text-[var(--ink-2)]"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="mono truncate text-[var(--ink-mut)]">{h.ip}</span>
                    {h.rejectedReason && (
                      <span className="badge badge-danger shrink-0 text-[9.5px]">
                        {t(`networkDetail.helloRejected.${h.rejectedReason}`, h.rejectedReason)}
                      </span>
                    )}
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {h.mcVersion && (
                      <span className="text-[10.5px] text-[var(--ink-faint)]">MC {h.mcVersion}</span>
                    )}
                    <span className="text-[var(--ink-mut)]">{fmt(h.helloAt)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: i18n keys**

en:
```ts
connectionHistoryModal: {
  title: "Connection history",
  loading: "Loading…",
  empty: "No connection logged yet.",
  error: "Failed to load the audit log.",
},
```

fr:
```ts
connectionHistoryModal: {
  title: "Historique de connexion",
  loading: "Chargement…",
  empty: "Aucune connexion enregistrée pour le moment.",
  error: "Impossible de charger l'historique.",
},
```

- [ ] **Step 4: Run + commit**

```bash
cd editor && npx vitest run src/components/network-detail/ConnectionHistoryModal.test.tsx
git add editor/src/components/network-detail/ConnectionHistoryModal.tsx editor/src/components/network-detail/ConnectionHistoryModal.test.tsx editor/src/locales/en.ts editor/src/locales/fr.ts
git commit -m "feat(network-detail): ConnectionHistoryModal extracted from HelloAuditPanel"
```

### Task 4.2: `IpAllowlistModal`

Same pattern as Task 4.1 but for the allowlist. Port the existing `AllowlistPanel` from `networks.$networkId.tsx` (pre-refactor) into a modal:
- State: `ips: string[] | null`, `draft: string`
- Effect: fetch `getServerKeyAllowlist(networkId, serverId)` on open
- Actions: Add IP / Remove IP / persist via `setServerKeyAllowlist`
- i18n keys under `ipAllowlistModal.*`

- [ ] **Step 1-4: write failing test, implement, i18n, run + commit (mirror Task 4.1)**

Test fixture:

```tsx
it("renders allowlist and lets user add/remove an IP", async () => {
  vi.spyOn(networksApi, "getServerKeyAllowlist").mockResolvedValue(["1.2.3.4"]);
  const setSpy = vi.spyOn(networksApi, "setServerKeyAllowlist").mockImplementation(async (_n, _k, list) => list);
  render(<IpAllowlistModal open onOpenChange={() => {}} networkId="n1" serverId="sk1" />);
  await screen.findByText("1.2.3.4");
  fireEvent.change(screen.getByPlaceholderText("203.0.113.42"), { target: { value: "5.6.7.8" } });
  fireEvent.click(screen.getByRole("button", { name: /add/i }));
  await waitFor(() => expect(setSpy).toHaveBeenCalledWith("n1", "sk1", ["1.2.3.4", "5.6.7.8"]));
});
```

Final commit:

```bash
git add editor/src/components/network-detail/IpAllowlistModal.tsx editor/src/components/network-detail/IpAllowlistModal.test.tsx editor/src/locales/en.ts editor/src/locales/fr.ts
git commit -m "feat(network-detail): IpAllowlistModal extracted from AllowlistPanel"
```

### Task 4.3: `DeleteServerDialog` with confirm-by-typing-label

**Files:**
- Replace stub: `editor/src/components/network-detail/DeleteServerDialog.tsx`
- Create: tests

- [ ] **Step 1: Write failing test**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DeleteServerDialog } from "./DeleteServerDialog";

describe("DeleteServerDialog", () => {
  it("disables confirm button until the user types the exact label", () => {
    const onConfirm = vi.fn();
    render(<DeleteServerDialog server={{ id: "sk1", label: "Survival", workspaceCount: 2 }} onCancel={() => {}} onConfirm={onConfirm} />);
    const btn = screen.getByRole("button", { name: /delete server/i });
    expect(btn).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Survival" } });
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    expect(onConfirm).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Implement**

```tsx
// editor/src/components/network-detail/DeleteServerDialog.tsx
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface Props {
  server: { id: string; label: string; workspaceCount: number };
  onCancel: () => void;
  onConfirm: () => void;
}

export function DeleteServerDialog({ server, onCancel, onConfirm }: Props) {
  const { t } = useTranslation();
  const [typed, setTyped] = useState("");
  const canConfirm = typed === server.label;
  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("deleteServerDialog.title", { label: server.label })}</DialogTitle>
        </DialogHeader>
        <p className="mt-2 text-[13px] text-[var(--ink-2)]">{t("deleteServerDialog.warning")}</p>
        {server.workspaceCount > 0 && (
          <p className="mt-2 text-[13px] text-[var(--brick)]">
            {t("deleteServerDialog.workspacesAlsoDeleted", { count: server.workspaceCount })}
          </p>
        )}
        <label className="mt-3 flex flex-col gap-1 text-[12px]">
          <span className="text-[var(--ink-mut)]">{t("deleteServerDialog.confirmLabel", { label: server.label })}</span>
          <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus />
        </label>
        <div className="mt-3 flex justify-end gap-2">
          <button className="btn btn-sm btn-ghost" onClick={onCancel}>{t("deleteServerDialog.cancel")}</button>
          <button className="btn btn-sm btn-danger" onClick={onConfirm} disabled={!canConfirm}>
            {t("deleteServerDialog.confirm")}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: i18n keys**

en:
```ts
deleteServerDialog: {
  title: "Delete server \"{{label}}\" ?",
  warning: "This action is irreversible. The plugin will lose access on its next hello.",
  workspacesAlsoDeleted_one: "{{count}} workspace will also be deleted.",
  workspacesAlsoDeleted_other: "{{count}} workspaces will also be deleted.",
  confirmLabel: "Type \"{{label}}\" to confirm:",
  cancel: "Cancel",
  confirm: "Delete server",
},
```

fr:
```ts
deleteServerDialog: {
  title: "Supprimer le serveur « {{label}} » ?",
  warning: "Cette action est irréversible. Le plugin perdra l'accès au prochain hello.",
  workspacesAlsoDeleted_one: "{{count}} workspace sera aussi supprimé.",
  workspacesAlsoDeleted_other: "{{count}} workspaces seront aussi supprimés.",
  confirmLabel: "Tape « {{label}} » pour confirmer :",
  cancel: "Annuler",
  confirm: "Supprimer le serveur",
},
```

- [ ] **Step 4: Run + commit**

```bash
cd editor && npx vitest run src/components/network-detail/DeleteServerDialog.test.tsx
git add editor/src/components/network-detail/DeleteServerDialog.tsx editor/src/components/network-detail/DeleteServerDialog.test.tsx editor/src/locales/en.ts editor/src/locales/fr.ts
git commit -m "feat(network-detail): DeleteServerDialog with confirm-by-typing-label"
```

---

## Phase 5 — History tab + commit content endpoint

### Task 5.1: Backend — `GET /commits/:commitId/content` endpoint

**Files:**
- Modify: `backend/src/routes/userBranches.ts`
- Modify: `backend/src/routes/userBranches.test.ts`

- [ ] **Step 1: Add the endpoint**

Insert in `backend/src/routes/userBranches.ts` next to the existing `GET /branches/:branch/head`:

```ts
// GET /:id/packs/:packId/commits/:commitId/content — used by the History
// tab Restore action to fetch any past commit's editor + files JSON.
userBranchesRouter.get("/:id/packs/:packId/commits/:commitId/content", async (c) => {
  const networkId = c.req.param("id");
  const packId = c.req.param("packId");
  const commitId = c.req.param("commitId");
  const access = await checkAccess(c, networkId, packId);
  if (!access.ok) return c.json({ error: "denied" }, access.status);

  const commit = await getCommit(commitId);
  if (!commit || commit.packId !== packId) {
    return c.json({ error: "commit_not_found" }, 404);
  }

  const editor = commit.editorJson ? JSON.parse(commit.editorJson) : {};
  const files = commit.filesJson ? JSON.parse(commit.filesJson) : {};
  return c.json({
    commit: { id: commit.id, contentHash: commit.contentHash, message: commit.message, createdAt: commit.createdAt },
    editor,
    files,
  });
});
```

- [ ] **Step 2: Tests**

Add to `userBranches.test.ts`:

```ts
test("GET /commits/:commitId/content returns content for a known commit", async () => {
  const { sessionId, networkId, packId } = await seedUserWithPack();
  const app = makeApp();
  // Get the initial commit's id
  const branchRes = await app.request(`/api/v1/networks/${networkId}/packs/${packId}/branches`, { headers: { Cookie: `artisan_user_session=${sessionId}` } });
  const { branches } = await branchRes.json();
  const commitId = branches[0].headCommitId;

  const res = await app.request(`/api/v1/networks/${networkId}/packs/${packId}/commits/${commitId}/content`, {
    headers: { Cookie: `artisan_user_session=${sessionId}` },
  });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.commit?.id).toBe(commitId);
  expect(typeof body.editor).toBe("object");
  expect(typeof body.files).toBe("object");
});

test("GET /commits/:commitId/content returns 404 when commit doesn't belong to pack", async () => {
  const { sessionId, networkId, packId } = await seedUserWithPack();
  const app = makeApp();
  const res = await app.request(`/api/v1/networks/${networkId}/packs/${packId}/commits/does-not-exist/content`, {
    headers: { Cookie: `artisan_user_session=${sessionId}` },
  });
  expect(res.status).toBe(404);
});
```

- [ ] **Step 3: Run + commit**

```bash
cd backend && bun run test src/routes/userBranches.test.ts
git add backend/src/routes/userBranches.ts backend/src/routes/userBranches.test.ts
git commit -m "feat(backend): GET /commits/:commitId/content for History tab Restore"
```

### Task 5.2: Editor — `getCommitContent` API client

**Files:**
- Modify: `editor/src/lib/api/branches.ts`

- [ ] **Step 1: Add the client function**

```ts
export async function getCommitContent(
  networkId: string,
  packId: string,
  commitId: string,
): Promise<{ commit: { id: string; contentHash: string; message: string; createdAt: string }; editor: Record<string, unknown>; files: Record<string, string> } | null> {
  const res = await fetch(
    `${API_URL}/api/v1/networks/${networkId}/packs/${packId}/commits/${commitId}/content`,
    { credentials: "include" },
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`getCommitContent failed: ${res.status}`);
  return res.json();
}
```

- [ ] **Step 2: Commit (no test — covered indirectly by History tab tests)**

```bash
git add editor/src/lib/api/branches.ts
git commit -m "feat(editor): getCommitContent API client"
```

### Task 5.3: `HistoryTab` component

**Files:**
- Create: `editor/src/features/workspace/HistoryTab.tsx`
- Create: `editor/src/features/workspace/HistoryTab.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { HistoryTab } from "./HistoryTab";
import * as branchesApi from "@/lib/api/branches";
import * as accountStoreModule from "@/state/accountStore";

vi.mock("@/state/accountStore", () => ({
  useAccountStore: Object.assign(
    vi.fn((sel: any) => sel({ replacePack: vi.fn() })),
    { getState: () => ({ replacePack: vi.fn() }) },
  ),
}));

describe("HistoryTab", () => {
  it("lists commits and a Restore button per commit (except current)", async () => {
    vi.spyOn(branchesApi, "listCommits").mockResolvedValue([
      { id: "c2", packId: "p1", parentId: "c1", contentHash: "h2", authorUserId: null, message: "Deploy", createdAt: "2026-06-01" },
      { id: "c1", packId: "p1", parentId: null, contentHash: "h1", authorUserId: null, message: "Initial commit", createdAt: "2026-05-30" },
    ]);
    render(<HistoryTab pack={{ id: "p1", name: "P" } as any} networkId="n1" />);
    await screen.findByText(/Initial commit/i);
    const restoreButtons = screen.getAllByRole("button", { name: /restore/i });
    expect(restoreButtons.length).toBe(2);
  });
});
```

- [ ] **Step 2: Implement**

```tsx
// editor/src/features/workspace/HistoryTab.tsx
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { Pack } from "@/domain/types";
import { listCommits, getCommitContent, type Commit } from "@/lib/api/branches";
import { useAccountStore } from "@/state/accountStore";

interface Props { pack: Pack; networkId: string; }

export function HistoryTab({ pack, networkId }: Props) {
  const { t, i18n } = useTranslation();
  const [commits, setCommits] = useState<Commit[] | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);
  const replacePack = useAccountStore((s) => s.replacePack);

  useEffect(() => {
    listCommits(networkId, pack.id, "main").then(setCommits).catch(() => setCommits([]));
  }, [networkId, pack.id]);

  const fmt = (iso: string) => {
    try { return new Date(iso).toLocaleString(i18n.language); } catch { return iso; }
  };

  const handleRestore = async (commitId: string) => {
    setRestoring(commitId);
    try {
      const head = await getCommitContent(networkId, pack.id, commitId);
      if (!head) {
        toast.error(t("historyTab.restoreFailed"));
        return;
      }
      const restored = { ...(head.editor as Partial<Pack>), id: pack.id, name: pack.name } as Pack;
      replacePack(restored);
      toast.success(t("historyTab.restored"));
    } catch {
      toast.error(t("historyTab.restoreFailed"));
    } finally {
      setRestoring(null);
    }
  };

  if (commits === null) {
    return <p className="p-4 text-[12px] text-[var(--ink-faint)]">{t("historyTab.loading")}</p>;
  }
  if (commits.length === 0) {
    return <p className="p-4 text-[12px] text-[var(--ink-faint)]">{t("historyTab.empty")}</p>;
  }

  const headId = commits[0]?.id;

  return (
    <div className="flex flex-col gap-2 p-4">
      <h2 className="display text-[18px] text-[var(--ink)]">{t("historyTab.title")}</h2>
      <ul className="flex flex-col gap-1.5">
        {commits.map((c, i) => {
          const isCurrent = i === commits.length - 1 && c.parentId === null;
          return (
            <li key={c.id} className="rounded-[8px] border border-[var(--line-soft)] p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 flex-col">
                  <span className="text-[12.5px] text-[var(--ink)]">
                    {c.id === headId && "▣ HEAD · "}{c.message}
                  </span>
                  <span className="text-[11px] text-[var(--ink-faint)]">{fmt(c.createdAt)}</span>
                </div>
                {!isCurrent && (
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    onClick={() => handleRestore(c.id)}
                    disabled={restoring === c.id}
                  >
                    {restoring === c.id ? t("historyTab.restoring") : t("historyTab.restore")}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
```

- [ ] **Step 3: i18n keys**

en:
```ts
historyTab: {
  title: "History",
  loading: "Loading…",
  empty: "No commits yet.",
  restore: "Restore",
  restoring: "Restoring…",
  restored: "Restored ✓",
  restoreFailed: "Restore failed",
},
```

fr:
```ts
historyTab: {
  title: "Historique",
  loading: "Chargement…",
  empty: "Aucun commit pour le moment.",
  restore: "Restaurer",
  restoring: "Restauration…",
  restored: "Restauré ✓",
  restoreFailed: "Échec de la restauration",
},
```

- [ ] **Step 4: Run + commit**

```bash
cd editor && npx vitest run src/features/workspace/HistoryTab.test.tsx
git add editor/src/features/workspace/HistoryTab.tsx editor/src/features/workspace/HistoryTab.test.tsx editor/src/locales/en.ts editor/src/locales/fr.ts
git commit -m "feat(workspace): HistoryTab — commit list with per-commit Restore"
```

### Task 5.4: Wire `HistoryTab` into the workspace route tabs

**Files:**
- Modify: `editor/src/routes/workspace.$workspaceId.tsx`

- [ ] **Step 1: Update the tabs strip**

Find the tabs configuration. Add `history` to the WorkspaceSearch type:

```ts
type WorkspaceSearch = { tab?: "overview" | "translations" | "data-sources" | "servers" | "history" };
```

Update `validateSearch` to accept `history`. Add the tab definition:

```tsx
{ id: "history", label: t("workspace.tabs.history") },
```

And render conditionally:

```tsx
{tab === "history" && pack && networkId && (
  <div className="min-h-0 flex-1 overflow-auto">
    <HistoryTab pack={pack} networkId={networkId} />
  </div>
)}
```

Add `t("workspace.tabs.history")` to locales.

- [ ] **Step 2: Run + commit**

```bash
cd editor && npx vitest run
git add editor/src/routes/workspace.\$workspaceId.tsx editor/src/locales/en.ts editor/src/locales/fr.ts
git commit -m "feat(workspace): add History tab to workspace tabs strip"
```

---

## Phase 6 — WorkspaceTopBarControls cleanup

### Task 6.1: Drop branch toolbar from `WorkspaceTopBarControls`

**Files:**
- Modify: `editor/src/components/WorkspaceTopBarControls.tsx`

- [ ] **Step 1: Remove branch toolbar rendering**

In `WorkspaceTopBarControls.tsx`, locate `showBranchBar` and the conditional `{showBranchBar && ...}` block. Delete the entire block including BranchSwitcher, DirtyBadge, Commit button, PromoteButton, MergeButton, HistoryPanel, CommitDialog.

Also delete the bootstrap useEffect that calls `listBranches` (no longer needed for the toolbar — HistoryTab fetches its own commits, branch dropdown is gone).

- [ ] **Step 2: Remove imports**

Remove from imports: `BranchSwitcher`, `DirtyBadge`, `PromoteButton`, `MergeButton`, `HistoryPanel`, `CommitDialog`, `listBranches`, `useBranchesStore`.

- [ ] **Step 3: Drop the `currentBranch`/`allBranches` props from the interface**

```ts
interface WorkspaceTopBarControlsProps {
  pack: Pack;
  packId: PackId;
  packName?: string;
  leftSlot?: React.ReactNode;
  onImport?: () => void;
  onExport?: () => void;
  onExportZip?: () => void | Promise<void>;
  onOpenPatterns?: () => void;
  onDelete?: () => void;
  networkId?: string | null;
  // currentBranch + allBranches removed
}
```

Update the caller `workspace.$workspaceId.tsx` to stop passing them.

- [ ] **Step 4: Update DeployButtons to drop currentBranch dependency**

The existing `DeployButtons` used `currentBranch` for `createCommit(..., currentBranch, "Deploy")`. Replace with the literal `"main"` (only branch in V1):

```ts
await createCommit(networkId, packId, "main", "Deploy");
```

Same for Revert's `getBranchHead(networkId, packId, "main")`.

- [ ] **Step 5: Run + commit**

```bash
cd editor && npx vitest run
git add editor/src/components/WorkspaceTopBarControls.tsx editor/src/routes/workspace.\$workspaceId.tsx
git commit -m "refactor(editor): drop branch toolbar from WorkspaceTopBarControls (History tab replaces)"
```

### Task 6.2: Drop `servers` tab from workspace tabs strip

**Files:**
- Modify: `editor/src/routes/workspace.$workspaceId.tsx`

- [ ] **Step 1: Remove the tab**

In `workspace.$workspaceId.tsx`, remove from `WorkspaceSearch` type and `validateSearch`:
- `"servers"` value

Remove from `WorkspaceTabs` array:
```tsx
// DELETE this entry:
...(networkId ? [{ id: "servers", label: t("workspace.tabs.servers") }] : []),
```

Remove the conditional render block:
```tsx
// DELETE:
{tab === "servers" && pack && networkId && (
  <div className="min-h-0 flex-1 overflow-auto">
    <ServersPanelContent packId={pId} networkId={networkId} />
  </div>
)}
```

Remove `ServersPanelContent` from imports.

- [ ] **Step 2: Run + commit**

```bash
cd editor && npx vitest run
git add editor/src/routes/workspace.\$workspaceId.tsx
git commit -m "refactor(workspace): drop 'servers' tab (workspace owns its server 1:1 now)"
```

### Task 6.3: Simplify `ServerStatusBadge` for 1-server case

**Files:**
- Modify: `editor/src/components/ServerStatusBadge.tsx`
- Modify: `editor/src/components/ServerStatusBadge.test.tsx`

The badge currently fetches `listPackBindings` (gone) and shows online/offline counts. Replace with a direct lookup of the workspace's owning server's online status.

- [ ] **Step 1: Update API client to expose the owner server status**

`listPackBindings` doesn't exist anymore. Instead, the workspace knows its own `serverKeyId` from `pack.serverKeyId`. We need an endpoint to query a single server's online status. Two options:
- (a) Add a `GET /networks/:id/server-keys/:keyId/status` endpoint returning `{ online }`.
- (b) Reuse `GET /networks/:id` and find the server in the response.

(b) is fine but heavy. Let me go with (a):

In `backend/src/routes/userNetworks.ts`:

```ts
userNetworksRouter.get("/:id/server-keys/:keyId/status", async (c) => {
  const userId = getUserId(c);
  if (!userId) return c.json({ error: "unauthorized" }, 401);
  const networkId = c.req.param("id");
  const keyId = c.req.param("keyId");
  try { await requireMember(userId, networkId); } catch { return c.json({ error: "forbidden" }, 403); }
  const sk = await db.select().from(serverKeys).where(and(eq(serverKeys.id, keyId), eq(serverKeys.networkId, networkId)));
  if (sk.length === 0) return c.json({ error: "not_found" }, 404);
  return c.json({ online: getInstanceCount(keyId) > 0 });
});
```

In `editor/src/lib/api/networks.ts`:

```ts
export async function getServerStatus(networkId: string, serverId: string): Promise<{ online: boolean }> {
  const res = await fetch(`${API_URL}/api/v1/networks/${networkId}/server-keys/${serverId}/status`, { credentials: "include" });
  if (!res.ok) throw new Error(`getServerStatus failed: ${res.status}`);
  return res.json();
}
```

- [ ] **Step 2: Rewrite ServerStatusBadge**

```tsx
// editor/src/components/ServerStatusBadge.tsx
import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { getServerStatus } from "@/lib/api/networks";

interface Props {
  networkId: string | null | undefined;
  serverKeyId: string;
  packId: string;
}

export function ServerStatusBadge({ networkId, serverKeyId, packId }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [online, setOnline] = useState<boolean | null>(null);

  useEffect(() => {
    if (!networkId) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const s = await getServerStatus(networkId, serverKeyId);
        if (!cancelled) setOnline(s.online);
      } catch { /* silent */ }
    };
    refresh();
    const id = setInterval(refresh, 15_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [networkId, serverKeyId]);

  if (online === null) return null;

  return (
    <button
      type="button"
      onClick={() => navigate({ to: "/networks/$networkId", params: { networkId: networkId! } })}
      title={t(online ? "serverStatusBadge.titleOnline" : "serverStatusBadge.titleOffline")}
      className="flex h-[34px] shrink-0 items-center gap-1.5 rounded-[10px] border border-[var(--line)] bg-[var(--raised)] px-3 font-mono text-[12px] text-[var(--ink-2)] hover:border-[var(--line-strong)] hover:text-[var(--ink)]"
    >
      <span
        aria-hidden
        className="h-1.5 w-1.5 rounded-full"
        style={{
          background: online ? "var(--sage)" : "var(--ink-faint)",
          boxShadow: online ? "0 0 6px var(--sage)" : "none",
        }}
      />
      {online ? t("serverStatusBadge.online") : t("serverStatusBadge.offline")}
    </button>
  );
}
```

i18n keys:
```ts
// en
serverStatusBadge: {
  online: "online",
  offline: "offline",
  titleOnline: "Server is online — click to open Network",
  titleOffline: "Server is offline — click to open Network",
},
// fr
serverStatusBadge: {
  online: "en ligne",
  offline: "hors-ligne",
  titleOnline: "Serveur en ligne — cliquer pour ouvrir le Network",
  titleOffline: "Serveur hors-ligne — cliquer pour ouvrir le Network",
},
```

- [ ] **Step 3: Update tests for new props/behavior**

Rewrite `ServerStatusBadge.test.tsx` to:
- Pass `serverKeyId` as a prop
- Mock `getServerStatus` instead of `listPackBindings`
- Assert `online`/`offline` text instead of counts

- [ ] **Step 4: Update caller in `WorkspaceTopBarControls.tsx`**

The badge is invoked with `pack.serverKeyId`:

```tsx
<ServerStatusBadge networkId={networkId} serverKeyId={pack.serverKeyId} packId={packId} />
```

- [ ] **Step 5: Run + commit**

```bash
cd editor && npx vitest run
cd backend && bun run test src/routes/userNetworks.test.ts
git add backend/src/routes/userNetworks.ts editor/src/lib/api/networks.ts editor/src/components/ServerStatusBadge.tsx editor/src/components/ServerStatusBadge.test.tsx editor/src/components/WorkspaceTopBarControls.tsx editor/src/locales/en.ts editor/src/locales/fr.ts
git commit -m "refactor(editor): ServerStatusBadge — single-server status via getServerStatus"
```

---

## Phase 7 — Setup wizard + i18n + dead code

### Task 7.1: Setup wizard step reorder

**Files:**
- Modify: `editor/src/features/setup/SetupWizard.tsx`
- Rename: `editor/src/features/setup/SetupWizardSteps/Step2Pack.tsx` → `Step3Workspace.tsx`
- Rename: `editor/src/features/setup/SetupWizardSteps/Step3ServerKey.tsx` → `Step2Server.tsx`

- [ ] **Step 1: Rename + adapt Step3ServerKey → Step2Server**

The current Step3ServerKey calls `networksApi.createServerKey(state.networkId)`, then `bindPackToServerKey(networkId, packId, sk.id)` — the bind call dies. Rename the file and remove the bind:

```tsx
// editor/src/features/setup/SetupWizardSteps/Step2Server.tsx
// (former Step3ServerKey, but bindPackToServerKey call removed)
async function handleGenerate() {
  if (!state.networkId) return;
  setGenerating(true);
  try {
    const sk = await networksApi.createServerKey(state.networkId);
    setState((s) => ({ ...s, serverKey: sk.key, serverKeyId: sk.id }));
    setDone(true);
  } finally {
    setGenerating(false);
  }
}
```

- [ ] **Step 2: Rename + adapt Step2Pack → Step3Workspace**

Update its `handleCreate` to pass `serverKeyId`:

```ts
const created = await networksApi.createPack(state.networkId!, state.serverKeyId!, name);
```

- [ ] **Step 3: Update SetupWizard.tsx**

Update imports + step rendering:

```tsx
import { Step1Network } from "./SetupWizardSteps/Step1Network";
import { Step2Server } from "./SetupWizardSteps/Step2Server";
import { Step3Workspace } from "./SetupWizardSteps/Step3Workspace";
import { Step4Install } from "./SetupWizardSteps/Step4Install";

// step labels swap order:
const stepLabels = [
  t("setupWizard.stepLabels.network"),
  t("setupWizard.stepLabels.server"),   // was 3rd
  t("setupWizard.stepLabels.workspace"), // was 2nd
  t("setupWizard.stepLabels.install"),
];

// canNext also swaps:
export function canNext(step: number, state: WizardState): boolean {
  if (step === 1) return state.networkId !== null;
  if (step === 2) return state.serverKeyId !== null;   // was packId
  if (step === 3) return state.packId !== null;        // was serverKeyId
  if (step === 4) return true;
  return false;
}

// step rendering:
{step === 1 && <Step1Network state={state} setState={setState} />}
{step === 2 && <Step2Server state={state} setState={setState} />}
{step === 3 && <Step3Workspace state={state} setState={setState} />}
{step === 4 && <Step4Install state={state} setState={setState} />}
```

- [ ] **Step 4: Update existing tests for the wizard**

The existing `SetupWizard.test.tsx` has a `canNext` regression test — update step assertions to match the new ordering.

- [ ] **Step 5: i18n keys for new labels**

```ts
// en
setupWizard: {
  ...,
  stepLabels: {
    network: "Network",
    server: "Server",
    workspace: "Workspace",
    install: "Install",
  },
  step2: { title: "Create a server", ... },
  step3: { title: "Create a workspace", ... },
}
// fr: same structure
```

- [ ] **Step 6: Run + commit**

```bash
cd editor && npx vitest run
git add editor/src/features/setup
git commit -m "refactor(setup): reorder wizard — Server (Step 2) before Workspace (Step 3)"
```

### Task 7.2: i18n vocabulary mass-rename

**Files:**
- Modify: `editor/src/locales/en.ts`, `editor/src/locales/fr.ts`
- Modify: any component using deprecated keys

- [ ] **Step 1: Identify deprecated keys**

Run from `editor/`: `grep -rn "networkDetail\.serverKeys\|networkDetail\.deleteKey\|networkDetail\.confirmDeleteKey\|networkDetail\.noServerKeys\|networkDetail\.serverKeyNoPacks\|networkDetail\.helloAudit\|networkDetail\.allowlist" src/ --include="*.tsx" --include="*.ts" | head -30`

- [ ] **Step 2: Mass-rename in both locale files**

Open both `en.ts` and `fr.ts`. Apply renames per the spec §10 table:
- `networkDetail.serverKeys` → `networkDetail.servers`
- `networkDetail.deleteKey` → `networkDetail.deleteServer`
- `networkDetail.confirmDeleteKey` → DELETE (replaced by `deleteServerDialog.*`)
- `networkDetail.noServerKeys` → `networkDetail.noServers`
- `networkDetail.serverKeyNoPacks` → DELETE
- `networkDetail.helloAudit*` → DELETE (moved to `connectionHistoryModal.*`)
- `networkDetail.allowlist*` → DELETE (moved to `ipAllowlistModal.*`)

- [ ] **Step 3: Update consumers**

For each grep match from Step 1, replace the deprecated key with the new key in the JSX. Run `cd editor && npx vitest run` after each batch of edits — TypeScript will catch most issues, but tests provide the runtime safety net.

- [ ] **Step 4: Commit**

```bash
git add editor/src/locales editor/src
git commit -m "refactor(i18n): mass-rename server_key vocabulary → server (and helpers to modals)"
```

### Task 7.3: Delete dead components + files

**Files:**
- Delete: `editor/src/features/branches/BranchSwitcher.tsx`
- Delete: `editor/src/features/branches/PromoteButton.tsx`
- Delete: `editor/src/features/branches/MergeButton.tsx`
- Delete: `editor/src/features/branches/MergeConflictModal.tsx`
- Delete: `editor/src/state/branchesStore.ts`
- Delete: `editor/src/features/servers/ServersPanelContent.tsx`
- Delete: `editor/src/features/servers/BindServerDialog.tsx`

- [ ] **Step 1: Verify each file has zero consumers**

For each candidate file: `grep -rn "BranchSwitcher\|PromoteButton\|MergeButton\|MergeConflictModal\|useBranchesStore\|ServersPanelContent\|BindServerDialog" editor/src --include="*.ts" --include="*.tsx" | grep -v test`

If any non-test consumers remain, fix them first (they should have been already removed in P5/P6).

- [ ] **Step 2: Delete the files (and their associated test files if any)**

```bash
rm editor/src/features/branches/BranchSwitcher.tsx
rm editor/src/features/branches/PromoteButton.tsx
rm editor/src/features/branches/MergeButton.tsx
rm editor/src/features/branches/MergeConflictModal.tsx
rm editor/src/state/branchesStore.ts
rm editor/src/features/servers/ServersPanelContent.tsx
rm editor/src/features/servers/BindServerDialog.tsx
# also their test files if they exist
```

- [ ] **Step 3: Run full editor test suite**

Run: `cd editor && npx vitest run`
Expected: green. If any failures, the dead-code removal exposed a consumer that wasn't found by grep — fix.

- [ ] **Step 4: Commit**

```bash
git add -u  # deletion-only commit
git commit -m "refactor(editor): delete dead branch/binding UI (post-P6 cleanup)"
```

### Task 7.4: Final verification + CLAUDE.md update

- [ ] **Step 1: Full test suite (editor + backend)**

```bash
cd editor && npx vitest run
cd backend && bun run test
```
Both green.

- [ ] **Step 2: Manual smoke**

Start the stack: `docker compose restart backend editor && sleep 8 && docker compose logs backend --tail 5`.

Open editor, run through:
- /artisan setup in MC console → wizard renders Server step before Workspace step
- /networks/:id shows ServerCard list with kebab menu
- Server kebab → all 5 actions work (rotate, show, history, allowlist, delete)
- New server modal works, new workspace modal works
- Sidebar shows ServerDropdown when ≥2 servers, filters workspaces
- Workspace top bar — no branch toolbar, History tab works, Restore restores a past commit
- Deploy still works (saves + commits + broadcasts)

- [ ] **Step 3: Update CLAUDE.md to reflect new model**

Add a section under "Modèle d'entités" describing the 1:N pack:server relationship, deletion of pack_bindings, and the simplified branch model (main implicit, History tab).

```bash
git add CLAUDE.md
git commit -m "docs: document servers UX simplification (1:N pack:server, History tab)"
```

- [ ] **Step 4: Confirmation**

Plan complete. Verify on http://localhost:5173 that everything works end-to-end.

---

## Self-Review

Run through the spec sections and verify each maps to tasks:

| Spec section | Tasks |
|---|---|
| §4 Data model | P1 Tasks 1.1-1.6 |
| §5 /networks/:id redesign | P3 Tasks 3.1-3.4 |
| §6 Sidebar navigation | P2 Tasks 2.1-2.4 |
| §7 Creation/deletion | P3 Task 3.3 (modals), P4 Task 4.3 (delete dialog), P7 Task 7.1 (wizard) |
| §8 Branches → History tab | P5 Tasks 5.1-5.4, P6 Tasks 6.1-6.2 |
| §9 Migration | P1 Task 1.1 |
| §10 i18n vocabulary | P7 Task 7.2 (also distributed across each new-component task) |
| §11 Tests | distributed across all tasks (TDD style) |
| §12 Phasing | matches task organization |
| §13 V2 considerations | not in scope; documented as deferred |

Placeholder scan: no TBD / TODO / "implement later" / "similar to Task N" patterns. All code blocks have actual content. Exception: where a task says "if no changes needed, skip" (Task 2.4), that's a guarded conditional, not a placeholder.

Type consistency: `Pack`, `Server`, `ServerSummary`, `PackSummary`, `WizardState` referenced consistently. `createPack(networkId, serverKeyId, name, description?)` signature aligned between API client (3.4 Step 1), wizard usage (7.1 Step 2), and `serversStore` consumers.
