---
title: Statistics
description: What Artisan records about your server's menus, commands and players, how long it keeps it, and how to count your own events.
sidebar:
  order: 10
---

Artisan records what your content does: which menus are opened and clicked, which commands are
run, how long players stay. The records are written to [your database](../database/) and sent
nowhere else.

:::note
This version collects the statistics and serves them to the editor's API. The editor's
Statistics screen comes in a later version.
:::

## What is recorded

| Event | When | Cut by |
|---|---|---|
| `core:session` | A player leaves: one row per visit, with its length in seconds. | — |
| `core:first_join` | A player joins for the first time. | — |
| `core:players_online` | Every minute: the number of players online. | — |
| `core:command` | A command made in Artisan is run. | `command`, `result` (`ok`, `permission`, `cooldown`, `condition`) |
| `core:menu_open` | A menu is opened. Menus opened from the editor's preview are not counted. | `menu` |
| `core:menu_click` | An element of a menu is clicked. | `menu`, `element` |

Add-ons record their own events (`<module>:<name>`).

Recording never slows the game: a record waits in memory and is written every
`stats.flush-seconds` (30), off the game threads, and once more when the server stops. A crash
loses the last seconds at most.

## Count your own events

The action **Count an event** (`record_event`) counts whatever you choose, from any action
chain: a click, a command, a trigger.

```yaml
- record_event:
    event: vip_offer_seen
    dimensions:
      source: spawn_menu
```

The event is stored as `custom:vip_offer_seen`. Its name takes lower-case letters, digits, `_`
and `.`. A **dimension** is a category you want to compare by (a menu, a source, a result):
six per event at most, 64 characters per value. Past 200 different values of one dimension,
the new ones are counted together as `other`: a dimension is not the place for a player name
or a free text. `value` (1 by default) is added up, for an amount or a duration.

## How long it is kept

Counts are kept **per hour for 90 days**, then merged **per day** and kept without limit.
Sessions and first joins, kept one by one, are deleted after 90 days. All three are settings
of [`config.yml`](../config-yml/) (`stats.retention.*`). A day starts at midnight in
`stats.timezone`, the machine's zone by default.

`stats.enabled: false` turns everything off; `stats.disabled-events` stops chosen events only.

## Who can read them

The permission `artisan.editor.stats` (op by default, included in `artisan.editor`) opens the
totals **and** the detail of a single player. It gives no right on projects.

## Players' data

Statistics are tied to the player's UUID. To delete everything recorded about a player:

```
/artisan stats forget <player>
```

It deletes their rows on every server of the database and cannot be undone. Permission
`artisan.stats.forget` (op by default). The player must have joined the server once.
