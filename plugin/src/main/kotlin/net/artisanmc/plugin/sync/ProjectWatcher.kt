package net.artisanmc.plugin.sync

import net.artisanmc.plugin.project.ProjectRoots
import java.io.File
import java.io.IOException
import java.nio.file.ClosedWatchServiceException
import java.nio.file.FileSystems
import java.nio.file.FileVisitResult
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.SimpleFileVisitor
import java.nio.file.StandardWatchEventKinds.ENTRY_CREATE
import java.nio.file.StandardWatchEventKinds.ENTRY_DELETE
import java.nio.file.StandardWatchEventKinds.ENTRY_MODIFY
import java.nio.file.StandardWatchEventKinds.OVERFLOW
import java.nio.file.WatchKey
import java.nio.file.attribute.BasicFileAttributes
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import java.util.logging.Logger

/**
 * Debounced recursive disk watcher over every project root (ADR
 * files-first-source-of-truth #6): the file tree is the primary editing
 * surface, so hand/agent edits must hot-reload locally and auto-push without
 * any manual command.
 *
 * - One event per quiet period ([debounceMs]) carrying the SET of dirty
 *   projectIds — a multi-file agent burst coalesces into one flush.
 * - `.artisan*` first-segment paths (sync metadata, editor state) are ignored,
 *   mirroring the universal hash exclusion.
 * - Self-writes (bundle downloads) are swallowed via the suppression window:
 *   callers wrap disk-mutating syncs in [beginSuppress]/[endSuppress]; the
 *   grace period absorbs late-arriving OS events.
 *
 * The callback runs on the watcher's own daemon scheduler thread — callers
 * dispatch to their own executor if needed.
 */
class ProjectWatcher(
    private val roots: ProjectRoots,
    private val debounceMs: Long = 1500,
    private val logger: Logger? = null,
    private val onProjectsChanged: (Set<String>) -> Unit,
) {
    private val watchService = FileSystems.getDefault().newWatchService()
    private val keyToDir = ConcurrentHashMap<WatchKey, Path>()
    private val dirty = ConcurrentHashMap.newKeySet<String>()
    /** projectId -> suppressed-until epoch ms (MAX_VALUE while a sync is in flight). */
    private val suppressedUntil = ConcurrentHashMap<String, Long>()
    private val scheduler = Executors.newSingleThreadScheduledExecutor { r ->
        Thread(r, "artisan-watch-flush").apply { isDaemon = true }
    }
    @Volatile private var pendingFlush: ScheduledFuture<*>? = null
    @Volatile private var running = false
    private var pollThread: Thread? = null

    fun start() {
        if (running) return
        running = true
        registerTree(roots.coreRoot.toPath())
        roots.all().values.forEach { registerTree(it.toPath()) }
        pollThread = Thread({ pollLoop() }, "artisan-watch").apply {
            isDaemon = true
            start()
        }
    }

    fun stop() {
        running = false
        runCatching { watchService.close() }
        scheduler.shutdownNow()
    }

    /** Swallow all events for [projectId] until [endSuppress] (+grace). */
    fun beginSuppress(projectId: String) {
        suppressedUntil[projectId] = Long.MAX_VALUE
    }

    /** End suppression; [graceMs] absorbs OS events still in flight. */
    fun endSuppress(projectId: String, graceMs: Long = 2000) {
        suppressedUntil[projectId] = System.currentTimeMillis() + graceMs
    }

    private fun isSuppressed(projectId: String): Boolean =
        (suppressedUntil[projectId] ?: 0L) > System.currentTimeMillis()

    private fun registerTree(root: Path) {
        if (!Files.isDirectory(root)) return
        try {
            Files.walkFileTree(root, object : SimpleFileVisitor<Path>() {
                override fun preVisitDirectory(dir: Path, attrs: BasicFileAttributes): FileVisitResult {
                    if (dir.fileName?.toString()?.startsWith(".artisan") == true) return FileVisitResult.SKIP_SUBTREE
                    val key = dir.register(watchService, ENTRY_CREATE, ENTRY_MODIFY, ENTRY_DELETE)
                    keyToDir[key] = dir
                    return FileVisitResult.CONTINUE
                }
            })
        } catch (e: IOException) {
            logger?.warning("[Artisan] watcher: failed to register ${root}: ${e.message}")
        }
    }

    private fun pollLoop() {
        while (running) {
            val key = try {
                watchService.take()
            } catch (_: InterruptedException) {
                return
            } catch (_: ClosedWatchServiceException) {
                return
            }
            val dir = keyToDir[key]
            for (event in key.pollEvents()) {
                if (event.kind() == OVERFLOW) {
                    // Lost events — conservatively mark every known project dirty.
                    roots.all().keys.filterNot(::isSuppressed).forEach(dirty::add)
                    continue
                }
                if (dir == null) continue
                val child = dir.resolve(event.context() as Path)
                handleEvent(child, isCreate = event.kind() == ENTRY_CREATE, isModify = event.kind() == ENTRY_MODIFY)
            }
            if (!key.reset()) keyToDir.remove(key)
            if (dirty.isNotEmpty()) scheduleFlush()
        }
    }

    private fun handleEvent(path: Path, isCreate: Boolean, isModify: Boolean) {
        val projectId = projectIdOf(path) ?: return
        // `.artisan*` first segment relative to the project dir = metadata, ignored.
        val projectDir = roots.dirFor(projectId).toPath()
        val rel = runCatching { projectDir.relativize(path) }.getOrNull()
        val firstSegment = rel?.firstOrNull()?.toString() ?: path.fileName?.toString()
        if (firstSegment != null && firstSegment.startsWith(".artisan")) return
        // A directory MODIFY is just an mtime bump from a child write — the child
        // emits its own event from that dir's watch key (and a metadata write must
        // not leak through as a project-dir modification).
        if (isModify && Files.isDirectory(path)) return
        // New directory (project subdir or whole new project) → watch its subtree.
        if (isCreate && Files.isDirectory(path)) registerTree(path)
        if (isSuppressed(projectId)) return
        dirty.add(projectId)
    }

    /** The project owning [path]: a registered Add-on root containing it, else the first
     *  path segment under the core root. Paths outside both → null. */
    private fun projectIdOf(path: Path): String? {
        for ((id, dir) in roots.all()) {
            val dirPath = dir.toPath().toAbsolutePath()
            if (path.toAbsolutePath().startsWith(dirPath)) return id
        }
        // A brand-new dir directly under the core root (not yet in all()'s scan
        // because all() re-scans — it IS in all(); this covers files created
        // inside it before registration completes).
        val corePath = roots.coreRoot.toPath().toAbsolutePath()
        val abs = path.toAbsolutePath()
        if (abs.startsWith(corePath)) {
            val rel = corePath.relativize(abs)
            val first = rel.firstOrNull()?.toString() ?: return null
            if (first.startsWith(".")) return null
            return first
        }
        return null
    }

    private fun scheduleFlush() {
        pendingFlush?.cancel(false)
        pendingFlush = try {
            scheduler.schedule(::flush, debounceMs, TimeUnit.MILLISECONDS)
        } catch (_: java.util.concurrent.RejectedExecutionException) {
            null // stopped
        }
    }

    private fun flush() {
        val ids = HashSet<String>()
        dirty.forEach { id ->
            if (!isSuppressed(id)) ids.add(id)
        }
        dirty.clear()
        if (ids.isEmpty()) return
        try {
            onProjectsChanged(ids)
        } catch (t: Throwable) {
            logger?.warning("[Artisan] watcher: change handler failed: ${t.message}")
        }
    }
}

private fun Path.firstOrNull(): Path? = if (nameCount > 0) getName(0) else null
