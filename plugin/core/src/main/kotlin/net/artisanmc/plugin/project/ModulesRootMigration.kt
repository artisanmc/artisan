package net.artisanmc.plugin.project

import java.io.File
import java.io.IOException
import java.nio.file.AtomicMoveNotSupportedException
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.util.logging.Logger

/**
 * Moves the core projects root `plugins/Artisan/projects/` to `plugins/Artisan/modules/`, once
 * (`design-projets-en-modules.md` §5). Each entry keeps its name, so a project's namespace,
 * qualified references (`boutique:main`) and `.artisan/project-id` (its versions and drafts in
 * the suite's database) are unchanged; root metadata (`.artisan-*`) moves along. The emptied
 * folder is kept as `projects.artisan-migrated/`, with whatever could not move, and a marker
 * in the new root stops the migration from running again.
 *
 * Any failure while moving puts back what moved and keeps `projects/` as the root: the server
 * starts as before, and the next start tries again.
 */
object ModulesRootMigration {
    const val MODULES = "modules"
    const val PROJECTS = "projects"
    const val ARCHIVE = "projects.artisan-migrated"
    const val MARKER = ".artisan-migrations.yaml"

    /** The root to read projects from: `modules/`, or `projects/` when the move failed. */
    fun run(dataFolder: File, logger: Logger? = null): File {
        val modules = File(dataFolder, MODULES)
        val projects = File(dataFolder, PROJECTS)
        if (File(modules, MARKER).isFile || !projects.isDirectory) {
            modules.mkdirs()
            return modules
        }
        modules.mkdirs()
        val moved = mutableListOf<String>()
        val left = mutableListOf<String>()
        val entries = projects.listFiles()?.sortedBy { it.name }.orEmpty()
        try {
            for (entry in entries) {
                val target = File(modules, entry.name)
                if (target.exists()) {
                    left += entry.name
                    logger?.severe(
                        "[Artisan] '${entry.name}' exists in both $PROJECTS/ and $MODULES/: the $MODULES/ one is kept, " +
                            "the other stays in $ARCHIVE/${entry.name}. Merge them by hand if both hold content.",
                    )
                    continue
                }
                move(entry, target)
                moved += entry.name
            }
        } catch (e: IOException) {
            logger?.severe("[Artisan] Moving $PROJECTS/ to $MODULES/ failed (${e.message}): everything is put back, $PROJECTS/ stays in use.")
            for (name in moved.asReversed()) {
                runCatching { move(File(modules, name), File(projects, name)) }.onFailure {
                    logger?.severe("[Artisan] Could not put back $MODULES/$name to $PROJECTS/$name: move it by hand.")
                }
            }
            return projects
        }
        val archive = generateSequence(0) { it + 1 }
            .map { File(dataFolder, if (it == 0) ARCHIVE else "$ARCHIVE-$it") }
            .first { !it.exists() }
        if (!projects.renameTo(archive)) {
            logger?.warning("[Artisan] Could not rename the emptied $PROJECTS/ to ${archive.name}/: delete it once checked.")
        }
        File(modules, MARKER).writeText(
            buildString {
                append("projects_to_modules:\n")
                append("  at: \"${java.time.Instant.now()}\"\n")
                append("  moved: [${moved.joinToString(", ") { "\"$it\"" }}]\n")
                append("  left_in_archive: [${left.joinToString(", ") { "\"$it\"" }}]\n")
            },
        )
        logger?.info("[Artisan] Projects moved to $MODULES/ (${moved.size} entries); the old folder is kept as ${archive.name}/.")
        return modules
    }

    internal fun move(from: File, to: File) {
        try {
            Files.move(from.toPath(), to.toPath(), StandardCopyOption.ATOMIC_MOVE)
        } catch (_: AtomicMoveNotSupportedException) {
            Files.move(from.toPath(), to.toPath())
        }
    }
}
