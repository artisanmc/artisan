---
title: Data sources
description: Expose your plugin's live data to Artisan menus — declaration, fetcher contract, schema, static sources, editor preview.
sidebar:
  order: 5
---

A **data source** is a named list of rows your plugin exposes. Once registered,
admins use it in any menu: paginate over it, filter and sort it, place single
rows on chosen slots, and bind row fields into item names, lore and actions.
You write the fetcher; the editor and the menu runtime do the rest.

## Register one

```kotlin
api.dataSources.register(
    DataSourceDeclaration(
        "homes:list",
        { player, params ->
            if (player == null) throw PlayerRequiredException("homes are per player")
            homeCache.of(player.uniqueId).map { home ->
                mapOf("id" to home.name, "world" to home.world, "x" to home.x, "z" to home.z)
            }
        },
        listOf(
            DataSourceField("id", ModelFieldType.string(), "Home name"),
            DataSourceField("world", ModelFieldType.string()),
            DataSourceField("x", ModelFieldType.number()),
            DataSourceField("z", ModelFieldType.number()),
        ),
    )
)
```

```java
api.getDataSources().register(new DataSourceDeclaration(
        "homes:list",
        (player, params) -> {
            if (player == null) throw new PlayerRequiredException("homes are per player");
            return homeCache.of(player.getUniqueId()).stream().map(Home::toRow).toList();
        },
        List.of(
                new DataSourceField("id", ModelFieldType.string(), "Home name"),
                new DataSourceField("world", ModelFieldType.string()),
                new DataSourceField("x", ModelFieldType.number()),
                new DataSourceField("z", ModelFieldType.number()))));
// Static sources take two more arguments: new DataSourceDeclaration(ref, fetcher, schema, Stability.STATIC, "id")
```

Since API 1.8.0 the optional parameters can be left out from Java too:
`new DataSourceDeclaration(ref, fetcher)`, `new DataSourceDeclaration(ref, fetcher, schema)`,
`new DataSourceField(name, type)`.

A row field is typed with `ModelFieldType` (Since 2.0.0), the same field kinds as
[Data models](../data-models/#field-kinds) and action arguments.
The 1.x `FieldKind` constructors (`DataSourceField("x", FieldKind.NUMBER)`) still
compile, `@Sunset` until 3.0.0: `STRING`, `NUMBER`, `INTEGER`, `BOOLEAN` and
`ITEM` map to the kind of the same name, `LIST` to `list(string())`, `OBJECT`
to `object([])`.

Register from your module's `onEnable(api)` so the editor shows the source
under your module ([Modules](../modules/)). Registering from
anywhere else works, but the source is listed as unattributed.

## The declaration

| Parameter | Default | Meaning |
|---|---|---|
| `ref` | — | Globally unique `namespace:id`, lowercase (`boutique:items`). Use your module id as namespace. A second registration throws `DuplicateDataSourceException`; `unregister(ref)` (Since 1.8.0) frees it |
| `fetcher` | — | `DataFetcher`: `(Player?, Map<String, Any?>) -> List<Map<String, Any?>>` |
| `schema` | empty | Declared row fields — powers the editor's field pickers, filter autocomplete and schema table |
| `stability` | `DYNAMIC` | Whether the set of rows is knowable at design time — see [Static or dynamic](#static-or-dynamic) |
| `keyField` | `null` | The field identifying each row; required when `stability = STATIC` |

## The fetcher contract

1. **It runs on a game thread, at menu render time** — the viewing player's
   region thread (the main thread on Paper). It must return immediately: read
   an in-memory cache that you refresh elsewhere, asynchronously. Never query
   SQL, HTTP or files inside a fetcher. See [Threading & Folia](../threading/).
2. **`player` may be `null`.** The editor's preview calls the fetcher with no
   player. Return generic or sample rows when you can; when the data means
   nothing without a player, throw `PlayerRequiredException` — the editor shows
   a clear "needs a player" notice instead of an error.
3. **Rows are plain, JSON-shaped maps.** Keys are field names; values are
   strings, numbers, booleans, lists or nested maps. They travel to the editor
   for previews.
4. **It is called again on every render.** Each time a menu opens or repaints
   (page change, an argument changed by a button), the runtime fetches again.
   There is no menu-side cache to invalidate.

### Parameters, filters, sorting

A menu binds a source through a **context input**:

```yaml
inputs:
  - name: items
    type: list
    source:
      ref: boutique:items
      params: { owner: '{player}' }        # passed to your fetcher
      filter: { category: '{category}' }   # applied by Artisan after the fetch
      sort: { by: price, direction: asc }  # applied by Artisan
      limit: 20                            # applied by Artisan
```

Only `params` reaches your fetcher (as the `params` map, placeholders already
resolved). Filtering, sorting and limits are done by Artisan on the rows you
return, so a plain fetcher gets them for free. Use `params` when the fetch
itself depends on an argument — a page of a remote listing, another player's
name.

## Declare a schema

`schema` is a list of `DataSourceField(name, type, description)`:

| `FieldKind` | For |
|---|---|
| `STRING` | Text |
| `NUMBER` | Decimal numbers |
| `INTEGER` | Whole numbers |
| `BOOLEAN` | `true` / `false` |
| `LIST` | A list (of scalars or of nested rows) |
| `OBJECT` | A nested map |
| `ITEM` | A complete item value (a material name, an `item:<id>` reference, or a structured item). Offered in the editor under **Displayed item → Use an item from data** |

The schema is optional but strongly recommended: without it, admins type field
names blind.

Expose **display-ready fields** next to raw ones. The Boutique returns
`price_display` (formatted with the shop's currency settings) beside `price`, so
a menu binds `{item.price_display}` and never deals with formatting.

Nested rows are fine and useful: `boutique:categories` rows carry an `items`
list, so a menu can paginate `category.items` from a category context.

## Static or dynamic

`stability` declares whether your **set of rows** is knowable at design time.
It is declared, never inferred.

| | `Stability.STATIC` | `Stability.DYNAMIC` (default) |
|---|---|---|
| Rows | Stable, finite, enumerable | Depend on the player or on runtime state |
| `fetcher(null, …)` | Must return the complete, authoritative rows | May return nothing useful |
| `keyField` | **Required** — constructing without it throws | Ignored |
| In menus | Pagination **and** placement (pin one row on one slot) | Pagination only |

Shop categories are `STATIC` keyed by `id` — an admin can drop "the weapons
category" on slot 11. Auction listings or player homes are `DYNAMIC`. Field
*values* of a static source may still vary per player; only the set of keys has
to be stable.

## How menus use it

Admins wire your source in the editor; the YAML it writes looks like this:

```yaml
elements:
  - id: homes
    positions: '10-16'
    iterates: { source: homes:list, alias: home }   # one item per row
    material: RED_BED
    title: '{home.id}'
    click:
      left: 'run_command "homes:teleport {home.id}" as player'
```

`iterates.source` (pagination) and `places.source` (placement on a static
source) accept a ref directly, or the name of a context input. Row fields are
read with `{alias.field}` — see [Expressions](../../editor/expressions/). The
click calls a command your plugin registered: [Commands](../commands/).

## Preview in the editor

The editor lists every registered source under **Data → Server sources**,
grouped by module, with its schema, stability and key field
([Exploring sources](../../editor/data-sources/)). **Preview** runs your fetcher
on the server with `player = null` and the admin's test parameters, then
applies the menu's filters; results are truncated to 50 rows.

A source registered after the editor connected (a module enabled late) appears
without a reconnect.

## Consume another plugin's source

```kotlin
if (api.dataSources.has("boutique:items")) {
    val rows = api.dataSources.fetch("boutique:items", player, emptyMap())
}
```

`fetch` runs the other plugin's fetcher on your thread and throws
`UnknownDataSourceException` for an unknown ref. This is the sanctioned way to
read another integration's data — never import its classes.
`refs()`, `declarations()` and `registered()` (declarations with their owning
module id) list what is available.

## Remove one

`api.dataSources.unregister("homes:list")` (Since 1.8.0) removes a source and
returns whether it existed. Artisan removes your sources by itself when your
plugin disables, and a module's sources with `api.modules.unregister`.
