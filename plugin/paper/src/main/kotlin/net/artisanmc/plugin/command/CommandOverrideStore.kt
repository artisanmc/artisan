package net.artisanmc.plugin.command

import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory
import com.fasterxml.jackson.dataformat.yaml.YAMLGenerator
import net.artisanmc.modules.api.playercommand.PlayerCommandDeclaration
import net.artisanmc.modules.api.playercommand.PlayerCommandRegistry
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import net.artisanmc.plugin.model.CommandOverrideYaml
import java.io.File
import java.util.logging.Logger

/**
 * The admin's `command_override/v1` documents, one per command id, read from the
 * `overrides/command/` folder of every project (a module's folder once projects become
 * modules, cf. `design-projets-en-modules.md`). An override whose id no loaded module
 * declares is kept as is: the module may come back. Two files for the same id: the first
 * by project then path wins, the conflict is logged.
 *
 * Every declared command gets its file in its module's folder ([seed]): the module's values as
 * comments, so that the admin finds what to change on disk too. Never real keys, which would
 * freeze the module's values at its next update.
 */
class CommandOverrideStore(private val projectDirs: () -> Map<String, File>, private val logger: Logger) {
    private val mapper = ObjectMapper(YAMLFactory()).registerKotlinModule()

    @Volatile
    var overrides: Map<String, CommandOverrideYaml> = emptyMap()
        private set

    fun reload() = apply(read())

    /** The overrides on disk, read and parsed on any thread; [apply] swaps them in. */
    fun read(): Map<String, CommandOverrideYaml> = read(log = true)

    fun apply(read: Map<String, CommandOverrideYaml>) {
        overrides = read
    }

    private fun read(log: Boolean): Map<String, CommandOverrideYaml> {
        val read = linkedMapOf<String, CommandOverrideYaml>()
        val origin = mutableMapOf<String, String>()
        val files = projectDirs().toSortedMap().flatMap { (project, root) ->
            val dir = File(root, DIR)
            dir.takeIf { it.isDirectory }?.walkTopDown()
                ?.filter { it.isFile && (it.extension == "yaml" || it.extension == "yml") }
                ?.map { Triple(project, "$project/$DIR/${it.relativeTo(dir).invariantSeparatorsPath}", it) }
                ?.sortedBy { it.second }
                ?.toList().orEmpty()
        }
        for ((project, path, file) in files) {
            val override = try {
                mapper.readValue(file, CommandOverrideYaml::class.java)
            } catch (e: Exception) {
                if (log) logger.warning("Command override '$path' is not valid YAML, ignored: ${e.message}")
                continue
            }
            val id = override.command.trim()
            if (id.isEmpty()) {
                if (log) logger.warning("Command override '$path' names no 'command', ignored.")
                continue
            }
            val first = origin.putIfAbsent(id, path)
            if (first != null) {
                if (log) logger.severe("Command '$id' is overridden by both '$first' and '$path': '$path' ignored. Delete one of them.")
                continue
            }
            read[id] = override.copy(project = project)
        }
        return read
    }

    /**
     * Writes the [skeleton] of each command of [registry] that no folder overrides yet, in the
     * folder of the module that declared it ([folderOf]; none: nothing written). Never replaces
     * a file, and reads the disk rather than the last [reload]: an override moved to another
     * folder is never doubled. True when something was written: [reload] then reads it.
     */
    fun seed(registry: PlayerCommandRegistry, folderOf: (moduleId: String) -> File?): Boolean {
        var wrote = false
        val existing = read(log = false).keys
        fun visit(declaration: PlayerCommandDeclaration, folder: File, isRoot: Boolean) {
            if (declaration.id !in existing) {
                val file = File(folder, "$DIR/${declaration.id.replace(':', '.')}.yaml")
                if (!file.exists()) {
                    try {
                        file.parentFile.mkdirs()
                        file.writeText(skeleton(declaration, isRoot))
                        wrote = true
                    } catch (e: Exception) {
                        logger.warning("Command override '${file.path}' could not be written: ${e.message}")
                    }
                }
            }
            declaration.children.forEach { visit(it, folder, isRoot = false) }
        }
        for (declaration in registry.declarations()) {
            val folder = registry.ownerOf(declaration.id)?.let(folderOf) ?: continue
            visit(declaration, folder, isRoot = true)
        }
        return wrote
    }

    /** `schema` and `command`, then the module's values commented out: an override that changes nothing. */
    fun skeleton(declaration: PlayerCommandDeclaration, isRoot: Boolean): String {
        val values = linkedMapOf<String, Any?>()
        if (isRoot) {
            values["name"] = declaration.name
            values["aliases"] = declaration.aliases
        }
        declaration.permission?.let { values["permission"] = it }
        if (declaration.description.isNotEmpty()) values["description"] = declaration.description.toSortedMap()
        val commented = commentMapper.writeValueAsString(values).trimEnd().lines().joinToString("\n") { "# $it" }
        return "schema: command_override/v1\ncommand: ${declaration.id}\n" +
            "# The module's values. Uncomment a line to change it; delete this file to go back to them.\n" +
            commented + "\n"
    }

    private val commentMapper = ObjectMapper(
        YAMLFactory().disable(YAMLGenerator.Feature.WRITE_DOC_START_MARKER).enable(YAMLGenerator.Feature.MINIMIZE_QUOTES),
    )

    companion object {
        const val DIR = "overrides/command"
    }
}
