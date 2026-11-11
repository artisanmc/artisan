package net.artisanmc.plugin.project

import net.artisanmc.plugin.project.LoadedState
import net.artisanmc.plugin.project.PublicationAuthor
import net.artisanmc.plugin.project.ContentHash
import net.artisanmc.plugin.project.ProjectFilesReader
import net.artisanmc.plugin.model.DocumentKinds
import java.io.File
import java.time.Instant
import java.util.concurrent.Executor
import java.util.logging.Logger

/**
 * Where [VersionRecorder] writes: the suite database once it is open and this server is
 * registered in `artisan_servers` (ADR `server-identity-and-versions`).
 */
interface VersionStorage {
    /**
     * Records [files] and [binaries] as [folder]'s next Version, unless its latest Version has
     * the same content. Returns the binaries kept out of it, whose bytes on disk
     * ([readBinary]) no longer match the Snapshot.
     */
    fun recordVersion(
        projectKey: String,
        folder: String,
        files: Map<String, String>,
        binaries: Map<String, ProjectFilesReader.BinaryInfo>,
        at: Instant,
        author: PublicationAuthor?,
        readBinary: (path: String) -> ByteArray,
    ): List<String>

    /** Replaces this server's loaded state (`artisan_server_state`): what the hub serves. */
    fun recordState(state: LoadedState, at: Instant)
}

/**
 * Turns each loaded Snapshot into Versions, then into the loaded state (CLAUDE.md, trap 1).
 *
 * The rules: `.artisan*` metadata never enters a Version (it goes to the state's `meta`);
 * a Project whose Version fails does not stop the others; and a single failure keeps the
 * previous loaded state, otherwise the hub would serve the new hash over the previous
 * Version's files and `if_hash` would call that unchanged.
 *
 * Everything runs on [writer], one thread: Versions are recorded in the order their Snapshots
 * were loaded, after the database opened. [storage] is read there, not before: the first
 * Snapshot is queued while the database is still opening, and null (not open, server not
 * registered) records nothing.
 */
class VersionRecorder(
    private val roots: ProjectRoots,
    private val storage: () -> VersionStorage?,
    private val writer: Executor,
    private val logger: Logger,
    private val clock: () -> Instant = Instant::now,
) {
    /** Per Project, the hash of the Snapshot last recorded: a Project a reload left as it was records nothing. On [writer] only. */
    private val recorded = HashMap<String, String>()

    /** Queues [snapshot]; [done] runs on [writer] once it is recorded, or skipped. [authors]: the Projects a publication wrote. */
    fun record(snapshot: ProjectSnapshot, authors: Map<String, PublicationAuthor>, done: () -> Unit) {
        val now = clock()
        writer.execute {
            val data = storage() ?: return@execute done()
            var failed = 0
            recorded.keys.retainAll(snapshot.files.keys)
            // A partial reload re-reads one Project: the others' Versions exist already, and
            // the storage would only find them unchanged, one connection and one SELECT each.
            val changed = snapshot.projectIds.filter { id -> authors[id] != null || recorded[id] != snapshot.hash(id) }
            for (id in changed) runCatching {
                val dir = roots.dirFor(id)
                val content = { path: String -> !ContentHash.isArtisanMeta(path) }
                val skipped = data.recordVersion(
                    roots.key(id), id,
                    snapshot.files[id].orEmpty().filterKeys(content),
                    snapshot.binaries[id].orEmpty().filterKeys(content),
                    now, authors[id],
                ) { File(dir, it).readBytes() }
                if (skipped.isNotEmpty())
                    logger.warning("[Artisan] Project $id: ${skipped.joinToString()} changed on disk since the reload, kept out of this Version")
                recorded[id] = snapshot.hash(id)
            }.onFailure { failed++; recorded.remove(id); logger.warning("[Artisan] Version of project $id not recorded: ${it.message}") }
            if (failed == 0) runCatching { data.recordState(loadedState(snapshot), now) }
                .onFailure { logger.warning("[Artisan] Loaded state not recorded: ${it.message}") }
            else logger.warning("[Artisan] Loaded state not recorded: $failed Version(s) failed, the editor keeps the previous one")
            done()
        }
    }

    /**
     * The Project list and, per Project, the Snapshot hash, failed files, editor metadata and the
     * images its Documents ask the pack for: what the hub serves and builds the pack from.
     */
    fun loadedState(snapshot: ProjectSnapshot): LoadedState {
        val providers = DocumentKinds.packImages()
        return LoadedState.of(snapshot, roots) { files ->
            PackImageRequests.of(files, providers) { logger.warning("[Artisan] $it") }
        }
    }
}
