# Structured action wire — reference

Source of truth for the action chain format (menus, commands, dialogs, data
sources). ADR: `docs/decisions/structured-action-wire.md`. The format is a YAML
**keyed by name**; the action DSL no longer exists (legacy reading is tolerated
during the migration).

## Action — a single-key map

The action name is the key. The number of arguments decides the form:

| Case | Form | Example |
|---|---|---|
| 1 argument | the value IS the argument | `send_message: "Bienvenue !"` |
| 0 arguments | bare string (canonical) | `- close_menu` |
| 0 arguments (also read) | null value | `- close_menu:` |
| several arguments | a map | `show_title: { title: "VIP", subtitle: "§7…" }` |

```yaml
click:
  left:
    - send_message: "Bienvenue !"                       # 1 arg
    - give_money: 100                                   # 1 arg, number
    - run_command: "say hi"                             # 1 arg (as: player by default)
    - run_command: { command: "op", as: console }       # 2 args
    - open_menu: shop_category                           # 1 arg
    - open_menu: { menu_id: shop, context: { cat: "{cat.id}" } }
    - close_menu                                        # 0 args
    - close_dialog
    - open_previous_menu                                # 0 args — back button
```

### `open_previous_menu` — back button

Reopens the previous screen from the player's navigation history (menu **or**
dialog). It is a **LIFO stack**: opening a screen (`open_menu` /
`open_dialog`) pushes the screen being left, and `open_previous_menu` **pops** it without
pushing the current screen back. The stack therefore shrinks on each back — `menu → wiki →
item` needs two backs to return to the menu, with no `item ↔ wiki` ping-pong.
Empty stack = no-op. An `open_menu` / `open_dialog` that reopens the screen just before
(same id and project, args ignored) counts as a back: it pops instead of
pushing, so a back button wired as `open_menu parent` does not loop.
Related placeholders: `{has_previous_menu}` (boolean, to
condition the button) and `{previous_menu.id}` / `.title`.

### Action text — field-local

An action text is a `LocalizedText`, **exactly like a structural
text**: a string (the `defaultLang` value) or a map
`{ <lang>: text }`.

```yaml
- send_message: { en: "Welcome!", fr: "Bienvenue !" }
- show_title:
    title: { en: "VIP", fr: "VIP" }
    subtitle: "§7Welcome"
    stay: 40
```

An `{i18n:key}` remains a possible value (shared key); the `{player}`,
`%papi%` templates and MiniMessage remain (braces reserved).

## Condition — a single-key map

`if:` carries a **list = implicit AND**. `or:` / `and:` take a list,
`not:` a condition. `else if` = an `if` **at the head of the `else`**.
The editor's flat `joins` are encoded left to right, without precedence
(historical plugin semantics): `A and B or C` → `or: [and: [A, B], C]`,
`A or B and C` → `[or: [A, B], C]` (`conditionsToStructured`).

```yaml
- if:
    - has_permission: shop.vip
    - or:
        - world_is: world_nether
        - time_is: night
  do:
    - send_message: { en: "Access granted", fr: "Accès accordé" }
  else:
    - send_message: { en: "You need VIP.", fr: "Il faut être VIP." }
```

Scalar vs map conditions:

```yaml
- has_permission: shop.use                 # 1 arg
- random_chance: 0.1                       # 1 arg
- world_is: world_nether                   # 1 arg
- has_item: { material: DIAMOND, count: 3 } # 2 args
- placeholder_equals: { placeholder: "%rank%", value: "vip" }
- placeholder_match: { placeholder: "%server_type%", regex: "^premium" }
- time_is: night                           # scalar (or { from_ticks, to_ticks })
- not:
    world_is: world_nether
```

## Full example

```yaml
elements:
  - id: shop
    positions: 13
    material: PAPER
    title: { en: "Shop", fr: "Boutique" }
    click:
      left:
        - if:
            - has_permission: shop.vip
            - or:
                - placeholder_match: { placeholder: "%server_type%", regex: "^premium" }
                - world_is: world_nether
          do:
            - show_title: { title: { en: "VIP", fr: "VIP" }, subtitle: "§7Welcome" }
            - send_message: { en: "Access granted", fr: "Accès accordé" }
          else:
            - if:
                - random_chance: 0.1
              do:
                - open_dialog: lucky_draw
              else:
                - send_message: { en: "You need VIP.", fr: "Il faut être VIP." }
```

## Tolerant reading (migration)

A handler (`click.left`, `commands.actions`, `dialogs…actions`) can be:

- a **string** → old Action DSL (read as is, rewritten structured);
- a **map** → a single step;
- a **list** → steps; a string entry = action without arguments
  (`- close_menu`), equivalent to `- close_menu:`.

## Notes

- Combinator keywords: **`or` / `and` / `not`** (not `anyOf`/`oneOf`/`allOf` —
  `oneOf` would be an XOR, and those names are already the JSON Schema vocabulary
  that validates these files).
- The appearance/state `if`s share the same condition format (keyed
  type) — a single format everywhere.
