# Artisan lends the database to the suite — `environment.yml`, one pool per plugin

**Status:** accepted (2026-10-11). *Revised on 2026-10-13 by
[server-identity-and-versions](server-identity-and-versions.md): a network of several
servers requires MySQL or MariaDB (refusal at startup on H2), Artisan creates its own tables
(`artisan_servers`, Versions, drafts) with its migrations.*

## Context

Artisan becomes the foundation of a suite of separately distributable plugins (Quests,
Guilds, Lands, Boosts, Warps…), each with `depend: [Artisan]`. Today these plugins get their
database from another infrastructure plugin (MSCore: a static pool of 5 connections, hard-coded
MySQL driver, credentials in its config) or from their own code (MSQuests: embedded HikariCP +
H2/MySQL). Artisan has no link with that other plugin: it does not replace it in place, it
coexists with it, and each plugin of the suite moves from one to the other when it is ready.

Two questions: where do the credentials live, and how does a connection reach the plugin.

## Decisions

1. **`environment.yml` replaces `connection.yml`.** It says where and who this server is:
   the backend link (`server_key`, `ws_url`, unchanged) and the `database` section.
   Read by the Artisan plugin only: never reported in `hello`, never written by the editor
   (the criterion of the ADR `server-config-from-editor` applies as is to database
   credentials), never copied from one server to another.
   *Migration*: at startup, an existing `connection.yml` is taken into `environment.yml` then
   deleted; the keys of a pre-split `config.yml` are too. An existing `environment.yml` is
   never rewritten.
2. **`${NAME}` in a value** is replaced by the environment variable NAME (Docker,
   Pterodactyl), so as not to write a password to disk. A missing variable gives an empty
   string and a warning.
3. **One HikariCP pool per plugin**, opened at the first `api.database.dataSource(plugin)`
   and closed when that plugin is disabled. A plugin that leaks connections never starves the
   others. Common size `database.pool-size` (4 by default) in `environment.yml`, with the rest
   of the `database` section (revision 2026-10-15: it was in `config.yml` to be editable from
   the editor, but it only applies at restart and split the section across two files; a value
   left in `config.yml` is still read as long as `environment.yml` does not give one).
4. **Only `javax.sql.DataSource` crosses the API.** No HikariCP, JDBI or driver in
   `modules.api`: no classloader conflict possible. Each plugin keeps its access layer and
   **its own migrations** (no migration API imposed: existing plugins already have one).
5. **Dialects**: `h2` (default, no installation), `mysql`, `mariadb`. `DatabaseDialect` is a
   Java enum, like `FieldKind`. **A single database for the whole suite**, whatever the
   dialect: each plugin prefixes its tables. With H2, a single file
   `plugins/Artisan/database/suite` (revision 2026-10-11: first one file per plugin). Reason:
   plugins will reference Artisan tables by foreign key (servers table, so that renaming a
   server is a single `UPDATE`), and a foreign key does not cross two H2 files. All the pools
   live in Artisan's JVM, which H2's embedded mode allows.
6. **HikariCP and the drivers are not embedded**: `libraries:` of `plugin.yml`, downloaded by
   Paper at startup into Artisan's classloader. The jar stays light and nothing is relocated.
   Trade-off: the first startup needs Maven Central (~7 MB), including on a server that uses
   no plugin of the suite.
7. **`@Beta` API** (`ArtisanAPI.database`, since 1.7.0): the network (messaging, presence,
   teleportation) will follow in the same facade, with `server_name` and `redis` in
   `environment.yml`.

### Amendment 2026-10-18 — a plugin opens its pool itself (ADR `runtime-library`) — **withdrawn**

*Withdrawn the same day, with ③ ④ ⑤ of `runtime-library` (see its amendment): the suite's
plugins keep Artisan required and `api.database`. The text stays for history.*

Points 3, 5 and 6 assumed the Artisan plugin present: the pools lived in its JVM, behind
`api.database`. A suite plugin must start without it, therefore:

- **Each plugin opens its pool through its copy of the runtime** (`ModuleDatabase`, `runtime`
  module), with HikariCP and the driver in its own `plugin.yml` (`libraries:`, like Artisan).
  `api.database` remains available, `@Beta`, but is no longer the suite's way.
- **Credentials stay in one place.** At the plugin's startup: if
  `plugins/Artisan/environment.yml` exists, its `database` section is read (never written);
  otherwise the plugin writes a default `database` section (H2) in its own `config.yml` and
  uses it. `database.own: true` in the plugin's config keeps its section whatever Artisan has.
  The log says which of the two is read. Nothing is created under `plugins/Artisan/`. The order
  holds: the plugin declares Artisan as `softdepend`, Artisan wrote its file before.
- **With H2, one file per plugin**, under its folder: two copies of H2 in two classloaders do
  not open the same file. The single file remained the rule for foreign keys towards
  `artisan_servers`; the `server-identity-and-versions` revision already requires MySQL or
  MariaDB for a network, and that is where they matter. A single database on MySQL and
  MariaDB, each plugin prefixing its tables, as before.

### Amendment 2026-10-19 — configurable table prefix

`database.table-prefix` (`environment.yml`, `artisan_` by default) precedes all the suite's
tables: Artisan's (`{prefix}servers`, names unchanged by default) and the plugins', named
`DatabaseApi.tablePrefix(module) + name` = `{prefix}{module}_{name}` (API 2.9.0). The prefix only
serves to house two distinct installations in the same database; collisions between plugins are
avoided by the `module` segment (one word, refused if it is a first segment of Artisan's tables).
The prefix used is noted in `plugins/Artisan/database/table-prefix`: changed under a database
that still contains the old one's tables, `dataSource()` is refused to all plugins rather than
starting over on empty tables. A network shares a prefix: a leaf on another prefix reads another
`{prefix}meta`, hence another database id, and the hub already refuses it. The prefix is global
and not per module (a single place to check; a per-module rename brings nothing more than the
global prefix and adds possible collisions).

*Rejected:* one H2 file per plugin (isolates plugins, but forbids any foreign key towards an
Artisan table and diverges from MySQL); a shared pool (a leak in one plugin blocks the whole
suite); keeping the name `connection.yml` (the file no longer only contains the backend
connection); shaded and relocated drivers (~7 MB more in each Artisan jar for optional use); a
common migration API (the plugins to migrate already have their own, replacing it adds risk and
brings nothing).
