# Pack → Project Full-Stack Rename — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the whole codebase speak the canonical domain language from `CONTEXT.md`: rename the content-collection entity `pack` → **Project** (UI label `Workspace` → **Project**), and the project-level `element` umbrella → **Document**, across editor + backend + plugin + DB + REST + WS + docs.

**Architecture:** Staged, layer-by-layer internal renames that each keep their layer's test suite green, followed by ONE atomic cross-layer **wire flip** (REST URL segments, WS JSON field names, on-disk manifest fields). Nothing is deployed to prod, so we rename **in place on `v1`** (no `/api/v2`, no `menu/v2`, no compat shims) and reset dev data instead of writing data-preserving migrations. The pack/bundle **hash algorithm is preserved byte-for-byte** (only symbols/paths around it are renamed).

**Tech Stack:** Editor React 19 + Vite + TanStack Router + i18next + Zustand + Konva; Backend Bun + Hono + Drizzle/PostgreSQL; Plugin Kotlin 2.0 + Paper 1.21.4.

---

## Strategy & Invariants

1. **In-place on v1.** REST stays under `/api/v1/` — only the `packs` path segment becomes `projects`. `menu/v1` schema stays `v1` (we only fix description prose; the `ConnectorBinding` *type* is correct per the glossary and stays). WS `protocol_version` stays `"1"`. No coexistence layer because there are no deployed consumers.
2. **Data reset, not data migration.** The DB rename ships as a normal forward-only Drizzle migration (`bun run db:generate`); dev/test data is wiped and reseeded. No `ALTER ... RENAME` gymnastics to preserve rows.
3. **Hash is sacred.** `BundleHasher` (plugin) and `hashUtils.computeBundleHash` (backend) hash a **relPath-keyed map sorted in native byte order**, relative to the project root. The dir name (`packs/` → `projects/`) is **not** part of any hash. The shared conformance vector's `expectedHash` values and relPath keys **do not change**. We rename only the vector's filename + its `packId` JSON field + Kotlin/TS symbol names. **Every phase that touches a hash path re-runs the conformance tests and they must stay green with unchanged expected hashes.**
4. **Staging keeps each commit green.** Order: (1) Editor internal, (2) Backend internal + DB, (3) Plugin internal, (4) Wire flip (atomic, all 3 layers), (5) Docs/schema/glossary/CHANGELOG. Phases 1–3 are independent and may run in any order or in parallel branches; each keeps the *wire* (URL strings + JSON field names) on the old `pack` names so the running stack still talks. Phase 4 flips the wire in lockstep.
5. **Bulk renames are mechanical but guarded.** Most of the ~4000 references are simple identifier renames. The danger is `pack` that means **resource pack** (textures/fonts) — every bulk-rename task lists an explicit DO-NOT-TOUCH set and uses symbol-scoped replacement, never a blind global `pack→project`.

---

## Canonical Naming Map

| Old | New | Notes |
|---|---|---|
| `pack` / `packId` (identifiers) | `project` / `projectId` | lowercase code identifiers |
| `Pack`, `PackId`, `PackSource`, `PackSummary` | `Project`, `ProjectId`, `ProjectSource`, `ProjectSummary` | types |
| `PackBundle`, `PackReader`, `PackDeleter`, `PackFilesReader` | `ProjectBundle`, `ProjectReader`, `ProjectDeleter`, `ProjectFilesReader` | plugin classes (token `Pack`→`Project`) |
| `Bundle`, `BundleHasher`, `BundleDownloader`, `BundleUploader` | **unchanged** | **Bundle** is canonical (deploy artifact) |
| `Workspace*` (components/routes/strings) | `Project*` | UI label |
| project-level `element` / `ElementView` / `usePackElements` / `PackElementItem` | `Document` / `DocumentView` / `useProjectDocuments` / `ProjectDocumentItem` | **NOT** the menu-slot `Element` |
| menu-slot `Element`, `ElementId`, `Layer.elements[]`, `visitElementLTexts`, `elementId()` | **unchanged** | menu-building block — stays `Element` |
| DB tables `packs`, `packCommits`, `packBranches` | `projects`, `projectCommits`, `projectBranches` | + all `packId` columns → `projectId`, indexes `pack_*`→`project_*` |
| REST `/api/v1/packs`, `/user/packs`, `/editor-session/:token/packs`, `/bundles/:packId`, `/networks/:id/packs/:packId/branches` | `…/projects`, `…/bundles/:projectId`, `…/projects/:projectId/branches` | path segment only; stays `/api/v1` |
| JSON body `pack_name`, `pack_id` (link claim, manifest, export) | `project_name`, `project_id` | wire — flip in Phase 4 |
| WS fields `local_pack_ids`, `pack_hashes`, `deleted_pack_ids`, `pack_id` | `local_project_ids`, `project_hashes`, `deleted_project_ids`, `project_id` | wire — flip in Phase 4 |
| WS msg `PackDeletedMessage` / `"pack_deleted"` | `ProjectDeletedMessage` / `"project_deleted"` | type name (internal) + wire string (Phase 4) |
| disk dir `plugins/Artisan/packs/<id>/` | `plugins/Artisan/projects/<id>/` | plugin-owned; prefix literal in `hashCanonical` updated in lockstep |
| `testdata/pack-hash-conformance.json` (+ field `packId`) | `testdata/project-hash-conformance.json` (+ field `projectId`) | content (files, expectedHash) **unchanged** |
| `/artisan pushLocal <pack_id>` | `/artisan pushLocal <project_id>` | subcommand name `pushLocal` kept (verb); arg + help renamed |

**DO-NOT-RENAME (resource pack & sentinels), all layers:**
- Editor: `lib/mcModelRenderer*`, title-composer "resource pack" comments, `features/canvas/Library.tsx` renderer import.
- Backend: `lib/resourcePack.ts`, `lib/resourcePackBuilder.ts`, `lib/resourcePackStorage.ts`, `routes/resourcePack.ts`, `lib/rpCodepointMerger.ts`, env `RESOURCE_PACK_BASE_URL`.
- Plugin: `ResourcePackManager.kt`, `ResourcePackDelegator.kt`, `AssetCatalog.kt`, config `resource-pack.*` keys, `.artisan-trash/`, `.artisan-sync.yaml`.
- Plugin `PackCommand.kt` — **verify first**: its role is "binds a compiled menu/command to execution". If it is the *Project* entity, rename `→ ProjectCommand`; if it means a packaged/compiled command, leave it. Decide in Phase 3, Task 3.1.

---

## Risk Register

| Risk | Mitigation |
|---|---|
| Blind `pack→project` corrupts resource-pack code | Symbol-scoped renames; explicit DO-NOT-TOUCH list per task; `tsc`/`gradlew` after each. |
| Hash drift plugin↔backend | Conformance vector content unchanged; re-run `BundleHashConformanceTest` (plugin) + `hashUtils.test.ts` (backend) after Phases 3 & 4 — expected hashes must be identical to pre-refactor. |
| Drizzle generates drop+create losing data | Acceptable (dev data reset). Review generated SQL; ensure FKs/indexes recreated. Run `db:push` (dev) + `db:generate` (commit migration). |
| TanStack route-tree desync | Rename route files, let codegen regenerate `routeTree.gen.ts`, fix `to:`/`params`/`useParams` refs, `tsc`. |
| Partial wire flip breaks live stack | Phase 4 is one atomic commit across backend+editor+plugin; full `docker compose up` smoke after. |
| 65 pre-existing tsc errors in test files (canvas-nav WIP) | Use **delta** verification: no NEW tsc errors vs. the phase's baseline; suites (`npm test`/`bun run test`/`gradlew test`) must pass. |

---

## Phase 0: Prep

**Files:** none (git + baseline).

- [ ] **Step 1: Branch from up-to-date main**

```bash
rtk git fetch origin
rtk git switch -c refactor/pack-to-project origin/main
```
(Ensure the `docs: build out domain glossary` commit is in the base; cherry-pick it if it only lives on `feat/canvas-nav-and-texture-align`.)

- [ ] **Step 2: Capture baselines (delta references)**

```bash
cd editor && rtk npm test 2>&1 | tail -5 ; rtk tsc -p tsconfig.json --noEmit 2>&1 | rtk summary
cd ../backend && rtk bun run test 2>&1 | tail -5
cd ../plugin && ./gradlew test 2>&1 | tail -5
```
Record pass counts + the pre-existing tsc error count. These are the "no regression" bars.

---

## Phase 1: Editor internal rename (wire untouched)

The editor's API client keeps calling `/api/v1/packs` with `pack_id` bodies until Phase 4. Everything *internal* becomes Project/Document.

**Files (from inventory):** `domain/types.ts`, `domain/ids.ts`, `domain/i18nSites.ts`; `lib/packApi.ts`, `lib/api/packs.ts`, `lib/api/userPacks.ts`, `lib/api/networks.ts`; `state/accountStore.ts`, `state/uiStore.ts`, `routes/__root.tsx`; `features/account/*` (`PackMini*`, `NewPackDialog`, `DeletePackDialog`, `packFileIo`), `features/canvas/properties/PackProperties.tsx`, `features/sync/DeletePackDialog.tsx`, `features/pack/*`; the `Workspace*` components; `features/workspace/*` (→ Document); `locales/en.ts`, `locales/fr.ts`; route files.

- [ ] **Task 1.1 — Domain types.** Rename in `domain/types.ts`/`ids.ts`/`i18nSites.ts`: `Pack→Project`, `PackId→ProjectId`, `PackSource→ProjectSource`, `packId()→projectId()`, `newPackId()→newProjectId()`, `rekeyPack()→rekeyProject()`. **Keep** `Element`, `ElementId`, `Layer.elements`, `visitElementLTexts`, `elementId()`, `newElementId()`. Verify: `rtk tsc` (delta) + `rtk npm test -- domain`.
- [ ] **Task 1.2 — API client (internal names only).** Rename functions/types in `lib/packApi.ts`→`lib/projectApi.ts`, `lib/api/packs.ts`→`lib/api/projects.ts`, `lib/api/userPacks.ts`→`lib/api/userProjects.ts`, `PackSummary→ProjectSummary` (networks.ts). **Keep the URL strings and `pack_id` request/response field names** (those flip in Phase 4 — leave a `// TODO(phase4-wire): pack_*` marker at each wire string). Update imports. Verify: `rtk tsc` + `rtk npm test -- api`.
- [ ] **Task 1.3 — Stores & autosave.** `accountStore.createPack/importPack/replacePack → createProject/importProject/replaceProject`; `uiStore.lastActivePackId/setLastActivePackId → lastActiveProjectId/...`; `usePackAutoSave→useProjectAutoSave` (`routes/__root.tsx`). Verify: `rtk npm test -- accountStore uiStore`.
- [ ] **Task 1.4 — Components (`Pack*`/`Workspace*` → `Project*`).** Rename files + symbols: `PackMini→ProjectMini`, `PackMiniPreview/Sidebar`, `NewPackDialog→NewProjectDialog`, both `DeletePackDialog→DeleteProjectDialog`, `PackProperties→ProjectProperties`; `WorkspaceSidebar→ProjectSidebar`, `WorkspaceTabs/WorkspaceTab→ProjectTabs/ProjectTab`, `WorkspaceTopBarControls→ProjectTopBarControls`, `NewWorkspaceDialog→NewProjectDialog` (merge naming with NewProjectDialog — pick one, dedupe), `NewWorkspaceModal→NewProjectModal`, `WorkspacePanel→ProjectPanel`. Verify: `rtk tsc` + `rtk npm test`.
- [ ] **Task 1.5 — `element` → `Document` (project level ONLY).** Rename `features/workspace/` → `features/project/`: `ElementView→DocumentView`, `usePackElements→useProjectDocuments` (`PackElementItem→ProjectDocumentItem`, `PackElementGroup→ProjectDocumentGroup`, `ElementType→DocumentType`, `buildPackElements→buildProjectDocuments`, `elementLabel→documentLabel`). **Cross-check** none of the menu-slot `Element` symbols (Task 1.1 keep-list) are caught. Verify: `rtk tsc` + `rtk npm test -- project`.
- [ ] **Task 1.6 — Routes + route tree.** Rename route files: `pack.$packId.tsx→project.$projectId.tsx`, `workspace.$workspaceId.tsx→project.$projectId.tsx` (dedupe redirect routes), `networks.$networkId.servers.$serverId.workspaces.$workspaceId.tsx→…servers.$serverId.projects.$projectId.tsx`, `.element.$elementId.tsx→.document.$documentId.tsx`, and the matching `*.test.tsx`/`*.detailShell.test.tsx`. Update every `navigate({to})`, `<Link to>`, `useParams`, `params:{}` (`$workspaceId→$projectId`, `$elementId→$documentId`; keep `$serverId`, `$networkId`). Regenerate the route tree (run `npm run dev` once or the route-gen step), commit `routeTree.gen.ts`. Verify: `rtk tsc` + `rtk npm test -- routes`.
- [ ] **Task 1.7 — i18n keys + strings.** In `locales/en.ts` & `locales/fr.ts`, rename key trees `packMini→projectMini`, `newPackDialog→newProjectDialog`, `packProperties→projectProperties`, `deletePackDialog→deleteProjectDialog`, `workspace→project`, `workspacePanel→projectPanel`, `elementView→documentView`, `sync.deletePackDialog→sync.deleteProjectDialog`, `setupWizard.step3.*` workspace keys, `newWorkspaceModal→newProjectModal`; and change English/French **values** "Workspace(s)"→"Project(s)", "Espace de travail"→"Projet" etc. Update all `t("…")` call sites. Run the i18n usage check (`i18nUsages.test.ts`) — zero missing/orphan keys. Verify: `rtk npm test -- i18n locales`.
- [ ] **Task 1.8 — Full editor green + commit.**
```bash
cd editor && rtk npm test && rtk npm run build
rtk git add editor/src editor/src/locales && rtk git commit -m "refactor(editor): rename pack→Project, Workspace→Project, element→Document (internal; wire unchanged)" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Phase 2: Backend internal rename + DB migration (wire untouched)

REST URL strings and WS JSON field names stay `pack_*` until Phase 4. Internal TS symbols + DB schema become Project.

**Files:** `db/schema.ts`; `lib/packStorage.ts`, `lib/packImport.ts`, `lib/slugAlloc.ts`/`backfillSlugs.ts` (pack-named helpers), `lib/hashUtils.ts`; `routes/*` (internal handler vars only); `protocol.ts`/`ws/hub.ts` (type names + internal vars, NOT wire field strings); tests `packStorage.test.ts`, `packImport.test.ts`, `userPacks.test.ts`, + indirect.

- [ ] **Task 2.1 — Schema rename.** In `db/schema.ts`: tables `packs→projects`, `packCommits→projectCommits`, `packBranches→projectBranches`; columns `packId→projectId` (in `projectCommits`, `projectBranches`, `assets`, `assistantConversations`); indexes `packs_*→projects_*`, `pack_commits_*→project_commits_*`, `pack_branches_*→project_branches_*`, `assets_pack_*→assets_project_*`; update `relations()` blocks. **Keep** the `assets` table name (it's Assets, not pack). Verify: `rtk tsc`.
- [ ] **Task 2.2 — Generate + apply migration.**
```bash
cd backend && rtk bun run db:generate   # creates drizzle/NNNN_*.sql
# review the SQL (rename or drop+create — both OK, data reset acceptable)
rtk bun run db:push                      # dev DB
```
Commit the generated `drizzle/NNNN_*.sql`. Verify: migration applies clean on a fresh DB.
- [ ] **Task 2.3 — Storage/lib.** `packStorage.ts→projectStorage.ts` (`createPack→createProject`, `getPack→getProject`, `upsertPackContent→upsertProjectContent`, `softDeletePack→softDeleteProject`, `listPacksForNetwork→listProjectsForNetwork`, type `Pack→Project`); `packImport.ts→projectImport.ts` (`importPackFromFiles→importProjectFromFiles`, etc.); rename pack-named slug helpers. Keep `hashUtils` function names but rename internal `packId` vars → `projectId`. **Confirm** `hashUtils` works in relPaths with no `plugins/Artisan/packs/` prefix literal (plugin-side concern only); if a prefix literal exists here, it joins the Phase 4 lockstep. Verify: `rtk tsc` + `rtk bun run test`.
- [ ] **Task 2.4 — Route handlers (internal vars only).** In every route file, rename local `packId`/`pack` vars → `projectId`/`project` and Drizzle calls to the renamed tables. **Do NOT** change the route path strings (`/packs`) or the parsed request field names (`pack_id`, `pack_name`) yet — mark each with `// TODO(phase4-wire)`. Verify: `rtk bun run test`.
- [ ] **Task 2.5 — Protocol type names.** In `protocol.ts`, rename message *type* identifiers (`PackDeletedMessage→ProjectDeletedMessage`) and hub function names (`pushPackDeleted→pushProjectDeleted`, etc.). **Keep the JSON field names** (`pack_id`, `pack_hashes`, …) as-is — Phase 4. Verify: `rtk bun run test`.
- [ ] **Task 2.6 — Backend green + commit.**
```bash
cd backend && rtk bun run test
rtk git add backend/src backend/drizzle && rtk git commit -m "refactor(backend): rename pack→project incl. DB tables/columns (internal; wire+migration)" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Phase 3: Plugin internal rename (hash-safe; wire untouched)

**Files:** `yaml/PackReader.kt`, `model/PackBundle.kt`, `sync/PackDeleter.kt`, `sync/BundleUploader.kt` (`PackFilesReader`), `command/PackCommand.kt` (verify), `ArtisanPlugin.kt`, `command/ArtisanCommand.kt`, `sync/BundleHasher.kt`, `sync/BundleDownloader.kt`, `provider/SyncedMenuProvider.kt`, `sync/LocalPushSender.kt`, `sync/SyncMetadata.kt`; tests + `testdata/pack-hash-conformance.json`.

- [ ] **Task 3.1 — Decide `PackCommand`.** Read `command/PackCommand.kt`. If it represents the Project entity → rename `ProjectCommand`. If it binds a *compiled command document* → leave its name, note the decision in the commit body.
- [ ] **Task 3.2 — Classes.** `PackReader→ProjectReader`, `PackBundle→ProjectBundle`, `PackDeleter→ProjectDeleter`, `PackFilesReader→ProjectFilesReader`; rename `packId`/`packsRoot`/`packsDir`/`packDir` params+vars → `projectId`/`projectsRoot`/`projectsDir`/`projectDir`. **Keep** `Bundle*` class names and `.artisan-trash`/`.artisan-sync.yaml`. Verify: `./gradlew compileKotlin`.
- [ ] **Task 3.3 — On-disk dir.** Change `File(dataFolder, "packs")` → `File(dataFolder, "projects")` in `ArtisanPlugin.kt` (both refs). Update the `hashCanonical` prefix literal `"plugins/Artisan/packs/$projectId/"` → `"plugins/Artisan/projects/$projectId/"`. **This does not change any hash** (prefix is stripped to derive the unchanged relPath). Verify next task proves it.
- [x] **Task 3.4 — Hash conformance (must stay green, hashes unchanged).** Rename `testdata/pack-hash-conformance.json`→`project-hash-conformance.json`, its `packId` field→`projectId`; **leave `files` and `expectedHash` byte-identical.** Update `BundleHashConformanceTest.kt` (and backend `hashUtils.test.ts` reference if shared path). Run:
```bash
cd plugin && ./gradlew test --tests "*BundleHashConformanceTest*"
cd ../backend && rtk bun run test hashUtils
```
Both green with **identical expected hashes** to Phase 0 baseline. If any hash changed → STOP, revert, the relPath derivation drifted.
- [ ] **Task 3.5 — `pushLocal` command surface.** In `ArtisanCommand.kt`: arg `<pack_id|--all>`→`<project_id|--all>`, usage string `"/artisan pushLocal <project_id|--all>"`, tab-completion comment/vars. Keep subcommand token `pushLocal`. Verify: `./gradlew test --tests "*ArtisanCommand*"`.
- [ ] **Task 3.6 — Plugin green + commit.**
```bash
cd plugin && ./gradlew test
rtk git add plugin/src plugin/src/test plugin/testdata && rtk git commit -m "refactor(plugin): rename Pack*→Project*, packs/→projects/ dir (hash preserved; wire unchanged)" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Phase 4: Wire flip (ATOMIC — backend + editor + plugin together)

One commit. Flips REST path segments, REST/WS/manifest JSON field names. After this, search the whole repo for `pack_id`, `pack_name`, `pack_hashes`, `local_pack_ids`, `deleted_pack_ids`, `/packs`, `pack_deleted` → all gone (except resource-pack & history).

- [ ] **Task 4.1 — Backend REST paths.** `/api/v1/packs→/projects`, `/user/packs→/user/projects`, `/editor-session/:token/packs→…/projects` (+ `:packId→:projectId`), `/bundles/:packId→/bundles/:projectId`, `/networks/:id/packs/:packId/branches→…/projects/:projectId/branches`, assets `…/packs/:packId/assets→…/projects/:projectId/assets`. Update Hono route registration + param reads.
- [ ] **Task 4.2 — Backend wire fields.** `protocol.ts` interface fields + `ws/hub.ts` + `routes/link.ts` body: `pack_id→project_id`, `pack_name→project_name`, `pack_hashes→project_hashes`, `local_pack_ids→local_project_ids`, `deleted_pack_ids→deleted_project_ids`, `"pack_deleted"→"project_deleted"`. Resolve all `// TODO(phase4-wire)` markers.
- [ ] **Task 4.3 — Editor wire.** In `lib/projectApi.ts`/`lib/api/projects.ts`/`userProjects.ts`: URL strings → `/projects`, request/response fields `pack_*→project_*`. Export manifest writer (`features/export/transform.ts`, `buildZip`) + validators: `pack_id→project_id`, `meta.pack_id→meta.project_id`. Resolve all `// TODO(phase4-wire)`.
- [ ] **Task 4.4 — Plugin wire.** `WsClient.kt` `"local_pack_ids"→"local_project_ids"`; `SyncedMenuProvider.kt` `"pack_hashes"/"deleted_pack_ids"/"pack_id"/"pack_deleted"` → `project_*`; `LocalPushSender.kt` `"pack_id"→"project_id"`; bundle download URL `/api/v1/bundles/:packId`→`/api/v1/bundles/:projectId` (the `:packId` path param only — `/bundles` stays). Manifest field reads in `ProjectReader.kt` (`pack_id→project_id` if present — confirm vs `id`).
- [ ] **Task 4.5 — Cross-stack verify + commit.**
```bash
cd editor && rtk npm test && rtk npm run build
cd ../backend && rtk bun run test
cd ../plugin && ./gradlew test
docker compose up --build   # manual smoke: editor edits → backend → plugin hot-reload; pushLocal; delete propagation
rtk git add -p   # stage the three layers' wire changes explicitly
rtk git commit -m "refactor: flip pack→project on the wire (REST paths, WS fields, manifest) across editor+backend+plugin" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Phase 5: Docs, schema prose, glossary, CHANGELOG

- [ ] **Task 5.1 — Architecture docs.** Update `docs/architecture/ws-protocol.md` (field renames), `rest-endpoints.md` (URL renames), `entities.md` (table renames), `editor-internals.md` (Workspace→Project, element→Document), `modules.md` ("business module"→**Add-on**, "data source" as the canonical provider term, keep "Connector binding" for the menu ref).
- [ ] **Task 5.2 — Schema prose.** In `docs/schema/menu/v1/{types.ts,schema.json,README.md}`: in *descriptions only*, change "connecteur"/"connector" used for the **provider** → "data source"; keep the `ConnectorBinding` type name (it is the consumer-side binding, correct per glossary). No structural/field changes → `menu/v1` stays valid. Re-run editor schema fixtures (`validateMenuV1`) green.
- [ ] **Task 5.3 — Operational docs.** `CLAUDE.md`: packs dir `plugins/Artisan/packs/`→`projects/`, `pushLocal <packId>`→`<projectId>`, the doc-impact table row wording. `docs-site/.../install-admin.md`: commands table (`pushLocal`), any "pack" user-facing wording. `.claude/skills/sync-docs/doc-impact-map.yaml` if it keys on filenames.
- [ ] **Task 5.4 — Glossary clause.** In `CONTEXT.md` **Project** entry, rewrite the acceptance clause: code/DB/API/UI **now all say `project`** (historically `pack` / `Workspace`). Keep the "pack collides with resource pack" rationale as the *why*.
- [ ] **Task 5.5 — CHANGELOG.** Add `[Unreleased]` entries: REST endpoints renamed `/packs→/projects`, WS fields renamed, `net.artisanmc.modules.api.*` surface impact if any (the `DataSourceRegistry` naming is unchanged; note the entity rename).
- [ ] **Task 5.6 — Commit.**
```bash
rtk git add CONTEXT.md CHANGELOG.md docs docs-site .claude && rtk git commit -m "docs: align all docs + glossary to project/Add-on/data-source terminology" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Verification Matrix

| After phase | Run | Bar |
|---|---|---|
| 1 | `cd editor && npm test && npm run build` | suites pass; build exit 0; no NEW tsc errors |
| 2 | `cd backend && bun run test`; fresh-DB migrate | suites pass; migration clean |
| 3 | `cd plugin && ./gradlew test` | suites pass; **conformance hashes unchanged** |
| 4 | all three suites + `docker compose up` smoke | green; live editor→backend→plugin loop works |
| 5 | `npm test -- validateMenuV1`; docs build | schema fixtures green; docs build |

**Final sweep:** `rg -n 'pack_id|pack_name|pack_hashes|local_pack_ids|/packs|PackSummary|Workspace|usePackElements' --glob '!**/archive/**' --glob '!**/*.gen.ts'` returns only resource-pack hits and historical/CHANGELOG references.

---

## Execution Handoff

Recommended: **subagent-driven-development**, one subagent per Task, spec + quality review between tasks. Phases 1–3 can be parallelized across worktrees if desired (they don't touch each other); Phase 4 must run after all three land. Phase 5 can overlap Phase 4's review.
