# Presence Activation (M1 · Plan 5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A module appears in the editor because its plugin is installed on the customer's MC server — driven by the set of modules the plugin reports at the WS `hello`, persisted per `server_key`, read by the editor to gate module mounting.

**Architecture:** Three dependency-ordered phases. **Phase A (backend)**: a `server_modules` table, an exported `persistServerModules(serverKeyId, installed)` (upsert + prune), called fire-and-forget from the `hello` handler, plus the `installed_modules` field on `HelloMessage`. **Phase B (plugin)**: Core enumerates its registered `ArtisanModule`s into `hello.installed_modules`. **Phase C (editor)**: read the persisted set and gate which modules mount. This plan details **Phase A**; B and C are outlined and detailed when reached.

**Tech Stack:** Bun + Hono + Drizzle/Postgres, `bun test`. (Phase B: Kotlin/Paper. Phase C: React/Vite.)

**Spec:** `docs/superpowers/specs/2026-06-15-modules-architecture-design.md` §8 (activation by presence). Field already pre-specified in `docs/architecture/versioning.md` §4.1 and `modules.md` §3.3.5 — not yet implemented.

**⚠️ Test command:** ALWAYS `bun run test` (wrapper → `artisan_test`). NEVER `bun test` directly (wipes dev DB). `db:generate` is offline (no DB); the wrapper applies migrations to `artisan_test`.

**Design decisions:**
- `persistServerModules` is **exported** and **unit-tested directly** (deterministic), while the `hello` handler calls it **fire-and-forget** with `.catch(() => {})` — presence persistence must never break `hello_ack` (same posture as the existing `serverKeyHelloes` insert).
- **Upsert + prune** (not delete-then-insert): per reported module `insert … onConflictDoUpdate`, then delete this key's modules absent from the reported set. Race-safe under multi-instance (no empty window).
- Presence is the **active set** only; hiding a module never touches authored content (lives in `packs/` etc.). Removing a `server_modules` row = "not currently installed", not "delete data" (spec §8).

---

## File Structure (Phase A)

| File | Responsibility | Action |
|---|---|---|
| `backend/src/db/schema.ts` | `server_modules` table | Modify |
| `backend/drizzle/0009_*.sql` | Generated migration | Create (via `db:generate`) |
| `backend/src/protocol.ts` | `installed_modules` on `HelloMessage` | Modify |
| `backend/src/ws/hub.ts` | `persistServerModules` + call in `hello` | Modify |
| `backend/src/ws/hub.test.ts` | Direct test of `persistServerModules` | Modify |
| `docs/architecture/ws-protocol.md` | Document `installed_modules` on hello | Modify |
| `docs/architecture/entities.md` | Document `server_modules` | Modify |

---

## Task A1: schema + migration

**Files:**
- Modify: `backend/src/db/schema.ts`
- Create: `backend/drizzle/0009_*.sql` (generated)

- [ ] **Step 1: Add `primaryKey` to the schema imports**

In `backend/src/db/schema.ts`, replace the import block:

```ts
import {
	boolean,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";
```

with (adds `primaryKey`):

```ts
import {
	boolean,
	index,
	integer,
	jsonb,
	pgTable,
	primaryKey,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";
```

- [ ] **Step 2: Add the `serverModules` table**

In `backend/src/db/schema.ts`, immediately after the `serverKeyHelloes` table definition (the block ending with the `server_key_helloes_key_time_idx` index `]`), add:

```ts
// Active module set per server, reported by the plugin at every `hello`
// (`installed_modules`). The editor reads this to decide which modules to
// mount — a module appears because its plugin is installed on the server.
// Presence only: removing a row hides the module's UI; authored content is
// never touched. Cf. docs/superpowers/specs/2026-06-15-modules-architecture-design.md §8.
export const serverModules = pgTable(
	"server_modules",
	{
		serverKeyId: text("server_key_id")
			.notNull()
			.references(() => serverKeys.id, { onDelete: "cascade" }),
		moduleId: text("module_id").notNull(),
		version: text("version"),
		lastSeen: timestamp("last_seen").notNull(),
	},
	(t) => [primaryKey({ columns: [t.serverKeyId, t.moduleId] })],
);
```

- [ ] **Step 3: Generate the migration**

Run: `cd backend && bun run db:generate`
Expected: prints that it created a new file `backend/drizzle/0009_<random>.sql` containing `CREATE TABLE "server_modules"`. Confirm with: `ls backend/drizzle/0009_*.sql`.

- [ ] **Step 4: Commit**

```bash
git add backend/src/db/schema.ts backend/drizzle/
git commit -m "feat(backend): add server_modules table for presence activation

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task A2: protocol field + hub persistence + test + docs

**Files:**
- Modify: `backend/src/protocol.ts:1-11`
- Modify: `backend/src/ws/hub.ts` (imports, helper, hello call)
- Modify: `backend/src/ws/hub.test.ts`
- Modify: `docs/architecture/ws-protocol.md`
- Modify: `docs/architecture/entities.md`

- [ ] **Step 1: Add `installed_modules` to `HelloMessage`**

In `backend/src/protocol.ts`, in the `HelloMessage` interface, add after the `custom_items_hash` line:

```ts
  custom_items_hash?: string | null;   // null/absent means no custom item plugin detected
  // Modules the Core plugin currently has registered. Drives editor visibility
  // (presence activation). Absent/empty on older plugins → no modules reported.
  installed_modules?: { id: string; version: string }[];
}
```

- [ ] **Step 2: Extend the hub imports**

In `backend/src/ws/hub.ts`, replace line 1:

```ts
import { and, eq, isNotNull, isNull } from "drizzle-orm";
```

with (adds `notInArray`):

```ts
import { and, eq, isNotNull, isNull, notInArray } from "drizzle-orm";
```

Then in the schema import (line 4), add `serverModules`:

```ts
import { editorSessions, linkCodes, packBranches, packCommits, packs, serverKeyHelloes, serverKeys, serverModules } from "../db/schema";
```

- [ ] **Step 3: Add the `persistServerModules` helper**

In `backend/src/ws/hub.ts`, immediately before the `export ... function handlePluginMessage` (or the `handleMessage`/main handler — place it among the other top-level helpers like `handleCustomItemsHash`), add:

```ts
/**
 * Replace the active module set for a server_key with the set reported at
 * `hello` (`installed_modules`). Upsert each reported module, then prune the
 * ones no longer reported. Presence only — never touches authored content.
 * Exported for direct testing; called fire-and-forget from the hello handler.
 */
export async function persistServerModules(
  serverKeyId: string,
  installed: { id: string; version: string }[],
): Promise<void> {
  const now = new Date();
  for (const m of installed) {
    await db
      .insert(serverModules)
      .values({ serverKeyId, moduleId: m.id, version: m.version ?? null, lastSeen: now })
      .onConflictDoUpdate({
        target: [serverModules.serverKeyId, serverModules.moduleId],
        set: { version: m.version ?? null, lastSeen: now },
      });
  }
  const keepIds = installed.map((m) => m.id);
  await db
    .delete(serverModules)
    .where(
      keepIds.length > 0
        ? and(eq(serverModules.serverKeyId, serverKeyId), notInArray(serverModules.moduleId, keepIds))
        : eq(serverModules.serverKeyId, serverKeyId),
    );
}
```

- [ ] **Step 4: Call it from the success-path hello handler**

In `backend/src/ws/hub.ts`, find the success-path `serverKeyHelloes` insert followed by `handleCustomItemsHash`:

```ts
    handleCustomItemsHash(keyId, (hello as HelloMessage & { custom_items_hash?: string }).custom_items_hash).catch(() => {});
```

Insert immediately **before** that line:

```ts
    persistServerModules(keyId, hello.installed_modules ?? []).catch(() => {});
```

- [ ] **Step 5: Write the direct test**

In `backend/src/ws/hub.test.ts`, add `eq` and `serverModules` to imports — change line 1's nothing; instead add after the existing imports (top of file): `import { eq } from "drizzle-orm";`, and add `serverModules` to the `../db/schema` import list (line 16-24 block). Then append this test inside the top-level `describe("handlePluginMessage", ...)` block (or a new `describe`):

```ts
import { persistServerModules } from "./hub"; // add to the existing "./hub" import if preferred

describe("persistServerModules (presence)", () => {
  test("upserts the reported set and prunes modules no longer reported", async () => {
    const networkId = crypto.randomUUID();
    await db.insert(networks).values({
      id: networkId,
      name: "presence-test",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const keyId = crypto.randomUUID();
    await db.insert(serverKeys).values({
      id: keyId,
      hash: "h",
      networkId,
      createdAt: new Date(),
    });

    await persistServerModules(keyId, [
      { id: "menus", version: "1.0" },
      { id: "shop", version: "2.0" },
    ]);
    let rows = await db.select().from(serverModules).where(eq(serverModules.serverKeyId, keyId));
    expect(rows.map((r) => r.moduleId).sort()).toEqual(["menus", "shop"]);

    // Re-report without "shop", bump menus → shop pruned, menus version updated.
    await persistServerModules(keyId, [{ id: "menus", version: "1.1" }]);
    rows = await db.select().from(serverModules).where(eq(serverModules.serverKeyId, keyId));
    expect(rows.map((r) => r.moduleId)).toEqual(["menus"]);
    expect(rows[0]?.version).toBe("1.1");
  });
});
```

(If `eq` / `serverModules` / `persistServerModules` are already imported from a prior step, do not duplicate the import — merge into the existing import lines.)

- [ ] **Step 6: Run the full backend suite — green**

Run: `cd backend && bun run test`
Expected: all pass, including `persistServerModules (presence)`. The wrapper applies migration `0009` to `artisan_test` before running.

- [ ] **Step 7: Update the docs**

In `docs/architecture/ws-protocol.md`, in the `hello` message description, add `installed_modules` to the field list with: *"`installed_modules?: {id, version}[]` — modules the Core plugin has registered; backend persists per server_key (`server_modules`), editor reads to gate module visibility (presence activation, spec 2026-06-15 §8). Absent on older plugins."*

In `docs/architecture/entities.md`, add an entry for `server_modules`: *"`server_modules(server_key_id, module_id, version, last_seen)` — active module set per server, replaced at each `hello` from `installed_modules`. Presence only: drives editor visibility; hiding ≠ deleting authored content. PK `(server_key_id, module_id)`, FK → `server_keys` cascade."*

- [ ] **Step 8: Commit**

```bash
git add backend/src/protocol.ts backend/src/ws/hub.ts backend/src/ws/hub.test.ts docs/architecture/ws-protocol.md docs/architecture/entities.md
git commit -m "feat(backend): persist reported modules per server_key at hello

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Phase B — plugin reports `installed_modules` (outline, detailed when reached)

Core enumerates its registered `ArtisanModule`s (it already builds `defaultModules()` in `ArtisanPlugin.kt`) and includes `installed_modules: [{id, version}]` in the `hello` payload sent by `WsClient.kt`. Verification: a plugin test (Kotlin) asserts the serialized `hello` carries the module list. Doc: confirm `ws-protocol.md` hello entry. ⚠️ Touches the WS protocol → already documented in Phase A; the plugin-side struct must match.

## Phase C — editor gates module mounting by presence (outline, detailed when reached)

Backend exposes the active module set to the editor (read endpoint or piggy-backed on existing editor-session/network data — scoping: per server_key, network view = union, spec §8). The editor reads it and mounts only present modules (the `listModules()` / sidebar filter + lazy `import()` of the module package). Core modules (menus/commands) are always shown; business modules gated by presence. Verification: editor tests for the gating logic. Decision deferred to Phase C: hidden vs greyed-upsell for not-installed modules (spec §8 open question; M1 default = hidden).

---

## Self-Review (Phase A)

**Spec coverage (§8):** signal persisted per server_key (Task A1 table + A2 `persistServerModules`) ✅; replaced at each hello (upsert + prune) ✅; hiding ≠ deleting authored content (presence table is separate from `packs`) ✅; `installed_modules` field on the protocol (A2 Step 1) ✅. The plugin→signal (Phase B) and editor read+gate (Phase C) are explicitly out of this phase.

**Placeholder scan:** none. The migration filename is non-deterministic by tooling design — Step 3 says discover it via `ls`, Step 4 stages `backend/drizzle/` (the whole dir) so the generated file is included regardless of its random name. The doc-update text (Step 7) is given verbatim; placement is the named section in each file.

**Type consistency:** `persistServerModules(serverKeyId: string, installed: { id: string; version: string }[])` matches `HelloMessage.installed_modules` (Step 1) and the call site `hello.installed_modules ?? []` (Step 4). The test passes the same shape. `serverModules` columns (`serverKeyId`, `moduleId`, `version`, `lastSeen`) match the insert/select usage. `onConflictDoUpdate` target matches the composite PK from Task A1.
