- **Added**: Statistics, first part: the collection. Artisan records sessions, first joins, players
  online, the commands run and the menus opened and clicked, in two tables of the suite database
  (`artisan_stats_buckets`, `artisan_stats_events`): counts per hour for 90 days, then per day.
  Settings under `stats` in `config.yml` (`enabled`, `flush-seconds`, `retention`, `timezone`,
  `disabled-events`).
  - A **Statistics** tab on the server's page reads them: the period (compared with the one
    before) and the player as filters, then Overview (active, new and returning players, play
    time, players online), Commands (runs, refusals and their reasons, commands never run) and
    Menus (openings, clicks per element, elements nobody clicked).
  - The action **Count an event** (`record_event`) counts your own events (`custom:<name>`),
    with dimensions and a value.
  - Permission `artisan.editor.stats` (included in `artisan.editor`) reads them through
    `GET /api/v1/servers/:server/stats/{catalog,series,breakdown,actives,events,players,query,journeys,journey}`.
  - `/artisan stats forget <player>` (`artisan.stats.forget`) deletes everything recorded about a
    player.
  - API 1.5.0: `api.getStats()` (`StatsApi`, `StatEvent`, `@Beta`) lets an add-on declare and
    record its own events without waiting for the database.
  - An add-on can add its own tab to the Statistics space (editor SDK 1.23: `FrontendModule.stats`,
    the `stats*` reads, `useStatsRead`, and the chart components `StatCard`, `TimeChart`, `BarList`,
    `Funnel`, `SortableTable`, `StatsPanel`) and declare figures computed on demand
    (`api.getStats().declareQuery`, cached, asked to the running server).
  - A **Journeys** tab follows new players: retention the next day, at 7 and at 30 days, then for
    a journey you compose (ordered goals, a conversion window) its funnel with the median time to
    each goal, the same by week of arrival, and the last action of the players who left.
