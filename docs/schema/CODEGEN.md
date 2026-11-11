# Schema codegen (quicktype)

Source of truth: `docs/schema/<name>/v1/schema.json`.

Kotlin command (plugin):
`npx quicktype --src <schema.json> --src-lang schema --lang kotlin --framework jackson --package <pkg> -o <out.kt>`

TS command (editor):
`npx quicktype --src <schema.json> --src-lang schema --lang typescript --just-types --prefer-unions --prefer-const-values -o <out.ts>`

Spike verdict 2026-06-08: **NO-GO** — quicktype 23.2.6 (Node 25) does not produce a usable type hierarchy for our `const`-discriminated unions. Two blocking problems. (1) Hard crash: a boolean `"const": true` (`ComponentClick.use_component_default`) makes quicktype fail with `Error: s.codePointAt is not a function` — quicktype assumes every `const` value is a string. No output is generated as long as this boolean const exists in the schema. (2) Even after working around the crash (replacing the boolean const with `"enum": [true]` in a throwaway copy of the schema), the `oneOf`s discriminated by `const` (`Condition`, `Action`) do **not** become Kotlin `sealed class`es or TS discriminated unions: quicktype flattens the 16 variants of `Condition` (and the 15 of `Action`) into **a single god-object `data class`/`interface`** with ~20-25 fields, all nullable, plus an `enum`/string union for the `type` discriminant. No typed subclass (`HasPermission`, `OpenMenu`…), no Jackson `@JsonTypeInfo`/`@JsonSubTypes` annotation emitted, and the merge even produces broken artifacts (`amount?: number | number`, `of?: Cond[] | Cond` merging `not`/`and`/`or`). This is exactly the `Map<String, Any?>`-equivalent that the acceptance criteria reject. Note: quicktype does emit `sealed class`es for *scalar/shape* unions (`Amount` = Double|Long, `RangeUnion` = string-enum|object), so the generator can do sealed classes — it just does not do it for `const`-discriminated unions, which are precisely our hard case.

## Chosen fallback (NO-GO)

**Hand-written** types on the Kotlin and TS sides, modeling `Condition`/`Action` as real hierarchies:
- Kotlin: `sealed class Condition` / `sealed class Action` with one `data class` subclass per variant (`HasPermission(perm)`, `OpenMenu(menuId, …)`, …), polymorphic Jackson deserialization via `@JsonTypeInfo(use = NAME, property = "type")` + `@JsonSubTypes`. Package `net.artisanmc.plugin.schema.menu`.
- TS: `type Condition = HasPermission | HasMoney | …` (union discriminated by a literal `type`), one interface per variant.

The JSON schema remains the **source of truth**. Consistency between types and schema is guaranteed not by codegen but by a **CI drift check**: a set of fixtures (one minimal valid example + one rich example per `Condition`/`Action` variant, plus a few complete menus) is validated against `schema.json` via **ajv** (draft 2020-12). Any field added/removed/renamed in the hand-written types that diverges from the schema is caught either by compilation (the fixtures are also parsed into the types) or by ajv. Concretely:
1. `docs/schema/menu/v1/schema.json` = truth.
2. Fixtures `docs/schema/menu/v1/examples/*.json` (at least 1 per union variant).
3. CI: ajv-validate all fixtures against the schema + parse them into the Kotlin types (plugin test) and TS types (editor test). Fail on divergence.

A quicktype re-spike is recommended only if: (a) an upstream fix for the boolean `const` crash lands **and** (b) a reliable option to generate sealed classes from `oneOf`+`const` appears. Otherwise, stay on manual types + drift check.
