# Structured action wire — YAML keyed by name, DSL eliminated

**Status:** accepted (2026-10-15) — proposed on 2026-09-30. The wire is in production on
both sides: the editor writes keyed (`features/export/transform.ts`, `lib/actions/structuredSteps.ts`),
the plugin reads keyed (`engine/KeyedStepParser.kt` via `ActionChainCompiler`), the `menu/v1`
schema `$defs.Action` describes the single-key map. Cross-stack lock:
`testdata/action-wire-conformance.json`. Still to do, off the critical path: removing the DSL
codec (decision 5 — it now only serves to read older files) and removing action addresses
(decision 7, `assignI18nAddresses` survives for the inline mode of older files).

## Context

The ADR `action-dsl` (2026-07-21) made the **DSL string** the canonical serialization of an
action chain (`Step[]`), to make a data file hand-editable. Menu/command/dialog handlers are
therefore a DSL **scalar** (`click.left: 'send_message "…"'`), where a text is `"literal"` or
`@key`.

The ADR `field-local-translations` (2026-09-30) made **structural** texts self-contained: a
slot carries either a string (the `defaultLang` value) or a map `{ <lang>: text }`. But **a DSL
scalar cannot contain a map**: action texts stayed as `@key` pointing to `lang/<lang>.yaml`, so
a copied document does not carry its action messages. The DSL's special form also contradicts
the field-local model (bare string = `defaultLang`).

Options weighed: **A** status quo (global actions) — accepted gap; **B** document-local
`translations:` table — an indirection the rest of the model does not have; **E** extend the DSL
grammar with an inline map literal — invented syntax, two parsers, giant lines; **D** structured
wire — the only one that gives the action text the same form as the structural one. Chosen:
**D**, and the DSL itself is **eliminated** (it was only a specialized storage format; the keyed
structured form replaces it advantageously).

## Decision

1. **The canonical serialization of an action chain is structured (YAML), keyed by name.**
   Revises decision 1 of `action-dsl` and supersedes its Phase 2 target.

2. **An action = a single-key map: the action's name.**

   ```yaml
   - send_message: "Bienvenue !"                          # 1 text arg
   - send_message: { en: "Welcome!", fr: "Bienvenue !" }  # 1 arg, field-local
   - close_menu:                                          # 0 args (null value)
   - give_money: 100                                      # 1 number arg
   - run_command: { command: "say hi", as: console }      # 2 args
   - open_menu: { menu_id: shop_category, context: { category: "{cat.id}" } }
   - show_title: { title: "VIP", subtitle: "§7bienvenue" }
   ```

   - **1 single argument** → the value IS that argument.
   - **0 arguments** → null value (`- close_menu:`), or a **bare string as a list entry**
     (`- close_menu`); both forms are read, the editor writes the bare one.
   - **several arguments** → a map `{ arg: value }`.

3. **A condition = a single-key map: the condition's name.** The `if:` carries a
   **list = implicit AND**; `or:` / `and:` / `not:` are explicit nodes (`or:`/`and:` take a
   list, `not:` a condition). The flat `joins` is removed.

   ```yaml
   - if:
       - has_permission: shop.vip
       - or:
           - world_is: world_nether
           - time_is: night
     do:
       - show_title: { title: { en: "VIP", fr: "VIP" }, subtitle: "§7Welcome" }
       - send_message: { en: "Access granted", fr: "Accès accordé" }
     else:
       - if:
           - random_chance: 0.1
         do:
           - open_dialog: lucky_draw
         else:
           - send_message: { en: "You need VIP.", fr: "Il faut être VIP." }
   ```

   `else if` = an `if` **at the head of the `else`** (recursion), no `cases`.
   *Rejected:* `anyOf`/`allOf`/`oneOf` — that is the JSON Schema vocabulary that already
   validates these files; `oneOf` = XOR (false friend), `anyOf`/`allOf` create a vocabulary
   collision in the same ecosystem.

4. **An action text is a `LocalizedText`**: bare string (= the `defaultLang` value, same
   semantics as the structural one) or map `{ <lang>: text }`. `{i18n:key}` remains a possible
   **value** (shared key), resolved with the usual fallback. `{player}` templates, `%papi%`,
   MiniMessage remain (curly braces reserved).

5. **The DSL is eliminated.** The structured wire is the only stored and exchanged
   representation. The `actiondsl` codec (lexer/parser/printer/`DslToEngine`, TS **and**
   Kotlin) and the `action-dsl-fixtures.json` fixtures are removed; the "portable DSL in Artisan
   Core" ambition (`action-dsl` §Portability) falls. Step editing goes through a **structured
   editor** (form: add an action/condition → choose the type → fields; if/else tree). The
   **`expression` evaluator** stays — it is not the action DSL.

6. **Discrimination by type (tolerant reading).** A handler is a **string** → legacy old DSL;
   a **map** → a single step; a **list** → steps (string entry = action without arguments). The
   plugin accepts both forms during the migration; the editor writes the structured one.
   **Lazy** migration: an old DSL file is read and rewritten structured at the first save.

7. **The action address subsystem is removed** (`assignI18nAddresses`, the
   `i18n`/`i18nTitle`/`i18nSubtitle` fields). The action text is inline/field-local.

8. **Scope.** Menus, commands, dialogs **and** the `actions` fields of data sources (kind
   `actions`, ADR `yaml-assisted-editing`): a single wire everywhere.

## Consequences

- Uniformity: every text (structural **and** action) is a `LocalizedText` on disk. `lang/` only
  carries keys without a site (`artisan.duration.*`) and the data sources' addresses.
- **New UI work**: a structured steps editor replaces `ControlledStepsEditor` (DSL). The biggest
  piece on the editor side.
- **Wire change**: migration of all menus/commands/dialogs, of the plugin compiler, of the
  assistant tools, and of the conformance vectors (`menuV1.test`, `canonical.test`,
  `menuV1ToDomain.roundtrip`).
- Schema: the `type:`-tagged `Action`/`Condition` defs give way to the **keyed** form;
  plugin `ActionParser`/`ConditionParser`/`StepParser` rewritten. `menu/v1` evolves **in place**
  (no v2) — the tolerant reading of the DSL covers files already in prod.
- Removal: `actiondsl` codec (two stacks), `DslToEngine`, DSL fixtures, DSL portability in the
  core. The `expression` leaf evaluator survives.
- **Supersedes** `action-dsl` almost entirely (decision 1, Phase 2 target, portability); its
  decisions on the runtime expression (6) remain for `expression`.
