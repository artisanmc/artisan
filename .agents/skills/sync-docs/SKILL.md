---
name: sync-docs
description: Use when finishing a feature or before merging — audit and apply documentation updates that match the diff against doc-impact-map.yaml. Proposes patches for review, never auto-applies.
---

# Sync docs to the diff

Scan the current branch's diff against `main`, match touched source
files against `doc-impact-map.yaml`, and propose concrete documentation
patches for review.

## Process

1. **Get the diff.** Run:
   ```bash
   git diff main...HEAD --name-only
   ```
   If no main branch exists or the user names another base, use that.

2. **Load the map.** Read `.Codex/skills/sync-docs/doc-impact-map.yaml`.

3. **Match.** For each mapping, check if any `touches` glob matches any
   changed file (minimatch semantics: `**` = recursive, `*` = single
   segment, exact paths supported).

4. **For every matched mapping**:
   - Read each `updates` path to understand the current state.
   - Read the changed source files to understand what changed.
   - Draft a concrete patch (Edit tool call args) — do not apply yet.

5. **Show the user a checklist** of proposed updates, one bullet per
   doc path, with:
   - The reason (from the YAML).
   - A 1-line summary of the proposed change.
   - "Apply / Skip / Edit-then-apply" choices.

6. **Apply chosen updates** with the Edit tool.

7. **Propose a single commit** separate from the feature commit:
   ```bash
   git add <touched docs>
   git commit -m "docs: sync to <feature-name>"
   ```

8. **Warn on unmapped user-facing changes.** If a changed file matches
   no mapping AND looks user-facing (heuristic: touches editor UI,
   plugin command, config, public endpoint), tell the user — possible
   mapping to add to `doc-impact-map.yaml`.

## Anti-patterns

- **Do not** propose updates for cosmetic changes (rename only,
  whitespace, internal refactor). Check that the user-observable
  behavior or public surface area actually shifted before flagging.
- **Do not** write documentation for things the user can't see.
  Internal invariants → `AGENTS.md`. User-facing prose →
  `docs/site/`.
- **Do not** generate new sections beyond what the current docs
  contain. This skill maintains existing pages — it doesn't expand
  scope. If a new section is needed, surface the gap and let the
  user decide.

## Output format

Final summary, one block:

```
Proposed doc updates:
[x] docs/site/.../install-admin.md
    Why: Resource pack distribution mode
    Change: update Nexo recipe to mention new delegate-reload-command
[x] AGENTS.md
    Why: Resource pack distribution mode
    Change: refresh table snippet
[ ] (warning) plugin/src/.../NewThing.kt is user-facing but unmapped.
    Suggest adding to doc-impact-map.yaml.

Commit when applied: docs: sync to <feature-name>
```
