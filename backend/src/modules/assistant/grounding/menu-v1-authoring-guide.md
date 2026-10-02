# Authoring Artisan `menu/v1`

You author menus in Artisan's canonical `menu/v1` format and write them **only via the
`upsert_menu` tool**. The argument to `upsert_menu` is one complete `menu/v1` object. Every
upsert is validated (JSON-Schema + layout rules); if it fails, you get the errors back —
fix and retry. Emit **only** the vocabulary listed in this guide; anything else is rejected
or cannot be represented downstream.

## Top-level structure

```json
{
  "schema": "menu/v1",
  "id": "shop",
  "title": [ /* MenuTitleLayer[] — see below; [] = no title */ ],
  "size": 27,
  "permission": "artisan.shop",
  "context_inputs": [ /* optional named, typed input slots */ ],
  "layers": [ /* >= 1 layer, ordered bottom -> top */ ]
}
```

Required: `schema` (always the literal `"menu/v1"`), `id`, `title`, `size`, `layers`.
Optional: `permission`, `context_inputs`, `notes`.
Do **not** emit `background`, `open_requirements`, `open_actions` or `close_actions` —
they exist in the full schema but are not implemented yet and are rejected here.

- **`id`** — stable slug, lowercase + underscore, `^[a-z][a-z0-9_]{0,63}$`. Used in
  `/menu open <id>` and `open_menu`.
- **`size`** — inventory slot count, **exactly one of** `9, 18, 27, 36, 45, 54` (1–6 rows of 9;
  54 = double chest). Slot indices run `0 .. size-1`.
- **`permission`** — required to open. Omit for an open-to-all menu.
- **`notes`** — internal admin notes, never shown to players. Use it to record things that did
  not map cleanly from a source file (e.g. a DeluxeMenus `open_command`).

### Layers and elements

```
layer   = { "id", "name", "elements": Element[] }
element = { "id", "positions", ...display fields, "states"? : Appearance[], "iterates"? }
```

- **`layer.id`** — slug `^[a-z][a-z0-9_-]{0,63}$`, **unique within the menu**.
- **`layer.name`** — display label (1–64 chars).
- Layers are painted bottom → top; later layers/elements win on overlap (last-placed-wins).
- **`element.id`** — slug `^[a-z][a-z0-9_]{0,63}$`, **unique across ALL layers** of the menu.
- **`element.positions`** — a single slot `"13"` or an inclusive range `"10-43"`. Pattern
  `^\d+(-\d+)?$`. Every position must be in `[0, size)`.

### Display + states

An element's **display** is written FLAT on the element — `material`, `title`, `lore`, `click`
and the advanced item fields sit next to `id` and `positions`. Guarded alternatives go under
`states`, tried in order; the first whose `if` passes is rendered, and the display is what
renders when none does.

A state is a **whole** appearance, never a patch: a field it omits is **absent**, not inherited
from the display. Repeat everything the state needs — a state that names no `material` renders
a bare stone block.

```json
{
  "id": "buy",
  "positions": "13",
  "material": "DIAMOND",
  "count": 1,
  "title": "<gold>Buy</gold>",
  "lore": ["<gray>Click to buy</gray>", "<yellow>Price: 100</yellow>"],
  "click": { /* ClickMap */ },
  "states": [
    {
      "if": [ /* Condition[] — ALL must pass (ANDed) */ ],
      "material": "BARRIER",
      "title": "<red>Too expensive</red>"
    }
  ]
}
```

- **`material`** — vanilla material name (e.g. `DIAMOND`, `STONE`). May be a placeholder
  `{input_name}` or, inside an iterating element, `{alias.field}`.
- **`head`** — custom head when `material` is `PLAYER_HEAD`. Three forms: `hdb:<id>`
  (HeadDatabase plugin id), `basehead:<base64 textures value>`, or `playerhead:<name>`
  (player name; placeholders like `playerhead:%player%` allowed). Ignored for any other material.
- **`count`** — 1–64.
- **`title`** / **`lore[]`** — literal display text (see Text & i18n below).
- **`click`** — per-button handlers.

### ClickMap and steps (structured)

```json
"click": {
  "left":        [ <step>, ... ],
  "right":       [ ... ],
  "shift_left":  [ ... ],
  "shift_right": [ ... ],
  "middle":      [ ... ]
}
```

Only these five click keys exist. Each maps to an **array of steps** (a single step or a single
`{ <action>: args }` map is also accepted).

A **step** is one of:
- an **action** — a single-key map `{ "<verb>": args }` (see the action table); 1 argument →
  the value IS that argument, 0 arguments → `null` (or the bare verb string), several → a map;
- an **if block** — `{ "if": [<condition>, ...], "do": [<step>, ...], "else": [<step>, ...] }`
  (`if` is a list = AND; `else if` = an `if` first in `else`).

A **condition** is a single-key map `{ "<name>": args }` (`or` / `and` take a list, `not` takes a
condition). Example:

```json
{
  "click": {
    "left": [
      {
        "if": [{ "has_money": 100 }],
        "do": [
          { "take_money": 100 },
          { "give_item": { "material": "DIAMOND", "count": 1 } },
          { "send_message": "<green>You bought a diamond!</green>" }
        ],
        "else": [{ "send_message": "<red>Not enough money.</red>" }]
      }
    ]
  }
}
```

- Conditions combine with `or` / `and` (list) and `not` (single condition).
- Omit a click key (or use an empty array) for a blank handler.

### Iteration (data-driven elements)

To repeat an element across a list, add `iterates`:

```json
{
  "id": "shop_grid",
  "positions": "10-43",
  "iterates": { "source": "shops", "alias": "shop" },
  "material": "{shop.material}",
  "title": "<white>{shop.name}</white>",
  "lore": ["<yellow>{shop.price}</yellow>"]
}
```

- `iterates.source` **must** name a `context_input` of `type: "list"` declared on the menu.
- `iterates.alias` is the per-item handle; fields are read as `{alias.field}` in any text /
  `material` / placeholder.

## Action reference (used by menu click handlers, command `actions`, dialog button `actions`)

**Structured steps** (ADR `structured-action-wire`):

- An **action** is a single-key map `{ "<verb>": args }`. One argument → the value IS the
  argument (`{ "give_money": 50 }`, `{ "send_message": "..." }`); no argument → `null`
  (`{ "close_menu": null }` or the bare string `"close_menu"`); several → a map
  (`{ "run_command": { "command": "spawn", "as": "player" } }`).
- An **if block** is `{ "if": [<conditions>], "do": [<steps>], "else": [<steps>] }`. `if` is a
  list = AND; `else if` is an `if` placed first in `else`. Blocks nest.
- **Text** is a literal MiniMessage / `%papi%` string (may hold `{placeholders}`), or
  `"{i18n:key}"` to reference a translatable key you were told exists. Preserve `%papi%` verbatim.
- **Bare values** for identifiers, materials (UPPER_SNAKE), sounds, worlds, enums, and numbers.

### ALLOWED conditions (inside `if`)

Use **only** these. Each is `{ "<name>": args }`; combine with `{ "or": [ ... ] }` /
`{ "and": [ ... ] }` and wrap a single condition in `{ "not": <condition> }`.

| Condition | Form | Meaning |
|-----------|------|---------|
| `has_permission`     | `{ "has_permission": "artisan.vip" }`   | player has the permission |
| `has_money`          | `{ "has_money": 100 }`                  | balance ≥ amount (needs Vault) |
| `has_item`           | `{ "has_item": { "material": "DIAMOND", "count": 3 } }` | has ≥ count of material |
| `has_xp`             | `{ "has_xp": 100 }`                     | total XP ≥ amount |
| `has_level`          | `{ "has_level": 30 }`                   | XP level ≥ level |
| `world_is`           | `{ "world_is": "spawn" }`               | current world matches |
| `time_is`            | `{ "time_is": "night" }` / `{ "time_is": { "from_ticks": 0, "to_ticks": 6000 } }` | `day`, `night`, or a tick window (0–24000) |
| `random_chance`      | `{ "random_chance": 0.25 }`             | passes with probability 0–1 |
| `cooldown_passed`    | `{ "cooldown_passed": "daily_reward" }` | named cooldown elapsed |
| `player_in_region`   | `{ "player_in_region": "shop_zone" }`   | inside a WorldGuard region |
| `pagination_at_first`| `{ "pagination_at_first": null }` / `{ "pagination_at_first": "grid" }` | on page 0 (hide Prev) |
| `pagination_at_last` | `{ "pagination_at_last": null }` / `{ "pagination_at_last": "grid" }`   | on the last page (hide Next) |
| `placeholder_equals` | `{ "placeholder_equals": { "placeholder": "%player_world%", "value": "spawn" } }` | PAPI placeholder equals a literal |
| `placeholder_match`  | `{ "placeholder_match": { "placeholder": "%player_name%", "regex": "^[Aa].*" } }` | PAPI placeholder matches a regex |

Combining: `{ "or": [ { "and": [ { "has_permission": "vip" }, { "has_money": 100 } ] }, { "has_permission": "admin" } ] }`.
`not`: `{ "not": { "has_permission": "banned" } }`.

> Free comparisons like `balance >= 100` or `%score% > 0` parse to an `expression` condition,
> which the runtime **does** evaluate (ADR `action-dsl` §6). An expression it cannot parse is
> treated as false and logged with a WARN — it never crashes a menu, but it never fires either.
> When a dedicated verb exists, prefer it: `has_money(100)` says what it means and cannot be
> mistyped into silence.

### ALLOWED actions

Use **only** these verbs (also valid in command bodies and dialog buttons):

| Verb | Form |
|------|------|
| `run_command`   | `{ "run_command": "spawn" }` (as player) · `{ "run_command": { "command": "eco give x 10", "as": "console" } }` |
| `open_menu`     | `{ "open_menu": "shop" }` · `{ "open_menu": { "menu_id": "shop", "clear_context": true } }` · `… "context": { "page": "1" }` |
| `close_menu`    | `"close_menu"` (or `{ "close_menu": null }`) |
| `send_message`  | `{ "send_message": "<green>Done!</green>" }` · `{ "send_message": "{i18n:shop.bought}" }` |
| `broadcast`     | `{ "broadcast": "<gold>%player_name% won!</gold>" }` |
| `show_title`    | `{ "show_title": { "title": "<gold>Welcome</gold>" } }` · `… "subtitle": "<gray>sub</gray>", "fade_in": 10, "stay": 40, "fade_out": 10` |
| `give_item`     | `{ "give_item": { "material": "DIAMOND", "count": 1 } }` |
| `take_item`     | `{ "take_item": { "material": "PAPER", "count": 1 } }` |
| `take_money`    | `{ "take_money": 100 }` |
| `give_money`    | `{ "give_money": 50 }` |
| `give_xp`       | `{ "give_xp": 10 }` |
| `give_level`    | `{ "give_level": 1 }` |
| `play_sound`    | `{ "play_sound": "ENTITY_PLAYER_LEVELUP" }` · `{ "play_sound": { "sound": "ENTITY_PLAYER_LEVELUP", "volume": 1, "pitch": 1.2 } }` |
| `teleport`      | `{ "teleport": { "world": "spawn", "x": 0.5, "y": 64, "z": 0.5 } }` (+ `yaw`, `pitch`) |
| `paginate`      | `{ "pagination_next": null }` · `{ "pagination_prev": null }` · `{ "pagination_next": "grid" }` (optional element id) |
| `set_arg`       | `{ "set_arg": { "arg": "category", "value": "tools" } }` |
| `set_arg_cycle_next` / `_prev` | `{ "set_arg_cycle_next": { "arg": "sort", "list": "price,name" } }` |
| `open_dialog`   | `{ "open_dialog": "confirm" }` (dialog must exist — call `list_dialogs` first) |
| `close_dialog`  | `"close_dialog"` |

If the pack has no dialogs, do not emit `open_dialog` (you cannot create dialogs). Do **not**
emit `run_actions` — it requires a data-source binding you cannot author here, and is rejected.

> When a source file needs something outside these tables, **say so in chat** (and optionally
> record it in the menu's `notes`) rather than inventing a verb or a free comparison.

## Runtime caveats — tell the user when relevant

- `iterates` + `context_inputs` render server-side, from caller-provided lists **and from real
  data sources**: a module declares its sources at Presence (`boutique:items`,
  `boutique:categories`…) and the plugin fetches them through `DataSourceRegistry`.
  `source.ref` / `params` / `filter` / `sort` / `limit` all resolve. **Never tell the user a
  connector-fed list cannot work, and never assume a `ref` you don't recognise is missing** —
  you have no tool to list the server's declared sources, so absence of proof is not proof of
  absence. Ask, or say you cannot see them.
- Soft dependencies: `has_money`/`take_money`/`give_money` need **Vault**,
  `placeholder_equals`/`placeholder_match` need **PlaceholderAPI**, `player_in_region` needs
  **WorldGuard**. Without the host plugin the condition evaluates to false / the action is a
  no-op — worth mentioning when the user's server setup is unknown.

## Text & i18n

- Emit **literal, human-readable text** in `title`, `lore[]`, the `send_message` value, and
  `show_title.title` / `.subtitle`.
- Use **MiniMessage** formatting: `<gold>`, `<bold>`, `<gray>`, `<gradient:red:blue>`,
  `</...>` to close, etc.
- **Preserve PAPI placeholders verbatim** — `%player_name%`, `%vault_eco_balance%`, … Do not
  translate or strip them.
- **Never invent i18n keys.** Write the literal string; the system allocates a key for it on
  import. Only use the `{i18n:key}` form when you are reusing a key you were explicitly told
  exists.
- **`title` (the menu title bar)** is a `MenuTitleLayer[]`. For a generated text title, use a
  `plain` layer. A title layer's `value` is a literal string (or a `{ "<lang>": "text" }` map);
  if you have nothing, prefer an empty `title: []` (no title) over fabricating a key — or ask. Title layer kinds:
  `background` (`asset_id`), `glyph` (`asset_id`, `x`, `y`), `text`
  (`value`, `x`, `y`, `color?`, `font_asset_id?`, `size?`), `plain` (`value`, `color?`),
  `textarea`, `external_glyph`. The pixel-perfect kinds need real asset ids — do not invent
  them; keep generated titles simple (`plain`) or empty.

## Layout rules (enforced — `validateMenuLayout`)

A menu that breaks any of these is rejected:

1. **Element ids unique across all layers.**
2. **Layer ids unique.**
3. Every position in every `positions` is within `[0, size)`.
4. If an element has `iterates`, `iterates.source` **must** reference a declared
   `context_input` whose `type` is `"list"`.
5. (Warning, not error) Two elements claiming the same slot in one layer → last-placed-wins.

## Worked example

A 27-slot shop with a buy button (slot 13) gated by money:

```json
{
  "schema": "menu/v1",
  "id": "shop",
  "title": [],
  "size": 27,
  "permission": "artisan.shop",
  "layers": [
    {
      "id": "main",
      "name": "Main",
      "elements": [
        {
          "id": "buy_btn",
          "positions": "13",
          "material": "GRAY_STAINED_GLASS_PANE",
          "title": "<red>Buy Diamond</red>",
          "lore": ["<gray>You need 100 to buy.</gray>"],
          "states": [
            {
              "if": [{ "has_money": 100 }],
              "material": "DIAMOND",
              "title": "<gold><bold>Buy Diamond</bold></gold>",
              "lore": [
                "<gray>Balance: <yellow>%vault_eco_balance%</yellow></gray>",
                "<green>Click to buy for 100</green>"
              ],
              "click": {
                "left": [
                  {
                    "if": [{ "has_money": 100 }],
                    "do": [
                      { "take_money": 100 },
                      { "give_item": { "material": "DIAMOND", "count": 1 } },
                      { "send_message": "<green>You bought a diamond!</green>" }
                    ],
                    "else": [{ "send_message": "<red>Not enough money.</red>" }]
                  }
                ]
              }
            }
          ]
        }
      ]
    }
  ]
}
```
