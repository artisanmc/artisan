# Item templates + data library authoring

**Status:** superseded in part (2026-07-31)

> **Revised 2026-07-26 (user feedback)**: the "item set" lives at the **menu
> level**, not the data level. Creation happens from "Menu data"
> (`createMenuSet`) and produces a **self-sufficient** element (seeded
> appearances, NO Item template); placement mode is assisted by the **preview
> context** (contextual rows panel — you navigate from category to category and
> place). The "Item sets" section of the source detail is removed.
>
> **Revised 2026-07-31 — the Item template is REMOVED.** The revision above let
> two models coexist: the self-sufficient element (new creation path) and the
> project-level Item template (rendering shared across menus, via the "Sets"
> library and the `iterates.template` / `places.template` refs). That
> coexistence is ended: **an appearance belongs to the menu where it is
> rendered, never to a shared entity.** Concretely — `ItemTemplate`,
> `Project.itemTemplates`, `templateId`, the `templates/` folder and the
> `template/v1` schema no longer exist; the "Sets" tab and the template editor
> are removed; `createMenuSet` is the only creation path. A legacy `templates/`
> still on disk is **inlined at import** into the elements that referenced it
> (`item_templates.*` i18n keys duplicated then re-addressed to
> `menus.<m>.elements.<el>.*`, cf. `templateMigration.test.ts`) and is never
> rewritten; the plugin keeps reading these files for compat until deployed
> servers are re-saved.
>
> What is lost on purpose: the "which rows of my source are placed nowhere"
> view that the project-level library offered, and reusing one rendering across
> several menus (to be redone per menu).
**Amends:** `data-source-stability-and-placement.md` (drops per-placement display
overrides; moves template ownership off the Element)

## Context

The stability/placement ADR gave menus two data-bound modes (pagination /
placement) but left the **template** — how one row renders as a slot — owned by
each Element's `appearances[0]`, with an optional per-placement display override.
Authoring lived in the element properties panel (a palette hidden behind a
toggle). Building the first real shop with it showed the UX inverted: users think
"here are my shop items, let me drop them into menus", not "let me configure an
element binding". Per-item overrides also threatened maintainability (N divergent
copies of a look). And dynamic sources (player warps, started quests) need the
same template concept with no enumerable rows at all.

## Decision

We introduce the **Item template**: a project-level, named **view over one data
source** — `{ id, name, sourceRef, alias, appearances[] }`, plus `keyField` and
`groupBy` when the source is **static**. It is THE owner of how a row renders
(material/title/lore/count **and click behaviour**), with variation expressed via
the existing conditional appearance **states** (`Appearance.if` on row fields) —
**never** via per-item overrides. `Placement.override` is removed from the
editor domain before ever shipping (the plugin's runtime tolerance for an
`override` key in `places` YAML remains, unused).

Rules:
- **N templates per source** (two menus can render the same model differently);
  templates are cheap to duplicate.
- **One template per (menu, source)**: within a menu, every bound row of a source
  renders through the same template.
- Elements bind via `iterates.templateId?` / `places.templateId?`. When bound,
  the template wins for alias / appearances (and `keyField` for places); local
  element fields remain the unbound power-user path and the dangling fallback
  (non-hermetic philosophy: a deleted template degrades, never blocks).
- **Export inlines** the template's appearances (and `key_field`) into each bound
  element — `menu/v1` and the plugin renderer are unchanged; editing a template
  propagates to every consuming menu at next deploy.
- `groupBy` is **library organization only** (group headers per field value; a
  header drag creates a *literal* filter) — zero runtime effect, static-only.

**Materialization by stability** (the data library, a Library panel section):

| | static source | dynamic source |
|---|---|---|
| library shows | real row tiles, grouped by `groupBy` | one "paginated block" tile |
| drag a tile → slot | placement (pin by Row key) | — |
| drag group / whole template → menu | pagination (filtered / full) | pagination |
| pick in an existing pagination | ✔ | ✔ |
| canvas preview | live snapshot rows | bare-placeholder first slot |

Unplaced rows stay listed in the library (curation happens in the menu, not the
library). A player-dependent view can only paginate — you cannot hand-pin rows
you cannot enumerate.

Shop architecture stays dual: the **generic parametrized** category menu
(context-input driven, pagination only, zero-maintenance) is the shipped default;
**concrete per-category menus** (hand-placed, fully curated) are the opt-in path,
linked manually in v1 (an if-branch in the template's click, or a hand-placed
Element). Menu-level preview of parametrized menus seeds a real sample value for
context inputs instead of rendering against an empty scope.

## Considered options

- **One template per source (no names)**: rejected — two menus over the same
  model with different looks is a hard requirement.
- **Template ownership on the Element** (status quo): rejected — no reuse across
  menus, and the library ("drag my shop items") has nothing to render tiles with.
- **Per-item overrides** (previous ADR): rejected by the maintainability rule —
  conditional states on row fields cover the need; a genuinely bespoke slot is a
  normal hand-placed Element.
- **Templates shared across sources of one "model"** (quests:available +
  quests:started): deferred — needs a plugin-side model concept; v1 answer is
  template duplication.
- **Plugin-declared grouping/parent links** for the library tree: rejected for
  v1 — `groupBy` on the template is editor-only and avoids another
  binary-breaking `DataSourceDeclaration` change.
