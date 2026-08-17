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

### ClickMap and steps (the Action DSL)

```json
"click": {
  "left":        { "steps": "<Action DSL string>" },
  "right":       { "steps": "..." },
  "shift_left":  { "steps": "..." },
  "shift_right": { "steps": "..." },
  "middle":      { "steps": "..." }
}
```

Only these five click keys exist. Each maps to `{ "steps": "<Action DSL string>" }`.

**`steps` is a STRING** written in the **Action DSL** — *not* a JSON array. One action per
line; `if` / `else if` / `else` blocks open with `:` and a two-space indent. This is the same
DSL used by command bodies and dialog buttons — learn it once. Full grammar in the
**Action DSL reference** section below; a taste:

```
if has_money(100):
  take_money 100
  give_item DIAMOND 1
  send_message "<green>You bought a diamond!</green>"
else:
  send_message "<red>Not enough money.</red>"
```

- Conditions after `if` combine with `and` / `or` / `not` and parentheses.
  `if has_permission(vip) and has_money(100):`. `else if <cond>:` adds another arm; a bare
  `else:` is the fallback. Blocks nest by indentation.
- A blank menu handler is the **empty string** `""` (or just omit that click key).

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

## Action DSL reference (used by `steps`, command bodies, dialog buttons)

Structure:

- **One action per line.** A line is a verb + its arguments (see the action table).
- **`if` / `else if` / `else`** open a block with a trailing `:` and a **two-space** indent for
  the body. `else if <cond>:` chains; `else:` is the catch-all. Blocks nest.
- **Blank lines** and `#` line comments are ignored.
- **Text is always quoted**: `"literal MiniMessage / %papi% text"` (default language, may hold
  `{placeholders}`), **or** `@some.key` to reference a translatable i18n key you were told exists.
  Never write a bare word where text is expected. Preserve `%papi%` placeholders verbatim.
- **Bare words** for identifiers, materials (UPPER_SNAKE), sounds, worlds, enums, and numbers.

### ALLOWED conditions (inside `if` / `else if`)

Use **only** these. Combine with `and` / `or` / `not` and parentheses.

| Condition | DSL form | Meaning |
|-----------|----------|---------|
| `has_permission`     | `has_permission(artisan.vip)`        | player has the permission |
| `has_money`          | `has_money(100)`                     | balance ≥ amount (needs Vault) |
| `has_item`           | `has_item(DIAMOND, 3)`               | has ≥ count of material |
| `has_xp`             | `has_xp(100)`                        | total XP ≥ amount |
| `has_level`          | `has_level(30)`                      | XP level ≥ level |
| `world_is`           | `world_is(spawn)`                    | current world matches |
| `time_is`            | `time_is(night)` / `time_is(0-6000)` | `day`, `night`, or a `<from>-<to>` tick window (0–24000) |
| `random_chance`      | `random_chance(0.25)`                | passes with probability 0–1 |
| `cooldown_passed`    | `cooldown_passed(daily_reward)`      | named cooldown elapsed |
| `player_in_region`   | `player_in_region(shop_zone)`        | inside a WorldGuard region |
| `pagination_at_first`| `pagination_at_first` / `pagination_at_first(grid)` | on page 0 (hide Prev) |
| `pagination_at_last` | `pagination_at_last` / `pagination_at_last(grid)`   | on the last page (hide Next) |
| `placeholder_equals` | `%player_world% == "spawn"`          | PAPI placeholder equals a literal |
| `placeholder_match`  | `%player_name% matches "^[Aa].*"`    | PAPI placeholder matches a regex |

Combining: `if (has_permission(vip) and has_money(100)) or has_permission(admin):`.
`not`: `if not has_permission(banned):`.

> **Do NOT write free comparisons** like `balance >= 100` or `score > 0` — they parse to an
> `expression` condition that has **no server-side evaluator yet** and is **rejected**. Gate on
> money with `has_money(100)`, or compare a PAPI placeholder with `%placeholder% == "value"`.

### ALLOWED actions

Use **only** these verbs (also valid in command bodies and dialog buttons):

| Verb | DSL form |
|------|----------|
| `run_command`   | `run_command "spawn" as player`  (or `as console`; `as` is required) |
| `open_menu`     | `open_menu shop` · `open_menu shop clear` · `open_menu shop with page="1"` |
| `close_menu`    | `close_menu` |
| `send_message`  | `send_message "<green>Done!</green>"` · `send_message @shop.bought` |
| `broadcast`     | `broadcast "<gold>%player_name% won!</gold>"` |
| `show_title`    | `show_title "<gold>Welcome</gold>"` · `show_title "<gold>Hi</gold>" "<gray>sub</gray>" fadeIn=10 stay=40 fadeOut=10` |
| `give_item`     | `give_item DIAMOND 1` |
| `take_item`     | `take_item PAPER 1` |
| `take_money`    | `take_money 100` |
| `give_money`    | `give_money 50` |
| `give_xp`       | `give_xp 10` |
| `give_level`    | `give_level 1` |
| `play_sound`    | `play_sound ENTITY_PLAYER_LEVELUP` · `play_sound ENTITY_PLAYER_LEVELUP vol=1 pitch=1.2` |
| `teleport`      | `teleport spawn 0.5 64 0.5` · `teleport spawn 0.5 64 0.5 yaw=90 pitch=0` |
| `paginate`      | `paginate next` · `paginate prev` · `paginate next grid` (optional element id) |
| `set`           | `set category = tools`  (→ set an arg) |
| `cycle`         | `cycle next sort in "price,name"` · `cycle prev sort in "price,name"` |
| `open_dialog`   | `open_dialog confirm` (dialog must exist — call `list_dialogs` first) |
| `close_dialog`  | `close_dialog` |

If the pack has no dialogs, do not emit `open_dialog` (you cannot create dialogs). Do **not**
emit `run_actions` — it requires a data-source binding you cannot author here, and is rejected.

> When a source file needs something outside these tables, **say so in chat** (and optionally
> record it in the menu's `notes`) rather than inventing a verb or a free comparison.

## Runtime caveats — tell the user when relevant

- `iterates` + `context_inputs` now render server-side from caller-provided lists (windowed
  pagination included); what's still missing is the data delivery — connectors and pack data
  sources (Phase B). Flag in chat when a menu depends on a connector-fed list.
- Soft dependencies: `has_money`/`take_money`/`give_money` need **Vault**,
  `placeholder_equals`/`placeholder_match` need **PlaceholderAPI**, `player_in_region` needs
  **WorldGuard**. Without the host plugin the condition evaluates to false / the action is a
  no-op — worth mentioning when the user's server setup is unknown.

## Text & i18n

- Emit **literal, human-readable text** in `title`, `lore[]`, `send_message.text`, and
  `show_title.title` / `.subtitle`.
- Use **MiniMessage** formatting: `<gold>`, `<bold>`, `<gray>`, `<gradient:red:blue>`,
  `</...>` to close, etc.
- **Preserve PAPI placeholders verbatim** — `%player_name%`, `%vault_eco_balance%`, … Do not
  translate or strip them.
- **Never invent i18n keys.** Write the literal string; the system allocates a key for it on
  import. Only use the `{i18n:key}` form when you are reusing a key you were explicitly told
  exists.
- **`title` (the menu title bar)** is a `MenuTitleLayer[]`. For a generated text title, use a
  `plain` layer. Each title layer's `value` is `{ "key": "<i18n-key>" }`; if you have no key,
  prefer an empty `title: []` (no title) over fabricating a key — or ask. Title layer kinds:
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
              "if": [{ "type": "has_money", "amount": 100 }],
              "material": "DIAMOND",
              "title": "<gold><bold>Buy Diamond</bold></gold>",
              "lore": [
                "<gray>Balance: <yellow>%vault_eco_balance%</yellow></gray>",
                "<green>Click to buy for 100</green>"
              ],
              "click": {
                "left": {
                  "steps": "if has_money(100):\n  take_money 100\n  give_item DIAMOND 1\n  send_message \"<green>You bought a diamond!</green>\"\nelse:\n  send_message \"<red>Not enough money.</red>\""
                }
              }
            }
          ]
        }
      ]
    }
  ]
}
```
