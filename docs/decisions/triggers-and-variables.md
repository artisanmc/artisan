# Triggers and variables — reacting to game events, remembering values

**Status:** accepted (2026-10-24). Batches 3 (registry, Trigger kind, core catalog, effects) and 5
(editor) delivered first, at Iban's request; batches 1, 2 and 4 (`location` type, Variables,
`chat_button`) remain to be done. Deviations of the implementation, see "Implementation" at the end.

**Naming (Iban, 2026-10-24)**: the kind is called **Trigger** (not "Automation"). The event it
listens to is therefore called **Game event**, so as not to say "trigger" twice. This is consistent
with `extensible-document-kinds` (decision 8), where a trigger is an entry-point chain slot: a
Trigger is the Document whose only slot is that entry point. `api.events` (`ModuleEventBus`)
remains the bus for events between modules, distinct from Game events.

## Context

An **Action chain** today only runs on four triggers: the click on an **Element**, the invocation
of a **Command**, a **Dialog** button and `run_actions` on an `actions` field of a **Data source**.
All come from a player gesture in an Artisan interface. The engine can neither react to what
happens in the game (a death, a login), nor remember a value beyond a menu session (`set_arg`) or
a cooldown.

Reference request (Iban, 2026-10-24): *when a player dies, save their position, send them a message
with that position and a button to teleport there for a sum of money.* Broken down on `v2`:

| Need | State on `v2` |
|---|---|
| React to death | absent: no event trigger |
| Save the position | absent: no persistent per-player value |
| Message with the position | present (`send_message`, MiniMessage, templates), as soon as an event context exists |
| Clickable button in chat | partial: `<click:run_command:…>` works, but the command is public, typeable and reusable |
| Pay | present (`has_money`, `take_money`) |
| Teleport to the saved position | partial: `teleport` reads `x/y/z` as numbers (`Args.double` casts a `Number`), a `"{var.x}"` template becomes **0 without warning** |

It is also the prerequisite for AI content generation (study of 2026-10-24): an AI cannot produce
what the vocabulary cannot express, and it must not work around it with `run_command` or code.

The foundations exist: `DocumentKindRegistry` and the **chain slots** on the editor side
(`extensible-document-kinds`, decisions 1 and 8, W5/W6), `ActionRegistry` (batch 3),
`ModuleActionsApi.run`, the suite's database (`suite-foundation-database`) and the model of
`CooldownSync` (memory first, a single writer, re-read at login).

## Decision

### 1. A **Trigger** kind: one event, one chain

A **Trigger** is a Document (`triggers/<id>.yml`, `schema: trigger/v1`) that associates a
**Game event** with an Action chain. It is declared by a core module `triggers` through
`DocumentKindRegistry`, like menus, commands and dialogs.

```yaml
schema: trigger/v1
on: player_death            # name of a declared event (§2)
if:                         # optional: same conditions as a chain `if:`, implicit AND
  - not: { world_is: arene }
cooldown: 30s               # optional: per player, same store as `cooldown_passed`
enabled: true               # optional, true by default
do:
  - send_message: "Mort en {event.location.x} {event.location.y} {event.location.z}"
```

- On the editor side, `do` is the kind's **chain slot** (`chainSlots`), so the trigger becomes a
  source node on the board and edges leave from the `document_ref` arguments with no dedicated
  code.
- On the plugin side, the `triggers` module listens to events, filters (`if`, `cooldown`,
  `enabled`) with `ConditionsApi`, then runs `do` through the action runtime, with the event's
  context bound under `event` (§3).
- Several Triggers can listen to the same event; they run in alphabetical order of their
  qualified id, and the failure of one does not prevent the others.

### 2. Game events are **declared**, like actions

A Game event is a declaration `GameEventDeclaration(name, context: ModelField[])` (`@Beta`) in a
new registry `api.getGameEvents()`, with the same ownership semantics as `ActionRegistry`: bare
core name (`player_death`), namespaced module name (`quests:completed`, `guilds:joined`),
collision = error at registration, removed with the module. A module **fires** its event with
`api.getGameEvents().fire(name, player, context)`. Presence reports `declared_game_events` (hello,
`modules_changed`), like `declared_actions`; the editor derives from it the `on:` selector and the
form of the available context.

A Bukkit event enters the catalog through a **one-line declaration**, on the core side
(indicative form, the API is fixed in batch 3):

```kotlin
gameEvent<PlayerDeathEvent>("player_death", Frequency.RARE,
    player = { it.player },
    context = { location(it.player.location); text("cause", it.damageSource.damageType.key); player("killer", it.player.killer) },
    effects = { message("death_message", it::deathMessage); bool("keep_inventory", it::setKeepInventory) })
```

**Admission rules**, checked by a test over the whole catalog:

1. the event is **synchronous** and fired on the thread that owns the player (main on Paper, the
   player's region on Folia); an asynchronous event is refused;
2. it concerns **a player**, which the declaration knows how to extract;
3. it is **discrete**: class `RARE` (login, death) or `NORMAL` (a click, a broken block). Class
   `HIGH` (movement, block physics, chunk loading, every tick) is refused;
4. its context and its effects (§3 bis) are **named and typed** in the declaration, never read by
   reflection;
5. it exists on Paper and Spigot, or the declaration says on which platform it is missing (the
   editor then greys it out).

Core catalog of the first batch, for information (the admission test is authoritative):

| Domain | Events | Declared effects |
|---|---|---|
| Connection | `player_join`, `player_first_join`, `player_quit`, `player_kick` | join message, quit message, kick reason; cancel the kick |
| Life | `player_death`, `player_respawn`, `player_damage`, `player_food_change` | death message, keep inventory and levels, clear drops, dropped xp; respawn point; cancel damage, hunger |
| World | `player_change_world`, `player_teleport`, `player_portal`, `player_bed_enter`, `player_gamemode_change`, `player_toggle_flight` | cancel (except world change) |
| Blocks | `block_break`, `block_place`, `player_interact`, `player_interact_entity` | cancel; xp and drops of the broken block |
| Items | `player_drop_item`, `player_pickup_item`, `player_consume_item`, `player_fish`, `craft_item`, `enchant_item`, `player_item_break` | cancel (except broken item) |
| Combat | `player_kill_entity`, `player_kill_player` | dropped xp, clear drops |
| Progression | `player_level_change`, `player_advancement_done` | — |
| Commands | `player_command` | cancel |

Chat (`AsyncChatEvent`) is asynchronous: outside the v1 catalog (Q5).

Rejected: **exposing all Bukkit events by reflection**. About 300 events, some of which fire
thousands of times per second (`PlayerMoveEvent`, `BlockPhysicsEvent`), others asynchronous
(calling the Bukkit API there breaks the server, Folia adds its regions), many without a player; a
context read by reflection is not typed (neither the editor nor an AI knows which fields exist)
and a Paper rename silently breaks configs. The one-line declaration keeps the cost of adding an
event to a few minutes.

### 3. The event context is a typed, read-only binding

The context is bound like a template binding under `event` (`{event.location.x}`,
`{event.cause}`), in the same way as a Command's arguments. It is typed by the declaration
(`ModelField[]`), which lets the editor offer the fields and flag a reference to a nonexistent
field. `{event.cancelled}` is always bound for a cancellable event.

### 3 bis. Declared effects: cancel, modify a field

An event declares its **effects**: the only things a chain may change on it. Two actions, valid
only in the chain of a Trigger whose event declares the effect:

```yaml
on: player_join
do:
  - set_event: { join_message: "<gold>{player} rejoint le royaume" }

on: block_break
if: [ { world_is: spawn }, { not: { has_permission: build.spawn } } ]
do:
  - cancel_event
  - send_message: "<red>Tu ne peux pas casser ici."
```

- `cancel_event` sets the event to cancelled; `set_event: { <effect>: value }` writes a declared
  effect, with the value typed and resolved by template (§6).
- **We never uncancel.** Artisan listeners run at priority `HIGH` with `ignoreCancelled = true`:
  an event already cancelled by a protection (WorldGuard, GriefPrevention, a claims plugin)
  triggers no Trigger, and no effect puts `cancelled` back to false. A Trigger therefore cannot
  bypass a protection.
- Effects apply **during** the event's processing: the chain runs inline in the listener (§8). In
  a deferred chain (`do` of a `chat_button`), `cancel_event` and `set_event` no longer have an
  event to modify: the editor refuses them there, the plugin ignores them with a warning.
- Several Triggers on the same event apply in the order of §1; for the same effect, the last write
  wins. A plugin at priority `HIGHEST` or `MONITOR` (EssentialsX for join messages, depending on
  its config) runs after Artisan: this is documented, not worked around.
- No generic setter nor modification by reflection: an effect absent from the declaration does not
  exist.

### 4. A new field type `location`

`ModelFieldType.location()`: `{ world, x, y, z, yaw?, pitch? }`. It serves the context
(`event.location`), variables (§5) and `teleport`, which gains a primary argument `location`. The
arguments `world/x/y/z/yaw/pitch` are still read (wire compatibility); the editor writes
`location`. The scalar form `teleport: "{var.derniere_mort}"` is therefore valid.

### 5. Variables: declared, typed, persistent

A **Variable** is a Document (`variables/<id>.yml`, `schema: variable/v1`) that declares a named
value:

```yaml
schema: variable/v1
scope: player          # player | server
type: location         # string | number | boolean | location
default: null          # optional
expires: 10m           # optional: lifetime after the last write
```

- **Declared rather than implicit**: a typo in a name is a dead reference detected by the editor,
  renaming repoints the usages, and the board draws the variable as a node linked to its writers
  and readers (`document_ref` edges).
- **Actions** (core module `variables`): `set_var { var, value }`, `add_var { var, amount }`
  (`number` type only), `clear_var: <var>`. The `var` argument is a `document_ref(variable)`.
- **Reading**: binding `{var.<id>}` in templates and `expression`s, resolved lazily. Condition
  `has_var: <var>` (value present and not expired). `artisan_var` placeholder namespace exposed to
  PlaceholderAPI for scoreboards.
- **Storage**: table `artisan_vars` of the suite's database (`scope`, `owner` = UUID or `server`,
  `name` = qualified ref `project/id`, `value` JSON, `expires_at`). Same access scheme as
  `CooldownSync`: memory decides, the write goes to the single writer, a player's values are read
  at login. Without a database, memory only (lost at restart, warning at startup). A network
  therefore shares player variables.
- A value that no longer matches the declared type (type changed in the editor) is read as absent
  and reported once in the logs, never silently converted.

### 6. Arguments resolved by template, explicit failure

Every typed argument (`number`, `integer`, `boolean`, `location`) accepts a template string.
`ActionDeclaration.bind` resolves it then converts it **before** the handler. A value that is
unresolved or not convertible **skips the action** with a warning naming the action, the argument
and the Document. A silent fallback to the default value (the case of `teleport` today) is no
longer allowed. Handlers keep receiving already-typed values.

### 7. `chat_button`: a single-use click, bound to the player

```yaml
- chat_button:
    text: "<gray>Mort en {event.location.x} {event.location.y} {event.location.z}."
    label: "<gold>[Y retourner : 100 $]"
    uses: 1          # default 1
    expires: 10m     # default 5m
    do:
      - if: [ { has_var: derniere_mort }, { has_money: 100 } ]
        do:
          - take_money: 100
          - teleport: "{var.derniere_mort}"
          - clear_var: derniere_mort
        else:
          - send_message: "<red>Il te faut 100 $."
```

The button carries a random token, bound to the player, consumed by an internal command
(`/artisan:click <token>`, no permission, invisible to completion). A token that is unknown,
expired, exhausted or presented by another player does nothing. Tokens live in memory and
disappear at restart. The `do` chain runs with the bindings of the moment the button was sent
(`event` included).

Rejected: Adventure's `ClickEvent.callback`, which does the same thing but does not exist on
Spigot, a still-supported target; the token works everywhere and is testable without a server.

### 8. Execution: thread, reentrancy, budget

- A Trigger chain runs **inline in the listener**, on the thread that fires the event; admission
  rule 1 guarantees it is the one that owns the player (main on Paper, the player's region on
  Folia and Leaf). This is what allows effects (§3 bis). `player_quit` runs before the player is
  removed.
- **Bounded reentrancy**: a chain can cause another event (`teleport` can cause
  `player_change_world`). Beyond 4 levels of nested Triggers for the same player, the next firing
  is ignored with a warning.
- **Budget**: at most 1,000 actions per Trigger chain execution, `run_actions` included. Beyond
  that, the chain stops with a warning.

### 9. The boundary: what we refuse to add

The vocabulary stays a language of **rules**, without loops and with guaranteed termination. The
following are excluded from this work, and from any work that does not reopen this ADR:

- loops (`for`, `while`, repetition) and admin-defined functions beyond `run_actions`;
- continuous or high-frequency events (class `HIGH`: movement, every tick, block physics) and
  asynchronous events;
- outgoing network calls from a chain;
- any modification of an event outside its declared effects, and uncancelling.

A need beyond this boundary is written as a module (Kotlin or Java) that declares its own actions
and events (§2). A recurring need that fits within the boundary joins the core catalog.

## Consequences

- **CONTEXT.md**: terms **Trigger**, **Game event** and **Variable** added; the **Action chain**
  entry lists the Trigger among its triggers once the kind is delivered.
- **API**: `GameEventDeclaration`, `GameEventRegistry`, `ModelFieldType.location()`, all `@Beta`.
  Minor API version; additive Presence field, protocol unchanged.
- **Schemas**: `trigger/v1` and `variable/v1` in `docs/schema/`, `$defs.Action` gains `set_var`,
  `add_var`, `clear_var`, `chat_button`, `cancel_event`, `set_event` and the `location` argument
  of `teleport`.
- **Database**: a migration creates `artisan_vars`; forward-only like the others
  (`docs/architecture/versioning.md`).
- **Transition**: no existing data changes. The only behavior change is §6: a `teleport` with an
  argument that does not resolve no longer teleports to 0,0,0, it does nothing and writes it in
  the logs.
- **AI assistant**: when it comes back in `v2`, it gains `upsert_trigger` and `upsert_variable`;
  this work does not depend on it.
- **Acceptance test**: the reference request, written by hand in the form above (a `player_death`
  Trigger, a `derniere_mort` Variable), works in game on Paper and on Folia, including after a
  server restart during the variable's validity period (the button, however, is lost: expected).

## Order of batches

1. `location` type and resolution of arguments by template (§4, §6), with the extended
   `action-wire-conformance.json` vector. Useful alone: fixes `teleport`.
2. Variable kind, actions and storage (§5).
3. Event registry, Trigger kind, core catalog with its admission test, effects (§1 to §3 bis, §8).
4. `chat_button` (§7).
5. Editor: forms, event selector, board nodes, offered context fields.

## Open questions

| # | Question | Recommendation |
|---|---|---|
| Q1 | Stored identity of a variable: qualified ref `project/id` (renaming the Project loses the values) or a stable id generated at creation? | Qualified ref in v1, like the rest of the refs; a Project rename is rare and the editor can warn. |
| Q2 | Triggers without a player (`server_start`, scheduled): `ActionContext.getPlayer()` is never null today. | Out of v1. Reopening them requires a player-less context and a list of actions that support it. |
| Q3 | A `wait` action (bounded delay before the rest of the chain)? | Out of v1: it breaks synchronous execution and raises the question of the player disconnecting during the wait. |
| Q4 | `NORMAL` events in farms and mining (`player_kill_entity`, `block_break`): high volume. | Keep; the editor advises an `if` or a `cooldown` on these events; measure before adding a global cap. |
| Q5 | Chat, asynchronous, is one of the most likely requests (filtering, reformatting). | Out of v1. Reopen it with a sub-vocabulary without Bukkit API calls (text, conditions on already-read values, cancellation), run off the main thread. |

## Implementation (batches 3 and 5, 2026-10-24)

What differs from the text above, and why:

- **`cooldown_seconds: 30`** (an integer) instead of `cooldown: 30s`: no duration parser to
  maintain on both sides for a single field. The delay goes through `api.cooldowns`, the store of
  menu and command cooldowns (id `triggers:<project>/<id>`): kept in `artisan_cooldowns`, it
  survives restart and follows the player across the network.
- **Budget of 1,000 actions** (§8): deferred. Reentrancy is bounded (4 levels, one warning per
  event); the budget needs a counter in the action engine, a separate batch.
- **`set_event` texts**: translatable like any text displayed to the player (LText, address
  `…do.set_event.<effect>`). A message that Bukkit would send as one block to everyone (login,
  quit, death) is replaced by a per-player send, each in their language, the console in the
  project's default language (`EffectText`, `ActionRuntime.textFor`). `broadcast` follows the same
  rule.
- **Catalog**: 29 core Game events in v1 (`CoreGameEvents.kt`), vector
  `testdata/core-game-events.json` shared with the editor, which embeds it so the selector works
  without a server.
- **Editor**: `cancel_event` / `set_event` are only offered in a Trigger's chain, under "This
  event", based on the chosen event; never in the generic action list.
