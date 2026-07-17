# Data source stability + Menu placement mode

**Status:** accepted (2026-07-15) — **amended by `item-templates-and-data-library.md`
(2026-07-16)**: per-placement display overrides are dropped (never shipped to the
editor), and the row template moves off the Element onto the project-level **Item
template**; the stability axis, Row keys, `places` runtime and pagination reuse
below are unchanged.

## Context

The shop add-on produced generic menus that iterate a data source into a slot
range: the admin could neither see the real items/lore in the editor canvas nor
choose which item sits where. Two gaps: real data never rendered in the canvas, and
no per-item placement. We wanted both without inventing a redundant "item type"
concept — the existing `appearances[0]` already *is* the per-row template.

## Decision

We add a **stability** axis to `DataSourceDeclaration`, **declared** by the
registering module (not inferred): a data source is **static** or **dynamic**.
Static = a stable, enumerable **key-set** whose `fetcher(null)` returns the complete
authoritative set of rows, each identified by a declared **Row key** (`keyField`);
field values may still resolve per-player at runtime. Dynamic = runtime/player-
dependent, unbounded.

A Menu **Element** gains a second binding, **placement mode** (`places`), a sibling
of the existing pagination mode (`iterates`), mutually exclusive with it and sharing
the same `appearances[0]` template. Placement mode is available **only on static
sources**. A Placement pins one Row key to `{ page, position }` with an optional
**display-only** override (title/lore/material/count); click/behaviour stays driven
by the template. Multi-page placement layouts reuse the existing in-menu pagination
navigation. Rows not placed are omitted (curation). The change is additive and stays
in `menu/v1`.

The Project stores a placement as `{ key, page, position, cachedDisplay?, override? }`
— a **reference plus a bounded display cache** of only the placed rows. The live
source wins when reachable; `cachedDisplay` is a render fallback for offline / a
fresh editor / a member without the server online. The editor caches the last-known
`fetcher(null)` snapshot (via the existing `POST …/data-sources/preview` path) and
feeds it to the canvas so both modes render real items; the same snapshot populates
the placement row-picker. A Row key removed while offline surfaces as a **dangling**
placement (non-hermetic philosophy: runtime ignores, editor flags).

## Considered options

- **Infer static/dynamic** (e.g. player-required ⟹ dynamic): rejected — an auction
  house needs no player yet is dynamic; inference would misclassify.
- **Reference-only placements** (no cache): rejected — breaks offline authoring and
  a second editor that never saw the snapshot.
- **Full source snapshot in the Project**: rejected — heavy, stale-prone, blurs the
  provider/consumer boundary. We cache only placed rows.
- **Full per-placement override incl. click chains**: rejected — duplicates the buy
  action across N placements and breaks "behaviour comes from the template". A
  genuinely bespoke button is a normal hand-placed Element instead.
