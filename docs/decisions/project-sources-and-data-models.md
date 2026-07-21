# Project sources, Data models, and the `data/` bundle dir

**Status:** accepted (2026-07-20)

## Context

Manual project data sources (`pack.dataSources`, refs `pack:<id>`) were raw JSON/YAML
with an *inferred* type, editable only through a CodeMirror YAML pane — and they were
**preview-only**: `transform.ts` never exported them and the plugin had no `pack:`
resolver, so a menu iterating one rendered empty in-game. They also could not hold
localizable text (rows are raw strings, the LText system only covers template
appearances) nor item values with a proper picker. The shop add-on has the same
monolingual hole (per-item literal `name`/`lore`).

## Decision

1. **One "Data source" notion, two provenances.** Module-contributed
   (`namespace:source_id`) and **Project source** (`pack:<id>`, content of a Project,
   always static, ships in the Bundle). Consumers (Element / Item template /
   Placement) stay provenance-blind. Rejected: a separate concept ("Dataset") —
   would duplicate the stability/Row-key/placement machinery for one consumer
   experience.

2. **Declared schema via Data models, recursive.** The inferred `FieldType` is
    replaced by an admin-declared schema. A **Data model** is a named, project-level,
    recursive field shape (text, localized text, MiniMessage text — single-/multi-line,
    stored as a plain string, rendered-facade editing affordance — number, boolean,
    item, list, object; models may reference models, no cycles). Every **Table** is a
    table *of* one Data model (auto-created with the table); the Row key is declared
    **on the model**.
   Rejected: flat-only schemas (real cases like variable-length localized lore need
   nesting); optional inline schemas (two representations to maintain).

3. **Two source shapes.** **Table** = list of rows (iterable, placeable, Set
   target). **Config** = a single object for interpolation (settings/constants),
   not placeable, not a Set target; nested lists inside it remain iterable via the
   existing dotted-path support.

4. **Model edits: data migrated, references dangled.** Editing a model rewrites the
   rows the editor owns synchronously (add/rename/retype/drop, with coercion
   text↔ltext). Consumers of a changed field (`{alias.field}` interpolations,
   Placements via Row key) are never rewritten — they dangle, per the non-hermetic
   contract.

5. **Row ltext values are ordinary LTexts / Key sites.** Canonical keys derive from
   the Row key: `sources.<sourceName>.<rowKey>.<fieldPath>` (all segments lowercase;
   Config: no rowKey segment). Source names are lowercase and unique per project.
   Renaming a row's key value re-canonicalizes (accepted churn, keys stay readable).
   Item fields share the material value-space (`material | item:<id> | custom ref`).

   **Row-key invariant.** New rows receive the first free positive integer for a
   numeric/integer Row key, or the first free textual row_n; gaps are deliberately
   reused. Textual keys are stored as trim().toLowerCase() and must be unique
   case-insensitively within a source. Empty or duplicate manual edits are rejected
   inline without changing the row or its translations. Canonical ltext paths use
   this validated lowercase key: sources.<sourceName>.<rowKey>.<fieldPath>.

   The i18n visitor retains positional row_n only as a defensive fallback for
   legacy/imported rows with invalid empty or duplicate keys. That is distinct from
   an authored generated row_n, which is a valid stored Row-key value. Invalid
   imported rows are not repaired at load time: their existing identifiers can be
   externally referenced, so silent renaming would break consumers.

6. **Editing is form-only.** The YAML pane is removed (ltext values make a raw
   textual representation non-editable truth — it would show opaque keys). Bulk
   entry, if needed later, becomes a one-shot validated *import* action, not a
   second live mode. Existing preview-only sources are **reset**, not migrated.

7. **Bundle: denormalized `data/` dir; models are invisible at runtime.** Export
   writes `data/<source_id>.yaml` = `{ shape, key_field, fields, rows }` — the
   model is inlined as a flattened field-kind map, mirroring how Item templates are
    inlined into `menu/v1`. ltext values export as their canonical keys (translations
    already travel in `lang/`); item values as refs (stacks travel in `items/`);
    MiniMessage fields export as ordinary strings (`kind: string` — data/v1 never
    sees the editing affordance). The
   reserved `pack:` namespace resolves at the **renderer fetch seam**
   (`ProjectDataResolver`, over the live bundle list) — *amended at implementation
   time*: it was first planned as a `DataSourceRegistry` registration, but the
   registry feeds the presence report (`data_sources` WS), which would leak project
   content into the editor's "server sources" list and duplicate what the editor
   already authors locally; the seam also survives hot-reload without an
   unregister API. ltext fields resolve at **bind** time (the viewer's language is
   known when the menu opens) so `resolveText` is untouched; a config-shaped
   source binds its object whole, unshaped. New JSON schema:
   `docs/schema/data/v1/`. `BundleHasher` covers `data/` automatically.

## Consequences

- Closes the preview-only gap: `pack:` sources become deployable content.
- The boutique's monolingual `name`/`lore` can migrate onto this mechanism — its
  own epic (prod shops are not resettable).
- Rides along: drop the runtime's dead `PlacementOverrideYaml`/`applyOverride`
  path, aligning the plugin with the no-per-placement-override domain rule.
