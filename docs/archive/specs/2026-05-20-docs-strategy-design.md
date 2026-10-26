# Docs Strategy — Design

**Date**: 2026-05-20
**Status**: Approved, ready for implementation plan
**Author**: Iban + Claude (brainstorming)

## Context

The project today has no public user documentation. On the AI side, the
foundation exists (`CLAUDE.md`, `CONTEXT.md`, `docs/decisions/`,
`docs/specs/`, `docs/superpowers/specs/+plans/`, `docs/schema/`) and
works — Claude is productive. The need:

1. Start public user docs, in English.
2. Guarantee that user docs and AI docs stay up to date when Claude
   runs tasks on the code.

Target audiences, by priority:
1. **Server admins** — installation, config, troubleshooting.
2. **Menu creators** — using the web editor (covered later).
3. **Contributors/forkers** — architecture, how to develop (covered later).

Explicitly excluded audience: devs who self-host their own backend.

## Key decisions

| Topic | Decision |
|---|---|
| Docs site tool | Astro Starlight |
| Language | English only (FR open later via Starlight i18n) |
| Site location | `/docs-site/` at the repo root |
| Maintenance | Combo of CLAUDE.md rules + local `/sync-docs` skill |
| MVP scope | 1 rich admin quickstart + `editor/` and `contributing/` stubs + `/sync-docs` skill |
| Hosting | Not decided (portable Astro, decidable at deploy time) |

## Architecture — Repo layout

```
Artisan/
├── CLAUDE.md                      extended — doc maintenance rules
├── CONTEXT.md                     unchanged
├── docs/                          unchanged — AI/design archive
│   ├── decisions/
│   ├── specs/
│   ├── schema/
│   └── superpowers/specs/+plans/
├── docs-site/                     NEW — Astro Starlight, EN
│   ├── astro.config.mjs
│   ├── package.json
│   ├── src/
│   │   ├── content/
│   │   │   └── docs/
│   │   │       ├── index.md
│   │   │       ├── getting-started/
│   │   │       │   └── install-admin.md
│   │   │       ├── editor/
│   │   │       │   └── index.md           stub
│   │   │       └── contributing/
│   │   │           └── index.md           stub
│   │   └── assets/
│   └── public/
└── .claude/
    └── skills/
        └── sync-docs/
            ├── SKILL.md
            └── doc-impact-map.yaml
```

Justifications:

- **`docs-site/` at the root**: a distinct Node sub-project, deserves its
  own root just like `editor/` and `backend/`. Not in `docs/` because
  `docs/` is the territory of AI/design artifacts (specs, plans, ADRs,
  schemas) — separating the two territories keeps the roles clear.
- **Existing `docs/` unchanged**: it is what works today, do not touch it.
- **Visible stubs** for `editor/` and `contributing/`: signal to visitors
  that it is work in progress, and create pressure on you to fill them.

## MVP content — `install-admin.md`

A single rich page. Sections:

1. **Prerequisites** — Paper 1.21.4+, Java 21, Artisan account
   (backend self-hosting out of MVP scope, opens the way via Contributing
   later).
2. **Download** — GitHub Releases link, drop the jar, restart to generate
   `config.yml`.
3. **Link your server** — get server_key from the dashboard,
   paste into `config.yml`, `/artisan reload`.
4. **Open the editor** — `/artisan editor`, click the trust link.
5. **Create your first menu** — one paragraph, link to `/editor`
   (stub) or a short GIF.
6. **Troubleshooting** — 3-5 common problems: backend unreachable,
   invalid server_key, resource pack not loading.
7. **Resource pack distribution (advanced)** — 3-mode decision tree
   (default / Nexo zip / dir mode), each with 4 lines of config
   snippet.
8. **Reference: config.yml** — annotated config (manual for MVP, possible
   automation in step 2).

Not in v1: exhaustive commands section, Bukkit permissions, extended FAQ.
These sections are born when real questions arrive.

Format: vanilla Markdown, screenshots in `docs-site/src/assets/install/`.

## CLAUDE.md — Changes

A single modification: extend the "Doc update rules" table with 4 lines
for `docs-site/`, and add an explicit behavior rule right after.

### Lines added to the table

| You touch | You update |
|---|---|
| Plugin config (`config.yml`, defaults) | `docs-site/getting-started/install-admin.md` (Config / Reference sections) |
| User-visible command (`/artisan editor`, `/artisan reload`) | `docs-site/getting-started/install-admin.md` |
| Resource pack distribution modes | `docs-site/getting-started/install-admin.md` (Resource pack section) |
| Editor UI (new user-visible button/flow) | `docs-site/editor/<feature>.md` (create if necessary) |

### Behavior rule (added right after the table)

> When a commit touches code marked in the table, the corresponding doc
> must be updated in the same commit if the update stays small (targeted
> change of one or two existing sections, typically ≤30 lines of doc
> diff). If the doc update exceeds this volume or needs
> screenshots/rework, invoke the `/sync-docs` skill at the end of the
> feature to handle the doc debt in a separate commit. Never merge a PR
> with unlisted doc debt.

### Non-changes

- CLAUDE.md stays monolithic (no split into sub-files).
- CONTEXT.md unchanged.
- `docs/specs/`, `docs/decisions/`, `docs/superpowers/` unchanged.

## `/sync-docs` skill

Location: `.claude/skills/sync-docs/`.

### `doc-impact-map.yaml`

Single source of truth of the `pattern → docs to check` mapping. The
CLAUDE.md table becomes a human summary of this YAML.

**Pattern syntax**: minimatch-style globs (`**` = recursive wildcard,
`*` = simple wildcard, exact paths allowed). The skill matches each
`touches` against each changed file via this syntax.

```yaml
mappings:
  - touches: "plugin/src/main/resources/config.yml"
    updates:
      - "docs-site/src/content/docs/getting-started/install-admin.md"
    reason: "User-visible plugin config"

  - touches: "plugin/src/main/kotlin/**/ArtisanCommand.kt"
    updates:
      - "docs-site/src/content/docs/getting-started/install-admin.md"
      - "CLAUDE.md"
    reason: "User-visible commands"

  - touches: "plugin/src/main/kotlin/**/ResourcePackDelegator.kt"
    updates:
      - "docs-site/src/content/docs/getting-started/install-admin.md"
      - "CLAUDE.md"
    reason: "RP distribution mode"

  - touches: "backend/src/lib/hub.ts"
    updates:
      - "CLAUDE.md"
    reason: "WS protocol (AI-facing only)"

  - touches: "editor/src/features/canvas/**"
    updates:
      - "docs-site/src/content/docs/editor/"
      - "CLAUDE.md"
    reason: "User-visible editor UX"
```

Additional mappings to be added as features come. When a mapping is
added, we update the YAML and the CLAUDE.md table in the same commit.

### `SKILL.md` — Process

1. `git diff main...HEAD --name-only` for the changed files.
2. Read `doc-impact-map.yaml`.
3. For each mapping where a `touches` matches:
   - List the `updates` paths and the `reason`.
   - Read each `updates` path to understand the current state.
   - Read the changed source files to understand what changed.
   - Propose a concrete patch (Edit) per doc — never auto-applied.
4. Present a checklist to the user. User chooses skip / edit / apply for
   each update.
5. After applying, propose a separate commit `docs: sync to <feature>`.
6. If a changed file matches NO mapping AND looks user-facing (touches
   editor UI, plugin command, config, public endpoint), warn the user —
   possible mapping to add.

### Skill anti-patterns

- Do not update a doc just because a file changed cosmetically
  (rename, whitespace, internal refactor). Check that observable
  behavior or the API surface moved.
- Do not write docs for what the user cannot see (internal invariants
  → CLAUDE.md, not docs-site).
- Do not generate exhaustive new sections. The skill maintains what
  exists, does not extend the scope.

### Invocation

- Manual: you type `/sync-docs` at the end of a feature.
- Auto-suggestion: Claude mentions it in its end-of-turn when it
  senses doc debt.
- Outside the critical loop — not a blocking hook.

## Daily process

1. You give Claude a task (feature, fix, refactor).
2. Claude reads CLAUDE.md → sees the table → updates the relevant docs
   **in the same commit** when the update is trivial (1-2 lines).
3. At the end of a feature, you type `/sync-docs` → full diff sweep →
   patches proposed → you validate → separate commit `docs: sync …`.
4. PR mergeable without doc debt.

## Safeguards

- **CLAUDE.md**: rule "never merge with unlisted doc debt".
- **Skill warning**: flags unmapped user-facing files.
- **Ad-hoc self-audit**: every ~10 features, `/sync-docs` with
  `git diff <old-tag>..HEAD` to catch up.

## What we do NOT do

- **No git hook** — too blocking for the current solo rhythm.
- **No CI check** — internal discipline is enough while Iban is the only
  committer. To add if external contributors.
- **No doc versioning** — a single "latest" version in MVP.
- **No i18n** — English only, FR open later via Starlight i18n.

## Validation after delivery

- **Docs**: `cd docs-site && npm run dev`, follow `install-admin.md`
  on a fresh Paper, it must work without guessing.
- **Skill**: after the next feature, `/sync-docs` must list relevant
  updates (no noise on internal refactors), at least one mapping fires
  if the feature touches something user-facing. If an obvious one is
  missing, add the missing mapping.
- **CLAUDE.md**: next session, Claude spontaneously mentions the
  docs when presenting its plan ("I will also update
  install-admin.md").

## Explicit out of scope

- Choice of host (Vercel / GitHub Pages / Cloudflare).
- Custom Starlight branding / theme.
- Automatic generation of `Reference: config.yml` from source.
- Content of the `editor/` and `contributing/` sections beyond the stubs.
- FR docs.

## Next steps

Implementation plan to be written via the `writing-plans` skill. Expected
steps:
1. Bootstrap `docs-site/` (Astro Starlight init, config, structure).
2. Write the complete `install-admin.md`.
3. Write the `editor/index.md` and `contributing/index.md` stubs.
4. Extend `CLAUDE.md` (table + behavior rule).
5. Create `.claude/skills/sync-docs/` (SKILL.md + initial
   doc-impact-map.yaml).
6. First test of the skill on the current branch to validate.
