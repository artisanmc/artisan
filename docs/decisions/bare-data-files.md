# ADR: Bare data files — the schema lives next to them, never inside

**Status**: accepted (2026-07-26)
**Upstream context**: `composable-data-models.md` (decision ③ revised),
`project-sources-and-data-models.md` (the two shapes unified),
`files-first-source-of-truth.md` (P2b "models ignored by the plugin" reversed).

## Context

The data/v1 format mixed **definition** (`fields:`) and **values** in the same
file, minted ltext keys even for a single language, and required a header
(`schema`/`id`/`shape`). A one-line setting weighed 9 lines of ceremony.
For a Minecraft ecosystem where hand-edited YAML is the cultural norm, that is
a deterrent — and the trust anchor "your config works without us" demands that
the file exit door be *pleasant*, not just possible.
Triggering finding: a model's declaration lives in the add-on's **JAR** (not in
the backend), and `models/<id>.yaml` already exists — the offline contract never
needed the schema *inline in the data file*, only *on the same disk or in the
same JAR*.

## Decisions

**① Schema resolution precedence**: inline `fields:` > JAR declaration
(add-on source) > `models/<id>.yaml` (project-authored source) > untyped
fallback. First found wins, the others are silently ignored (never an
error — non-hermetic philosophy). Inline is **never written again** by our
tools but stays readable for life.

**② A source = one typed value (shapes unified)**: the Table/Config distinction
disappears. **Object** root → interpolation (`{pack:id.field}`), simple form.
**List-of-model** root → iterable, placeable, Set target, `key_field` (default
`id`), master-detail. `key_field`, `granularity` and `order` are properties of
the **root list kind**, no longer of a shape. Detecting a bare file: YAML
mapping = object, YAML list = list; the schema resolved elsewhere takes
precedence if it exists. `shape: table|config` = legacy alias read, never
written. The editor UI (spreadsheet vs form) is **derived** from the root kind.
An `iterates.source` pointing to a non-list source iterates empty, silently.

**③ Optional header**: `schema:`/`id:`/`shape:`/`fields:` are still honored if
present (a file starting with `schema: data/v1` is the legacy form); otherwise
the file is pure values, `id` derives from the filename, `name` from the id.
In per-row mode, `_source.yaml` becomes optional: absent → rows = all `.yaml`
files of the folder sorted by filename; present → it only carries `order:`
(+ overrides).

**④ ltext = hybrid contract, like menus**: an ltext value on disk is **the
literal text of the default language** (`name: "Armes"`). Other languages live
in `lang/<lang>.yaml` under the key-site keys (the address does not change). A
value that matches a key present in `lang/` still resolves (tolerance);
otherwise it is literal. Single language = zero keys, zero `lang/`.

**⑤ The editor only writes the bare form**: source bound to a declared model →
pure-values file; project-authored source → schema in `models/<id>.yaml` + bare
data file (creating a source emits both). An imported legacy file is
re-canonicalized on the next save. **Corollary: the plugin reads `models/` at
load** to type project-authored sources (ltext walk) — same move as template
resolution (P2a), still offline. "Models ignored by the plugin" (P2b) is
revoked.

**⑥ No re-migration of existing content**: projects already in the verbose form
stay as they are (tolerant readers for life); re-canonicalization happens
naturally at the next editor save. `ShopDataMigrator` produces the bare form for
future `shop.yaml` migrations (and keeps `granularity: row`, a shop choice).

**⑦ Comments**: the export **projects the model's hints as YAML comments**
(`help`/`label` → `# …` above the field) + a generated header
(`# Managed by Artisan — editable by hand`), regenerated at each export (no
preservation needed); a **hand-written header comment block** is captured at
parse time and re-emitted verbatim. Help written once in the model serves the
form (tooltip) and the file (comment). **Deferred**: preserving arbitrary
comments in the middle of files (generalized comment-aware AST).
> **Clarified and hardened by the `yaml-assisted-editing` ADR (2026-07-27)**: the
> deferral becomes a **refusal** — hand-written comments are never preserved
> (surgical patching was examined then rejected), and the generated header must
> **say so**. The "above the field" placement described here must be applied
> as is: the code grouped them in a header block. On the form side, help stops
> being a tooltip and becomes visible under the field, with the technical name
> still displayed next to the label.

## Consequences

- `data/v1` stays v1: every existing form stays valid, we only add shorter
  forms (tolerant relaxation; the "new folder" discipline targets breaks).
- `CONTEXT.md` § Data source: "two shapes" replaced by "one typed value; list
  root ⇒ iterable/placeable".
- A `shop_settings.yaml` falls back to `whole_shop_discount: 0`; a hand-written
  catalog becomes as simple as a classic `shop.yaml` again, but typed, editable
  in the generated form, multi-language on demand.

## Rejected alternatives

- **Keep the inline schema mandatory** (original decision ③): the offline
  contract does not need it — JAR and `models/` are on the same disk.
- **Mass re-migration of existing content**: risk on healthy data, zero gain.
- **`data/v2`**: nothing breaks, tolerance is enough.
