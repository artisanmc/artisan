package net.artisanmc.plugin.project

import com.fasterxml.jackson.databind.ObjectMapper
import net.artisanmc.plugin.model.ModuleFile
import net.artisanmc.plugin.model.YamlFiles
import java.io.File
import java.util.UUID
import java.util.logging.Logger

/**
 * Moves a module folder's YAML files to `.yml` ([YamlFiles.EXT]), the module file to
 * `artisan-module.yml`, and the origins that name them with them, in one journaled commit
 * ([ProjectPublisher]). Only names change: the bytes stay, so a draft started before still
 * matches the disk (the editor and [DraftPublication] read its paths as the disk spells them),
 * and a module file keeps `schema: manifest/v1` until the editor writes it again. Run on each
 * folder of the modules root the first time a start lists it: a `.yaml` file dropped there
 * later moves on the next start.
 *
 * The `.artisan*` metadata stays as it is. A file whose `.yml` twin is already there is left
 * alone, and named in the log: both copies are read ([YamlFiles]), the owner merges them.
 */
object YmlMigration {
    /** The renames done, old path to new; empty when the folder had nothing to move. */
    fun run(dir: File, logger: Logger? = null): Map<String, String> {
        val renames = linkedMapOf<String, String>()
        val twins = mutableListOf<String>()
        for (path in yamlFiles(dir)) {
            val to = if (ModuleFile.isModuleFile(path)) ModuleFile.NAME else YamlFiles.canonical(path)
            if (to == path) continue
            if (File(dir, to).exists() || to in renames.values) twins += path else renames[path] = to
        }
        if (twins.isNotEmpty()) {
            logger?.warning("[Artisan] ${dir.name}: ${twins.joinToString()} kept as is, a .yml copy is already there. Merge each into its copy, then delete it.")
        }
        if (renames.isEmpty()) return emptyMap()
        val changes = linkedMapOf<String, ByteArray?>()
        for ((from, to) in renames) {
            changes[from] = null
            changes[to] = File(dir, from).readBytes()
        }
        val origins = ProjectOrigins.read(dir)
        if (origins.keys.any { it in renames }) {
            changes[ProjectOrigins.PATH] = ProjectOrigins.serialize(origins.mapKeys { (path, _) -> renames[path] ?: path })
        }
        ProjectPublisher(dir).commit(
            "yml-${UUID.randomUUID()}", UUID.randomUUID().toString(), changes,
            ObjectMapper().valueToTree(mapOf("ok" to true)),
        )
        logger?.info("[Artisan] ${dir.name}: ${renames.size} file(s) moved to .yml${if (ModuleFile.NAME in renames.values) ", the module file to ${ModuleFile.NAME}" else ""}.")
        return renames
    }

    /** The `.yaml` (and module) files of [dir], `.artisan*` metadata and symbolic links aside. */
    private fun yamlFiles(dir: File): List<String> = dir.walkTopDown()
        .onEnter { it == dir || (!it.name.startsWith(".") && !java.nio.file.Files.isSymbolicLink(it.toPath())) }
        .filter { it.isFile && !java.nio.file.Files.isSymbolicLink(it.toPath()) }
        .map { it.relativeTo(dir).invariantSeparatorsPath }
        .filter { (it.endsWith(".yaml") || ModuleFile.isModuleFile(it)) && !it.substringAfterLast('/').startsWith(".") }
        .sorted()
        .toList()
}
