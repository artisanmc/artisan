# Sync model — deletion propagation and divergence resolution

**Status:** Design accepted, ready for implementation plan
**Date:** 2026-05-20
**Scope:** plugin + backend + editor

---

## 1. Context and problems

The current sync model between web editor, backend and Minecraft plugin is **additive only** on the server disk side. Two bugs result.

### Bug A — Editor deletions do not propagate

`plugin/src/main/kotlin/net/artisanmc/plugin/sync/BundleDownloader.kt:48-54` loops over the files received from the backend and writes each one to disk, **without deleting the local files absent from the bundle**. Consequence: deleting a menu in the editor updates the backend snapshot, but the YAML file stays as a ghost on the server disk and is reloaded by `reloadFromDisk()` on the next `bundle_available`.

### Bug B — Disk ↔ backend divergence silently overwritten

`SyncedMenuProvider.detectSyncAction` (plugin/.../SyncedMenuProvider.kt:43-48) compares three hashes (disk, last sync, backend) and logs a warning on `LOCAL_ONLY` or `CONFLICT`, but does nothing else. The `/artisan sync accept|reject` command mentioned in the warnings is not implemented. Consequence: any change made directly to the server files (an admin's SSH, manual editing) is silently overwritten on the next `bundle_available`.

### Design decisions retained

1. **Hybrid source of truth**: editor authoritative in normal operation; divergence detected at plugin boot and at `/artisan reload` must produce an interactive alert in the editor.
2. **Detection trigger**: plugin boot and `/artisan reload` only. No runtime file watcher.
3. **Resolution granularity**: per pack.
4. **"No editor open" case**: conflict persisted in DB, surfaced on the next editor open.
5. **Detection approach**: upfront pre-fetch — the plugin sends the full disk content at the moment it detects the divergence, the backend stores and resolves in a single round trip.

---

## 2. Architecture & data flow

### Fixed normal flow (bug A)

```
Editor → POST /api/bundles/:packId { files }
       → Backend stores filesJson + recomputes hash
       → WS broadcast bundle_available { pack_id, url, hash }
Plugin → GET /api/bundles/:packId → { files, hash }
       → BundleDownloader writes each file
       → 🆕 BundleDownloader deletes local files absent from the bundle
       → SyncMetadata.recordSync(syncedHash, backendHash)
       → reloadFromDisk → onReload
```

### Conflict flow (bug B)

```
Plugin boot (or /artisan reload)
  → BundleHasher.hash(packDir) for each pack
  → detectSyncAction(disk, synced, backend)
  → if LOCAL_ONLY or CONFLICT:
      read disk_files (walk of packDir + readText)
      WS send pack_divergence_detected { pack_id, disk_files, disk_hash, last_synced_hash }

Backend
  → upsert pack_conflicts row { server_id, pack_id, disk_files_json, disk_hash, detected_at, resolved_at=NULL }
  → if active editor(s) for this server_key: WS push pack_conflict_detected { conflict_id, pack_id, detected_at }
  → otherwise: the editor will see it on open via GET /api/editor-session/:token/conflicts

Editor (banner + modal)
  → "Keep editor" → POST /api/editor-session/:token/conflicts/:id/resolve { choice: "editor" }
        backend marks resolved, re-broadcasts bundle_available (plugin pulls the backend version, deletes the diffs via bug A fix)
  → "Use server" → POST .../resolve { choice: "server" }
        backend replaces filesJson with disk_files_json, recomputes hash, marks resolved
        broadcasts bundle_available (other plugins get in phase), editor refresh
```

### Whole-pack deletion flow

```
Editor → type-to-confirm modal (the user types the pack name to enable the "Delete" button)
       → DELETE /api/editor-session/:token/packs/:packId
Backend → UPDATE pack_bundles SET deleted_at = NOW() WHERE serverId=? AND packId=?
       → UPDATE pack_conflicts SET resolved_at = NOW(), resolution = "editor" WHERE serverId=? AND packId=? AND resolved_at IS NULL
       → WS broadcast pack_deleted { pack_id } to connected plugins
       → WS broadcast pack_deleted { pack_id } to the other editors (multi-tab)
Plugin → atomic switch on the bundles map (removes the entry)
       → move packsDir/<packId> → packsDir/.artisan-trash/<packId>-<timestamp>/
```

### Fundamental invariant

**As long as an open conflict exists for `(server_id, pack_id)`, no `bundle_available` is broadcast for this pack.** Implemented on the backend side: the broadcast function checks the absence of an open conflict before emitting. Prevents any silent overwrite while a decision is pending.

---

## 3. Mechanical fix for bug A

**Target**: `plugin/src/main/kotlin/net/artisanmc/plugin/sync/BundleDownloader.kt`.

**Mechanics**:

1. Build `expectedRelPaths: Set<String>` from the keys of the bundle's `files` map (paths relative to `packDir`, normalized to `/`).
2. Write the files as today (existing loop L48-54).
3. After writing, walk `packDir`:
   - For each file encountered, compute its `relPath` (`/` separator).
   - **Skip** any file whose base name starts with `.artisan` (SyncMetadata sentinel prefix, already excluded from the hash).
   - **Skip** any file whose top-level path starts with `.` (defense against `.git`, `.DS_Store`, etc.).
   - If `relPath ∉ expectedRelPaths` → delete.
4. After the sweep, delete the directories that became empty (`packDir.walkBottomUp().filter { it.isDirectory && it.list()?.isEmpty() == true && it != packDir }.forEach { it.delete() }`).
5. `SyncMetadata.recordSync(...)` as today.

**Atomicity** — no need for strong transactionality. If the plugin crashes between the write and the sweep, the next boot will detect the divergence (ghost file present on disk while the backend no longer has it) and the conflict flow will take over.

---

## 4. Data model

### New `pack_conflicts` table

```ts
export const packConflicts = pgTable("pack_conflicts", {
  id: text("id").primaryKey(),                          // uuid
  serverId: text("server_id").notNull()
    .references(() => serverKeys.id, { onDelete: "cascade" }),
  packId: text("pack_id").notNull(),
  diskFilesJson: text("disk_files_json").notNull(),     // JSON.stringify(Record<path, content>)
  diskHash: text("disk_hash").notNull(),
  lastSyncedHash: text("last_synced_hash").notNull(),   // "" sentinel allowed
  backendHashAtDetection: text("backend_hash_at_detection").notNull(),
  detectedAt: timestamp("detected_at").notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at"),                 // NULL = open
  resolution: text("resolution"),                       // NULL | "editor" | "server"
}, (t) => ({
  uniqOpen: uniqueIndex("pack_conflicts_open_uniq")
    .on(t.serverId, t.packId)
    .where(sql`${t.resolvedAt} IS NULL`),
}));
```

The partial unique index `WHERE resolved_at IS NULL` materializes at the DB level the rule "a pack can have at most ONE open conflict". Any attempt to open a second one fails, which forces the code to use ON CONFLICT DO UPDATE.

### New column on `pack_bundles`

```ts
deletedAt: timestamp("deleted_at"),     // NULL = active, otherwise tombstone
```

Soft delete. `pack_hashes` in `hello_ack` excludes the rows with `deletedAt IS NOT NULL`. No auto purge in v1.

### Lifecycle of a `pack_conflicts` row

```
[plugin detects divergence]
  → INSERT (or UPDATE if an open conflict exists: we update disk_files_json + disk_hash, keep detected_at)
  → resolvedAt = NULL

[admin clicks in the editor]
  → UPDATE: resolvedAt = NOW(), resolution = "editor" | "server"

[resolution "server"] backend updates packBundles.filesJson from disk_files_json
[resolution "editor"] backend leaves packBundles.filesJson as is
[in both cases]       backend broadcasts bundle_available to re-push
[plugin receives bundle_available, applies the normal flow fixed for bug A]
```

Resolved rows stay in DB (audit trail). No auto purge, not a v1 priority.

---

## 5. Extended WS protocol

### Plugin → backend messages (new)

| Type | Payload | When |
|---|---|---|
| `pack_divergence_detected` | `{ pack_id: string, disk_files: Record<string, string>, disk_hash: string, last_synced_hash: string }` | At boot and at `/artisan reload`, once per divergent pack |

### Backend → plugin messages (new + modified)

| Type | Payload | When |
|---|---|---|
| `pack_deleted` | `{ pack_id: string }` | When a pack is deleted via editor DELETE |
| `hello_ack` (extended) | added field `deleted_pack_ids: string[]` | To reconcile deletions missed while the plugin was offline |

### Backend → editor messages (new)

| Type | Payload | When |
|---|---|---|
| `pack_conflict_detected` | `{ conflict_id: string, pack_id: string, detected_at: string }` | When a row is inserted/updated in DB and an editor is connected for this server_key |
| `pack_conflict_resolved` | `{ conflict_id: string, pack_id: string, resolution: "editor" \| "server" }` | When another editor resolves (multi-tab, multi-user) |
| `pack_deleted` | `{ pack_id: string }` | Same, propagated to the other open editors |

No existing message is a breaking change.

### Path format in `disk_files`

Prefixed as today in `BundleUploader.kt:25`:
```
"plugins/Artisan/packs/<packId>/<relPath>" → "<content>"
```
Symmetry with `BundleUploader` (the walk + read code can be factored). `.artisan*` files are excluded from the payload.

### Modified hello flow

```
plugin → hello { current_bundle_hash, ... }
backend → hello_ack { pack_hashes, deleted_pack_ids, ... }
plugin: for each deleted_pack_id
  → if folder present on disk → deletePackDirectory(packId)
plugin: for each active pack on disk
  → computes diskHash, reads syncedHash
  → if detectSyncAction == IN_SYNC          → nothing
  → if detectSyncAction == AUTO_SYNC        → as today (waits for bundle_available)
  → if detectSyncAction == LOCAL_ONLY/CONFLICT
       → walk packDir, reads disk_files
       → WS send pack_divergence_detected
```

On the backend side, on receiving `pack_divergence_detected`:
1. Validate auth (server_key already validated by the WS hub).
2. Check that the pack exists and is not deleted. If deleted → skip (the plugin will receive `pack_deleted` via `hello_ack.deleted_pack_ids`).
3. UPSERT `pack_conflicts` (insert if no open row, update otherwise).
4. For each open editor for this server_key → WS send `pack_conflict_detected`.

On the plugin side, after sending `pack_divergence_detected`: rewrites nothing on disk for this pack until a future `bundle_available` (which will arrive after resolution). The pack keeps running on the current disk state (menus already loaded in memory remain valid).

---

## 6. Editor HTTP API

### Conflict endpoints

| Method | Endpoint | Response / Body | Semantics |
|---|---|---|---|
| `GET` | `/api/editor-session/:token/conflicts` | `{ conflicts: ConflictSummary[] }` | Lists open conflicts. Called when the editor opens. |
| `GET` | `/api/editor-session/:token/conflicts/:id` | `{ conflict: ConflictDetail }` | Detail including `diskFiles`. Allows (future) a file-level diff viewer. |
| `POST` | `/api/editor-session/:token/conflicts/:id/resolve` | body `{ choice: "editor" \| "server" }` → 200 `{ resolved: true, newHash: string }` or 409 if already resolved | Resolution. |

### Pack deletion endpoint

| Method | Endpoint | Response | Semantics |
|---|---|---|---|
| `DELETE` | `/api/editor-session/:token/packs/:packId` | 200 `{ deleted: true }` or 404 | Soft delete. Marks any open conflict for this pack as `resolution: "editor"`. Broadcasts `pack_deleted` to plugins and other editors. |

### Types

```ts
type ConflictSummary = {
  id: string;
  packId: string;
  detectedAt: string;            // ISO
  diskHash: string;
  backendHashAtDetection: string;
  fileCount: number;
  diff: {
    addedOnDisk: string[];       // relative paths present on disk, absent from the backend
    removedOnDisk: string[];     // paths absent from disk, present in the backend
    modifiedOnDisk: string[];    // paths present on both sides but with different content
  };
};

type ConflictDetail = ConflictSummary & {
  diskFiles: Record<string, string>;
};
```

The `diff` field is **computed on demand** by comparing `pack_conflicts.disk_files_json` with the current `pack_bundles.files_json`. Not stored, no risk of desync.

### Behavior of `POST resolve`

```ts
// pseudo-code
async function resolve(conflictId, choice) {
  return db.transaction(async (tx) => {
    const conflict = await tx.select().from(packConflicts)
      .where(and(eq(packConflicts.id, conflictId), isNull(packConflicts.resolvedAt)))
      .for("update");
    if (!conflict) throw 409; // already resolved (other tab)

    if (choice === "server") {
      // Follows the convention of POST /api/bundles/:packId (bundles.ts):
      // - preserves the existing editorJson (canvasLayout, etc.) if present and non-stub
      // - otherwise importPackFromFiles from the disk files
      // - in all cases, canvasLayout comes from the disk files (readEditorLayoutFromFiles)
      const diskFiles = JSON.parse(conflict.diskFilesJson) as Record<string, string>;
      const newHash = await computeBundleHash(diskFiles, conflict.packId);
      const existing = await tx.select({ editorJson: packBundles.editorJson }).from(packBundles)
        .where(and(eq(packBundles.serverId, conflict.serverId), eq(packBundles.packId, conflict.packId)));
      const incomingLayout = readEditorLayoutFromFiles(diskFiles, conflict.packId);
      let editorJsonObj: Record<string, unknown>;
      if (existing.length > 0 && !isEmptyStub(existing[0].editorJson)) {
        editorJsonObj = JSON.parse(existing[0].editorJson!) as Record<string, unknown>;
      } else {
        editorJsonObj = importPackFromFiles(conflict.packId, diskFiles) as Record<string, unknown>;
      }
      editorJsonObj.canvasLayout = incomingLayout;
      await tx.update(packBundles)
        .set({ filesJson: conflict.diskFilesJson, hash: newHash, editorJson: JSON.stringify(editorJsonObj) })
        .where(and(eq(packBundles.serverId, conflict.serverId), eq(packBundles.packId, conflict.packId)));
    }
    // for "editor": we do not touch packBundles

    await tx.update(packConflicts).set({ resolvedAt: now, resolution: choice }).where(eq(packConflicts.id, conflictId));
  });

  // outside the transaction:
  // 1. broadcast bundle_available to the plugin (pack is no longer frozen)
  // 2. broadcast pack_conflict_resolved to the other editors open for this server_key
  // 3. if choice === "server": push to the open editors so they refetch the pack
}
```

### Defense on POST /api/bundles

`POST /api/bundles/:packId` must refuse to publish if an open conflict exists for this pack: 409 `{ error: "pack_locked", conflictId: "..." }`. Prevents a compromised editor from forcing a publish while a conflict is pending. The editor catches this code and shows the conflict banner.

### Auth

`editorSession.ts` already validates the `token` and returns the `serverId`. We filter conflicts on `serverId`. Path traversal on `:id` is not possible (strict UUID).

---

## 7. Editor UX

### Conflict banner

Persistent banner at the top of the canvas area (route `pack.$packId.tsx`) as long as at least one unresolved conflict exists for the active server_key.

```
┌─────────────────────────────────────────────────────────┐
│  ⚠  2 conflicts detected on the Minecraft server       │
│     Files were modified outside the                    │
│     editor.                          [View details]    │
└─────────────────────────────────────────────────────────┘
```

Hydration: on editor load, a `useEffect` does `GET /api/editor-session/:token/conflicts` and fills a `conflictsStore` slice (Zustand). The editor WS listens for `pack_conflict_detected` / `pack_conflict_resolved` → upsert/remove in the store at runtime.

### Resolution modal

Click "View details" → modal listing the packs in conflict. For each:

```
my_pack
  Modified on the Minecraft server on May 20, 2026 at 14:32
  
  Changes detected:
   + 1 file added          (dialogs/welcome.yaml)
   ~ 2 files modified      (menus/main.yaml, lang/fr.yaml)
   - 1 file removed        (menus/old.yaml)
  
  ┌─────────────────────────┐   ┌─────────────────────────┐
  │  Keep editor            │   │  Use server             │
  │  Push this version      │   │  Adopt the server's     │
  │  back to the server.    │   │  files here.            │
  └─────────────────────────┘   └─────────────────────────┘
```

The buttons describe the action, not the side ("Push" / "Adopt") to avoid ambiguity.

**i18n**: all strings via react-i18next, keys added to `en.ts` + `fr.ts` simultaneously.

### Implicit behaviors

- Editing a pack in conflict stays possible — we do not block work. The admin can edit then click "Keep editor" to push their new version.
- The **"Publish" button and auto-publish are disabled** for packs with an open conflict. The "Keep editor" resolution is what unblocks publishing.
- If another admin resolves while we are in the modal: we receive `pack_conflict_resolved` → toast "Conflict resolved by another admin" → modal closes, refresh.

### Pack deletion modal

GitHub type-to-confirm pattern:

```
Delete pack "my_pack"?

This action will delete all menus, dialogs and translations of the pack on all
connected Minecraft servers. The files will be moved to
`plugins/Artisan/.artisan-trash/` on the server side in case recovery is needed.

If a conflict exists for this pack, it will be ignored and the editor will become authoritative.

To confirm, type the pack name:  [_______________]

[Cancel]   [Delete (disabled until exact match)]
```

---

## 8. Edge cases & invariants

### Central invariant

A pack with an open conflict is frozen on the plugin side — no `bundle_available` is broadcast until the conflict is resolved. Implementation: the broadcast function (in `hub.ts` after publish or reconnect) does a `SELECT 1 FROM pack_conflicts WHERE server_id=? AND pack_id=? AND resolved_at IS NULL` and skips on match.

### Covered cases

| # | Scenario | Expected behavior |
|---|---|---|
| 1 | Plugin offline while the admin resolves "use server" | On reconnect, plugin sends `hello` with its `disk_hash` (unchanged). Backend sees `packBundles.hash == disk_hash` → IN_SYNC → no bundle_available. |
| 2 | Plugin offline while the admin resolves "keep editor" | Plugin reconnects with its `disk_hash` (still divergent). Backend sees conflict resolved → re-broadcasts `bundle_available` immediately. Plugin downloads, applies with deletions, divergence eliminated. |
| 3 | Race: admin resolves while the plugin sends a new `pack_divergence_detected` | The resolution UPDATE `WHERE resolved_at IS NULL` guarantees only one transaction wins. If the insert arrives afterwards, it is a legitimate new conflict (disk changed again). |
| 4 | Two admins open the editor, one resolves, the other receives `pack_conflict_resolved` | Modal close + toast + refresh. |
| 5 | Plugin re-detects while a conflict is already open (admin re-edits via SSH then /artisan reload) | UPSERT: UPDATE `disk_files_json` + `disk_hash` of the existing conflict. `detected_at` keeps its original value. |
| 6 | Admin publishes from the editor while a conflict is open for the same pack | Button disabled on the UI side. Backend defense: POST /api/bundles returns 409 `pack_locked`. |
| 7 | "Use server" but `diskFilesJson` is empty (admin did `rm -rf` on the pack) | Additional warning in the modal: "⚠ Adopting the server version will empty this pack (no files detected on disk). Confirm?". If confirmed, `packBundles.filesJson = "{}"`. |
| 8 | Pack deleted on the editor side AND a conflict was in progress | DELETE marks the conflict `resolution: "editor"` automatically and sends `pack_deleted` to the plugin. Documented in the deletion modal copy. |
| 9 | Plugin sends `pack_divergence_detected` for a pack deleted in the meantime on the backend side | Backend checks `packBundles`: if `deletedAt IS NOT NULL` or row absent → skip the upsert. Plugin will receive `pack_deleted` on next reconnect. |
| 10 | Path traversal via malicious `disk_files` keys | Plugin side during the initial read: `BundleUploader` walks from `packDir`, paths safe by construction. Plugin side during the `bundle_available` that follows: `BundleDownloader.kt:51` keeps the `canonicalPath.startsWith(packDir.canonicalPath + File.separator)` defense. |
| 11 | Pack does not exist in `pack_bundles` but on disk, and the admin resolves "keep editor" | Impossible in practice: `pack_hashes` must have been sent for this pack for a conflict to open. The empty-stub auto-upload code (SyncedMenuProvider.kt:230-247) operates BEFORE any conflict detection. |
| 12 | `/artisan reload` while the pack is frozen in conflict | Plugin re-walks, re-detects, re-upserts (updates `disk_files_json` if touched again). No loop: no `bundle_available` arrives (frozen). Server runs on the disk state. |
| 13 | Pack empty on both sides (`disk_hash == "" && backend_hash == ""`) | `detectSyncAction("", "", "")` → IN_SYNC. No conflict. `""` sentinel respected. |

### Invariants to document in CLAUDE.md

- **Conflict = freeze**: as long as `pack_conflicts.resolved_at IS NULL`, no `bundle_available` is emitted for `(server_id, pack_id)`.
- **Auto-resolution on pack DELETE**: deleting a pack on the editor side implicitly resolves any open conflict as `resolution: "editor"`.
- **Path safety**: the `canonicalPath.startsWith` defense in `BundleDownloader` is essential — defense in depth, never remove.
- **`.artisan*` is sacred**: prefix excluded from the hash, from the deletion sweep (bug A), and used for `.artisan-trash/`. Never use it for anything else.

---

## 9. Tests

### Backend (Bun + Vitest)

**New files**:
- `backend/src/lib/conflictDetection.test.ts` — `diff` computation (added/modified/removed). Cases: identical, pure additions, pure deletions, modifications, mix.
- `backend/src/routes/conflicts.test.ts` — `/api/editor-session/:token/conflicts*` endpoints. Cases: GET empty / non-empty, GET detail, GET detail other server_key → 404, POST resolve "editor" / "server", POST resolve already resolved → 409, POST resolve wrong token → 401, POST resolve race (double click) → second call 409.
- `backend/src/routes/packs.test.ts` (or extension of `bundles.test.ts`) — DELETE pack. Cases: DELETE success → `deletedAt` set + WS `pack_deleted` emitted to plugins + other editors, DELETE pack with open conflict → conflict auto-resolved "editor", DELETE nonexistent pack → 404, DELETE other server_key → 404.

**Modified files**:
- `backend/src/routes/bundles.test.ts` — POST /api/bundles/:packId rejected with 409 if open conflict.
- `backend/src/lib/hub.test.ts` — receiving `pack_divergence_detected` → upsert conflict + broadcast `pack_conflict_detected`. Re-receipt → UPDATE. For deleted pack → skip. Enriched `hello_ack`: `pack_hashes` excludes deleted packs, `deleted_pack_ids` populated.
- `bundle_available` broadcast tests — no broadcast if open conflict.

**Schema test**: check that the partial unique index rejects a second open row for `(server_id, pack_id)`.

### Plugin (Kotlin + JUnit)

**Modified files**:
- `plugin/src/test/kotlin/net/artisanmc/plugin/BundleDownloaderTest.kt` — 4 bug A tests: deletion propagated, SyncMetadata preserved, empty directories cleaned, path traversal defended.
- `plugin/src/test/kotlin/net/artisanmc/plugin/FullSyncIntegrationTest.kt` — end-to-end scenario: seed divergence → `load()` → check `pack_divergence_detected` is sent to the mock backend → mock replies `bundle_available` simulating "keep editor" → check ghost files deleted.

**New file**:
- `plugin/src/test/kotlin/net/artisanmc/plugin/PackDeletionTest.kt`:
  - Runtime WS `pack_deleted` → folder moved to `.artisan-trash/<packId>-<timestamp>/`, `bundles` map atomically updated.
  - `hello_ack.deleted_pack_ids` on reconnect → same behavior.
  - `pack_deleted` for a pack not present locally → silent no-op.
  - Pre-existing `.artisan-trash/` → second pack with the same name → trash folder with a distinct timestamp.

### Editor (Vitest + React Testing Library)

**New files**:
- `editor/src/state/conflictsStore.test.ts` — hydration from GET, upsert on `pack_conflict_detected`, remove on `pack_conflict_resolved`.
- `editor/src/features/sync/ConflictBanner.test.tsx` — conditional visibility, navigation to modal.
- `editor/src/features/sync/ConflictResolutionModal.test.tsx` — summary (added/modified/removed), routes called correctly, "empty disk" warning, auto-close on last conflict resolved, toast on `pack_conflict_resolved` while the modal is open.
- `editor/src/features/sync/DeletePackDialog.test.tsx` — type-to-confirm, DELETE called, close on success, 404 handling.

**Modified files**:
- Existing `pack.$packId.tsx` tests — "Publish" button / autopublish disabled if open conflict on the current pack.
- `wsStore` tests — routing of the new WS messages to the right stores.

### Manual E2E (not automated)

Scenario documented in `docs/specs/sync-deletion-e2e.md` (to create with the spec):
1. Start the full Docker stack.
2. Create a pack, add 3 menus, publish.
3. Check the folder is present on the server disk.
4. Delete a menu in the editor, publish → menu disappears from disk (bug A).
5. Stop the server, delete a YAML file via SSH, restart.
6. Open the editor → conflict banner appears.
7. Click "Keep editor" → YAML file reappears on disk.
8. Redo (5) with a content change.
9. Click "Use server" → editor reflects the disk version.
10. DELETE pack via type-to-confirm modal → check the move into `.artisan-trash/`.

---

## 10. Out of scope (potential follow-ups)

- **Runtime file watcher** on the plugin side (option rejected in the trigger section). If we ever need it later, it can be added without changing the protocol.
- **File-level diff** in the resolution modal (side-by-side YAML viewer). The current structure (full `diskFiles` in DB) allows adding it without migration.
- **GC of the trash** on the plugin side (`.artisan-trash/` purged after N days). The folder can otherwise grow indefinitely — TODO to track.
- **GC of resolved conflicts** in DB (purge of rows `resolved_at < NOW() - 90 days`). Not critical in v1.
- **Dedicated audit log** of resolutions (who clicked what, when). For now traceable via the timestamps on `pack_conflicts`, but without user identity — the project does not yet have named users.

---

## 11. Files touched (estimate)

**Backend**:
- `backend/src/db/schema.ts` (`pack_conflicts` table + `deletedAt` column on `pack_bundles`)
- `backend/src/lib/hub.ts` (new `pack_divergence_detected` handler, broadcast freeze + new editor messages)
- `backend/src/lib/conflictDetection.ts` (new — `diff` computation)
- `backend/src/routes/conflicts.ts` (new)
- `backend/src/routes/packs.ts` (new, or add DELETE in `bundles.ts`)
- `backend/src/routes/bundles.ts` (409 `pack_locked` defense)
- `backend/src/index.ts` (registration of the new routes)

**Plugin**:
- `plugin/src/main/kotlin/net/artisanmc/plugin/sync/BundleDownloader.kt` (bug A fix)
- `plugin/src/main/kotlin/net/artisanmc/plugin/sync/BundleUploader.kt` (factor the walk + read for reuse in conflict detection)
- `plugin/src/main/kotlin/net/artisanmc/plugin/provider/SyncedMenuProvider.kt` (send `pack_divergence_detected`, `pack_deleted` handler, read `deleted_pack_ids` in `hello_ack`)
- `plugin/src/main/kotlin/net/artisanmc/plugin/sync/PackDeleter.kt` (new — atomic move-to-trash)

**Editor**:
- `editor/src/state/conflictsStore.ts` (new)
- `editor/src/features/sync/ConflictBanner.tsx` (new)
- `editor/src/features/sync/ConflictResolutionModal.tsx` (new)
- `editor/src/features/sync/DeletePackDialog.tsx` (new)
- `editor/src/state/wsStore.ts` (routing of new messages)
- `editor/src/routes/pack.$packId.tsx` (banner integration + publish disabling on conflict)
- `editor/src/locales/en.ts` + `fr.ts` (new keys)

**Docs**:
- `CLAUDE.md` (new invariants in the "Critical invariants" section, new endpoints in the table, `pack_deleted` message in the protocol table, `.artisan-trash/` mention)
- `docs/specs/sync-deletion-e2e.md` (new — manual scenario)
