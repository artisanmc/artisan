# DeluxeMenus (HelpChat / extendedclip) — source format reference

DeluxeMenus is a YAML GUI plugin. When a DeluxeMenus file is dropped into the conversation,
**the dropped file is the source of truth.** This sheet only fixes the *mapping conventions*
into Artisan `menu/v1`. If a construct does not map cleanly onto the allowed `menu/v1` vocab,
**flag it in chat** (and optionally note it in the menu's `notes`) rather than inventing fields
or action types.

Verified against the official HelpChat wiki (wiki.helpch.at / HelpChat/Wiki2). Where a detail
is version-dependent or uncertain, it is marked.

## Menu file shape (common case)

A DeluxeMenus file is one menu (often under a `menus:` map, one per file in newer layouts):

```yaml
menu_title: "&6Main Menu"
open_command: menu            # registers /menu to open this
size: 27
items:
  close_button:
    material: BARRIER
    slot: 26
    display_name: "&cClose"
    left_click_commands:
      - "[close]"
  shop:
    material: DIAMOND
    slot: 13
    display_name: "&bShop"
    lore:
      - "&7Balance: $%vault_eco_balance%"
    priority: 0
    update: true
    view_requirement: { ... }
    left_click_requirement: { ... }
    left_click_commands:
      - "[openguimenu] shop"
```

- **`menu_title`** → title bar. **`size`** → inventory size.
- **`open_command`** registers a command that opens the menu. `menu/v1` does **not** create
  commands — record it in the menu `notes`, do not invent an action.
- **`items`** is a map; each entry has a free-form id.

### Per-item keys

`material` (supports `head-<name>`, ItemsAdder/Oraxen/MMOItems syntaxes), `slot` / `slots`,
`display_name`, `lore` (list), `amount`, `priority` (tie-break when items share a slot),
`update` (placeholder refresh), and the requirement / click-command keys below. Text uses `&`
color codes (and `%papi%` placeholders).

### Click command keys

`left_click_commands`, `right_click_commands`, `shift_left_click_commands`,
`shift_right_click_commands`, `middle_click_commands` (removed in some 1.18+ builds),
`click_commands` (generic fallback / all clicks).

## Action tags (inside `*_click_commands`)

Each list entry is a string starting with a `[tag]`. Modifier tags `<delay=ticks>` and
`<chance=0-100>` may be appended.

| DeluxeMenus tag           | Meaning |
|---------------------------|---------|
| `[player]`                | Run command as the player |
| `[console]`               | Run command from console |
| `[commandevent]`          | Run an unregistered command as player (aliases `[player]`) |
| `[message]`               | Send a message to the player (`&` colors + PAPI) |
| `[broadcast]`             | Message everyone (incl. console) |
| `[minimessage]`           | Message the player using MiniMessage |
| `[minibroadcast]`         | MiniMessage to all online players |
| `[openguimenu]`           | Open another DeluxeMenus GUI |
| `[close]`                 | Close the open GUI |
| `[refresh]`               | Refresh items in the current view |
| `[connect]`               | Connect player to a BungeeCord server |
| `[json]` / `[jsonbroadcast]` | Send a JSON message |
| `[chat]`                  | Make the player send a chat message |
| `[sound]` / `[broadcastsound]` / `[broadcastsoundworld]` | Play / broadcast a sound |
| `[takemoney]` / `[givemoney]` | Take / give currency (Vault) |
| `[takeexp]` / `[giveexp]` | Take / give experience |
| `[givepermission]` / `[takepermission]` | Grant / remove a permission |
| `[meta]`                  | Modify player metadata |
| `[placeholder]`           | Parse PAPI placeholders with no output |

## Requirements

Containers: `open_requirement`, `view_requirement`, `click_requirement`,
`left_click_requirement`, `right_click_requirement`, `shift_left_click_requirement`,
`shift_right_click_requirement`. A container holds:

```yaml
left_click_requirement:
  minimum_requirements: 1     # how many must pass; default = all
  stop_at_success: true
  requirements:
    perm:
      type: has permission
      permission: artisan.shop
    money:
      type: has money
      amount: 500
      optional: true
  deny_commands:
    - "[message] &cRequirements not met."
```

Requirement `type` values (key fields): `has permission` (`permission`), `has permissions`
(`permissions[]`, `minimum`), `has money` (`amount` or `placeholder`), `has item`
(`material`/`amount`/…), `has exp` (`amount`, `level`), `has meta`, `is near`,
`string equals` / `string equals ignorecase` (`input`, `output`), `string contains`
(`input`, `output`), `regex matches` (`input`, `regex`), `javascript` (`expression`), and
numeric comparators `==` `!=` `>=` `<=` `>` `<` (`input`, `output`).

> Click requirements need their click commands counterpart — `success_commands` alone won't
> fire. Map both: requirement → `if` condition; the gated commands → the `if` step's `steps`.

## Mapping: DeluxeMenus → Artisan `menu/v1`

Use **only** the allowed `menu/v1` vocab (see the authoring guide). Preserve PAPI placeholders
(`%...%`) verbatim; convert `&`-codes to MiniMessage (`&a` → `<green>`, `&l` → `<bold>`, …);
`[minimessage]`/`[minibroadcast]` text is already MiniMessage — keep as-is.

| DeluxeMenus                              | Artisan `menu/v1` |
|------------------------------------------|-------------------|
| `menu_title`                             | menu `title` (a `plain` title layer with literal text, or `[]`) |
| `size`                                   | menu `size` (9/18/27/36/45/54) |
| `open_command`                           | **no command created in v1** → record in menu `notes` |
| each `items.<id>`                        | one `element` (+ appearance(s)) in a layer |
| `slot` / `slots`                         | element `positions` |
| `material`                               | appearance `material` (vanilla); custom-item syntaxes → flag |
| `display_name`                           | appearance `title` (literal MiniMessage) |
| `lore`                                   | appearance `lore[]` |
| `amount`                                 | appearance `count` |
| `priority` (items sharing a slot)        | order the `states` (first match wins), display last |
| `[player]` / `[commandevent]`            | `run_command` (`as: "player"`) |
| `[console]`                              | `run_command` (`as: "console"`) |
| `[message]` / `[minimessage]`            | `send_message` (`text`) |
| `[openguimenu] <id>`                     | `open_menu` (`menu_id`) — only if that menu exists in the pack |
| `[close]`                                | `close_menu` |
| `[takemoney]`                            | `take_money` (`amount`) |
| `[givemoney]`                            | `give_money` (`amount`) |
| `[giveexp]`                              | `give_xp` (`amount`) — an `L` suffix (levels) maps to `give_level` |
| `[broadcast]` / `[minibroadcast]`        | `broadcast` (`text`) — convert `&`-codes; minibroadcast is already MiniMessage |
| `[sound]`                                | `play_sound` (`sound`, `volume?`, `pitch?`) |
| `[connect]`/`[chat]`/`[refresh]`/`[json]`/`[meta]`/`[takeexp]`/`[broadcastsound*]`/permission tags | **no clean equivalent in the importable subset** → flag in chat; record in `notes` |
| requirement `has permission`             | `has_permission` (`perm`) |
| requirement `has money`                  | `has_money` (`amount`) |
| requirement `string equals`              | `placeholder_equals` (`placeholder` = `input`, `value` = `output`) |
| requirement `regex matches`              | `placeholder_match` (`placeholder` = `input`, `regex`) |
| requirement `has item`                   | `has_item` (`material`, `count`) — custom-item syntaxes → flag |
| requirement `has exp`                    | `has_xp` (`amount`) or, with `level: true`, `has_level` (`level`) |
| requirement `javascript`                 | **no importable equivalent** (the `expression` DSL is not in the subset yet) → flag in chat; record in `notes` |
| requirement comparators / `is near` / `has meta` | **no importable equivalent** → flag in chat; record in `notes` |
| `view_requirement`                       | appearance `if: [Condition[]]` |
| `*_click_requirement`                    | an `if` **step** at the top of that click's `steps` |
| `minimum_requirements` (= "any")         | wrap conditions in an `or`; otherwise default AND |

### Not-clean cases — flag, don't fabricate

- `open_command` and any other command registration — `menu/v1` has no command concept; note it.
- Action tags with no importable equivalent (`[connect]`, `[chat]`, `[refresh]`, `[json]`,
  `[meta]`, `[takeexp]`, `[broadcastsound*]`, permission tags) → say so; offer to drop or
  approximate with `run_command`, and record it.
- Custom-item materials (ItemsAdder/Oraxen/MMOItems/`head-...`) → `menu/v1` `material` expects a
  vanilla material; flag and either approximate with a vanilla look or leave a `notes` marker.
- `javascript` / comparator / `is near` / `has meta` requirements → no importable equivalent
  yet; flag rather than guess (a `placeholder_equals`/`placeholder_match` rewrite is fine
  when the intent is clearly a simple placeholder comparison).
- If a detail (exact tag behavior, requirement field) is uncertain after reading the dropped
  file, **ask or flag** — do not fabricate keys.
