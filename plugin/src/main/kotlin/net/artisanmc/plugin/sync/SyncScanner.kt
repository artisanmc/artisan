package net.artisanmc.plugin.sync

import net.artisanmc.plugin.project.ProjectRoots
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.logging.Logger

/**
 * Poll-first disk sync (spec `2026-07-30-poll-first-disk-sync-design`, revising
 * ADR files-first-source-of-truth #6). Replaces the inotify watcher, whose
 * correctness depended on OS events that never arrive on Docker bind mounts,
 * NFS or SMB — and whose suppression window silently dropped edits that landed
 * during a self-write.
 *
 * Invariant: **no correctness path depends on a filesystem event.** Every
 * divergence is found by comparing content, at worst on the next tick.
 *
 * Per tick, per project root:
 *  1. `stat` short-circuit — walk paths/sizes/mtimes only. Unchanged since the
 *     last dispatch ⇒ nothing read, nothing done.
 *  2. Quiescence — a changed signature must repeat over [quiescentTicks]
 *     consecutive ticks before dispatch, so an in-flight FTP upload is never
 *     pushed half-written. Bounded, unlike a debounce that reschedules forever.
 *  3. Deep tick — every [deepTickEvery] ticks the real content hash is compared
 *     regardless, covering filesystems whose mtime granularity is too coarse to
 *     show a same-second, same-size edit.
 *
 * A self-write (bundle download) needs no suppression: [BundleDownloader]
 * records the hash it just wrote, so the next tick resolves to IN_SYNC and
 * nothing is pushed. "Did I write this?" is a content question, not a timing
 * one. Likewise, a project already dispatched at signature S is not dispatched
 * again until the tree actually changes — which closes the echo window between
 * a `local_push` and the `bundle_available` that acknowledges it.
 *
 * The callback runs on the scanner's own daemon thread — callers dispatch to
 * their own executor if needed.
 */
class SyncScanner(
    private val roots: ProjectRoots,
    private val intervalMs: Long = 3000,
    private val quiescentTicks: Int = 2,
    private val deepTickEvery: Int = 10,
    private val logger: Logger? = null,
    private val onProjectsChanged: (Set<String>) -> Unit,
) {
    private class State(
        /** Last stat signature observed. */
        var seen: String,
        /** Consecutive ticks [seen] has held. */
        var stableTicks: Int,
        /** Stat signature at the last dispatch — the "nothing new" baseline. */
        var dispatchedStat: String,
        /** Content hash at the last dispatch — the deep-tick baseline. */
        var dispatchedContent: String,
    )

    private val states = ConcurrentHashMap<String, State>()
    private val scheduler = Executors.newSingleThreadScheduledExecutor { r ->
        Thread(r, "artisan-scan").apply { isDaemon = true }
    }
    @Volatile private var running = false
    @Volatile private var tickCount = 0

    fun start() {
        if (running) return
        running = true
        // Baseline the tree as found: boot state is not an edit — the reconnect
        // check (hello_ack) owns the "was the disk edited while we were down?"
        // question.
        roots.all().forEach { (id, dir) ->
            val stat = statSignature(dir)
            states[id] = State(stat, quiescentTicks, stat, contentHash(dir))
        }
        scheduler.scheduleWithFixedDelay(::tick, intervalMs, intervalMs, TimeUnit.MILLISECONDS)
    }

    fun stop() {
        running = false
        scheduler.shutdownNow()
    }

    /** Run one tick inline — used by tests, and by any future FS-event fast path. */
    internal fun scanNow() = tick()

    private fun tick() {
        if (!running) return
        val deep = (++tickCount % deepTickEvery) == 0
        val live = roots.all()
        states.keys.retainAll(live.keys)
        val dirty = HashSet<String>()

        live.forEach { (id, dir) ->
            val stat = statSignature(dir)
            val st = states[id]
            if (st == null) {
                // Brand-new project root: treat as changed, then let quiescence run.
                states[id] = State(stat, 1, "", "")
                return@forEach
            }
            if (stat == st.dispatchedStat) {
                st.seen = stat
                st.stableTicks = quiescentTicks
                // Coarse-mtime safety net: same stat signature can still hide an edit.
                if (deep) {
                    val content = contentHash(dir)
                    if (content != st.dispatchedContent) {
                        st.dispatchedContent = content
                        dirty.add(id)
                    }
                }
                return@forEach
            }
            if (stat == st.seen) st.stableTicks++ else { st.seen = stat; st.stableTicks = 1 }
            if (st.stableTicks >= quiescentTicks) {
                st.dispatchedStat = stat
                st.dispatchedContent = contentHash(dir)
                dirty.add(id)
            }
        }

        if (dirty.isEmpty()) return
        try {
            onProjectsChanged(dirty)
        } catch (t: Throwable) {
            logger?.warning("[Artisan] scanner: change handler failed: ${t.message}")
        }
    }

    private fun contentHash(dir: File): String = runCatching { BundleHasher.hash(dir) }.getOrDefault("")

    /**
     * Cheap change probe: sorted `relPath:size:mtime` over the tree. Mirrors the
     * universal `.artisan*` first-segment exclusion so metadata writes are
     * invisible here exactly as they are to the hash.
     */
    internal fun statSignature(dir: File): String {
        if (!dir.isDirectory) return ""
        val entries = ArrayList<String>()
        collect(dir, dir, entries)
        entries.sort()
        val md = MessageDigest.getInstance("SHA-256")
        entries.forEach {
            md.update(it.toByteArray(Charsets.UTF_8))
            md.update(0)
        }
        return md.digest().joinToString("") { "%02x".format(it) }
    }

    private fun collect(root: File, cur: File, out: MutableList<String>) {
        val children = cur.listFiles() ?: return
        for (f in children) {
            val rel = f.toRelativeString(root).replace(File.separatorChar, '/')
            if (rel.substringBefore('/').startsWith(".artisan")) continue
            if (f.isDirectory) collect(root, f, out) else out.add("$rel:${f.length()}:${f.lastModified()}")
        }
    }
}
