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

## Preview as a player

The canvas renders your menus with **real rows** fetched from the connected server —
no button to press, it happens as you edit.

Those rows are fetched **without a player**, though, and many sources answer per
player: a quest list, someone's homes, a balance. Without a player they come back
empty or neutral, and your menu previews blank even though it is correct in game.

Select the menu and fill **Preview as** in its properties with the name of an online
player. Every source the menu reads is refetched as them, and the canvas shows what
that player would actually see — their quests, their progress, their icons.

The choice lasts for the session only: it is a lens for checking your work, not a
project setting, and it is never saved into your project.

## Project sources: your own data

Besides server sources, you can author **your own data** directly in the project — perfect for a ranks menu, a kits list, or project-wide settings. In the Data tab's **Project sources** section, create one of two shapes:

- **Table** — a list of rows (ranks, kits, warps…). Menus can paginate over it, place individual rows on specific slots, and build item Sets from it.
- **Config** — a single object of settings (currency name, support URL…) you reference in menus as `{settings.currency}`.

Project source names are lowercase and unique within the project. The editor lowercases typing and pasted text automatically; if a name is already used, the rename is rejected with an inline error.

### Declare the schema

A Table is backed by a **model**: the list of fields each row has. Add fields with a name and a type:

- **text**, **number**, **integer**, **boolean** — plain values,
- **localized text** — translatable per language, edited like any other text in the editor (and listed in the Translations view),
- **minimessage**, **minimessage (multiline)** — text with MiniMessage markup (`<gold>`, `<bold>`…), shown rendered at rest and edited as raw markup on click, like the menu title fields,
- **item** — pick a vanilla, custom, or captured item, then set its quantity and advanced attributes (enchantments, glint, custom model data, tint, and more).
- **actions** — a chain of actions and conditions (e.g. what happens when a player buys a row), authored visually or as compact text — see [Action fields](#action-fields--the-action-dsl) below,
- **list**, **object**, **model** — nested structures (e.g. a `perks` list of localized text for variable-length lore).

In a menu template, click **Icon** and choose a field path such as `item.icon` or `cat.icon` under **Catalogue**. Paths use the aliases defined in your menu and are displayed without translation. Choose a fixed item under **Library** instead when needed. Manual expressions remain under **Advanced expression**.
Quantity and enchantments show their catalogue values. Edit them in their usual fields, or use the reset control to restore inheritance.
This writes `item: "{item.icon}"` in `menu/v2`. Existing `material: "{item.icon}"` templates remain readable.
The complete icon supplies its quantity and attributes; an explicit template count overrides it, including `1`.
Clear the template's quantity field to inherit the icon's quantity.
The catalogue and menu share the same item widget. A compact card shows the thumbnail, title, quantity, lore and enchantments. Click it to open a dialog for the source, title, lore, quantity, custom head and advanced attributes. **Done**, the close button or Escape closes the dialog; the card stays in place and reflects your edits. Edits use the screen's usual Save action. Unset fields inherit; the reset arrow restores inheritance when a source value exists.
Catalogue icon text can use the current product's data, such as `{item.name}` and `{item.price}`. Each extension reads its immediate source with `{base.title}` and `{base.lore}`.
Editing lore replaces it. **Insert source lore** inserts `{base.lore}` to keep the source's lines; add lines above or below, for example `{item.price_display}` at the end. The button appears only when the source has lore, and inherited labels appear only for fields with a source value. An explicitly empty lore removes inherited lines. This supports captured item → catalogue icon → menu template without copying the captured item.
Explicit lore overrides use `menu/v3`. Boutique moves legacy product lore into the icon, including when opening the catalogue without its menus. The separate product lore field disappears. Loaded templates replace `{item.lore}` with `{base.lore}`; older templates still work after a catalogue-only save. The complete source lore is inserted at that position once, including any captured lore.
Live catalogue screens edit item text in the file's default language; project editing supports translations.
Their captured-item picker reads the owning project's existing captures. Create or delete captures in the project's Library; catalogue saves only update the catalogue files.
Material fields preserve expression and custom-reference casing when typing or pasting.
Boutique previews resolve localized lore before assembling its lines and use the catalogue's configured price display format, including discounts.

One field is the **Row key** — the stable identifier of each row (e.g. `id`). Renaming or retyping a field updates all existing rows automatically.

### Fill the rows

Rows are edited in a scrollable sheet: one column per field, with the header and first column staying visible while you scroll — wide models just scroll horizontally. Item cells open the item picker; localized text cells edit the currently active language. Reference the source in a menu like any other data source — its ref is `pack:<id>` — then iterate, filter, or place rows exactly as you would with a server source. Your data deploys with the project and works in-game, translated to each player's language.

New rows automatically get the first available positive number for a numeric Row key, or an ID such as row_1 for a text Row key; unused gaps are reused. Text Row keys are normalized to lowercase and must be unique in their source: empty or duplicate edits show an inline error and leave the row and its translations unchanged.

Deleting a source asks for confirmation and cannot be undone — its rows and translations go with it.

## Action fields & the Action DSL

An **actions** field holds a small program — a sequence of actions with optional
`if` / `else if` / `else` branches — that describes *what happens* for a row. A
classic use is a shop item's **on-buy**: take money, run a command, play a sound.

Every actions field has two editing modes, toggled top-right:

- **Visual** — the same block editor used for menu button clicks (actions as rows,
  conditions as `if` blocks, drag to reorder).
- **Code** — the raw text, exactly as it lives on disk. This is the **Action DSL**:
  one action per line, hand-writable.

### Syntax

```
# one action per line
give_item DIAMOND 5
take_money 100
run_command "spawn" as player
broadcast "&aWelcome {player}!"     # quoted text can hold placeholders
broadcast @shop.vip_purchased        # @key = a translatable message (in your lang files)

# branch on typed conditions
if has_permission(vip) and balance >= 100:
  take_money 100
  play_sound ENTITY_PLAYER_LEVELUP
else if cooldown_passed(daily):
  give_item DIAMOND 1
else:
  send_message "&cNot allowed."
```

Rules of thumb:

- **Text** is always quoted (`"..."`) — literal, one language — or written as
  `@some.key` to point at a translatable message stored in your language files.
- **Conditions** combine with `and` / `or` / `not` and parentheses:
  `if (has_permission(vip) and balance >= 100) or balance >= 200:`.
- **Blocks** use `:` and two-space indentation. Blank lines and `#` comments are
  ignored.
- If the code doesn't parse, the visual editor steps aside and shows the error so
  you can fix it in text.

### Running a row's actions from a menu

Give a row an actions field (say `on_buy`), then, on a menu button bound to that
source, add a **run** action pointing at it:

```
run_actions item.on_buy
```

The row's chain runs right there, and inside it the row's own fields are available
directly — `take_money {price}` reads that row's `price`. So a source's actions are
written once and work in any menu that invokes them.

## Filter a source in a menu

In a menu's properties, each **Source ref** context input now has a visual editor:

- **Filters** — `field = value` rows. Fields autocomplete from the declared schema; values can be literals (`armes`) or menu args in braces (`{group}`).
- **Sort** — a field plus `asc`/`desc`.
- **Limit** — maximum number of rows.

These map 1:1 to the runtime behavior: the preview shows exactly what players will get.

## Menu data

Below the context inputs, the **Menu data** section lists every source the menu consumes with its active filters. **Preview** applies those filters live. When a filter uses `{arg}`, type a test value first — it substitutes the arg the way a real menu call would.
