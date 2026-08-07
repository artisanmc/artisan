# Expression parity — one Template engine, editor and server

**Status:** accepted (2026-08-05), implemented through build step 5 — one engine
in each language, locked by `testdata/template-conformance.json`; `ArgResolver`
deleted; `until()` shipped, `date()` deferred (see Out of scope); step 6 (retiring
the modules' pre-formatted fields) pending. Supersedes the "closed grammar, no string methods"
stance of `docs/superpowers/specs/2026-05-03-expression-dsl-design.md`, which the
editor implementation had already outgrown. CONTEXT.md gains **Expression** and
**Template** in the same change.

## Context

The **Expression** sub-language and the **Template** layer are fully implemented
in TypeScript: `editor/src/lib/expr/` has a lexer, parser, evaluator, AST cache,
and a closed method vocabulary (`join`, `pluck`, `length`, `first`, `last`, `at`,
`contains`), plus paths, indexing, ternary and `%papi%`.

The server has none of it. `MenuRenderer` resolves every text field through
`ArgResolver`, a 72-line regex matching `{name}` and `{alias.field}` — one level
of field, no methods, no ternary.

**The editor therefore promises what the server does not deliver.** An admin can
write `{rewards.pluck("name").join("\n")}` in a lore field, see it render
correctly in the preview, and ship a menu where the player reads the raw
expression text. Nothing warns them; `ArgResolver` leaves unmatched placeholders
as-is by design.

The root cause is not the missing Kotlin code alone. The capability had **no name
in the glossary** (CONTEXT.md mentioned "expression" only as a non-example of the
Action DSL), **no user-facing documentation** (nothing in `docs-site`), and **no
server implementation**. Module authors could not have found it. So they worked
around it, each in their own plugin: `price_display` in the Boutique,
`rewards_lore` and `countdown` in the MSQuests integration — Data source rows
carrying a *view computed at a moment* instead of a *fact*, with formatting,
separators and translations frozen by the plugin and unchangeable by the menu.

That is the failure this ADR exists to prevent, more than any particular method.

## Decision

1. **Full parity, not a runtime subset.** The plugin implements the same
   Expression evaluator and Template renderer as the editor, locked by a shared
   conformance vector in `testdata/` (the discipline already used for
   `action-dsl`, `i18n-address`, `lang-tree` and `project-hash`). A valid
   Expression renders the same string on both sides — that equality is the
   contract, and it is what makes the preview trustworthy. *Rejected:* a declared
   runtime subset, which forces the editor to model the runtime's limits — a
   second grammar to keep in sync, the editorJson lesson again.

2. **Templates are pre-compiled at bundle load.** `BundleCompiler` parses every
   Template of the Bundle's files once and keeps the ASTs in the in-memory model;
   rendering only evaluates. Parsing is a pure function of the source text, so it
   is cacheable; evaluation depends on the row and is not. A malformed Expression
   is then reported **once at reload, with its file**, instead of failing at the
   first player who opens the menu. *Rejected:* an LRU cache mirroring the
   editor's (the template set is finite and known in advance — a cache adds
   eviction and a slow first render for nothing).

3. **Data-borne braces are never evaluated.** A `{…}` appearing inside a Data
   source *row value* stays literal. Templates come from Project files, which an
   admin authors; a module returning `"{player.name}"` in a row would otherwise be
   injecting a template into someone else's menu. This is stated explicitly
   because it looks like a bug to a future reader.

4. **An unbound root identifier renders the segment's source text.** `{foo}` with
   no `foo` in scope renders `{foo}`, visibly. A *bound* identifier whose field is
   missing (`{quest.nope}` where `quest` exists) renders empty — a Data source row
   is not hermetic and an absent field is normal, not a typo. This extends to
   `{…}` the rule already applied to `%papi%` on both sides (`return v || whole`),
   and follows the project's non-hermetic philosophy: a dangling ref is tolerated
   **and visible**. *Rejected:* aligning on the editor's silent empty string,
   which would make every typo in an already-deployed Project silently erase text.

5. **Every player-facing text field is a Template; `ArgResolver` is deleted.**
   Item name, lore, menu title **and** `material`. Material is not prose, but an
   Expression there is genuinely useful (`{quest.can_start ? "EMERALD" :
   "GRAY_DYE"}` for a locked-quest icon), and an unresolvable material already
   falls back to `STONE`. *Rejected:* keeping `ArgResolver` for material — that
   would maintain two text engines in Kotlin forever, with two behaviours on an
   unknown identifier: the very divergence this ADR removes.

6. **Time is carried as absolute instants; the Template formats it.** A Data
   source row exposes `period_end: <epoch millis>`, and the menu writes
   `{period_end.until()}` ("3h 12m"). "The period ends at T" is a fact; "3h 12m left" is a view. *Rejected:* relative
   remaining-seconds, which freezes a computation into the data and cannot be
   re-derived. Known limitation: a menu is redrawn on every interaction
   (pagination and `open_menu` go back through `MenuRenderer.open`) but never on
   its own, so a counter is exact at each draw and simply does not tick while the
   player stands still. Fine for a reset countdown measured in hours, visibly
   wrong for one measured in seconds. Absolute instants are what would let a
   future refresh fix that without refetching the source.

7. **Format patterns and units are Project data; the timezone is install
   config.** Units live in the Project's `lang/<code>.yaml` under a reserved
   `artisan.*` namespace, so they vary with the viewer's language and the editor —
   which already loads `lang/` — previews them identically by construction. The
   timezone goes in `plugins/Artisan/config.yml`, because only the server knows
   where it runs. General rule: **whatever must match between preview and game
   lives in the Project; whatever only the server can know lives in
   `config.yml`.** Consequence to accept: `date()` in the editor preview shows a
   different zone than the server. *Rejected:* formats in `config.yml`, which the
   backend never receives — it would recreate the very divergence being fixed.

8. **Presentation keys are siteless, and every lang file carries them.** The
   `artisan.duration.*` keys are written into `lang/<code>.yaml` seeded with their
   defaults, so an admin opening the file **discovers** the capability — a
   first-class requirement here, not polish (see Context). Defaults stay hard-coded
   and identical in both implementations (pinned by the vector), so an existing
   Project needs no migration.

   This refines the inline-mode rule rather than excepting it: "no default-language
   lang file in inline mode" was written for **site-addressed** keys, whose truth
   already lives in their document. A presentation key has **no site** — no
   document could hold it — so the lang file is its only possible home, and inline
   mode emits one containing those keys alone. *Rejected:* leaving inline-mode
   projects with no lang file at all, which would have made the capability
   discoverable only in `extract` mode.

9. **One table is the documentation, the parity checklist and the conformance
   vector.** Every entry of the method vocabulary has a row with an example, in
   `docs-site/src/content/docs/editor/expressions.md`. A method absent from that
   table has no doc, no test and no server implementation — the omission that
   caused this ADR becomes structurally impossible.

## Out of scope (deferred, not rejected)

- **Menu refresh on a timer.** A menu is redrawn on every interaction but never
  spontaneously, so a counter does not tick between clicks. Only worth solving for
  short countdowns; its own decision.
- **Retiring the pre-formatted module fields** (`price_display`, `rewards_lore`,
  `countdown`). They stay until parity ships — they are not debt today, they are
  the only way to express those strings. Removing them is a follow-up per module.
- **`date(pattern)`.** Only `until()` shipped. A clock-time needs a pattern
  vocabulary implemented identically in both languages *and* the timezone answer
  from §7, whose preview/server mismatch is a real cost; every need voiced so far
  (reset countdown, quest expiry) is a duration, which is timezone-free. Additive
  when a real need for a clock time shows up — and then we will know which zone it
  wants.
- **`index` / `count` / `first` / `last`** meta-iteration identifiers: specified in
  2026-05-03, implemented in the editor, never bound at runtime. Part of the parity
  work, listed here so the gap is not rediscovered as a bug.
- Opening the vocabulary to module-declared methods. The vocabulary stays closed
  and core-only — same reasoning as `actions`/`conditions` in ADR
  `composable-data-models` §6.

## Build sequence

1. The table: vocabulary, examples, doc page — the contract everything else follows.
2. Conformance vector in `testdata/`, with a fixed clock and a fixed translation
   table so time formatting is deterministic.
3. Kotlin evaluator + Template renderer against the vector; `evalLeafOrThrow`
   (already dual) is the starting point.
4. `BundleCompiler` pre-compilation; `ArgResolver` deleted; the three call sites
   move to the Template renderer.
5. `until()` / `date()` + the `artisan.*` lang block, defaults and bootstrap.
6. Per-module cleanup of the pre-formatted fields.
