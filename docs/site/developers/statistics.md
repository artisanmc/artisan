---
title: Statistics
description: Declare and record your add-on's events, compute figures on demand, and give your module a tab in the editor's Statistics space.
sidebar:
  order: 10.5
---

Artisan keeps the server's statistics (see [Statistics](../../configuration/statistics/)) and
your add-on can add its own: events it records, figures it computes when the admin looks at
them, and a tab that shows both. The API is `@Beta` since 1.5.0.

## Declare and record events

Declare each event once, in `onEnable`, then record occurrences from any thread. Recording
adds to a buffer in memory: it never waits for the database and never throws.

```java
StatsApi stats = api.getStats();
stats.declare(StatEvent.builder("quests:completed").storage(StatStorage.BOTH)
    .dimensions("group", "quest").value("duration_seconds").build());

stats.record("quests:completed", player.getUniqueId(),
    Map.of("group", "daily", "quest", "mine_stone"), 412);
```

- The name is `<namespace>:<name>`; `core` and `custom` are Artisan's.
- A **dimension** is something you break the event down by. Keep its values few (a quest, a
  reason): a player's name or a free text goes in `details`, kept with raw rows only.
- `StatStorage.BUCKETED` keeps counts per hour, `RAW` one row per occurrence, `BOTH` both.
  Counting distinct players and listing occurrences need raw rows.

## Player metrics

A ranking or a profile needs what a player **has**, not what happened: a streak, a balance, a
best time. Declare a **player metric** once (API 1.8.0), then set the player's whole value
whenever it changes. Artisan pushes the changes to the admin's website when they configured it
(see [Rankings and profiles](../../configuration/statistics/#rankings-and-profiles-on-your-website)).

```java
StatsApi stats = api.getStats();
stats.declareMetric(PlayerMetric.builder("daily:streak")
    .label("en", "Login streak").label("fr", "Série de connexions")
    .unit(MetricUnit.DAYS)        // COUNT, SECONDS, DAYS or CENTS
    .build());

stats.setMetric("daily:streak", player.getUniqueId(), streak);
```

- Values are whole numbers (`long`): money in hundredths (`CENTS`), durations in seconds.
- `ranked(false)` keeps a metric on the profile only; `ascending()` ranks the lowest first (a
  best time).
- `cumulative()` says the value only adds up (play time, quests completed, blocks mined): the
  website can then also rank what each player gained this week, month or quarter. Leave it out
  for a state (a balance, a streak, a level).
- `setMetric` never waits: the latest value per player is written with the next statistics
  write, and an unchanged value sends nothing. Setting it every few minutes costs the same as
  on each change.
- Give a label per language your add-on speaks: the website picks the visitor's.

## Figures computed on demand

What your own tables already know (how many players sit on each stage right now) is not an
event. Declare a query: the editor asks for it, your code answers with rows.

```java
stats.declareQuery("quests:stuck", 60, params -> {
    String group = params.get("group");
    return repository.playersPerStage(group); // List<Map<String, Object>>
});
```

The query runs off the main thread, when an admin opens your tab. Its answer is served again
for the same parameters during `cacheSeconds` (0 to 3600) and is cut at 2000 rows. It needs the
server online. Values must be JSON: strings, numbers, booleans, lists, maps.

## A tab in the editor

A module with an editor bundle declares its tab on its `FrontendModule` (editor SDK 1.23):

```tsx
import { StatCard, StatsPanel, SortableTable, statsQuery, useStatsRead } from "@artisan/editor-sdk";

function QuestStats({ serverId, period, focus, onFocus }: ModuleStatsProps) {
  const stuck = useStatsRead(`${serverId}|stuck`, () => statsQuery(serverId, "quests:stuck"));
  // …
}

registerModule({ /* … */ stats: { label: { en: "Quests", fr: "Quêtes" }, component: QuestStats } });
```

The tab receives the space's filters: `period` (`from`, `to`, `by`, and the `previous` period
of the same length), `player` when the admin filters on one, `compare`, `lang`, and a `focus`
kept in the URL for what the tab drills into.

| Read | Gives |
| --- | --- |
| `statsSeries(serverId, query, by)` | a point per hour or day, at zero where nothing happened |
| `statsBreakdown(serverId, query, dimension)` | the totals per value of a dimension |
| `statsActives(serverId, query, by)` | distinct players, over the period and per bucket (raw events) |
| `statsEvents(serverId, query)` | raw rows, newest first, paged by `cursor` |
| `statsQuery(serverId, id, params)` | the rows of a query you declared |

A `query` is `{event, from, to, player?, dims?}`. Each read rejects with a code
(`stats_disabled`, `server_offline`, `unknown_query`…); `useStatsRead(key, load)` runs a read
again when its key changes and gives `{data, error, loading}`.

The components are those of Artisan's own tabs: `StatCard`, `TimeChart`, `BarList`, `Funnel`,
`SortableTable` and `StatsPanel` (a titled block). Series colours are the tokens
`var(--chart-1)` to `var(--chart-4)`, in that order.
