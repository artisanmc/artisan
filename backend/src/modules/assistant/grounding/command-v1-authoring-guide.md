# Authoring Artisan `command/v1`

You author server commands in Artisan's canonical `command/v1` format and write them **only via
the `upsert_command` tool**. A command is a first-order entity (peer of menus): it runs a sequence
of steps when a player types `/<name>` and can take typed positional arguments. The argument to
`upsert_command` is one complete `command/v1` object; every upsert is validated (JSON-Schema +
vocab), and on failure you get the errors back — fix and retry. Emit **only** the action/condition
vocabulary listed in the VOCAB block; anything else is rejected.

## Top-level structure

```json
{
  "schema": "command/v1",
  "id": "pay",
  "name": "pay",
  "aliases": ["transfer"],
  "permission": "artisan.cmd.pay",
  "description": "Send money to another player.",
  "arguments": [ /* typed positional args */ ],
  "requirements": [ /* Condition[] (structured) checked before running */ ],
  "steps": [ /* structured Step[] — same wire as menu click handlers */ ],
  "fallback": [ /* Step[] run if requirements fail */ ],
  "cooldown": { /* optional */ }
}
```

Required: `schema` (always the literal `"command/v1"`), `id`, `name`, `steps` (≥1).

- **`id`** — stable workspace slug, `^[a-z][a-z0-9_]{0,63}$`. Used for internal references.
- **`name`** — the in-game command name typed after the slash, no slash, `^[a-z][a-z0-9_-]{0,31}$`.
  Must be unique on the server (Artisan detects conflicts with existing commands).
- **`steps`** — the sequence executed when the command runs.

Optional: `aliases`, `permission`, `description`, `arguments`, `requirements`, `fallback`,
`cooldown`, `notes` (internal admin notes, never shown to players).

## Steps — structured (identical wire to menu click handlers)

`steps` is an **array of structured steps** — the exact same wire as menu click handlers (see the
**Action reference** in the `menu/v1` guide). An action is `{ "<verb>": args }`; an if block is
`{ "if": [<conditions>], "do": [<steps>], "else": [<steps>] }`:

```json
"steps": [
  {
    "if": [{ "has_permission": "artisan.vip" }],
    "do": [
      { "give_item": { "material": "DIAMOND", "count": 1 } },
      { "send_message": "<green>Here's your VIP reward.</green>" }
    ],
    "else": [{ "send_message": "<red>VIP only.</red>" }]
  }
]
```

- Text is a literal string (may hold `%papi%` / `{placeholders}`) or `"{i18n:key}"`.
  `run_command` is `{ "run_command": { "command": "…", "as": "console" } }`.
- The allowed verbs and conditions are exactly the VOCAB subset (`run_command`, `send_message`,
  `take_money`, `give_item`, `open_menu`, `open_dialog`, …; conditions `has_money`,
  `has_permission`, `placeholder_equals`, …). Anything outside it — an unknown verb, `run_actions`,
  or a free comparison like `balance >= 100` — is rejected.

## Optional fields

- **`aliases`** — `string[]` (each `^[a-z][a-z0-9_-]{0,31}$`); all point to the same command.
- **`permission`** — required to execute. Omit to allow everyone (subject to `requirements`).
- **`description`** — player-visible help line, ≤256 chars.
- **`requirements`** — `Condition[]` (keyed, e.g. `{ "has_money": 1 }`), **ANDed**, evaluated
  before the command runs. If any fails, `fallback` runs instead of `steps`.
- **`fallback`** — a structured `Step[]`, run when requirements fail — typically a
  `{ "send_message": "…" }` explaining why.
- **`cooldown`** — `{ "id", "duration_seconds", "scope"?: "player" | "server", "message"? }`.
  `scope` defaults to `"player"`. `message` is shown while the cooldown is active (literal
  MiniMessage or an `{i18n:key}` you were told exists).

### Arguments — typed positional args

```json
{ "name": "target", "type": "online_player", "required": true,
  "description": "Who to send money to." }
```

- **`name`** — `^[a-z][a-z0-9_]{0,31}$`. Exposed as a placeholder (see below).
- **`type`** — one of `player`, `online_player`, `string`, `integer`, `number`, `boolean`,
  `world`, `enum`. `player` resolves online or offline (via UUID); `online_player` requires a
  currently-connected target. `enum` needs a `values: string[]` list. Note: the editor currently
  imports `world` and `enum` as plain `string`.
- **`required`** — defaults `true`. Optional args (`false`) must come **after** all required args.
- **`default`** — value used when an optional arg is omitted (may contain placeholders, e.g.
  `"%player_name%"` to default to the caller).

### Argument placeholders

Resolved argument values are available inside any text/command string as `%args_<name>%` (and also
as `{name}` per the runtime). Example — given an arg named `amount`, one DSL step line:

```
send_message "<green>Sent %args_amount% coins.</green>"
```

## Worked example — a `pay` command

```json
{
  "schema": "command/v1",
  "id": "pay",
  "name": "pay",
  "permission": "artisan.cmd.pay",
  "description": "Send money to another player.",
  "arguments": [
    { "name": "target", "type": "online_player", "required": true,
      "description": "Who to send money to." },
    { "name": "amount", "type": "integer", "required": true,
      "description": "Amount in coins." }
  ],
  "requirements": [{ "has_money": 1 }],
  "steps": [
    { "take_money": 1 },
    { "run_command": { "command": "eco give %args_target% %args_amount%", "as": "console" } },
    { "send_message": "<green>You sent %args_amount% coins to %args_target%.</green>" },
    { "play_sound": "ENTITY_EXPERIENCE_ORB_PICKUP" }
  ],
  "fallback": [{ "send_message": "<red>You don't have enough money.</red>" }],
  "cooldown": { "id": "pay_cmd", "duration_seconds": 5, "scope": "player" }
}
```

## Tools and text rules

- **Always** create or replace a command through the **`upsert_command`** tool. List existing
  commands with **`list_commands`**, fetch one with **`get_command`**, remove one with
  **`delete_command`**.
- **Never invent i18n keys.** Emit literal MiniMessage / PAPI text; the system allocates keys on
  import. Preserve PAPI placeholders (`%player_name%`, `%args_target%`, …) verbatim.
