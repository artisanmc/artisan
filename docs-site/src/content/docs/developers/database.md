---
title: Database
description: Use the SQL database Artisan lends to the plugins of its suite — one connection pool per plugin, H2, MySQL or MariaDB, your own tables and migrations.
sidebar:
  order: 9
---

Artisan lends a SQL database to the plugins built on it, so a server owner sets
credentials **once** and every add-on uses them. `api.database` is `@Beta`,
Since 1.7.0.

What you get, and what you don't:

- **A `javax.sql.DataSource`** — a HikariCP pool dedicated to your plugin. Only
  the standard JDBC interface crosses the API: bring your own access layer
  (plain JDBC, JDBI, jOOQ…) and shade it yourself.
- **One database shared by the whole suite.** Every plugin's tables live side by
  side: **prefix your table names** (`homes_homes`, `homes_schema_version`).
- **No tables and no migration framework from Artisan.** Artisan stores its own
  data as files and creates no table; your plugin creates and migrates its
  tables.

Artisan's editor content never goes through this database — projects live on
disk. Use the database for your plugin's **runtime** data: balances, player
homes, purchase logs.

## Get your pool

```kotlin
override fun onEnable(api: ArtisanAPI) {
    dataSource = api.database.dataSource(plugin)   // your JavaPlugin, not api.plugin
    migrate(dataSource, api.database.dialect)
}
```

```java
DataSource dataSource = api.getDatabase().dataSource(plugin);
DatabaseDialect dialect = api.getDatabase().getDialect();
```

- The **first call opens the pool and tests a connection — it blocks.** Call it
  once, from `onEnable`, and keep the result.
- The pool is keyed by your plugin's name and **closed automatically when your
  plugin is disabled**. Do not close it yourself.
- A misconfigured or unreachable database throws `IllegalStateException`
  naming your plugin and the file to fix. Let it propagate (or disable your
  plugin with a clear message): the admin has to fix `environment.yml`.

Run every query off the game threads, on Paper's async scheduler
([Threading & Folia](/wiki/developers/threading/)). Keep what menus display in a
memory cache refreshed from the database, never queried from a fetcher.

## Dialects

`api.database.dialect` returns a `DatabaseDialect`:

| Value | Database |
|---|---|
| `H2` | Embedded H2 file — the default, nothing to install |
| `MYSQL` | MySQL 8+ |
| `MARIADB` | MariaDB 10.6+ |

Branch on it only for the few statements that differ — upserts and
auto-increment DDL, mostly:

```kotlin
val upsert = when (dialect) {
    DatabaseDialect.H2 ->
        "MERGE INTO homes_homes (owner, name, world, x, y, z) KEY (owner, name) VALUES (?, ?, ?, ?, ?, ?)"
    DatabaseDialect.MYSQL, DatabaseDialect.MARIADB ->
        "INSERT INTO homes_homes (owner, name, world, x, y, z) VALUES (?, ?, ?, ?, ?, ?) " +
            "ON DUPLICATE KEY UPDATE world = VALUES(world), x = VALUES(x), y = VALUES(y), z = VALUES(z)"
}
```

## Migrations

Artisan imposes no migration tool. Two approaches work well:

- **A version table** of your own — simplest, no dependency:

  ```kotlin
  fun migrate(ds: DataSource) = ds.connection.use { c ->
      c.createStatement().use { it.execute(
          "CREATE TABLE IF NOT EXISTS homes_schema_version (version INT NOT NULL)") }
      val current = c.createStatement().use { s ->
          s.executeQuery("SELECT MAX(version) FROM homes_schema_version").use { r ->
              if (r.next()) r.getInt(1) else 0
          }
      }
      val steps = listOf(
          "CREATE TABLE homes_homes (owner CHAR(36) NOT NULL, name VARCHAR(32) NOT NULL, " +
              "world VARCHAR(64) NOT NULL, x DOUBLE NOT NULL, y DOUBLE NOT NULL, z DOUBLE NOT NULL, " +
              "PRIMARY KEY (owner, name))",
      )
      for ((index, sql) in steps.withIndex()) {
          val version = index + 1
          if (version <= current) continue
          c.createStatement().use { it.execute(sql) }
          c.prepareStatement("INSERT INTO homes_schema_version (version) VALUES (?)").use {
              it.setInt(1, version); it.executeUpdate()
          }
      }
  }
  ```

- **Flyway or Liquibase**, shaded and relocated in your jar, pointed at the
  `DataSource` — set a prefixed history table (Flyway's `table` option) so
  plugins do not share one.

Whatever you choose, migrate **forward only**: add columns and tables, relax
constraints, and never drop data without a deprecation period — server owners
downgrade plugins.

## How the server owner configures it

Credentials live in `plugins/Artisan/environment.yml`, read by the Artisan
plugin only (never sent to the editor, never written by it):

```yaml
database:
  type: "h2"          # h2 | mysql | mariadb
  host: "localhost"
  port: 3306
  name: "minecraft"
  user: "root"
  password: "${DB_PASSWORD}"   # any value may reference an environment variable
```

- `h2` stores a single file, `plugins/Artisan/database/suite.mv.db`, shared by
  every plugin.
- The pool size per plugin is `database.pool-size` in Artisan's `environment.yml`
  (default 4, from 1 to 50).
- Changes apply after a restart.
- In a network, give every server the same MySQL or MariaDB database to share
  data between them; with H2, each server keeps its own file.

HikariCP and the JDBC drivers are downloaded by Paper when Artisan starts
(`libraries:` in its `plugin.yml`); your plugin does not need to ship any of
them.
