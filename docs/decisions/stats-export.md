# Player metrics and their export to the admin's website

**Status:** accepted (2026-11-18). Asked by Iban: rankings (money, play time, login streaks) and a
profile page per player on the network's websites (Azuriom: Laravel on MariaDB), without opening
a port on the game servers.

## Context

The Stat events of ADR `stats-foundation` count what happened (a session, a menu opened); a
ranking needs what *is* (a balance, a play time, a streak), one value per player. They also never
leave the server's database (`stats-foundation` ⑨). A website needs a copy it can read while the
game server is off, and the admin does not want the game server to serve public HTTP.

Two shapes were weighed: the website asking the server through the editor tunnel (with a cache
per page), or the server pushing what changed. The pull keeps no copy on the website, but a page
whose cache expired while the server is off falls; every deep page, search and profile is a cache
key, so the requests that reach the server are not bounded; and the game server answers public
traffic. The push costs a table on the website and a few seconds of delay. 10,000 players weigh
about 500 KB uncompressed, and only the players whose value changed travel: a few hundred every
few minutes.

## Decisions

1. **A player metric is declared, then set.** `PlayerMetric`: an id `<namespace>:<name>` (as a
   Stat event's name), labels per language, a unit (`COUNT`, `SECONDS`, `DAYS`, `CENTS`), whether
   a website ranks it, and whether the lowest ranks first. `StatsApi.declareMetric` then
   `setMetric(metric, player, long)` with the **absolute** value. Values are whole numbers: money
   travels in hundredths. Each module declares its own: Artisan does not know the others, and a
   website shows a new module's metrics without a change. `core` and `custom` stay Artisan's.
2. **`artisan_metric_values`**, network-wide: `(metric, player_uuid)` key, `val BIGINT`,
   `updated_at` in epoch milliseconds. `setMetric` keeps the latest value per player in memory;
   it is written with the statistics flush by an `UPDATE … WHERE val <> ?` then an `INSERT` when
   the row is missing, so **`updated_at` only moves when the value changes**: setting the balance
   of every online player every 5 minutes costs no export. Two servers inserting the same new
   row: the second insert fails on the key and is ignored.
3. **The push, and the website keeps the cursor.** On the servers whose `environment.yml` sets
   `stats-export.url` and `token` (one is enough: they share the database; two send the same
   upserts), every `interval-seconds` (120), off the game threads, `StatsExport` POSTs JSON pages
   (`Authorization: Bearer <token>`) to the website:

   ```json
   {"protocol": 1, "server": "lobby", "since": 1731900000000, "cursor": null,
    "metrics": [{"id": "core:playtime", "unit": "seconds", "ranked": true, "ascending": false,
                 "labels": {"en": "Play time", "fr": "Temps de jeu"}}],
    "players": [{"uuid": "…", "name": "Alice", "first_seen": 1700000000, "last_seen": 1731900000}],
    "values":  [{"metric": "core:playtime", "uuid": "…", "value": 475200}],
    "forget":  ["…"]}
   ```

   The website answers `{"cursor": n}`, the instant (epoch ms) up to which it holds everything.
   A run reads the rows changed after that cursor minus 2 minutes (servers' clocks differ) and up
   to a second ago, players then values, 2,000 rows a page in a stable order (time, then key), and
   sends the new cursor with the last page only (`cursor: null` before). Its rules for a website:
   - apply `forget` first (delete those players and their values), then upsert `players`
     (instants in epoch **seconds**), `metrics` and `values`;
   - when its own cursor is older than `since`, it lost data: keep its cursor and answer it. The
     next run then sends everything from the start;
   - otherwise, when `cursor` is not null, store it; answer the stored cursor.
   The first request of a server's start carries `since: null` and nothing but `metrics`: it asks
   the cursor. Every payload is an idempotent upsert, so a page sent twice changes nothing, and a
   run cut short (website down, timeout) is replayed whole by the next. Nothing is lost while the
   website is down: the cursor did not move.
4. **Artisan's own metrics.** `core:playtime` (seconds) is read from `artisan_players` (its
   `last_seen` moves every 5 minutes while online, at the same time as the play time); it travels
   in `values` beside each player row and is never set. Each server also adds its share to
   `artisan_server_playtime` (`server_id`, `player_uuid`, `playtime_ms`, `last_seen`), only it
   writing its rows; the export reads it after the values, in the same pages, as
   `core:playtime.s<row>` (the server's row in `artisan_servers`: the id outlives a rename). Those
   metrics are declared by the export, one per server with rows, with two optional fields a
   website may ignore: `parent: "core:playtime"` and `scope: "<server name>"`, so it shows them
   as tabs of the network ranking. Counted from the version that added the table: the time played
   before stays in the network total only. `core:money` (cents) is the Vault balance
   of the online players, sampled every 5 minutes and at quit, declared once an economy is found.
   Login streaks belong to `artisan-daily-rewards`, which declares `daily:*` metrics.
   A metric declared `cumulative()` (it only adds up: play time, quests completed) carries
   `"cumulative": true`. **Rankings per period are the website's**: it keeps each player's value
   at the start of the week, month and quarter and ranks the gain. Artisan keeps the current
   value only: a history per period on the game side would be a second source of truth for
   something only the website shows, and the website already sees every change within minutes.
5. **Forgetting.** `/artisan stats forget` also deletes the player's metric values and leaves a
   `core:forgotten` row at that instant; the export sends it in `forget`. A player who plays again
   afterwards reappears. A page holding the forgetting leaves out that player's older player row.
6. **Off by default.** Nothing leaves the server until an admin sets `stats-export` in
   `environment.yml` (never read nor written by the editor, so the token stays on the machine).
   What leaves: UUIDs, names, first and last seen, play time and the declared metrics: no Stat
   event, no IP. A plain `http` address other than the machine itself is logged: the token would
   travel in clear.

## Consequences

- API 1.8.0 adds `PlayerMetric`, `MetricUnit`, `StatsApi.declareMetric` and `setMetric` (default
  methods: a fake `StatsApi` keeps compiling). An add-on that calls them sets `MIN_API_VERSION` to
  1.8.0.
- The website side lives outside this repository: Azuriom's plugin stores
  `metrics`, `players` and `values` in three tables and computes ranks with `ORDER BY … LIMIT`
  and `COUNT(*)` on an index `(metric, value)`.
- A metric set for an offline player (money paid to them) is seen at their next login or sample.
- A ranking is as fresh as `interval-seconds` plus the 5 minutes of the play time and money
  samples.
