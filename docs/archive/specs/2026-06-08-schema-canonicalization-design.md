# Schema canonicalization — one model, generated and enforced on every layer

**Status:** design approved — **P1.0 in progress**. ⚠️ **UPDATE 2026-06-08:** the **quicktype codegen is dropped** (spike NO-GO: it flattens our discriminated unions into god-objects, no `sealed class` — cf. `docs/schema/CODEGEN.md`). Chosen approach: **hand-written types** (sealed Kotlin + TS unions) conforming to `schema.json` (source of truth), **drift guaranteed by CI ajv + fixtures** (no generation). The "codegen / quicktype" mentions below now read "hand-written types + CI drift".
**Author:** brainstorm 2026-06-08
**Trigger:** drift discovered while preparing the AI feature (`2026-06-08-ai-assistant-design.md`).
**Related code:** `docs/schema/*/v1/`, `editor/src/features/export/transform.ts` + `editor/src/domain/types.ts`, `plugin/src/main/kotlin/net/artisanmc/plugin/{engine,model}/`.

## Context — the drift

While trying to make `menu/v1` the contract of the AI feature, we discovered that **three representations** of a menu have diverged, and that **nothing keeps them aligned**:

| | Where | State |
|---|---|---|
| **domain** | `editor/src/domain/types.ts` (accountStore, canvas) | editing projection: `LText` refs, step-trees, `canvasLayout`, camelCase, **partial** conditions/actions vocabulary (+ `expression`, which the others lack) |
| **export dialect** | output of `transform.ts` = **what the plugin actually reads** | `{i18n:key}`, conditions `{type:"and", all:[…]}`, collapsed `if`, `size`, snake_case |
| **documented schema** | `docs/schema/*/v1/` | **stale**: `of` everywhere, `if: Condition[]`, `title: string`, vocabulary of 17 conditions / 15 actions |

Facts verified in the code:
- The export (`serializeCondition`) **and** the plugin (`ConditionParser`) both use `and→all`, `or→any`, `not→of`, and accept a collapsed `if` (map) or an array. → **they agree; `docs/schema` is the only one saying `of`/array.**
- **Nothing enforces** `docs/schema`: no `ajv`, no CI, the plugin (Jackson `@JsonIgnoreProperties`) silently ignores unknown fields, the editor does not validate against the schema either.
- The conditions and actions **vocabularies** differ between the three (partial domain + `expression`; plugin = typed superset; docs = another superset). No single source.

Consequence: the contract is implicit, not faithfully documented, not enforced, and re-drifts on every commit. It is the foundation debt to settle before stacking features (AI) on top.

## Brainstorm decisions

| Question | Choice |
|---|---|
| Scope | **Maximal**: canonicalize all schemas (menu, command, dialog, translations, manifest/pack, template) + **plugin codegen**. |
| Guardrail | Canonicalization = **format / types / codegen / CI**. **No** new runtime behaviors. |
| Source of truth | `docs/schema/<name>/v1/schema.json` (JSON Schema 2020-12), one per schema. |
| Types from the schema | ~~quicktype~~ → **hand-written** (sealed Kotlin + TS unions) conforming to `schema.json`; drift via CI ajv + fixtures *(spike NO-GO 2026-06-08, cf. `docs/schema/CODEGEN.md`)*. |
| Editor domain | **Stays hand-written** (editing projection + i18n / canvas sidecars). |
| Phasing | **P1 = menu/v1** (unblocks the AI + the prod test), then P2 (other schemas), P3 (global CI + legacy removal). |

## Goals

- **One source of truth per schema** (`schema.json`), from which the Kotlin (plugin) and TS (editor export) types are **generated** → impossible to diverge by construction.
- **Anti-drift CI**: the editor's export and the plugin fixtures are validated against `schema.json`, and the codegen is verified (regen + diff).
- **Reconciled vocabularies**: a single canonical set of conditions / actions / steps / title-layers per schema.
- All of it without changing the existing runtime behavior.

## Non-goals (separate, standalone feature projects)

- **Implementing the click `if` branches on the plugin side**: today `extractFromSteps` only keeps `kind:"action"` and **drops the branches**. The canonical schema **includes** the `kind: action|if` step-trees (real editor constructs) and the generated types deserialize them, but **honoring them at runtime = separate feature** (documented TODO).
- **Implementing `context_inputs` / iteration / data-sources on the plugin side**: the schema includes them, the plugin does not execute them yet. **Separate feature** (documented TODO).
- **Collapsing `domain == menu/v1`** (removing the editor's internal model): a much bigger refactor, not required. The domain stays the editing projection.
- The AI feature itself (its spec waits for P1).

## Target architecture

```
docs/schema/<name>/v1/schema.json   ← single SOURCE OF TRUTH (JSON Schema 2020-12)
        │  quicktype
        ├──────────────▶  plugin/.../generated/<Name>V1.kt   (sealed class)  ← plugin parsers consume
        └──────────────▶  editor/src/schema/<name>/v1.ts     (TS types)      ← transform.ts (export) consumes
docs/schema/<name>/v1/types.ts      ← becomes a re-export of the generated types (or removed)
editor/src/domain/types.ts          ← STAYS hand-written (editing projection: LText, step-trees, canvasLayout)
```

- **schema.json** is written/rewritten to match the **chosen canonical form** (see below), not the current stale form.
- **quicktype** generates, from each `schema.json`, the Kotlin `sealed class`es and the TS types. A build script (`bun run schema:gen` or equivalent) regenerates; CI fails if the generated output differs from the committed one.
- **The editor's domain** projects to/from the canonical form via `transform.ts` (export, existing) and the future import converter (AI feature / file import). It keeps i18n (`LText`+catalog) and `canvasLayout` as sidecars.

## Canonical form (the "clean" choices)

To apply in each `schema.json`, then propagate to the editor export + plugin parser:

- **Conditions**: a union discriminated by `type`. `of` **everywhere** (`not`/`and`/`or` → `of`), we **drop `all`/`any`**. `if` is **always** a `Condition[]` array (we remove the map collapsing). Vocabulary = **reconciled canonical set** (cf. workstream below).
- **Actions**: a discriminated union, snake_case, reconciled canonical vocabulary.
- **Steps (clicks)**: we **keep** `{ kind: "action", action } | { kind: "if", cases[], else? }`. The branches stay in the contract.
- **Title**: **always** an array of `MenuTitleLayer` (we remove the legacy string shortcut at the canonical level; `plain` layer for vanilla mode).
- **Menu**: `size` (9/18/27/36/45/54) canonical (not `rows`); `context_inputs` (snake_case) in the schema.
- **i18n**: every text field is a `string` that can be a **literal** (MiniMessage + `%papi%`) **or** an inline ref `{i18n:key}`. Translations live in `translations/v1` (`lang/<lang>.yaml` files, flat `key: value` map).

## "Vocabulary reconciliation" workstream

Core of the project: we need **a single** set per category, and to make the three sources converge. Principle: canonical = **reconciled superset**, the editor and the plugin conform to it, non-implemented gaps are documented TODOs (not removed from the schema if they are real constructs).

Known reconciliation points to settle during implementation (each = an explicit decision in the plan, not a silent default):

- **`expression` (condition DSL)**: present in the editor domain, absent from the plugin and from `docs/schema`. Decide: (a) include it in the canonical form + the plugin must parse it (at least deserialize it), or (b) mark it editor-only / deprecated. **Recommendation: include it** (it is a real construct), the plugin deserializes it; runtime evaluation of the DSL = documented gap if not already done.
- **Actions**: reconcile domain (`set_arg`, `set_arg_cycle_*`, `paginate`, `open_dialog`, `close_dialog`, `show_title`, …) ⨯ plugin (`pagination_next/prev`, `broadcast`, `play_sound`, `teleport`, `give/take_item`, `give_xp/level`, …) ⨯ docs (15). Establish the single canonical list + any aliases (e.g. `paginate{direction}` vs `pagination_next/prev`).
- **Conditions**: domain (8 + `expression`) ⨯ plugin (17) ⨯ docs (17). Canonical = the reconciled set.

Each reconciliation produces: an entry in `schema.json`, a generated type, editor export conformance, plugin parser conformance, and a CHANGELOG line.

## Conformance per layer

- **Editor** (`transform.ts` + callers):
  - conditions: `all`/`any` → `of`, remove the collapsing (always an array);
  - title: always an array (remove the plain-only string shortcut);
  - align the actions/conditions vocabulary on the canonical one;
  - import the **generated TS types** instead of the hand-written `docs/schema/.../types.ts`.
- **Plugin** (`engine/`, `model/`):
  - replace the hand-written Jackson data classes with the **generated** `sealed class`es;
  - `ConditionParser`: `all`/`any` → `of`;
  - the title parser is already tolerant (string + array) — keep the tolerance on read, the canonical form on write.
- **`docs/schema`**: `schema.json` files rewritten canonical; `types.ts` → re-export of the generated types; examples updated and validated.

## Codegen pipeline + CI

- **Generation script**: `quicktype` invoked per schema → writes the generated types into the plugin and the editor. Exposed via a command (`bun run schema:gen`).
- **CI (anti-drift)**:
  1. **codegen drift**: regen + `git diff --exit-code` on the generated files.
  2. **ajv**: validate (a) the editor's export of a "golden" pack against `schema.json`, (b) the plugin's test fixtures, (c) the `examples/` files.
  3. existing editor/plugin/backend tests keep passing.

## Phasing

- **P1 — menu/v1**: canonical schema.json + quicktype (Kotlin+TS) + editor export & plugin parser conformance + CI (drift + ajv menus). Reconcile conditions/actions/steps/title for menus. **→ unblocks the AI feature and the prod menus test.**
- **P2 — other schemas**: `command/v1`, `dialog/v1`, `translations/v1`, `manifest`/`pack/v1`, `template/v1` — same pattern (schema → codegen → conformance → CI).
- **P3 — hardening**: CI drift-check on all generated files, removal of the legacy shortcuts (title string, collapsed `if`, `all`/`any`) once all layers are migrated, architecture doc updated.

## Documented runtime gaps (out of scope, to track)

- Plugin: execution of the **`if` branches** in clicks (ignored today).
- Plugin: **`context_inputs` / iteration / data-sources** (deserialized via generated types, not executed).
- Plugin: evaluation of the `expression` DSL if not implemented.

These gaps are **written into the schema** (real constructs) and **listed as TODO** in `docs/architecture/` + `CHANGELOG`, each a candidate for a separate feature project.

## Tests

| Layer | Coverage |
|---|---|
| Codegen | `bun run schema:gen` is idempotent; CI drift (regen + diff) red if out of sync. |
| ajv | editor export of a golden pack validates against `menu/v1/schema.json` (P1), then each schema (P2); examples validate; plugin fixtures validate. |
| Editor | `transform.test.ts` updated for the canonical form (`of`/array conditions, title always array); export→ajv round-trip. |
| Plugin | existing parsing tests migrated to the generated types; a canonical menu parses; read backward-compat (string title, etc.) kept during the transition. |
| Reconciliation | for each canonical action/condition: an example that serializes (editor) and parses (plugin) losslessly. |

## Docs to update

- `docs/architecture/`: new "canonical schemas & codegen" doc (source of truth, quicktype pipeline, CI, runtime gaps).
- `docs/schema/*/v1/README.md`: reflect the canonical form + the fact that `types.ts` is generated.
- `CHANGELOG.md` `[Unreleased]`: each schema / vocabulary change.
- `CLAUDE.md`: `schema:gen` command, rule "modifying a schema = regen + CI", doc-impact mapping.
- `docs/architecture/versioning.md`: recall the discipline "new breaking = `/v2`, no mutation of a shipped `/v1`" in light of the single source.

## Relation to the AI feature

After **P1**, update `2026-06-08-ai-assistant-design.md`:
- the contract emitted by the AI = **canonical** `menu/v1`;
- the gate = `ajv(menu/v1/schema.json)` + the cross-field checks (`validateMenuLayout` aligned on the canonical form);
- the `menu/v1 → domain` converter shrinks to the **i18n bridge** + projection (canvas/rows), since the canonical form and the domain are structurally aligned.

## Risks / limits

- **quicktype + oneOf/discriminant**: the quality of the generated Kotlin `sealed class`es depends on clean `type`/`kind` discriminants in `schema.json` — write the schemas with explicit discriminated `oneOf`s. Check the Kotlin output on unions from P1 (spike).
- **Vocabulary reconciliation**: this is the real design work; each gap is a micro-decision (include / alias / deprecate). The plan must enumerate them, not hide them.
- **Plugin churn**: replacing hand-written Jackson data classes with generated ones can touch many files — hence the menu-first phasing.
