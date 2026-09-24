---
title: Data models & config screens
description: Declare the shape of your plugin's configuration and get a generated editing UI.
---

Level 3 integration: instead of shipping a `config.yml` and hoping admins edit it
correctly, you **declare the shape** of your configuration as a `model/v1`
document. Artisan generates the form, validates input, handles translations and
item pickers, writes plain YAML to your project directory, and hot-reloads you.

You write no UI. The shape is versioned with your jar — admins cannot break it.

## Declare a model

A model is a plain `Map` passed verbatim to the registry. Nothing is interpreted
plugin-side: the document travels to the editor, which renders the form.

```kotlin
api.models.declare(mapOf(
    "schema" to "model/v1",
    "id" to "myplugin:kit",            // MUST be namespaced
    "name" to "Kit",
    "key_field" to "id",
    "version" to 1,
    "fields" to listOf(
        mapOf("name" to "id",      "type" to mapOf("kind" to "string"),  "required" to true),
        mapOf("name" to "name",    "type" to mapOf("kind" to "ltext"),   "required" to true),
        mapOf("name" to "icon",    "type" to mapOf("kind" to "item")),
        mapOf("name" to "cooldown","type" to mapOf("kind" to "integer"), "default" to 0, "min" to 0),
        mapOf("name" to "on_give", "type" to mapOf("kind" to "actions"),
              "help" to "Runs when the kit is claimed."),
    ),
))
```

In Java, build the documents with `LinkedHashMap` in a dedicated class (see the
Boutique's `ShopModels`) — keeping them in one place makes versioning them
obvious.

Declare from `onEnable(api)` so the model is attributed to your module.
A duplicate or non-namespaced id throws at declare time.

## Field kinds

| Kind | Edited as | Stored as |
|---|---|---|
| `string`, `number`, `integer`, `boolean` | Plain inputs | Scalar |
| `ltext` | Translatable text — one value per language, listed in the Translations view | Text in the project's `lang/` files |
| `minimessage`, `minimessage_multiline` | Rendered at rest, raw markup on click | String with MiniMessage markup |
| `item` | Item picker (vanilla material, custom item, captured item) | Material name or `item:<id>` ref |
| `actions`, `conditions` | Visual block editor **or** raw [Action DSL](/wiki/editor/data-sources/#action-fields--the-action-dsl) | Compact DSL text |
| `{kind: list, of: <type>}` | Repeatable rows | List |
| `{kind: map, of: <type>}` | Keyed dictionary | Map |
| `{kind: object, fields: [...]}` | Nested group | Map |
| `{kind: enum, values: [...]}` | Select | String |
| `{kind: union, tag: "…", variants: [...]}` | Variant picker + variant fields | Map carrying the tag |
| `{kind: model, ref: "ns:model"}` | The referenced model's form, inline | Nested map |

Composition is the point: a category is
`{kind: list, of: {kind: model, ref: "boutique:item"}}` — a list of full item
forms nested inside the category form.

### Presentation and validation hints

Any field accepts: `label`, `help`, `section` (groups fields under a heading),
`required`, `default`, `min`/`max` (numeric), `pattern` (regex), and `locked`
(your plugin manages the value — read-only in the form).

These hints do double duty: they also become **comments in the YAML file on
disk**, so an admin who opens the file over SSH reads the same explanations the
form shows.

A model may set `master_detail: true` to be rendered as a list of rows plus the
selected row's form, instead of a spreadsheet — the right shape for catalogs.

## Version and migrate your shape

`version` is a monotonic integer. When the shape changes, bump it and ship the
migration **in the declaration** — declarative steps, never code:

```kotlin
"version" to 2,
"migrations" to listOf(mapOf(
    "from" to 1, "to" to 2,
    "steps" to listOf(
        mapOf("op" to "rename_field", "from" to "cost", "to" to "price"),
        mapOf("op" to "set_default", "field" to "discount", "value" to 0),
    ),
)),
```

Available steps: `rename_field`, `set_default`, `rename_enum_value`,
`rename_variant` — each accepting an optional `path` for nested fields. Unknown
steps are ignored rather than fatal. Migrations are applied editor-side when
admins open the data.

## How it lands on disk

Data lives in your project as plain, self-contained YAML. Two shapes:

**Table** — a directory, one file per row, plus a descriptor:

```
data/categories/_source.yaml     # name, model: boutique:category, model_version, order
data/categories/weapons.yaml     # one row, fields at the top level
```

```yaml
# data/categories/weapons.yaml
id: weapons
name: "Weapons"
icon: DIAMOND_SWORD
items:
  - id: diamond_sword
    price: 100
    actions: 'run_command "give {player} diamond_sword 1" as console'
```

**Config** — a single object, one bare file, bound to its model by a sibling ref:

```
data/shop_settings.yaml          # the values, nothing else
models/shop_settings.yaml        # model: boutique:shop_settings
```

The files are **bare**: no wrapper, no schema envelope, no editor bookkeeping.
Your plugin parses them with any YAML library. Declared model shapes are never
copied to disk — they live in your jar, referenced by id.

Read them through `api.project` and rebuild your cache in `onReload()`.

## Config screens

A model gives admins a form. A **config screen** gives it a home: a named entry
in the editor sidebar, under your module.

```kotlin
api.screens.declare("myplugin:kits", "Kits", "data/kits", "myplugin_project")
```

| Argument | Meaning |
|---|---|
| `id` | Namespaced screen id — `myplugin:kits` |
| `label` | Sidebar label |
| `table` | Project-relative path of the edited Table or Config — `data/kits` |
| `projectId` | The project whose files the screen edits (usually your owned root) |

Absolute paths, `..`, and a first segment starting with `.artisan` are rejected
at declare time, as is a duplicate id.

A module that declares models and owns a project but no screen still gets a
fallback **Données** screen synthesized by the editor — declaring screens is how
you name and split them meaningfully.

Config screens edit **live**, over the WebSocket relay: changes go to the
connected server. They are disabled (greyed out) while the server is offline.

## Putting it together

The Boutique Add-on, end to end, in its `onEnable`:

```java
File projectDir = new File(getDataFolder(), "editor");
api.getProjectRoots().register("boutique_shop", projectDir);   // own the project root
bootstrapIfAbsent(projectDir);                                 // ship default content
api.getModules().register(new BoutiqueModule(this, repo));     // then, inside onEnable(api):
//   api.getModels().declare(ShopModels.item());
//   api.getModels().declare(ShopModels.category());
//   api.getScreens().declare("boutique:catalog", "Catalogue", "data/categories", "boutique_shop");
//   api.getDataSources().register(/* boutique:categories, boutique:items */);
//   api.getCommands().register(new CommandDeclaration("boutique:buy", …));
```

Result for the admin: a **Catalogue** screen with a master-detail catalog form,
translated item names, item pickers, purchase actions authored visually — and
those same items available as a data source to design the shop menu with.
