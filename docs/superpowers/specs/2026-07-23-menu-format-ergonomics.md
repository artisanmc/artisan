# Menu format ergonomics — hand-editability pass on menu/v1

**Status:** candidates list — owner-validated directions (2026-07-23), **NOT yet
implemented**; each item is small and can be grilled/finalized inline during the
files-first epic. Enabled by ADR `files-first-source-of-truth` (files are the
primary editing surface; `menu/v1` is mutable in place until real prod use —
dated dispensation, decision #5).

**The single criterion:** *a human or an AI agent must be able to write this
file by hand without traps.* Every candidate below is judged against that.

## 1. `context_inputs` → `inputs`, optional, with direct-ref sugar

The mechanism conflates three roles: the menu's **parameter signature**
(primitive inputs fed by Command arguments by name, with defaults), **shared
shaping** (a named list binding carrying `filter`/`sort`/`limit` reused by
several elements), and **editor typing** (autocomplete on the iterated model).
Only the third was visible in the degenerate common case, which made the block
feel like pure bureaucracy.

- **Rename** `context_inputs` → **`inputs`**.
- **Direct-ref sugar:** `iterates.source` accepts a source ref directly
  (`boutique:items`, `pack:x`) *or* an input name. No `inputs` entry needed to
  simply iterate a raw source.
- **`inputs` stays, optional**, for: primitives (command args / defaults),
  shared shaped lists, and typed models for editor autocomplete.
- **Dangling source:** per the non-hermetic philosophy — WARN + render empty,
  never a hard error, never a crash.
- **No sentinel leakage:** an element that iterates nothing has no `iterates`
  key at all (kill `source: ""`).

```yaml
# before                              # after (common case)
context_inputs:                       elements:
  - name: items                         - id: buy_button
    type: list                            iterates:
    source: { ref: boutique:items }         source: boutique:items
elements:                                   alias: item
  - id: buy_button
    iterates: { source: items, alias: item }
```

## 2. Flatten `layers`

`Layer = { id, name, elements[] }` has **zero behavior** (no visibility
condition, no runtime toggle) — it is pure indentation tax. Flatten:
`elements:` directly on the menu; document order = stacking order; later
element wins on slot collision (same semantics as today's layer order, minus
the ceremony). If the editor ever wants visual grouping, that is presentation
state → `.artisan/editor.yaml`, not wire format.

## 3. Title: plain-string sugar, one LText encoding

Today a plain title costs four lines and two nesting levels
(`title: [{kind: plain, value: {key: …}}]`). Simplify:

- **`title: "Shop"`** — a bare string is sugar for a single plain text layer
  (literal or `{i18n:key}` per the hybrid i18n contract).
- Composed titles keep the layer array; a **bare string entry** in the array is
  a plain text layer; objects (`glyph`, `background`, `external_glyph`,
  `textarea`) remain for the pixel-perfect composer.
- **One LText encoding everywhere:** the `value: {key: …}` object form is
  dropped — always the string form (`"literal"` or `"{i18n:key}"`), matching
  appearances/actions. Two encodings for one concept in one file is a trap.

```yaml
# before                              # after
title:                                title: Shop
  - kind: plain                       # or, composed:
    value:                            title:
      key: menus.shop.title             - background: generic_54
                                        - "Shop"
                                        - glyph: coin
                                          x: 12
```

(Exact composed-entry shorthand shapes to be finalized when grilled — the
locked directions are the bare-string sugar and the single LText encoding.)

## 4. Normalize `positions`

`positions: 11-14` (bare) vs `positions: "26"` (quoted) — the YAML
string-or-int typing forces quoting single slots, a classic hand-edit trap.
Accept bare integers, bare ranges, and lists uniformly; never require quotes.

## 5. Template refs replace inlined appearances (already decided)

Reminder from ADR `files-first-source-of-truth` #3: elements bound to an Item
template carry `template: <id>` on disk; the template's appearances live in
`templates/<id>.yaml` and are runtime-resolved. The
`{i18n:item_templates.itpl_….title}` blobs currently inlined into menus
disappear from menu files entirely.

## 6. `steps` → `actions` (command/v1 + menu click handlers)

The glossary's canonical terms are **Action chain** / **Action DSL**; `Step` is
the internal domain unit, not a surface word — and data/v1 already says
`actions` (`kind: "actions"` fields). Rename for consistency:

- **command/v1:** `steps:` → `actions:`.
- **Click handlers collapse:** `ClickHandler` has a single field, so the
  wrapper is dead weight — `click.left.steps: <dsl>` → **`click.left: <dsl>`**.
- **`name` defaults to `id`** in command/v1 (only written when they differ).

```yaml
# before                              # after
schema: command/v1                    schema: command/v1
id: boutique                          id: boutique
name: boutique                        actions: open_menu shop_main
steps: open_menu shop_main            description: Ouvre la boutique
description: Ouvre la boutique
```

Commands have **no** `context_inputs` and gain none: `arguments` *is* their
input signature (name/type/required/default), already correctly named — it
feeds a Menu's `inputs` by name.

## Non-goals

- No change to the Action DSL (already locked, ADR `action-dsl`).
- No change to the hybrid i18n contract (ADR `files-first-source-of-truth` #4).
- `menu/v2` fork — everything here rides the v1-mutable dispensation.
