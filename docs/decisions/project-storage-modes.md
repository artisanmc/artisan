# Server and hosted projects: a single source of truth per project

**Status: superseded (phase F, 2026-10)** — no more hosted projects or backend storage: a Project lives on its server's disk. See [editor-web-server](editor-web-server.md).

**Status:** accepted on 2026-09-12. Phases 1 to 7 verified and deployed locally,
including keeping the demo in the browser and the Minecraft protocol chain. Final
smoke test passed and acceptance fixtures cleaned up. The execution plan
(`docs/superpowers/plans/2026-09-12-project-storage-modes.md`, removed on 2026-10-21, in
git history) carries the migrations, tests and delivery criteria.

Hosted storage now uses a durable volume, with a readable project directory in each
immutable revision and activation by atomic pointer. The same revision carries
published files, binaries, history and private envelopes: publishing a draft and marking
it published has a single activation point. A PostgreSQL advisory lock per root
serializes workers. The index checks the bytes on disk; an inconsistent manual change
causes an explicit error. Renaming moves the folder in a revision then reconciles the
shared SQL journal, keeping the internal anchor. Hosted projects keep their selected
Minecraft version in the SQL environment metadata, outside the manifest. The volume
backup/restore procedure (removed with it on 2026-09-28) describes the locks, the
exported SQL snapshot and the retention rules.

## Context

**Revision 2026-09-27**: hosting is removed for accounts, the demo becomes disposable
(export only) — see [server-only-projects](server-only-projects.md).

**Revision 2026-09-26**: server project drafts return to the backend side, with a
snapshot mirror and Versions — see
[snapshot-mirror-and-backend-history](snapshot-mirror-and-backend-history.md).
Decided direction: the hosted mode will be replaced by unlinked Servers.

The Minecraft disk suits projects linked to a server, but requiring a connected server
prevents discovering Artisan immediately or preparing a project before installation.
Two storage locations must share the same editor and the same business rules.

This decision revises the restriction of
[server-disk-only-storage](server-disk-only-storage.md) to server projects only. It
also provides for a guest exception confined to the demo with respect to
[accounts-only-editing](accounts-only-editing.md). These changes remain subject to the
plan's migrations and safeguards; the old flows remain valid as long as their
replacement is not verified.

## Decisions

### Authority and format

Each Project has a single active storage for its files, assets, history and drafts:
the Minecraft disk or the backend's durable volume. The file format is common. SQL
metadata serves identity, authorizations and indexes; it is not a second editable
representation of the content. Binaries stay files.

Server drafts are destined for `.artisan/drafts/`, excluded from ordinary reads and
from published content. Their migration preserves owners, revisions and content before
any removal of the backend copy. The browser's local fallback protects input and does
not become a third active storage.

The transition keeps the historical results of SQL mutations for 24 h after the
switch, only to replay a lost ACK. They are immutable and are never used as a content
source; expiry replaces them with an `operation_expired` marker, without replaying the
mutation on the server. The plugin's private receipts and blobs are kept with its
journal; no automatic retention is guaranteed yet. Backups and future quotas must count
`.artisan/`, including drafts, blobs, receipts and revocation markers.

### Interfaces and capabilities

A `ProjectStorage` interface defines the common operations. The `ServerProjectStorage`
and `HostedProjectStorage` adapters are composed with the business services. A central
resolver chooses the storage from the project's authorized location; the browser
cannot impose this choice.

The editor receives a common context and client. Functional differences go through
explicit capabilities, such as live data or in-game capture. Components, autosave and
business rules do not multiply branches on the storage type. Common contract tests
verify the adapters.

### Identity and add-ons

For a regular project, the folder name determines the ID on the files side;
`projects.id` remains an immutable backend anchor. The manifest no longer has authority
through `project_id`. Renaming by the editor preserves links; a manual rename is
discovered as a new identity.

An add-on durably keeps its explicit ID through the stable API
`register(projectId, dir)`, independent of the folder. The resolver passes this
identity to the rest of the system; these projects cannot be renamed in the editor.
The target ID of the Shop project is `boutique_addon`. Its migration from
`boutique_shop` must preserve the internal identity, links and drafts, without
renaming the module, its namespaces or its folder by convention.

### Access, hosting and copy

The general interface stays accessible without Minecraft. Opening a server project
requires a connected server; an outage preserves input and suspends saves until a
resume with conflict checking. Authenticated hosted projects belong to a Network and
work without a server.

"Copy to a server" creates an independent project from a frozen revision, assets
included. This operation does not create a permanent sync between the two projects and
does not publish a partial copy in game.

### Anonymous demo

A demo without an account owns an isolated temporary project stored on the backend,
with its files, assets and drafts. An opaque HttpOnly cookie makes it possible to find
it again in the same browser. The browser is not the main storage.

The demo expires after **24 hours of effective inactivity**, configurable. Effective
mutations renew this delay; polling or a heartbeat does not extend it. The backend
provides `expiresAt` to the interface. Clearing the cookie or changing browser does not
allow finding the same demo again.

Signing up or logging in allows claiming the demo in an authorized Network, preserving
content and draft and removing the demo expiry. The claim and the purge must be
coordinated and idempotent. Guests have no access to servers or to billed AI. Default
quotas are one project per session, 20 MiB and 1,000 physical files, staging, history
and drafts included.

## Consequences and delivery

Hosted storage requires joint backup and restore of the volume and the metadata, quota
control and purging of expired sessions. Both modes need the same guarantees of
isolation, CAS, atomicity and resumption.

Delivery is progressive: contracts and identity, server drafts, authenticated hosting,
copy to Minecraft, then demo. Each switch must verify the data before deleting an old
copy. A rollback preserves the data and does not reactivate an obsolete source of
truth.
