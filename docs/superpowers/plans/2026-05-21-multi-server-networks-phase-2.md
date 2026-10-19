# Multi-Server Networks — Phase 2 Implementation Plan (Branches + Promotion)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter au modèle de données la notion de **commits** et de **branches** par pack ; chaque `PackBinding` cible une branche nommée ; un user peut "Commit" l'état WIP vers une branche puis "Promote" (fast-forward only) une branche vers une autre — typiquement `dev → main`. Le plugin reçoit le contenu de la branche bindée, pas le WIP.

**Architecture:**
- **Backend** : nouvelles tables `pack_commits` (snapshot complet par commit, dédup par `content_hash`) et `pack_branches` (head pointer). `pack_bindings` gagne `branch_name` (default `"main"`). À la création d'un pack, branche `main` créée + commit initial vide. Les WIP fields (`pack.filesJson`, `pack.editorJson`, `pack.hash`) restent et servent de buffer éditeur ; les plugins lisent le commit pointé par la branche. Nouveau routes REST : `POST /commits`, `POST /branches`, `POST /branches/:src/promote/:dst`, plus lookup adapté dans le hub WS.
- **Editor** : sélecteur de branche dans la page pack, bouton "Commit" avec dialog message, panneau History (liste des commits récents), bouton "Promote → <target>" avec validation fast-forward côté backend.
- **Plugin** : aucun changement de code. Le binding pointe maintenant vers une branche ; le hub résout transparemment vers le head_commit_hash.

**Tech Stack:** TypeScript, Bun, Hono, Drizzle ORM (PostgreSQL), React 19, Vite 6, Zustand, TanStack Router, Vitest, JUnit 5 (no plugin changes expected).

**Hors scope (Phase 3 ou plus tard) :**
- Merge sémantique field-level (Phase 3).
- Rebase / cherry-pick / revert d'un commit (commit semantics restent linéaires).
- Pull-requests entre branches.
- Diff visuel entre commits.
- Tags / releases.
- Stockage diff-based (Phase 2 fait snapshot+dedup ; migration future à content-addressable possible).
- Auto-commit à chaque save (resté explicit per spec §9).
- Plugin `/artisan switchBranch` command (set côté backend via éditeur seulement).

**Pré-requis :** Plan 1A, 1B, 1C sur `main` (tip = `15182b1b`).

**Decisions locked (from brainstorm) :**
- Branches : **noms arbitraires** (style git), `main` est juste le défaut.
- Commits : **snapshot complet** par commit, dédup par `content_hash`.
- Commits sont créés **explicitement** via un bouton (pas auto-commit on save).
- Promotion : **fast-forward only** — refuse si la cible a divergé.

---

## File Structure

### Nouveaux fichiers (backend)

- `backend/src/lib/commitStorage.ts` + `.test.ts` — `createCommit`, `getCommit`, `listCommitsByBranch`
- `backend/src/lib/branchStorage.ts` + `.test.ts` — `createBranch`, `getBranch`, `advanceBranchHead`, `listBranchesForPack`, `isAncestor`
- `backend/src/routes/userBranches.ts` + `.test.ts` — `/api/networks/:id/packs/:packId/branches/*` + `/commits/*`
- `backend/scripts/migrate-phase-2.ts` — backfill for existing packs (creates `main` branch + initial commit per existing pack)

### Fichiers modifiés (backend)

- `backend/src/db/schema.ts` — ajout des 2 nouvelles tables ; `pack_bindings` gagne `branch_name`
- `backend/src/lib/packStorage.ts` — `createPack` auto-crée `main` branch + initial commit
- `backend/src/lib/packBindingManager.ts` — `createBinding` accepte un `branchName` optionnel (default `"main"`)
- `backend/src/routes/bundles.ts` — GET résout via branch lookup
- `backend/src/routes/userPacks.ts` — PUT n'avance plus la branche (juste WIP) ; **plus** d'appel à `pushBundleAvailable` ici
- `backend/src/routes/editorSession.ts` — PUT n'avance plus la branche ; deploy + delete pack idem
- `backend/src/routes/userNetworks.ts` — modify POST binding pour accepter `{branch_name?}` en body
- `backend/src/ws/hub.ts` — `hello_ack.pack_hashes` et `pushBundleAvailable` adaptés aux branches
- `backend/src/protocol.ts` — `pushBundleAvailable` signature: `(packId, branchName, headCommitHash)`

### Nouveaux fichiers (editor)

- `editor/src/lib/api/branches.ts` + `.test.ts` — wrappers branches + commits
- `editor/src/state/branchesStore.ts` + `.test.ts`
- `editor/src/features/branches/BranchSwitcher.tsx` + `.test.tsx` — dropdown selector
- `editor/src/features/branches/CommitDialog.tsx` + `.test.tsx` — modal "commit message"
- `editor/src/features/branches/HistoryPanel.tsx` + `.test.tsx` — liste des commits récents
- `editor/src/features/branches/PromoteButton.tsx` + `.test.tsx` — bouton "Promote → <target>"

### Fichiers modifiés (editor)

- `editor/src/routes/pack.$packId.tsx` — monter `BranchSwitcher`, `CommitDialog`, `HistoryPanel`, `PromoteButton` dans une sidebar/header
- `editor/src/lib/packApi.ts` — déprécier `deployPack` (remplacé par "commit" qui pousse vers une branche)
- `editor/src/i18n/locales/en.ts` + `fr.ts` — nouvelles clés `branches.*`, `commit.*`, `promote.*`

### Plugin : aucun changement

Le plugin continue à recevoir `pack_hashes` et à lire le contenu via `GET /api/bundles/:packId`. Côté backend, le bind résout transparemment vers la branche → head commit → content.

### Doc updates (Section F)

- `Artisan/CLAUDE.md` — table endpoints (ajouter `/branches`, `/commits`, `/promote`), table protocole WS (no change — sémantique du `pack_hashes` clarifiée), section modèle entités (ajout branches+commits)
- `.claude/skills/sync-docs/doc-impact-map.yaml`

---

## Migration / wipe procedure

Phase 2 ajoute 2 tables + 1 colonne. Migration backfill nécessaire pour les packs existants :

```sql
-- 1. ALTER pack_bindings.
ALTER TABLE pack_bindings ADD COLUMN branch_name TEXT NOT NULL DEFAULT 'main';

-- 2. CREATE pack_commits + pack_branches via db:push (schema.ts).

-- 3. Backfill : pour chaque pack existant, créer un commit initial + une branche main.
-- Cette étape est faite par backend/scripts/migrate-phase-2.ts (Task A4).
```

Iban a peu de packs locaux ; backfill rapide. La table `pack_bindings` existante prend `'main'` partout. Pas de wipe nécessaire.

---

## Section A — Schema + migration

### Task A1 : Schema additions (`pack_commits`, `pack_branches`)

**Files:**
- Modify: `backend/src/db/schema.ts`

- [ ] **Step 1 : Ajouter `packCommits` après `packBindings`**

```ts
// backend/src/db/schema.ts — append after packBindings:
export const packCommits = pgTable("pack_commits", {
  id: text("id").primaryKey(),                              // "cmt_<12-hex>"
  packId: text("pack_id").notNull().references(() => packs.id, { onDelete: "cascade" }),
  parentId: text("parent_id"),                              // self-ref, nullable (root commit)
  contentHash: text("content_hash").notNull(),              // sha256 of filesJson, for dedup
  filesJson: text("files_json").notNull(),                  // snapshot
  editorJson: text("editor_json"),                          // snapshot of editor state
  authorUserId: text("author_user_id"),                     // FK users.id, null for system commits
  message: text("message").notNull().default(""),
  createdAt: timestamp("created_at").notNull(),
}, (t) => [
  index("pack_commits_pack_idx").on(t.packId),
  index("pack_commits_pack_created_idx").on(t.packId, t.createdAt),
  uniqueIndex("pack_commits_pack_content_uniq").on(t.packId, t.contentHash),
]);

export const packBranches = pgTable("pack_branches", {
  packId: text("pack_id").notNull().references(() => packs.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  headCommitId: text("head_commit_id").notNull().references(() => packCommits.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
}, (t) => [
  uniqueIndex("pack_branches_uniq").on(t.packId, t.name),
  index("pack_branches_head_idx").on(t.headCommitId),
]);
```

> `parentId` n'a pas de `.references(...)` car Drizzle ne supporte pas la self-ref nullable cleanly via `.references()` ; le FK sera ajouté manuellement via SQL ou simplement traité comme un text. Pour MVP on garde text — l'app garantit la cohérence.

- [ ] **Step 2 : Modifier `packBindings` pour ajouter `branchName`**

Trouver le bloc `export const packBindings = pgTable("pack_bindings", { ... });` et ajouter le champ + adapter l'index unique :

```ts
export const packBindings = pgTable("pack_bindings", {
  id: text("id").primaryKey(),
  serverKeyId: text("server_key_id").notNull().references(() => serverKeys.id, { onDelete: "cascade" }),
  packId: text("pack_id").notNull().references(() => packs.id, { onDelete: "cascade" }),
  branchName: text("branch_name").notNull().default("main"),
  createdAt: timestamp("created_at").notNull(),
}, (t) => [
  uniqueIndex("pack_bindings_uniq").on(t.serverKeyId, t.packId, t.branchName),
  index("pack_bindings_pack_idx").on(t.packId),
  index("pack_bindings_serverkey_idx").on(t.serverKeyId),
]);
```

Note : l'ancien `uniqueIndex("pack_bindings_uniq").on(serverKeyId, packId)` devient `(serverKeyId, packId, branchName)`. Cela permet à un même server_key d'être bindé au même pack sur des branches différentes (cas d'usage rare mais possible).

- [ ] **Step 3 : Commit**

```bash
cd "C:/Users/ibane/Documents/Minecraft/Plugins/Artisan" && git add backend/src/db/schema.ts && git commit -m "feat(backend): tables pack_commits + pack_branches + packBindings.branchName"
```

---

### Task A2 : `commitStorage.ts` (TDD)

**Files:**
- Create: `backend/src/lib/commitStorage.ts`
- Test: `backend/src/lib/commitStorage.test.ts`

- [ ] **Step 1 : Test**

```ts
// backend/src/lib/commitStorage.test.ts
import { describe, it, expect, beforeEach } from "bun:test";
import { db } from "../db/index";
import { packCommits, packs, networks, users } from "../db/schema";
import { eq } from "drizzle-orm";
import {
  createCommit, getCommit, listCommitsByPack, computeContentHash,
} from "./commitStorage";
import { createNetwork } from "./networkManager";
import { createPack } from "./packStorage";

async function seedSetup() {
  await db.delete(packCommits);
  await db.delete(packs);
  await db.delete(networks);
  await db.delete(users);
  const net = await createNetwork("N");
  const pack = await createPack({ networkId: net.id, name: "p" });
  return { networkId: net.id, packId: pack.id };
}

describe("commitStorage", () => {
  it("computeContentHash is deterministic across calls", () => {
    const files = { "a.yaml": "x", "b.yaml": "y" };
    const h1 = computeContentHash(files);
    const h2 = computeContentHash({ "b.yaml": "y", "a.yaml": "x" });  // different key order
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  it("createCommit inserts with cmt_ id and computed contentHash", async () => {
    const { packId } = await seedSetup();
    const cmt = await createCommit({
      packId,
      parentId: null,
      files: { "a.yaml": "x" },
      editor: { id: packId, menus: [] },
      authorUserId: null,
      message: "initial",
    });
    expect(cmt.id).toMatch(/^cmt_[0-9a-f]{12}$/);
    expect(cmt.packId).toBe(packId);
    expect(cmt.parentId).toBeNull();
    expect(cmt.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(cmt.message).toBe("initial");
  });

  it("createCommit returns existing commit when same (packId, contentHash) — dedup", async () => {
    const { packId } = await seedSetup();
    const files = { "a.yaml": "x" };
    const editor = { id: packId, menus: [] };
    const c1 = await createCommit({ packId, parentId: null, files, editor, authorUserId: null, message: "first" });
    const c2 = await createCommit({ packId, parentId: c1.id, files, editor, authorUserId: null, message: "second" });
    expect(c2.id).toBe(c1.id);  // same id = same commit (dedup)
    const rows = await db.select().from(packCommits).where(eq(packCommits.packId, packId));
    expect(rows).toHaveLength(1);
  });

  it("getCommit returns the row or null", async () => {
    const { packId } = await seedSetup();
    const c = await createCommit({ packId, parentId: null, files: { "a": "x" }, editor: null, authorUserId: null, message: "" });
    expect((await getCommit(c.id))?.id).toBe(c.id);
    expect(await getCommit("cmt_nope")).toBeNull();
  });

  it("listCommitsByPack returns commits in reverse chronological order", async () => {
    const { packId } = await seedSetup();
    const a = await createCommit({ packId, parentId: null, files: { "f": "1" }, editor: null, authorUserId: null, message: "a" });
    await new Promise((r) => setTimeout(r, 10));
    const b = await createCommit({ packId, parentId: a.id, files: { "f": "2" }, editor: null, authorUserId: null, message: "b" });
    const list = await listCommitsByPack(packId, 10);
    expect(list.map((c) => c.id)).toEqual([b.id, a.id]);
  });
});
```

- [ ] **Step 2 : Run — expect FAIL**

```bash
cd "C:/Users/ibane/Documents/Minecraft/Plugins/Artisan/backend" && bun test src/lib/commitStorage.test.ts
```

- [ ] **Step 3 : Implement**

```ts
// backend/src/lib/commitStorage.ts
import { and, desc, eq } from "drizzle-orm";
import { createHash } from "crypto";
import { db } from "../db/index";
import { packCommits } from "../db/schema";

export type Commit = typeof packCommits.$inferSelect;

/**
 * Deterministic content hash: SHA-256 of `(key\nvalue\n)*` over sorted keys.
 * Matches the plugin's LocalPushSender.computeHash() so client & server agree.
 */
export function computeContentHash(files: Record<string, string>): string {
  const sb: string[] = [];
  for (const key of Object.keys(files).sort()) {
    sb.push(key, "\n", files[key], "\n");
  }
  return createHash("sha256").update(sb.join("")).digest("hex");
}

export interface CreateCommitInput {
  packId: string;
  parentId: string | null;
  files: Record<string, string>;
  editor: unknown | null;
  authorUserId: string | null;
  message: string;
}

export async function createCommit(input: CreateCommitInput): Promise<Commit> {
  const contentHash = computeContentHash(input.files);

  // Dedup: if a commit with this (packId, contentHash) already exists, return it.
  const existing = await db.select().from(packCommits).where(and(
    eq(packCommits.packId, input.packId),
    eq(packCommits.contentHash, contentHash),
  ));
  if (existing.length > 0) return existing[0];

  const id = "cmt_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  const filesJson = JSON.stringify(input.files);
  const editorJson = input.editor ? JSON.stringify(input.editor) : null;
  const now = new Date();
  await db.insert(packCommits).values({
    id,
    packId: input.packId,
    parentId: input.parentId,
    contentHash,
    filesJson,
    editorJson,
    authorUserId: input.authorUserId,
    message: input.message,
    createdAt: now,
  });
  return (await getCommit(id))!;
}

export async function getCommit(id: string): Promise<Commit | null> {
  const rows = await db.select().from(packCommits).where(eq(packCommits.id, id));
  return rows[0] ?? null;
}

export async function listCommitsByPack(packId: string, limit: number): Promise<Commit[]> {
  return await db
    .select()
    .from(packCommits)
    .where(eq(packCommits.packId, packId))
    .orderBy(desc(packCommits.createdAt))
    .limit(limit);
}
```

- [ ] **Step 4 : Run — expect PASS**

- [ ] **Step 5 : Commit**

```bash
git add backend/src/lib/commitStorage.ts backend/src/lib/commitStorage.test.ts
git commit -m "feat(backend): commitStorage (createCommit + getCommit + listCommitsByPack + dedup)"
```

---

### Task A3 : `branchStorage.ts` (TDD)

**Files:**
- Create: `backend/src/lib/branchStorage.ts`
- Test: `backend/src/lib/branchStorage.test.ts`

- [ ] **Step 1 : Test**

```ts
// backend/src/lib/branchStorage.test.ts
import { describe, it, expect, beforeEach } from "bun:test";
import { db } from "../db/index";
import { packBranches, packCommits, packs, networks } from "../db/schema";
import {
  createBranch, getBranch, advanceBranchHead, listBranchesForPack, isAncestor,
} from "./branchStorage";
import { createNetwork } from "./networkManager";
import { createPack } from "./packStorage";
import { createCommit } from "./commitStorage";

async function seedSetup() {
  await db.delete(packBranches);
  await db.delete(packCommits);
  await db.delete(packs);
  await db.delete(networks);
  const net = await createNetwork("N");
  const pack = await createPack({ networkId: net.id, name: "p" });
  const root = await createCommit({
    packId: pack.id, parentId: null, files: { "init": "" }, editor: null,
    authorUserId: null, message: "root",
  });
  return { packId: pack.id, rootCommitId: root.id };
}

describe("branchStorage", () => {
  it("createBranch + getBranch", async () => {
    const { packId, rootCommitId } = await seedSetup();
    await createBranch(packId, "main", rootCommitId);
    const branch = await getBranch(packId, "main");
    expect(branch?.name).toBe("main");
    expect(branch?.headCommitId).toBe(rootCommitId);
  });

  it("createBranch errors on duplicate (packId, name)", async () => {
    const { packId, rootCommitId } = await seedSetup();
    await createBranch(packId, "main", rootCommitId);
    await expect(createBranch(packId, "main", rootCommitId)).rejects.toThrow();
  });

  it("advanceBranchHead updates head + updatedAt", async () => {
    const { packId, rootCommitId } = await seedSetup();
    await createBranch(packId, "main", rootCommitId);
    const second = await createCommit({
      packId, parentId: rootCommitId, files: { "init": "x" }, editor: null,
      authorUserId: null, message: "second",
    });
    await advanceBranchHead(packId, "main", second.id);
    const branch = await getBranch(packId, "main");
    expect(branch?.headCommitId).toBe(second.id);
  });

  it("listBranchesForPack returns all branches", async () => {
    const { packId, rootCommitId } = await seedSetup();
    await createBranch(packId, "main", rootCommitId);
    await createBranch(packId, "dev", rootCommitId);
    const list = await listBranchesForPack(packId);
    expect(list.map((b) => b.name).sort()).toEqual(["dev", "main"]);
  });

  it("isAncestor walks parentId chain", async () => {
    const { packId, rootCommitId } = await seedSetup();
    const c2 = await createCommit({
      packId, parentId: rootCommitId, files: { "x": "1" }, editor: null,
      authorUserId: null, message: "c2",
    });
    const c3 = await createCommit({
      packId, parentId: c2.id, files: { "x": "2" }, editor: null,
      authorUserId: null, message: "c3",
    });
    expect(await isAncestor(rootCommitId, c3.id)).toBe(true);
    expect(await isAncestor(c2.id, c3.id)).toBe(true);
    expect(await isAncestor(c3.id, rootCommitId)).toBe(false);
    expect(await isAncestor(c3.id, c3.id)).toBe(true);  // identity
  });
});
```

- [ ] **Step 2 : Run — expect FAIL**

- [ ] **Step 3 : Implement**

```ts
// backend/src/lib/branchStorage.ts
import { and, eq } from "drizzle-orm";
import { db } from "../db/index";
import { packBranches, packCommits } from "../db/schema";

export type Branch = typeof packBranches.$inferSelect;

export async function createBranch(packId: string, name: string, headCommitId: string): Promise<void> {
  const now = new Date();
  await db.insert(packBranches).values({ packId, name, headCommitId, createdAt: now, updatedAt: now });
}

export async function getBranch(packId: string, name: string): Promise<Branch | null> {
  const rows = await db.select().from(packBranches).where(and(
    eq(packBranches.packId, packId), eq(packBranches.name, name),
  ));
  return rows[0] ?? null;
}

export async function advanceBranchHead(packId: string, name: string, newHeadCommitId: string): Promise<void> {
  await db.update(packBranches).set({
    headCommitId: newHeadCommitId,
    updatedAt: new Date(),
  }).where(and(eq(packBranches.packId, packId), eq(packBranches.name, name)));
}

export async function listBranchesForPack(packId: string): Promise<Branch[]> {
  return await db.select().from(packBranches).where(eq(packBranches.packId, packId));
}

/**
 * True if `ancestorId` is reachable from `descendantId` by walking parent links.
 * Returns true on identity (a commit is its own ancestor). Bounded walk (1000 steps)
 * to defend against accidentally cyclic data.
 */
export async function isAncestor(ancestorId: string, descendantId: string): Promise<boolean> {
  if (ancestorId === descendantId) return true;
  let current: string | null = descendantId;
  for (let step = 0; step < 1000 && current; step++) {
    const rows = await db
      .select({ parentId: packCommits.parentId })
      .from(packCommits)
      .where(eq(packCommits.id, current));
    if (rows.length === 0) return false;
    current = rows[0].parentId;
    if (current === ancestorId) return true;
  }
  return false;
}
```

- [ ] **Step 4 : Run — expect PASS**

- [ ] **Step 5 : Commit**

```bash
git add backend/src/lib/branchStorage.ts backend/src/lib/branchStorage.test.ts
git commit -m "feat(backend): branchStorage (create + advance + list + isAncestor)"
```

---

### Task A4 : Migration script + apply schema

**Files:**
- Create: `backend/scripts/migrate-phase-2.ts`
- Modify: nothing else

- [ ] **Step 1 : Write the migration script**

```ts
// backend/scripts/migrate-phase-2.ts
//
// Idempotent migration: for every existing pack, ensure a root commit
// exists from its current `pack.filesJson` + `pack.editorJson`, and a
// `main` branch points to it. Existing pack_bindings get `branch_name = main`
// (the column default already does this).
//
// Run AFTER schema push.

import { db } from "../src/db/index";
import { packs, packBranches } from "../src/db/schema";
import { createCommit } from "../src/lib/commitStorage";
import { createBranch, getBranch } from "../src/lib/branchStorage";
import { eq } from "drizzle-orm";

async function main() {
  const allPacks = await db.select().from(packs);
  console.log(`[migrate-2] Found ${allPacks.length} packs.`);
  for (const p of allPacks) {
    if (await getBranch(p.id, "main")) {
      console.log(`[migrate-2] ${p.id}: main branch already exists, skipping.`);
      continue;
    }
    const files = JSON.parse(p.filesJson || "{}") as Record<string, string>;
    const editor = p.editorJson ? JSON.parse(p.editorJson) : null;
    const root = await createCommit({
      packId: p.id,
      parentId: null,
      files,
      editor,
      authorUserId: null,
      message: "Initial commit (Phase 2 migration)",
    });
    await createBranch(p.id, "main", root.id);
    console.log(`[migrate-2] ${p.id}: created main branch @ ${root.id}`);
  }
  console.log("[migrate-2] Done.");
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2 : Apply schema + run migration**

```bash
cd "C:/Users/ibane/Documents/Minecraft/Plugins/Artisan/backend" && bun run db:push && bun run scripts/migrate-phase-2.ts
```

Expected : `db:push` applies cleanly (warns about `branch_name` default for existing rows — accept). Migration logs creation per pack.

Verify :
```bash
bun -e "import { db } from './src/db/index'; import { sql } from 'drizzle-orm'; const rs = await db.execute(sql\`SELECT count(*) FROM pack_branches; SELECT count(*) FROM pack_commits; SELECT count(*) FROM pack_bindings WHERE branch_name = 'main'\`); console.log(rs); process.exit(0);"
```

- [ ] **Step 3 : Commit**

```bash
git add backend/scripts/migrate-phase-2.ts
git commit -m "chore(backend): Phase 2 migration script (backfill main branch per pack)"
```

---

### Task A5 : `createPack` auto-creates `main` branch + initial commit

**Files:**
- Modify: `backend/src/lib/packStorage.ts`
- Modify: `backend/src/lib/packStorage.test.ts`

- [ ] **Step 1 : Test**

```ts
// Append to backend/src/lib/packStorage.test.ts:
import { getBranch } from "./branchStorage";
import { packCommits } from "../db/schema";
import { eq } from "drizzle-orm";

it("createPack auto-creates main branch with initial commit", async () => {
  const pack = await createPack({ networkId, name: "auto-branch" });
  const main = await getBranch(pack.id, "main");
  expect(main).not.toBeNull();
  expect(main!.headCommitId).toMatch(/^cmt_/);
  const cmt = (await db.select().from(packCommits).where(eq(packCommits.id, main!.headCommitId)))[0];
  expect(cmt.parentId).toBeNull();
  expect(cmt.message).toBe("Initial commit");
});
```

- [ ] **Step 2 : Run — expect FAIL**

- [ ] **Step 3 : Modify `createPack` in `packStorage.ts`**

```ts
// At the top of packStorage.ts add imports:
import { createCommit } from "./commitStorage";
import { createBranch } from "./branchStorage";

// Modify createPack (after the `await db.insert(packs).values(...)` line, before `return (await getPack(id))!;`):
export async function createPack(input: {
  networkId: string;
  name: string;
  description?: string | null;
  id?: string;
}): Promise<Pack> {
  const id = input.id ?? "pack_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  const now = new Date();
  await db.insert(packs).values({
    id,
    networkId: input.networkId,
    name: input.name,
    description: input.description ?? null,
    hash: "",
    filesJson: "{}",
    editorJson: null,
    deployedEditorJson: null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  });

  // Phase 2: auto-create main branch with an initial empty commit.
  const root = await createCommit({
    packId: id, parentId: null, files: {}, editor: null,
    authorUserId: null, message: "Initial commit",
  });
  await createBranch(id, "main", root.id);

  return (await getPack(id))!;
}
```

- [ ] **Step 4 : Run — expect PASS**

```bash
bun test src/lib/packStorage.test.ts
```

- [ ] **Step 5 : Commit**

```bash
git add backend/src/lib/packStorage.ts backend/src/lib/packStorage.test.ts
git commit -m "feat(backend): createPack auto-creates main branch + initial commit"
```

---

## Section B — Backend: REST API for branches + commits

### Task B1 : `userBranchesRouter` — GET list branches + GET list commits

**Files:**
- Create: `backend/src/routes/userBranches.ts`
- Test: `backend/src/routes/userBranches.test.ts`

The router mounts at `/api/networks/:networkId/packs/:packId` (gated by `userAuth()` + membership check on the network).

- [ ] **Step 1 : Test**

```ts
// backend/src/routes/userBranches.test.ts
import { beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { db } from "../db/index";
import {
  memberships, networks, packs, packBindings, serverKeys,
  editorSessions, linkCodes, packCommits, packBranches, assets,
  users, userSessions,
} from "../db/schema";
import { userBranchesRouter } from "./userBranches";
import { userAuth } from "../middleware/userAuth";
import { createSession } from "../lib/sessionManager";
import { createNetwork } from "../lib/networkManager";
import { addMembership } from "../lib/membershipManager";
import { createPack } from "../lib/packStorage";

async function clearAll() {
  await db.delete(packBindings);
  await db.delete(packBranches);
  await db.delete(packCommits);
  await db.delete(assets);
  await db.delete(packs);
  await db.delete(editorSessions);
  await db.delete(linkCodes);
  await db.delete(serverKeys);
  await db.delete(memberships);
  await db.delete(networks);
  await db.delete(userSessions);
  await db.delete(users);
}

async function seedUserWithPack(userId = "u1") {
  await db.insert(users).values({
    id: userId, email: `${userId}@a.b`, name: userId, passwordHash: null, avatarUrl: null,
    createdAt: new Date(), updatedAt: new Date(),
  });
  const sess = await createSession(userId);
  const net = await createNetwork("N");
  await addMembership(userId, net.id, "owner");
  const pack = await createPack({ networkId: net.id, name: "p" });
  return { userId, sessionId: sess.id, networkId: net.id, packId: pack.id };
}

function makeApp() {
  const app = new Hono();
  app.use("/api/networks/*", userAuth());
  app.route("/api/networks", userBranchesRouter);
  return app;
}

describe("userBranchesRouter — GET branches + commits", () => {
  beforeEach(clearAll);

  test("GET /:netId/packs/:packId/branches returns main after createPack", async () => {
    const { sessionId, networkId, packId } = await seedUserWithPack();
    const app = makeApp();
    const res = await app.request(`/api/networks/${networkId}/packs/${packId}/branches`, {
      headers: { Cookie: `artisan_user_session=${sessionId}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.branches).toHaveLength(1);
    expect(body.branches[0].name).toBe("main");
  });

  test("GET /:netId/packs/:packId/commits?branch=main returns the initial commit", async () => {
    const { sessionId, networkId, packId } = await seedUserWithPack();
    const app = makeApp();
    const res = await app.request(`/api/networks/${networkId}/packs/${packId}/commits?branch=main`, {
      headers: { Cookie: `artisan_user_session=${sessionId}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.commits).toHaveLength(1);
    expect(body.commits[0].message).toBe("Initial commit");
  });

  test("GET branches 403 when not member", async () => {
    const { networkId, packId } = await seedUserWithPack("uA");
    await db.insert(users).values({
      id: "uB", email: "uB@a.b", name: "uB", passwordHash: null, avatarUrl: null,
      createdAt: new Date(), updatedAt: new Date(),
    });
    const sessB = (await createSession("uB")).id;
    const app = makeApp();
    const res = await app.request(`/api/networks/${networkId}/packs/${packId}/branches`, {
      headers: { Cookie: `artisan_user_session=${sessB}` },
    });
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2 : Run — expect FAIL**

- [ ] **Step 3 : Implement**

```ts
// backend/src/routes/userBranches.ts
import { Hono } from "hono";
import type { Context } from "hono";
import { listBranchesForPack } from "../lib/branchStorage";
import { listCommitsByPack } from "../lib/commitStorage";
import { requireMember } from "../lib/membershipGuard";
import { db } from "../db/index";
import { packs } from "../db/schema";
import { eq } from "drizzle-orm";

type Vars = { user: { id: string } | null };

function getUserId(c: Context<{ Variables: Vars }>): string | null {
  return c.get("user")?.id ?? null;
}

async function checkAccess(
  c: Context<{ Variables: Vars }>,
  networkId: string,
  packId: string,
): Promise<{ ok: true } | { ok: false; status: 401 | 403 | 404 }> {
  const userId = getUserId(c);
  if (!userId) return { ok: false, status: 401 };
  try { await requireMember(userId, networkId); }
  catch { return { ok: false, status: 403 }; }
  const packRows = await db.select({ networkId: packs.networkId }).from(packs).where(eq(packs.id, packId));
  if (packRows.length === 0 || packRows[0].networkId !== networkId) return { ok: false, status: 404 };
  return { ok: true };
}

export const userBranchesRouter = new Hono<{ Variables: Vars }>();

userBranchesRouter.get("/:id/packs/:packId/branches", async (c) => {
  const access = await checkAccess(c, c.req.param("id"), c.req.param("packId"));
  if (!access.ok) return c.json({ error: "denied" }, access.status);
  const list = await listBranchesForPack(c.req.param("packId"));
  return c.json({ branches: list });
});

userBranchesRouter.get("/:id/packs/:packId/commits", async (c) => {
  const access = await checkAccess(c, c.req.param("id"), c.req.param("packId"));
  if (!access.ok) return c.json({ error: "denied" }, access.status);
  // `branch` filter is currently informational only (commits aren't physically per-branch).
  const _branch = c.req.query("branch");
  const limit = Math.min(parseInt(c.req.query("limit") ?? "50", 10), 200);
  const list = await listCommitsByPack(c.req.param("packId"), limit);
  return c.json({ commits: list });
});
```

> Note : the `?branch=` query is accepted but ignored for now — `listCommitsByPack` returns all commits of the pack regardless of branch (commits exist in a pool, branches are pointers). Branch-aware filtering (only commits reachable from branch.head) can be added later; for the MVP UI this is enough.

- [ ] **Step 4 : Mount in `app.ts`**

```ts
// backend/src/app.ts — after userPacksRouter mount:
import { userBranchesRouter } from "./routes/userBranches";
app.use("/api/networks/*", userAuth());   // already mounted, this is idempotent
app.route("/api/networks", userBranchesRouter);
```

(If the userAuth mount is already there for `userNetworksRouter`, do not duplicate it. Just add the `app.route` line.)

- [ ] **Step 5 : Run — expect PASS**

- [ ] **Step 6 : Commit**

```bash
git add backend/src/routes/userBranches.ts backend/src/routes/userBranches.test.ts backend/src/app.ts
git commit -m "feat(backend): GET /api/networks/:id/packs/:packId/branches + /commits"
```

---

### Task B2 : POST `/branches` (create a branch from another)

**Files:**
- Modify: `backend/src/routes/userBranches.ts`
- Modify: `backend/src/routes/userBranches.test.ts`

- [ ] **Step 1 : Test**

```ts
test("POST /branches creates a new branch from an existing branch", async () => {
  const { sessionId, networkId, packId } = await seedUserWithPack();
  const app = makeApp();
  const res = await app.request(`/api/networks/${networkId}/packs/${packId}/branches`, {
    method: "POST",
    headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "dev", from: "main" }),
  });
  expect(res.status).toBe(201);
  const body = await res.json();
  expect(body.branch.name).toBe("dev");
  // dev should point to the same head commit as main initially
  const branchesRes = await app.request(`/api/networks/${networkId}/packs/${packId}/branches`, {
    headers: { Cookie: `artisan_user_session=${sessionId}` },
  });
  const { branches } = await branchesRes.json();
  const main = branches.find((b: { name: string }) => b.name === "main");
  const dev = branches.find((b: { name: string }) => b.name === "dev");
  expect(dev.headCommitId).toBe(main.headCommitId);
});

test("POST /branches 422 when name missing or invalid", async () => {
  const { sessionId, networkId, packId } = await seedUserWithPack();
  const app = makeApp();
  const res = await app.request(`/api/networks/${networkId}/packs/${packId}/branches`, {
    method: "POST",
    headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "", from: "main" }),
  });
  expect(res.status).toBe(422);
});

test("POST /branches 409 when name already exists", async () => {
  const { sessionId, networkId, packId } = await seedUserWithPack();
  const app = makeApp();
  await app.request(`/api/networks/${networkId}/packs/${packId}/branches`, {
    method: "POST",
    headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "dev", from: "main" }),
  });
  const res = await app.request(`/api/networks/${networkId}/packs/${packId}/branches`, {
    method: "POST",
    headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "dev", from: "main" }),
  });
  expect(res.status).toBe(409);
});
```

- [ ] **Step 2 : Run — expect FAIL**

- [ ] **Step 3 : Implement (append to userBranches.ts)**

```ts
import { createBranch, getBranch } from "../lib/branchStorage";

const BRANCH_NAME_RE = /^[a-zA-Z0-9_\-./]+$/;

userBranchesRouter.post("/:id/packs/:packId/branches", async (c) => {
  const access = await checkAccess(c, c.req.param("id"), c.req.param("packId"));
  if (!access.ok) return c.json({ error: "denied" }, access.status);
  const packId = c.req.param("packId");

  let body: { name?: unknown; from?: unknown };
  try { body = await c.req.json(); } catch { return c.json({ error: "invalid_body" }, 400); }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const from = typeof body.from === "string" ? body.from.trim() : "main";
  if (name.length === 0 || !BRANCH_NAME_RE.test(name)) {
    return c.json({ error: "invalid_name" }, 422);
  }

  if (await getBranch(packId, name)) {
    return c.json({ error: "branch_exists" }, 409);
  }
  const source = await getBranch(packId, from);
  if (!source) return c.json({ error: "source_branch_not_found" }, 404);

  await createBranch(packId, name, source.headCommitId);
  const created = await getBranch(packId, name);
  return c.json({ branch: created }, 201);
});
```

- [ ] **Step 4 : Run — expect PASS**

- [ ] **Step 5 : Commit**

```bash
git add backend/src/routes/userBranches.ts backend/src/routes/userBranches.test.ts
git commit -m "feat(backend): POST /api/networks/:id/packs/:packId/branches"
```

---

### Task B3 : POST `/commits` (commit WIP onto a branch)

**Files:**
- Modify: `backend/src/routes/userBranches.ts`
- Modify: `backend/src/routes/userBranches.test.ts`

- [ ] **Step 1 : Test**

```ts
test("POST /commits creates commit from current WIP and advances branch head", async () => {
  const { sessionId, networkId, packId, userId } = await seedUserWithPack();

  // First, save some WIP via existing /api/user/packs/:packId PUT
  // (or directly set pack.filesJson via DB for simplicity).
  await db.update(packs).set({
    filesJson: JSON.stringify({ "menus/m.yaml": "id: m" }),
    editorJson: JSON.stringify({ id: packId, menus: [{ id: "m" }] }),
  }).where(eq(packs.id, packId));

  const app = makeApp();
  const res = await app.request(`/api/networks/${networkId}/packs/${packId}/commits`, {
    method: "POST",
    headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
    body: JSON.stringify({ branch: "main", message: "first real commit" }),
  });
  expect(res.status).toBe(201);
  const body = await res.json();
  expect(body.commit.message).toBe("first real commit");

  // Branch head must now point to the new commit
  const branch = await (await import("../lib/branchStorage")).getBranch(packId, "main");
  expect(branch!.headCommitId).toBe(body.commit.id);

  // Author is the logged-in user
  expect(body.commit.authorUserId).toBe(userId);
});

test("POST /commits 404 when branch does not exist", async () => {
  const { sessionId, networkId, packId } = await seedUserWithPack();
  const app = makeApp();
  const res = await app.request(`/api/networks/${networkId}/packs/${packId}/commits`, {
    method: "POST",
    headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
    body: JSON.stringify({ branch: "ghost", message: "x" }),
  });
  expect(res.status).toBe(404);
});
```

- [ ] **Step 2 : Run — expect FAIL**

- [ ] **Step 3 : Implement**

```ts
// backend/src/routes/userBranches.ts — append:
import { advanceBranchHead } from "../lib/branchStorage";
import { createCommit } from "../lib/commitStorage";
import { getPack } from "../lib/packStorage";
import { pushBundleAvailable } from "../ws/hub";

userBranchesRouter.post("/:id/packs/:packId/commits", async (c) => {
  const access = await checkAccess(c, c.req.param("id"), c.req.param("packId"));
  if (!access.ok) return c.json({ error: "denied" }, access.status);
  const packId = c.req.param("packId");

  let body: { branch?: unknown; message?: unknown };
  try { body = await c.req.json(); } catch { return c.json({ error: "invalid_body" }, 400); }
  const branchName = typeof body.branch === "string" ? body.branch : "main";
  const message = typeof body.message === "string" ? body.message : "";

  const branch = await getBranch(packId, branchName);
  if (!branch) return c.json({ error: "branch_not_found" }, 404);

  const pack = await getPack(packId);
  if (!pack) return c.json({ error: "pack_not_found" }, 404);

  const files = JSON.parse(pack.filesJson) as Record<string, string>;
  const editor = pack.editorJson ? JSON.parse(pack.editorJson) : null;

  const commit = await createCommit({
    packId,
    parentId: branch.headCommitId,
    files,
    editor,
    authorUserId: getUserId(c),
    message,
  });
  await advanceBranchHead(packId, branchName, commit.id);

  // Broadcast bundle_available to all server_keys bound to (packId, branchName).
  await pushBundleAvailable(packId, branchName, commit.contentHash);

  return c.json({ commit }, 201);
});
```

- [ ] **Step 4 : Run — expect FAIL initially** (pushBundleAvailable signature change is in Task C2 — leave a temp `// TODO(C2)` workaround if needed)

Temporary workaround : if `pushBundleAvailable` still has signature `(packId, hash)`, call it without `branchName` and add a TODO. The B3 test will pass either way.

- [ ] **Step 5 : Commit**

```bash
git add backend/src/routes/userBranches.ts backend/src/routes/userBranches.test.ts
git commit -m "feat(backend): POST /api/networks/:id/packs/:packId/commits"
```

---

### Task B4 : POST `/branches/:src/promote/:dst` (fast-forward only)

**Files:**
- Modify: `backend/src/routes/userBranches.ts`
- Modify: `backend/src/routes/userBranches.test.ts`

- [ ] **Step 1 : Test**

```ts
test("POST /branches/:src/promote/:dst advances dst to src.head when FF", async () => {
  const { sessionId, networkId, packId } = await seedUserWithPack();
  const app = makeApp();

  // Create dev branch (= main head)
  await app.request(`/api/networks/${networkId}/packs/${packId}/branches`, {
    method: "POST",
    headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "dev", from: "main" }),
  });

  // Update WIP + commit on dev (so dev.head > main.head in parent chain)
  await db.update(packs).set({
    filesJson: JSON.stringify({ "menus/m.yaml": "id: m\n" }),
  }).where(eq(packs.id, packId));
  await app.request(`/api/networks/${networkId}/packs/${packId}/commits`, {
    method: "POST",
    headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
    body: JSON.stringify({ branch: "dev", message: "dev work" }),
  });

  // Promote dev → main
  const promoteRes = await app.request(`/api/networks/${networkId}/packs/${packId}/branches/dev/promote/main`, {
    method: "POST",
    headers: { Cookie: `artisan_user_session=${sessionId}` },
  });
  expect(promoteRes.status).toBe(200);

  // main.head should now equal dev.head
  const { getBranch } = await import("../lib/branchStorage");
  const main = await getBranch(packId, "main");
  const dev = await getBranch(packId, "dev");
  expect(main!.headCommitId).toBe(dev!.headCommitId);
});

test("POST /branches/.../promote/... 409 when dst has diverged (not fast-forward)", async () => {
  const { sessionId, networkId, packId } = await seedUserWithPack();
  const app = makeApp();
  await app.request(`/api/networks/${networkId}/packs/${packId}/branches`, {
    method: "POST",
    headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "dev", from: "main" }),
  });

  // Commit on dev
  await db.update(packs).set({ filesJson: JSON.stringify({ "f": "dev" }) }).where(eq(packs.id, packId));
  await app.request(`/api/networks/${networkId}/packs/${packId}/commits`, {
    method: "POST",
    headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
    body: JSON.stringify({ branch: "dev", message: "dev1" }),
  });

  // Commit on main (separately)
  await db.update(packs).set({ filesJson: JSON.stringify({ "f": "main" }) }).where(eq(packs.id, packId));
  await app.request(`/api/networks/${networkId}/packs/${packId}/commits`, {
    method: "POST",
    headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
    body: JSON.stringify({ branch: "main", message: "main1" }),
  });

  // Now promote dev → main : not FF
  const res = await app.request(`/api/networks/${networkId}/packs/${packId}/branches/dev/promote/main`, {
    method: "POST",
    headers: { Cookie: `artisan_user_session=${sessionId}` },
  });
  expect(res.status).toBe(409);
  const body = await res.json();
  expect(body.error).toMatch(/not_fast_forward/);
});
```

- [ ] **Step 2 : Run — expect FAIL**

- [ ] **Step 3 : Implement**

```ts
// backend/src/routes/userBranches.ts — append:
import { isAncestor } from "../lib/branchStorage";

userBranchesRouter.post("/:id/packs/:packId/branches/:src/promote/:dst", async (c) => {
  const access = await checkAccess(c, c.req.param("id"), c.req.param("packId"));
  if (!access.ok) return c.json({ error: "denied" }, access.status);
  const packId = c.req.param("packId");
  const srcName = c.req.param("src");
  const dstName = c.req.param("dst");
  if (srcName === dstName) return c.json({ error: "same_branch" }, 400);

  const src = await getBranch(packId, srcName);
  const dst = await getBranch(packId, dstName);
  if (!src || !dst) return c.json({ error: "branch_not_found" }, 404);

  // Fast-forward check: dst.head must be an ancestor of src.head.
  if (!(await isAncestor(dst.headCommitId, src.headCommitId))) {
    return c.json({ error: "not_fast_forward" }, 409);
  }
  if (src.headCommitId === dst.headCommitId) {
    return c.json({ ok: true, advanced: false });
  }

  await advanceBranchHead(packId, dstName, src.headCommitId);
  // Broadcast to bound server_keys of (packId, dstName)
  const newHead = await (await import("../lib/commitStorage")).getCommit(src.headCommitId);
  if (newHead) await pushBundleAvailable(packId, dstName, newHead.contentHash);

  return c.json({ ok: true, advanced: true });
});
```

- [ ] **Step 4 : Run — expect PASS**

- [ ] **Step 5 : Commit**

```bash
git add backend/src/routes/userBranches.ts backend/src/routes/userBranches.test.ts
git commit -m "feat(backend): POST .../branches/:src/promote/:dst (fast-forward only)"
```

---

## Section C — Backend: hub.ts + bundles.ts adaptations

### Task C1 : `pushBundleAvailable` signature evolves to `(packId, branchName, contentHash)`

**Files:**
- Modify: `backend/src/ws/hub.ts`
- Modify: `backend/src/ws/hub.test.ts`
- Modify: `backend/src/routes/userBranches.ts` (drop temp workaround if any)
- Modify: `backend/src/routes/userPacks.ts` (don't broadcast on WIP save — see C2)

- [ ] **Step 1 : Modify `pushBundleAvailable` in `hub.ts`**

Locate the function. Replace its signature and resolver :

```ts
export async function pushBundleAvailable(
  packId: string,
  branchName: string,
  contentHash: string,
): Promise<void> {
  // Find all (server_key, branch) bindings that point to (packId, branchName).
  const targets = await db
    .select({ serverKeyId: packBindings.serverKeyId })
    .from(packBindings)
    .where(and(eq(packBindings.packId, packId), eq(packBindings.branchName, branchName)));
  if (targets.length === 0) return;

  const url = `${BUNDLE_BASE_URL}/api/bundles/${packId}?branch=${encodeURIComponent(branchName)}`;
  const payload = JSON.stringify({
    type: "bundle_available",
    pack_id: packId,
    url,
    hash: contentHash,
    signature: "",
  } satisfies BundleAvailableMessage);

  const targetSet = new Set(targets.map((t) => t.serverKeyId));
  for (const [connId, sId] of connToServerId) {
    if (!targetSet.has(sId)) continue;
    const send = connSenders.get(connId);
    if (send) send(payload);
  }
}
```

Adjust imports: `packBindings` table, `and`/`eq` from drizzle-orm.

- [ ] **Step 2 : Update all call sites**

Grep for `pushBundleAvailable(` in `backend/src/` :
```bash
grep -rn "pushBundleAvailable(" backend/src/
```

For each call site, supply the 3-arg form. Specifically:
- `backend/src/routes/editorSession.ts` (deploy handler) : was `pushBundleAvailable(packId, hash)`. The deploy endpoint should be deprecated in Phase 2 (replaced by commit) — wrap the call with branch resolution : look up the binding's branch_name OR default to "main" :
  ```ts
  await pushBundleAvailable(packId, "main", hash);
  ```
- `backend/src/routes/userPacks.ts` (PUT handler) : remove the call entirely (WIP save no longer broadcasts).
- `backend/src/routes/userBranches.ts` (commits + promote) : already uses 3-arg per B3/B4.

- [ ] **Step 3 : Update `hub.test.ts`**

Adapt existing tests that call `pushBundleAvailable(packId, hash)` to use the 3-arg form. Some tests may need a new fixture with `branchName: "main"` on the binding (the column default handles this if you don't override).

- [ ] **Step 4 : Update `protocol.ts` if needed**

`BundleAvailableMessage` already has `pack_id`, `url`, `hash`, `signature`. The new `?branch=` param in the URL is transparent to the message shape. Confirm no change to `protocol.ts`.

- [ ] **Step 5 : Run**

```bash
cd backend && bun test --isolate src/ws/hub.test.ts src/routes/userBranches.test.ts src/routes/userPacks.test.ts src/routes/editorSession.test.ts
```

Expected : all green.

- [ ] **Step 6 : Commit**

```bash
git add backend/src/ws/hub.ts backend/src/ws/hub.test.ts backend/src/routes/userBranches.ts backend/src/routes/userPacks.ts backend/src/routes/editorSession.ts
git commit -m "refactor(backend): pushBundleAvailable signature → (packId, branchName, contentHash)"
```

---

### Task C2 : `hello_ack.pack_hashes` returns branch.head.contentHash

**Files:**
- Modify: `backend/src/ws/hub.ts`
- Modify: `backend/src/ws/hub.test.ts`

- [ ] **Step 1 : Modify the `hello` handler in `hub.ts`**

Locate the block that builds `packHashesMap`. Currently it iterates `boundPacks` (from `listPacksForServerKey`) and uses `pack.hash`. Replace with branch-aware lookup :

```ts
// After: const boundPacks = await listPacksForServerKey(keyId);
// Replace the pack_hashes computation:

// Get each binding's (packId, branchName) and look up the branch's head commit.
const bindings = await db
  .select({ packId: packBindings.packId, branchName: packBindings.branchName })
  .from(packBindings)
  .where(eq(packBindings.serverKeyId, keyId));

const packHashesMap: Record<string, string> = {};
for (const b of bindings) {
  const branch = await db.select().from(packBranches).where(and(
    eq(packBranches.packId, b.packId), eq(packBranches.name, b.branchName),
  ));
  if (branch.length === 0) continue;
  const cmt = await db.select({ contentHash: packCommits.contentHash })
    .from(packCommits)
    .where(eq(packCommits.id, branch[0].headCommitId));
  if (cmt.length === 0) continue;
  packHashesMap[b.packId] = cmt[0].contentHash;
}
```

Drop the references to `boundPacks` for hash computation (still useful for the `bundle_available` push loop — keep that).

- [ ] **Step 2 : Modify the `push` array (bundle_available on needsSync)**

```ts
if (needsSync) {
  for (const [packId, hash] of Object.entries(packHashesMap)) {
    const binding = bindings.find((b) => b.packId === packId);
    if (!binding) continue;
    const available: BundleAvailableMessage = {
      type: "bundle_available",
      pack_id: packId,
      url: `${BUNDLE_BASE_URL}/api/bundles/${packId}?branch=${encodeURIComponent(binding.branchName)}`,
      hash,
      signature: "",
    };
    push.push(JSON.stringify(available));
  }
}
```

- [ ] **Step 3 : Add imports**

```ts
import { packBranches, packCommits, packBindings } from "../db/schema";
```

(packBindings may already be there.)

- [ ] **Step 4 : Update hub.test.ts**

Add a new test :
```ts
test("hello_ack pack_hashes uses branch head commit content hash (not pack.hash)", async () => {
  // ... setup: create network + server_key + pack + bind to "main" branch.
  // Initial commit content hash is X. pack.hash is "" or different.
  // Send hello.
  // Assert ack.pack_hashes[packId] === X (not pack.hash).
});
```

(Reuse existing `seedServerKey` + `seedBoundPack` helpers ; explicitly fetch the branch head's content hash for the assertion.)

- [ ] **Step 5 : Run + commit**

```bash
cd backend && bun test --isolate src/ws/hub.test.ts
git add backend/src/ws/hub.ts backend/src/ws/hub.test.ts
git commit -m "refactor(backend): hello_ack.pack_hashes resolves via branch → commit"
```

---

### Task C3 : `GET /api/bundles/:packId` serves branch's head commit content

**Files:**
- Modify: `backend/src/routes/bundles.ts`
- Modify: `backend/src/routes/bundles.test.ts`

- [ ] **Step 1 : Test**

```ts
// Append a test to bundles.test.ts:
test("GET /api/bundles/:packId serves the bound branch's head commit content", async () => {
  // Setup: seed server_key, create network + pack (auto creates main branch).
  // Bind server_key to (pack, "main").
  // Run a commit via createCommit + advanceBranchHead OR via REST.
  // GET /api/bundles/:packId with server_key Authorization header.
  // Expect res.body.files == the commit's filesJson contents.
});
```

(Concretely: use the in-test `createCommit` + `advanceBranchHead` from lib helpers, then assert the GET response.)

- [ ] **Step 2 : Modify the handler**

```ts
// backend/src/routes/bundles.ts — GET handler:
bundlesRouter.get("/:packId", async (c) => {
  const serverKeyId = await validateServerKeyHeader(c);
  if (!serverKeyId) return c.json({ error: "Unauthorized" }, 401);
  const packId = c.req.param("packId");

  // Resolve: server_key → binding → branch → head commit
  const binding = (await db.select().from(packBindings).where(and(
    eq(packBindings.serverKeyId, serverKeyId),
    eq(packBindings.packId, packId),
  )))[0];
  if (!binding) return c.json({ error: "Not bound" }, 404);

  const branch = (await db.select().from(packBranches).where(and(
    eq(packBranches.packId, packId), eq(packBranches.name, binding.branchName),
  )))[0];
  if (!branch) return c.json({ error: "Branch not found" }, 404);

  const commit = (await db.select().from(packCommits).where(eq(packCommits.id, branch.headCommitId)))[0];
  if (!commit) return c.json({ error: "Commit not found" }, 500);

  return c.json({
    hash: commit.contentHash,
    files: JSON.parse(commit.filesJson) as Record<string, string>,
  });
});
```

Add imports : `packBranches`, `packCommits`, `and`, `eq`.

- [ ] **Step 3 : Modify the POST handler accordingly**

The POST handler currently calls `pushBundleAvailable(packId, hash)`. Phase 2 says : plugin pushes raw files via `local_push` WS message, not REST. The REST POST is legacy. Either:
- (a) Keep it as a WIP write (update `pack.filesJson` only, do not broadcast, do not commit).
- (b) Deprecate / remove it.

Choice : **option (a)** for backward compat (some test helpers use it). Skip the broadcast.

```ts
// backend/src/routes/bundles.ts — POST handler:
bundlesRouter.post("/:packId", async (c) => {
  const serverKeyId = await validateServerKeyHeader(c);
  if (!serverKeyId) return c.json({ error: "Unauthorized" }, 401);
  const packId = c.req.param("packId");

  const body = await c.req.json<{ files: Record<string, string> }>();
  const hash = await computeBundleHash(body.files, packId);

  const sk = (await db.select().from(serverKeys).where(eq(serverKeys.id, serverKeyId)))[0];
  if (!sk) return c.json({ error: "Server key missing" }, 500);

  let pack = await getPack(packId);
  if (!pack) {
    pack = await createPack({ networkId: sk.networkId, name: packId, id: packId });
  }
  const bound = await listPacksForServerKey(serverKeyId);
  if (!bound.find((p) => p.id === packId)) {
    await createBinding(serverKeyId, packId);  // default branch "main"
  }
  await upsertPackContent(packId, { hash, filesJson: JSON.stringify(body.files) });
  return c.json({ ok: true, hash });
});
```

Note : no `pushBundleAvailable` here in Phase 2. WIP update doesn't notify plugins.

- [ ] **Step 4 : Run + commit**

```bash
cd backend && bun test --isolate src/routes/bundles.test.ts
git add backend/src/routes/bundles.ts backend/src/routes/bundles.test.ts
git commit -m "refactor(backend): GET /api/bundles/:packId serves branch head commit content"
```

---

### Task C4 : Modify POST binding to accept `{branch_name?}` body

**Files:**
- Modify: `backend/src/routes/userNetworks.ts`
- Modify: `backend/src/routes/userNetworks.test.ts`
- Modify: `backend/src/lib/packBindingManager.ts`
- Modify: `backend/src/lib/packBindingManager.test.ts`

- [ ] **Step 1 : Modify `createBinding` to accept an optional `branchName`**

```ts
// backend/src/lib/packBindingManager.ts
export async function createBinding(
  serverKeyId: string,
  packId: string,
  branchName: string = "main",
): Promise<void> {
  const id = "bind_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  await db.insert(packBindings).values({ id, serverKeyId, packId, branchName, createdAt: new Date() });
}
```

Update tests in `packBindingManager.test.ts` : add a test that `createBinding(sk, p, "dev")` stores `branchName: "dev"`.

- [ ] **Step 2 : Update `userNetworks.ts` POST binding to accept body**

```ts
userNetworksRouter.post("/:id/packs/:packId/bindings/:serverKeyId", async (c: Context<{ Variables: Vars }>) => {
  // ... existing checks ...
  let body: { branch_name?: unknown } = {};
  try { body = await c.req.json(); } catch { /* empty body ok */ }
  const branchName = typeof body.branch_name === "string" ? body.branch_name : "main";

  // Verify the branch exists (otherwise the binding would point to nothing).
  const { getBranch } = await import("../lib/branchStorage");
  if (!(await getBranch(packId, branchName))) {
    return c.json({ error: "branch_not_found" }, 404);
  }

  await createBinding(skId, packId, branchName);
  return c.json({ ok: true }, 201);
});
```

Add test : POST binding with `{branch_name: "dev"}` returns the binding pointing to "dev".

- [ ] **Step 3 : Run + commit**

```bash
cd backend && bun test --isolate src/lib/packBindingManager.test.ts src/routes/userNetworks.test.ts
git add backend/src/lib/packBindingManager.ts backend/src/lib/packBindingManager.test.ts backend/src/routes/userNetworks.ts backend/src/routes/userNetworks.test.ts
git commit -m "feat(backend): POST binding accepts {branch_name?} body (default main)"
```

---

## Section D — Editor: API clients + store

### Task D1 : `lib/api/branches.ts` (TDD)

**Files:**
- Create: `editor/src/lib/api/branches.ts`
- Test: `editor/src/lib/api/branches.test.ts`

- [ ] **Step 1 : Test**

```ts
// editor/src/lib/api/branches.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  listBranches, createBranch, listCommits, createCommit, promoteBranch,
} from "./branches";

describe("branches API client", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("listBranches GET", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({
      branches: [{ packId: "p", name: "main", headCommitId: "cmt_1" }],
    }), { status: 200 }));
    const list = await listBranches("n1", "p1");
    expect(list[0].name).toBe("main");
  });

  it("createBranch POST", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({
      branch: { packId: "p", name: "dev", headCommitId: "cmt_1" },
    }), { status: 201 }));
    const b = await createBranch("n1", "p1", "dev", "main");
    expect(b.name).toBe("dev");
  });

  it("listCommits GET", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({
      commits: [{ id: "cmt_1", message: "x" }],
    }), { status: 200 }));
    const list = await listCommits("n1", "p1", "main", 20);
    expect(list).toHaveLength(1);
  });

  it("createCommit POST", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({
      commit: { id: "cmt_2", message: "hello" },
    }), { status: 201 }));
    const c = await createCommit("n1", "p1", "main", "hello");
    expect(c.id).toBe("cmt_2");
  });

  it("promoteBranch POST", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true, advanced: true }), { status: 200 }));
    const res = await promoteBranch("n1", "p1", "dev", "main");
    expect(res.advanced).toBe(true);
  });

  it("promoteBranch throws on 409 (not fast-forward)", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ error: "not_fast_forward" }), { status: 409 }));
    await expect(promoteBranch("n1", "p1", "dev", "main")).rejects.toThrow(/not_fast_forward/);
  });
});
```

- [ ] **Step 2 : Run — expect FAIL**

- [ ] **Step 3 : Implement**

```ts
// editor/src/lib/api/branches.ts
const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

export interface Branch { packId: string; name: string; headCommitId: string; createdAt: string; updatedAt: string; }
export interface Commit { id: string; packId: string; parentId: string | null; contentHash: string; authorUserId: string | null; message: string; createdAt: string; }

export async function listBranches(networkId: string, packId: string): Promise<Branch[]> {
  const res = await fetch(`${API_URL}/api/networks/${networkId}/packs/${packId}/branches`, { credentials: "include" });
  if (!res.ok) throw new Error(`listBranches failed: ${res.status}`);
  return ((await res.json()) as { branches: Branch[] }).branches;
}

export async function createBranch(networkId: string, packId: string, name: string, from: string): Promise<Branch> {
  const res = await fetch(`${API_URL}/api/networks/${networkId}/packs/${packId}/branches`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, from }),
  });
  if (!res.ok) throw new Error(`createBranch failed: ${res.status}`);
  return ((await res.json()) as { branch: Branch }).branch;
}

export async function listCommits(networkId: string, packId: string, branch: string, limit = 50): Promise<Commit[]> {
  const res = await fetch(`${API_URL}/api/networks/${networkId}/packs/${packId}/commits?branch=${encodeURIComponent(branch)}&limit=${limit}`, { credentials: "include" });
  if (!res.ok) throw new Error(`listCommits failed: ${res.status}`);
  return ((await res.json()) as { commits: Commit[] }).commits;
}

export async function createCommit(networkId: string, packId: string, branch: string, message: string): Promise<Commit> {
  const res = await fetch(`${API_URL}/api/networks/${networkId}/packs/${packId}/commits`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ branch, message }),
  });
  if (!res.ok) throw new Error(`createCommit failed: ${res.status}`);
  return ((await res.json()) as { commit: Commit }).commit;
}

export async function promoteBranch(networkId: string, packId: string, src: string, dst: string): Promise<{ ok: boolean; advanced: boolean }> {
  const res = await fetch(`${API_URL}/api/networks/${networkId}/packs/${packId}/branches/${src}/promote/${dst}`, {
    method: "POST",
    credentials: "include",
  });
  if (res.status === 409) {
    const body = await res.json();
    throw new Error(body.error ?? "not_fast_forward");
  }
  if (!res.ok) throw new Error(`promoteBranch failed: ${res.status}`);
  return res.json();
}
```

- [ ] **Step 4 : Run + commit**

```bash
cd editor && npx vitest run src/lib/api/branches.test.ts
git add editor/src/lib/api/branches.ts editor/src/lib/api/branches.test.ts
git commit -m "feat(editor): API client for branches + commits + promote"
```

---

### Task D2 : `state/branchesStore.ts`

**Files:**
- Create: `editor/src/state/branchesStore.ts`
- Test: `editor/src/state/branchesStore.test.ts`

- [ ] **Step 1 : Test**

```ts
// editor/src/state/branchesStore.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { useBranchesStore } from "./branchesStore";

describe("branchesStore", () => {
  beforeEach(() => useBranchesStore.getState().reset());

  it("setBranches replaces the list and updates currentBranch if missing", () => {
    useBranchesStore.getState().setBranches([
      { packId: "p", name: "main", headCommitId: "c1", createdAt: "", updatedAt: "" },
    ]);
    expect(useBranchesStore.getState().branches).toHaveLength(1);
    expect(useBranchesStore.getState().currentBranch).toBe("main");
  });

  it("setCurrentBranch updates the selection", () => {
    useBranchesStore.getState().setBranches([
      { packId: "p", name: "main", headCommitId: "c1", createdAt: "", updatedAt: "" },
      { packId: "p", name: "dev", headCommitId: "c2", createdAt: "", updatedAt: "" },
    ]);
    useBranchesStore.getState().setCurrentBranch("dev");
    expect(useBranchesStore.getState().currentBranch).toBe("dev");
  });

  it("reset empties state", () => {
    useBranchesStore.getState().setBranches([{ packId: "p", name: "main", headCommitId: "c1", createdAt: "", updatedAt: "" }]);
    useBranchesStore.getState().reset();
    expect(useBranchesStore.getState().branches).toHaveLength(0);
    expect(useBranchesStore.getState().currentBranch).toBeNull();
  });
});
```

- [ ] **Step 2 : Run — expect FAIL**

- [ ] **Step 3 : Implement**

```ts
// editor/src/state/branchesStore.ts
import { create } from "zustand";
import type { Branch } from "@/lib/api/branches";

interface State {
  branches: Branch[];
  currentBranch: string | null;
  setBranches: (b: Branch[]) => void;
  setCurrentBranch: (name: string) => void;
  reset: () => void;
}

export const useBranchesStore = create<State>((set, get) => ({
  branches: [],
  currentBranch: null,
  setBranches: (branches) => {
    const current = get().currentBranch;
    const stillValid = current !== null && branches.some((b) => b.name === current);
    set({
      branches,
      currentBranch: stillValid ? current : (branches[0]?.name ?? null),
    });
  },
  setCurrentBranch: (currentBranch) => set({ currentBranch }),
  reset: () => set({ branches: [], currentBranch: null }),
}));
```

- [ ] **Step 4 : Run + commit**

```bash
cd editor && npx vitest run src/state/branchesStore.test.ts
git add editor/src/state/branchesStore.ts editor/src/state/branchesStore.test.ts
git commit -m "feat(editor): branchesStore (Zustand)"
```

---

## Section E — Editor: UI components

### Task E1 : `BranchSwitcher` dropdown

**Files:**
- Create: `editor/src/features/branches/BranchSwitcher.tsx`
- Test: `editor/src/features/branches/BranchSwitcher.test.tsx`

- [ ] **Step 1 : Test**

```tsx
// editor/src/features/branches/BranchSwitcher.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { BranchSwitcher } from "./BranchSwitcher";
import { useBranchesStore } from "@/state/branchesStore";
import * as branchesApi from "@/lib/api/branches";

describe("BranchSwitcher", () => {
  beforeEach(() => {
    useBranchesStore.getState().reset();
    vi.restoreAllMocks();
  });

  it("fetches branches on mount + selects main by default", async () => {
    vi.spyOn(branchesApi, "listBranches").mockResolvedValue([
      { packId: "p", name: "main", headCommitId: "c1", createdAt: "", updatedAt: "" },
      { packId: "p", name: "dev", headCommitId: "c2", createdAt: "", updatedAt: "" },
    ]);
    render(<BranchSwitcher networkId="n1" packId="p1" />);
    await waitFor(() => expect(useBranchesStore.getState().branches).toHaveLength(2));
    expect(useBranchesStore.getState().currentBranch).toBe("main");
  });

  it("switching the dropdown updates currentBranch", async () => {
    vi.spyOn(branchesApi, "listBranches").mockResolvedValue([
      { packId: "p", name: "main", headCommitId: "c1", createdAt: "", updatedAt: "" },
      { packId: "p", name: "dev", headCommitId: "c2", createdAt: "", updatedAt: "" },
    ]);
    render(<BranchSwitcher networkId="n1" packId="p1" />);
    await waitFor(() => expect(screen.getByRole("combobox")).toBeTruthy());
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "dev" } });
    expect(useBranchesStore.getState().currentBranch).toBe("dev");
  });
});
```

- [ ] **Step 2 : Run — expect FAIL**

- [ ] **Step 3 : Implement**

```tsx
// editor/src/features/branches/BranchSwitcher.tsx
import { useEffect } from "react";
import { useBranchesStore } from "@/state/branchesStore";
import { listBranches } from "@/lib/api/branches";

interface Props { networkId: string; packId: string; }

export function BranchSwitcher({ networkId, packId }: Props) {
  const branches = useBranchesStore((s) => s.branches);
  const currentBranch = useBranchesStore((s) => s.currentBranch);
  const setBranches = useBranchesStore((s) => s.setBranches);
  const setCurrentBranch = useBranchesStore((s) => s.setCurrentBranch);

  useEffect(() => {
    listBranches(networkId, packId).then(setBranches).catch(console.error);
  }, [networkId, packId, setBranches]);

  if (branches.length === 0) return null;
  return (
    <select
      className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs font-mono"
      value={currentBranch ?? ""}
      onChange={(e) => setCurrentBranch(e.target.value)}
    >
      {branches.map((b) => (
        <option key={b.name} value={b.name}>{b.name}</option>
      ))}
    </select>
  );
}
```

- [ ] **Step 4 : Run + commit**

```bash
git add editor/src/features/branches/BranchSwitcher.tsx editor/src/features/branches/BranchSwitcher.test.tsx
git commit -m "feat(editor): BranchSwitcher dropdown"
```

---

### Task E2 : `CommitDialog`

**Files:**
- Create: `editor/src/features/branches/CommitDialog.tsx`
- Test: `editor/src/features/branches/CommitDialog.test.tsx`

- [ ] **Step 1 : Test**

```tsx
// editor/src/features/branches/CommitDialog.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CommitDialog } from "./CommitDialog";
import * as branchesApi from "@/lib/api/branches";

describe("CommitDialog", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("calls createCommit with message + currentBranch on submit", async () => {
    const spy = vi.spyOn(branchesApi, "createCommit").mockResolvedValue({
      id: "cmt_new", packId: "p", parentId: null, contentHash: "", authorUserId: null, message: "", createdAt: "",
    });
    const onClose = vi.fn();
    render(<CommitDialog networkId="n1" packId="p1" branch="main" open onClose={onClose} />);
    fireEvent.change(screen.getByPlaceholderText(/commit message/i), { target: { value: "hello" } });
    fireEvent.click(screen.getByRole("button", { name: /commit/i }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith("n1", "p1", "main", "hello"));
    expect(onClose).toHaveBeenCalled();
  });

  it("disables button when message empty", () => {
    render(<CommitDialog networkId="n1" packId="p1" branch="main" open onClose={() => {}} />);
    expect((screen.getByRole("button", { name: /commit/i }) as HTMLButtonElement).disabled).toBe(true);
  });
});
```

- [ ] **Step 2 : Run — expect FAIL**

- [ ] **Step 3 : Implement**

```tsx
// editor/src/features/branches/CommitDialog.tsx
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { createCommit } from "@/lib/api/branches";

interface Props {
  networkId: string;
  packId: string;
  branch: string;
  open: boolean;
  onClose: () => void;
}

export function CommitDialog({ networkId, packId, branch, open, onClose }: Props) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async () => {
    if (!message.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await createCommit(networkId, packId, branch, message.trim());
      setMessage("");
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Commit on {branch}</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3">
          <Input
            placeholder="Commit message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
          {error && <div className="text-xs text-red-400">{error}</div>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={onSubmit} disabled={busy || !message.trim()}>Commit</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4 : Run + commit**

```bash
git add editor/src/features/branches/CommitDialog.tsx editor/src/features/branches/CommitDialog.test.tsx
git commit -m "feat(editor): CommitDialog"
```

---

### Task E3 : `HistoryPanel`

**Files:**
- Create: `editor/src/features/branches/HistoryPanel.tsx`
- Test: `editor/src/features/branches/HistoryPanel.test.tsx`

- [ ] **Step 1 : Test**

```tsx
// editor/src/features/branches/HistoryPanel.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { HistoryPanel } from "./HistoryPanel";
import * as branchesApi from "@/lib/api/branches";

describe("HistoryPanel", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("lists commits for the branch", async () => {
    vi.spyOn(branchesApi, "listCommits").mockResolvedValue([
      { id: "cmt_2", packId: "p", parentId: "cmt_1", contentHash: "x", authorUserId: "u", message: "second", createdAt: new Date().toISOString() },
      { id: "cmt_1", packId: "p", parentId: null, contentHash: "y", authorUserId: null, message: "initial", createdAt: new Date().toISOString() },
    ]);
    render(<HistoryPanel networkId="n1" packId="p1" branch="main" />);
    await waitFor(() => expect(screen.getByText("second")).toBeTruthy());
    expect(screen.getByText("initial")).toBeTruthy();
  });

  it("shows empty state when no commits", async () => {
    vi.spyOn(branchesApi, "listCommits").mockResolvedValue([]);
    render(<HistoryPanel networkId="n1" packId="p1" branch="main" />);
    await waitFor(() => expect(screen.getByText(/no commits yet/i)).toBeTruthy());
  });
});
```

- [ ] **Step 2 : Run — expect FAIL**

- [ ] **Step 3 : Implement**

```tsx
// editor/src/features/branches/HistoryPanel.tsx
import { useEffect, useState } from "react";
import { listCommits, type Commit } from "@/lib/api/branches";

interface Props { networkId: string; packId: string; branch: string; }

export function HistoryPanel({ networkId, packId, branch }: Props) {
  const [commits, setCommits] = useState<Commit[] | null>(null);

  useEffect(() => {
    listCommits(networkId, packId, branch, 50).then(setCommits).catch(console.error);
  }, [networkId, packId, branch]);

  if (commits === null) return <div className="p-2 text-xs text-muted-foreground">Loading…</div>;
  if (commits.length === 0) return <div className="p-2 text-xs text-muted-foreground">No commits yet</div>;

  return (
    <ul className="flex flex-col gap-1 p-2 text-xs">
      {commits.map((c) => (
        <li key={c.id} className="border-l-2 border-zinc-700 pl-2">
          <div className="font-medium">{c.message || "(no message)"}</div>
          <div className="text-muted-foreground font-mono text-[10px]">
            {c.id.slice(0, 12)} · {new Date(c.createdAt).toLocaleString()}
          </div>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 4 : Run + commit**

```bash
git add editor/src/features/branches/HistoryPanel.tsx editor/src/features/branches/HistoryPanel.test.tsx
git commit -m "feat(editor): HistoryPanel (list of commits)"
```

---

### Task E4 : `PromoteButton`

**Files:**
- Create: `editor/src/features/branches/PromoteButton.tsx`
- Test: `editor/src/features/branches/PromoteButton.test.tsx`

- [ ] **Step 1 : Test**

```tsx
// editor/src/features/branches/PromoteButton.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PromoteButton } from "./PromoteButton";
import * as branchesApi from "@/lib/api/branches";

describe("PromoteButton", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("opens picker + calls promoteBranch on confirm", async () => {
    const spy = vi.spyOn(branchesApi, "promoteBranch").mockResolvedValue({ ok: true, advanced: true });
    render(<PromoteButton networkId="n1" packId="p1" sourceBranch="dev" allBranches={["main", "dev"]} />);
    fireEvent.click(screen.getByRole("button", { name: /promote/i }));
    fireEvent.change(screen.getByLabelText(/target branch/i), { target: { value: "main" } });
    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith("n1", "p1", "dev", "main"));
  });

  it("shows error when 409 not_fast_forward", async () => {
    vi.spyOn(branchesApi, "promoteBranch").mockRejectedValue(new Error("not_fast_forward"));
    render(<PromoteButton networkId="n1" packId="p1" sourceBranch="dev" allBranches={["main", "dev"]} />);
    fireEvent.click(screen.getByRole("button", { name: /promote/i }));
    fireEvent.change(screen.getByLabelText(/target branch/i), { target: { value: "main" } });
    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));
    await waitFor(() => expect(screen.getByText(/not_fast_forward/i)).toBeTruthy());
  });
});
```

- [ ] **Step 2 : Run — expect FAIL**

- [ ] **Step 3 : Implement**

```tsx
// editor/src/features/branches/PromoteButton.tsx
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { promoteBranch } from "@/lib/api/branches";

interface Props {
  networkId: string;
  packId: string;
  sourceBranch: string;
  allBranches: string[];
}

export function PromoteButton({ networkId, packId, sourceBranch, allBranches }: Props) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState(() => allBranches.find((b) => b !== sourceBranch) ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onConfirm = async () => {
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      await promoteBranch(networkId, packId, sourceBranch, target);
      setOpen(false);
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(false); }
  };

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>Promote</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Promote {sourceBranch} →</DialogTitle></DialogHeader>
          <div className="flex flex-col gap-3">
            <label className="text-xs">Target branch
              <select
                aria-label="target branch"
                className="mt-1 w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              >
                <option value="">— choose —</option>
                {allBranches.filter((b) => b !== sourceBranch).map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            </label>
            {error && <div className="text-xs text-red-400">{error}</div>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={onConfirm} disabled={busy || !target}>Confirm</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
```

- [ ] **Step 4 : Run + commit**

```bash
git add editor/src/features/branches/PromoteButton.tsx editor/src/features/branches/PromoteButton.test.tsx
git commit -m "feat(editor): PromoteButton (fast-forward only with error display)"
```

---

### Task E5 : Mount components in `pack.$packId.tsx`

**Files:**
- Modify: `editor/src/routes/pack.$packId.tsx`

- [ ] **Step 1 : Read** the current pack route. Find the header area / toolbar where buttons live.

- [ ] **Step 2 : Add a branch sidebar/header section**

Wrap the existing main content with a new sidebar (right or top — match existing layout). The sidebar contains :
- `<BranchSwitcher networkId={pack.networkId} packId={packId} />`
- `<Button onClick={() => setCommitOpen(true)}>Commit</Button>`
- `<PromoteButton networkId={...} packId={packId} sourceBranch={currentBranch} allBranches={branchNames} />`
- `<HistoryPanel networkId={...} packId={packId} branch={currentBranch} />`

Plus the `<CommitDialog>` mounted conditionally.

Imports :
```tsx
import { useBranchesStore } from "@/state/branchesStore";
import { BranchSwitcher } from "@/features/branches/BranchSwitcher";
import { CommitDialog } from "@/features/branches/CommitDialog";
import { HistoryPanel } from "@/features/branches/HistoryPanel";
import { PromoteButton } from "@/features/branches/PromoteButton";
```

Reads from `useBranchesStore`:
```tsx
const currentBranch = useBranchesStore((s) => s.currentBranch);
const branches = useBranchesStore((s) => s.branches);
const branchNames = branches.map((b) => b.name);
```

> NOTE : the existing pack route is large (~700 lines). Make a **minimal, additive** edit. Don't refactor anything else. If you can't find a clean spot for the sidebar, just add the components vertically stacked above the main canvas.

- [ ] **Step 3 : Manual smoke**

```bash
cd editor && npm run dev
# visit http://localhost:5173/pack/<some-pack-id> as logged-in user
# verify BranchSwitcher, Commit, Promote, HistoryPanel render
```

- [ ] **Step 4 : Commit**

```bash
git add editor/src/routes/pack.\$packId.tsx
git commit -m "feat(editor): mount BranchSwitcher + CommitDialog + HistoryPanel + PromoteButton in pack route"
```

---

## Section F — Wrap-up

### Task F1 : Backend test sweep

- [ ] **Step 1 : Wipe DB + run**

```bash
cd backend && bun -e "import { db } from './src/db/index'; import { editorSessions, packBindings, packBranches, packCommits, packs, assets, serverKeys, networks, linkCodes, memberships, users, userSessions } from './src/db/schema'; await db.delete(packBindings); await db.delete(packBranches); await db.delete(packCommits); await db.delete(assets); await db.delete(packs); await db.delete(editorSessions); await db.delete(linkCodes); await db.delete(serverKeys); await db.delete(memberships); await db.delete(networks); await db.delete(userSessions); await db.delete(users); process.exit(0);"
bun test --isolate
```

Expected : all green.

- [ ] **Step 2 : Fix residuals + commit (if any)**

---

### Task F2 : Editor test sweep

- [ ] **Step 1 : Run**

```bash
cd editor && npx vitest run
```

Expected : all green.

---

### Task F3 : Plugin test sweep (sanity — no plugin changes expected)

- [ ] **Step 1 : Run**

```bash
cd plugin && ./gradlew test
```

Expected : all green (unchanged from Plan 1C).

---

### Task F4 : Docker smoke test (manual)

- [ ] **Step 1 : Apply migration on running container**

```bash
docker compose exec backend bun run db:push
docker compose exec backend bun run scripts/migrate-phase-2.ts
```

- [ ] **Step 2 : End-to-end**

1. Open `http://localhost:5173/pack/<existing-pack-id>` (logged in).
2. Verify `BranchSwitcher` shows `main`.
3. Edit a menu → save (updates WIP).
4. Click "Commit" → enter message → confirm.
5. Verify `HistoryPanel` shows the new commit.
6. Create a `dev` branch (via console or extend UI : POST `/api/networks/:id/packs/:packId/branches` with `{name: "dev", from: "main"}`).
7. Switch to `dev`, edit + commit.
8. Click "Promote → main" → verify advanced.
9. Verify the bound plugin received `bundle_available` after each commit/promote (check MC console logs).

---

### Task F5 : Doc updates

**Files:**
- Modify: `CLAUDE.md` — endpoints, entities section, WS protocol note
- Modify: `.claude/skills/sync-docs/doc-impact-map.yaml`

- [ ] **Step 1 : Update CLAUDE.md**

Add endpoints :
```
| `GET /api/networks/:id/packs/:packId/branches` | Liste les branches du pack. |
| `POST /api/networks/:id/packs/:packId/branches` | Body `{name, from}`. 201 / 409 si existe / 404 si source inconnue. |
| `GET /api/networks/:id/packs/:packId/commits?branch=&limit=` | Liste les commits récents. |
| `POST /api/networks/:id/packs/:packId/commits` | Body `{branch, message}`. Crée un commit depuis le WIP courant + avance la branche + broadcast `bundle_available`. |
| `POST /api/networks/:id/packs/:packId/branches/:src/promote/:dst` | Fast-forward only. 409 `not_fast_forward` si la cible a divergé. |
```

Update `POST /api/networks/:id/packs/:packId/bindings/:serverKeyId` row : "Body `{branch_name?}` (default `\"main\"`). Vérifie que la branche existe avant de créer le binding."

Add to entities section :
- `pack_commits` (id, pack_id, parent_id, content_hash, files_json, editor_json, author_user_id, message, created_at) — snapshot complet, dédup par `(pack_id, content_hash)`.
- `pack_branches` (pack_id, name, head_commit_id) — pointeur vers un commit.
- `pack_bindings.branch_name` (default `"main"`) — un binding cible une branche.
- WIP vs commit : `packs.filesJson/editorJson/hash` reste le buffer éditeur (live preview). Les plugins lisent uniquement les commits via le binding's branch.

Update WS protocol table : note in the `hello_ack.pack_hashes` row that hash = `branch.head_commit.contentHash` (not pack.hash WIP).

- [ ] **Step 2 : Commit**

```bash
git add CLAUDE.md .claude/skills/sync-docs/doc-impact-map.yaml
git commit -m "docs(phase-2): branches + commits endpoints + entities"
```

---

## Self-review checklist

**1. Spec coverage (§8 Phase 2):**
- `pack_branches (pack_id, name, head_commit_hash)` → Task A1 ✓
- `pack_commits (id, pack_id, parent_id, content_hash, author_user_id, message, createdAt)` → Task A1 ✓
- `PackBinding.branch_name` (default `"main"`) → Task A1 + C4 ✓
- Plugin config bind à une branche → covered transparently via packBindings.branch_name (no plugin code change needed) ✓
- Promotion sens unique (fast-forward) → Task B4 ✓
- History view → Task E3 ✓

**2. Decisions locked from brainstorm:**
- Noms arbitraires de branches → enforced by `BRANCH_NAME_RE` regex (B2)
- Snapshot par commit → A2 + dedup logic
- Explicit commit (no auto-commit on save) → only `POST /commits` advances branch; PUT WIP doesn't
- Fast-forward only → B4 explicit `isAncestor` check returning 409

**3. Placeholder scan:**
No "TBD" / "implement later" / "similar to Task N" remaining.

**4. Type consistency:**
- `pushBundleAvailable(packId, branchName, contentHash)` signature locked in C1 ; all callers updated in same task.
- `getBranch(packId, name)` consistent across A3, B2, B3, B4.
- `Commit.contentHash` is the canonical hash everywhere (not `hash`, not `commitId`).

**5. Plugin compatibility:**
- Plugin code unchanged. Existing plugin connects → backend looks up binding's branch → returns head commit content. Transparent to plugin.
- For legacy plugins (Plan 1C-era) still emitting `pack_divergence_detected` to a 1C+ backend, the no-op handler swallows it.

---

## Notes d'exécution

- **Order matters**: A → B → C → D → E → F. Section C touches hub.ts which is shared; do not parallelize with anything WS-related.
- **Migration script** (A4) must run AFTER `db:push` on the docker DB. The smoke test step F4 includes both.
- **`pushBundleAvailable` signature change** (C1) is a breaking refactor — every call site updates in the same commit.
- **Plugin JAR**: no rebuild needed for Phase 2 (plugin code unchanged). But the next time the JAR IS rebuilt (e.g. before Phase 3), make sure the Phase 1C changes are still baked in.
- **No `git push --force`** without explicit confirmation. Plan 2 lands via fast-forward merge to main (same workflow as 1B / 1C).

**Fin du plan.**
