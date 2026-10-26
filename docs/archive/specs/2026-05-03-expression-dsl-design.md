# Expression DSL — Design Spec

**Date**: 2026-05-03
**Status**: Design validated, **partly superseded** — see ADR `expression-parity`
(2026-08-05). Two points of this document no longer describe the target:
- "no string methods" / strictly closed grammar → the editor implementation
  adopted a **closed vocabulary of methods** (`join`, `pluck`,
  `length`, `first`, `last`, `at`, `contains`), and that is the form retained.
- The document says nothing about the **runtime**: the server implements nothing of this
  grammar (`ArgResolver`, `{name}`/`{alias.field}` regex). TS ↔ Kotlin parity
  is now a contract locked by a conformance vector.

The rest (grammar, coercions, tolerant philosophy, nested i18n) remains the
reference.
**Author**: iban (brainstorming session with Claude)

## Summary

Add a mini expression DSL with a closed grammar and JS-like syntax, embedded in the existing Template fields (lore, title, command, etc.) and in two new typed Expression field kinds. It allows:

- Joining a list with a separator (`{quest.tags.join(", ")}`)
- Inline conditionals (`{quest.gold > 1000 ? "<gold>" : "<gray>"}`)
- Complex conditions (`{ type: "expression", expr: "..." }`)
- In-place context mutation (`set_arg`, `set_arg_cycle_next/prev`)

The DSL is deliberately minimal and closed: no admin functions, no local variables, no string methods. Power and editor simplicity come before maximum flexibility.

## Motivation

The current schema (`web/src/domain/types.ts`) already supports simple placeholders (`{name}`, `{alias.field}`, `%papi%`, `{i18n:key}`) in text fields. But it cannot:

1. **Iterate / format a list** in a single string → forced to create several duplicated Appearances
2. **Choose a word based on a condition** without duplicating the whole Appearance
3. **Evaluate a complex condition** beyond a simple `placeholder_equals`
4. **Compute an argument value** dynamically (cycle a category, etc.)

Triggering use case: a shop with cyclable categories where the list of categories comes from a connector (so unknown at edit time). Without a dynamic cycle, impossible.

## Design decisions (summary)

- **Closed grammar**, JS-like syntax (no real JS engine — custom Java implementation).
- **Two field types**: Template (mixed text) and Expression (the string IS an expression).
- **Context-aware identifiers**: `{name}`, `{alias.field}`, `index/count/first/last`, `%papi%`. Anchored on `Menu.contextInputs` and `Element.iterates`.
- **Nested i18n allowed**: recursive `{i18n:literalKey}` with cycle detection and max depth 5.
- **Limited arithmetic**: `+` and `-` (no `*`, `/`, `%` — `%` conflicts with the PAPI delimiter).
- **No free functions** in the V1 grammar: the use cases (cycle) are covered by dedicated declarative actions.
- **Form-only editor** for V1 on Expression fields ("raw code" mode deferred to V1.5+).
- **Tolerant runtime**: no expression error crashes a menu. Insert `⚠️ <msg>` or return `null` depending on context.

## 1. Grammar

### 1.1 EBNF

```ebnf
expression  = ternary
ternary     = orExpr ( "?" ternary ":" ternary )?
orExpr      = andExpr ( "||" andExpr )*
andExpr     = notExpr ( "&&" notExpr )*
notExpr     = "!" notExpr | compareExpr
compareExpr = addExpr ( ( "==" | "!=" | "<" | "<=" | ">" | ">=" ) addExpr )?
addExpr     = primary ( ( "+" | "-" ) primary )*
primary     = literal
            | papiPlaceholder
            | path
            | "(" expression ")"

path        = identifier ( "." identifier | "[" expression "]" | methodCall )*
methodCall  = "." identifier "(" ( expression ( "," expression )* )? ")"

literal           = stringLit | numberLit | "true" | "false" | "null"
stringLit         = '"' ( [^"\\] | "\\" anyChar )* '"'
                  | "'" ( [^'\\] | "\\" anyChar )* "'"
numberLit         = [0-9]+ ( "." [0-9]+ )?
papiPlaceholder   = "%" [a-z_] [a-z0-9_]* "%"
identifier        = [a-zA-Z_] [a-zA-Z0-9_]*
```

### 1.2 Identifiers available in scope

| Token | Origin | Type | Available when |
|---|---|---|---|
| `<inputName>` | `Menu.contextInputs[name]` | typed per `ContextInput.type` | Always |
| `<alias>` | `Element.iterates.alias` (current item object) | object | Iterating Element |
| `<alias>.<field>` | field of the current item | typed per connector | Iterating Element |
| `index` | 0-based index in the iteration | number | Iterating Element |
| `count` | total number of items | number | Iterating Element |
| `first` | `index == 0` | bool | Iterating Element |
| `last` | `index == count - 1` | bool | Iterating Element |
| `%any_papi_placeholder%` | any PAPI placeholder | string (auto-coerce) | Always |

Outside iteration, accessing `index`/`count`/`first`/`last` → validation error at edit time, `null` returned at runtime.

### 1.3 List methods

On a value of type `list` (including `quest.tags` etc.):

| Method | Returns | Notes |
|---|---|---|
| `.join(separator)` | string | Concat with separator. `[]` → `""` |
| `.length` | number | Property, no parens. `null` → `0` |
| `.first` | element | Property. `[]` → `null` |
| `.last` | element | Property. `[]` → `null` |
| `.at(n)` | element | Out-of-bounds → `null` |
| `.contains(x)` | bool | Strict equality (string or number depending on type) |

No methods on string (intentional — minimal V1).

### 1.4 Operators and coercion

**Comparison** (`==`, `!=`, `<`, `<=`, `>`, `>=`):
- If both sides parse as `Number` (Java `Double.parseDouble`) → numeric compare
- Otherwise → lexicographic string compare
- `null == ""` is **true** ("absent value" equivalence)
- `null == 0` is **false**

**Booleans** (`&&`, `||`, `!`, ternary):
- Falsy: `null`, `""`, `0`, `false`
- Truthy: everything else, **including the empty list `[]`** (JS style)
- Standard short-circuit for `&&` and `||`

**Arithmetic** (`+`, `-`):
- `Number + Number` → `Number`
- `String + anything` → string concatenation (JS style)
- `Number - Number` → `Number`
- `String - anything` → eval error (warning, returns `null`)

**Safe access**:
- `quest.gold` when `quest` is `null` → `null`
- `quest.tags.length` when `quest.tags` is `null` → `0`
- `quest.tags.join(",")` when `quest.tags` is `null` → `""`
- `arr[5]` out-of-bounds → `null`

### 1.5 Deliberately outside the V1 grammar

- `*`, `/`, `%` (modulo would conflict with the PAPI delimiter)
- String methods (`.toUpperCase`, `.substring`, etc.)
- Free functions (`cycleNext`, `i18n(key)`, etc.) — **the use cases that would have needed them are replaced by dedicated declarative actions** (`set_arg_cycle_next/prev`)
- Local variables, admin functions
- Mutating methods (`.push`, `.set`, etc.)

All of this can be added later, **purely additively**.

## 2. Schema changes

### 2.1 New condition type

Added in `web/src/domain/types.ts`:

```typescript
export type Condition =
  | { type: "has_permission"; perm: string }
  | { type: "has_money"; amount: number }
  | { type: "placeholder_equals"; placeholder: string; value: string }
  | { type: "placeholder_match"; placeholder: string; regex: string }
  | { type: "not"; of: Condition }
  | { type: "and"; of: Condition[] }
  | { type: "or"; of: Condition[] }
  | { type: "expression"; expr: string };  // NEW
```

`expr` is a string containing a DSL expression. Coerced to boolean via the falsy/truthy rules at eval.

### 2.2 New actions

```typescript
export type Action =
  | { type: "open_menu"; menuId: MenuId; clearContext?: boolean; context?: Record<string, string> }
  | { type: "close_menu" }
  | { type: "run_command"; command: string; as: "player" | "console" }
  | { type: "send_message"; text: LText }
  | { type: "give_item"; material: string; count: number }
  | { type: "take_money"; amount: number }
  | { type: "paginate"; direction: "next" | "prev"; targetElementId?: ElementId }
  // NEW
  | { type: "set_arg"; arg: string; value: string }
  | { type: "set_arg_cycle_next"; arg: string; list: string }
  | { type: "set_arg_cycle_prev"; arg: string; list: string };
```

- `set_arg`: mutates the current menu's `contextInput[arg]` by evaluating `value` (Expression). Triggers a re-render of the current menu.
- `set_arg_cycle_next/prev`: evaluates `list` (Expression returning a list), finds the current index by equality with the current value of `contextInput[arg]`, sets it to the next/previous item (wrap-around). If there is no current item or the list is empty → first/last or `null`. Triggers a re-render.

**Constraints on `arg`**:
- Must match the `name` of an existing `Menu.contextInputs[*]`. Validated at edit time (dropdown limited to declared inputs). If a runtime sees an unknown `arg` (malformed pack, input renamed without propagation), no-op + warn log.
- Inputs with `source: ConnectorBinding` cannot be mutated by `set_arg*` (they are fetched live). Edit-time validation refuses to offer these inputs in the dropdown.

### 2.3 Template vs Expression convention on string fields

No branded types; convention documented field by field.

| Field | Semantic type | Notes |
|---|---|---|
| `LText` (translation values) | Template | i18n + MM + PAPI + `{expr}` |
| `RunCommandAction.command` | Template | same rules |
| `OpenMenuAction.context` values | Template | same rules |
| `placeholder_equals.placeholder` / `.value` | Template (backward compat) | was already a template, stays a template |
| `placeholder_match.placeholder` / `.regex` | Template / regex | placeholder is a template, regex is a literal |
| `expression.expr` | Expression | the whole string IS an expression |
| `set_arg.value` | Expression | same |
| `set_arg_cycle_*.list` | Expression (returns list) | same |

### 2.4 No migration

Old `{name}` templates keep working: a lone identifier IS a valid expression. No change required on existing packs.

## 3. Evaluation semantics

### 3.1 Template render pipeline

For each Template field at render:

1. **(LText only)** Look up `pack.i18nKeys[key][activeLang || defaultLang]` → template string. Missing → fall back to `defaultLang`, then `""` (silent).
2. **Nested i18n pre-pass**: recursively replace `{i18n:literalKey}` with its translation.
   - Visiting set for cycle detection
   - Max depth 5 → beyond that, insert `⚠️ i18n depth exceeded`
   - Cycle → insert `⚠️ i18n cycle: a→b→a`
3. **Tokenize** the template: literal segments (text, MM tags, outer `%PAPI%`) vs expression segments `{...}`.
   - `{...}` matching handles paren nesting in methods (`{quest.tags.join(", ")}` is ONE segment)
4. **Eval each expression**: parse → AST (cache) → eval with current scope → string (toString on non-strings).
   - Eval error → insert `⚠️ <msg>` and continue (no menu crash)
5. **Concat** segments.
6. **PAPI resolution**: replace the remaining `%foo%` (those from literals AND those re-emitted from an eval).
7. **MiniMessage parse** → Adventure Component.
8. **Send** to the player.

**Note**: `%foo%` inside an expression (step 4) is read directly by the evaluator (`papiPlaceholder` token). Outside (step 6), it is resolved at the end of the chain. Consequence: a `%vault_eco_balance%` in a `> 1000` compare is read numerically at compare time.

### 3.2 Standalone Expression pipeline

For Expression fields (`expression.expr`, `set_arg.value`, `set_arg_cycle.list`):

1. **Parse → AST** (cache).
2. **Eval** with scope.
3. **Coerce** to the expected type:
   - `expression.expr` → boolean (falsy/truthy)
   - `set_arg.value` → string (toString)
   - `set_arg_cycle.list` → list (otherwise eval error → action no-op + warn log)
4. **On error**: safe default value (false / "" / no-op), warning logged on the plugin side.

**Empty expression** (`""` or whitespace): returns `null`. For `expression.expr` → coerces to `false` (condition never true). For `set_arg.value` → coerces to `""`. For `set_arg_cycle.list` → no-op + warn (no list).

### 3.3 Editor-side validation (3 layers)

1. **Parse-time** (every keystroke): valid syntax. Errors underlined in red inline.
2. **Type-check** (on field save): identifiers exist in the scope, methods valid for the type. Non-blocking warnings → "Issues" panel.
3. **Publish-time**: all type-check warnings must be resolved, otherwise publish is blocked. A statically detected i18n cycle also blocks.

### 3.4 Runtime errors — philosophy

The runtime is **silent and tolerant**:
- Invalid expression → `""` inserted + WARN log
- Invalid reference → `null` → coerces to `""`
- i18n cycle → visible `⚠️` marker (debug-friendly)

The runtime NEVER crashes a menu over an expression error. The responsibility for catching bugs lives in publish validation.

## 4. Editor UX

### 4.1 Two field editor modes

**Template field** (LText, plain template strings) — `<TemplateEditor>` component, extends the existing MM editor (`web/src/features/canvas/TextEditor.tsx`) with:

- Extended toolbar: `[B][I][U][color]` + `[{i18n}]` + `[+ Placeholder]` + `[? If...]` + `[⨁ List→text]` + `[📚 Patterns]`
- Textarea with light syntax highlighting (MM gray, expressions blue, PAPI purple, i18n yellow, errors red underline)
- Live preview pane on the right (or bottom sheet on mobile)

**Expression field** (set_arg.value, expression.expr, set_arg_cycle.list) — `<ExpressionEditor>` component, **form only in V1**. No raw text mode in V1 (deferred to V1.5).

### 4.2 Template field toolbar buttons

| Button | Behavior | Generates |
|---|---|---|
| `+ Placeholder` | Popover: sections "Menu inputs", "Current iteration", "PAPI search" | `{quest.name}` |
| `? If...then...else...` | Form modal: condition (Expression form) + then (Template) + else (Template) | `{cond ? "then" : "else"}` |
| `⨁ List → text` | Form modal: list choice + separator (preset comma/newline/bullet/custom) | `{quest.tags.join(", ")}` |
| `📚 Patterns` | Gallery modal (15 entries V1) | varies |
| `{i18n}` | Existing, unchanged | `{i18n:key}` |

### 4.3 Inline autocomplete (Template fields)

Triggers:
- `{` → identifiers available in scope + `{i18n:` literal trigger
- `.` after identifier → methods valid for the type (on list: `.join`, `.length`, `.first`, `.last`, `.at`, `.contains`; on other: silence)
- `%` → PAPI search

**Smart scoping**: an `inferScope(packPath)` helper returns visible identifiers + types. Reusable by lint and autocomplete. If the Element does not iterate, `index/count/first/last` do not appear.

**Suggestions**: name + type + short description + example.

### 4.4 Live preview + sample context

Uses the current `Menu.sampleContext`. Updates live (debounced 100ms). Errors visible inline with plain-language messages.

**Multi-iteration preview**: if the Element iterates, shows 3 instances side by side (first / middle / last) to visualize `first`/`last`/`index`.

### 4.5 Patterns gallery V1 (15 entries)

| # | Title | Generates |
|---|---|---|
| 1 | Display a placeholder | `{quest.name}` |
| 2 | Conditional color based on amount | `{quest.gold > 1000 ? "<gold>" : "<gray>"}` |
| 3 | Conditional text based on perm | `{%player_has_permission_vip% == "true" ? "VIP" : ""}` |
| 4 | Join list with commas | `{quest.tags.join(", ")}` |
| 5 | Join list on lines | `{quest.tags.join("\n")}` |
| 6 | Page X of N | `Page {index + 1} of {count}` |
| 7 | Star on first element | `{first ? "★ " : ""}{quest.name}` |
| 8 | Locked text if no perm | `{%player_has_permission_shop_vip% == "true" ? "" : "<dark_gray>(VIP required)</dark_gray>"}` |
| 9 | Compare balance to a price | `{%vault_eco_balance% >= quest.gold ? "<green>Buy" : "<red>Too expensive"}` |
| 10 | Prefix based on rarity | `{quest.rarity == "legendary" ? "<gold>★ " : ""}{quest.name}` |
| 11 | Count items in list | `{quest.tags.length} categories` |
| 12 | First or default | `{quest.tags.first}` |
| 13 | Cycle a category on click | (action `set_arg_cycle_next`) |
| 14 | Reset a category | (action `set_arg`) |
| 15 | Reuse an i18n term | `{i18n:common.coins}` |

**PAPI note**: entries 3 and 8 use `%player_has_permission_<perm>%`, which is a standard PlaceholderAPI pattern ("true"/"false" as a string). Entry 9 uses `%vault_eco_balance%` (PAPI's Vault extension). Adapt depending on the plugins actually present on the target server.

### 4.6 Conditions UI — `expression` hidden behind "Advanced"

Condition add picker:
- Has permission
- Has enough money
- Compare a value (structured form: left side / operator / right side + AND/OR)
- ──────────
- Advanced: free expression → opens `<ExpressionEditor>` form-only

The editor preserves identity: if the admin created via "Compare a value", we store as `placeholder_equals` when possible (simple equality), otherwise as `expression` (other operators).

### 4.7 Action picker — new entries

"Context" group in the action picker:
- Set a context value → `set_arg` (form: arg dropdown + value Expression form)
- Cycle to the next value of a list → `set_arg_cycle_next` (form: arg dropdown + list dropdown or Expression)
- Cycle to the previous value → `set_arg_cycle_prev` (same)

### 4.8 Error messages — plain language

Technical → admin mapping:

| Technical | Admin |
|---|---|
| `Unknown identifier 'categry'` | `⚠️ "categry" does not exist here. Did you mean "category"? Available: category, player, quests` |
| `Cannot call .join on type number` | `⚠️ "quest.gold" is a number, not a list. .join only works on lists (like quest.tags).` |
| `Parse error at col 17: expected ')'` | `⚠️ Missing closing parenthesis near "...quest.gold > 1000".` |
| `i18n cycle: a→b→a` | `⚠️ Translation cycle: key "a" refers to "b" which refers to "a". Break one of them.` |
| `i18n depth exceeded` | `⚠️ Too many nested translations (max 5). Flatten the chain.` |

Shown inline under the field + in a central "Issues" panel.

### 4.9 Mobile adaptation

Relevant memory: `<lg = mobile single-pane + drawers`, no hover-only.

- Template toolbar: becomes a single `+` button that opens a bottom sheet with all the actions
- Live preview: "👁 Preview" toggle → bottom sheet
- Autocomplete: popover → bottom sheet
- Sample context editor: dedicated drawer

### 4.10 Form-only on Expression fields (V1)

No "raw code" mode in V1. Expression fields are built via a structured form that covers:
- Binary comparison (left side / op / right side)
- AND/OR composition with parentheses
- Ternary (if / then / else) — reuses the "? If..." button from the Template toolbar
- Method calls (`.length`, `.first`, `.contains(x)`) after selecting a list identifier

For V1.5+, add a "⚙ Code" toggle that exposes the raw textfield with autocomplete (for power users).

## 5. Java runtime

### 5.1 `expr/` module

```
plugin/src/main/java/net/artisanmc/expr/
├── lexer/Lexer.java
├── parser/Parser.java
├── parser/ParseError.java
├── ast/{Node, Literal, Identifier, PathAccess, MethodCall, BinaryOp, UnaryOp, Ternary, PapiToken, IndexAccess}.java
├── eval/{Evaluator, Scope, Coercion, EvalError}.java
├── cache/AstCache.java
└── template/{TemplateRenderer, I18nResolver, TemplateTokenizer}.java
```

No Bukkit/Paper dependency in the pure DSL code. Only the integration functions access PAPI / context.

### 5.2 Implementation

- **Lexer**: tokenizes string → `List<Token>`. Position-aware. ~250 LOC.
- **Parser**: recursive descent. One function per EBNF rule. ~400 LOC.
- **Evaluator**: visitor. `evaluate(Node, Scope) → Object` (`null|String|Double|Boolean|List<Object>|Map<String,Object>`). Centralized coercion. ~350 LOC.
- **AstCache**: Caffeine LRU 5000 entries. Key = `(expressionString, packId, packVersion)`. ~50 LOC.
- **TemplateRenderer**: orchestrates the 8 pipeline steps. ~250 LOC.
- **I18nResolver**: recursive resolve with visiting set + depth limit. ~80 LOC.
- **Java tests**: ~600 LOC (see 6).

**Java total**: ~2060 LOC + 600 tests.

### 5.3 Threading

Everything on the main thread (Bukkit) for V1. PAPI must be called on the main thread. No concurrent maps, no locks. If a heavy connector later has to go async, we fetch async then re-render on main.

### 5.4 Plugin integration points

| Hook | When | What to call |
|---|---|---|
| Menu open | Player opens | `render` on title + visible appearances |
| Click handler | Player clicks | `evaluate` on conditions, dispatch action |
| `set_arg` action | During click | `evaluate(value)`, mutate `MenuSession.context`, redraw |
| `set_arg_cycle_*` action | Same | Evaluate list, find current, set to next/prev wrap, redraw |
| `expression` condition | During Conditions evaluate | `evaluate(expr)` → `toBoolean` |

`MenuSession` (per player, in memory): stores a `Map<String, Object> context` mutated by `set_arg*`. Dropped on close. No persistence.

### 5.5 Performance — targets to validate

Targets to benchmark (estimates, to be measured empirically on Paper 1.21 + JRE 21):

| Op | Target |
|---|---|
| Parse expression cold | ≤ 50 µs |
| Eval expression cached | ≤ 5 µs |
| Full Template render | ≤ 200 µs |
| Total menu open (54 slots) | ≤ 30 ms |

Validated by JMH benchmarks (see 6.3).

### 5.6 Editor side (TS)

Mirror of the parser+evaluator in TS for live preview and autocomplete:

```
web/src/lib/expr/
├── lexer.ts
├── parser.ts
├── ast.ts
├── evaluator.ts (operates on sample data)
├── coercion.ts
├── scope.ts (inferScope per packPath)
└── autocomplete.ts
```

~1650 LOC + 400 tests.

**Java/TS equivalence** guaranteed by a shared fixture file `expr-fixtures.json`: ~100 reference expressions with input + expected output, run by both test suites.

## 6. Test plan

### 6.1 Java unit tests (JUnit 5)

| Module | Coverage |
|---|---|
| Lexer | Each token, edge cases (`%foo_bar%`, escaped quotes, decimals) |
| Parser | Each EBNF rule, syntax errors, operator precedence, ternary associativity |
| Evaluator | Each Node type, exhaustive coercion matrix, safe access (null path), methods, arithmetic edge cases |
| AstCache | Hit/miss, LRU eviction, invalidation on version |
| TemplateRenderer | Full pipeline, i18n cycle, depth limit, PAPI mock, tokenize edge cases (curly braces in strings) |
| I18nResolver | Cycle detection, depth limit, missing key fallback |

### 6.2 Paper integration tests

**Setup to create** (does not exist yet in the repo): Paper 1.21 + EssentialsX Docker container, test menu fixtures.

Scenarios:
- Real menu opened with context input + connector, check rendering
- Click action `set_arg_cycle_next` → check context value mutated + menu redrawn
- `expression` condition with PAPI → check correct evaluation
- Multi-language nested i18n → check fallback chain

### 6.3 JMH benchmarks

Separate `expr-bench` module:
- Parse cold vs warm cache
- Simple eval (`a == b`) vs complex (methods + nested ternary)
- TemplateRenderer end-to-end (with PAPI mock)

Target: no regression > 10% between versions.

### 6.4 TS editor tests (Vitest)

- TS parser mirror: equivalence with Java on shared fixtures
- Autocomplete: `{`, `.` triggers, scope inference
- Form-to-expression generator: each gallery pattern generates the right string
- Lint: wrong identifier → right plain-language suggestion

### 6.5 E2E tests (Playwright)

On the web editor:
- Insert a placeholder via toolbar → check generated text
- Build a conditional via form → check generated text
- Pattern gallery → click → inserts the pattern into the field
- Live preview updates on each keystroke
- Error visible inline on unknown identifier

## 7. Migration

No migration of existing packs required: the grammar is backward compatible. A simple `{name}` is a valid expression. Old packs simply do not use the new features until the admin edits them.

Plugin side: no feature flag — the feature is in the engine from the version that ships it.

Editor side: publish validation prevents using the new features on a pack targeting a plugin that is too old (warning visible before push to live).

## 8. Out of scope V1

Captured for later spec(s):

- **"Raw code" mode** on Expression fields → V1.5+
- **Free functions in the DSL** (cycleNext, i18n(key), etc.) → if a use case emerges
- **String methods** (`.toUpperCase`, `.substring`) → if requested
- **Extended arithmetic** (`*`, `/`) → same (and find an alternative to `%` modulo, which conflicts with PAPI)
- **Local variables / let** → not planned
- **Parameterizable direction `set_arg_cycle` action** (alternative to the two separate actions) → if simplification is requested

## 9. Future dependency

**Spec B — Unification of default/sample/connector live** (to brainstorm separately)

Rework of `Menu.sampleContext` + `ContextInput.default` + connector live fetch. The DSL does not need to wait for this rework — it consumes the new API when it exists. For V1, the DSL uses the current `Menu.sampleContext` for the editor preview.

## 10. Glossary

| Term | Meaning |
|---|---|
| **Template** | Mixed string: literal text + `{expression}` + `<MiniMessage>` + `%PAPI%` + `{i18n:key}`. Format of LText fields and other text fields. |
| **Expression** | String containing ONE DSL expression (the whole string). Format of the `set_arg.value`, `expression.expr`, `set_arg_cycle_*.list` fields. |
| **DSL** | The embedded custom expression language (Domain-Specific Language). |
| **AST** | Abstract Syntax Tree, result of parsing an expression. Cached. |
| **Scope** | Set of identifiers visible at a given point of editing (menu inputs + current iteration alias + iteration meta). |
| **PAPI** | PlaceholderAPI, the standard Bukkit plugin for dynamic placeholders (`%player_name%` etc.). |
| **MM** | MiniMessage, Adventure/Paper's text markup format (`<gold>`, `<bold>`, etc.). |
| **LText** | Wrapper interface for an i18n-keyed text field (`{ key: I18nKey }`). |
| **MenuSession** | Per-player runtime state of an open menu (in memory, dropped on close). |
