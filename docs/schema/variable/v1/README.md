# Artisan — Variable schema v1

A **Variable** (`variables/<id>.yml`) is a named, typed value that chains write and that conditions
and texts read: "where the player last died", "the current season". Decision: ADR
`triggers-and-variables` §5.

## Files

| File | Role |
|---|---|
| `schema.json` | JSON Schema (Draft 2020-12), source of truth |
| `examples/last-death.json` | A player's place, forgotten 10 minutes after it was written. |
| `examples/season.json` | A value shared by the whole network, with a default. |

## Model

```
Variable
 ├── scope            ← player (default) | server
 ├── type             ← string | number | boolean | location
 ├── default          ← read while nothing is stored (has_var stays false)
 └── expires_seconds  ← lifetime after the last write; 0: never
```

## Reading and writing

| Where | Form |
|---|---|
| Text | `{var.last_death}`, `{var.last_death.x}`, another project's: `{var["rpg/last_death"]}` |
| Condition | `has_var: last_death` (a value is stored), `expression: var.coins >= 10`, `expression: var.vip` (a boolean) |
| Action | `set_var: {var: last_death, value: "{event.location}"}`, `add_var: {var: coins, amount: 5}`, `clear_var: last_death` |
| Argument | any typed argument takes it as a template: `teleport: "{var.last_death}"` |
| PlaceholderAPI | `%artisan_var_last_death%` (`%artisan_var_rpg/last_death%` when two projects use the id) |

Modules declare their own, read-only Variables in code (`api.getVariables()`, §10): they read as
`{var.<module>.<name>}` and take no `set_var`. A Project variable named like a module hides that
module's Variables in its project.

## Storage

Values live in memory and in the suite database (`artisan_vars`): a player's are read when they
join, the server-wide ones every 30 seconds, so a network shares both. Without a database they are
kept in memory only and lost at restart.

`{var.<id>}` is computed for the player of the chain: a `server` Variable reads the same for all.
