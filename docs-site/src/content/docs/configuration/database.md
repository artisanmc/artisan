---
title: Database
description: Choose between the embedded H2 database and MySQL or MariaDB.
sidebar:
  order: 3
---

Artisan's menus and projects live in files, not in a database. The database is one
Artisan **lends** to the plugins of its suite (add-ons such as the shop) so they do
not each need their own configuration. Artisan itself creates no tables, and each
plugin that asks gets its own connection pool.

## Which one

| | H2 (default) | MySQL / MariaDB |
|---|---|---|
| Setup | None | A database server and a user |
| Storage | `plugins/Artisan/database/suite.mv.db` | Your database server |
| Several servers | Each server keeps its own data | One shared database for the whole network |
| Use it for | A single server | A [network](/wiki/network/concepts/) whose add-ons must share data |

In network mode with H2, every leaf logs at startup:

```
[Artisan] Network mode with an H2 database: each server keeps its own suite data. Use MySQL or MariaDB to share it.
```

## Configure MySQL or MariaDB

In `plugins/Artisan/environment.yml` (same values on every server that must share data):

```yaml
database:
  type: "mariadb"        # or "mysql"
  host: "10.0.0.20"
  port: 3306
  name: "artisan"
  user: "artisan"
  password: "${ARTISAN_DB_PASSWORD}"
```

Create the database and the user first, for example in MariaDB:

```sql
CREATE DATABASE artisan CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'artisan'@'10.0.0.%' IDENTIFIED BY 'change-me';
GRANT ALL PRIVILEGES ON artisan.* TO 'artisan'@'10.0.0.%';
```

The user needs to create tables: the add-ons manage their own schema.

Pool size per plugin is `database.pool-size` in `config.yml` (default 4). With N
servers and P plugins using the database, plan for up to N × P × pool-size
connections on the database server.

Restart the server after changing `database.*`. A pool that fails to open names the
plugin and the URL, and ends with
`Check the database section of plugins/Artisan/environment.yml.`

## Supported versions

| Type | `database.type` | Version |
|---|---|---|
| H2 | `h2` | Bundled (2.3) |
| MySQL | `mysql` | 8 or newer |
| MariaDB | `mariadb` | 10.6 or newer |
