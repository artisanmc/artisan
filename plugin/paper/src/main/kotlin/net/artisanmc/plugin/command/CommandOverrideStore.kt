package net.artisanmc.plugin.command

import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory
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
 */
class CommandOverrideStore(private val projectDirs: () -> Map<String, File>, private val logger: Logger) {
    private val mapper = ObjectMapper(YAMLFactory()).registerKotlinModule()

    @Volatile
    var overrides: Map<String, CommandOverrideYaml> = emptyMap()
        private set

    fun reload() {
        val read = linkedMapOf<String, CommandOverrideYaml>()
        val origin = mutableMapOf<String, String>()
        val files = projectDirs().toSortedMap().flatMap { (project, root) ->
            val dir = File(root, DIR)
            dir.takeIf { it.isDirectory }?.walkTopDown()
                ?.filter { it.isFile && (it.extension == "yaml" || it.extension == "yml") }
                ?.map { "$project/$DIR/${it.relativeTo(dir).invariantSeparatorsPath}" to it }
                ?.sortedBy { it.first }
                ?.toList().orEmpty()
        }
        for ((path, file) in files) {
            val override = try {
                mapper.readValue(file, CommandOverrideYaml::class.java)
            } catch (e: Exception) {
                logger.warning("Command override '$path' is not valid YAML, ignored: ${e.message}")
                continue
            }
            val id = override.command.trim()
            if (id.isEmpty()) {
                logger.warning("Command override '$path' names no 'command', ignored.")
                continue
            }
            val first = origin.putIfAbsent(id, path)
            if (first != null) {
                logger.severe("Command '$id' is overridden by both '$first' and '$path': '$path' ignored. Delete one of them.")
                continue
            }
            read[id] = override
        }
        overrides = read
    }

    companion object {
        const val DIR = "overrides/command"
    }
}
