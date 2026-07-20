---
title: Data sources
description: Explore server data sources, preview live rows, and filter them per menu.
---

Modules installed on your server (the Boutique Add-on, third-party plugins…) can expose **data sources** — live lists of rows such as shop items or quests. The editor's **Data** tab shows them under **Server sources**, grouped by the module that declares them.

## Explore a source

Select a source to see:

- its **ref** (e.g. `boutique:items`) — copy it to reference the source anywhere,
- its **schema**: the fields each row declares (name, type, description),
- a **Preview** button that fetches real rows from your connected server (up to 50 rows; larger results are truncated).

Previews run without a player context. Sources that require an online player show a "needs an online player" notice instead of rows. If the server is offline, the schema stays visible but live preview is disabled. A timeout usually means the plugin needs an update or the server is unreachable.

## Project sources: your own data

Besides server sources, you can author **your own data** directly in the project — perfect for a ranks menu, a kits list, or project-wide settings. In the Data tab's **Project sources** section, create one of two shapes:

- **Table** — a list of rows (ranks, kits, warps…). Menus can paginate over it, place individual rows on specific slots, and build item Sets from it.
- **Config** — a single object of settings (currency name, support URL…) you reference in menus as `{settings.currency}`.

### Declare the schema

A Table is backed by a **model**: the list of fields each row has. Add fields with a name and a type:

- **text**, **number**, **integer**, **boolean** — plain values,
- **localized text** — translatable per language, edited like any other text in the editor (and listed in the Translations view),
- **item** — a Minecraft item: pick a vanilla material, a custom item, or a captured item from your library,
- **list**, **object**, **model** — nested structures (e.g. a `perks` list of localized text for variable-length lore).

One field is the **Row key** — the stable identifier of each row (e.g. `id`). Renaming or retyping a field updates all existing rows automatically.

### Fill the rows

Rows are edited in a table: one column per field. Item cells open the item picker; localized text cells edit the currently active language. Reference the source in a menu like any other data source — its ref is `pack:<id>` — then iterate, filter, or place rows exactly as you would with a server source. Your data deploys with the project and works in-game, translated to each player's language.

## Filter a source in a menu

In a menu's properties, each **Source ref** context input now has a visual editor:

- **Filters** — `field = value` rows. Fields autocomplete from the declared schema; values can be literals (`armes`) or menu args in braces (`{group}`).
- **Sort** — a field plus `asc`/`desc`.
- **Limit** — maximum number of rows.

These map 1:1 to the runtime behavior: the preview shows exactly what players will get.

## Menu data

Below the context inputs, the **Menu data** section lists every source the menu consumes with its active filters. **Preview** applies those filters live. When a filter uses `{arg}`, type a test value first — it substitutes the arg the way a real menu call would.
