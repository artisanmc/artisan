# Snapshot mirror, drafts and Versions on the backend for server projects

**Status: superseded (phase F, 2026-10)** — the backend, its mirror, its drafts and its Versions are removed; drafts are back on the server's disk. See [editor-web-server](editor-web-server.md).

**Status:** accepted (2026-09-26) — steps 1 to 4 implemented on 2026-09-27 (mirror and Projects list, Versions, backend drafts with conflicts on open, opening with the server off). The "Unlinked Servers" epic remains to be done. Revises
[server-disk-only-storage](server-disk-only-storage.md) (decisions 1, 5 and 7) and
[project-storage-modes](project-storage-modes.md) (server drafts in
`.artisan/drafts/`) for server projects only.

## Context

**The engine is long-term product coherence, not performance** (the owner,
2026-09-26). The intended split: the Minecraft server owns what is **published**,
since that is what it runs; the backend owns everything that is **work** — drafts,
restorable "git-like" history, access to the Project with the server off, and
eventually unlinked Servers that replace hosted projects. Putting private work on
the disk of a server that does nothing with it before publication was the
incoherence.

`server-disk-only-storage` had ruled out "keeping the backend copy as a derived
cache" because it only served history and offline editing, then judged non-essential.
The owner now asks for them. Faster reads (at least three WS round trips to the plugin
on each open today) are a side benefit.

## Decisions

1. **Snapshot mirror.** The backend keeps, per `(server_key_id, folder)`, the
   plugin's snapshot (**Snapshot** in the glossary): the bytes loaded at the last
   startup or `/artisan reload`, that is, what the server runs.
   "Mirror" designates the backend copy, which may be behind; it is an implementation
   term, absent from the glossary. Not the disk continuously: a manual edit only enters
   it at reload (semantics unchanged since the removal of the `SyncScanner`).

2. **Valid only if its hash equals the last announced hash.** The `hello` carries each
   Project's snapshot hash (capability `snapshot_mirror_v1`); `projects_reloaded`
   remains the in-session signal. A mismatch triggers retrieval of the changed files
   only. As long as the hashes match, reads are served without a round trip. An editor
   write waits for the ack (which carries the new hash) before answering. A plugin
   without the capability keeps the current path: the mirror is ignored, never trusted.

3. **The mirror is disposable.** It is never an authority nor a compare-and-swap base:
   publication remains a per-file CAS against the disk. Emptying the table loses
   nothing.

4. **Server project drafts return as a backend source of truth.** A draft is private,
   unpublished work; the server does nothing with it before publication. The migration
   reverses that of 2026-09-13 with the same protocol (freeze, copy, verification, then
   removal of `.artisan/drafts/`).

5. **Per-file conflict resolution, when the draft is opened.** The draft's base is
   compared to the current mirror. File modified only on the server side: the draft
   takes the server version and its base advances, silently. Modified on both sides:
   conflict on that file, explicit choice. Same computation when the open editor
   receives `projects_reloaded`. Grain = file, including `lang/*.yaml` and
   `.artisan/editor.yaml`: false conflicts on these shared files are an accepted cost,
   to be reviewed on usage.

6. **Versions in the database, the disk trash disappears.** Each received snapshot
   that differs from the previous one becomes a Version (date, author: the user who
   published or the server after a manual edit, hash). Content-addressed storage:
   path → hash manifest, each content stored once. Views per file and per Project.
   **Restoring publishes nothing**: the Version goes into the draft, published
   normally afterwards. `.artisan/history/` is no longer fed and its content is not
   imported. Several manual edits between two reloads form only one Version.

7. **Server off: the Project opens.** From the mirror, badged with the date of the last
   snapshot. The draft stays editable. Publication, live data, in-game capture remain
   unavailable. Nothing is purged for a server that does not come back: mirror, drafts
   and Versions live as long as the server key exists.

## Consequences

- **History lives only in the backend.** Losing the database loses the Versions, never
  the published content. PostgreSQL backups become carriers of user value.
- **The browser cache `projectCacheStore` loses its reason to exist** and can be
  removed once the mirror is in place. The draft's local fallback (`projectDraftStore`)
  stays.
- **`no-branch-conflict-resolution` holds**: no content merge, one choice per file.
- **Hosted projects out of scope.** They keep their volume and their revisions; the
  editor presents the same Versions view for both modes behind `ProjectStorage`.

## Decided direction, next epic

*Settled on 2026-09-27: [server-only-projects](server-only-projects.md) (disposable demo, no attachment).*

Hosted projects have no reason to exist any more: an **unlinked Server** (key
created, never `/artisan link`) carries Projects made of drafts alone, and
publication creates the files at first link (CAS base `null`). Order:
(1) this ADR, (2) unlinked Server carrying drafts, (3) migration of existing hosted
projects, fate of the demo, then removal of the hosted mode. Demo and migration of
hosted projects remain to be settled.

## Measurement (2026-09-26, local stack, `projet_test`)

| Isolated request | Duration |
|---|---|
| `GET …/drafts` (list, via plugin) | **2.4–2.8 s** (4.6 s cold) |
| `GET …/drafts/:id` (one draft) | 154 ms |
| `GET …/files?if_hash=` (tree, via plugin) | 23–43 ms |
| `GET …/items` (backend alone) | 26 ms |

The drafts list dominates. The plugin re-reads and parses **all** the Project's
`draft.json` files (21 drafts, 20 of them published and kept, ~140 KB each, 3 MB), then
returns the active drafts **with their full snapshot** (142 KB for a list). The local
disk is a Windows bind mount, slower than prod; in prod, each request via plugin also
pays the backend ↔ Minecraft server network round trip, which the mirror removes.

No provisional fix on the plugin side: the code would be thrown away with the return of
drafts to the backend side.
