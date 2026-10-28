# The server's disk is the only store — the backend no longer stores any Project content

**Status: superseded (phase F, 2026-10)** — the backend no longer exists; the underlying decision (the server's disk is the only store, the plugin the only writer) stands, served directly by the hub, drafts included. See [editor-web-server](editor-web-server.md).

**Status:** accepted (2026-08-12) — **nothing is implemented**. Revises
`files-first-source-of-truth` (decisions 2 and 6) and answers the open question
left by `module-config-screens` ("Live-only generalized to the canvas […] Dedicated
grill required").

## Context

**Revision 2026-09-26 — backend mirror, drafts and Versions**: see
[snapshot-mirror-and-backend-history](snapshot-mirror-and-backend-history.md).
For server projects, the backend keeps a disposable mirror of the snapshot,
the drafts and a history of Versions; decisions 1, 5 and 7 revised.

**Revision 2026-09-13 — server draft migration**: see
[project-storage-modes](project-storage-modes.md). The backend freezes drafts
per Project then verifies their copy in `.artisan/drafts/` before removing the
SQL rows. An old plugin provisionally keeps the SQL authority; a migrated
project requires the connected server and does not go back to that copy. Hosted
projects and the demo remain phases to come, not an availability announced here.

**Revision 2026-09-11 — backend drafts**: published content stays on the
Minecraft disk. The backend now keeps named, private working copies in
`project_drafts`, with base and revision. Autosave publishes nothing; explicit
publication reuses the plugin's compare-and-swap. This revises the exclusion of
persistent drafts without reintroducing a published bundle on the backend side.
See `entities.md` and `rest-endpoints.md` in `docs/architecture/`.

`files-first-source-of-truth` made files the truth *of form*: the backend
stopped storing a rich representation (`editorJson` demolished) to keep only the
file tree (`filesJson`). But it kept that tree as a **published copy**: the
plugin downloaded from the backend (`bundle_available` → `BundleDownloader`),
and the editor wrote to the backend. Two durable writers on the same truth.

Everything that has been costly since follows from this topology: `syncedHash`
and its three-branch state, `detectSyncAction` (LOCAL_ONLY / CONFLICT / `force`),
`sync_divergence`, the `SyncScanner` as a *correction* mechanism, and a hash that
had to agree to the byte between two implementations (Kotlin / TS) lest it
invent divergences. The note in `module-config-screens` already said so:
*"the sync machinery has been the project's first source of bugs"*.

Two findings unblocked the decision:

- **The target mechanism already exists and runs in prod, on one surface.** The
  Config screens read (`config_read`) and write (`config_write`) files through the
  WS hub; **the plugin writes the disk**, the backend relays. What is decided here
  is the generalization of this path to the canvas.
- **The owner removed the two constraints that made a backend store mandatory**
  (2026-08-12): history/restore *"is not the core of the product"*, and editing
  with the server off *"is not really necessary"*. The stated core: **easily
  configure one's menus/commands from a web editor instead of going through
  files.** Without these two constraints, nothing requires storing the content
  anywhere other than on the server.

## Decisions

1. **The backend stores no Project content.** `projects.filesJson`,
   `project_commits`, `project_branches` and the journal disappear. The backend
   remains indispensable for everything else — accounts, networks, servers and
   server keys, billing, the AI assistant, hosting the editor — and it **keeps
   storing binary assets and derived artifacts** (resource pack, 3D icons): they
   are not the config truth, and the RP must be hosted somewhere to be served to
   players. A finding that allows it: `filesJson` is a `Record<string, string>`,
   binaries were never in it.

2. **The server's disk is the only truth, the plugin its only writer.** The
   editor reads the tree when the Project is opened and writes on save, through
   the WS relay — `config_read` / `config_write` generalized. The backend only
   relays messages any more; it no longer has an opinion on the content.

3. **Writing happens on explicit gesture.** "Save" is the only moment a file is
   written. Unsaved changes live **in the page**, like in any editor: closing the
   tab without saving loses them. There is therefore **no persistent draft** —
   neither backend, nor browser, nor disk.
   *Rejected:* continuous autosave (status quo — a half-built menu goes live at
   every keystroke); a persistent draft on the backend side (reintroduces the
   stored state we are removing, for a need the owner does not claim); a browser
   draft (per-device, per-user, lost when the cache is cleared — real work in a
   fragile place).

4. **Collision: per-file compare-and-swap.** The save presents, for each file it
   writes, the hash it is based on; the plugin refuses to write if the file has
   moved since, and the editor opens a resolution modal **on that file only**. A
   file that is really contested **requires an explicit choice**: no silent
   default (the `?? "web"` of `mergeDivergence` was data loss disguised as
   ergonomics). Side benefit: writing becomes **per file**, where the current
   save sends the whole tree under an optimistic lock — two admins on two
   different menus stop giving each other 409s.

5. **History becomes a trash on disk.** Before each write, the plugin copies the
   old content to `.artisan/history/<path>/<timestamp>`, as a ring of the last N
   versions per file (N ≈ 20), automatically purged, read on demand through the
   plugin, **excluded from exports**. The `.artisan` prefix provides the right
   properties for free (outside the hash, invisible to the scan, already
   documented as metadata).
   Accepted limit: it is a **per-file** history. "Put this menu back as it was"
   works; "put the whole Project back to last night" does not.

6. **"Bundle" leaves the vocabulary** (CONTEXT.md, entry marked *retired*). There
   is no longer a hashed, announced or downloaded artifact — the Project's files
   on the server *are* the Project. The word survives for a while in the code
   (`/api/v1/bundles`, `computeBundleHash`, `BundleDownloader`) as a migration
   residue. *Why remove it rather than let it die:* a term that outlives its
   mechanism is a trap for the next session — human or agent — who will go and
   wire a nonexistent artifact.

7. **Server off: the Project does not open.** Not "read-only" — not at all, since
   the content comes from the plugin. The editor announces it as such.
   Corollary: the AI assistant and the builds that need the tree ask the plugin
   for it, and are unavailable with the server off.

8. **`boutique_additem` is inverted.** The protocol says today *"The plugin never
   writes project files"*: the backend patched `filesJson`. The module now writes
   its file to disk, and the editor sees it at the next read.

> **Revised 2026-08-14 — reload semantics (decisions 2 and 7).** `project_read`
> served the **disk**, and the `SyncScanner` reloaded the server on every file
> change. The state paid the cost of watching without the benefit: the server
> moved under the admin's feet (unlike any other Minecraft plugin, where an edit
> only applies at reload) **and** the editor was not live for all that — it saw
> nothing before a page reload. The worst of both.
>
> The plugin now keeps a **snapshot**: the raw bytes read at the last load.
> `project_read` and `project_list` serve it, so the editor shows **what the
> server runs**. A manual edit only applies at `/artisan reload`. The
> `SyncScanner` and the `poll-first-disk-sync` spec are removed.
>
> Three clarifications that make the model hold:
> - **raw bytes, not a parsed model** — the compare-and-swap compares bytes; a
>   re-serialized model would give the same ideas and other bytes, hence wrong
>   `base_hash`es (conflicts on intact files, or silent overwrites);
> - **writing stays CAS against the DISK**, not against the snapshot: this is what
>   catches an edit made outside the editor, at save time, through the conflict
>   modal;
> - **an unreadable Document appears in the snapshot** (it is taken before
>   parsing) and surfaces in `project_read_result.failed` with its reason. It can
>   therefore still be edited — otherwise a typo would lock the admin out — and
>   the editor finally says why it does not run, instead of making it vanish
>   silently as the server already did.
>
> *Accepted renunciation:* "an agent edits the files and it's live" becomes
> "…then `/artisan reload`".

> **Revised 2026-08-15 — persistent draft (decisions 3 and 7).** Decision 3
> excluded any persistent draft, 7 made a Project unopenable with the server off.
> The argument at the time was mostly about **cost**: a draft would have required
> building the reconciliation. It now exists — base, per-file compare-and-swap,
> conflict modal — and the draft reuses it as is, with no new machinery.
>
> What forced the revision: by removing autosave (decision 3), we made accidental
> loss much more expensive. Before, closing a tab cost at worst the 2 s of the
> debounce; after, a whole session. This was not compensated, and there was not
> even a `beforeunload` guard.
>
> The browser therefore keeps, per Project, the **base** and the **current tree**
> (`projectDraftStore`, ~43 KB for the biggest project measured):
> - **server reachable** — the draft is **resumed**: you find your work again on
>   reopening, as in any editor. The base stays the server's (it is what the
>   compare-and-swap presents), only the displayed tree comes from the draft.
>
>   *Revised 2026-08-16*: it was first **proposed** via a banner, in the name of
>   "never silently". The principle holds, but a full-width banner paid too much
>   for it — it occupied the screen permanently to say what a button is enough to
>   say. What now prevents confusing your draft with the server's state is
>   **Save** itself: active if there is something to write, inactive otherwise —
>   and the **Cancel** button next to it, which discards the draft and starts
>   again from what the server runs;
> - **server unreachable** — the draft opens for editing, badged with its age,
>   Save out of reach;
> - **saving** — unchanged: the per-file CAS does the rest, and the draft is
>   erased once the work has left.
>
> A permanent "unsaved" indicator goes with it: without it, nothing distinguishes
> a clean Project from a modified one.
>
> *Accepted limits:* per-device, per-user, dies with the cache — but this is no
> longer a regression, since without it everything is lost on reload. And
> staleness accumulates: editing offline for several days against an old base can
> produce conflicts on many files at once, hence the frank display of the draft's
> age.

> **Clarification of 2026-09-07 — assistant migration results.**
> The resumable flow keeps on the backend side a manifest of sources (identifiers,
> paths and hashes), the steps and the derived proposals produced by the AI.
> These are the assistant's checkpoints, not a copy of the Project nor an
> authoritative store. No permanent cache of the raw selected zMenu files, no
> full working copy of the Project is added by this flow.
>
> Proposals stay bound to their conversation, owner, Project and server; reading
> or replaying them publishes nothing. The user applies them explicitly to their
> draft, then **Save** uses the existing path to the server disk. A modified
> source requires a new analysis; a modified local target is never overwritten by
> applying a proposal.
>
> This extension of the [server import sources](../archive/specs/2026-09-04-assistant-server-import-sources-design.md)
> allows durable conversion results without changing the disk's authority or
> turning the imported sources into a backend backup.

## What disappears

`projects.filesJson` · `project_commits` / `project_branches` / `projectJournal`
· `bundlePublisher` / `POST|GET /api/v1/bundles` · `bundle_available` /
`BundleDownloader` as a sync channel · `detectSyncAction` / LOCAL_ONLY /
CONFLICT / `force` · `sync_divergence` / `divergence.ts` / the divergence
banner · `.artisan-sync.yaml` as arbiter · the `SyncScanner` as a correction
mechanism · the hash as a cross-language invariant.

What remains of the hash: a local content comparison for the per-file CAS
(decision 4). Nothing requires Kotlin and TS to produce the same tree hash any
more, so the `project-hash-conformance.json` vector stops being load-bearing.

## Consequences

- **This is a deletion epic, not an addition one.** Most of the work is removal
  across the three layers, plus porting the canvas to the WS relay. No new
  building block except the trash (decision 5) and the per-file CAS.
- **The catch: nothing works without the server online.** This is the explicitly
  accepted price. The editor must say so clearly at load, otherwise it reads as
  an outage.
- **The anti-lock-in promise is strengthened**: only one copy of the config
  exists any more, and it is at the admin's. `files-first-source-of-truth`
  targeted the *form* of the files; this ADR also makes them the *place*.
- **Migration of existing data**: the Projects living today in `filesJson` must
  be pushed one last time to the disk of the servers concerned before the column
  is removed. A Project whose server never reconnects is lost — to be handled as
  a dated operation, not as a deployment side effect.
- **`no-branch-conflict-resolution` stays intact**: per-file resolution
  (decision 4) is not a 3-way merge, it is a choice at file level.
- **`module-config-screens` §3 is confirmed and generalized**; its 2026-07-30
  revision ("a managed root is a versioned root", backend journaling after ack)
  **falls** with the journal.

## Rejected alternatives

- **Keep the backend copy by downgrading it to a derived cache** (single writer,
  shared draft, classification on a base at deploy). This was the intermediate
  proposal of this grill, and it held — but it was only justified by history and
  offline editing, both removed by the owner. Without them, it keeps all the
  storage cost for a benefit nobody asks for.
- **Read on demand but keep the draft in the browser.** Rejected in decision 3:
  per-device, per-user, lost when the cache is cleared.
- **A second gesture "activate for players" distinct from "save".** Ruled out:
  one destination, one gesture. To be reopened only if the need "prepare a
  rework without exposing it" really appears.
- **Store the content in an opaque database** — already rejected at the root by
  `files-first-source-of-truth`, and this ADR moves even further away from it.
