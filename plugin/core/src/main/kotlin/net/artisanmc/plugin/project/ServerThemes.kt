package net.artisanmc.plugin.project

import java.io.File
import java.io.IOException
import java.nio.file.Files
import java.nio.file.StandardCopyOption.ATOMIC_MOVE
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.logging.Logger

/**
 * The server's themes other than `artisan` (ADR `common-images-and-themes`, decision 5): each
 * folder of `plugins/Artisan/themes/` is a theme, a Project of its name with the role `theme`.
 *
 * ```
 * themes/noel/assets/textures/button.3x1.png    the theme's image of that name, at its size
 * ```
 *
 * A redraw at its former place, `overrides/artisan/<image>.png`, moves there at start ([settle]).
 *
 * A theme holds no Document: the server loads no menu, command or Trigger from its folder
 * ([ProjectRoots.holdsDocuments]). Its name is not a module's: a folder of `themes/` named like
 * a module of the server is left unregistered, the module stays what the name means.
 *
 * A theme changes an image by holding an image (ADR `resources-one-screen`, decisions 2 and 3):
 * the table of colours and the redraws aimed at a module it once held are no longer read, and
 * [register] says so for each one found ([unread]).
 */
object ServerThemes {
    /** A theme's `role` in the Project roots, and in the `project_create` that makes one. */
    const val ROLE = "theme"

    /** In a theme's folder, what it changes in images that exist elsewhere. */
    const val OVERRIDES = "overrides"

    /** The table of colours it once held: no longer read ([unread]). */
    const val COLORS = "$OVERRIDES/colors.yml"

    /** Its redraws of the common images. */
    const val COMMON = "$OVERRIDES/${ArtisanTheme.NAME}"

    /** Where the theme `artisan` kept the server's themes before they had their own folder. */
    const val FORMER_DIR = "themes"

    private val NAME = Regex("^[a-z0-9][a-z0-9_-]*$")
    private val STAMP = DateTimeFormatter.ofPattern("yyyyMMddHHmmss").withZone(ZoneOffset.UTC)
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
            ) else {
                roots.theme(name)
                settle(File(roots.themesRoot, name), logger)
                val unread = unread(File(roots.themesRoot, name))
                if (unread.isNotEmpty()) logger?.warning(
                    "[Artisan] The theme '$name' holds files that are no longer read: ${unread.joinToString(", ")}. A theme changes an image " +
                        "by holding an image under the common image's name (${FORMER_IMAGE_DIRS.first()}/), or a module's image under $OVERRIDES/<module>/: " +
                        "its colours repaint nothing. Delete them.",
                )
            }
            free
        }
    }

    /**
     * Puts the theme's redraws where a theme holds its images (ADR `resources-one-screen`,
     * decision 2): each `overrides/artisan/<image>.png` of [dir] moves to
     * `assets/textures/<image>.png`, like a module's image. One whose name the theme's `assets/`
     * already has stays: the pack reads the one in `assets/`. Returns the names moved, sorted.
     */
    fun settle(dir: File, logger: Logger? = null): List<String> {
        val former = File(dir, COMMON)
        val moved = ArrayList<String>()
        for (file in former.listFiles().orEmpty().filter { it.isFile && it.name.endsWith(".png") && it.name.length > ".png".length }.sortedBy { it.name }) {
            if (FORMER_IMAGE_DIRS.any { File(File(dir, it), file.name).exists() }) {
                logger?.warning("[Artisan] The theme '${dir.name}' holds ${file.name} twice: the one in ${FORMER_IMAGE_DIRS.first()}/ is read, $COMMON/${file.name} is not. Delete it.")
                continue
            }
            val target = File(File(dir, FORMER_IMAGE_DIRS.first()).apply { mkdirs() }, file.name)
            try {
                Files.move(file.toPath(), target.toPath(), ATOMIC_MOVE)
                moved += file.name.removeSuffix(".png")
            } catch (e: IOException) {
                logger?.warning("[Artisan] The theme '${dir.name}' keeps $COMMON/${file.name}, still read there: ${e.message}")
            }
        }
        if (former.list()?.isEmpty() == true) former.delete()
        if (File(dir, OVERRIDES).list()?.isEmpty() == true) File(dir, OVERRIDES).delete()
        return moved
    }

    /**
     * What the theme's folder [dir] holds that is no longer read: the files at the top of its
     * `overrides/` (a table of colours), each by its path in the theme, sorted. A folder there
     * is read: the images of the module of that name the theme replaces (ADR
     * `themes-reach-modules`).
     */
    fun unread(dir: File): List<String> =
        File(dir, OVERRIDES).listFiles().orEmpty()
            .filter { it.isFile && !it.name.startsWith(".") }
            .map { "$OVERRIDES/${it.name}" }
            .sorted()

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

    /**
     * Takes the theme [name] off the server: its folder moves to `themes/.artisan-trash/`, never
     * erased, and it is a Project no more. The theme `artisan` holds the common images and
     * stays. A name left in `resource-pack.themes` then changes nothing. Returns a protocol
     * error code, or null when it happened.
     */
    fun delete(roots: ProjectRoots, name: String, now: () -> Instant = Instant::now): String? {
        val dir = movable(roots, name) ?: return refusal(roots, name)
        val trash = File(roots.themesRoot, ProjectFolders.TRASH).apply { mkdirs() }
        val stamp = STAMP.format(now())
        var target = File(trash, "$name-$stamp")
        var n = 1
        while (target.exists()) target = File(trash, "$name-$stamp-${n++}")
        roots.forgetTheme(name)
        try {
            Files.move(dir.toPath(), target.toPath(), ATOMIC_MOVE)
        } catch (e: IOException) {
            // Nothing moved: the theme is still there, and still read.
            roots.theme(name)
            throw e
        }
        return null
    }

    /**
     * Renames the theme [name] to [target]: the folder moves, with its drafts and history
     * (`.artisan/`). `resource-pack.themes` is the caller's to follow. Returns a protocol error
     * code, or null when it happened.
     */
    fun rename(roots: ProjectRoots, name: String, target: String): String? {
        if (!isName(target) || target == name) return "invalid_path"
        val dir = movable(roots, name) ?: return refusal(roots, name)
        // A module's name, a theme's, or a folder that differs by its case alone.
        val taken = roots.isRegistered(target) ||
            listOf(roots.themesRoot, roots.coreRoot).any { root -> root.listFiles().orEmpty().any { it.name.equals(target, ignoreCase = true) } }
        if (taken) return "destination_exists"
        roots.forgetTheme(name)
        try {
            Files.move(dir.toPath(), File(roots.themesRoot, target).toPath(), ATOMIC_MOVE)
        } catch (e: IOException) {
            roots.theme(name)
            throw e
        }
        roots.theme(target)
        return null
    }

    /** The folder of the theme [name] when it may be moved: a registered theme other than `artisan`, a real directory. */
    private fun movable(roots: ProjectRoots, name: String): File? {
        if (name == ArtisanTheme.NAME || !roots.isTheme(name)) return null
        return File(roots.themesRoot, name).takeIf { it.isDirectory && !Files.isSymbolicLink(it.toPath()) }
    }

    private fun refusal(roots: ProjectRoots, name: String) = if (name == ArtisanTheme.NAME && roots.isTheme(name)) "addon_immutable" else "unknown_project"

    /** Whether no module of the server is named [name]: a theme never hides one. */
    fun free(roots: ProjectRoots, name: String): Boolean =
        !File(roots.coreRoot, name).isDirectory && (!roots.isRegistered(name) || roots.isTheme(name))

    /**
     * Moves each `themes/artisan/themes/<name>/` to `themes/<name>/`, in a theme's layout: its
     * `theme.yml` becomes `overrides/colors.yml` (no longer read); its images keep their place,
     * `assets/`, where a theme holds them, as does any other file. A theme whose name is taken (a module, or a theme's
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
    }
}
