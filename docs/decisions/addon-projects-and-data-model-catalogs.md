# Add-on projects: add-on-owned roots + catalogs as Project Data models

**Status:** accepted (2026-07-22)

## Context

The boutique Add-on (`modules.md §15`, shipped) took two shortcuts versus the
platform vision, both surfaced by the owner as friction:

- Its catalog lives in a **bespoke `boutique/shop.yaml`** (schema `boutique/v1`)
  inside a Project, authored by a **bespoke editor** (`@artisan/boutique-editor`
  over `Project.moduleData.boutique`) — a parallel data + UI stack that duplicates
  the generic **Data model** / **Table** / `<SchemaForm>` machinery (ADR
  `project-sources-and-data-models`), whose own Consequences already earmarked the
  boutique for migration onto that mechanism.
- The Project that carries it (`boutique_shop`) is an ordinary Project in the core's
  `plugins/Artisan/projects/` dir and appears in the flat project list — no signal
  that it is the Add-on's default content, and no clean-uninstall story.

Crucially, the **runtime already makes consumption server-global**: the plugin
aggregates `boutique/*.yaml` across *all* Projects (`BoutiqueModule.reloadRepo`), and
`pack:` sources resolve across *all* bundles (`ProjectDataResolver`). So "usable by a
menu in any Project" is already true; only **authoring and storage** are wrong. The
target model the owner chose: **one shop per server, edited in an Add-on section,
consumable by menus in any Project.**

## Decision

1. **A catalog is Project Data, not a bespoke schema.** The boutique catalog becomes
   ordinary **Project sources** — a `categories` **Table** and an `items` **Table**,
   each *of* a **Data model** (ADR `project-sources-and-data-models`), exported to
   `data/<id>.yaml` and consumed by menus via `pack:<id>`. Retire `boutique/v1`,
   `boutique/shop.yaml`, its duplicated backend serializer, and the
   `@artisan/boutique-editor` structured state. The catalog is edited through the
   generic **Data** tab (Tables + `<SchemaForm>`), not a shop-specific UI.
   *Rejected:* keeping a bespoke `shop.yaml` — a second representation of what Data
   models already express, with its own editor, migrations, and monolingual hole.

2. **One dedicated Add-on Project per server; consumption stays server-global.**
   Authoring is centralised in the Add-on's Project (`boutique_shop`, one per server);
   a menu in *any* Project consumes the catalog via `pack:` because
   `ProjectDataResolver` walks every bundle. "Scoped to the Project" is therefore an
   **authoring** fact only — it *is* "one shop per server", and it does not restrict
   consumption. *Rejected:* a server-level resource store (`server_addon_data` table)
   with its own config-live sync channel — it would duplicate Project sync now that
   the catalog is ordinary Project content, for no consumption benefit.

3. **Add-on-owned Project root.** The Add-on's Project working-copy lives in the
   **Add-on's own plugin dir** (`plugins/Boutique/`), not the core `projectsDir`. The
   core gains a `projectId → root dir` resolution: an Add-on **registers its root** at
   `onEnable` via `ArtisanAPI`; `ProjectReader`, `BundleDownloader` (write + delete
   sweep), `BundleHasher`, `ProjectDeleter`, and hot-reload all operate **per
   registered root**. The default root (core `projectsDir`) still owns user-created
   Projects. The `.artisan-trash/` and `.artisan*` filter rules apply per root.
   Uninstalling the Add-on removes its Project with it. *Rejected:* keeping the
   working-copy in the core `projectsDir` — simpler, but no clean-uninstall and no
   physical ownership; the owner chose ownership.

4. **Editor: "Installed modules" grouping.** The Add-on's Project surfaces under an
   **Installed modules** section (presence-gated on the module, `server_modules`), not
   the flat project list — signalling it is Add-on content, editable but owned by the
   Add-on. Its **Data** tab is the catalog editor.

5. **Purchase + `additem` rebased on Data models, unchanged in spirit.** `boutique:buy`
   stays a **module Command** (the purchase logic / `TransactionManager`) but reads the
   item — price + exact stack for the give — from the Project **Data model** instead of
   `ShopRepo`/`shop.yaml`. In-game `/boutiqueadmin additem` inserts a **Data-model
   row** (via the same backend-mutation pattern that already owns Project writes — the
   plugin never writes Project files itself, per ADR
   `captured-items-and-module-field-kit §3`) instead of a `shop.yaml` entry.

6. **Item field = material value-space (option B).** A shop item's icon is an **item
   field** of the Data model (`material | item:<id> | custom ref`), and the data source
   **inlines the display** — menu rendering derives the icon from that field and never
   needs a Project-scoped captured item. The exact captured stack still travels in
   `items/` for the *give* at purchase time. *Rejected:* server-level `item:`
   resolution in the render engine — larger, unneeded once display is inlined.

7. **Add-on field contracts guard catalog integrity.** A Data model field may be
   **Add-on-owned**: declared by the Add-on's bootstrap and marked **locked**
   (non-removable, non-renamable, non-retypable), optionally **required** with a
   **default**. The generic Data model editor *enforces* the contract — locked fields'
   structural controls are disabled, a required field must be present on every row, and
   new rows are seeded with the declared default so no row is ever invalid for the
   plugin. The admin's own added fields remain fully free alongside; the lock freezes
   only the contract fields, never the whole Table. This **amends**
   `project-sources-and-data-models` decision 4 for Add-on-owned fields: instead of
   letting a breaking structural edit through and letting the consumer dangle (the
   non-hermetic default for admin-authored refs), the editor **prevents** the edit
   up front — an authoring guard-rail, not a runtime hermetic check.
   **Defense in depth:** even with the lock, the plugin degrades gracefully on a
   malformed/absent field at runtime (skip the item + one WARN log), never crashes —
   the lock prevents the mistake, the plugin survives it anyway.
   *Rejected:* locking the entire Table (kills the admin's freedom to extend);
   runtime hermetic validation on the plugin side as the primary guard (a footgun the
   admin only discovers in-game — the guard belongs at authoring time).

   **Provenance & required/default split.** `locked` is inherently an
   *Add-on-ownership* property (an admin locking a field against themselves is
   pointless), so it exists only on Add-on-declared fields. `required` and `default`
   are ordinary field properties available to any Data model field, admin-authored
   included — they happen to be how a locked contract field stays always-valid.
   **Contract reconciliation:** when an Add-on ships a new version that adds a locked
   required field, re-bootstrap backfills it on existing rows with its default (its own
   follow-up, alongside the prod migration).

   **Value constraints, kept lean.** Beyond `required`/`default`, a field may carry a
   small set of **per-kind optional constraints** — number `min`/`max` to start —
   validated at row-edit time (inline rejection, mirroring the Row-key invariant), and
   pinnable (locked) by an Add-on contract (e.g. `price ≥ 0`). The set is deliberately
   minimal and grows per kind only as real cases demand, and each addition must earn
   its place against **form clutter**: constraints live in an advanced/collapsed area
   of the field editor, never on the basic add-a-field path. *Rejected:* a full
   JSON-Schema-style constraint vocabulary — over-general for the cases at hand and a
   standing UI burden.

## Consequences

- Deletes a whole parallel stack (the `boutique/v1` schema, the `shop.yaml`
  serializer duplicated backend-side, the `@artisan/boutique-editor` structured
  state) in favour of generic Data models — **less code**, the catalog gains
  versioning / commits / restore for free, and **multilingual `name`/`lore`** comes
  free (ltext fields), closing the monolingual hole the `project-sources` ADR flagged.
- Introduces **one genuinely new cross-cutting core capability** — Add-on-owned
  Project roots — that benefits every future Add-on shipping default content.
- **Supersedes** the shortcuts recorded in `modules.md §15`, and the
  "additem writes `shop.yaml`" path in ADR `captured-items-and-module-field-kit §3`
  (additem now targets a Data-model row).
- **Migration:** existing prod `boutique_shop` projects (`shop.yaml` / `boutique/v1`)
  need a one-shot migration to Data-model Tables. Prod shops are not resettable, so
  this is its own epic — as the `project-sources` ADR already anticipated.
- Spans **two repos**: Artisan (core project-root registry, editor "Installed
  modules" grouping, backend additem→Data-model, CONTEXT + `modules.md §15` rewrite)
  and Boutique (`reloadRepo` reads the Data model, bootstrap generates the default
  Project as Data-model Tables under `plugins/Boutique/`, `boutique:buy` reads the
  model, retire `shop.yaml`).
