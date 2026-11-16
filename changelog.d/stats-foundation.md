- **Added**: Statistics, first part: the collection. Artisan records sessions, first joins, players
  online, the commands run and the menus opened and clicked, in two tables of the suite database
  (`artisan_stats_buckets`, `artisan_stats_events`): counts per hour for 90 days, then per day.
  Settings under `stats` in `config.yml` (`enabled`, `flush-seconds`, `retention`, `timezone`,
  `disabled-events`). The editor's Statistics screen comes later; the data is collected from now.
  - The action **Count an event** (`record_event`) counts your own events (`custom:<name>`),
    with dimensions and a value.
  - Permission `artisan.editor.stats` (included in `artisan.editor`) reads them through
    `GET /api/v1/servers/:server/stats/{catalog,series,breakdown,events}`.
  - `/artisan stats forget <player>` (`artisan.stats.forget`) deletes everything recorded about a
    player.
  - API 1.5.0: `api.getStats()` (`StatsApi`, `StatEvent`, `@Beta`) lets an add-on declare and
    record its own events without waiting for the database.
