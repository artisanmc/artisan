# Hosted project backup and recovery

`HOSTED_PROJECTS_DIR` is a durable volume, independent of the disposable asset cache.
Compose mounts the named `hosted-projects` volume at `/var/lib/artisan/projects`.
Outside Compose its default is `backend/data/hosted-projects` when started from
the backend directory. Never remove this volume as a cache-cleaning operation.

Each opaque root contains `current` and immutable `revisions/<uuid>/`. Within a
revision, `<folderName>/` is the ordinary project tree: public YAML and binary
assets, `.artisan/editor.yaml`, and private `.artisan/drafts/` and
`.artisan/history/`. `state.json` beside that directory indexes content hashes,
the logical folder and operation receipts. It contains no binary payloads.
The manifest has no `project_id`. Only private opaque draft IDs use filesystem
encoding when Windows cannot distinguish or represent their logical spelling.

## Create one coordinated backup

Install PostgreSQL client tools matching the server major version. From
`backend/`, with the backend's `DATABASE_URL` and `HOSTED_PROJECTS_DIR`:

```sh
bun run scripts/backup-hosted.ts /backups/artisan-2026-09-13
```

For local Compose without native PostgreSQL clients, append
`--docker artisan-postgres-1`; the script streams `pg_dump` from that container.
The database URI must resolve to the same PostgreSQL server inside the container.
TLS and other libpq connection parameters are preserved through a private temporary
libpq service file; credentials never appear in process arguments. Docker receives
that file through stdin and removes its temporary copy after `pg_dump`.

The destination must not exist and must be outside the hosted volume. The script
holds the shared creation/maintenance lock and every hosted root lock, exports
a PostgreSQL snapshot for `pg_dump`, and copies the entire volume before releasing
the locks. Hosted writes pause during the copy. Reads may pause too. An incomplete
directory has no final `backup.json`; do not treat it as a usable backup.
`PG_DUMP_BIN` can select a locally installed `pg_dump` executable.

Protect the backup as account-private data: drafts retain their original opaque
owner IDs. A copied project must never be reassigned to its discoverer. PostgreSQL
is required because it preserves users, Network memberships, immutable project
anchors, selected Minecraft versions, rename intents and deleted-owner tombstones.
A public ZIP export is not an administrative backup.

## Restore

Stop all backend workers and maintenance processes. Restore `database.dump` with
`pg_restore` into an empty PostgreSQL database, and restore `hosted-projects/` into
an empty durable hosted volume. Use the same complete backup set for both; do not
merge unrelated SQL and filesystem snapshots. Configure the new database and
volume locations, run forward migrations, then start the backend.

On opening a root the adapter validates paths, symlinks, indexed bytes and hashes.
Only the revision selected by `current` is visible. A staged but unactivated
revision is abandoned; an activated revision includes its publication receipt and
terminal draft envelope. Pending rename intents replay idempotently during
maintenance, reconciling SQL with the actual directory before fresh use.

Verify a hosted project, a binary asset, history, and a private draft using its
original owner account. The automated restore contract deletes and reinserts SQL
project metadata and restores a complete volume into a different location before
resolving the immutable project and reading those contents.

## Retention and maintenance

Every write stages a full revision; capacity planning must include this transient
second copy, history and private blobs. Once activation succeeds, older complete
revisions and abandoned stages are collected under the project lock. The current
revision retains every referenced draft, blob, history entry and operation.
Response bodies replay for 24 hours, then become non-replayable operation
fingerprints; reusing an expired operation ID returns `operation_expired`, never
reexecutes it. These small tombstones remain for the project's lifetime.

The storage's `beforeActivate(usage)` hook runs under the root lock and reports
published bytes, staged bytes, total root bytes and staged physical file count.
It includes private blobs/history/receipts and the transient revision copy. A
rejected activation removes its staging directory without changing confirmed
content; abandoned crash stages are collected before another commit. Guest quota
policy can bind this hook without introducing storage branches into editor code.

Guest policy now uses this hook. `DEMO_MAX_BYTES` (20 MiB), `DEMO_MAX_FILES`
(1,000), and `DEMO_GLOBAL_MAX_BYTES` (512 MiB) count retained physical data plus
the staged revision. `DEMO_MAX_SESSIONS` (1,000) caps active/protected sessions;
`DEMO_CREATIONS_PER_HOUR` (5 per hashed client key) and
`DEMO_MUTATIONS_PER_MINUTE` (60 effective changes per session) are shared across
workers. Reads and retries do not extend `DEMO_TTL_HOURS` (24).
`DEMO_MINECRAFT_VERSION` defaults to `1.21.4`; new sessions require its exact local
item catalog before creation. Existing sessions retain their selected version.
The canonical `backend/src/templates/demo-project.json` ships inside the backend image.

Back up demo SQL rows and `demo_*` roots in the same coordinated snapshot.
Claiming sessions are protected from TTL purge; a blocked claim remains available
to its authenticated owner. Claimed roots retain their IDs and use ordinary hosted
retention, while leaving the guest capacity budget. An unreadable demo root is
reported without preventing maintenance of healthy projects.

Expired guest metadata remains for 24 hours after durable revocation, then maintenance
removes its project and session rows (including token and client-key hashes) after
confirming physical cleanup. Failed cleanup retries retain the tombstone. This does
not apply to claiming or claimed sessions and does not renew guest access.

Committed deleted-owner SQL tombstones drive private draft and receipt-payload
purges. Account transaction rollback cannot erase filesystem drafts. Deleted
project roots remain retired for 30 days; roots orphaned by deleted Networks or
failed creation remain for at least 24 hours. Collection only touches containers
generated by this lifecycle and serializes with creation. Run restore with workers
stopped so a partially restored volume cannot be mistaken for abandoned data.

Hosted revision directories are managed immutable snapshots. Manual mutation of
an active revision is detected as a content mismatch; restore a coordinated backup
or import the edited public project through the API instead of editing its index.
