# Semantic Source i18n Keys Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace technical Project data-source i18n key segments with source names and keep those keys synchronized when source names or table row keys change.

**Architecture:** `visitDataSourceLTexts` remains the single source of canonical paths, but derives its source segment from `DataSource.name` and uses positional row fallbacks only for empty or duplicate Row keys. A targeted `rekeyDataSource` fold moves existing language maps to the newly canonical key after relevant store mutations; the existing pack-wide deploy rekey remains the final safety net.

**Tech Stack:** React 19, TypeScript, Zustand + Immer, Vitest.

## Global Constraints

- Preserve unrelated dirty-worktree changes.
- Follow red-green-refactor: no production change before its failing test.
- Canonical table format: `sources.<source-name>.<row-key>.<field-path>`.
- Preserve all translations when a canonical key changes.
- Update `docs/architecture/editor-internals.md` in the same change.

---

### Task 1: Canonical source paths

**Files:**
- Modify: `editor/src/domain/i18nSites.test.ts`
- Modify: `editor/src/domain/i18nSites.ts`

**Interfaces:**
- Consumes: `visitDataSourceLTexts(pack: Project, ds: DataSource)`.
- Produces: canonical sites based on `ds.name`, plus deterministic positional fallbacks for empty or duplicate Row keys.

- [x] **Step 1: Write failing visitor tests**

Add cases where `ds.id` is technical but `ds.name` is `grades`, expecting `sources.grades.vip.lore`, and where duplicate Row keys fall back to `row_1` / `row_2`.

- [x] **Step 2: Verify the tests fail**

Run: `npm test -- --run src/domain/i18nSites.test.ts`

Expected: the source-name assertion receives a path containing the technical `ds_*` ID.

- [x] **Step 3: Implement the minimal canonical path change**

Derive the source segment from `ds.name`; pre-count non-empty Row keys and use `row_<n>` when a key is empty or duplicated.

- [x] **Step 4: Verify the visitor tests pass**

Run: `npm test -- --run src/domain/i18nSites.test.ts`

Expected: PASS.

### Task 2: Live rekeying and translation preservation

**Files:**
- Modify: `editor/src/domain/i18nSites.ts`
- Modify: `editor/src/state/accountStore.test.ts`
- Modify: `editor/src/state/accountStore.ts`

**Interfaces:**
- Produces: `rekeyDataSource(pack: Project, ds: DataSource): void`.
- Consumes: existing `moveLTextKey`, `visitDataSourceLTexts`, and store mutations.

- [x] **Step 1: Write failing store tests**

Assert that changing a row's declared Row key moves every language from the old key to `sources.<name>.<new-row-key>.<field>`, and renaming the source moves the same map to the new source prefix.

- [x] **Step 2: Verify the tests fail**

Run: `npm test -- --run src/state/accountStore.test.ts`

Expected: the LText node and language map remain under their previous canonical key.

- [x] **Step 3: Implement targeted rekeying**

Export `rekeyDataSource`, call it after `renameProjectDataSource`, `setSourceValue`, `setModelKeyField`, and source structure/list mutations; replace source-only minting with mint followed by rekey so imported/random keys converge too.

- [x] **Step 4: Verify the store tests pass**

Run: `npm test -- --run src/state/accountStore.test.ts`

Expected: PASS.

### Task 3: Documentation and regression verification

**Files:**
- Modify: `docs/architecture/editor-internals.md`

**Interfaces:**
- Documents the canonical source-name/Row-key scheme and live migration behavior.

- [x] **Step 1: Update the editor internals paragraph**

Document `sources.<sourceName>.<rowKey>.<fieldPath>`, automatic rekeying, translation preservation, and positional fallback behavior.

- [x] **Step 2: Run focused tests**

Run: `npm test -- --run src/domain/i18nSites.test.ts src/state/accountStore.test.ts`

Expected: PASS.

- [x] **Step 3: Run the editor suite and build**

Run: `npm test`

Run: `npm run build`

Expected: both commands succeed without new errors.

### Task 4: Lowercase canonical keys and unique source names

**Files:**
- Modify: `editor/src/domain/dataModels.ts`
- Modify: `editor/src/domain/i18nSites.ts`
- Modify: `editor/src/domain/i18nSites.test.ts`
- Modify: `editor/src/state/accountStore.ts`
- Modify: `editor/src/state/accountStore.test.ts`

**Interfaces:**
- Produces: `normalizeDataSourceName(name: string): string`.
- Changes: `renameProjectDataSource(...)` returns `boolean` and rejects empty or duplicate normalized names.

- [x] **Step 1: Add failing tests for lowercase key segments and case-insensitive uniqueness**

- [x] **Step 2: Run the tests and verify the expected failures**

- [x] **Step 3: Implement lowercase canonicalization and the store invariant**

- [x] **Step 4: Run the domain/store tests and verify they pass**

### Task 5: Source-name validation UI

**Files:**
- Modify: `editor/src/features/data/DataSourceEditor.tsx`
- Modify: `editor/src/features/data/DataSourceEditor.test.tsx`
- Modify: `editor/src/locales/en.ts`
- Modify: `editor/src/locales/fr.ts`
- Modify: `docs-site/src/content/docs/editor/data-sources.md`

**Interfaces:**
- Consumes: lowercase input draft and boolean rename result.
- Produces: blur/Enter commit with inline duplicate-name error.

- [x] **Step 1: Add a failing UI test for uppercase input and duplicate feedback**

- [x] **Step 2: Run the test and verify the expected failure**

- [x] **Step 3: Implement the draft input, validation feedback, and translations**

- [x] **Step 4: Update docs and run focused/full tests plus the production build**
