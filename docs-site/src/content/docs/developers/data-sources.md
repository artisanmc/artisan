---
title: Data sources
description: Expose your plugin's live data to Artisan menus with one declaration.
---

A **data source** is a named list of rows your plugin exposes to the rest of the
system. Once registered, admins reference it in any menu — paginate over it,
filter it, sort it, place individual rows on specific slots, bind its fields into
item names and lore. You write the fetcher; the editor and the menu runtime do
the rest.

## Register one

```kotlin
api.dataSources.register(
    DataSourceDeclaration(
        ref = "myplugin:homes",
        fetcher = { player, params ->
            if (player == null) throw PlayerRequiredException("homes are per-player")
            homeCache.of(player).map { h ->
                mapOf("id" to h.name, "world" to h.world, "x" to h.x, "z" to h.z)
            }
        },
        schema = listOf(
            DataSourceField("id", FieldKind.STRING, "Home name"),
            DataSourceField("world", FieldKind.STRING, null),
            DataSourceField("x", FieldKind.NUMBER, null),
            DataSourceField("z", FieldKind.NUMBER, null),
        ),
    )
)
```

```java
api.getDataSources().register(new DataSourceDeclaration(
        "myplugin:homes",
        (player, params) -> {
            if (player == null) throw new PlayerRequiredException("homes are per-player");
            return homeCache.of(player).stream().map(this::homeRow).collect(Collectors.toList());
        },
        List.of(
                new DataSourceField("id", FieldKind.STRING, "Home name"),
                new DataSourceField("world", FieldKind.STRING, null)),
        null,              // schemaHint (deprecated, pass null)
        Stability.DYNAMIC, // stability
        null));            // keyField
```

Register from your module's `onEnable(api)` (see [Modules](/developers/modules/))
so the core can attribute the source to your module in the editor's UI.
Registering directly on the registry works too — the source is then shown as
unattributed.

## The `ref`

Globally unique, `namespace:id`, lowercase — e.g. `boutique:items`,
`myplugin:homes`. Use your plugin's name as the namespace. Registering a `ref`
twice throws `DuplicateDataSourceException`.

## The fetcher contract

```kotlin
(player: Player?, params: Map<String, Any?>) -> List<Map<String, Any?>>
```

Three rules, all of them load-bearing:

1. **It runs on the main server thread, at menu render time.** It must return
   fast: serve from an in-memory cache, refresh it asynchronously elsewhere.
   Never do blocking I/O (SQL, HTTP, file reads) inside a fetcher.
2. **`player` may be null.** The editor's *Preview* button calls fetchers with
   no player. Return generic/sample rows if you can; if the data is meaningless
   without a player, throw `PlayerRequiredException` — the editor turns it into
   a clean "needs an online player" notice instead of an error.
3. **Rows are plain maps.** Keys are field names, values are scalars, lists, or
   nested maps. Keep them JSON-shaped — they travel over the WebSocket for
   previews.

Nested rows are allowed and useful: the Boutique's `boutique:categories` rows
carry an `items` list, so a menu can either flat-join items and filter by
category, or paginate `category.items` from a category context.

## Declare a schema

`schema` is a list of `DataSourceField(name, type, description?)` with
`FieldKind` in `STRING`, `NUMBER`, `INTEGER`, `BOOLEAN`, `LIST`, `OBJECT`.

It is optional but strongly recommended: it powers the editor's schema table,
the filter autocomplete, and the field pickers when binding item names and lore.
Without it, admins have to type field names blind.

Prefer exposing **pre-computed, display-ready fields** over making admins
recompose text. The Boutique exposes `price_display` (already formatted by the
shop settings) next to the raw `price`, so a menu binds `{item.price_display}`
and stops caring about currency formatting.

## Static vs dynamic

`stability` declares whether your **key-set** — which rows exist — is knowable
at design time. It is a declaration, never inferred.

| | `Stability.STATIC` | `Stability.DYNAMIC` (default) |
|---|---|---|
| Key-set | Stable, finite, enumerable | Runtime/player-dependent, unbounded |
| `fetcher(null, …)` | Must return the authoritative rows | May return nothing useful |
| `keyField` | **Required** — the field identifying each row | Ignored (`null`) |
| In menus | Pagination **and** placement mode (drop one row on one slot) | Pagination only |

Shop categories and items are `STATIC` keyed by `id` — an admin can drop
"the weapons category" on slot 11. Auction listings or player homes are
`DYNAMIC` — only pagination makes sense.

Field *values* may still resolve per-player on a static source: the key-set is
what has to be stable, not the content.

Constructing a `STATIC` declaration without a non-blank `keyField` throws.

## Signal a reload

When your data changes underneath (config reload, admin command), tell
consumers to re-fetch:

```kotlin
api.events.publish(DataReloadEvent("myplugin:homes"))
```

## How it reaches the editor

At connection time the plugin reports every registered source to the backend in
the `hello` frame — `ref`, owning module, declared schema, stability, key field.
A module registering later triggers a `modules_changed` frame, so sources appear
without a reconnect. Admins see them in the editor under **Data → Server
sources**, grouped by module, with a live **Preview**.

Preview requests round-trip to your fetcher with `player = null` and are
truncated to 50 rows.

## Consuming other modules' sources

```kotlin
if (api.dataSources.has("boutique:items")) {
    val rows = api.dataSources.fetch("boutique:items", player, emptyMap())
}
```

`fetch` throws `UnknownDataSourceException` for an unregistered ref. This is the
only sanctioned way for modules to read each other's data — never take a direct
dependency on another module's classes.
