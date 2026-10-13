package net.artisanmc.plugin.project

import java.io.File
import java.nio.file.Files
import java.nio.file.StandardCopyOption.ATOMIC_MOVE
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter

/**
 * Create, trash and rename a Project folder of the core root.
 * Each operation returns a protocol error code, or null when it happened.
 * Drafts, history and journals live in `.artisan/`: they follow the folder.
 * An Add-on's Projects belong to their Add-on: never moved here.
 */
class ProjectFolders(private val roots: ProjectRoots, private val now: () -> Instant = Instant::now) {
    private val coreRoot get() = roots.coreRoot

    fun create(projectId: String): String? {
        if (!isValidName(projectId)) return "invalid_name"
        if (taken(projectId)) return "project_exists"
        return if (File(coreRoot, projectId).mkdirs()) null else "write_error"
    }

    /** Never erased: the folder moves to `.artisan-trash/<id>-<timestamp>/`. */
    fun delete(projectId: String): String? {
        val dir = movable(projectId) ?: return error(projectId)
        val trash = File(coreRoot, TRASH).apply { mkdirs() }
        val stamp = STAMP.format(now())
        var target = File(trash, "$projectId-$stamp")
        var n = 1
        while (target.exists()) target = File(trash, "$projectId-$stamp-${n++}")
        Files.move(dir.toPath(), target.toPath(), ATOMIC_MOVE)
        return null
    }

    fun rename(projectId: String, targetId: String): String? {
        if (!isValidName(targetId) || targetId == projectId) return "invalid_path"
        val dir = movable(projectId) ?: return error(projectId)
        val target = File(coreRoot, targetId)
        // A case-only change names the same folder on a case-insensitive disk.
        val sameFolder = target.exists() && Files.isSameFile(dir.toPath(), target.toPath())
        if (roots.isRegistered(targetId) || (target.exists() && !sameFolder)) return "destination_exists"
        Files.move(dir.toPath(), target.toPath(), ATOMIC_MOVE)
        return null
    }

    private fun movable(projectId: String): File? {
        if (roots.isRegistered(projectId)) return null
        val dir = File(coreRoot, projectId)
        val inRoot = coreRoot.listFiles()?.any { it.name == projectId } == true
        return dir.takeIf { inRoot && it.isDirectory && !Files.isSymbolicLink(it.toPath()) && !projectId.startsWith(".") }
    }

    private fun error(projectId: String) = if (roots.isRegistered(projectId)) "addon_immutable" else "unknown_project"

    private fun taken(projectId: String) =
        roots.isRegistered(projectId) || coreRoot.listFiles()?.any { it.name.equals(projectId, ignoreCase = true) } == true

    companion object {
        const val TRASH = ".artisan-trash"
        private val STAMP = DateTimeFormatter.ofPattern("yyyyMMddHHmmss").withZone(ZoneOffset.UTC)
        private val NAME = Regex("[A-Za-z0-9][A-Za-z0-9_-]{0,127}")
        private val RESERVED = Regex("(?i)CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9]")

        /** Same rule as the editor (`isValidProjectFolderName`): a folder name safe everywhere. */
        fun isValidName(name: String) = NAME.matches(name) && !RESERVED.matches(name)
    }
}
