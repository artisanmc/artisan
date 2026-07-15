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

## Filter a source in a menu

In a menu's properties, each **Source ref** context input now has a visual editor:

- **Filters** — `field = value` rows. Fields autocomplete from the declared schema; values can be literals (`armes`) or menu args in braces (`{group}`).
- **Sort** — a field plus `asc`/`desc`.
- **Limit** — maximum number of rows.

These map 1:1 to the runtime behavior: the preview shows exactly what players will get.

## Menu data

Below the context inputs, the **Menu data** section lists every source the menu consumes with its active filters. **Preview** applies those filters live. When a filter uses `{arg}`, type a test value first — it substitutes the arg the way a real menu call would.
