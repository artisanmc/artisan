# Player analytics — tracked events, Markers, honest before/after, Experiments

**Status:** proposed (2026-11-01). Builds on `suite-foundation-database` (the suite's database),
`triggers-and-variables` (Game events, Action chains), `server-identity-and-versions` (Versions)
and `mcp-server` (read tools for an AI client). Supersedes the `event_menu_opened` /
`event_action_executed` messages of `specs/main-spec.md` §17.3, written for the retired cloud
backend and never built.

## Context

An admin builds content with Artisan but cannot see what players do with it: does anyone open the
shop menu, does the new tutorial keep new players, did the last economy change move anything. Iban
runs two servers and wants (Iban, 2026-11-01) to (a) see player behaviour, (b) put a point in the
timeline ("tutorial added") and compare before and after, and (c) let an AI client do the analysis
through the MCP server.

What exists:

| Step | State |
|---|---|
| Capture | 29 declared Game events with typed contexts (`CoreGameEvents.kt`); the engine knows each menu open, Element click, Command run, `take_money`. Nothing is recorded. |
| Storage | The suite's database; `artisan_players` (first seen, play time); Versions with date, author and manifest. |
| Query | None. |
| Interpretation | The hub's MCP server, OAuth, per-player permissions, read tools. |

Generic analytics plugins (Plan) already cover play time, retention and TPS. What only Artisan can
offer is analytics that **knows the content**: which Element of which Menu was clicked, which
Trigger fired, which add-on sale happened at what price; and the loop *build → measure → change
through a Draft → measure again*.

A before/after comparison is the obvious tool and the most misleading one. On a Minecraft server
the usual causes of a false conclusion are, from most to least frequent: weekly seasonality,
several changes in the same window, a change in population (a video brings 200 players unlike the
regulars), regression to the mean (a change is made *because* a number was bad), novelty, and
above all small samples. Detecting a D7 retention change from 30 % to 35 % (α 5 %, power 80 %)
needs about 1,400 new players per group: months for a server with 20 new players a day. The
design must therefore make the honest answer — "inconclusive" — the default one.

## Decisions

### 1. Two ways in: automatic events and a `track` action

**Automatic events**, recorded without configuration because only Artisan knows them:

| Event | Props |
|---|---|
| `menu_open` | `menu` (qualified ref) |
| `element_click` | `menu`, `element` |
| `command_run` | `command` (an Artisan Command Document, not every command typed) |
| `dialog_answer` | `dialog`, `button` |
| `money_taken` / `money_given` | `amount`, `document` (only through Artisan's actions) |
| `session_start` / `session_end` | `duration_ms` on end (from `PlayerSync`) |
| `trigger_fired` | `trigger` — **aggregate only** (§3), never one row per firing |

**`track`**, a core action usable in any Action chain:

```yaml
schema: trigger/v1
on: player_death
do:
  - track: { name: death, props: { cause: "{event.cause}", world: "{event.world}" } }
```

- `name`: `[a-z][a-z0-9_]{0,47}`; automatic event names are reserved.
- `props`: at most 8, keys `snake_case`, values a number or a string of at most 64 characters,
  resolved by template (`triggers-and-variables` §6: unresolved → the action is skipped with a
  warning).
- Names are free, not declared Documents (Q1). The editor autocompletes from the names already
  recorded.

Combined with Triggers, `track` covers any Game event without a new Document kind. The tracking
plan is content: an AI client writes it through the usual Draft flow, and the admin decides the
volume. `NORMAL`-frequency Game events are never tracked automatically.

**Add-ons**: `ArtisanAPI.analytics().track(player, name, props)`, `@Beta`, same rules, the name
prefixed by the module (`auctions:sale`).

### 2. Capture never touches the game thread's latency

`track` and the automatic events run inline (the chain's thread, `triggers-and-variables` §8) and
only **enqueue** into a bounded lock-free queue (capacity 50,000). A flush runs every 5 s or every
500 events on an async task through the `Scheduler` port, in batched `INSERT`s. Queue full → the
event is dropped and counted (`analytics_dropped`, in `server_health` and the logs once a minute).
Per player, beyond 600 events an hour, rows stop and only the daily counter goes on (a farm with a
`track` on `player_kill_entity` cannot flood the table). Shutdown flushes with a 3 s timeout.

### 3. Storage: raw events with a retention, daily aggregates forever

Tables of the suite's database (prefix `database.table-prefix`):

- `artisan_events` — `id`, `server_id`, `player` (UUID), `name`, `props` JSON, `at`; indexes
  `(name, at)`, `(player, at)`. Kept `analytics.retention-days` (90 by default), then deleted.
- `artisan_event_daily` — `day`, `server_id`, `name`, `prop_key`, `prop_value`, `count`,
  `players` (distinct); kept forever. Filled once a day for the previous day by the hub (or the
  single server), the only writer of this table. `prop_value` is kept only for the 50 most frequent
  values of a key per day; the rest is grouped as `(other)`.
- `trigger_fired` and over-limit events (§2) are counted in memory per minute and added to
  `artisan_event_daily` directly.

Estimate to check before milestone 1 ends: 100 players online on average, about 50 automatic events
per player-hour → 120,000 rows a day, about 25 MB with indexes, about 2.2 GB at 90 days. That
is reasonable on MySQL/MariaDB. On H2 (single server only), the default retention drops to 30 days and
the startup log states the estimate.

No time-series database (Prometheus, InfluxDB): a new dependency for a volume MySQL handles, and
they do not model per-player behaviour.

### 4. Markers: what changed, when

A **Marker** is a dated point in a server's timeline (or the network's) that says something changed.
Two sources:

- **A Version with a note.** Deploy (editor and `draft_publish`) takes an optional `note` ("Tutorial
  added"), stored on the Version (new column `note`). The Version's manifest says which Documents
  changed, so the analysis can propose the related metrics itself (`menus/tutoriel.yml` changed →
  `menu_open`/`element_click` of that Menu). A Version without a note still appears in the timeline
  as a minor tick.
- **A manual Marker** for what Artisan does not see: an event, a video, an outage, school
  holidays, another plugin's update. Table `artisan_markers` (`id`, `server_id` nullable = whole
  network, `at`, `label`, `kind` = `change | external | incident`, `author`, `expected` JSON).
  Created from the editor's timeline or the MCP tool `annotate`.

`expected` lists the metrics the change is meant to move, written **when the Marker is created**
(light pre-registration). A comparison on a metric that is not listed is marked *exploratory*
(§5): an AI client that tries forty metrics finds two "effects" by chance at α 5 %.

### 5. Comparison: a verdict, never a bare delta

`stats_compare(marker, metric, window_weeks = 2)`:

- **Windows aligned on whole weeks** before and after the Marker (weekly seasonality cancels
  out); the Marker's day is excluded.
- **Metrics** from a closed list: `count(event)`, `players(event)`,
  `conversion(event_a → event_b, within)`, `active_players`, `new_players`,
  `playtime_per_player`, `retention(d1 | d7 | d30)`. A filter on one prop is allowed.
- **Population**: `all` or `new_players` (players whose `first_seen` falls in the window, outcome
  measured over their first N days — the right unit for a tutorial). A cohort result is available
  only N days after the window ends; the tool gives that date.
- **Answer**: before, after, delta, 95 % confidence interval, sample sizes, **minimum detectable
  effect** for this sample, other Markers and Versions in either window (*confounders*), and one
  verdict:

| Verdict | Rule |
|---|---|
| `insufficient_data` | fewer than 7 days or 30 players on a side |
| `inconclusive` | the interval contains 0 |
| `suggestive` | the interval excludes 0, but there are confounders, or the metric is exploratory |
| `likely_effect` | the interval excludes 0, no confounder, metric listed in `expected` |

Proportions: Newcombe interval on the difference. Per-player values: Welch on the per-player means.
Daily series (`count`, `active_players`): Welch on the daily values, so the sample is the number of
days, not the number of events, and the interval is wide.

Two servers give a control group (the change on one only): `stats_compare` accepts a `control`
server and then answers a difference-in-differences. It is still weaker than §6: two servers have
neither the same public nor the same gameplay.

### 6. Experiments: the only causal answer

An **Experiment** is a Document (`experiments/<id>.yml`, `schema: experiment/v1`):

```yaml
schema: experiment/v1
variants: { A: 50, B: 50 }     # weights
audience: new_players          # all | new_players (first_seen after start)
start: 2026-11-10
end: 2026-12-10                # optional
expected: [ "retention(d7)", "conversion(tutorial_start -> tutorial_done, 1h)" ]
```

- Condition `experiment: { id: tutoriel_v2, variant: B }`, usable in any `if:`.
- **Assignment** = `hash(experiment id, player UUID) mod 100` against the cumulative weights:
  deterministic, nothing stored, the same on every server of the network. Outside the audience or the
  dates, the condition is false for every variant, so the content falls back to its normal path.
- Analysis **by assignment** (intention-to-treat) among the audience; the first evaluation of the
  condition records `experiment_exposure` for information.
- `stats_experiment(id)` answers in the format of §5, without the confounders (both groups live
  through the same period), plus the sample still needed for the observed effect.

### 7. Read tools in the MCP server

New read tools (they write nothing, so `mcp-server` decision 2 holds); each needs
`artisan.analytics.view`:

| Tool | Answer |
|---|---|
| `stats_overview` | active, new, D1/D7 retention, last 7 and 28 days |
| `stats_events` | count/players per day of an event, optionally split by one prop |
| `stats_funnel` | per-step conversion of an ordered list of events, per player, within a delay |
| `stats_compare` | §5 |
| `stats_experiment` | §6 |
| `timeline` | Markers and Versions over a period |
| `annotate` | creates a manual Marker (the only write; `artisan.analytics.annotate`) |
| `stats_player` | one player's events, `artisan.analytics.players` only (moderation) |
| `server_health` | TPS/MSPT, players online, uptime, `analytics_dropped`, recent errors — asked to the live server |

The tools query the database from the hub, so they work with the server off (except
`server_health`). Every query has a 10 s timeout and a row cap. There is **no free SQL**: fixed shapes are
safer and correct by construction; a need beyond them adds a shape.

The boundary of operations: `server_health` reads. No tool runs a console command, restarts or
changes a server's configuration. The rule of `mcp-server` (the AI writes Drafts, a human deploys)
extends to the machine itself.

### 8. Personal data

A UUID tied to behaviour is personal data (GDPR; Iban's servers and most buyers are in the EU).
This is not legal advice; it is the minimum the product must make possible:

- `analytics.enabled: false` by default while it is a preview; on, the startup log says what is
  recorded and for how long.
- MCP answers carry **pseudonymous** player ids (HMAC of the UUID with a per-database secret),
  except `stats_player`.
- `/artisan analytics forget <player>` deletes a player's raw rows (aggregates hold no UUID).
- The retention of §3; the user docs give admins a text to put in their server rules.

Recording on the admin's own database, without sending anything out, is also a selling point against
services that ship data to a cloud.

### 9. Editor

A frontend module `insights`: overview, events, funnels, the timeline with Markers and Versions
(deploy note included), a comparison view that shows the verdict and the confounders first and the
chart second, and the Experiments. Same queries as the MCP tools, through `/api/v1/…`.

## Consequences

- One new action (`track`), one condition (`experiment`), one Document kind (`experiment/v1`),
  three tables, one column on Versions, one protocol message (`server_health`), one `@Beta` API.
- The volume is now a product concern: the editor warns when a `track` sits on a `NORMAL` Game
  event without `if:` or cooldown.
- The comparison will often say `inconclusive` on small servers. That is the intended behaviour; the
  minimum detectable effect tells the admin what *could* be seen.
- Economy outside Artisan stays invisible: Vault has no global transaction event. A
  periodic snapshot of online players' balances is possible but partial (Q3).

## Rejected

- **Recording every Game event**: the volume explodes on `NORMAL` events and most of it is never
  read.
- **Integrating Plan or an external service (PostHog…)**: Plan does not know the content; an external
  service takes players' data out of the admin's infrastructure. (Product analytics of Artisan
  itself, `main-spec` §18, is another question.)
- **Free SQL for the AI**: injection-safe only with a read-only user that admins will not
  configure, and wrong answers by construction (no alignment, no interval).
- **A bare before/after delta**: see Context; this is the misuse this ADR exists to prevent.
- **Assignment stored per player**: a hash gives the same result with nothing to store or sync.

## Milestones

| # | Content | Accepted when |
|---|---|---|
| M1 | §1 (automatic events except `trigger_fired`, `track`), §2, `artisan_events`, deploy note + manual Markers + `timeline`, `stats_events` | On the test server, ten menu opens → `stats_events` answers 10; MSPT unchanged with a `track` on 1,000 events/s (load test); the 90-day volume estimate is checked against a week of real data |
| M2 | Daily aggregates, `stats_overview`, `stats_funnel`, `stats_compare` + cohorts, `server_health`, §8 | **Simulation test written first**: on 1,000 null simulated datasets, `likely_effect` ≤ 6 %; with an injected effect at the computed minimum detectable effect, detected ≥ 75 % |
| M3 | §6 Experiments, `AnalyticsApi`, `insights` editor module | The tutorial of Iban's servers run as an Experiment; `stats_experiment` gives a verdict with its sample |

Before building M2 and M3: two to four weeks of M1 on Iban's two servers. If no gameplay decision
was taken from the data in that time, the scope is wrong.

## Glossary (on acceptance)

To add to `CONTEXT.md`: **Marker**, **Experiment**, **Tracked event**. *Avoid*: "annotation" for
Marker, "A/B test" as a Document name.

## Open questions

| # | Question | Recommendation |
|---|---|---|
| Q1 | Declare tracked event names as Documents (typo detection, references on the board)? | Free names in v1 with editor autocompletion; reopen if typos show up in real data. |
| Q2 | A per-player opt-out (`/artisan privacy`)? | Not required by default under legitimate interest with short retention, but cheap: decide with the user docs in M2. |
| Q3 | Economy outside Artisan: snapshot balances, or a Vault wrapper? | Snapshot of online players' balances every hour in M2; a wrapper changes another plugin's behaviour, refused. |
| Q4 | Network-wide metrics when servers share players: count a player once or per server? | `server_id` optional in every tool; without it, distinct players across the network. |
| Q5 | Bayesian answer (probability of improvement) instead of intervals? | Intervals in v1: easier to test against simulations; reopen if admins misread them. |
