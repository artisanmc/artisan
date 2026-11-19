---
title: Statistics
description: What Artisan records about your server's menus, commands and players, how long it keeps it, and how to count your own events.
sidebar:
  order: 10
---

Artisan records what your content does: which menus are opened and clicked, which commands are
run, how long players stay. The records are written to [your database](../database/) and sent
nowhere else. Only the player metrics (play time, money, the add-ons' rankings) can be pushed to
your own website, once you ask for it ([below](#rankings-and-profiles-on-your-website)).

## Read them in the editor

A server's page has a **Statistics** tab, shown to whoever has `artisan.editor.stats`. Two
filters apply to every tab: the **period** (24 hours, 7, 30 or 90 days, or two dates), compared
with the period of the same length before it, and the **player** (all of them, or one found by
name). The address keeps both, so a link reopens the same view.

- **Overview**: active, new and returning players, play time, and the players online. For one
  player: their visits. A visit is counted when it ends, so a player still online appears at
  their next disconnection.
- **Commands**: how often each command made in Artisan is run and how often it is refused.
  Click a command for its sub-commands and the reasons of the refusals. The commands of your
  published projects that nobody ran are listed below.
- **Menus**: openings and clicks per menu. Click a menu for the clicks per element, how many
  of the players who opened it clicked something, and the clickable elements nobody clicked.
  An element is named by its id: renaming it starts its count over.

- **Journeys**: what becomes of new players. Without any setup, the share of the players who
  arrived over the period and came back the next day, 7 days later and 30 days later, and a
  **retention curve**: that share for each day up to the 30th. Then
  compose a **journey**: goals in order, each an event and, if needed, a filter
  (`quest=intro`), for example first quest done, first purchase, a rank reached. You get:
  - the **funnel**: how many new players reach each goal, and in how long (median). A goal
    counts within the conversion window, 7 days after the arrival by default;
  - the same **by week of arrival**, to see what a change on the server did from one week to
    the next;
  - the **last action before leaving**: for the new players not seen for 7 days, what they did
    last. "40 % left right after opening the jobs menu" points to where to look; it proves
    nothing.

  A goal can be a quest event, a command run (`core:command`, filter `command=rtp`), a menu
  opened (`core:menu_open`, filter `menu=jobs:main`), a session or one of your own
  `custom:` events. Clicks inside a menu are only counted, they cannot be a goal.

  Journeys read the events kept row by row, 90 days by default (`stats.retention.raw-days`): a
  period reaching further back shows its last 92 days.

Statistics are read from the database: they stay available while the server is off.

## What is recorded

| Event | When | Cut by |
|---|---|---|
| `core:session` | A player leaves: one row per visit, with its length in seconds. | — |
| `core:first_join` | A player joins for the first time. | — |
| `core:players_online` | Every minute: the number of players online. | — |
| `core:command` | A command made in Artisan is run: counted, and one row per run. | `command`, `result` (`ok`, `permission`, `cooldown`, `condition`) |
| `core:menu_open` | A menu is opened: counted, and one row per opening. Menus opened from the editor's preview are not counted. | `menu` |
| `core:menu_click` | An element of a menu is clicked: counted only. | `menu`, `element` |

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

## Rankings and profiles on your website

A **player metric** is a player's current value of something you may want to rank: play time
(`core:playtime` for the whole network, `core:playtime.s<n>` for each server), money (`core:money`, the Vault balance, when an economy plugin is installed)
and what add-ons declare (a login streak, quests completed). Artisan keeps the latest value of
each player in the database and can push the values that changed to your website, which shows
**rankings** and a **profile** per player:

1. Install the website's plugin (Azuriom: **Artisan Leaderboards**), and copy the address and
   the token its admin page shows.
2. On one server of the network, in [`environment.yml`](../environment/#stats-export):

   ```yaml
   stats-export:
     url: "https://example.com/api/leaderboards/push"
     token: "${ARTISAN_EXPORT_TOKEN}"
   ```

3. Restart. The first push sends every player; the next ones, every 2 minutes, only the players
   whose values changed. The console says `Player metrics exported to example.com`.

The server opens no port: it calls the website. The website keeps its copy, so rankings stay
online while the server is off, and a website down for a while catches up on its return. What
leaves the server: UUIDs, names, first and last connection, play time and the metrics. No IP,
no other statistics.

Each server counts its own share of a player's play time beside the network total, from the
version that added it on: the time played before stays in the network total only. A website
shows each server as a tab of the play-time ranking.

A metric that only adds up (play time, quests completed) can also be ranked **per week, month
and quarter**: the website remembers each player's value at the start of the period and ranks
what was gained since. It starts counting when the website first receives the metric.

Play time and money of the online players are refreshed every 5 minutes and when they leave: a
ranking can be up to about 7 minutes late.

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

It deletes their rows on every server of the database and cannot be undone. With
`stats-export` set, the website deletes them too at the next push; if they play again, they
reappear. Permission
`artisan.stats.forget` (op by default). The player must have joined the server once.
