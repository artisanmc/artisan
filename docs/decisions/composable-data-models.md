# Composable Data models — one type system, declared or authored

**Status:** accepted (2026-07-25) — design locked (grill-with-docs session),
nothing implemented yet. Spec:
`docs/superpowers/specs/2026-07-22-composable-config-schemas-and-forms.md`.

## Context

Two Add-ons force the same missing primitive: Boutique needs a curated
master-detail catalog with localized `name`/`lore`; MSQuests needs deeply
structured documents (maps, enums, discriminated unions, nested lists). The
"Artisan as a configuration framework" vision (2026-07-23) makes this the
centerpiece: any plugin adopts the standard **by declaration, never by code**.
Files-first (ADR `files-first-source-of-truth`) is fully shipped and is the
substrate: files are the canonical, hand-editable truth.

## Decision

1. **One type system.** The composable schema IS the existing **Data model**,
   enriched with `map`, `enum`, and discriminated `union` (tag-selected
   variants) — no parallel "Schema" concept. Like Data sources, models have two
   **provenances**: *module-declared* (namespace-qualified, admin-read-only)
   and *project-authored* (the existing case). One form generator serves both.
   *Rejected:* a second type system — two form generators, guaranteed
   divergence (the editorJson lesson).

2. **No third source shape.** A deeply structured per-file config (a quests
   category) is a **Table row**; Tables gain a **file-granularity** choice
   (whole table in one file, or one file per row, named by the Row key).
   Granularity is serialization only — consumers are blind to it. *Rejected:*
   a "document" shape (concept overlap + glossary collision with Document).

3. **Runtime stays model-blind; inline schema is the runtime contract.**
   > **Révisé par l'ADR `bare-data-files` (2026-07-26)** : le contrat runtime
   > devient « schéma sur le même disque ou dans le même JAR », plus « inline
   > dans le fichier » — le plugin résout la déclaration JAR ou `models/` au
   > load ; l'inline reste lu à vie mais n'est plus écrit.
   `data/v1` gains the new kinds in its **inline, denormalized** `fields`
   vocabulary (variants inlined under their tag); the plugin walks value +
   inline schema together (ltext localization inside unions/maps included) and
   never reads `models/`. Source files always carry a schema that agrees with
   their data ⇒ **model evolution can never break a running server**; it is an
   edit-time concern only. `model/v1`/`data/v1` are mutated in place (same
   dated pre-prod dispensation as menu/v1). *Rejected:* plugin-side model
   resolution.

4. **Declaration channel = Presence.** An Add-on declares its models from its
   JAR (SDK, at onEnable); the `hello` reports them (like `data_sources`);
   wire form is `model/v1` — the same document as `models/<id>.yaml`, one
   schema format everywhere. Third-party-compatible: a declaration is data in
   the plugin's JAR, never code in the editor/backend. *Rejected:* authoring
   Add-on models in the editor — the shape must be versioned with the binary
   that consumes the data.

5. **Declarative, versioned migrations — never code.** Declared models carry a
   monotonic version; the declaration ships **declarative migration steps**
   (closed vocabulary: rename_field, move_field, set_default,
   rename_enum_value, rename_variant, …) applied by the editor at load and
   materialized at the next save. Anything the vocabulary cannot express
   **dangles visibly** in the form (non-hermetic contract) — no silent
   destructive rewrite, no arbitrary migration code (which would break the
   by-declaration vision). Project-authored models reuse the same engine
   (the editor generates the steps mechanically). Consumers (interpolations,
   Placements) are never rewritten — they dangle, as today.

6. **`actions`/`conditions` kinds are core-only.** In any model they mean
   Artisan's Action chain / core condition vocabulary, executed by the core
   engine; module-specific behaviour goes through the existing namespaced
   command bridge (`run_command "quests:… "` → CommandRegistry). Unions are
   for **data** variants only. *Rejected:* per-module action unions (two
   action editors) and module-extensible DSL verbs (heavy; can still be added
   additively later — e.g. a future core `boss_bar` action).

7. **Form generation derives from the model; hints and validation are part of
   it.** No separate ui-schema artifact: fields carry a closed set of
   presentation hints (label, help, widget, section, **master-detail**) and a
   closed validation vocabulary (`required`, `default`, `min`/`max`,
   `pattern`, `locked`). Enforcement is **asymmetric**: blocking inside the
   generated form (`locked` = read-only there), never blocking for
   hand-edited files — invalid values are surfaced, the runtime stays
   tolerant. *Rejected:* hard validation at push (rebuilds the data-loss trap
   P3 just removed) and bespoke per-Add-on forms (code in the editor).

8. **Existing formats migrate one-shot, plugin-side.** Boutique: first boot
   post-upgrade converts `boutique/shop.yaml` → declared-model Table (per-row
   files, ltext name/lore) and pushes it (precedent: the buy_commands
   migrator). MSQuests: gains an Artisan reader (with a small **autonomous**
   ltext resolver — no hard dependency on the Artisan plugin, "your config
   works without us") + the same one-shot migrator, keeping its legacy reader
   during transition. *Rejected:* compiling Artisan edits back to native
   files (direction A of the spec — kills i18n, fragile round-trip).

## Out of scope (deferred, not rejected)

Separate ui-schema layer; module-declared DSL verbs; consumer rewrite on
rename; hosting/publication of third-party-owned projects (own grill when a
real third party shows up). Expression sandboxing became moot: no decision
lets third-party expressions in (migrations are data, actions are core).

## Build sequence

1. Type system (fix model-ref, map/union/enum full-stack, per-row granularity)
2. Declaration channel + versions + migration engine
3. Form generator (hints, master-detail, validation, `conditions` kind)
4. Boutique migration
5. MSQuests onboarding

CONTEXT.md updated in the same change (Data model, Data source entries).
