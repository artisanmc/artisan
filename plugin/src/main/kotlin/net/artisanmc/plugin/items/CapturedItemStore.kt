package net.artisanmc.plugin.items

import org.bukkit.configuration.file.YamlConfiguration
import org.bukkit.inventory.ItemStack
import java.io.File
import java.util.logging.Logger

/**
 * Captured items — serialized ItemStacks exported by the editor under each
 * project's `items/<id>.yml` (ADR `captured-items-and-module-field-kit`). The
 * runtime truth behind `item:<id>` material refs: the editor only renders a
 * display descriptor, the plugin deserializes the exact stack here.
 *
 * Canonical file form is a root `item:` key holding the Bukkit-serialized
 * stack; a root-level `==:` document (hand-authored / migrated) is tolerated
 * by re-wrapping. Ids are project-scoped-unique by generation but resolved
 * globally (merged across projects, like module content files at runtime).
 *
 * Reload follows the atomic-reload invariant: a fresh map is built then
 * swapped into the @Volatile field — never mutated in place. `resolve` hands
 * out clones so callers can't corrupt the store.
 */
class CapturedItemStore(
    private val roots: net.artisanmc.plugin.project.ProjectRoots,
    private val logger: Logger?,
) {
    /** Test convenience — production passes the shared [net.artisanmc.plugin.project.ProjectRoots]. */
    constructor(projectsDir: File, logger: Logger?)
        : this(net.artisanmc.plugin.project.ProjectRoots(projectsDir), logger)

    @Volatile
    private var stacks: Map<String, ItemStack> = emptyMap()

    fun reload() {
        val fresh = HashMap<String, ItemStack>()
        roots.all().forEach { (projectId, projectDir) ->
            val itemsDir = File(projectDir, "items")
            itemsDir.listFiles { f -> f.isFile && (f.extension == "yml" || f.extension == "yaml") }
                ?.forEach { file ->
                    val id = file.nameWithoutExtension
                    val stack = deserialize(file.readText())
                    if (stack != null) fresh[id] = stack
                    else logger?.warning("[Artisan] captured item '$id' ($projectId) failed to deserialize — skipped")
                }
        }
        stacks = fresh
    }

    /** The exact captured stack (a clone), or null for an unknown id (dangling ref → caller falls back). */
    fun resolve(id: String): ItemStack? = stacks[id]?.clone()

    private fun deserialize(text: String): ItemStack? {
        // Canonical: `item:` root key.
        runCatching {
            val yml = YamlConfiguration()
            yml.loadFromString(text)
            yml.getItemStack("item")?.let { return it }
        }
        // Tolerated: root-level serialized stack — re-wrap under `item:`.
        return runCatching {
            val wrapped = "item:\n" + text.lines().joinToString("\n") { "  $it" }
            val yml = YamlConfiguration()
            yml.loadFromString(wrapped)
            yml.getItemStack("item")
        }.getOrNull()
    }
}
