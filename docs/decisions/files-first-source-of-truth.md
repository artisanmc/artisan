# Files-first — the Project's file tree is the single source of truth

**Status:** accepted (2026-07-23) — implementation in progress: P0 format
ergonomics + P1 (`.artisan/editor.yaml`, offline assets) + P2 (template/model
files) shipped 2026-07-23; **P3a shipped 2026-07-24** (decision 2 done —
`editorJson` demolished, the backend stores only the file tree; the editor
parses/serializes it via `projectFromFiles`/`transform`, locked by a
fixed-point round-trip test); **P3b shipped 2026-07-24** (decision 6 partial —
periodic content scan + auto-push on LOCAL_ONLY, atomic
downloads); **P3c shipped 2026-07-24** (decision 6 complete — true divergence
is reported via `sync_divergence`, held unpushed and unoverwritten, and
resolved per file from the editor banner; note: the "existing merge engine"
this ADR referenced was removed 2026-06-17, so resolution is per-file
disk/web selection, not 3-way — cf. `no-branch-conflict-resolution.md`).
The files-first epic's storage/sync decisions (2, 3, 6, 7) are all live.

> **Revised 2026-08-12 by the ADR `server-disk-only-storage` — decisions 2 and
> 6.** This ADR made files the truth of *form* while leaving the backend
> holding a **published copy** (the plugin downloaded from it), hence two
> durable writers — hence `syncedHash`, `detectSyncAction`, `sync_divergence`
> and the two-implementation hash. The new ADR makes the server's disk the
> **only** store: the backend no longer stores any Project content, the plugin
> is the only writer, and the editor reads and writes through the WS relay on
> explicit gesture. Decision 2 ("one representation everywhere") becomes "one
> *location* everywhere"; decision 6 (divergence detection, "no overwrite in
> either direction") becomes moot — there are no longer two sides to diverge,
> only a per-file compare-and-swap at write time. Decisions 3, 4, 5 and 7 (file
> forms, i18n, `menu/v1`, offline assets) remain in force.
> offline) restent en vigueur.

## Context

A feature request (a "code mode" showing a Document's YAML beside the visual
editor) escalated into the storage question: should Artisan's objects live in
human-visible files on the server, or in an opaque database? Three forces
resolved it:

- **Trust / anti-lock-in.** Admins seeing their menus as real files on their own
  server — readable, editable, working without Artisan — is an adoption
  argument: "if Artisan shuts down, we keep everything."
- **The owner's own workflow.** Quick fixes by editing a file on disk beat
  opening a web editor; and AI harnesses (Claude Code et al.) natively edit
  files — a product whose config is agent-editable has a structural advantage.
- **A backend-less audit (2026-07-23)** showed the plugin is already disk-first:
  menus/commands/dialogs/i18n/data sources render fully offline from disk;
  offline mode is a documented config state (`server_key: ""`). The gaps are
  narrow (assets, below).

But today's file tree is a **lossy projection**: Item templates are inlined into
each bound element at export, Data models are denormalized into each source
file, and board curation (`editor_layout`/`editor_edges`) hides inside
`manifest.yaml`. The backend keeps a parallel rich representation
(`editorJson`) beside the file tree (`filesJson`) — two truths. And a disk edit
is overwritten by the backend on reconnect unless the admin remembers
`/artisan pushLocal` — a data-loss trap on what we now declare the primary
editing path.

## Decision

1. **Files are the canonical, lossless source of truth.** Everything authorable
   has a file form. The product promise is two-level: the *runtime* survives
   Artisan's disappearance (already true) **and** *editing* survives — the file
   tree is primary; the web editor is a secondary (but selling) client.

2. **One representation everywhere.** The backend stores, commits, and merges
   the **file tree** (its commit storage is already file-based). The editor
   parses files → domain on open and serializes domain → files on save.
   `editorJson` is demoted to a derived cache or removed. *Rejected:* keeping
   dual canonical representations with bidirectional converters — proven
   divergence risk (cf. the duplicated-hash incident of 2026-06-17).

3. **File forms for the formerly editor-only concepts:**
   - **Item templates** → `templates/<id>.yaml`, **runtime-resolved by the
     plugin**: menu elements carry a `template` ref instead of inlined
     appearances, so hand-editing a template propagates to every menu using it.
     *Rejected:* keeping inlining with an editor-only annotation — two copies of
     one truth inside the same tree.
   - **Data models** → `models/<id>.yaml`, **ignored by the plugin** (sources
     stay denormalized and self-contained for runtime; models only type them).
     > **Revoked by the ADR `bare-data-files` (2026-07-26)**: the plugin reads
     > `models/` at load to type bare project-authored sources (same move as
     > the P2a template resolution, still offline).
   - **Editor presentation state** (board layout/edges) moves out of
     `manifest.yaml` into **`.artisan/editor.yaml`** — hash-excluded (the
     `.artisan` prefix filter already exists), so cosmetic board moves no longer
     republish a Bundle and redeploy the server; still included in exports so a
     Project travels whole.

4. **i18n on disk — the hybrid policy becomes the format contract** (was:
   export optimization, `feat/hybrid-inline-i18n`): an untranslated field is an
   **inline literal** (single-language project ⇒ 100 % literals, zero `lang/`
   files); a translated field keeps `{i18n:key}` + `lang/<code>.yaml` entries
   (still disk-local, just multi-file). *Deferred, not rejected:* a per-document
   inline `translations:` block — would require plugin-side positional key
   derivation, a fragile cross-language lockstep invariant.

   **Amendment 2026-07-30 — `lang/` files are trees.** A language file is
   written as a tree (each `.` of the key = one level) rather than one full
   dotted key per line: this is the form that is readable and hand-editable,
   consistent with "files are the truth". Runtime addressing stays the dotted
   key — the `nestLangTree`/`flattenLangTree` codec
   (`editor/src/lib/langTree.ts`, Kotlin mirror `LangFlattener`, vector
   `testdata/lang-tree-conformance.json`) is purely a file form. Reading
   tolerates all three forms (tree / legacy flat / mixed): nothing to migrate,
   the first save re-nests. Accepted edge case: `a.b` and `a.b.c` cannot
   coexist in the tree — the blocked key stays dotted at the root (never lost),
   byte order decides which one nests. *Rejected:* flattening shorter (2-3
   levels then dotted keys) — two rules to remember instead of one.

   **Amendment 2026-08-03 — inline is a project MODE, addressed per site.**
   The hybrid policy above was *per field*: a translated text kept its
   `{i18n:key}`, so a multi-language project became unreadable as soon as
   something was translated. The effective contract is now *per project*, with
   two forms the plugin accepts when reading:

   - `extract` (default, status quo) — `{i18n:key}` in documents, **all**
     languages in `lang/`, the default language included.
   - `inline` — the document carries the **default-language literal**, where you
     read it; the **other** languages live in `lang/<code>.yaml` at the site's
     **canonical address**, and there is **no** `lang/<default>.yaml` file (it
     would be a second copy of the same truth). A single-language project ⇒ zero
     `lang/` files, exactly the initial promise.

   What makes the mode possible without keys in the file: **the address is
   re-derived from the structure**. The editor mints it when writing
   (`domain/i18nSites.ts`, `lib/i18nKeys.ts`), the plugin recomputes it when
   reading (`engine/I18nAddresses.kt`, `MenuTitleParser`, `DialogTextResolver`)
   — two implementations locked by the shared vector
   `testdata/i18n-address-conformance.json`. Runtime resolution has three
   stages: explicit `{i18n:key}` ref → canonical address → literal as written.
   Both modes therefore read interchangeably, including mixed in one
   hand-edited file.

   The mode is a choice of **file form**, not of content: it is persisted in
   `.artisan/editor.yaml` (`i18n_mode: inline`, hash-excluded) and only when it
   departs from the default. It is the same move as bare data files (ADR
   `bare-data-files` ④), generalized to menus / commands / dialogs.
   *Rejected:* inferring the mode from the content at import — a file can be
   mixed, and "it's what you chose" beats a guess.

   **Amendment 2026-09-30 — structural texts are field-local.** The ADR
   `field-local-translations` replaces the `extract`/`inline` project mode for
   **structural** texts (menu title, appearance `title`/`lore`, dialog
   `title`/`body`/labels): a text slot carries either a string or a map
   `{ <lang>: text }` resolved requested language → `defaultLang`. The
   positional-address subsystem is removed for documents (it survives only for
   data sources). `lang/` now carries only action texts (`@key` refs), keys
   without a site, and data sources. Decision 4 above (project mode, hybrid per
   field) is therefore superseded for documents; it remains as the history of
   the inline form.
   documents ; elle reste l'historique de la forme inline.

5. **`menu/v1` evolves in place.** The "never mutate a shipped schema version"
   discipline applies from real production use, which has not started; the
   owner explicitly waives it here (dated dispensation). Local Docker files are
   migrated if cheap, reset otherwise. *Rejected:* forking `menu/v2` now.

6. **Disk edits are detected and never lost.** The plugin detects disk changes
   itself, hot-reloads locally for instant in-game feedback, and
   **auto-pushes** (`local_push`) — silent + WARN, no prompts (house
   "no theater" rule). `/artisan pushLocal` remains as manual fallback. On true
   divergence (disk *and* web both moved since `syncedHash`), **no overwrite in
   either direction**: the disk state becomes a divergent commit resolved
   through the existing merge engine in the editor UI. *Rejected:* backend-wins
   (status quo — the data-loss trap) and disk-wins (same defect mirrored).
   Implementation cautions carried over from the 2026-07-05 audit: reload
   thread-safety and non-atomic download become more critical with background
   detection; a multi-file agent burst must coalesce into one push.

   > **Revised 2026-07-30** (spec `2026-07-30-poll-first-disk-sync-design`):
   > detection is **poll-first**, not event-first. The original debounced
   > inotify watcher made correctness depend on OS events that are never
   > delivered on Docker bind mounts, NFS or SMB — so dev and prod behaved
   > differently — and its self-write suppression window silently dropped edits
   > that landed while the plugin was writing. The binding rule is now: **no
   > correctness path depends on a filesystem event.** `SyncScanner` compares
   > content on a timer (`stat` short-circuit, quiescence before dispatch, a
   > periodic deep content hash); self-writes need no suppression because
   > `BundleDownloader` records the hash it wrote. An FS-event fast path may
   > come back later as a pure latency optimisation, never as the mechanism.

7. **Offline assets — fill, document, assume:**
   - **Fill:** `AssetCatalog` gains a disk path — persist the asset index (or
     pack zip) at download, load from disk at boot, HTTP only refreshes. Closes
     the last *runtime* gap (custom title glyphs rendering empty offline).
   - **Document:** full resource-pack autonomy = **delegate mode** (pack
     extracted to disk, served by the host RP plugin). Also persist
     `currentPackInfo` so push mode survives restarts during backend outages.
     *Deferred:* an embedded HTTP server in the plugin for backend-less push
     delivery.
   - **Assume:** build-time capabilities (`gen-icons`, RP build, item baking)
     are backend services. Already-materialized assets survive; regenerating
     requires Artisan. Documented limit, not a defect.

*Rejected at the root:* storing Artisan objects in an opaque database — it
would destroy the trust anchor the audit shows is nearly already delivered.

## Consequences

- **This is an epic, not a patch.** It touches the editor's serialization
  boundary (round-trip `serialize*` / `*ToDomain` becomes the tested heart of
  the product), backend storage (`editorJson` demotion), and the plugin
  (template resolution, scan/auto-push, `AssetCatalog` disk load,
  `currentPackInfo` persistence). Nothing is implemented as of this ADR.
- The deferred "code mode" editor feature becomes trivial once files are
  canonical (show/edit the file, apply via the same parse path).
- **Interacts with `addon-owned-project-roots`:** scanning, sync, and hash rules
  apply per registered root; an Add-on's owned Project gets the same files-first
  treatment in its own plugin dir.
- **Partially supersedes `editor-state-model.md` (2026-04-29):** "the backend is
  authoritative over editing state" becomes "the file tree is authoritative; the
  backend stores and versions it." (That ADR's live-broadcast model was never
  ported — cf. `no-live-sessions-port-yet.md` — so the practical delta is the
  `editorJson` demotion.)
- CONTEXT.md updated in the same change: **Project** now names the file tree as
  its canonical form; **Bundle** is reframed from "compiled projection" to
  "deployed materialization of the canonical files."
