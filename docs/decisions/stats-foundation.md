# Statistics foundation — declared events, hourly buckets, raw rows, in Artisan

**Status:** accepted (2026-11-16). Batch 1 of the statistics work (spec « Statistiques Artisan —
spec du socle », validated by Iban on 2026-11-16). The editor space, the module tabs, the Quests
tab and the player journeys are later batches.

## Context

Admins want to know what their content does: which commands and menus are used, how quests are
played, where new players stop. The suite also runs Spekt, an unfinished analytics plugin, which
these statistics replace in the end. Spekt's "events-first" model is kept: everything measured is
a **declared Stat event**, and the declaration says how it is stored. Spekt stored minute buckets
in PostgreSQL `jsonb`; Artisan runs on the suite database (H2, MySQL or MariaDB), so the model is
adapted to portable SQL.

## Decisions

1. **In Artisan, not in an add-on.** The contract (`api.getStats()`) is in `modules.api`; the
   catalogue, the buffer, the storage, the rollup, the retention and the read routes are Artisan's
   own, in a Bukkit-free Gradle module `plugin/stats` plus `database`, `hub` and `paper` wiring.
   *Rejected:* a separate `artisan-analytics` plugin behind the core contract. Modules see the same
   `api.getStats()` either way, so their independence is identical; but an add-on cannot add hub
   routes, add a permission to editor sessions or add a top-level editor space today, and the hub
   reads the suite database even when a game server is off, which a plugin installed on game
   servers only cannot do. Four public extension points to freeze for one consumer. Revisit if the
   statistics become a product sold on their own; `plugin/stats` depends on no Bukkit and no hub
   type, so extracting it costs those extension points, not a rewrite. `stats.enabled: false`
   turns everything off.
2. **A Stat event is declared before it is recorded.** `StatEvent`: a name `<namespace>:<name>`,
   a storage (`BUCKETED`, `RAW` or `BOTH`), a kind (`COUNTER` or `GAUGE`), a scope (`PLAYER` or
   `SERVER`), its dimension names, an optional value name, an optional raw retention. `core:` and
   `custom:` are Artisan's. A record of an undeclared event, or with an undeclared dimension, is
   dropped with one warning per event: statistics never throw into the caller's code.
3. **Bounded dimensions.** A dimension is an enumerable category (a menu, a quest, a result). Values
   are cut to 64 characters; past 200 distinct values of one dimension of one event, new values
   are recorded as `other` (counted per server run). High-cardinality data goes in the details of
   a raw event.
4. **Recording never waits.** `record` adds to a buffer in memory: buckets merge in a map keyed
   by (player, event, dimensions, hour), raw rows queue. A writer drains it every
   `stats.flush-seconds` (30) off the main thread, and once more at shutdown. A failed write puts
   the buckets back (they merge with the new ones) and the raw rows back up to the buffer's bound;
   past 100,000 queued raw rows the oldest are dropped, logged.
5. **Two tables.** `artisan_stats_buckets` (server row, player UUID or `''` for the server scope,
   granularity `H` or `D`, bucket start in epoch seconds, event, canonical dimensions, count, sum,
   min, max) and `artisan_stats_events` (server row, player, event, time in epoch milliseconds,
   dimensions, value, details as JSON text). Dimensions are stored as canonical text (keys sorted,
   `k=v` joined by `&`, percent-escaped): no `jsonb`, and equal dimensions are equal strings.
   A bucket is written by `UPDATE … SET cnt = cnt + ?` then `INSERT` if no row moved: no
   dialect-specific upsert. Only the server owning `server_id` writes its rows, so the two
   statements never race. A gauge is a sample per measure: average `sum / count`, plus min and max.
6. **Hour buckets, merged into days.** Hours are UTC. Once a day, the hours older than
   `stats.retention.hourly-days` (90) are merged into days, one day per transaction, then
   deleted: replaying a crashed run doubles nothing. A day is cut in `stats.timezone` (the
   server's by default). Days are kept `stats.retention.daily-days` (0: forever). Raw rows are
   kept `stats.retention.raw-days` (90), or the event's own retention.
7. **One permission, `artisan.editor.stats`.** It opens the totals and a single player's detail;
   it neither gives nor comes with project reading or editing. Op by default like the other
   editor permissions.
8. **Read routes in the hub**, on the server of the route, read from the database (an offline
   server's statistics stay readable): `stats/catalog`, `stats/series`, `stats/breakdown`,
   `stats/events`, then with the editor space (batch 2) `stats/actives` (the distinct players of
   an event, which a sum of buckets cannot give) and `stats/players` (the names the player filter
   offers, from `artisan_players`).
9. **Personal data.** Statistics are tied to the player's UUID and never leave the server's
   database (bStats is unrelated). `/artisan stats forget <player>` deletes a player's rows in both
   tables, for every server of the database, and their buffered records.
10. **Core instrumentation from batch 1:** `core:session` (both: a raw row with its duration, and
    buckets for the active players and the play time of a period), `core:first_join`
    (both, from `artisan_players`), `core:players_online` (server gauge, every minute),
    `core:command` (by command and result) and `core:menu_open` / `core:menu_click` (by menu and
    element), bucketed. Menus opened from the editor's preview are not counted. Admins instrument
    their own content with the core action `record_event` (`custom:<name>`, declared on first use,
    `BOTH`, counter, player scope).

11. **A module's tab, and figures computed on demand** (batch 3). A module adds a tab to the
    statistics space from its editor bundle (`FrontendModule.stats`, editor SDK 1.23), built with
    the SDK's own components (key figure, chart, ranking, funnel, sorted table) so tabs look
    alike. A present state no event records ("how many players are stopped at each stage") is a
    query the module declares with `StatsApi.declareQuery(id, cacheSeconds, query)`: the hub asks
    the running server (`stats_query_fetch`), the module's code runs off the game threads, and
    the answer is kept for the declared time per set of parameters. It is the one statistics read
    that needs the server online: the state lives in the module's tables, which the hub does not
    know.

12. **Journeys of new players** (batch 5). A journey is a name, ordered goals (an event and an
    optional filter on its dimensions) and a conversion window in days (7 by default). The saved
    journeys of a server are one value of `artisan_settings` (`stats.journeys.<server row>`, a JSON
    list the hub validated): no table, they are a few lines an admin edits. The hub computes a
    journey on demand (`POST …/stats/journey`) for the **arrivals** of a period, the players whose
    `core:first_join` falls in it, by folding the raw rows once in time order (`Journeys` in
    `plugin/stats`, `StatsReader.scan`, a day per statement so no driver holds more):
    - **funnel**: an arrival reaches goal n with the first matching row at or after the one that
      reached goal n-1, within the window; the median time from the arrival is given per goal;
    - **retention**: an arrival came back on day 1, 7 or 30 when a session overlaps that day
      counted from the arrival; only arrivals old enough for the day to be over are counted;
    - **cohorts**: the same per week of arrival (Monday, in `stats.timezone`);
    - **last actions**: for the arrivals not seen for 7 days, their last row that is not a
      session, by frequency. A lead towards a cause, never a proof.
    The period is 92 days at most (raw rows are kept 90) and an answer is served again for a
    minute. Reading them needs `artisan.editor.stats`; so does saving one, since a journey
    changes nothing on the server.

## Consequences

- API 1.5.0 adds `api.stats` (`@Beta`); a module that calls it sets its `MIN_API_VERSION` to 1.5.0.
- Volume grows with active players: one bucket row per player, event, dimensions and active hour.
  The defaults are to be measured on the lobby before they are frozen.
- The journeys read the raw rows: sessions and first joins are collected from batch 1 so a
  conversion window has history. A goal on an event stored in buckets only can never be reached:
  the editor offers the events that have raw rows.
- A journey scans every raw row of the server over the period: its cost grows with the period.
  The minute of cache and the 92 days bound keep it reasonable; to be measured on the lobby.
