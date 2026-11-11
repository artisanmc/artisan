# Server-only projects — hosting is removed, the demo is disposable

**Status: superseded (phase F, 2026-10)** — the demo and the backend are removed; only server projects remain. See [editor-web-server](editor-web-server.md).

**Status:** accepted (2026-09-27) — implemented: step 1 on 2026-09-27, step 2 on 2026-09-28. Revises
[project-storage-modes](project-storage-modes.md) (hosted projects, demo claim,
"Copy to Minecraft", hosted ZIP import) and fills in the direction left by
[snapshot-mirror-and-backend-history](snapshot-mirror-and-backend-history.md).

## Context

The hosted mode answered "prepare a Project without a server" and "keep the demo
after signing up". Since drafts, Versions and the Snapshot live in the backend, an
**unlinked** Server can carry Projects made of drafts: the second storage no longer
brings anything. Nobody used it in prod.

## Decisions

1. **Every account Project belongs to a Server**, linked or not. No more hosted
   projects, no more "Copy to a server". No migration: no real hosted project in prod.
2. **Creating a Project on an unlinked (or offline) Server is allowed**: it is born
   with an empty draft. Its first publication, once the server is linked, creates the
   folder on disk; an already existing folder is a normal conflict (existing modal).
   Attaching never publishes anything.
3. **The demo is disposable**: no claim into an account (`claiming`/`claimed` states,
   Network choice dialog, idempotent resume — removed). It expires after 24 h of
   inactivity; you keep it by **exporting** it as a ZIP.
4. **ZIP import is removed** with hosting, of which it was the only target. It will come
   back later, towards a Server, as a new Project in draft.
   *Reinstated on 2026-09-30:* the import targets a Server, identifies the Project by
   the ZIP's folder name, and drops the result into the **draft** (creation or update).
   Merge or overwrite as chosen; conflicts are settled file by file against the current
   snapshot (backend mirror), with a "keep this choice for all following files"
   checkbox. See `docs/site/editor/projects.md` and `editor/src/features/import/`.

*Rejected:* attaching the demo to a server at deploy time (machinery for simple demos,
which an export covers); publishing directly at import (unreviewed write on a running
server); keeping the import on hosting (maintains the second storage for a single entry
point).

## Delivery

1. Remove hosting on the accounts side: section, creation, copy to Minecraft, ZIP
   import, demo claim; allow creation on an unlinked Server. The demo temporarily stays
   on hosted storage.
2. Move the demo to the database: a demo Project only has a draft (`project_drafts`,
   `project_draft_blobs`), publication disabled, export from the draft, cascading
   expiry. Then remove `HostedProjectStorage`, the volume, its maintenance and its
   backup procedure.
