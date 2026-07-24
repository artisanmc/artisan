# Files-first — the Project's file tree is the single source of truth

**Status:** accepted (2026-07-23) — implementation in progress: P0 format
ergonomics + P1 (`.artisan/editor.yaml`, offline assets) + P2 (template/model
files) shipped 2026-07-23; **P3a shipped 2026-07-24** (decision 2 done —
`editorJson` demolished, the backend stores only the file tree; the editor
parses/serializes it via `projectFromFiles`/`transform`, locked by a
fixed-point round-trip test). Remaining: P3b watcher/auto-push (decision 6),
P3c divergence resolution.

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

5. **`menu/v1` evolves in place.** The "never mutate a shipped schema version"
   discipline applies from real production use, which has not started; the
   owner explicitly waives it here (dated dispensation). Local Docker files are
   migrated if cheap, reset otherwise. *Rejected:* forking `menu/v2` now.

6. **Disk edits are detected and never lost.** The plugin detects disk changes
   itself (debounced watcher, or at minimum `syncedHash`-vs-disk comparison at
   boot/reload/reconnect), hot-reloads locally for instant in-game feedback, and
   **auto-pushes** (`local_push`) — silent + WARN, no prompts (house
   "no theater" rule). `/artisan pushLocal` remains as manual fallback. On true
   divergence (disk *and* web both moved since `syncedHash`), **no overwrite in
   either direction**: the disk state becomes a divergent commit resolved
   through the existing merge engine in the editor UI. *Rejected:* backend-wins
   (status quo — the data-loss trap) and disk-wins (same defect mirrored).
   Implementation cautions carried over from the 2026-07-05 audit: reload
   thread-safety and non-atomic download become more critical with a watcher;
   debounce must absorb multi-file agent bursts.

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
  (template resolution, watcher/auto-push, `AssetCatalog` disk load,
  `currentPackInfo` persistence). Nothing is implemented as of this ADR.
- The deferred "code mode" editor feature becomes trivial once files are
  canonical (show/edit the file, apply via the same parse path).
- **Interacts with `addon-owned-project-roots`:** watchers, sync, and hash rules
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
