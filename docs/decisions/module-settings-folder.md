# Module settings — a `settings/` folder, a Document kind of its own

**Status:** proposed (2026-11-28) — draft, not yet accepted.
**Amends:** `bare-data-files` (a setting is a bare file in `data/`). `module-config-screens` §3
(live-only editing) is already superseded in practice: a screen opens on the Project's draft
and its edits are published with Deploy, like any Document.

## Context

A module's settings (language, reset time, reminders…) sit in `data/settings.yaml`, next to
the tables that are its data sources. `data/` therefore holds two things: **tables** (rows
that menus bind to) and **settings** (one object the module reads at start). The editor shows
the settings through a Config screen, which is neither a Document nor a data source, so it
has no place in the catalogue or the sidebar: it was added as a special block, then as a
virtual "Settings" entry of the catalogue (PR #515). Each special case is a symptom of the
same cause, a concept without a home.

## Decision (proposed)

1. **A module's settings live in `settings/`**, one file per screen (`settings/<id>.yaml`),
   never in `data/`. `data/` keeps tables only.
2. **`settings` is a Document kind** (extensible kinds, `extensible-document-kinds`), declared
   by the module that owns the screen. The catalogue and the sidebar list it like Menus and
   Commands (a row with a count, folding), with no host special case.
3. **Read fallback:** until a module migrates, `data/<id>.yaml` declared by an
   `editor_screens` entry stays readable and is listed as a settings Document. A write goes to
   `settings/<id>.yaml` once the module declares the new path; the old file is left alone.
4. **Editing does not change**: a settings file is a file of the Project, edited on its draft
   and published with Deploy. Only its path and its place in the catalogue move.

## Consequences

- One concept less in the editor (the Config screen as a third surface), and the settings
  gain drafts, history and translations like the rest.
- Every add-on that declares `editor_screens` for a settings file migrates its path
  (daily-rewards first). An API change: a `Since` line in `docs/architecture/api-surface.md`
  and, if an add-on needs it, its `MIN_API_VERSION`.
- Invariants to check before accepting: `.artisan*` metadata stays outside the hash;
  a settings file edited by hand on disk is still adopted by the scan.

## Open questions (what would change the decision)

- Does any add-on read `data/<id>.yaml` for a setting by a hard-coded path? If so, it migrates
  with the module, and the read fallback (point 3) stays until it has.

## Rejected

- Keeping `data/` and special-casing the settings in each surface: what #515 does today.
- A host-side "Settings" virtual kind without a folder: same special case, one level up.
