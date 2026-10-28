package net.artisanmc.plugin.command

import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory
import net.artisanmc.modules.api.playercommand.PlayerCommandDeclaration
import net.artisanmc.plugin.project.EditorYaml
import net.artisanmc.plugin.project.ProjectPathPolicy
import net.artisanmc.plugin.project.ProjectPublisher
import java.io.File
import java.util.UUID
import java.util.logging.Logger

/**
 * Once per command: the admin's `command_override/v1` files (the old `overrides/command/`
 * folders) become the command's own file, `commands/<name>.yaml` in its module's folder,
 * written as `ModuleCommandFiles` would with the override's values in place of the module's:
 * name and aliases of the root, permission (`""`: none), description, cooldown, requirements,
 * fallback, `steps` as the actions, `enabled`. The file then counts as edited and stays the
 * admin's (`SystemFiles`). The override files move to [MIGRATED] in their folder.
 *
 * Left where they are, with a line in the log: the overrides of a command no module declares
 * (the module may come back), of a module without a folder, and of a command whose file the
 * admin already edited.
 */
class CommandOverrideMigration(
    private val projectDirs: () -> Map<String, File>,
    private val declarations: () -> List<PlayerCommandDeclaration>,
    /** The folder where the module that declared root command `rootId` keeps its system files; null: none. */
    private val folderOf: (rootId: String) -> File?,
    private val defaultLang: () -> String,
    private val logger: Logger?,
) {
    private val mapper = ObjectMapper(YAMLFactory())

    /** True when files were written or moved: the projects need a reload. */
    fun migrate(): Boolean {
        val found = read()
        if (found.isEmpty()) return false
        val roots = declarations()
        var wrote = false
        val moved = mutableListOf<Override>()
        for (root in roots) {
            val ids = ids(root)
            val mine = found.filter { it.command in ids }
            if (mine.isEmpty()) continue
            val folder = folderOf(root.id)
            if (folder == null) {
                logger?.warning("[Artisan] Command overrides of '${root.id}' kept in place: its module has no folder to write '${ModuleCommandFiles.path(root)}' in.")
                continue
            }
            val path = net.artisanmc.plugin.model.YamlFiles.onDisk(folder, ModuleCommandFiles.path(root))
            val target = ProjectPathPolicy.resolve(folder, path)
            if (target.exists() && target.readText() != ModuleCommandFiles.yaml(root)) {
                logger?.warning("[Artisan] Command overrides of '${root.id}' kept in place: '$path' was already edited. Copy what they change into it, then delete them.")
                continue
            }
            // The first by project then path, as the overrides were read.
            val byId = mine.groupBy { it.command }.mapValues { it.value.first().values }
            val yaml = EditorYaml.write(ModuleCommandFiles.document(root) { node, out -> dress(node, out, byId[node.id], node === root) })
            commit(folder, mapOf(path to yaml.toByteArray(Charsets.UTF_8)))
            logger?.info("[Artisan] Command overrides of '${root.id}' moved into '$path' (the old files are in $MIGRATED/).")
            moved += mine
            wrote = true
        }
        moved.groupBy { it.projectDir }.forEach { (dir, overrides) ->
            val changes = linkedMapOf<String, ByteArray?>()
            overrides.forEach { o ->
                changes["$MIGRATED/${o.relative}"] = o.bytes
                changes["$DIR/${o.relative}"] = null
            }
            commit(dir, changes)
        }
        return wrote
    }

    private fun dress(node: PlayerCommandDeclaration, out: MutableMap<String, Any?>, o: Map<String, Any?>?, isRoot: Boolean) {
        if (o == null) return
        if (isRoot) {
            (o["name"] as? String)?.trim()?.lowercase()?.takeIf { it.isNotEmpty() && it != node.name }?.let { name ->
                // After `schema`, where the editor writes it.
                val rest = out.toList()
                out.clear()
                rest.take(1).forEach { (k, v) -> out[k] = v }
                out["name"] = name
                rest.drop(1).forEach { (k, v) -> out[k] = v }
            }
            (o["aliases"] as? List<*>)?.let { list -> out["aliases"] = list.mapNotNull { it?.toString()?.lowercase() }.ifEmpty { null } }
        }
        if (o.containsKey("permission")) out["permission"] = (o["permission"] as? String)?.takeIf { it.isNotEmpty() }
        o["description"]?.let { out["description"] = it }
        o["steps"]?.let { out["actions"] = it }
        (o["requirements"] as? List<*>)?.takeIf { it.isNotEmpty() }?.let { out["requirements"] = it }
        o["fallback"]?.let { out["fallback"] = it }
        (o["cooldown"] as? Map<*, *>)?.let { out["cooldown"] = cooldown(it) }
        if (o["enabled"] == false) out["enabled"] = false
    }

    /** `command/v1` writes `duration_seconds`, and one message: the server's language when the override had several. */
    private fun cooldown(c: Map<*, *>): Map<String, Any?> {
        val out = linkedMapOf<String, Any?>()
        (c["id"] as? String)?.takeIf { it.isNotEmpty() }?.let { out["id"] = it }
        out["duration_seconds"] = c["duration_seconds"] ?: c["duration"] ?: 0
        (c["scope"] as? String)?.let { out["scope"] = it }
        when (val message = c["message"]) {
            is String -> out["message"] = message
            is Map<*, *> -> (message[defaultLang()] ?: message.values.firstOrNull())?.let { out["message"] = it.toString() }
        }
        return out
    }

    private class Override(val projectDir: File, val relative: String, val bytes: ByteArray, val values: Map<String, Any?>) {
        val command: String get() = (values["command"] as? String)?.trim().orEmpty()
    }

    private fun read(): List<Override> = projectDirs().toSortedMap().flatMap { (_, root) ->
        val dir = File(root, DIR)
        dir.takeIf { it.isDirectory }?.walkTopDown()
            ?.filter { it.isFile && (it.extension == "yaml" || it.extension == "yml") }
            ?.sortedBy { it.relativeTo(dir).invariantSeparatorsPath }
            ?.mapNotNull { file ->
                val bytes = file.readBytes()
                @Suppress("UNCHECKED_CAST")
                val values = runCatching { mapper.readValue(bytes, Map::class.java) as Map<String, Any?> }.getOrNull() ?: return@mapNotNull null
                Override(root, file.relativeTo(dir).invariantSeparatorsPath, bytes, values)
            }
            ?.toList().orEmpty()
    }

    private fun ids(declaration: PlayerCommandDeclaration): Set<String> =
        setOf(declaration.id) + declaration.children.flatMap(::ids)

    private fun commit(dir: File, changes: Map<String, ByteArray?>) {
        dir.mkdirs()
        ProjectPublisher(dir).commit(
            "migrate-${UUID.randomUUID()}", UUID.randomUUID().toString(), changes,
            ObjectMapper().valueToTree(mapOf("ok" to true)),
        )
    }

    companion object {
        /** Where the admin's override files were. */
        const val DIR = "overrides/command"
        /** Where they go once migrated, out of the projects' scan. */
        const val MIGRATED = ".artisan/migrated/overrides-command"
    }
}
