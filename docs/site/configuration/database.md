---
title: Database
description: Choose between the embedded H2 database and MySQL or MariaDB.
sidebar:
  order: 3
---

Artisan's menus and projects live in files, not in a database. The database is one
Artisan **lends** to the plugins of its suite (add-ons such as the shop) so they do
not each need their own configuration. Artisan keeps a few tables of its own there
(servers, project history, drafts, cooldowns, the values of Variables), and each plugin that asks gets its own connection pool.

## Which one

| | H2 (default) | MySQL / MariaDB |
|---|---|---|
| Setup | None | A database server and a user |
| Storage | `plugins/Artisan/database/suite.mv.db` | Your database server |
| Several servers | Not allowed | One shared database for the whole network, required |
| Use it for | A single server | A [network](../../network/concepts/) |

A network of several servers requires one MySQL or MariaDB database shared by all of
them: Artisan keeps the list of servers there, so any server can become the hub without
moving data. A leaf on H2 does not connect to its hub:

```
[Artisan] Not connecting to the hub: a network needs a shared MySQL or MariaDB database, this server uses H2 (database.type in environment.yml).
```

A hub on H2 refuses every leaf, and a leaf pointed at another database than the hub's is
refused too (`not on the hub's database` in both consoles).

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

## Table names

Every table starts with `database.table-prefix` (default `artisan_`): Artisan's own
(`artisan_servers`, `artisan_versions`…) and each plugin's (`artisan_quests_…`,
`artisan_auctions_…`). Leave it as is unless two separate installations must share one
database: give each its own prefix, such as `survival_` and `creative_`. Every server of
one network needs the same prefix; a leaf with another one reads another server list and
is refused by its hub (`not on the hub's database`).

Changing the prefix later does not rename anything. While the tables of the previous
prefix are in the database, Artisan and its plugins refuse to open it:

```
database.table-prefix changed from 'artisan_' to 'survival_', and the database holds the tables of 'artisan_': the suite would start empty. …
```

Set the previous value back, or rename the tables yourself, or delete
`plugins/Artisan/database/table-prefix` to start empty under the new prefix.

Pool size per plugin is `database.pool-size` in `environment.yml` (default 4). With N
servers and P plugins using the database, plan for up to N × P × pool-size
connections on the database server.

Restart the server after changing `database.*`. A pool that fails to open names the
plugin and the URL, and ends with
`Check the database section of plugins/Artisan/environment.yml.`

## Moving from H2 to MySQL

A server that ran alone on H2 keeps its project history when it switches to MySQL or
MariaDB: at the first start on the new database, Artisan copies its versions and drafts
from `plugins/Artisan/database/suite.mv.db` and logs
`Imported from the embedded database: … versions, … drafts`. This happens once, and only
if the new database has no history for this server yet. The H2 file is left untouched:
other plugins of the suite move their own data.

## Supported versions

| Type | `database.type` | Version |
|---|---|---|
| H2 | `h2` | Bundled (2.3) |
| MySQL | `mysql` | 8 or newer |
| MariaDB | `mariadb` | 10.6 or newer |
