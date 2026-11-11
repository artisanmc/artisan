# Artisan — Trigger schema v1

A **Trigger** (`triggers/<id>.yml`) binds a **Game event** to an Action chain: "when a player
dies, send them their position". Decision: ADR `triggers-and-variables`.

## Files

| File | Role |
|---|---|
| `schema.json` | JSON Schema (Draft 2020-12), source of truth |
| `examples/death-coordinates.json` | Event context in a message, `keep_level` effect, `not` condition. |
| `examples/spawn-protection.json` | `cancel_event` filtered by two conditions, per-player delay. |
| `examples/welcome.json` | `set_event` in both branches of an `if`, translated texts, `{player.last_seen.ago()}`. |

## Model

```
Trigger
 ├── on                 ← name of a declared Game event (core or module catalog)
 ├── if : Condition[]   ← AND, evaluated with {event.…}
 ├── cooldown_seconds   ← per player, kept in the database (survives restarts)
 ├── enabled
 └── do : Step[]        ← chain run inline during the event
```

Game events and their typed context are declared on the plugin side (`api.getGameEvents()`) and announced
to the Presence (`declared_game_events`). The core catalog is also in
`testdata/core-game-events.json`, generated from `CoreGameEvents.kt`.

## Effects

Two actions only make sense in a Trigger's chain:

- `cancel_event` cancels the event, if it is cancellable. Nothing un-cancels it.
- `set_event: { <effect>: value }` writes an effect that the event declares (`join_message`,
  `keep_inventory`, `damage`…), with the value resolved by template and converted to the declared type.
  A text is an LText like any text shown to the player (`{i18n:key}` or `{fr: …, en: …}`):
  a join, quit or death message is sent to each player in their language.

Elsewhere (a menu, a command), they warn and do nothing.
