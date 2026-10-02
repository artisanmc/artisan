# Authoring Artisan `dialog/v1`

You author Paper 1.21+ dialogs in Artisan's canonical `dialog/v1` format and write them **only via
the `upsert_dialog` tool**. A dialog is a screen with body content, optional input fields, and a row
of buttons; players reach it when a menu or command runs the `open_dialog` action. The argument to
`upsert_dialog` is one complete `dialog/v1` object; every upsert is validated, and on failure you
get the errors back — fix and retry. Emit **only** the action vocabulary in the VOCAB block.

## Top-level structure

```json
{
  "schema": "dialog/v1",
  "id": "confirm_buy",
  "title": "<gold>Confirm purchase</gold>",
  "can_close_with_escape": false,
  "body": [ /* DialogBody[] */ ],
  "inputs": [ /* DialogInput[] */ ],
  "buttons": [ /* DialogButton[] */ ]
}
```

Required: `schema` (always the literal `"dialog/v1"`), `id`, `title`, `buttons`.

- **`id`** — stable slug, `^[a-z][a-z0-9_]{0,63}$`. Referenced by `open_dialog.dialog_id`.
- **`title`** — literal MiniMessage, or `{i18n:key}` only if you were told the key exists.
- **`can_close_with_escape`** — defaults `true`; **only set it when `false`** (player can't dismiss
  with Escape).

## `body[]` — content blocks shown above the inputs/buttons

Two block shapes:

```json
{ "type": "text", "text": "<gray>Are you sure?</gray>" }
{ "type": "item", "material": "DIAMOND", "count": 1 }
```

- `text` — literal MiniMessage / PAPI (or `{i18n:key}`).
- `item` — `material` (UPPER_SNAKE) + optional `count` (1–64, default 1).

## `inputs[]` — optional fields

Each input has `id` (`^[a-z][a-z0-9_]{0,63}$`), `type`, and `label`. The four types:

```json
{ "id": "note",   "type": "text",         "label": "Note",     "default": "", "max_length": 64 }
{ "id": "agree",  "type": "bool",         "label": "I agree",  "default": "false" }
{ "id": "amount", "type": "number_range", "label": "Amount",   "min": 1, "max": 100, "default": "10" }
{ "id": "size",   "type": "single_option","label": "Size",
  "options": [ { "value": "s", "label": "Small" }, { "value": "l", "label": "Large" } ],
  "default": "s" }
```

- `bool` `default` is the string `"true"` or `"false"`.
- `number_range` carries `min`/`max`; `default` is a string.
- `single_option` needs `options: [{ value, label }, …]`.

Input values are exposed as **context args** to the button actions (referenced like other context
args in texts/commands).

## `buttons[]` — the action row

```json
{ "id": "yes", "label": "<green>Confirm</green>",
  "actions": [
    { "take_money": 100 },
    { "send_message": "<green>Purchased!</green>" }
  ] }
```

- `id` (`^[a-z][a-z0-9_]{0,63}$`), `label`, and `actions`.
- **`actions` is a structured `Step[]`** — the same wire as menu click handlers / command bodies
  (`if` / `else` branches allowed). See the **Action reference** in the `menu/v1` guide. Use only
  the allowed action/condition subset from VOCAB; text is a literal string or `"{i18n:key}"`.

## Cross-reference — opening a dialog

A menu or command opens this dialog with the `open_dialog` action referencing the dialog `id`:

```json
{ "open_dialog": "confirm_buy" }
```

Discover existing dialog ids with **`list_dialogs`** before referencing one.

## Worked example — a confirmation dialog

```json
{
  "schema": "dialog/v1",
  "id": "confirm_buy",
  "title": "<gold>Confirm purchase</gold>",
  "can_close_with_escape": false,
  "body": [
    { "type": "text", "text": "<gray>Buy this item for <yellow>100</yellow> coins?</gray>" },
    { "type": "item", "material": "DIAMOND", "count": 1 }
  ],
  "buttons": [
    { "id": "yes", "label": "<green>Confirm</green>",
      "actions": [
        {
          "if": [{ "has_money": 100 }],
          "do": [
            { "take_money": 100 },
            { "give_item": { "material": "DIAMOND", "count": 1 } },
            { "send_message": "<green>You bought a diamond!</green>" }
          ],
          "else": [{ "send_message": "<red>Not enough money.</red>" }]
        }
      ] },
    { "id": "no", "label": "<red>Cancel</red>",
      "actions": ["close_dialog"] }
  ]
}
```

## Tools and text rules

- **Always** create or replace a dialog through the **`upsert_dialog`** tool. Fetch one with
  **`get_dialog`**, remove one with **`delete_dialog`**, list with **`list_dialogs`**.
- **Never invent i18n keys.** Emit literal MiniMessage / PAPI text; preserve PAPI placeholders
  verbatim.
