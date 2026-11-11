# Identity of servers and projects, Versions and drafts in the suite's database

**Status:** accepted (2026-10-13). Nothing is implemented. Revises
[editor-web-server](editor-web-server.md) ("Versions (empty)", drafts on disk) and
[suite-foundation-database](suite-foundation-database.md) (network tolerated on H2).

## Context

With phase F, the cloud backend and its Versions are gone
([snapshot-mirror-and-backend-history](snapshot-mirror-and-backend-history.md)): the hub
returns an empty list of Versions, `.artisan/history/` is no longer fed, and nothing
records who published what. The hub only keeps its servers in memory: a server that is
off during a hub restart disappears from the editor, and its projects answer
`503 server_offline`. A server is identified only by its name, a project only by its
folder: a rename breaks everything attached to it. The suite is going to store data tied
to a server (MSCore locations, analytics), as Plan does with a servers table and a UUID
file.

## Decisions

1. **One Version per Snapshot that differs from the previous one.** A publication from
   the editor gives a Version signed by the player; a hand edit loaded at startup or by
   `/artisan reload` gives a Version with no author, marked "modified on disk". A reload
   with no change records nothing.
2. **Hash-addressed contents in the database, text and binaries.** A Version carries a
   path → hash manifest; each content, text or binary, is stored once in a contents table
   shared by Versions and drafts, whatever the number of Versions that reference it. The
   disk remains the authority on what the server runs; the database keeps a durable copy
   of it, fed at each Snapshot with the new hashes only. The hub thus serves the assets
   of any server without a WebSocket relay, server off included. Model taken from the
   backend (`project_versions` + `snapshot_blobs`, migration 0058), extended to binaries
   like the backend's asset cache ([assets-on-server-disk](assets-on-server-disk.md)),
   but durable.
3. **Network = MySQL or MariaDB.** As soon as a server links to a hub, the suite's
   database is shared: a linked server on H2 refuses to start its link, a hub on H2
   refuses the servers that link to it. An `artisan_meta` row carries a database
   identifier generated once; each server announces it to the hub, which refuses a
   different database. Each server writes its own Versions. Changing hub moves no data.
   A lone server keeps H2. Amended 2026-10-14 (issue #42): the database opens off the
   main thread, on `Artisan-versions`, before the first Version; until it is open, the
   hub answers "unavailable" (drafts `storage_error`, relay to the server for the rest,
   leaves asked to retry) and a leaf waits for its database before `hello`.
4. **Server id.** A UUID generated at first startup in `plugins/Artisan/server-id`
   identifies the server; `artisan_servers (id, uuid UNIQUE, name UNIQUE, last_seen, …)`
   is updated at startup and the other tables reference `artisan_servers.id`. The `name`
   (the Velocity name) is an attribute: a renamed server, including when its default name
   changes with its folder, keeps its row. Amended 2026-10-14 (issue #43): the server id
   is the server's identity throughout the hub, the hub's own server included — routes
   `/api/v1/servers/:server`, `server_key_id`, the prefix of Project ids
   (`<server id>.<folder>`), keys of `Servers`, `LoadedProjects`, `ProjectHistory` and
   `DraftStorage`, `hello_ack.server_id`. The `local` sentinel of the hub's server and
   `proxy_name` as a leaf's identity disappear; a `hello` without `server_uuid` is
   refused, and the name `local` is no longer reserved.
5. **Copied `server-id`.** Each server refreshes `last_seen` every minute. At startup, a
   row with the same UUID under another name seen less than two minutes ago signals a
   copy: refusal, with the name of the running server and the steps to follow (delete
   `server-id`). Otherwise it is a rename, logged.
6. **The binaries of an old Version are in the database** (decision 2): a Version is
   restored whole, even after a manual deletion. No storage on disk.
7. **Unlimited retention** to begin with, without purging.
8. **Restoring loads a Version into a draft**, then published normally: publication
   remains the only write path. A "Restore and publish" button chains the two. The
   Version created notes the restored Version.
9. **Author = the player's UUID + username at the time of publication**, copied into the
   Version.
10. **In-house, forward-only schema migrations**, modeled on MSQuests: numbered
    migrations, table `artisan_schema_version`. Each migration receives the
    transaction's connection; one DDL statement per migration, and an `applied`
    predicate read from the JDBC catalog for those MySQL cannot replay (`ADD COLUMN`,
    `CREATE INDEX`, `ADD CONSTRAINT`), since MySQL auto-commits DDL and can leave a step
    applied but unrecorded; `GET_LOCK('artisan_schema_version')` around the application
    on MySQL/MariaDB, result checked (lock refused = error, not a go).
    Amended 2026-10-14 (audit v2, problem 5).
11. **Moving from H2 to MySQL.** At first startup on MySQL, Artisan imports its own
    tables from the suite's H2 file, reassigning ids by UUID. Nothing is imported once
    the `imported:<server id>` mark is set in `artisan_meta`, in the same transaction as
    the import: a failed import is rerun at the next startup, a completed import is never
    rerun, whatever the server has recorded since (amended 2026-10-14: the "already has
    Versions" guard orphaned the H2 history after a failure). The H2 file, shared with
    the other plugins, is neither renamed nor deleted. The other plugins migrate their
    tables themselves.
12. **Drafts in the database, editing with the server off.** A draft references the same
    contents table (text and added binaries). A project of a server that is off opens
    from its last Version, assets included, and its draft stays editable; publishing,
    live data and in-game capture wait for the server. Publication keeps its
    compare-and-swap on the files; the draft is marked published afterwards, and an
    interrupted publication is resolved at startup through the receipts in
    `.artisan/transactions/`. The receipt of a database operation does not keep the
    draft's body (the replay re-reads the draft); closed drafts and receipts are purged
    after 30 days (amended 2026-10-14).
13. **No import of the drafts of `.artisan/drafts/`**: only a dev server has any.
14. **Project id.** A UUID generated once in `.artisan/project-id` (written by the
    plugin alone: the editor rebuilds `editor.yaml` whole and would erase it) identifies
    a project; Versions and drafts reference it, a renamed folder (editor or by hand)
    keeps them. A copied folder that arrives with an id already present on the same
    server receives a new one, with a warning. An Add-on project keeps the identity of
    its manifest.
15. **The editor reads from the database.** A project's tree, text and assets come from
    its last Version (which is the Snapshot), like drafts, history and the list of
    servers, server on or off. The server is only called on to publish (compare-and-swap
    on its disk; the load that follows records the Version) and for live data (captures,
    placeholders, data sources, previews). The publication response goes out **before**
    the reload and the Version, written asynchronously on the `Artisan-versions` thread;
    the editor re-reads on the `projects_reloaded` broadcast, emitted once the Version
    and the loaded state are recorded (amended 2026-10-14: the response does not carry
    the Version's hash, and the state is not written if a Version of the load failed).

Future server-tied data (locations, analytics) lives in its own tables, owned by their
module, which reference `artisan_servers.id`; `artisan_servers` stays a narrow pivot.

## Rejected options

- **Binaries only on disk** (copy to `.artisan/blobs/` at replacement): each preview of
  a linked server crosses the WebSocket, a server that is off has no more assets, a
  manually deleted binary is lost to the history. The feared weight in the database does
  not exist: hash-addressed, each asset is stored only once.
- **Everything on disk**: no history for a server that is off, no network view.
- **The hub writes all Versions into its database**: works on H2, but the whole
  network's history lives on the hub's machine; changing it or losing it loses
  everything.
- **Name as identity, rename by command**: a hand-edited `name` or a folder name that
  changes silently creates a new server and orphans its data.
- **Flyway**: several hundred KB to embed and relocate for three tables.

## Consequences

- A lone server that joins a network must install MySQL or MariaDB; this is now an error
  at startup, no longer a warning.
- Database backups carry the user's value (history, work in progress), no longer only
  game data.
- The editor must open a project without its server: canvas from the database, without
  live data.
- The database carries a copy of every asset ever loaded: a few MB to a few tens of MB
  per project, growing with distinct assets, not with Versions.
- MSCore's `SLocation` keeps the name in clear: Velocity routes by name. MSCore will be
  able to read this name from `artisan_servers` through the API instead of its
  `servername` key.
