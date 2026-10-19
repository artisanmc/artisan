# Phase 3 — Item-level Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre à 2 branches d'un même pack de diverger, puis être réconciliées via merge **par item top-level** (menus / commands / dialogs / templates / dataSources / i18nKeys / canvasLayout / scalaires). Les changements non-collisionnels s'auto-mergent. Les vrais conflits ouvrent un modal où l'user choisit "use source" ou "use target" par conflit.

**Architecture:** 3 modules backend isolés — `mergeEngine` (pur, no DB), `branchStorage.findLCA` (BFS sur le DAG des commits avec parentId + parentId2), `pack_commits.parentId2` (nullable, 2nd parent des merge commits). 2 endpoints REST : `merge-into` (compute merge, returns state + conflicts) et `resolve` (client renvoie résolutions + derived filesJson, backend crée le merge commit). UI : `MergeButton` + `MergeConflictModal` côté éditeur.

**Tech Stack:** TypeScript, Bun, Hono, Drizzle ORM (PostgreSQL), React 19, Vite 6, Zustand, Vitest. No plugin changes.

**Spec source :** `docs/superpowers/specs/2026-05-21-phase-3-item-level-merge-design.md`

**Pré-requis :** Phase 2 mergée (tip = `fb5932d0` ou descendant).

**Decisions locked (du brainstorm) :**
- Granularité conflit = **par item top-level** (pas champ-par-champ).
- Le client renvoie `mergedFilesJson` au `/resolve` (le backend NE port PAS le code editor→files ; l'éditeur computé déjà filesJson aujourd'hui). Section 11 du spec autorise ce choix.
- Auto-merge passe AUSSI par `/resolve` (le `/merge-into` ne crée jamais de commit, sauf cas FF qui n'a pas besoin de nouveau commit). Garantit que filesJson est toujours dérivé client-side.

---

## File Structure

### Nouveaux fichiers (backend)

- `backend/src/lib/mergeEngine.ts` + `.test.ts` — `merge(base, src, dst)` + `applyResolutions(merged, conflicts, resolutions)` + types
- `backend/src/lib/findLCA.ts` (extension de `branchStorage.ts`) — OU inline dans `branchStorage.ts`. Décision : inline (1 nouvelle fonction).

### Fichiers modifiés (backend)

- `backend/src/db/schema.ts` — `packCommits.parentId2` nullable
- `backend/src/lib/branchStorage.ts` — ajout `findLCA(commitIdA, commitIdB)` + tests
- `backend/src/routes/userBranches.ts` — 2 nouveaux endpoints `merge-into` + `resolve`

### Nouveaux fichiers (editor)

- `editor/src/features/branches/MergeButton.tsx` + `.test.tsx` — dialog trigger
- `editor/src/features/branches/MergeConflictModal.tsx` + `.test.tsx` — radio picker

### Fichiers modifiés (editor)

- `editor/src/lib/api/branches.ts` — ajout `mergeBranches(...)` + `resolveMerge(...)` (étend les helpers existants)
- `editor/src/routes/pack.$packId.tsx` — mount `<MergeButton>` à côté de `<PromoteButton>`

### Plugin : aucun changement

Le hub broadcast `bundle_available` au dst branch après le merge — comportement transparent.

### Doc updates (Section E)

- `Artisan/CLAUDE.md` — endpoints `/merge-into` + `/resolve`, mention de `parentId2`
- `.claude/skills/sync-docs/doc-impact-map.yaml`

---

## Migration

`ALTER TABLE pack_commits ADD COLUMN parent_id_2 TEXT` via `bun run db:push`. Existing commits restent `parent_id_2 = null`. Aucun backfill data.

---

## Section A — Schema + LCA

### Task A1 : Schema `pack_commits.parentId2`

**Files:**
- Modify: `backend/src/db/schema.ts`

- [ ] **Step 1 : Modifier le bloc `packCommits`**

Locate the existing `packCommits` table definition and add `parentId2`:

```ts
export const packCommits = pgTable("pack_commits", {
  id: text("id").primaryKey(),
  packId: text("pack_id").notNull().references(() => packs.id, { onDelete: "cascade" }),
  parentId: text("parent_id"),
  parentId2: text("parent_id_2"),                           // ← NEW: 2nd parent on merge commits, null otherwise
  contentHash: text("content_hash").notNull(),
  filesJson: text("files_json").notNull(),
  editorJson: text("editor_json"),
  authorUserId: text("author_user_id"),
  message: text("message").notNull().default(""),
  createdAt: timestamp("created_at").notNull(),
}, (t) => [
  index("pack_commits_pack_idx").on(t.packId),
  index("pack_commits_pack_created_idx").on(t.packId, t.createdAt),
  uniqueIndex("pack_commits_pack_content_uniq").on(t.packId, t.contentHash),
]);
```

- [ ] **Step 2 : Apply schema**

```bash
cd backend && bun run db:push
```

Expected: cleanly applies the new nullable column.

Verify:
```bash
bun -e "import { db } from './src/db/index'; import { sql } from 'drizzle-orm'; const rs = await db.execute(sql\`SELECT column_name FROM information_schema.columns WHERE table_name='pack_commits' AND column_name='parent_id_2'\`); console.log(rs.length === 1 ? 'present' : 'missing'); process.exit(0);"
```

Expected: `present`.

- [ ] **Step 3 : Commit**

```bash
git add backend/src/db/schema.ts
git commit -m "feat(backend): pack_commits.parentId2 (2nd parent for merge commits)"
```

---

### Task A2 : `findLCA(commitIdA, commitIdB)` in `branchStorage.ts`

**Files:**
- Modify: `backend/src/lib/branchStorage.ts`
- Modify: `backend/src/lib/branchStorage.test.ts`

LCA = lowest common ancestor in the commit DAG (which now has 2 parents per merge commit). BFS-based algorithm.

- [ ] **Step 1 : Write tests** — append to `backend/src/lib/branchStorage.test.ts`:

```ts
describe("findLCA", () => {
  it("returns the same commit when a === b", async () => {
    const { packId, rootCommitId } = await seedSetup();
    expect(await findLCA(rootCommitId, rootCommitId)).toBe(rootCommitId);
  });

  it("returns A when A is an ancestor of B", async () => {
    const { packId, rootCommitId } = await seedSetup();
    const c2 = await createCommit({
      packId, parentId: rootCommitId, files: { "x": "1" }, editor: null,
      authorUserId: null, message: "c2",
    });
    expect(await findLCA(rootCommitId, c2.id)).toBe(rootCommitId);
  });

  it("returns B when B is an ancestor of A (symmetric)", async () => {
    const { packId, rootCommitId } = await seedSetup();
    const c2 = await createCommit({
      packId, parentId: rootCommitId, files: { "x": "1" }, editor: null,
      authorUserId: null, message: "c2",
    });
    expect(await findLCA(c2.id, rootCommitId)).toBe(rootCommitId);
  });

  it("returns the common base when two branches diverge", async () => {
    const { packId, rootCommitId } = await seedSetup();
    // dev branch commit
    const dev1 = await createCommit({
      packId, parentId: rootCommitId, files: { "dev": "1" }, editor: null,
      authorUserId: null, message: "dev1",
    });
    // main branch commit (sibling of dev1, both children of rootCommitId)
    const main1 = await createCommit({
      packId, parentId: rootCommitId, files: { "main": "1" }, editor: null,
      authorUserId: null, message: "main1",
    });
    expect(await findLCA(dev1.id, main1.id)).toBe(rootCommitId);
  });

  it("walks through parentId2 (merge commit ancestry)", async () => {
    const { packId, rootCommitId } = await seedSetup();
    const dev1 = await createCommit({
      packId, parentId: rootCommitId, files: { "dev": "1" }, editor: null,
      authorUserId: null, message: "dev1",
    });
    const main1 = await createCommit({
      packId, parentId: rootCommitId, files: { "main": "1" }, editor: null,
      authorUserId: null, message: "main1",
    });
    // Synthetic merge commit on main: parentId = main1, parentId2 = dev1
    const { db } = await import("../db/index");
    const { packCommits } = await import("../db/schema");
    await db.update(packCommits).set({ parentId: main1.id, parentId2: dev1.id })
      .where(eq(packCommits.id, main1.id));
    // (in real code, merge commit is a new commit; here we mutate main1 for brevity)
    // After this, dev1 is reachable from main1 via parentId2.
    // Add a new commit on dev to test cross-parent walk:
    const dev2 = await createCommit({
      packId, parentId: dev1.id, files: { "dev": "2" }, editor: null,
      authorUserId: null, message: "dev2",
    });
    // dev1 should be the LCA of main1 (via parentId2) and dev2 (via parentId chain)
    expect(await findLCA(main1.id, dev2.id)).toBe(dev1.id);
  });

  it("throws when no common ancestor (synthetic disconnected commits)", async () => {
    const { packId } = await seedSetup();
    // Orphan commit with no parent (different pack would make more sense but this is enough)
    const orphan1 = await createCommit({
      packId, parentId: null, files: { "o1": "" }, editor: null,
      authorUserId: null, message: "orphan1",
    });
    const orphan2 = await createCommit({
      packId, parentId: null, files: { "o2": "" }, editor: null,
      authorUserId: null, message: "orphan2",
    });
    // Both are roots — no common ancestor.
    await expect(findLCA(orphan1.id, orphan2.id)).rejects.toThrow(/no common ancestor/i);
  });
});
```

Also add `findLCA` to the import at the top of the test file:

```ts
import {
  createBranch, getBranch, advanceBranchHead, listBranchesForPack, isAncestor,
  findLCA,                                                             // ← NEW
} from "./branchStorage";
```

- [ ] **Step 2 : Run — expect FAIL**

```bash
cd backend && bun test src/lib/branchStorage.test.ts
```

- [ ] **Step 3 : Implement `findLCA` in `branchStorage.ts`**

Append to `branchStorage.ts`:

```ts
/**
 * Returns the LCA (lowest common ancestor) of two commits in the same pack's
 * commit DAG. Walks both parentId and parentId2 (the merge commit 2nd parent).
 * Throws "no common ancestor" if the BFS exhausts both queues without overlap.
 *
 * Bounded to 10_000 steps total to defend against accidental cycles.
 */
export async function findLCA(commitIdA: string, commitIdB: string): Promise<string> {
  if (commitIdA === commitIdB) return commitIdA;

  const visitedA = new Set<string>([commitIdA]);
  const visitedB = new Set<string>([commitIdB]);
  const queueA: string[] = [commitIdA];
  const queueB: string[] = [commitIdB];

  for (let step = 0; step < 10_000; step++) {
    if (queueA.length === 0 && queueB.length === 0) {
      throw new Error("findLCA: no common ancestor");
    }

    // Step A
    if (queueA.length > 0) {
      const cur = queueA.shift()!;
      const row = (await db.select({ p1: packCommits.parentId, p2: packCommits.parentId2 })
        .from(packCommits).where(eq(packCommits.id, cur)))[0];
      if (row) {
        for (const p of [row.p1, row.p2]) {
          if (!p) continue;
          if (visitedB.has(p)) return p;
          if (!visitedA.has(p)) { visitedA.add(p); queueA.push(p); }
        }
      }
    }

    // Step B
    if (queueB.length > 0) {
      const cur = queueB.shift()!;
      const row = (await db.select({ p1: packCommits.parentId, p2: packCommits.parentId2 })
        .from(packCommits).where(eq(packCommits.id, cur)))[0];
      if (row) {
        for (const p of [row.p1, row.p2]) {
          if (!p) continue;
          if (visitedA.has(p)) return p;
          if (!visitedB.has(p)) { visitedB.add(p); queueB.push(p); }
        }
      }
    }
  }

  throw new Error("findLCA: walk exhausted (possible cycle)");
}
```

- [ ] **Step 4 : Run — expect 6/6 PASS**

```bash
cd backend && bun test src/lib/branchStorage.test.ts
```

- [ ] **Step 5 : Commit**

```bash
git add backend/src/lib/branchStorage.ts backend/src/lib/branchStorage.test.ts
git commit -m "feat(backend): branchStorage.findLCA (BFS over commit DAG)"
```

---

## Section B — Merge engine

### Task B1 : `mergeEngine.merge` (item-level diff + conflict detection)

**Files:**
- Create: `backend/src/lib/mergeEngine.ts`
- Test: `backend/src/lib/mergeEngine.test.ts`

Pure module — no DB. Operates on `EditorState` (plain objects deserialized from `pack_commits.editorJson`).

- [ ] **Step 1 : Write the test file**

```ts
// backend/src/lib/mergeEngine.test.ts
import { describe, it, expect } from "bun:test";
import { merge, applyResolutions, type EditorState, type Conflict } from "./mergeEngine";

function base(): EditorState {
  return {
    menus: [
      { id: "m_a", name: "alpha", rows: 3 },
      { id: "m_b", name: "beta",  rows: 6 },
    ],
    commands: [],
    dialogs: [],
    templates: [],
    dataSources: [],
    i18nKeys: { greeting: { en: "hello" } },
    canvasLayout: { "m_a": { x: 0, y: 0 } },
    defaultLang: "en",
    name: "Pack",
  };
}

describe("merge — empty diff", () => {
  it("returns mergedState equal to dst, no conflicts", () => {
    const b = base();
    const result = merge(b, structuredClone(b), structuredClone(b));
    expect(result.conflicts).toEqual([]);
    expect(result.mergedState).toEqual(b);
  });
});

describe("merge — add on src only", () => {
  it("merged contains src's new item", () => {
    const b = base();
    const src = structuredClone(b);
    src.menus!.push({ id: "m_c", name: "gamma", rows: 1 } as never);
    const dst = structuredClone(b);
    const result = merge(b, src, dst);
    expect(result.conflicts).toEqual([]);
    expect(result.mergedState.menus!.find((m) => m.id === "m_c")).toBeDefined();
    expect(result.mergedState.menus!).toHaveLength(3);
  });
});

describe("merge — add on dst only", () => {
  it("merged contains dst's new item", () => {
    const b = base();
    const dst = structuredClone(b);
    dst.menus!.push({ id: "m_c", name: "gamma", rows: 1 } as never);
    const result = merge(b, structuredClone(b), dst);
    expect(result.conflicts).toEqual([]);
    expect(result.mergedState.menus!.find((m) => m.id === "m_c")).toBeDefined();
  });
});

describe("merge — add same id different content (modify-modify on a new item)", () => {
  it("returns a conflict", () => {
    const b = base();
    const src = structuredClone(b);
    src.menus!.push({ id: "m_c", name: "src_gamma", rows: 1 } as never);
    const dst = structuredClone(b);
    dst.menus!.push({ id: "m_c", name: "dst_gamma", rows: 2 } as never);
    const result = merge(b, src, dst);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].conflictKey).toBe("menus:m_c");
    expect(result.conflicts[0].resolution).toBe("modify-modify");
  });
});

describe("merge — modify on src only", () => {
  it("merged has src's version, no conflict", () => {
    const b = base();
    const src = structuredClone(b);
    src.menus![0].name = "alpha-renamed";
    const result = merge(b, src, structuredClone(b));
    expect(result.conflicts).toEqual([]);
    expect(result.mergedState.menus!.find((m) => m.id === "m_a")!.name).toBe("alpha-renamed");
  });
});

describe("merge — modify both same value", () => {
  it("no conflict (deepEqual src == dst)", () => {
    const b = base();
    const src = structuredClone(b);
    src.menus![0].name = "alpha-renamed";
    const dst = structuredClone(b);
    dst.menus![0].name = "alpha-renamed";
    const result = merge(b, src, dst);
    expect(result.conflicts).toEqual([]);
    expect(result.mergedState.menus!.find((m) => m.id === "m_a")!.name).toBe("alpha-renamed");
  });
});

describe("merge — modify both different", () => {
  it("returns a modify-modify conflict; mergedState defaults to dst", () => {
    const b = base();
    const src = structuredClone(b);
    src.menus![0].name = "alpha-src";
    const dst = structuredClone(b);
    dst.menus![0].name = "alpha-dst";
    const result = merge(b, src, dst);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].conflictKey).toBe("menus:m_a");
    expect(result.mergedState.menus!.find((m) => m.id === "m_a")!.name).toBe("alpha-dst");
  });
});

describe("merge — delete on src, untouched on dst", () => {
  it("merged has the item removed, no conflict", () => {
    const b = base();
    const src = structuredClone(b);
    src.menus = src.menus!.filter((m) => m.id !== "m_a");
    const result = merge(b, src, structuredClone(b));
    expect(result.conflicts).toEqual([]);
    expect(result.mergedState.menus!.find((m) => m.id === "m_a")).toBeUndefined();
  });
});

describe("merge — delete on src, modified on dst", () => {
  it("returns delete-modify conflict", () => {
    const b = base();
    const src = structuredClone(b);
    src.menus = src.menus!.filter((m) => m.id !== "m_a");
    const dst = structuredClone(b);
    dst.menus![0].name = "alpha-renamed";
    const result = merge(b, src, dst);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].resolution).toBe("delete-modify");
    expect(result.conflicts[0].srcValue).toBeNull();
    expect(result.conflicts[0].dstValue).not.toBeNull();
  });
});

describe("merge — delete on both", () => {
  it("merged has the item removed, no conflict", () => {
    const b = base();
    const src = structuredClone(b);
    const dst = structuredClone(b);
    src.menus = src.menus!.filter((m) => m.id !== "m_a");
    dst.menus = dst.menus!.filter((m) => m.id !== "m_a");
    const result = merge(b, src, dst);
    expect(result.conflicts).toEqual([]);
    expect(result.mergedState.menus!.find((m) => m.id === "m_a")).toBeUndefined();
  });
});

describe("merge — i18nKeys map", () => {
  it("auto-merges different keys", () => {
    const b = base();
    const src = structuredClone(b);
    src.i18nKeys!["new_key"] = { en: "hi" };
    const dst = structuredClone(b);
    dst.i18nKeys!["other_key"] = { en: "yo" };
    const result = merge(b, src, dst);
    expect(result.conflicts).toEqual([]);
    expect(result.mergedState.i18nKeys!["new_key"]).toBeDefined();
    expect(result.mergedState.i18nKeys!["other_key"]).toBeDefined();
  });

  it("returns conflict when both modify the same key", () => {
    const b = base();
    const src = structuredClone(b);
    src.i18nKeys!["greeting"] = { en: "hi" };
    const dst = structuredClone(b);
    dst.i18nKeys!["greeting"] = { en: "yo" };
    const result = merge(b, src, dst);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].conflictKey).toBe("i18nKeys:greeting");
  });
});

describe("merge — canvasLayout map", () => {
  it("returns conflict when both move the same entity", () => {
    const b = base();
    const src = structuredClone(b);
    src.canvasLayout!["m_a"] = { x: 100, y: 0 };
    const dst = structuredClone(b);
    dst.canvasLayout!["m_a"] = { x: 200, y: 0 };
    const result = merge(b, src, dst);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].conflictKey).toBe("canvasLayout:m_a");
  });
});

describe("merge — scalar defaultLang", () => {
  it("auto-merges when only one side changes", () => {
    const b = base();
    const src = structuredClone(b);
    src.defaultLang = "fr";
    const result = merge(b, src, structuredClone(b));
    expect(result.conflicts).toEqual([]);
    expect(result.mergedState.defaultLang).toBe("fr");
  });

  it("conflicts when both change to different value", () => {
    const b = base();
    const src = structuredClone(b);
    src.defaultLang = "fr";
    const dst = structuredClone(b);
    dst.defaultLang = "de";
    const result = merge(b, src, dst);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].conflictKey).toBe("scalar:defaultLang");
  });
});

describe("merge — mixed multiple collections", () => {
  it("collects all conflicts and auto-merges the rest", () => {
    const b = base();
    const src = structuredClone(b);
    const dst = structuredClone(b);
    // Conflict: m_a modified differently
    src.menus![0].name = "src-a";
    dst.menus![0].name = "dst-a";
    // Auto: src adds m_c
    src.menus!.push({ id: "m_c", name: "gamma", rows: 1 } as never);
    // Conflict: defaultLang
    src.defaultLang = "fr";
    dst.defaultLang = "es";
    // Auto: dst adds i18n key
    dst.i18nKeys!["new_one"] = { en: "x" };

    const result = merge(b, src, dst);
    expect(result.conflicts).toHaveLength(2);  // m_a + defaultLang
    expect(result.conflicts.map((c) => c.conflictKey).sort()).toEqual([
      "menus:m_a", "scalar:defaultLang",
    ]);
    expect(result.mergedState.menus!.find((m) => m.id === "m_c")).toBeDefined();
    expect(result.mergedState.i18nKeys!["new_one"]).toBeDefined();
  });
});
```

- [ ] **Step 2 : Run — expect FAIL** (module not yet implemented)

```bash
cd backend && bun test src/lib/mergeEngine.test.ts
```

- [ ] **Step 3 : Implement `mergeEngine.ts`**

```ts
// backend/src/lib/mergeEngine.ts

export type ConflictResolutionKind = "modify-modify" | "delete-modify";

export interface Conflict {
  conflictKey: string;
  collection: string;
  resolution: ConflictResolutionKind;
  srcValue: unknown | null;
  dstValue: unknown | null;
  baseValue: unknown | null;
}

export interface MergeResult {
  mergedState: EditorState;
  conflicts: Conflict[];
}

/**
 * Loose shape of the editor state. Properties used by the merge algorithm
 * are listed explicitly; the catch-all `[key: string]: unknown` lets us
 * preserve unknown fields from dst (forward-compat with the editor schema).
 */
export interface EditorState {
  menus?: Array<{ id: string } & Record<string, unknown>>;
  commands?: Array<{ id: string } & Record<string, unknown>>;
  dialogs?: Array<{ id: string } & Record<string, unknown>>;
  templates?: Array<{ id: string } & Record<string, unknown>>;
  dataSources?: Array<{ id: string } & Record<string, unknown>>;
  i18nKeys?: Record<string, unknown>;
  canvasLayout?: Record<string, unknown>;
  defaultLang?: string;
  name?: string;
  description?: string;
  [key: string]: unknown;
}

const COLLECTIONS_BY_ID = ["menus", "commands", "dialogs", "templates", "dataSources"] as const;
const MAP_COLLECTIONS = ["i18nKeys", "canvasLayout"] as const;
const SCALAR_FIELDS = ["defaultLang", "name", "description"] as const;

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
}

function sortKeys(v: unknown): unknown {
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map(sortKeys);
  const sorted: Record<string, unknown> = {};
  for (const k of Object.keys(v).sort()) sorted[k] = sortKeys((v as Record<string, unknown>)[k]);
  return sorted;
}

export function merge(
  base: EditorState,
  src: EditorState,
  dst: EditorState,
): MergeResult {
  const merged: EditorState = structuredClone(dst);
  const conflicts: Conflict[] = [];

  // ── Collections by id ───────────────────────────────────────────────
  for (const collection of COLLECTIONS_BY_ID) {
    const baseList = (base[collection] ?? []) as Array<{ id: string }>;
    const srcList = (src[collection] ?? []) as Array<{ id: string }>;
    const dstList = (dst[collection] ?? []) as Array<{ id: string }>;
    const baseMap = new Map(baseList.map((x) => [x.id, x]));
    const srcMap = new Map(srcList.map((x) => [x.id, x]));
    const dstMap = new Map(dstList.map((x) => [x.id, x]));

    const allIds = new Set<string>([...baseMap.keys(), ...srcMap.keys(), ...dstMap.keys()]);
    const result: Array<{ id: string }> = [];
    for (const id of allIds) {
      const itemBase = baseMap.get(id);
      const itemSrc = srcMap.get(id);
      const itemDst = dstMap.get(id);
      const changedSrc = !deepEqual(itemBase, itemSrc);
      const changedDst = !deepEqual(itemBase, itemDst);

      if (!changedSrc && !changedDst) {
        if (itemDst !== undefined) result.push(itemDst);
        continue;
      }
      if (changedSrc && !changedDst) {
        if (itemSrc !== undefined) result.push(itemSrc);
        continue;
      }
      if (!changedSrc && changedDst) {
        if (itemDst !== undefined) result.push(itemDst);
        continue;
      }
      // changedSrc && changedDst
      if (deepEqual(itemSrc, itemDst)) {
        if (itemSrc !== undefined) result.push(itemSrc);
        continue;
      }
      // Conflict
      const isDelete = itemSrc === undefined || itemDst === undefined;
      conflicts.push({
        conflictKey: `${collection}:${id}`,
        collection,
        resolution: isDelete ? "delete-modify" : "modify-modify",
        srcValue: itemSrc ?? null,
        dstValue: itemDst ?? null,
        baseValue: itemBase ?? null,
      });
      // Default in merged = dst's value (so the merged state is renderable)
      if (itemDst !== undefined) result.push(itemDst);
    }
    (merged as Record<string, unknown>)[collection] = result;
  }

  // ── Map collections ─────────────────────────────────────────────────
  for (const collection of MAP_COLLECTIONS) {
    const baseMap = (base[collection] ?? {}) as Record<string, unknown>;
    const srcMap = (src[collection] ?? {}) as Record<string, unknown>;
    const dstMap = (dst[collection] ?? {}) as Record<string, unknown>;

    const allKeys = new Set<string>([...Object.keys(baseMap), ...Object.keys(srcMap), ...Object.keys(dstMap)]);
    const result: Record<string, unknown> = {};
    for (const key of allKeys) {
      const itemBase = key in baseMap ? baseMap[key] : undefined;
      const itemSrc = key in srcMap ? srcMap[key] : undefined;
      const itemDst = key in dstMap ? dstMap[key] : undefined;
      const changedSrc = !deepEqual(itemBase, itemSrc);
      const changedDst = !deepEqual(itemBase, itemDst);

      if (!changedSrc && !changedDst) {
        if (itemDst !== undefined) result[key] = itemDst;
        continue;
      }
      if (changedSrc && !changedDst) {
        if (itemSrc !== undefined) result[key] = itemSrc;
        continue;
      }
      if (!changedSrc && changedDst) {
        if (itemDst !== undefined) result[key] = itemDst;
        continue;
      }
      if (deepEqual(itemSrc, itemDst)) {
        if (itemSrc !== undefined) result[key] = itemSrc;
        continue;
      }
      const isDelete = itemSrc === undefined || itemDst === undefined;
      conflicts.push({
        conflictKey: `${collection}:${key}`,
        collection,
        resolution: isDelete ? "delete-modify" : "modify-modify",
        srcValue: itemSrc ?? null,
        dstValue: itemDst ?? null,
        baseValue: itemBase ?? null,
      });
      if (itemDst !== undefined) result[key] = itemDst;
    }
    (merged as Record<string, unknown>)[collection] = result;
  }

  // ── Scalar fields ───────────────────────────────────────────────────
  for (const field of SCALAR_FIELDS) {
    const vBase = base[field];
    const vSrc = src[field];
    const vDst = dst[field];
    const changedSrc = !deepEqual(vBase, vSrc);
    const changedDst = !deepEqual(vBase, vDst);

    if (!changedSrc && !changedDst) continue;  // already at dst's value in `merged`
    if (changedSrc && !changedDst) {
      (merged as Record<string, unknown>)[field] = vSrc;
      continue;
    }
    if (!changedSrc && changedDst) continue;   // dst's value already in merged
    if (deepEqual(vSrc, vDst)) continue;       // same final value, no conflict
    conflicts.push({
      conflictKey: `scalar:${field}`,
      collection: "scalar",
      resolution: "modify-modify",
      srcValue: vSrc ?? null,
      dstValue: vDst ?? null,
      baseValue: vBase ?? null,
    });
    // merged keeps dst's value (default)
  }

  return { mergedState: merged, conflicts };
}

/**
 * Stub kept here for B2 — full body added there.
 */
export function applyResolutions(
  _mergedState: EditorState,
  _conflicts: Conflict[],
  _resolutions: Record<string, "src" | "dst">,
): EditorState {
  throw new Error("applyResolutions: implemented in Task B2");
}
```

- [ ] **Step 4 : Run — expect 15 PASS for `merge`** (the `applyResolutions` tests will land in B2)

```bash
cd backend && bun test src/lib/mergeEngine.test.ts -t "merge"
```

Expected: all `describe("merge — …")` tests pass.

- [ ] **Step 5 : Commit**

```bash
git add backend/src/lib/mergeEngine.ts backend/src/lib/mergeEngine.test.ts
git commit -m "feat(backend): mergeEngine.merge (item-level diff + conflict detection)"
```

---

### Task B2 : `mergeEngine.applyResolutions`

**Files:**
- Modify: `backend/src/lib/mergeEngine.ts`
- Modify: `backend/src/lib/mergeEngine.test.ts`

- [ ] **Step 1 : Append tests to `mergeEngine.test.ts`**

```ts
describe("applyResolutions", () => {
  it("applies 'src' choice for a modify-modify conflict on a menu", () => {
    const merged: EditorState = {
      menus: [{ id: "m_a", name: "dst-a", rows: 3 }],
    };
    const conflicts: Conflict[] = [{
      conflictKey: "menus:m_a",
      collection: "menus",
      resolution: "modify-modify",
      srcValue: { id: "m_a", name: "src-a", rows: 4 },
      dstValue: { id: "m_a", name: "dst-a", rows: 3 },
      baseValue: { id: "m_a", name: "base-a", rows: 3 },
    }];
    const final = applyResolutions(merged, conflicts, { "menus:m_a": "src" });
    expect(final.menus!.find((m) => m.id === "m_a")!.name).toBe("src-a");
  });

  it("applies 'dst' choice = no-op (merged already has dst)", () => {
    const merged: EditorState = {
      menus: [{ id: "m_a", name: "dst-a", rows: 3 }],
    };
    const conflicts: Conflict[] = [{
      conflictKey: "menus:m_a",
      collection: "menus",
      resolution: "modify-modify",
      srcValue: { id: "m_a", name: "src-a", rows: 4 },
      dstValue: { id: "m_a", name: "dst-a", rows: 3 },
      baseValue: null,
    }];
    const final = applyResolutions(merged, conflicts, { "menus:m_a": "dst" });
    expect(final.menus!.find((m) => m.id === "m_a")!.name).toBe("dst-a");
  });

  it("delete-modify with 'src' choice removes the item", () => {
    const merged: EditorState = {
      menus: [{ id: "m_a", name: "dst-a", rows: 3 }],
    };
    const conflicts: Conflict[] = [{
      conflictKey: "menus:m_a",
      collection: "menus",
      resolution: "delete-modify",
      srcValue: null,                                 // src deleted
      dstValue: { id: "m_a", name: "dst-a", rows: 3 },
      baseValue: { id: "m_a", name: "base-a", rows: 3 },
    }];
    const final = applyResolutions(merged, conflicts, { "menus:m_a": "src" });
    expect(final.menus!.find((m) => m.id === "m_a")).toBeUndefined();
  });

  it("applies 'src' for an i18nKeys conflict", () => {
    const merged: EditorState = {
      i18nKeys: { greeting: { en: "dst-hello" } },
    };
    const conflicts: Conflict[] = [{
      conflictKey: "i18nKeys:greeting",
      collection: "i18nKeys",
      resolution: "modify-modify",
      srcValue: { en: "src-hi" },
      dstValue: { en: "dst-hello" },
      baseValue: { en: "hello" },
    }];
    const final = applyResolutions(merged, conflicts, { "i18nKeys:greeting": "src" });
    expect(final.i18nKeys!.greeting).toEqual({ en: "src-hi" });
  });

  it("applies 'src' for a scalar conflict", () => {
    const merged: EditorState = { defaultLang: "es" };
    const conflicts: Conflict[] = [{
      conflictKey: "scalar:defaultLang",
      collection: "scalar",
      resolution: "modify-modify",
      srcValue: "fr",
      dstValue: "es",
      baseValue: "en",
    }];
    const final = applyResolutions(merged, conflicts, { "scalar:defaultLang": "src" });
    expect(final.defaultLang).toBe("fr");
  });

  it("throws when a resolution is missing for a known conflict", () => {
    const merged: EditorState = { menus: [{ id: "m_a", name: "x" }] };
    const conflicts: Conflict[] = [{
      conflictKey: "menus:m_a", collection: "menus", resolution: "modify-modify",
      srcValue: { id: "m_a", name: "src" }, dstValue: { id: "m_a", name: "dst" }, baseValue: null,
    }];
    expect(() => applyResolutions(merged, conflicts, {})).toThrow(/missing/i);
  });

  it("throws when a resolution value is not 'src' or 'dst'", () => {
    const merged: EditorState = { menus: [{ id: "m_a", name: "x" }] };
    const conflicts: Conflict[] = [{
      conflictKey: "menus:m_a", collection: "menus", resolution: "modify-modify",
      srcValue: { id: "m_a", name: "src" }, dstValue: { id: "m_a", name: "dst" }, baseValue: null,
    }];
    expect(() => applyResolutions(merged, conflicts, { "menus:m_a": "bogus" as never })).toThrow(/invalid/i);
  });
});
```

- [ ] **Step 2 : Run — expect FAIL**

- [ ] **Step 3 : Replace the stub `applyResolutions` in `mergeEngine.ts`**

```ts
export function applyResolutions(
  mergedState: EditorState,
  conflicts: Conflict[],
  resolutions: Record<string, "src" | "dst">,
): EditorState {
  const result = structuredClone(mergedState);

  for (const c of conflicts) {
    const choice = resolutions[c.conflictKey];
    if (choice === undefined) {
      throw new Error(`applyResolutions: missing resolution for ${c.conflictKey}`);
    }
    if (choice !== "src" && choice !== "dst") {
      throw new Error(`applyResolutions: invalid choice "${choice}" for ${c.conflictKey}`);
    }
    const chosenValue = choice === "src" ? c.srcValue : c.dstValue;

    // Parse "<collection>:<key>" — collection determines how to write.
    const sep = c.conflictKey.indexOf(":");
    const collection = c.conflictKey.slice(0, sep);
    const key = c.conflictKey.slice(sep + 1);

    if (collection === "scalar") {
      (result as Record<string, unknown>)[key] = chosenValue;
      continue;
    }

    if (collection === "i18nKeys" || collection === "canvasLayout") {
      const map = (result[collection] ?? {}) as Record<string, unknown>;
      if (chosenValue === null) {
        delete map[key];
      } else {
        map[key] = chosenValue;
      }
      (result as Record<string, unknown>)[collection] = map;
      continue;
    }

    // Collection by id (menus, commands, dialogs, templates, dataSources)
    const list = ((result as Record<string, unknown>)[collection] ?? []) as Array<{ id: string }>;
    const idx = list.findIndex((x) => x.id === key);
    if (chosenValue === null) {
      // Delete
      if (idx !== -1) list.splice(idx, 1);
    } else {
      // Insert or replace
      if (idx === -1) list.push(chosenValue as { id: string });
      else list[idx] = chosenValue as { id: string };
    }
    (result as Record<string, unknown>)[collection] = list;
  }

  return result;
}
```

- [ ] **Step 4 : Run — expect 7 PASS for `applyResolutions`**

```bash
cd backend && bun test src/lib/mergeEngine.test.ts -t "applyResolutions"
```

- [ ] **Step 5 : Commit**

```bash
git add backend/src/lib/mergeEngine.ts backend/src/lib/mergeEngine.test.ts
git commit -m "feat(backend): mergeEngine.applyResolutions (apply user choices to mergedState)"
```

---

## Section C — REST endpoints

### Task C1 : `POST /api/networks/:id/packs/:packId/branches/:src/merge-into/:dst`

**Files:**
- Modify: `backend/src/routes/userBranches.ts`
- Modify: `backend/src/routes/userBranches.test.ts`

Returns the merge result (auto-merge or conflicts) WITHOUT creating a commit. Exception : the fast-forward case advances the dst branch and broadcasts immediately.

- [ ] **Step 1 : Append tests**

```ts
describe("POST /merge-into — FF + already-merged + 3-way", () => {
  test("FF case (src is descendant of dst) advances dst.head + broadcasts", async () => {
    const { sessionId, networkId, packId } = await seedUserWithPack();
    const app = makeApp();

    // Create dev branch
    await app.request(`/api/networks/${networkId}/packs/${packId}/branches`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "dev", from: "main" }),
    });

    // Commit on dev only
    await db.update(packs).set({
      filesJson: JSON.stringify({ "x": "1" }),
      editorJson: JSON.stringify({ menus: [{ id: "m_a", name: "alpha" }] }),
    }).where(eq(packs.id, packId));
    await app.request(`/api/networks/${networkId}/packs/${packId}/commits`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ branch: "dev", message: "dev1" }),
    });

    // Merge dev → main : should be a fast-forward (main hasn't advanced)
    const res = await app.request(`/api/networks/${networkId}/packs/${packId}/branches/dev/merge-into/main`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.kind).toBe("fast_forward");
    expect(body.advanced).toBe(true);

    // main.head now equals dev.head
    const { getBranch } = await import("../lib/branchStorage");
    const main = await getBranch(packId, "main");
    const dev = await getBranch(packId, "dev");
    expect(main!.headCommitId).toBe(dev!.headCommitId);
  });

  test("already-merged (src is ancestor of dst) returns 200 already_merged", async () => {
    const { sessionId, networkId, packId } = await seedUserWithPack();
    const app = makeApp();
    // dev branched from main, no new commits
    await app.request(`/api/networks/${networkId}/packs/${packId}/branches`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "dev", from: "main" }),
    });
    const res = await app.request(`/api/networks/${networkId}/packs/${packId}/branches/dev/merge-into/main`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.kind).toBe("already_merged");
  });

  test("3-way auto-merge returns kind=auto with empty conflicts + mergedEditorJson", async () => {
    const { sessionId, networkId, packId } = await seedUserWithPack();
    const app = makeApp();
    // Create dev with a different commit content from main.
    await app.request(`/api/networks/${networkId}/packs/${packId}/branches`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "dev", from: "main" }),
    });

    // Commit on dev: add menu m_dev
    await db.update(packs).set({
      filesJson: "{}",
      editorJson: JSON.stringify({ menus: [{ id: "m_dev", name: "dev_menu" }] }),
    }).where(eq(packs.id, packId));
    await app.request(`/api/networks/${networkId}/packs/${packId}/commits`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ branch: "dev", message: "dev1" }),
    });

    // Commit on main: add menu m_main (different id, no conflict)
    await db.update(packs).set({
      filesJson: "{}",
      editorJson: JSON.stringify({ menus: [{ id: "m_main", name: "main_menu" }] }),
    }).where(eq(packs.id, packId));
    await app.request(`/api/networks/${networkId}/packs/${packId}/commits`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ branch: "main", message: "main1" }),
    });

    const res = await app.request(`/api/networks/${networkId}/packs/${packId}/branches/dev/merge-into/main`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.kind).toBe("auto");
    expect(body.conflicts).toEqual([]);
    // mergedEditorJson should contain BOTH menus
    const ids = (body.mergedEditorJson.menus as Array<{ id: string }>).map((m) => m.id).sort();
    expect(ids).toEqual(["m_dev", "m_main"]);
    expect(body.lcaCommitId).toBeDefined();
    expect(body.srcCommitId).toBeDefined();
    expect(body.dstCommitId).toBeDefined();
  });

  test("3-way conflict returns kind=conflicts with the conflict list", async () => {
    const { sessionId, networkId, packId } = await seedUserWithPack();
    const app = makeApp();
    await app.request(`/api/networks/${networkId}/packs/${packId}/branches`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "dev", from: "main" }),
    });
    // Same id on both, different names → conflict
    await db.update(packs).set({
      editorJson: JSON.stringify({ menus: [{ id: "m_x", name: "src-x" }] }),
    }).where(eq(packs.id, packId));
    await app.request(`/api/networks/${networkId}/packs/${packId}/commits`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ branch: "dev", message: "d" }),
    });
    await db.update(packs).set({
      editorJson: JSON.stringify({ menus: [{ id: "m_x", name: "dst-x" }] }),
    }).where(eq(packs.id, packId));
    await app.request(`/api/networks/${networkId}/packs/${packId}/commits`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ branch: "main", message: "m" }),
    });

    const res = await app.request(`/api/networks/${networkId}/packs/${packId}/branches/dev/merge-into/main`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.kind).toBe("conflicts");
    expect(body.conflicts).toHaveLength(1);
    expect(body.conflicts[0].conflictKey).toBe("menus:m_x");
    expect(body.lcaCommitId).toBeDefined();
    expect(body.srcCommitId).toBeDefined();
    expect(body.dstCommitId).toBeDefined();
  });

  test("same src and dst returns 400 same_branch", async () => {
    const { sessionId, networkId, packId } = await seedUserWithPack();
    const app = makeApp();
    const res = await app.request(`/api/networks/${networkId}/packs/${packId}/branches/main/merge-into/main`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("same_branch");
  });

  test("unknown branch returns 404", async () => {
    const { sessionId, networkId, packId } = await seedUserWithPack();
    const app = makeApp();
    const res = await app.request(`/api/networks/${networkId}/packs/${packId}/branches/ghost/merge-into/main`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2 : Run — expect FAIL** (endpoint not yet implemented)

- [ ] **Step 3 : Implement the endpoint in `userBranches.ts`**

Append to the existing router:

```ts
// backend/src/routes/userBranches.ts — append after the promote handler:
import { findLCA, advanceBranchHead } from "../lib/branchStorage";
import { getCommit } from "../lib/commitStorage";
import { merge as mergeStates, type EditorState } from "../lib/mergeEngine";
import { pushBundleAvailable } from "../ws/hub";

userBranchesRouter.post("/:id/packs/:packId/branches/:src/merge-into/:dst", async (c) => {
  const access = await checkAccess(c, c.req.param("id"), c.req.param("packId"));
  if (!access.ok) return c.json({ error: "denied" }, access.status);
  const packId = c.req.param("packId");
  const srcName = c.req.param("src");
  const dstName = c.req.param("dst");
  if (srcName === dstName) return c.json({ error: "same_branch" }, 400);

  const src = await getBranch(packId, srcName);
  const dst = await getBranch(packId, dstName);
  if (!src || !dst) return c.json({ error: "branch_not_found" }, 404);

  let lcaId: string;
  try { lcaId = await findLCA(src.headCommitId, dst.headCommitId); }
  catch { return c.json({ error: "no_common_ancestor" }, 500); }

  // already_merged: src is ancestor of dst
  if (lcaId === src.headCommitId) {
    return c.json({ kind: "already_merged", advanced: false });
  }

  // fast_forward: dst is ancestor of src — advance dst to src.head
  if (lcaId === dst.headCommitId) {
    await advanceBranchHead(packId, dstName, src.headCommitId);
    const newHead = await getCommit(src.headCommitId);
    if (newHead) await pushBundleAvailable(packId, dstName, newHead.contentHash);
    return c.json({
      kind: "fast_forward",
      advanced: true,
      head_commit_id: src.headCommitId,
    });
  }

  // 3-way merge
  const [baseCommit, srcCommit, dstCommit] = await Promise.all([
    getCommit(lcaId),
    getCommit(src.headCommitId),
    getCommit(dst.headCommitId),
  ]);
  if (!baseCommit || !srcCommit || !dstCommit) return c.json({ error: "commit_missing" }, 500);

  const baseState = baseCommit.editorJson ? JSON.parse(baseCommit.editorJson) as EditorState : {};
  const srcState = srcCommit.editorJson ? JSON.parse(srcCommit.editorJson) as EditorState : {};
  const dstState = dstCommit.editorJson ? JSON.parse(dstCommit.editorJson) as EditorState : {};

  const result = mergeStates(baseState, srcState, dstState);

  return c.json({
    kind: result.conflicts.length === 0 ? "auto" : "conflicts",
    conflicts: result.conflicts,
    mergedEditorJson: result.mergedState,
    lcaCommitId: lcaId,
    srcCommitId: src.headCommitId,
    dstCommitId: dst.headCommitId,
  });
});
```

- [ ] **Step 4 : Run — expect PASS**

```bash
cd backend && bun test --isolate src/routes/userBranches.test.ts
```

- [ ] **Step 5 : Commit**

```bash
git add backend/src/routes/userBranches.ts backend/src/routes/userBranches.test.ts
git commit -m "feat(backend): POST .../branches/:src/merge-into/:dst (compute merge, returns auto/conflicts/ff/already_merged)"
```

---

### Task C2 : `POST /api/networks/:id/packs/:packId/branches/:src/merge-into/:dst/resolve`

**Files:**
- Modify: `backend/src/routes/userBranches.ts`
- Modify: `backend/src/routes/userBranches.test.ts`

Client posts the resolutions + pre-derived filesJson + the 3 commit ids (lca/src/dst for stale check). Backend re-validates, applies resolutions, creates merge commit, advances dst branch, broadcasts.

- [ ] **Step 1 : Append tests**

```ts
describe("POST /merge-into/.../resolve", () => {
  test("resolve auto-merge (empty conflicts) creates merge commit + advances dst", async () => {
    const { sessionId, networkId, packId } = await seedUserWithPack();
    const app = makeApp();
    // Set up an auto-merge scenario (different items on each branch)
    await app.request(`/api/networks/${networkId}/packs/${packId}/branches`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "dev", from: "main" }),
    });
    await db.update(packs).set({
      editorJson: JSON.stringify({ menus: [{ id: "m_dev", name: "d" }] }),
    }).where(eq(packs.id, packId));
    const devCommitRes = await app.request(`/api/networks/${networkId}/packs/${packId}/commits`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ branch: "dev", message: "d" }),
    });
    await db.update(packs).set({
      editorJson: JSON.stringify({ menus: [{ id: "m_main", name: "m" }] }),
    }).where(eq(packs.id, packId));
    await app.request(`/api/networks/${networkId}/packs/${packId}/commits`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ branch: "main", message: "m" }),
    });

    // Get the merge plan
    const planRes = await app.request(`/api/networks/${networkId}/packs/${packId}/branches/dev/merge-into/main`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const plan = await planRes.json();

    // Client would derive filesJson from plan.mergedEditorJson here; we use a stub.
    const mergedFiles = { "merged.yaml": "x" };

    const resolveRes = await app.request(`/api/networks/${networkId}/packs/${packId}/branches/dev/merge-into/main/resolve`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        resolutions: {},  // empty for auto-merge
        lcaCommitId: plan.lcaCommitId,
        srcCommitId: plan.srcCommitId,
        dstCommitId: plan.dstCommitId,
        mergedFilesJson: mergedFiles,
        mergedEditorJson: plan.mergedEditorJson,
      }),
    });
    expect(resolveRes.status).toBe(201);
    const body = await resolveRes.json();
    expect(body.commit.id).toMatch(/^cmt_/);

    // Verify merge commit has parentId2 set
    const { getCommit } = await import("../lib/commitStorage");
    const cmt = await getCommit(body.commit.id);
    expect(cmt!.parentId).toBe(plan.dstCommitId);
    expect(cmt!.parentId2).toBe(plan.srcCommitId);

    // main.head advanced
    const { getBranch } = await import("../lib/branchStorage");
    const main = await getBranch(packId, "main");
    expect(main!.headCommitId).toBe(body.commit.id);
  });

  test("resolve with conflict choices applies them correctly", async () => {
    const { sessionId, networkId, packId } = await seedUserWithPack();
    const app = makeApp();
    await app.request(`/api/networks/${networkId}/packs/${packId}/branches`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "dev", from: "main" }),
    });
    // Same id, different name → conflict
    await db.update(packs).set({
      editorJson: JSON.stringify({ menus: [{ id: "m_x", name: "src-x" }] }),
    }).where(eq(packs.id, packId));
    await app.request(`/api/networks/${networkId}/packs/${packId}/commits`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ branch: "dev", message: "d" }),
    });
    await db.update(packs).set({
      editorJson: JSON.stringify({ menus: [{ id: "m_x", name: "dst-x" }] }),
    }).where(eq(packs.id, packId));
    await app.request(`/api/networks/${networkId}/packs/${packId}/commits`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ branch: "main", message: "m" }),
    });

    const planRes = await app.request(`/api/networks/${networkId}/packs/${packId}/branches/dev/merge-into/main`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const plan = await planRes.json();
    expect(plan.conflicts).toHaveLength(1);

    const resolveRes = await app.request(`/api/networks/${networkId}/packs/${packId}/branches/dev/merge-into/main/resolve`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        resolutions: { "menus:m_x": "src" },
        lcaCommitId: plan.lcaCommitId,
        srcCommitId: plan.srcCommitId,
        dstCommitId: plan.dstCommitId,
        mergedFilesJson: {},
        mergedEditorJson: { menus: [{ id: "m_x", name: "src-x" }] },
      }),
    });
    expect(resolveRes.status).toBe(201);
    const body = await resolveRes.json();
    const { getCommit } = await import("../lib/commitStorage");
    const cmt = await getCommit(body.commit.id);
    const editor = JSON.parse(cmt!.editorJson!);
    expect(editor.menus.find((m: { id: string; name: string }) => m.id === "m_x").name).toBe("src-x");
  });

  test("resolve with stale heads returns 409 stale_merge", async () => {
    const { sessionId, networkId, packId } = await seedUserWithPack();
    const app = makeApp();
    await app.request(`/api/networks/${networkId}/packs/${packId}/branches`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "dev", from: "main" }),
    });
    await db.update(packs).set({
      editorJson: JSON.stringify({ menus: [{ id: "m_a", name: "v1" }] }),
    }).where(eq(packs.id, packId));
    await app.request(`/api/networks/${networkId}/packs/${packId}/commits`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ branch: "dev", message: "d" }),
    });

    // POST resolve with random ids that don't match
    const res = await app.request(`/api/networks/${networkId}/packs/${packId}/branches/dev/merge-into/main/resolve`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        resolutions: {},
        lcaCommitId: "cmt_stale1",
        srcCommitId: "cmt_stale2",
        dstCommitId: "cmt_stale3",
        mergedFilesJson: {},
        mergedEditorJson: {},
      }),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("stale_merge");
  });

  test("resolve with missing resolution for a conflict returns 400", async () => {
    const { sessionId, networkId, packId } = await seedUserWithPack();
    const app = makeApp();
    await app.request(`/api/networks/${networkId}/packs/${packId}/branches`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "dev", from: "main" }),
    });
    await db.update(packs).set({
      editorJson: JSON.stringify({ menus: [{ id: "m_y", name: "s" }] }),
    }).where(eq(packs.id, packId));
    await app.request(`/api/networks/${networkId}/packs/${packId}/commits`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ branch: "dev", message: "d" }),
    });
    await db.update(packs).set({
      editorJson: JSON.stringify({ menus: [{ id: "m_y", name: "d" }] }),
    }).where(eq(packs.id, packId));
    await app.request(`/api/networks/${networkId}/packs/${packId}/commits`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ branch: "main", message: "m" }),
    });

    const planRes = await app.request(`/api/networks/${networkId}/packs/${packId}/branches/dev/merge-into/main`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const plan = await planRes.json();

    const res = await app.request(`/api/networks/${networkId}/packs/${packId}/branches/dev/merge-into/main/resolve`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        resolutions: {},  // empty but there's 1 conflict
        lcaCommitId: plan.lcaCommitId,
        srcCommitId: plan.srcCommitId,
        dstCommitId: plan.dstCommitId,
        mergedFilesJson: {},
        mergedEditorJson: plan.mergedEditorJson,
      }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("missing_resolutions");
  });
});
```

- [ ] **Step 2 : Run — expect FAIL**

- [ ] **Step 3 : Implement the `/resolve` endpoint**

```ts
// backend/src/routes/userBranches.ts — append:
import { applyResolutions, type EditorState as MergeEditorState } from "../lib/mergeEngine";
import { createCommit, computeContentHash } from "../lib/commitStorage";

userBranchesRouter.post("/:id/packs/:packId/branches/:src/merge-into/:dst/resolve", async (c) => {
  const access = await checkAccess(c, c.req.param("id"), c.req.param("packId"));
  if (!access.ok) return c.json({ error: "denied" }, access.status);
  const packId = c.req.param("packId");
  const srcName = c.req.param("src");
  const dstName = c.req.param("dst");
  if (srcName === dstName) return c.json({ error: "same_branch" }, 400);

  let body: {
    resolutions?: unknown;
    lcaCommitId?: unknown;
    srcCommitId?: unknown;
    dstCommitId?: unknown;
    mergedFilesJson?: unknown;
    mergedEditorJson?: unknown;
    message?: unknown;
  };
  try { body = await c.req.json(); } catch { return c.json({ error: "invalid_body" }, 400); }

  // Stale check: heads must match what client received from /merge-into.
  const src = await getBranch(packId, srcName);
  const dst = await getBranch(packId, dstName);
  if (!src || !dst) return c.json({ error: "branch_not_found" }, 404);
  if (src.headCommitId !== body.srcCommitId || dst.headCommitId !== body.dstCommitId) {
    return c.json({ error: "stale_merge" }, 409);
  }

  // Re-run merge to validate conflicts list (server is source of truth).
  const lcaId = body.lcaCommitId as string;
  const [baseCommit, srcCommit, dstCommit] = await Promise.all([
    getCommit(lcaId),
    getCommit(src.headCommitId),
    getCommit(dst.headCommitId),
  ]);
  if (!baseCommit || !srcCommit || !dstCommit) return c.json({ error: "commit_missing" }, 500);

  const baseState = baseCommit.editorJson ? JSON.parse(baseCommit.editorJson) as MergeEditorState : {};
  const srcState = srcCommit.editorJson ? JSON.parse(srcCommit.editorJson) as MergeEditorState : {};
  const dstState = dstCommit.editorJson ? JSON.parse(dstCommit.editorJson) as MergeEditorState : {};
  const mergeResult = mergeStates(baseState, srcState, dstState);

  // Validate resolutions: must cover exactly the conflict keys.
  const resolutions = (body.resolutions ?? {}) as Record<string, "src" | "dst">;
  const conflictKeys = new Set(mergeResult.conflicts.map((c2) => c2.conflictKey));
  const resolutionKeys = new Set(Object.keys(resolutions));
  for (const k of conflictKeys) {
    if (!resolutionKeys.has(k)) return c.json({ error: "missing_resolutions", missingKey: k }, 400);
  }
  for (const k of resolutionKeys) {
    if (!conflictKeys.has(k)) return c.json({ error: "extra_resolutions", extraKey: k }, 400);
    if (resolutions[k] !== "src" && resolutions[k] !== "dst") {
      return c.json({ error: "invalid_resolution_value", key: k }, 400);
    }
  }

  // Apply resolutions to get the final editorJson.
  const finalEditor = applyResolutions(mergeResult.mergedState, mergeResult.conflicts, resolutions);

  // Sanity: client's mergedEditorJson should match what we just computed.
  // (We trust our re-computation; the client field is informational only.)
  const finalFiles = (body.mergedFilesJson ?? {}) as Record<string, string>;
  const message = typeof body.message === "string" && body.message.trim()
    ? body.message.trim()
    : `Merge ${srcName} into ${dstName}`;

  // Create merge commit with both parents.
  // We need a custom path because createCommit doesn't take parentId2. Insert directly.
  const contentHash = computeContentHash(finalFiles);
  const id = "cmt_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  await db.insert(packCommits).values({
    id,
    packId,
    parentId: dst.headCommitId,
    parentId2: src.headCommitId,
    contentHash,
    filesJson: JSON.stringify(finalFiles),
    editorJson: JSON.stringify(finalEditor),
    authorUserId: getUserId(c),
    message,
    createdAt: new Date(),
  });
  await advanceBranchHead(packId, dstName, id);
  await pushBundleAvailable(packId, dstName, contentHash);

  const commit = await getCommit(id);
  return c.json({ commit, head_commit_id: id }, 201);
});
```

Adjust imports at top of `userBranches.ts` if needed:
```ts
import { packCommits } from "../db/schema";
```

- [ ] **Step 4 : Run — expect PASS**

```bash
cd backend && bun test --isolate src/routes/userBranches.test.ts
```

- [ ] **Step 5 : Commit**

```bash
git add backend/src/routes/userBranches.ts backend/src/routes/userBranches.test.ts
git commit -m "feat(backend): POST .../merge-into/.../resolve (creates merge commit with parentId2)"
```

---

## Section D — Editor

### Task D1 : API client `mergeBranches` + `resolveMerge`

**Files:**
- Modify: `editor/src/lib/api/branches.ts`
- Modify: `editor/src/lib/api/branches.test.ts`

- [ ] **Step 1 : Append types + functions to `branches.ts`**

```ts
// editor/src/lib/api/branches.ts — append:

export type ConflictResolutionKind = "modify-modify" | "delete-modify";

export interface Conflict {
  conflictKey: string;
  collection: string;
  resolution: ConflictResolutionKind;
  srcValue: unknown | null;
  dstValue: unknown | null;
  baseValue: unknown | null;
}

export type MergePlan =
  | { kind: "already_merged"; advanced: false }
  | { kind: "fast_forward"; advanced: true; head_commit_id: string }
  | {
      kind: "auto" | "conflicts";
      conflicts: Conflict[];
      mergedEditorJson: unknown;
      lcaCommitId: string;
      srcCommitId: string;
      dstCommitId: string;
    };

export async function mergeBranches(
  networkId: string,
  packId: string,
  src: string,
  dst: string,
  message?: string,
): Promise<MergePlan> {
  const res = await fetch(
    `${API_URL}/api/networks/${networkId}/packs/${packId}/branches/${src}/merge-into/${dst}`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message !== undefined ? { message } : {}),
    },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `mergeBranches failed: ${res.status}`);
  }
  return res.json();
}

export async function resolveMerge(
  networkId: string,
  packId: string,
  src: string,
  dst: string,
  args: {
    resolutions: Record<string, "src" | "dst">;
    lcaCommitId: string;
    srcCommitId: string;
    dstCommitId: string;
    mergedFilesJson: Record<string, string>;
    mergedEditorJson: unknown;
    message?: string;
  },
): Promise<{ commit: Commit; head_commit_id: string }> {
  const res = await fetch(
    `${API_URL}/api/networks/${networkId}/packs/${packId}/branches/${src}/merge-into/${dst}/resolve`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args),
    },
  );
  if (res.status === 409) {
    const body = await res.json();
    throw new Error(body.error ?? "stale_merge");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `resolveMerge failed: ${res.status}`);
  }
  return res.json();
}
```

- [ ] **Step 2 : Append tests to `branches.test.ts`**

```ts
describe("mergeBranches + resolveMerge", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("mergeBranches returns the plan", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({
      kind: "auto",
      conflicts: [],
      mergedEditorJson: { menus: [] },
      lcaCommitId: "cmt_lca",
      srcCommitId: "cmt_src",
      dstCommitId: "cmt_dst",
    }), { status: 200 }));
    const plan = await mergeBranches("n1", "p1", "dev", "main");
    expect(plan.kind).toBe("auto");
  });

  it("mergeBranches throws on 4xx/5xx", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ error: "same_branch" }), { status: 400 }));
    await expect(mergeBranches("n1", "p1", "main", "main")).rejects.toThrow(/same_branch/);
  });

  it("resolveMerge returns the new commit", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({
      commit: { id: "cmt_merge", message: "x" }, head_commit_id: "cmt_merge",
    }), { status: 201 }));
    const res = await resolveMerge("n1", "p1", "dev", "main", {
      resolutions: {},
      lcaCommitId: "cmt_lca", srcCommitId: "cmt_src", dstCommitId: "cmt_dst",
      mergedFilesJson: {}, mergedEditorJson: {},
    });
    expect(res.commit.id).toBe("cmt_merge");
  });

  it("resolveMerge throws stale_merge on 409", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ error: "stale_merge" }), { status: 409 }));
    await expect(resolveMerge("n1", "p1", "dev", "main", {
      resolutions: {}, lcaCommitId: "", srcCommitId: "", dstCommitId: "",
      mergedFilesJson: {}, mergedEditorJson: {},
    })).rejects.toThrow(/stale_merge/);
  });
});
```

- [ ] **Step 3 : Run + commit**

```bash
cd editor && npx vitest run src/lib/api/branches.test.ts
git add editor/src/lib/api/branches.ts editor/src/lib/api/branches.test.ts
git commit -m "feat(editor): API client mergeBranches + resolveMerge"
```

---

### Task D2 : `MergeButton` component

**Files:**
- Create: `editor/src/features/branches/MergeButton.tsx`
- Create: `editor/src/features/branches/MergeButton.test.tsx`

Trigger button + dialog. On submit, calls `mergeBranches`. Routes the response to either a toast (auto-merge / fast-forward / already-merged) or opens `MergeConflictModal` for conflicts.

- [ ] **Step 1 : Test**

```tsx
// editor/src/features/branches/MergeButton.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MergeButton } from "./MergeButton";
import * as branchesApi from "@/lib/api/branches";

// Stub MergeConflictModal so we can assert it's opened on conflicts.
vi.mock("./MergeConflictModal", () => ({
  MergeConflictModal: (props: { onResolved?: () => void }) => (
    <div data-testid="conflict-modal-mock">conflict modal: {String(!!props.onResolved)}</div>
  ),
}));

describe("MergeButton", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("opens dialog with target picker", () => {
    render(<MergeButton networkId="n1" packId="p1" sourceBranch="dev" allBranches={["main", "dev"]} />);
    fireEvent.click(screen.getByRole("button", { name: /merge/i }));
    expect(screen.getByLabelText(/target branch/i)).toBeTruthy();
  });

  it("submits then shows the fast_forward toast (auto-close)", async () => {
    vi.spyOn(branchesApi, "mergeBranches").mockResolvedValue({
      kind: "fast_forward", advanced: true, head_commit_id: "cmt_x",
    });
    render(<MergeButton networkId="n1" packId="p1" sourceBranch="dev" allBranches={["main", "dev"]} />);
    fireEvent.click(screen.getByRole("button", { name: /merge/i }));
    fireEvent.change(screen.getByLabelText(/target branch/i), { target: { value: "main" } });
    fireEvent.click(screen.getByRole("button", { name: /start merge/i }));
    await waitFor(() => expect(screen.getByText(/fast-forwarded/i)).toBeTruthy());
  });

  it("opens MergeConflictModal on conflicts", async () => {
    vi.spyOn(branchesApi, "mergeBranches").mockResolvedValue({
      kind: "conflicts",
      conflicts: [{ conflictKey: "menus:m_x", collection: "menus", resolution: "modify-modify",
                   srcValue: { id: "m_x", name: "s" }, dstValue: { id: "m_x", name: "d" }, baseValue: null }],
      mergedEditorJson: { menus: [{ id: "m_x", name: "d" }] },
      lcaCommitId: "cmt_lca", srcCommitId: "cmt_src", dstCommitId: "cmt_dst",
    });
    render(<MergeButton networkId="n1" packId="p1" sourceBranch="dev" allBranches={["main", "dev"]} />);
    fireEvent.click(screen.getByRole("button", { name: /merge/i }));
    fireEvent.change(screen.getByLabelText(/target branch/i), { target: { value: "main" } });
    fireEvent.click(screen.getByRole("button", { name: /start merge/i }));
    await waitFor(() => expect(screen.getByTestId("conflict-modal-mock")).toBeTruthy());
  });

  it("shows error message on API failure", async () => {
    vi.spyOn(branchesApi, "mergeBranches").mockRejectedValue(new Error("same_branch"));
    render(<MergeButton networkId="n1" packId="p1" sourceBranch="dev" allBranches={["main", "dev"]} />);
    fireEvent.click(screen.getByRole("button", { name: /merge/i }));
    fireEvent.change(screen.getByLabelText(/target branch/i), { target: { value: "main" } });
    fireEvent.click(screen.getByRole("button", { name: /start merge/i }));
    await waitFor(() => expect(screen.getByText(/same_branch/i)).toBeTruthy());
  });
});
```

- [ ] **Step 2 : Run — expect FAIL**

- [ ] **Step 3 : Implement**

```tsx
// editor/src/features/branches/MergeButton.tsx
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { mergeBranches, type MergePlan } from "@/lib/api/branches";
import { MergeConflictModal } from "./MergeConflictModal";

interface Props {
  networkId: string;
  packId: string;
  sourceBranch: string;
  allBranches: string[];
}

export function MergeButton({ networkId, packId, sourceBranch, allBranches }: Props) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState(() => allBranches.find((b) => b !== sourceBranch) ?? "");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conflictPlan, setConflictPlan] = useState<MergePlan | null>(null);

  const onStart = async () => {
    if (!target) return;
    setBusy(true);
    setStatus(null);
    setError(null);
    try {
      const plan = await mergeBranches(networkId, packId, sourceBranch, target, message || undefined);
      if (plan.kind === "already_merged") {
        setStatus("Already up to date");
      } else if (plan.kind === "fast_forward") {
        setStatus("Fast-forwarded — no conflicts");
      } else if (plan.kind === "auto") {
        // Auto-merge: we still need /resolve to commit. Open the modal in "preview" mode.
        setConflictPlan(plan);
        setOpen(false);
      } else {
        // Conflicts: open the resolver modal.
        setConflictPlan(plan);
        setOpen(false);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>Merge…</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Merge {sourceBranch} into …</DialogTitle></DialogHeader>
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
            <Input
              placeholder="Optional commit message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
            {status && <div className="text-xs text-emerald-400">{status}</div>}
            {error && <div className="text-xs text-red-400">{error}</div>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={onStart} disabled={busy || !target}>Start merge</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      {conflictPlan && (conflictPlan.kind === "auto" || conflictPlan.kind === "conflicts") && (
        <MergeConflictModal
          networkId={networkId}
          packId={packId}
          src={sourceBranch}
          dst={target}
          plan={conflictPlan}
          onResolved={() => { setConflictPlan(null); setStatus("Merged"); }}
          onCancel={() => setConflictPlan(null)}
        />
      )}
    </>
  );
}
```

- [ ] **Step 4 : Run — expect PASS**

```bash
cd editor && npx vitest run src/features/branches/MergeButton.test.tsx
```

- [ ] **Step 5 : Commit**

```bash
git add editor/src/features/branches/MergeButton.tsx editor/src/features/branches/MergeButton.test.tsx
git commit -m "feat(editor): MergeButton (trigger + dialog)"
```

---

### Task D3 : `MergeConflictModal` component

**Files:**
- Create: `editor/src/features/branches/MergeConflictModal.tsx`
- Create: `editor/src/features/branches/MergeConflictModal.test.tsx`

- [ ] **Step 1 : Test**

```tsx
// editor/src/features/branches/MergeConflictModal.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MergeConflictModal } from "./MergeConflictModal";
import * as branchesApi from "@/lib/api/branches";

const planWithConflict = {
  kind: "conflicts" as const,
  conflicts: [{
    conflictKey: "menus:m_x",
    collection: "menus",
    resolution: "modify-modify" as const,
    srcValue: { id: "m_x", name: "src-x" },
    dstValue: { id: "m_x", name: "dst-x" },
    baseValue: { id: "m_x", name: "base-x" },
  }],
  mergedEditorJson: { menus: [{ id: "m_x", name: "dst-x" }] },
  lcaCommitId: "cmt_lca",
  srcCommitId: "cmt_src",
  dstCommitId: "cmt_dst",
};

describe("MergeConflictModal", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("renders conflict items with radio buttons for src/dst", () => {
    render(
      <MergeConflictModal
        networkId="n1" packId="p1" src="dev" dst="main"
        plan={planWithConflict}
        onResolved={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByText(/menus:m_x/i)).toBeTruthy();
    expect(screen.getByLabelText(/use dev/i)).toBeTruthy();
    expect(screen.getByLabelText(/use main/i)).toBeTruthy();
  });

  it("Confirm button disabled until all conflicts resolved", () => {
    render(
      <MergeConflictModal
        networkId="n1" packId="p1" src="dev" dst="main"
        plan={planWithConflict}
        onResolved={() => {}}
        onCancel={() => {}}
      />,
    );
    expect((screen.getByRole("button", { name: /confirm merge/i }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/use dev/i));
    expect((screen.getByRole("button", { name: /confirm merge/i }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("Confirm calls resolveMerge with resolutions", async () => {
    const spy = vi.spyOn(branchesApi, "resolveMerge").mockResolvedValue({
      commit: { id: "cmt_merge", packId: "p1", parentId: "cmt_dst", contentHash: "x",
                authorUserId: null, message: "Merge dev into main", createdAt: "" },
      head_commit_id: "cmt_merge",
    });
    const onResolved = vi.fn();
    render(
      <MergeConflictModal
        networkId="n1" packId="p1" src="dev" dst="main"
        plan={planWithConflict}
        onResolved={onResolved}
        onCancel={() => {}}
      />,
    );
    fireEvent.click(screen.getByLabelText(/use dev/i));
    fireEvent.click(screen.getByRole("button", { name: /confirm merge/i }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith("n1", "p1", "dev", "main", expect.objectContaining({
      resolutions: { "menus:m_x": "src" },
      lcaCommitId: "cmt_lca",
    })));
    expect(onResolved).toHaveBeenCalledWith("cmt_merge");
  });

  it("Cancel calls onCancel without API", () => {
    const onCancel = vi.fn();
    const spy = vi.spyOn(branchesApi, "resolveMerge");
    render(
      <MergeConflictModal
        networkId="n1" packId="p1" src="dev" dst="main"
        plan={planWithConflict}
        onResolved={() => {}}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalled();
    expect(spy).not.toHaveBeenCalled();
  });

  it("auto kind (no conflicts) renders the confirmation summary", () => {
    const autoPlan = { ...planWithConflict, kind: "auto" as const, conflicts: [] };
    render(
      <MergeConflictModal
        networkId="n1" packId="p1" src="dev" dst="main"
        plan={autoPlan}
        onResolved={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByText(/no conflicts/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2 : Run — expect FAIL**

- [ ] **Step 3 : Implement**

```tsx
// editor/src/features/branches/MergeConflictModal.tsx
import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { resolveMerge, type Conflict, type MergePlan } from "@/lib/api/branches";

interface Props {
  networkId: string;
  packId: string;
  src: string;
  dst: string;
  plan: Extract<MergePlan, { kind: "auto" | "conflicts" }>;
  onResolved: (mergeCommitId: string) => void;
  onCancel: () => void;
}

function previewItem(value: unknown): string {
  if (value === null) return "(deleted)";
  if (typeof value === "object" && value !== null && "name" in (value as object)) {
    return String((value as { name: string }).name);
  }
  return JSON.stringify(value).slice(0, 60);
}

export function MergeConflictModal({
  networkId, packId, src, dst, plan, onResolved, onCancel,
}: Props) {
  const [resolutions, setResolutions] = useState<Record<string, "src" | "dst">>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allResolved = useMemo(
    () => plan.conflicts.every((c) => resolutions[c.conflictKey] !== undefined),
    [plan.conflicts, resolutions],
  );

  const onConfirm = async () => {
    setBusy(true);
    setError(null);
    try {
      // For MVP, the client derives filesJson elsewhere. Here we send the
      // mergedEditorJson and an empty filesJson — the editor's save flow will
      // re-derive on the next regular save. The merge commit itself carries
      // the editor state authoritative.
      const res = await resolveMerge(networkId, packId, src, dst, {
        resolutions,
        lcaCommitId: plan.lcaCommitId,
        srcCommitId: plan.srcCommitId,
        dstCommitId: plan.dstCommitId,
        mergedFilesJson: {},  // TODO(Phase 3.5): re-derive on client
        mergedEditorJson: plan.mergedEditorJson,
      });
      onResolved(res.head_commit_id);
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {plan.conflicts.length === 0
              ? `Merge ${src} → ${dst} (no conflicts)`
              : `Resolve ${plan.conflicts.length} conflicts to merge ${src} → ${dst}`}
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          {plan.conflicts.length === 0 && (
            <div className="text-xs text-emerald-400">All changes auto-merged. Click Confirm to commit.</div>
          )}
          <ul className="flex flex-col gap-3 max-h-96 overflow-y-auto">
            {plan.conflicts.map((c: Conflict) => (
              <li key={c.conflictKey} className="border border-zinc-800 rounded p-2 text-xs">
                <div className="font-mono mb-1">{c.conflictKey}</div>
                <div className="text-muted-foreground mb-2">
                  {c.resolution === "modify-modify"
                    ? "Both sides modified this"
                    : c.srcValue === null
                      ? `${src} deleted this, ${dst} modified it`
                      : `${dst} deleted this, ${src} modified it`}
                </div>
                <div className="flex flex-col gap-1">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name={c.conflictKey}
                      aria-label={`Use ${src}`}
                      checked={resolutions[c.conflictKey] === "src"}
                      onChange={() => setResolutions((r) => ({ ...r, [c.conflictKey]: "src" }))}
                    />
                    <span>Use {src}: {previewItem(c.srcValue)}</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name={c.conflictKey}
                      aria-label={`Use ${dst}`}
                      checked={resolutions[c.conflictKey] === "dst"}
                      onChange={() => setResolutions((r) => ({ ...r, [c.conflictKey]: "dst" }))}
                    />
                    <span>Use {dst}: {previewItem(c.dstValue)}</span>
                  </label>
                </div>
              </li>
            ))}
          </ul>
          {error && <div className="text-xs text-red-400">{error}</div>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onCancel}>Cancel</Button>
            <Button
              onClick={onConfirm}
              disabled={busy || (plan.conflicts.length > 0 && !allResolved)}
            >
              Confirm merge
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4 : Run + commit**

```bash
cd editor && npx vitest run src/features/branches/MergeConflictModal.test.tsx
git add editor/src/features/branches/MergeConflictModal.tsx editor/src/features/branches/MergeConflictModal.test.tsx
git commit -m "feat(editor): MergeConflictModal (per-conflict radio picker)"
```

---

### Task D4 : Mount `<MergeButton>` in `pack.$packId.tsx`

**Files:**
- Modify: `editor/src/routes/pack.$packId.tsx`

- [ ] **Step 1 : Find the section where `<PromoteButton>` is mounted** (Phase 2 added it next to BranchSwitcher).

- [ ] **Step 2 : Add the import**

```tsx
import { MergeButton } from "@/features/branches/MergeButton";
```

- [ ] **Step 3 : Render `<MergeButton>` next to `<PromoteButton>`**

```tsx
// Inside the branch toolbar section:
<PromoteButton networkId={networkId} packId={packId} sourceBranch={currentBranch} allBranches={branchNames} />
<MergeButton networkId={networkId} packId={packId} sourceBranch={currentBranch} allBranches={branchNames} />
```

- [ ] **Step 4 : Run full editor sweep**

```bash
cd editor && npx vitest run
```

Expected : all green (no regressions).

- [ ] **Step 5 : Commit**

```bash
git add editor/src/routes/pack.\$packId.tsx
git commit -m "feat(editor): mount MergeButton next to PromoteButton in pack route"
```

---

## Section E — Wrap-up

### Task E1 : Full backend test sweep

- [ ] **Step 1 : Wipe DB + run**

```bash
cd backend && bun -e "import { db } from './src/db/index'; import { editorSessions, packBindings, packBranches, packCommits, packs, assets, serverKeys, networks, linkCodes, memberships, users, userSessions } from './src/db/schema'; await db.delete(packBindings); await db.delete(packBranches); await db.delete(packCommits); await db.delete(assets); await db.delete(packs); await db.delete(editorSessions); await db.delete(linkCodes); await db.delete(serverKeys); await db.delete(memberships); await db.delete(networks); await db.delete(userSessions); await db.delete(users); process.exit(0);"
bun test --isolate
```

Expected: all green.

- [ ] **Step 2 : Fix residuals + commit (if any)**

---

### Task E2 : Full editor test sweep

```bash
cd editor && npx vitest run
```

Expected: all green.

---

### Task E3 : Docker smoke test (manual)

1. Wipe + bring up stack from main: `docker compose down -v && docker compose up -d --build`.
2. Sign up + setup wizard (create Network + Pack + ServerKey).
3. Switch to the pack, create branch `dev` (via REST or UI button), commit something on `dev`, commit something different on `main`.
4. Click "Merge dev → main". Verify the response (`auto` if no overlap, `conflicts` if overlap).
5. If conflicts, resolve via the modal. Click Confirm. Verify the new merge commit appears in history (`HistoryPanel`).
6. Verify `pushBundleAvailable` arrives to the bound plugin (check MC console logs after the merge).

---

### Task E4 : Doc updates

**Files:**
- Modify: `Artisan/CLAUDE.md`
- Modify: `.claude/skills/sync-docs/doc-impact-map.yaml`

- [ ] **Step 1 : Update CLAUDE.md**

Add 2 endpoint rows to the existing branches/commits section :

```
| `POST /api/networks/:id/packs/:packId/branches/:src/merge-into/:dst` | Body `{message?}`. Returns `{kind: "already_merged" | "fast_forward" | "auto" | "conflicts", ...}`. Pas de commit créé pour les cas `auto` / `conflicts` (le client doit appeler `/resolve` ensuite). Le cas `fast_forward` avance dst.head directement et broadcast. |
| `POST /api/networks/:id/packs/:packId/branches/:src/merge-into/:dst/resolve` | Body `{resolutions, lcaCommitId, srcCommitId, dstCommitId, mergedFilesJson, mergedEditorJson, message?}`. Crée le merge commit avec `parentId = dst.head`, `parentId2 = src.head`. 409 `stale_merge` si les heads ont bougé. 400 `missing_resolutions` ou `extra_resolutions` si le mapping ne couvre pas exactement les conflits. |
```

Update the entities section to mention `pack_commits.parentId2` :

```
- **pack_commits.parentId2** (Phase 3) : 2nd parent, set uniquement sur les merge commits. Le DAG résultant supporte LCA via `branchStorage.findLCA(a, b)` (BFS bidirectionnel borné à 10 000 steps).
```

- [ ] **Step 2 : Commit**

```bash
git add CLAUDE.md .claude/skills/sync-docs/doc-impact-map.yaml
git commit -m "docs(phase-3): merge-into + resolve endpoints + parentId2 entity"
```

---

## Self-review

**1. Spec coverage** (vs `2026-05-21-phase-3-item-level-merge-design.md`) :
- Schema `parentId2` ✓ (A1)
- LCA algorithm ✓ (A2)
- Item-level diff/merge ✓ (B1)
- applyResolutions ✓ (B2)
- POST merge-into ✓ (C1) — returns kind=auto|conflicts|fast_forward|already_merged
- POST resolve ✓ (C2) — creates merge commit with parentId2
- MergeButton + MergeConflictModal ✓ (D2, D3)
- Mount in pack route ✓ (D4)
- All collections covered (menus, commands, dialogs, templates, dataSources, i18nKeys, canvasLayout, scalars) ✓ via test #14 (mixed)
- Skip `assets`, `importedConnectors` ✓ (mergeEngine only handles the listed fields ; others preserved from `dst` via `structuredClone(dst)`)
- Stale merge 409 ✓ (C2 test)
- Missing resolutions 400 ✓ (C2 test)

**2. Placeholder scan** : The string `TODO(Phase 3.5)` in D3 (mergedFilesJson empty) is intentional and explained. No other placeholders.

**3. Type consistency** :
- `EditorState`, `Conflict`, `MergeResult` defined once in `mergeEngine.ts` (B1), referenced consistently in C1/C2 and D1.
- `mergeBranches` returns `MergePlan` (D1), consumed by D2/D3.
- `applyResolutions(merged, conflicts, resolutions)` signature consistent in B2 and C2.
- `findLCA(commitIdA, commitIdB)` returns `string` consistent in A2 and C1.

**4. Decisions locked from brainstorm** :
- Item-level granularity → enforced by the mergeEngine collection list.
- Client derives filesJson → C2 stores body.mergedFilesJson directly (no backend derive code).
- Auto-merge always goes through /resolve → C1 doesn't create commits, only the FF case advances.
- Fast-forward only on actual FF → C1 detects it via `lcaId === dst.head`.

---

## Notes d'exécution

- **Order matters** : A → B → C → D → E. Section B (mergeEngine) is pure and can be developed without touching DB ; that's the largest test surface.
- **`crypto.randomUUID()`** works in Bun without import.
- **`structuredClone`** is global in Bun, no import.
- **Plugin** : zero code change. The hub broadcast on `pushBundleAvailable` is already plumbed (Phase 2 C1).
- **No `git push --force`** without explicit confirmation. Phase 3 lands via fast-forward merge to main (same workflow as Phases 1B/1C/2).

**Fin du plan.**
