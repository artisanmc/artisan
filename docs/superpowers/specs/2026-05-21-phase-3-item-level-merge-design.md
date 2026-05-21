# Phase 3 — Item-level merge

**Status:** Design approved by Iban (2026-05-21). Ready for `writing-plans`.
**Scope:** backend (schema + LCA + merge engine + REST), editor (MergeButton + MergeConflictModal). No plugin changes.

---

## TL;DR

Permettre 2 branches d'un même pack de **diverger** (plusieurs commits chacune), puis être **réconciliées** via un merge sémantique **par item top-level** (menu / command / dialog / template / dataSource). Pas de granularité champ-par-champ — on prend l'item entier d'un côté ou de l'autre. Les changements non-collisionnels s'auto-mergent. Les vrais conflits ouvrent un modal où l'user choisit `src` ou `dst` par conflit.

Le résultat est un **merge commit** avec deux parents (`parentId` + `parentId2`).

---

## 1. Goals + non-goals

**Goal :** Workflow type "dev → main avec divergences possibles" qui marche sans force-push. L'user committe sur dev, committe sur main, puis fait "Merge dev → main" qui réconcilie. Pas de perte de travail (sauf choix explicite via la résolution).

**Non-goals (deferred ou hors scope) :**
- Merge field-level (champ par champ à l'intérieur d'un item) — deferred Phase 3.5 si un cas d'usage l'impose.
- Octopus merge (>2 parents).
- Rebase / cherry-pick.
- Auto-resolve heuristics ("le plus récent gagne").
- Free-form merge edit (raw YAML).
- Merge sur le WIP — user doit committer d'abord.
- Revert.
- "Reset WIP to branch HEAD".

---

## 2. Architecture

3 chunks isolés :

```
backend/src/lib/mergeEngine.ts            ← diff + merge + conflict detection (pure, no DB)
backend/src/lib/branchStorage.ts          ← extended with findLCA(commitA, commitB)
backend/src/db/schema.ts                  ← pack_commits.parentId2 nullable
backend/src/routes/userBranches.ts        ← 2 new endpoints: merge-into + resolve
editor/src/lib/api/branches.ts            ← mergeBranches + resolveMerge
editor/src/features/branches/MergeButton.tsx          ← trigger + dialog
editor/src/features/branches/MergeConflictModal.tsx   ← per-conflict radio picker
```

Le plugin ne change pas. Le hub broadcaste `bundle_available` au dst branch après le merge — les server_keys bindés à `(packId, dstBranchName)` re-pull le pack.

---

## 3. Schema

```ts
// backend/src/db/schema.ts — modify packCommits:
export const packCommits = pgTable("pack_commits", {
  // ... existing fields (id, packId, parentId, contentHash, filesJson, editorJson, authorUserId, message, createdAt) ...
  parentId2: text("parent_id_2"),    // 2nd parent on merge commits, null otherwise
});
```

Migration : `ALTER TABLE pack_commits ADD COLUMN parent_id_2 TEXT` via `bun run db:push`. Aucun backfill (existing commits restent `parentId2 = null`).

---

## 4. LCA algorithm

`findLCA(commitIdA, commitIdB) → string` dans `branchStorage.ts`.

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

Cas spéciaux :
- `a === b` → return `a`
- `a` est ancestor de `b` → BFS depuis `b` trouve `a` avant que BFS depuis `a` trouve rien (queue épuisée) → return `a`
- Pas d'ancestor commun → throw (théoriquement impossible vu que tous les commits viennent du `Initial commit` racine du pack)

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

### Collections gérées

| Field on Pack | Diff key | Auto-merge | Conflict cases |
|---|---|---|---|
| `menus[]` | `menu.id` | yes | modify-modify, delete-modify |
| `commands[]` | `command.id` | yes | idem |
| `dialogs[]` | `dialog.id` | yes | idem |
| `templates[]` | `template.id` | yes | idem |
| `dataSources[]` | `dataSource.id` | yes | idem |
| `i18nKeys` | string key | yes | both modified different strings |
| `canvasLayout` | string key (entity id) | yes | both modified to different `(x,y)` |
| `defaultLang` | scalar | yes | both modified to different lang |
| `name`, `description` | scalar | yes | idem |
| `assets[]` | (skip — managed via separate API) | n/a | n/a |
| `importedConnectors[]` | (skip — referenced externally) | n/a | n/a |

### Algo (par collection-by-id)

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

Pour `i18nKeys` et `canvasLayout` (maps) : même logique, key = string. Pour scalars : `deepEqual(base, src), deepEqual(base, dst)` direct, conflict si changedBoth-different.

`deepEqual` = stable JSON stringify comparison (key-sorted).

### `applyResolutions(mergedState, conflicts, resolutions: Record<conflictKey, "src"|"dst">) → EditorState`

Pour chaque conflit, écrit la valeur choisie (depuis `conflict.srcValue` ou `conflict.dstValue`) dans le `mergedState` à la position correspondante (parsing `conflict.conflictKey` pour retrouver le collection + id). Si la valeur choisie est `null` (deletion), supprime l'entrée. Retourne le state final.

### Re-derivation `editorJson → filesJson`

Le merge engine produit un `editorJson` (le `EditorState`). Pour le commit, il faut aussi un `filesJson` (YAMLs des menus, dialogs, etc.). Le pipeline `editor → files` existe côté éditeur (`packApi.savePack` envoie les 2 en parallèle). Pour le merge backend-side, on doit :
- Soit appeler une fonction `derivefilesFromEditor(editorState) → Record<string, string>` (à implémenter ou réutiliser).
- Soit demander au client de re-derive et de poster le filesJson dans /resolve.

**Décision** : backend re-derive. Plan d'impl : extraire la fonction de re-derive depuis l'éditeur (probablement déjà dans un module domaine) vers un module partagé `lib/derivePackFiles.ts` (côté backend, port du code éditeur). **Risque** : si la logique est trop côté React, on fait porter par le client (POST resolve avec `{resolutions, derivedFiles}`).

L'arbitrage se fait pendant l'impl du plan — la spec autorise les deux.

---

## 6. REST API

### `POST /api/networks/:id/packs/:packId/branches/:src/merge-into/:dst`

Body : `{message?: string}` optionnel.

Logique :
1. Auth (`requireMember`) + branches `src` et `dst` existent (404 sinon).
2. `src === dst` → 400 `same_branch`.
3. `lca = findLCA(src.head, dst.head)`.
4. `lca === src.head` → 200 `{advanced: false, already_merged: true}` (no-op).
5. `lca === dst.head` → fast-forward : `advanceBranchHead(packId, dst, src.head)`, broadcast, 200 `{advanced: true, fast_forward: true, head_commit_id: src.head}`.
6. Sinon 3-way :
   - Load base + src + dst editorJsons.
   - `result = mergeEngine.merge(...)`.
   - Si `merged` : derive filesJson, `createCommit({parentId: dst.head, parentId2: src.head, ..., message: body.message ?? \`Merge ${src} into ${dst}\`})`. `advanceBranchHead(packId, dst, mergeCommit.id)`. Broadcast. 200 `{advanced: true, fast_forward: false, head_commit_id: mergeCommit.id}`.
   - Si `conflicts` : 409 `{error: "conflicts", conflicts, lcaCommitId, srcCommitId, dstCommitId}`.

### `POST /api/networks/:id/packs/:packId/branches/:src/merge-into/:dst/resolve`

Body :
```json
{
  "resolutions": { "menus:menu_abc": "src", "i18nKeys:hello": "dst" },
  "lcaCommitId": "cmt_...", "srcCommitId": "cmt_...", "dstCommitId": "cmt_...",
  "message": "..." (optional)
}
```

Logique :
1. Auth + branches existent.
2. Validate heads non-stale : `src.head === body.srcCommitId && dst.head === body.dstCommitId`. Sinon 409 `stale_merge`.
3. Re-run `mergeEngine.merge(lca, src, dst)`. Get `mergedState + conflicts`.
4. Validate `Object.keys(resolutions)` couvre exactement `conflicts.map(c => c.conflictKey)`. Sinon 400 `missing_or_extra_resolutions`.
5. Validate values are `"src"` or `"dst"`.
6. `finalState = applyResolutions(mergedState, conflicts, resolutions)`.
7. Derive filesJson, createCommit + advance + broadcast.
8. 200 `{commit: mergeCommit, head_commit_id: mergeCommit.id}`.

---

## 7. UI

### `MergeButton` (`editor/src/features/branches/MergeButton.tsx`)

Frère de `PromoteButton`. Props : `{ networkId, packId, sourceBranch, allBranches }`.

Render : `<Button>Merge…</Button>` qui ouvre un dialog.

Dialog :
- Header : "Merge {sourceBranch} into …"
- Select "Target branch" (exclut `sourceBranch`).
- `<Input>` optional commit message.
- Buttons : "Cancel" / "Start merge".

Submit → `mergeBranches(networkId, packId, src, dst, message)`.

Branches du flow :
- 200 `already_merged` → toast neutral "Already up to date".
- 200 `fast_forward` → toast success "Fast-forwarded".
- 200 classic merge → toast success "Merged (auto)".
- 409 conflicts → ouvre `<MergeConflictModal>` avec les conflits + lcaCommitId/srcCommitId/dstCommitId.
- autre erreur → message d'erreur dans le dialog.

### `MergeConflictModal` (`editor/src/features/branches/MergeConflictModal.tsx`)

Props :
```ts
{
  networkId, packId, src, dst, conflicts, lcaCommitId, srcCommitId, dstCommitId,
  onResolved: (mergeCommitId: string) => void,
  onCancel: () => void,
}
```

Layout :
- Header : "Resolve {conflicts.length} conflicts to merge {src} → {dst}"
- Pour chaque conflit (ordre stable par `conflictKey`) :
  - Title : human-readable label (e.g. `"Menu shop"` si `collection:"menus"` + on retrouve le name dans srcValue/dstValue ; sinon `"menus: menu_abc"`).
  - Description : "Both sides modified this menu" / "{src} deleted, {dst} modified" / etc.
  - Radio :
    - `[ ] Use {src}'s version` + preview compact (e.g. menu rows count, # of layers).
    - `[ ] Use {dst}'s version` + preview idem.
  - (Pas d'option "modify manually" — out of scope.)
- Footer : "Cancel" (no commit created) / "Confirm merge" (disabled jusqu'à ce que tous les conflits aient une résolution).

Submit → POST `/resolve` avec `{resolutions, lcaCommitId, srcCommitId, dstCommitId}`. Sur success → call `onResolved(commit.id)`, close.

### Mounting dans `pack.$packId.tsx`

À côté de `<PromoteButton>` :

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

| Cas | Comportement |
|---|---|
| `src === dst` | 400 `same_branch` |
| LCA = `src.head` (src est ancestor de dst) | 200 `already_merged: true` — no commit created |
| LCA = `dst.head` (dst est ancestor de src) | 200 `fast_forward: true` — advance head, no merge commit |
| Modif identique des 2 côtés | Auto-merge, no conflict |
| Delete des 2 côtés | Auto-merge (item gone), no conflict |
| Delete sur src + modify sur dst | `delete-modify` conflict |
| Branche source vidée (delete tous les menus) + main intacte | Massive conflicts list (delete-modify pour chaque item modifié récemment sur main) |
| Stale heads entre 1er appel et /resolve | 409 `stale_merge`, user retry from scratch |
| `resolutions` missing un conflict key | 400 `missing_or_extra_resolutions` |
| `resolutions` value invalide (pas "src"/"dst") | 400 idem |
| Pack supprimé pendant le merge | 404 sur /resolve |
| Le user perd ses droits Network entre 1er appel et /resolve | 403 sur /resolve |
| `assets[]` field divergent | Skip du merge ; dst's assets gardés ; pas un conflit |
| `importedConnectors[]` field divergent | Skip pareil |
| Plugin update post-merge | `pushBundleAvailable(packId, dstBranchName, mergeCommit.contentHash)` — broadcast standard |
| WIP du pack | Pas affecté (le merge ne touche pas `packs.filesJson` / `packs.editorJson` qui sont le WIP buffer Plan 1B/1C) |

---

## 9. Testing strategy

**Unit `mergeEngine`** (~15 tests) :
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
- 14: Mixed (multiple collections, mix auto + conflicts)
- 15: `applyResolutions` correctly writes chosen values

**Unit `findLCA`** (~6 tests) — extension de `branchStorage.test.ts` :
- Same commit
- A ancestor of B
- B ancestor of A
- Linear branch from common ancestor (true 3-way case)
- Merge commit in history (parentId2 chasing)
- No common ancestor (synthetic) → throw

**Integration REST** (`userBranches.test.ts` extension) :
- FF case via merge-into → 200 fast_forward
- Auto-merge no conflicts → 200 + commit with parentId2 set
- Conflicts → 409 with conflict list
- Resolve all → 200 merge commit
- Resolve missing keys → 400
- Stale heads → 409 stale_merge
- 404 / 403 standard auth cases

**UI tests** (`MergeButton.test.tsx` + `MergeConflictModal.test.tsx`) :
- MergeButton dialog opens, target picker works
- MergeButton submits, success toast on 200
- MergeButton 409 → opens MergeConflictModal with props
- MergeConflictModal: Confirm disabled until all resolutions
- MergeConflictModal: Confirm → POST resolve + onResolved called
- MergeConflictModal: Cancel → no API call
- Stale merge → error display + close

**Docker smoke (manual)** :
1. Create pack on main, branch dev, edit different menus on each, click Merge → auto-merge → both menus present
2. Both branches edit same menu → conflict modal → resolve → main updated
3. Verify plugin gets bundle_available broadcast after merge

---

## 10. Out of scope / future work

- **Per-field merge** : pour quand un item conflit a juste 1 champ qui diffère et l'autre est forcé entièrement. Phase 3.5 possible.
- **Octopus merge** : >2 parents. Pas nécessaire (workflow git classique : sequential merges).
- **Merge previews** : voir le diff complet avant de cliquer "Confirm merge". Possible future addition.
- **Reset WIP to branch HEAD** : feature séparée pour refresh le WIP après un merge si l'user veut éditer la version mergée.
- **`assets[]` cleaning** : ce champ sur `Pack` est probablement redondant avec la table `assets` (Plan 1B). Audit + suppression à voir dans un plan séparé.
- **Auto-resolve heuristics** : "le plus récent gagne", "fast-forward toujours acceptable même si diverge si pas de conflit", etc. Pour l'instant : user choisit toujours.

---

## 11. Open questions tranchées au moment du plan

- **Re-derive filesJson** : backend port du code éditeur OU client envoie filesJson dans /resolve. Plan tranchera selon la complexité du port.
- **Naming UI** : "Merge…" vs "Merge into…" vs "Réconcilier…" — détail UX à valider au moment du mockup.
- **Preview compact des items dans MergeConflictModal** : quelle granularité (just "modified" / "deleted" / inline summary) — à voir avec un mockup.

---

**Spec validée. Prochaine étape : `superpowers:writing-plans`.**
