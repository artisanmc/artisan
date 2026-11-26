package net.artisanmc.plugin.project

import net.artisanmc.modules.api.template.TemplateDeclaration
import java.io.File
import java.io.IOException
import java.util.logging.Logger

/**
 * The theme `artisan` (ADR `common-images-and-themes`, decision 2): the images every menu of the
 * server may name. `themes/artisan/originals/assets/textures/` holds the base Artisan ships, and
 * `originals/components/` the components it ships (ADR `element-parts-and-sliced-images`, step 5:
 * the server's `components/<name>.yml` replaces the one of that name), both
 * written here by the originals sync ([SystemFiles]: only what differs, so nothing on a start
 * where Artisan did not change); `assets/` holds the server's redraw of a base image (same name)
 * and the common images the server added. Its name is reserved: it is no module's.
 */
object ArtisanTheme {
    /** The theme's name: its folder under `themes/` and its Project id. */
    const val NAME = "artisan"

    /** The module that held a server's shared images before the theme: its folder moves here once. */
    const val LEGACY_MODULE = "ui-kit"

    /** The origin written beside each base image (`.artisan/origins.yaml`): who ships it. */
    const val SHIPPER = "artisan"
    const val TEMPLATE = "base"

    /** Where a base image is kept, before `originals/`. */
    fun path(name: String) = "assets/textures/$name.png"

    /**
     * Registers `themes/artisan/` and returns it. The folder of the former `ui-kit` module moves
     * there first, when the theme holds nothing of the server's yet: its images keep their names,
     * so a menu that names one finds it. While both hold files, or when the move fails, the
     * module stays a module and the log says what to do.
     */
    fun register(roots: ProjectRoots, logger: Logger? = null): File {
        val target = File(roots.themesRoot, NAME)
        val legacy = File(roots.coreRoot, LEGACY_MODULE).takeIf { it.isDirectory && holdsContent(it) }
        if (legacy != null) {
            if (holdsContent(target)) {
                logger?.warning(
                    "[Artisan] Both ${legacy.path} and ${target.path} hold files: the server's shared images are read from " +
                        "${target.path}. Move what ${legacy.path} still holds there, then delete it.",
                )
            } else {
                try {
                    target.parentFile.mkdirs()
                    // What the theme held alone was written by Artisan: its originals come back at the next sync.
                    if (target.exists()) target.deleteRecursively()
                    ModulesRootMigration.move(legacy, target)
                    // The module's identity stays the module's: the theme has its own.
                    File(target, ".artisan/project-id").delete()
                    logger?.info("[Artisan] The module '$LEGACY_MODULE' is now the theme '$NAME': ${legacy.path} moved to ${target.path}.")
                } catch (e: IOException) {
                    logger?.severe("[Artisan] Could not move ${legacy.path} to ${target.path} (${e.message}): '$LEGACY_MODULE' stays a module.")
                }
            }
        }
        return roots.theme(NAME)
    }

    /** A file of the server's: anything but Artisan's own metadata and the originals it writes. */
    private fun holdsContent(dir: File): Boolean =
        dir.list().orEmpty().any { !it.startsWith(".artisan") && it != net.artisanmc.plugin.model.Originals.DIR }

    /** Where a base component is kept, before `originals/`. */
    fun componentPath(name: String) = "components/$name.yml"

    /**
     * The base as a system template: [images] by name (`button.3x1`), each a PNG, and
     * [components] by name (`confirm`), each a component's file.
     */
    fun template(images: Map<String, ByteArray>, components: Map<String, String> = emptyMap()): TemplateDeclaration {
        val builder = TemplateDeclaration.builder(TEMPLATE, 1).title("Artisan").system()
        for ((name, png) in images.toSortedMap()) builder.file(path(name), png)
        for ((name, text) in components.toSortedMap()) builder.file(componentPath(name), text.toByteArray(Charsets.UTF_8))
        return builder.build()
    }

    /** Writes the base under [dir]'s `originals/`; the paths written, empty when nothing changed. */
    fun sync(dir: File, images: Map<String, ByteArray>, components: Map<String, String> = emptyMap()): List<String> =
        if (images.isEmpty()) emptyList() else SystemFiles.sync(dir, SHIPPER, template(images, components))
}
