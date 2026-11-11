# Changelog fragments

Each PR puts its changelog entry in **a new file of this folder**, never in `CHANGELOG.md`
itself. Two PRs that both prepend to `[Unreleased]` conflict on the same lines; two PRs that
each add their own file never do. CI (`.github/workflows/changelog.yml`) refuses a PR that adds
lines to the `[Unreleased]` section of `CHANGELOG.md`.

## Writing one

- Name: lowercase, `-` between words, `.md`, unique to the change — the branch or the topic
  works (`deploy-several-projects.md`, `fix-yaml-crlf.md`). Two PRs picking the same name
  conflict, so be specific.
- Content: the entry exactly as it would read in `CHANGELOG.md`, one or more bullets, each
  starting with `- **<Category>**: ` where Category is `Added`, `Changed`, `Deprecated`,
  `Removed`, `Fixed` or `Security` (an optional lowercase note is allowed:
  `- **Added** (preview): `). Indented sub-bullets are fine.

```markdown
- **Fixed**: Deploy refused a menu laid out by `places` alone: the editor wrote `positions: ""`,
  which the menu schema rejects. It now writes `positions: []`.
```

- A later PR that amends an unreleased entry edits that fragment file, not a new one.

Check locally: `node tools/changelog/changelog.mjs check --base origin/main`.

## Releasing

```bash
node tools/changelog/changelog.mjs preview          # what the release adds
node tools/changelog/changelog.mjs release 1.2.0    # --date YYYY-MM-DD, default today
```

`release` puts the fragments at the top of `[Unreleased]`, newest first (by the commit that
added each), renames that section `[1.2.0] - <date>`, opens a new empty `[Unreleased]` above it,
and deletes the fragments. Commit the result as the release PR.
