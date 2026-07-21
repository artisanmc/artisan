# Action DSL — text serialization of Action chains

**Status:** accepted (2026-07-21)

## Context

An **Action chain** (`Step[]` in the domain — a sequence of actions plus `if`/
`else if`/`else` branches over typed conditions) is currently serialized as a
verbose nested-object tree: `{kind: "action", action: {...}}`, `{kind: "if",
cases: [{conditions, joins, steps}], else: [...]}`. That is what `serializeStep`
emits and what the plugin's `ActionParser`/`ConditionParser` read.

For **menu/command** click handlers this stays hidden behind the editor. But
**Project data sources** are hand-authorable YAML on disk (FTP scenario), and a
new `actions` field kind (an Action chain stored on a data-source row/config
value) would embed those trees verbatim — ~40 lines of boilerplate for what an
admin thinks of as "on buy, do X then Y, unless VIP". `else if` is not even
visible (it is a second `cases[]` entry). The verbose form is not writable by
hand.

An editor-side precedent already exists: the module-data `actions` field kit
edits `Step[]` through `ControlledStepsEditor` with **literal** text (no i18n),
round-tripped via `@/lib/literalSteps`. And a closed **expression DSL** (JS-like
`&&`/`||`, comparisons, `.join()`, `%papi%`, `{i18n:key}`) exists in TS
(`editor/src/lib/expr/`) — but was **never ported to the plugin**: there is no
`expr/` module, and `ConditionEvaluator` has no `expression` branch (it crashes /
no-ops). The plugin reads only structured maps.

## Decision

1. **A compact text DSL is the canonical serialization of an Action chain**, not
   an editor-only view. The stored value (data-source field, disk YAML, wire) is
   the DSL string. This is the only shape that makes disk YAML hand-writable —
   the whole motivation. Rejected: editor-only text mode over a structured wire
   (disk stays verbose → fails the goal; and forces two plugin parsers forever).

2. **One unified grammar, word operators.** The condition after `if` is a single
   expression with `and` / `or` / `not` + grouping parentheses (precedence
   `not` > `and` > `or`). There is **no** separate "IfCase level" vs "`{}`
   expression level". Braces `{…}` embed an expression **in text** only
   (`send_message "solde {balance}"`), never in a condition. The pre-existing
   expression DSL is rewritten to match (`&&`/`||` → `and`/`or`); it has no users
   yet, so no compatibility constraint. Rejected: keeping the two boolean levels
   (`&&` inside `{}` vs if-level `and`) — the redundancy `if {a} and {b}` vs
   `if {a && b}` was judged confusing.

3. **Surface unified, domain typed under the hood.** The parser maps a known
   predicate call (`has_permission(vip)`, `random_chance(0.5)`, …) to its **typed**
   `Condition` variant, and only genuine free comparisons (`balance >= 100`,
   arithmetic) to `{type:"expression"}`. `and`/`or`/`not` map to the domain's
   `joins` (when they follow default precedence) or composite `and`/`or`/`not`
   conditions (when parentheses break precedence). Round-trips both ways.
   Rejected: collapsing every condition to a single `expression` string — would
   discard the working typed `ConditionEvaluator` (14 conditions) and force the
   whole predicate set into an expression runtime.

4. **Text: `"literal"` vs `@key`.** A quoted string is a **literal inline
   template** (default language; may contain `{placeholders}`, MiniMessage,
   `%papi%`; no i18n key allocated). `@key` references a **translatable i18n
   key** (a **Key site**; values in `lang/*.yaml`) — covering both an action's own
   auto-minted key and reuse of a shared key. Action text stays `LText` in the
   domain: `@key` ↔ registered key, `"..."` ↔ unregistered literal (the
   `literalSteps` trick). Action text is **always quoted** (never a bare word) to
   remove text-vs-identifier ambiguity.

5. **Argument grammar.** Bare words for identifiers / enums / materials / sounds /
   worlds / numbers; positional args first, then `key=value` for optionals
   (`play_sound PLING vol=1 pitch=1.2`); trailing keyword **modifiers**
   (`run_command "…" as console`, `open_menu m clear`); `with k="v"` for context
   maps. `set <arg> = <expr>` and `cycle [next|prev] <arg> in <expr>` for the
   context-mutation actions (their args are bare expressions, no braces).

6. **Basic expressions are core, not deferred.** Because boolean combination is
   handled structurally (typed conditions + joins), the only new runtime need is a
   **leaf evaluator**: operands (literals, numbers, placeholders — already resolved
   by `ArgResolver` — and row-field paths), `+`/`-`, and comparisons
   `== != < <= > >=`. This is built in **both** TS (largely exists) and Kotlin,
   locked by shared conformance fixtures from the start — even before an executor
   calls it. `%ph% == "lit"` and `%ph% matches "re"` map to the plugin-evaluable
   `placeholder_equals`/`placeholder_match`, not `expression`. Deferred
   (demand-triggered): the **advanced** expression tail — list methods
   (`.join`/`.contains`/`.length`), ternary `?:`, nested `{i18n:}` depth, index
   `[]`. Rejected: shipping `expression` as a parse-but-no-op stub (a
   "looks-like-it-works" trap).

7. **Indentation-significant blocks.** `:` opens a block, 2-space indent, blank
   lines ignored, `#` line comments. Tolerant parser (any consistent indent width;
   clear line/column error otherwise). Rejected: `end`-terminated or braced blocks
   (reintroduce the boilerplate we are removing; the YAML block scalar already
   preserves indentation faithfully).

8. **Cross-stack contract via shared fixtures.** A shared file (mirroring
   `expr-fixtures.json`) holds `{ dsl, steps, canonicalDsl }` entries plus
   basic-eval cases, asserted by **both** the TS and Kotlin suites:
   `parse(dsl) → steps`, `print(steps) → canonicalDsl`, and identical leaf-eval.
   This is what stops the editor emitting DSL the plugin later cannot read.

## Invoking a source's actions from a chain (`run_actions`)

A menu/command/dialog Action chain reaches a data-source `actions` value through a
new action **`run_actions <expr>`** — the bridge that makes the whole feature
useful (decided 2026-07-21).

- **Reference by scope expression** — `run_actions item.on_buy` (a table row's
  field, already in scope via the consumer's binding) or `run_actions
  settings.on_join` (a config value). The arg is a bare expression (no braces,
  like `set`/`cycle`). Rejected: an explicit `from shop:vip.on_buy` reference —
  redundant with the binding that already put the row in scope.
- **Self-binding scope** — the called chain runs with the object the expression
  resolves *from* (the row, or the config object) as its **local root**, so it
  addresses its own fields alias-free: `take_money {price}`. The caller context
  (player, `%papi%`) stays visible above it; `self.` disambiguates a field that
  collides with a caller name (`{self.price}`). This is what lets a source author
  write `on_buy` without knowing which menu/alias will consume it — the source
  becomes self-contained and portable. Rejected: strict caller-scope inheritance
  (would force `{item.price}`, coupling the source to the consumer's alias).
- **Inline, synchronous** — the called steps run in place; control returns to the
  step after `run_actions`. Same thread, same `ExecutionContext`.
- **Depth-guarded, tolerant** — a called chain may itself `run_actions` (row A →
  row B → …); a **max call depth of 16** (mirrors the i18n depth precedent) caps
  cycles: beyond it, WARN + skip the over-deep call, no crash. A missing / empty /
  unparseable value is a no-op + one WARN.
- **A 21st DSL verb** — `run_actions` joins the vocabulary (a new `Action`
  variant `{type:"run_actions", actions:<expr>}`), so it touches the codec on both
  stacks + one conformance fixture. Its *execution* (self-binding, depth guard,
  parse-and-run via the Kotlin codec) is Phase 1.5 — this is the "first executor".

## Rollout

- **Phase 1 (now)** — TS codec (parse+print) + TS leaf evaluator + editor
  `actions` field + `data/v1` accepts `kind: actions` + export string passthrough
  + shared conformance fixtures. The plugin carries the string **opaque**; no
  execution, no Kotlin parser required yet.
- **Phase 1 (Kotlin, parallel)** — port parser + leaf evaluator to Kotlin, driven
  by the same fixtures, to lock TS↔Kotlin parity early.
- **Phase 1.5 (first executor)** — wire a consumer (shop `on_buy`, or an element
  click bound to a data field) to the existing `ActionExecutor`/`ConditionEvaluator`
  + leaf evaluator. Everything except advanced-tail expressions runs.
- **Phase 2** — migrate menu/command/dialog click handlers off the structured
  wire onto the DSL string; retire the structured serializer + its Kotlin parser
  (`StepParser`/`ActionParser`/`ConditionParser` Map→object). One format everywhere.
  **Decided 2026-07-21: in-place `menu/v1` change (no `menu/v2`, no migration) —
  `menu/v1` is not yet in production, so the versioning "never modify a shipped
  schema" rule does not bite; the Bundle re-exports from the domain model each
  edit. Big-bang all three document kinds together (not staged).** Menu action
  text is a registered **Key site**, so it serializes as `@<canonical-key>` (a
  Project-aware `stepsToDsl(steps, pack)`: key ∈ `i18nKeys` → `@key`, else literal
  — unlike data-source actions which are literal). Menu/v1 conformance vectors
  (`menuV1.test`, `canonical.test`, `menuV1ToDomain.roundtrip`) are regenerated.
- **Deferred** — advanced expression tail, strictly demand-triggered; until then a
  free comparison round-trips but no-ops + WARNs at runtime (tolerant philosophy).

## Portability (other plugins; future Artisan add-on)

The codec is meant to be **reused by other plugins** (e.g. a Quests plugin using
it for reward/action chains in its own configs, later plugged into Artisan as an
add-on for interactive forms). This is why the `actiondsl` package
(Ast/Lexer/Format/Parser/Printer/LeafEval) is **strictly decoupled** from the
Artisan engine — zero Bukkit/engine imports. Only `DslToEngine` is Artisan-specific.

- **Portable core** = the codec + the `DslStep` AST. Its home is **Artisan Core**
  (the existing published `net.artisanmc:artisan-core-api` artifact), which grows
  to host the DSL alongside other shared capabilities — NOT a standalone
  `action-dsl` micro-module (decided 2026-07-21: one core dependency that grows,
  not many). Other plugins already depend on core, so they get the DSL for free.
  Each host maps `DslStep → its own action model` (a standalone Quests plugin maps
  to its reward actions; once Quests is an Artisan add-on it can instead reuse
  Artisan's `DslToEngine` + interactive forms via the add-on SDK). Requirement
  this imposes — already met: `actiondsl` must stay free of plugin-internal deps
  so it can move into core-api cleanly.
- **Vocabulary — fixed vs extensible** (to decide **at extraction time**, not
  now): Artisan-menu verbs (`open_menu`, `paginate`, `open_dialog`, `set_arg`,
  `run_actions`) don't belong in a Quests context. Leaning **extensible** — a
  universal core (`give_item`, `run_command`, `send_message`, `if`/conditions…) +
  host-registered verbs. To keep that door open, Phase 2 keeps `parseVerb`
  **table-driven** rather than a hardcoded switch.

## Consequences

- One serialization for Action chains across data sources, menus, commands,
  dialogs, templates — one parser/printer per language, no dual wire format.
- Disk YAML for `actions` fields is hand-writable and diff-friendly; `else if` is
  a literal line.
- A hand-authored free comparison parses immediately but only executes once the
  advanced/leaf runtime it needs is present (Phase 1.5 for leaf, Phase 3-ish for
  the advanced tail).
- The pre-existing TS expression DSL loses its `&&`/`||` surface; acceptable — no
  users. Its evaluator core is reused by the leaf evaluator.
