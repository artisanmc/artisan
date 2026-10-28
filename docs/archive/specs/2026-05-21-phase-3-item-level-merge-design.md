# Phase 3 — Item-level merge

**Status:** Design approved by Iban (2026-05-21). Ready for `writing-plans`.
**Scope:** backend (schema + LCA + merge engine + REST), editor (MergeButton + MergeConflictModal). No plugin changes.

---

## TL;DR

Let 2 branches of the same pack **diverge** (several commits each), then be **reconciled** via a semantic merge **per top-level item** (menu / command / dialog / template / dataSource). No field-by-field granularity — we take the whole item from one side or the other. Non-colliding changes auto-merge. Real conflicts open a modal where the user chooses `src` or `dst` per conflict.

The result is a **merge commit** with two parents (`parentId` + `parentId2`).

---

## 1. Goals + non-goals

**Goal:** A "dev → main with possible divergences" workflow that works without force-push. The user commits on dev, commits on main, then does "Merge dev → main" which reconciles. No loss of work (except by explicit choice via resolution).

**Non-goals (deferred or out of scope):**
- Field-level merge (field by field inside an item) — deferred to Phase 3.5 if a use case demands it.
- Octopus merge (>2 parents).
- Rebase / cherry-pick.
- Auto-resolve heuristics ("most recent wins").
- Free-form merge edit (raw YAML).
- Merge on the WIP — user must commit first.
- Revert.
- "Reset WIP to branch HEAD".

---

## 2. Architecture

3 isolated chunks:

```
backend/src/lib/mergeEngine.ts            ← diff + merge + conflict detection (pure, no DB)
backend/src/lib/branchStorage.ts          ← extended with findLCA(commitA, commitB)
backend/src/db/schema.ts                  ← pack_commits.parentId2 nullable
backend/src/routes/userBranches.ts        ← 2 new endpoints: merge-into + resolve
editor/src/lib/api/branches.ts            ← mergeBranches + resolveMerge
editor/src/features/branches/MergeButton.tsx          ← trigger + dialog
editor/src/features/branches/MergeConflictModal.tsx   ← per-conflict radio picker
```

The plugin does not change. The hub broadcasts `bundle_available` to the dst branch after the merge — server_keys bound to `(packId, dstBranchName)` re-pull the pack.

---

## 3. Schema

```ts
// backend/src/db/schema.ts — modify packCommits:
export const packCommits = pgTable("pack_commits", {
  // ... existing fields (id, packId, parentId, contentHash, filesJson, editorJson, authorUserId, message, createdAt) ...
  parentId2: text("parent_id_2"),    // 2nd parent on merge commits, null otherwise
});
```

Migration: `ALTER TABLE pack_commits ADD COLUMN parent_id_2 TEXT` via `bun run db:push`. No backfill (existing commits stay `parentId2 = null`).

---

## 4. LCA algorithm

`findLCA(commitIdA, commitIdB) → string` in `branchStorage.ts`.

```
function findLCA(a, b):
  if a === b: return a
  visitedA = new Set([a])
  visitedB = new Set([b])
  queueA = [a]
  queueB = [b]
  for step in 0..10000:
    if queueA.empty && queueB.empty: throw "no common ancestor"
    if !queueA.empty:
      cur = queueA.shift()
      parents = [cur.parentId, cur.parentId2].filter(Boolean)
      for p in parents:
        if visitedB.has(p): return p
        if !visitedA.has(p): visitedA.add(p); queueA.push(p)
    if !queueB.empty:
      // same with B/A swapped
  throw "lca walk exhausted"
```

Special cases:
- `a === b` → return `a`
- `a` is an ancestor of `b` → BFS from `b` finds `a` before BFS from `a` finds anything (queue exhausted) → return `a`
- No common ancestor → throw (theoretically impossible since all commits come from the pack's root `Initial commit`)

---

## 5. Merge engine

`mergeEngine.merge(base: EditorState, src: EditorState, dst: EditorState) → MergeResult`

```ts
type MergeResult =
  | { kind: "merged"; mergedState: EditorState }
  | { kind: "conflicts"; mergedState: EditorState; conflicts: Conflict[] };

type Conflict = {
  conflictKey: string;        // e.g. "menus:menu_abc", "i18nKeys:hello", "scalar:defaultLang"
  collection: "menus" | "commands" | "dialogs" | "templates" | "dataSources" | "i18nKeys" | "canvasLayout" | "scalar";
  resolution: "modify-modify" | "delete-modify";
  srcValue: unknown | null;   // null if deleted on src
  dstValue: unknown | null;   // null if deleted on dst
  baseValue: unknown | null;  // null if didn't exist in base
};
```

### Collections handled

| Field on Pack | Diff key | Auto-merge | Conflict cases |
|---|---|---|---|
| `menus[]` | `menu.id` | yes | modify-modify, delete-modify |
| `commands[]` | `command.id` | yes | same |
| `dialogs[]` | `dialog.id` | yes | same |
| `templates[]` | `template.id` | yes | same |
| `dataSources[]` | `dataSource.id` | yes | same |
| `i18nKeys` | string key | yes | both modified to different strings |
| `canvasLayout` | string key (entity id) | yes | both modified to different `(x,y)` |
| `defaultLang` | scalar | yes | both modified to different lang |
| `name`, `description` | scalar | yes | same |
| `assets[]` | (skip — managed via separate API) | n/a | n/a |
| `importedConnectors[]` | (skip — referenced externally) | n/a | n/a |

### Algo (per collection-by-id)

```
For each id in (base.ids ∪ src.ids ∪ dst.ids):
  itemBase = base.get(id)        // undefined if doesn't exist in base
  itemSrc  = src.get(id)
  itemDst  = dst.get(id)

  changedSrc = !deepEqual(itemBase, itemSrc)
  changedDst = !deepEqual(itemBase, itemDst)

  case !changedSrc && !changedDst:        merged.set(id, itemDst)
  case  changedSrc && !changedDst:        merged.set(id, itemSrc)     // src added/modified, dst untouched
  case !changedSrc &&  changedDst:        merged.set(id, itemDst)     // dst's existing
  case  changedSrc &&  changedDst:
    if deepEqual(itemSrc, itemDst):       merged.set(id, itemSrc)     // both arrived at same value
    elif itemSrc === undefined:           CONFLICT (delete-modify, src deleted)
    elif itemDst === undefined:           CONFLICT (delete-modify, dst deleted)
    else:                                  CONFLICT (modify-modify)

  // Default in mergedState during conflict = dst's value (so the state is renderable)
```

For `i18nKeys` and `canvasLayout` (maps): same logic, key = string. For scalars: `deepEqual(base, src), deepEqual(base, dst)` directly, conflict if both changed to different values.

`deepEqual` = stable JSON stringify comparison (key-sorted).

### `applyResolutions(mergedState, conflicts, resolutions: Record<conflictKey, "src"|"dst">) → EditorState`

For each conflict, writes the chosen value (from `conflict.srcValue` or `conflict.dstValue`) into the `mergedState` at the corresponding position (parsing `conflict.conflictKey` to find the collection + id). If the chosen value is `null` (deletion), removes the entry. Returns the final state.

### Re-derivation `editorJson → filesJson`

The merge engine produces an `editorJson` (the `EditorState`). For the commit, we also need a `filesJson` (YAMLs of menus, dialogs, etc.). The `editor → files` pipeline exists on the editor side (`packApi.savePack` sends both in parallel). For the backend-side merge, we must:
- Either call a `derivefilesFromEditor(editorState) → Record<string, string>` function (to implement or reuse).
- Or ask the client to re-derive and post the filesJson in /resolve.

**Decision**: backend re-derives. Implementation plan: extract the re-derive function from the editor (probably already in a domain module) to a shared module `lib/derivePackFiles.ts` (backend side, port of the editor code). **Risk**: if the logic is too React-side, we make the client carry it (POST resolve with `{resolutions, derivedFiles}`).

The trade-off is made during plan implementation — the spec allows both.

---

## 6. REST API

### `POST /api/networks/:id/packs/:packId/branches/:src/merge-into/:dst`

Body: `{message?: string}` optional.

Logic:
1. Auth (`requireMember`) + branches `src` and `dst` exist (404 otherwise).
2. `src === dst` → 400 `same_branch`.
3. `lca = findLCA(src.head, dst.head)`.
4. `lca === src.head` → 200 `{advanced: false, already_merged: true}` (no-op).
5. `lca === dst.head` → fast-forward: `advanceBranchHead(packId, dst, src.head)`, broadcast, 200 `{advanced: true, fast_forward: true, head_commit_id: src.head}`.
6. Otherwise 3-way:
   - Load base + src + dst editorJsons.
   - `result = mergeEngine.merge(...)`.
   - If `merged`: derive filesJson, `createCommit({parentId: dst.head, parentId2: src.head, ..., message: body.message ?? \`Merge ${src} into ${dst}\`})`. `advanceBranchHead(packId, dst, mergeCommit.id)`. Broadcast. 200 `{advanced: true, fast_forward: false, head_commit_id: mergeCommit.id}`.
   - If `conflicts`: 409 `{error: "conflicts", conflicts, lcaCommitId, srcCommitId, dstCommitId}`.

### `POST /api/networks/:id/packs/:packId/branches/:src/merge-into/:dst/resolve`

Body:
```json
{
  "resolutions": { "menus:menu_abc": "src", "i18nKeys:hello": "dst" },
  "lcaCommitId": "cmt_...", "srcCommitId": "cmt_...", "dstCommitId": "cmt_...",
  "message": "..." (optional)
}
```

Logic:
1. Auth + branches exist.
2. Validate heads not stale: `src.head === body.srcCommitId && dst.head === body.dstCommitId`. Otherwise 409 `stale_merge`.
3. Re-run `mergeEngine.merge(lca, src, dst)`. Get `mergedState + conflicts`.
4. Validate `Object.keys(resolutions)` covers exactly `conflicts.map(c => c.conflictKey)`. Otherwise 400 `missing_or_extra_resolutions`.
5. Validate values are `"src"` or `"dst"`.
6. `finalState = applyResolutions(mergedState, conflicts, resolutions)`.
7. Derive filesJson, createCommit + advance + broadcast.
8. 200 `{commit: mergeCommit, head_commit_id: mergeCommit.id}`.

---

## 7. UI

### `MergeButton` (`editor/src/features/branches/MergeButton.tsx`)

Sibling of `PromoteButton`. Props: `{ networkId, packId, sourceBranch, allBranches }`.

Render: `<Button>Merge…</Button>` that opens a dialog.

Dialog:
- Header: "Merge {sourceBranch} into …"
- "Target branch" select (excludes `sourceBranch`).
- Optional commit message `<Input>`.
- Buttons: "Cancel" / "Start merge".

Submit → `mergeBranches(networkId, packId, src, dst, message)`.

Flow branches:
- 200 `already_merged` → neutral toast "Already up to date".
- 200 `fast_forward` → success toast "Fast-forwarded".
- 200 classic merge → success toast "Merged (auto)".
- 409 conflicts → opens `<MergeConflictModal>` with the conflicts + lcaCommitId/srcCommitId/dstCommitId.
- other error → error message in the dialog.

### `MergeConflictModal` (`editor/src/features/branches/MergeConflictModal.tsx`)

Props:
```ts
{
  networkId, packId, src, dst, conflicts, lcaCommitId, srcCommitId, dstCommitId,
  onResolved: (mergeCommitId: string) => void,
  onCancel: () => void,
}
```

Layout:
- Header: "Resolve {conflicts.length} conflicts to merge {src} → {dst}"
- For each conflict (stable order by `conflictKey`):
  - Title: human-readable label (e.g. `"Menu shop"` if `collection:"menus"` + the name can be found in srcValue/dstValue; otherwise `"menus: menu_abc"`).
  - Description: "Both sides modified this menu" / "{src} deleted, {dst} modified" / etc.
  - Radio:
    - `[ ] Use {src}'s version` + compact preview (e.g. menu rows count, # of layers).
    - `[ ] Use {dst}'s version` + same preview.
  - (No "modify manually" option — out of scope.)
- Footer: "Cancel" (no commit created) / "Confirm merge" (disabled until all conflicts have a resolution).

Submit → POST `/resolve` with `{resolutions, lcaCommitId, srcCommitId, dstCommitId}`. On success → call `onResolved(commit.id)`, close.

### Mounting in `pack.$packId.tsx`

Next to `<PromoteButton>`:

```tsx
<MergeButton
  networkId={networkId}
  packId={packId}
  sourceBranch={currentBranch}
  allBranches={branchNames}
/>
```

---

## 8. Edge cases

| Case | Behavior |
|---|---|
| `src === dst` | 400 `same_branch` |
| LCA = `src.head` (src is an ancestor of dst) | 200 `already_merged: true` — no commit created |
| LCA = `dst.head` (dst is an ancestor of src) | 200 `fast_forward: true` — advance head, no merge commit |
| Identical change on both sides | Auto-merge, no conflict |
| Delete on both sides | Auto-merge (item gone), no conflict |
| Delete on src + modify on dst | `delete-modify` conflict |
| Source branch emptied (delete all menus) + main intact | Massive conflicts list (delete-modify for each item recently modified on main) |
| Stale heads between 1st call and /resolve | 409 `stale_merge`, user retries from scratch |
| `resolutions` missing a conflict key | 400 `missing_or_extra_resolutions` |
| `resolutions` invalid value (not "src"/"dst") | 400 same |
| Pack deleted during the merge | 404 on /resolve |
| The user loses Network rights between 1st call and /resolve | 403 on /resolve |
| Diverging `assets[]` field | Skipped from the merge; dst's assets kept; not a conflict |
| Diverging `importedConnectors[]` field | Skipped likewise |
| Plugin update post-merge | `pushBundleAvailable(packId, dstBranchName, mergeCommit.contentHash)` — standard broadcast |
| Pack WIP | Not affected (the merge does not touch `packs.filesJson` / `packs.editorJson`, which are the WIP buffer of Plan 1B/1C) |

---

## 9. Testing strategy

**Unit `mergeEngine`** (~15 tests):
- 1: Empty diff (base == src == dst)
- 2: Add on src only
- 3: Add on dst only
- 4: Add same id different content → conflict
- 5: Modify on src only
- 6: Modify both same way → no conflict
- 7: Modify both different → conflict modify-modify
- 8: Delete on src, unchanged on dst → auto-merge (item deleted)
- 9: Delete on src, modified on dst → conflict delete-modify
- 10: Delete on both → auto-merge
- 11: `i18nKeys` map (5 patterns)
- 12: `canvasLayout` map
- 13: Scalar `defaultLang`
- 14: Mixed (multiple collections, mix of auto + conflicts)
- 15: `applyResolutions` correctly writes chosen values

**Unit `findLCA`** (~6 tests) — extension of `branchStorage.test.ts`:
- Same commit
- A ancestor of B
- B ancestor of A
- Linear branch from common ancestor (true 3-way case)
- Merge commit in history (parentId2 chasing)
- No common ancestor (synthetic) → throw

**REST integration** (`userBranches.test.ts` extension):
- FF case via merge-into → 200 fast_forward
- Auto-merge no conflicts → 200 + commit with parentId2 set
- Conflicts → 409 with conflict list
- Resolve all → 200 merge commit
- Resolve missing keys → 400
- Stale heads → 409 stale_merge
- 404 / 403 standard auth cases

**UI tests** (`MergeButton.test.tsx` + `MergeConflictModal.test.tsx`):
- MergeButton dialog opens, target picker works
- MergeButton submits, success toast on 200
- MergeButton 409 → opens MergeConflictModal with props
- MergeConflictModal: Confirm disabled until all resolutions
- MergeConflictModal: Confirm → POST resolve + onResolved called
- MergeConflictModal: Cancel → no API call
- Stale merge → error display + close

**Docker smoke (manual)**:
1. Create pack on main, branch dev, edit different menus on each, click Merge → auto-merge → both menus present
2. Both branches edit the same menu → conflict modal → resolve → main updated
3. Verify plugin gets bundle_available broadcast after merge

---

## 10. Out of scope / future work

- **Per-field merge**: for when a conflicting item has just 1 field that differs and the other is forced entirely. Possible Phase 3.5.
- **Octopus merge**: >2 parents. Not necessary (classic git workflow: sequential merges).
- **Merge previews**: see the full diff before clicking "Confirm merge". Possible future addition.
- **Reset WIP to branch HEAD**: separate feature to refresh the WIP after a merge if the user wants to edit the merged version.
- **`assets[]` cleaning**: this field on `Pack` is probably redundant with the `assets` table (Plan 1B). Audit + removal to be seen in a separate plan.
- **Auto-resolve heuristics**: "most recent wins", "fast-forward always acceptable even if diverged when there is no conflict", etc. For now: user always chooses.

---

## 11. Open questions settled at plan time

- **Re-derive filesJson**: backend port of the editor code OR client sends filesJson in /resolve. The plan will decide depending on the complexity of the port.
- **UI naming**: "Merge…" vs "Merge into…" vs "Reconcile…" — UX detail to validate at mockup time.
- **Compact preview of items in MergeConflictModal**: which granularity (just "modified" / "deleted" / inline summary) — to see with a mockup.

---

**Spec validated. Next step: `superpowers:writing-plans`.**
