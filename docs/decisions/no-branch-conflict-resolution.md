# No conflict resolution at the branch level

**Status: superseded (phase F, 2026-10)** — the backend's branches and commits are removed with it. See [editor-web-server](editor-web-server.md).

**Status:** accepted (2026-06-17)

## Decision

Artisan **does no 3-way merge and no conflict resolution between branches**. The `mergeEngine` (`merge()` / `applyResolutions()`), the endpoints `POST …/branches/:src/merge-into/:dst` + `…/resolve`, and the client functions `mergeBranches` / `resolveMerge` were removed (cf. CHANGELOG `[Unreleased]`, 2026-06-17).

The branch model stays **linear / fast-forward only**:

- `commits` (snapshot of the WIP on a branch), `history` (list + restore of a past commit), `revert` (restore of the head), `deploy` (bundle broadcast) — **kept, in use**.
- `promote/:dst` — **fast-forward only** advance (`409 not_fast_forward` on divergence), **kept** for the future dev→prod flow.
- DAG primitives (`pack_commits.parentId2`, `branchStorage.findLCA`) — **kept but inert**: no consumer until a merge is reintroduced.

## Why

1. **Nobody wired it.** The subsystem was implemented end to end on the backend (engine + endpoints + tests) and in the API client, but **no editor component called `mergeBranches` / `resolveMerge`**. There was no conflict-resolution interface. Clean deletion test: removing the code makes the complexity disappear without it reappearing elsewhere.

2. **Live concurrency is already solved another way.** The ADR `editor-state-model` settled it: authoritative backend + **last-writer-wins** + presence indicator, no lock. When two admins edit at the same time, the real-time model reconciles. Branch-level conflict resolution would solve a problem that live collaboration already solves.

3. **The envisioned use case did not need it either.** The initial intent was a `dev` branch (test server) and a `main` branch (prod) for the same pack. That flow is *linear*: you edit on `dev`, then push `dev → main`. `main` only receives promotions, never diverges on its own → **fast-forward**, never a 3-way merge. Conflicts would only appear if `main` were edited directly *while* `dev` diverges — which the workflow does not do. And that use case was deferred anyway.

## Consequences

- **If the need for dev/prod branches comes back**, it is built with `promote` (fast-forward only). No 3-way merge to reintroduce.
- **If one day two branches really must diverge** (simultaneous, isolated editing on both sides), only then reopen this decision: restore a merge engine from git history (removal commit of 2026-06-17) and **design the resolution UI at the same time** as the engine, against a real consumer.
- The DAG columns / primitives stay in place (no DB migration) — they cost nothing and avoid a schema round trip if branches return.

## Rejected alternatives

- **Keep the code dormant "just in case".** Rejected: tested code with no caller is a trap for the next session (human or agent) who believes it must be wired. Git brings it back if ever needed.
- **Deepen the merge engine** (consolidate the classification + the double-merge scattered across the routes into a `planMerge`/`resolveMerge` module). Moot once the feature is removed — it was the initial lead of the architecture review, abandoned in favor of deletion.
