# Poll-first disk sync — the watcher becomes an optimization

**Status:** **implemented on 2026-07-30** — revises ADR
`files-first-source-of-truth` #6. `ProjectWatcher` removed, `SyncScanner`
(`plugin/.../sync/SyncScanner.kt`) replaces it; plugin suite green (786 tests).

## Problem

ADR `files-first-source-of-truth` #6 made `ProjectWatcher` (recursive
WatchService, 1.5 s debounce, suppression window) the mechanism for detecting
disk edits. It is a **heuristic used as a correctness mechanism**, and it leaks in
six places.

### 1. Silent loss of an edit (shippable bug today)

`ProjectWatcher.handleEvent` refuses to add to the `dirty` set when the project is
suppressed (`ProjectWatcher.kt:143`), and `flush` re-filters then **empties** the
set (l.180-182).

> Admin edits at T → a bundle download starts at T+0.5 s (`beginSuppress`) →
> flush at T+1.5 s: the id is filtered **and erased**. The edit is not delayed,
> it is lost until the next `hello_ack`.

This is the nominal path of a disk edit concurrent with an editor push.

### 2. The suppression window is a timing race

`endSuppress(graceMs = 2000)` (l.82) bets that the OS has finished delivering its
events within 2 s. Too short → push/download loop (the anti-loop invariant of
`CLAUDE.md`). Too long → flaw 1. No value is correct.

### 3. Debounce without a cap → starvation

`scheduleFlush` cancels and reschedules on every event (l.169). A continuous
stream of writes (FTP upload of a large project, `unzip`, a third-party plugin
that writes periodically) never reaches 1.5 s of silence: **the flush never fires**.

### 4. Commit of a half-written tree

Symmetrically, a network gap in the middle of an FTP upload creates a 1.5 s
silence and pushes a partial tree. FS events carry no atomicity signal.

### 5. `OVERFLOW` loses twice

Recovery on overflow marks everything dirty **except the suppressed ones** (l.118):
events already lost are lost a second time.

### 6. Dependence on inotify → dev ≠ prod

`FileSystems.getDefault().newWatchService()` (l.47) delivers nothing on Docker
Desktop bind mounts, nor on NFS/SMB (FTP-panel hosts). No error, no log. The
behavior differs depending on the environment — real incident of 2026-07-25.

The documented "safety nets" (check at `hello_ack`, `/artisan pushLocal`) are
the admission: correctness already rests, in practice, on reconnection and on a
manual command.

## Decision

**Invert the roles.** The periodic hash scan becomes the truth; the watcher
becomes a latency optimization, removable without changing correctness.

Stated as an invariant:

> No correctness path depends on a filesystem event.
> Any disk divergence is detected by content comparison, at worst at the next
> tick.

### Why it is cheap here

All the pieces exist and are already tested:

| Piece | Where |
|---|---|
| Canonical tree hash | `BundleHasher.hash(projectDir)` |
| Reference state | `SyncMetadata` (`syncedHash` / `backendHash`) |
| Decision | `detectSyncAction(diskHash, syncedHash, backendHash)` — `SyncedMenuProvider.kt:43` |
| Dispatch | `onWatchedChange` (`SyncedMenuProvider.kt:289`) |

The `hello_ack` path (`SyncedMenuProvider.kt:373`) **is already a poll**: it
performs exactly this comparison at reconnection. "Poll every N seconds" =
calling existing code on a timer.

## Mechanism

`SyncScanner` — a daemon scheduler, one tick every `scanIntervalMs`
(default **15 s**), for each project root:

1. **`stat` short-circuit.** Walk the tree reading only `mtime` + `size` +
   path; aggregate a *scan signature*. If it is identical to the previous tick
   → nothing to do, no file read. `stat` works everywhere, including on bind
   mounts.
2. **Quiescence.** If the signature moved, do nothing this tick — wait until it is
   **stable over two consecutive ticks**. This is the poll equivalent of the
   debounce, but bounded (at most 2 ticks) and with no possible starvation. Handles
   flaw 4 without reintroducing flaw 3.
3. **Hash + decision.** Stable signature different from the last hashed one →
   `BundleHasher.hash(projectDir)` → `detectSyncAction(...)` → the current dispatch
   (`IN_SYNC`/`AUTO_SYNC`: nothing; `LOCAL_ONLY`: hot-reload + `local_push`;
   `CONFLICT`: hot-reload + `sync_divergence`).

`.artisan*` exclusions (first segment) unchanged, at the `stat` walk level.

### The suppression window disappears

"Did I write this myself?" stops being a question of *timing* and becomes
a question of *content* again. `BundleDownloader.kt:102` already does, after
writing:

```kotlin
SyncMetadata.recordSync(projectDir, syncedHash = BundleHasher.hash(projectDir), backendHash = backendHash)
```

The next scan recomputes the same hash → `IN_SYNC` (or `AUTO_SYNC`) → no
push. A self-write structurally cannot produce a push, whatever the
latency.

**Removed**: `beginSuppress` / `endSuppress` / `suppressedUntil` and their 3
call sites (`SyncedMenuProvider.kt:496,736,829`), the debounce, the anti-loop
invariant of `CLAUDE.md`. Flaws 1, 2, 3, 5 eliminated by construction.

### The echo window after a `local_push` — solved differently

After a `local_push`, `syncedHash` is only refreshed when the echoed
`bundle_available` comes back ("still download to refresh SyncMetadata"). In
between, several triggers can observe the same `LOCAL_ONLY` tree (a
`config_write` then the scan one tick later) and re-push the same content.

The initial proposal — writing `recordSync(syncedHash = pushedHash)` at send
time — **was rejected at implementation**: if the push leaves but is never
applied (connection cut in flight), the disk claims "synchronized", and at
reconnect `detectSyncAction` answers `AUTO_SYNC` → we wait for a
`bundle_available` that overwrites the local edit. Data loss.

Retained: `lastPushedHash` (`ConcurrentHashMap`, **in memory only**) —
"this disk hash has already been auto-pushed in this session". Cleared at
`hello_ack` and after each download, so a push lost in flight is re-posted at
reconnect instead of being forgotten. The worst case after a restart is a
duplicate push, never a loss. The three automatic triggers (scan,
`bundle_available` LOCAL_ONLY, `config_write`) go through `autoPush(...)`;
`pushLocalProject` stays the manual/forced path, not deduplicated.

### The watcher

Removed (`ProjectWatcher.kt` + `ProjectWatcherTest.kt`), not kept as a
fast path: latency goes from ~1.5 s to ~3-6 s (3 s interval × quiescence 2),
which is inconsequential for config editing, and keeping inotify
would have meant maintaining two paths of which only one works depending on the host.
`SyncScanner.scanNow()` stays exposed (`internal`) — an FS-event fast path can
come back later by plugging into it, as a pure optimization.

## Parameters

| Name | Default | Note |
|---|---|---|
| `scanIntervalMs` | 3,000 | Effective latency 3-6 s. Not yet exposed in `config.yml` — to do if a server with very many roots asks for it |
| `quiescentTicks` | 2 | An upload must be calm over 2 ticks before being pushed |
| `deepTickEvery` | 10 | One tick in 10 compares the real content hash (coarse mtime safety net) |

## What this unlocks

Extending to third-party plugin roots (cf. the "managed ⇒ versioned" discussion)
becomes tenable: the scan scales to N roots thanks to the `stat` short-circuit,
and above all "this plugin rewrites its own file" becomes a question of
**content** again — comparison to the last synchronized hash, plus per-root
`ignore`/normalization rules applied at hash time — instead of a question of
an event impossible to attribute.

## Delivered implementation

- `plugin/.../sync/SyncScanner.kt` — new. `plugin/.../sync/ProjectWatcher.kt`
  — removed.
- `SyncedMenuProvider`: `watchDebounceMs` → `scanIntervalMs` (3,000),
  `startWatcher()` → `startScanner()`, `onWatchedChange` → `onScanChanged`
  (body unchanged), `autoPush(...)` + `lastPushedHash`, and the **three**
  `beginSuppress`/`endSuppress` call sites removed (bundle download,
  `config_write`, move-to-trash).
- `SyncScannerTest` (8 tests) replaces `ProjectWatcherTest`.
  `WatcherAutoPushIntegrationTest` → `ScanAutoPushIntegrationTest`.
- Full plugin suite: **786 tests, 0 failures**.

The scanner tests drive the ticks by hand (scheduler interval set outside the
test duration): no dependency on inotify, no `sleep`, no host-dependent
behavior. That was one of the goals — sync bugs can now be
reproduced in tests on any platform.

### Remaining to do

- Expose `scanIntervalMs` in `config.yml` if the need appears.
- Measure the cost of the `stat` walk on a server with many roots before
  extending the scan to third-party plugin folders.

## Docs to update at implementation

- ADR `files-first-source-of-truth` #6 — revision (watcher → poll-first).
- `CLAUDE.md`: section "Disk watcher + auto-push (P3b)" — remove the anti-loop
  invariant and the "Docker Desktop bind mounts" note, which cease to exist.
- `docs/architecture/ws-protocol.md` if the `local_push` cadence changes.

## Rejected

- **Keep the watcher and lengthen the grace.** Moves the cursor between flaw 1
  and flaw 2 without removing either.
- **Watcher + long safety-net poll (5 min).** This is the current state in disguise:
  correctness still depends on inotify on the fast path, so dev ≠ prod
  persists and the bugs do not reproduce in tests.
- **Detection only on explicit events** (boot, `/artisan reload`,
  editor connection). Simpler, but misses the FTP edit never followed by a
  reload — precisely the "files are the editing surface" use case.
