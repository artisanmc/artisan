# zMenu (Maxlego08) — source format reference

zMenu is a YAML menu plugin. When a zMenu file is dropped into the conversation, **the dropped
file is the source of truth.** This sheet only fixes the *mapping conventions* into Artisan
`menu/v1`. If a construct does not map cleanly onto the allowed `menu/v1` vocab, **flag it in
chat** (and optionally note it in the menu's `notes`) rather than inventing fields or types.

Verified against the official docs (Maxlego08/zMenu-Documentation, `english` branch). Where a
detail is version-dependent or uncertain, it is marked.

## Inventory file shape (common case)

```yaml
name: "&8My Menu"          # inventory title
size: 27                   # OR: rows: 3  (rows * 9 = size)
items:                     # map of button-id -> button
  my_button:
    type: NONE             # button type (see below)
    slot: 13               # OR slots: [10, 11, 12]
    item:                  # the displayed ItemStack
      material: DIAMOND
      name: "&bMy Button"
      lore:
        - "&7Click me!"
      amount: 1
    view-requirement: { ... }    # whether the button is shown
    click-requirement: { ... }   # whether a click is allowed
    actions:                     # actions run on click
      - type: message
        messages: ["&aClicked!"]
```

- **Title** comes from `name`. **Size** from `size`, or `rows` (× 9).
- **`items`** is a map; each entry has a free-form id key.
- **`slot`** (single) or **`slots`** (list / range) place the button.
- **`item`** holds `material`, `name`, `lore` (list), `amount`. Text uses legacy `&` color
  codes (and may use MiniMessage in newer versions).

### Button `type` (navigation semantics)

`NONE` (plain), `INVENTORY` (open another), `BACK`, `HOME`/`MAINMENU`, `NEXT`/`PREVIOUS`
(pagination), `PAGINATION` / `DYNAMIC_PAGINATION` (list rendering), `SWITCH`, `JUMP`, `INPUT`.

## Action types (inside `actions:`)

Each action is `{ type: <type>, ... }`, with optional `delay:` (ticks) and `chance:` (%).

| zMenu action `type`                  | Key fields                          |
|--------------------------------------|-------------------------------------|
| `player_command`                     | `commands:` (list)                  |
| `console_command`                    | `commands:` (list)                  |
| `player command as op`               | `commands:` (list)                  |
| `message`                            | `messages:` (list), `mini-message?` |
| `broadcast`                          | `messages:` (list)                  |
| `actionbar`                          | `message:`                          |
| `title`                              | `title:`, `subtitle:`, timings      |
| `inventory`                          | `inventory:`, `plugin:`, `page?`    |
| `close`                              | —                                   |
| `back` / `refresh` / `refresh inventory` | —                               |
| `withdraw`                           | `amount:`, `currency:`              |
| `deposit`                            | `amount:`, `currency:`              |
| `sound` / `broadcast_sound`          | `sound:` (XSound), `pitch?`, `volume?` |
| `connect`                            | `server:`                           |
| `teleport`                           | `x:`, `y:`, `z:`, `world?`          |

## Requirements

`view-requirement` (visibility) and `click-requirement` (click gating). A click-requirement is
keyed per click type (e.g. `left-click`, `right-click`) with `clicks:` and a `requirements:`
list. Requirement entries look like:

```yaml
requirements:
  - type: placeholder
    placeholder: "%player_gamemode%"
    value: "CREATIVE"
    action: equals_string      # equals_string / contains / >= / <= / ...
```

Other requirement types include `permission` and economy checks. (Exact requirement `type` /
`action` names vary by version — if a file uses one not covered here, map by intent and flag
anything ambiguous.)

## Mapping: zMenu → Artisan `menu/v1`

Use **only** the allowed `menu/v1` vocab (see the authoring guide). Preserve PAPI placeholders
(`%...%`) verbatim; convert `&`-codes to MiniMessage equivalents (`&a` → `<green>`, `&l` →
`<bold>`, etc.).

| zMenu                                   | Artisan `menu/v1` |
|-----------------------------------------|-------------------|
| `name`                                  | menu `title` (a `plain` title layer with literal text, or `[]` if just a color/blank) |
| `size` / `rows`                         | menu `size` (snap to 9/18/27/36/45/54) |
| each `items.<id>`                       | one `element` (+ one `appearance`) in a layer |
| `slot` / `slots`                        | element `positions` (`"13"`, or a range `"10-43"`) |
| `item.material`                         | appearance `material` |
| `item.name`                             | appearance `title` (literal MiniMessage) |
| `item.lore`                             | appearance `lore[]` (literal MiniMessage lines) |
| `item.amount`                           | appearance `count` |
| `actions: player_command`               | `run_command` (`as: "player"`), one per command in `commands:` |
| `actions: console_command` / `... as op`| `run_command` (`as: "console"`) — flag op-elevation in chat |
| `actions: message`                      | `send_message` (`text`), one per message line |
| `actions: title`                        | `show_title` (`title`, `subtitle`, timings) |
| `actions: inventory`                    | `open_menu` (`menu_id`) — only if the target menu also exists in this pack |
| `actions: close`                        | `close_menu` |
| `actions: withdraw`                     | `take_money` (`amount`) |
| `actions: deposit` / `broadcast` / `sound` / `connect` / `teleport` / `actionbar` | **no clean equivalent in the importable subset** → flag in chat; record in `notes` |
| button `type: NEXT` / `PREVIOUS`        | `pagination_next` / `pagination_prev` |
| button `type: BACK`/`HOME`/`INVENTORY`  | `open_menu` to the relevant menu (or `close_menu` for plain back) |
| `view-requirement`                      | appearance `if: [Condition[]]` (gate which appearance renders) |
| `click-requirement`                     | an `if` **step** at the top of that click's `steps` (gate the actions) |
| requirement `permission`                | `has_permission` (`perm`) |
| requirement economy check               | `has_money` (`amount`) |
| requirement `placeholder` + `equals_string` | `placeholder_equals` (`placeholder`, `value`) |
| requirement `placeholder` + regex/contains  | `placeholder_match` (`placeholder`, `regex`) |

### Not-clean cases — flag, don't fabricate

- Actions with no importable equivalent (`deposit`, `sound`, `broadcast`, `connect`,
  `teleport`, `actionbar`, `toast`, `data`, `permission set`, …) → say so; offer to drop or to
  approximate with `run_command`, and note it.
- `DYNAMIC_PAGINATION` / data-driven lists → these map to an `iterates` element **only** if you
  have a `context_input` of `type: "list"` to iterate; without a data source, render a static
  grid and flag that the dynamic source was dropped.
- Multi-plugin `inventory` opens (`plugin:` other than zMenu) → cannot become an in-pack
  `open_menu`; flag it.
- Requirement types you can't confidently map → flag rather than guess.
