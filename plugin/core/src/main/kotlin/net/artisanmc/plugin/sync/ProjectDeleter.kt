package net.artisanmc.plugin.sync

import java.io.File
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.logging.Logger

/**
 * Atomic-ish project deletion via move-to-trash.
 *
 * Project at `<projectsDir>/<projectId>/` is moved to `<projectsDir>/.artisan-trash/<projectId>-<timestamp>/`.
 * The `.artisan` prefix excludes the trash directory from BundleHasher (filename filter)
 * AND from BundleHasher.hashAll's project iteration (dotfile-directory filter).
 *
 * No-op if the project dir does not exist.
 */
class ProjectDeleter(
    private val roots: net.artisanmc.plugin.project.ProjectRoots,
    private val logger: Logger? = null,
) {
    /** Test convenience — production passes the shared [net.artisanmc.plugin.project.ProjectRoots]. */
    constructor(projectsDir: File, logger: Logger? = null)
        : this(net.artisanmc.plugin.project.ProjectRoots(projectsDir), logger)

    private val tsFormat = DateTimeFormatter.ofPattern("yyyyMMddHHmmss").withZone(ZoneOffset.UTC)

    fun delete(projectId: String) {
        val projectDir = roots.dirFor(projectId)
        if (!projectDir.exists()) return

        val trash = roots.trashDirFor(projectId).also { it.mkdirs() }
        val timestamp = tsFormat.format(Instant.now())
        val target = File(trash, "$projectId-$timestamp")
        val ok = projectDir.renameTo(target)
        if (!ok) {
            logger?.warning("Failed to move $projectDir to $target — project may be partially deleted")
        } else {
            logger?.info("Project $projectId moved to trash at ${target.absolutePath}")
        }
    }
}
