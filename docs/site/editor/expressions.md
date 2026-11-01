---
title: Expressions
description: Compose item names, lore and titles from your data — fields, conditions and list joins, with the same result in the preview and in game.
sidebar:
  order: 7
---

Every text you type in the editor — an item name, a lore line, a menu title, even a
material — is a **template**. Plain text renders as-is; anything inside `{…}` is an
**expression**, evaluated against the data in scope and replaced by its result.

```
Price: {item.price} coins
```

The editor's preview and your server render templates with the **same engine**: what
you see is what your players get.

## Segments

A template is made of four kinds of segment, which you can mix freely in one line.

| Segment | Example | What it does |
|---|---|---|
| Literal | `Welcome!` | Rendered as-is |
| Expression | `{item.price}` | Evaluated against the data in scope |
| Translation | `{i18n:shop.title}` | Looks up a key in your project's translations |
| Placeholder | `%player_name%` | Resolved by PlaceholderAPI on your server |

In compatible text fields, type `%` to see the placeholders explicitly listed by
your connected server's installed expansions. Keep typing to filter, then click
a suggestion or select it with the arrow keys and press Tab or Enter to insert it.
Suggestions refresh after a reload or reconnect and disappear while offline.
An expansion that does not list its placeholders contributes no suggestions;
you can still enter its placeholders manually. Suggestions do not evaluate player values.

## Reading your data

Inside `{…}`, start from a name that is in scope — a menu input, or the alias of the
row you are iterating over.

| Form | Example | Result |
|---|---|---|
| Name | `{player}` | The value bound to that name |
| Field | `{quest.name}` | One field of a row |
| Index | `{rewards[0]}` | One entry of a list |
| Field of an entry | `{rewards[0].name}` | Combine both |

:::note[When a name does not exist]
`{typo}` renders **as `{typo}`**, visibly, so you can spot the mistake in game.
A name that *does* exist but has no such field — `{quest.nope}` — renders empty
instead: a data source row is allowed to omit fields, that is not an error.
:::

## Lists

Data source rows often carry lists — a quest's rewards, a category's items. These
methods turn them into text.

| Method | Example | Result |
|---|---|---|
| `join(sep)` | `{tags.join(", ")}` | `pvp, rare` |
| `pluck(field)` | `{rewards.pluck("name")}` | The `name` of every entry, as a list |
| `length()` | `{rewards.length()}` | `3` |
| `first()` / `last()` | `{rewards.first().name}` | The first (or last) entry |
| `at(n)` | `{rewards.at(1).name}` | The entry at position `n`, starting at 0 |
| `contains(v)` | `{tags.contains("rare")}` | `true` or `false` |

`pluck` and `join` chain, which is how you turn a list of objects into a lore block:

```
{rewards.pluck("name").join("\n")}
```

Each reward name lands on its own lore line.

## Conditions

A ternary picks between two values. This is how one element shows a different icon,
name or lore depending on the player's state.

```
{quest.can_start ? "EMERALD" : "GRAY_DYE"}
{quest.status_key == "COMPLETED" ? "<green>Done" : "<gray>Locked"}
```

| Operator | Example |
|---|---|
| Compare | `==` `!=` `<` `<=` `>` `>=` |
| Combine | `&&` `||` `!` |
| Arithmetic | `+` `-` (no leading minus — write `0 - x`) |
| Choose | `condition ? a : b` |

Values are truthy except `null`, `false`, `0` and the empty string — so
`{rewards.length() ? "Rewards:" : "No reward"}` works without an explicit comparison.

### A lore line only some players see

A lore line whose expressions give nothing is left out, so each rule can sit on its own
line:

```
{member.can_promote ? "<yellow>Left click: promote" : ""}
{member.can_kick ? "<red>Shift + right click: kick" : ""}
```

A player who may not kick does not get an empty line in its place. A line you leave
empty on purpose (nothing typed on it) stays. In the rich editor, the **Library**
button builds these lines for you: pick *Show a text if…*, the variable, the text.
A variable missing from its list can be typed by hand (*Another variable…*), and
*Time since…* / *Time left before…* also take a fixed date.

:::caution[Arithmetic is limited on purpose]
Only `+` and `-`. There is no `*` or `/`, and `%` is reserved for PlaceholderAPI.
There is no leading minus either: write `{0 - price}`, not `{-price}`.
:::

### A module's state: `var`

An installed module can share part of its state as **module variables**, named
`var.<module>.<name>`: whether the player has a guild, their rank, a quest's status.
They read like any value, in a condition or a text:

```
var.guilds.has_guild
{var.guilds.rank}
var.quests.status["daily/miner"] == "completed"
```

In a condition list, **module variable** offers the ones your server declares: pick the
variable, then the comparison. A variable whose module is not installed reads as nothing
(the condition is false) and is struck through in the editor.

## Time

Time fields carry an exact instant — the moment a quest group resets, the moment an
offer ends. The template decides how it reads.

| Method | Example | Result |
|---|---|---|
| `until()` | `{group.period_end.until()}` | `3h 12m` — time left from now |
| `ago()` | `{player.last_seen.ago()}` | `3d 4h` — time elapsed since |
| `duration()` | `{player.playtime.duration()}` | `12h 30m` — a length of time, in milliseconds |

It shows the most significant unit plus the next one down when that one is not
zero: `2d 5h`, `3h 12m`, `5m 4s`, `45s`. Once the instant has passed it reads `0s`
rather than going negative.

The player carries three such values, kept for the whole network: `{player.first_seen}`
(their first visit), `{player.last_seen}` (the end of their previous visit, absent on the
first one) and `{player.playtime}` (time played, every server counted). A join message such
as `Welcome back {player}, last seen {player.last_seen.ago()} ago` reads `3d 4h ago`.

The units come from your project's translations, under the reserved `artisan.`
keys — add them to `lang/<code>.yml` to change or translate them:

```yaml
artisan:
  duration:
    days: "{n} days"
    hours: "{n} hours"
    minutes: "{n} min"
    seconds: "{n} s"
```

Without those keys you get the compact defaults (`3h 12m`).

:::note[Counters do not tick]
A menu is redrawn every time the player interacts with it, so a countdown is exact
each time it is drawn — but it does not count down while the player stands still
looking at the inventory.
:::

## When something goes wrong

Nothing here can break a menu. A malformed expression renders `⚠️` followed by the
reason, in place of that segment only; the rest of the line still shows. A material
that fails to resolve falls back to stone. Your server logs malformed expressions
once when it loads the project, naming the file — check there first.
