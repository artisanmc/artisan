# A single parameterised Menu rather than one Menu per category

**Status:** accepted (2026-08-11)

## Context

Taking over a legacy shop (MenuAPI config: 7 categories, 41 items, each carrying an
explicit `page`/`slot`) required rendering a hand-authored layout, hence **placement**
rather than pagination.

First implementation: **one Menu per category**, each filtering the source on its id and
placing its own items. It rendered the layout faithfully, and placement kept simple
semantics there — one source, one screen, some slots.

The cost showed up in use, and it is not about the migration but about **the life
afterwards**. Adding a category took five steps: create the row in the catalog, create a
Menu, add to the main Menu an element that points to it, configure the target Menu's
filter, place the items. Four correlated artifacts for a concept that should be one —
and the same problem awaits any content module (quests, kits), not only the shop.

The initial diagnosis targeted the **catalog** ("the business data should live in the
Menu"). It was wrong: the catalog was never the constraint, the split into Menus was.

## Decision

A **single parameterised Menu** is the default form of a repeated screen: one document,
one source filtered by an input, and the **Placements of all contexts** carried by the
same Element.

Adding a category becomes **one step** again: create the row. The Menu already exists,
the filter is dynamic, the link from the main Menu is too
(`open_menu shop_category with category="{cat.id}"`), and the new **Preview context**
shows up by itself in the editor since it is derived from the call sites.

A category that really deserves a separate screen keeps its **dedicated Menu** — the main
Menu just has to point elsewhere for that one. The general case costs one step, the
special case remains possible, and nobody pays for flexibility they do not use.

## Considered options

**One Menu per category** — rejected for the choreography described above. The escape
hatch remains for an atypical screen.

**A third rendering mode, where the position comes from a field of the row**
(`position_field`, the item carries its `slot`). Appealing: it gave the single Menu
*and* the slots, changing nothing else. Rejected because the **placement mode is the
right concept** — the difficulty was not the model but the editor, which showed neither
the context being viewed nor the rows left to place. Adding a mode would have frozen a
UX defect into the schema. And the position would have become a property of the item,
hence inexpressible as soon as an item appears on two screens.

**Business data in the Menu's document** — a module declares an element type (price,
description, actions), the admin drops it in a slot, the value lives in `menus/*.yaml`.
Rejected: it moved the authority over the price out of the module, required an API for
modules to read elements without parsing `menu/v1`, and created a second way to declare
business data next to Tables. All to solve a problem that was not there. To be reopened
only if a real need appears, with the criterion "does this data have a life outside the
Menu?" (a quest yes, a shop item no).

## Consequences

**The editor becomes responsible for readability.** A parameterised Menu carries the
Placements of all its contexts: read without a context, it is a pile of contradictory
pins. And without a chosen context it renders **nothing** — the input falls back to its
`default`, the filter compares against an empty value, no row comes out (giving the input
a `default` is therefore the way to set a fallback context). Three gaps become blocking
rather than cosmetic:

- the **Preview context** must be visible and manipulable from the board — through the
  edge (clicking the link sets the target's context) and through a permanent banner on
  the Menu ("Seen from: Shop › Keys") — and not buried in a properties panel;
- the **unplaced** rows of the current context must be visible: a floating tray
  anchored to the Menu, present only if work remains, from which tiles are dragged
  (drag-and-drop itself already exists);
- none of this for a paginated Menu, where there is no position to decide.

**The migration does not depend on this UX**: the migrator generates the Placements from
the legacy slots, so a takeover arrives already placed. The UX serves the life
afterwards.

**The catalog stays in a Table.** No business data migrates to the Menu documents.
