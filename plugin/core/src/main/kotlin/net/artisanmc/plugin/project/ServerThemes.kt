package net.artisanmc.plugin.project

import java.io.File
import java.io.IOException
import java.util.logging.Logger

/**
 * The server's themes other than `artisan` (ADR `common-images-and-themes`, decision 5): each
 * folder of `plugins/Artisan/themes/` is a theme, a Project of its name with the role `theme`.
 *
 * ```
 * themes/noel/overrides/colors.yml                colors: {"#3c8527": "#b3261e"}
 * themes/noel/overrides/artisan/button.3x1.png    this common image redrawn, at its size
 * ```
 *
 * A theme holds no Document: the server loads no menu, command or Trigger from its folder
 * ([ProjectRoots.holdsDocuments]). Its name is not a module's: a folder of `themes/` named like
 * a module of the server is left unregistered, the module stays what the name means.
 */
object ServerThemes {
    /** A theme's `role` in the Project roots, and in the `project_create` that makes one. */
    const val ROLE = "theme"

    /** In a theme's folder, what it changes in images that exist elsewhere. */
    const val OVERRIDES = "overrides"

    /** Its table of colours. */
    const val COLORS = "$OVERRIDES/colors.yml"

    /** Its redraws of the common images. */
    const val COMMON = "$OVERRIDES/${ArtisanTheme.NAME}"

    /** Where the theme `artisan` kept the server's themes before they had their own folder. */
    const val FORMER_DIR = "themes"

    private val NAME = Regex("^[a-z0-9][a-z0-9_-]*$")
    private val FORMER_IMAGE_DIRS = listOf("assets/textures", "assets/glyphs")

    fun isName(name: String): Boolean = NAME.matches(name) && name != ArtisanTheme.NAME

    /**
     * Moves the themes the theme `artisan` still holds to their own folder ([migrate]), then
     * registers each theme's folder and returns the names registered, sorted. A theme that could
     * not move stays where it is, where the pack still reads it.
     */
    fun register(roots: ProjectRoots, logger: Logger? = null): List<String> {
        migrate(roots, logger)
        val names = roots.themesRoot.listFiles().orEmpty().filter { it.isDirectory && isName(it.name) }.map { it.name }.sorted()
        return names.filter { name ->
            val free = free(roots, name)
            if (!free) logger?.warning(
                "[Artisan] The theme ${File(roots.themesRoot, name).path} has the name of a module of this server: it is not read. " +
                    "Rename its folder, then restart.",
            ) else roots.theme(name)
            free
        }
    }

    /**
     * A new, empty theme [name], registered at once (`project_create` with `role: "theme"`).
     * Returns a protocol error code, or null when it is there.
     */
    fun create(roots: ProjectRoots, name: String): String? {
        if (!isName(name)) return "invalid_name"
        // A module's name, a theme's, or a folder that differs by its case alone.
        val taken = roots.isRegistered(name) ||
            listOf(roots.themesRoot, roots.coreRoot).any { root -> root.listFiles().orEmpty().any { it.name.equals(name, ignoreCase = true) } }
        if (taken) return "project_exists"
        roots.theme(name)
        return if (File(roots.themesRoot, name).isDirectory) null else "write_error"
    }

    /** Whether no module of the server is named [name]: a theme never hides one. */
    fun free(roots: ProjectRoots, name: String): Boolean =
        !File(roots.coreRoot, name).isDirectory && (!roots.isRegistered(name) || roots.isTheme(name))

    /**
     * Moves each `themes/artisan/themes/<name>/` to `themes/<name>/`, in a theme's layout: its
     * `theme.yml` becomes `overrides/colors.yml` and its redraws (`assets/textures/<image>.png`,
     * then `assets/glyphs/` for a name no texture has) `overrides/artisan/<image>.png`; any other
     * file keeps its place in the folder. A theme whose name is taken (a module, or a theme's
     * folder that holds files) stays where it is, where the pack still reads it. Returns the
     * names moved.
     */
    fun migrate(roots: ProjectRoots, logger: Logger? = null): List<String> {
        val former = File(File(roots.themesRoot, ArtisanTheme.NAME), FORMER_DIR)
        val moved = ArrayList<String>()
        for (source in former.listFiles().orEmpty().filter { it.isDirectory }.sortedBy { it.name }) {
            val name = source.name
            val target = File(roots.themesRoot, name)
            val reason = when {
                !isName(name) -> "'$name' is not a theme's name (lowercase letters, digits, `_` and `-`; `${ArtisanTheme.NAME}` is Artisan's)"
                !free(roots, name) -> "a module of this server is named '$name'"
                !target.list().isNullOrEmpty() -> "${target.path} holds files already"
                else -> null
            }
            if (reason != null) {
                logger?.warning("[Artisan] The theme ${source.path} stays where it is: $reason. Rename its folder, then restart.")
                continue
            }
            try {
                if (target.exists()) java.nio.file.Files.delete(target.toPath())
                ModulesRootMigration.move(source, target)
                layout(target)
                moved += name
                logger?.info("[Artisan] The theme '$name' has its own folder: ${source.path} moved to ${target.path}.")
            } catch (e: IOException) {
                logger?.severe("[Artisan] Could not move the theme ${source.path} to ${target.path} (${e.message}): it is read where it is.")
            }
        }
        if (former.isDirectory && former.list().isNullOrEmpty()) former.delete()
        return moved
    }

    /** The files of a theme just moved from the theme `artisan`, put at a theme's places. */
    private fun layout(dir: File) {
        val table = listOf("theme.yml", "theme.yaml").map { File(dir, it) }.filter { it.isFile }
        table.firstOrNull()?.let { file ->
            val colors = File(dir, COLORS)
            if (!colors.exists()) {
                colors.parentFile.mkdirs()
                ModulesRootMigration.move(file, colors)
            }
        }
        // `theme.yaml` beside a `theme.yml` was never read.
        table.drop(1).forEach { if (File(dir, COLORS).isFile) it.delete() }
        for (images in FORMER_IMAGE_DIRS.map { File(dir, it) }) {
            for (png in images.listFiles().orEmpty().filter { it.isFile && it.name.endsWith(".png") }.sortedBy { it.name }) {
                val target = File(dir, "$COMMON/${png.name}")
                if (target.exists()) continue
                target.parentFile.mkdirs()
                ModulesRootMigration.move(png, target)
            }
            if (images.isDirectory && images.list().isNullOrEmpty()) images.delete()
        }
        File(dir, "assets").let { if (it.isDirectory && it.list().isNullOrEmpty()) it.delete() }
    }
}
