package net.artisanmc.plugin.project

import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory
import net.artisanmc.modules.api.template.TemplateDeclaration
import java.io.File
import java.util.UUID

/**
 * Keeps a module's system elements in its folder (a system template, `TemplateDeclaration.isSystem`,
 * design `framework-commandes` §3.8): the menus and dialogs its code opens by id. Each file is
 * the shipped version until the owner edits it, then the owner's until the editor resets it:
 * - missing: written, unless a file of that name was moved to another folder of the module;
 * - an untouched copy of an earlier version: replaced by the shipped one;
 * - holding the shipped content: only its origin is recorded;
 * - edited, when the module ships another version: merged ([ThreeWayMerge]) from the version
 *   it was copied from, kept in [BASES], to the shipped one. Without a conflict the merged file
 *   follows the shipped version from then on; with one, the owner's values stay and the origin
 *   stays on the version it was copied from, so the editor tells that the module ships another
 *   one. A file that is not YAML, or whose base was never kept, stays as it is, likewise.
 *   A file that was there before the module made it a system element (no origin) counts as
 *   edited from the shipped version.
 *
 * Writes go through one journaled commit, origins and bases included ([ProjectPublisher]), on
 * the workspace's I/O thread like every disk write.
 */
object SystemFiles {
    /**
     * `.artisan/bases/<hash>`: the content of each version an origin names, the base of the next
     * merge. Private (out of every scan and content channel); a base no origin names is removed.
     */
    const val BASES = ".artisan/bases"

    private val yaml = ObjectMapper(YAMLFactory())

    /**
     * Paths written; empty when the folder already held every file as it should. [onMerged] is
     * told each edited file the merge rewrote, with the keys left to the owner's value.
     */
    fun sync(
        projectDir: File,
        moduleId: String,
        template: TemplateDeclaration,
        onMerged: (path: String, conflicts: List<String>) -> Unit = { _, _ -> },
    ): List<String> {
        require(template.isSystem) { "template '${template.id}' is not a system template" }
        val origins = ProjectOrigins.read(projectDir).toMutableMap()
        val before = origins.toMap()
        val changes = linkedMapOf<String, ByteArray?>()
        val merged = linkedMapOf<String, List<String>>()
        for (path in template.paths) {
            val shipped = template.getFile(path)!!
            val hash = template.getHash(path)!!
            val shippedOrigin = FileOrigin(moduleId, template.id, template.version, hash)
            val target = ProjectPathPolicy.resolve(projectDir, path)
            val origin = origins[path]?.takeIf { it.module == moduleId && it.template == template.id }
            if (!target.exists()) {
                if (movedElsewhere(projectDir, path)) continue
                changes[path] = shipped
                origins[path] = shippedOrigin
                continue
            }
            if (!target.isFile) continue
            val bytes = target.readBytes()
            val current = ContentHash.hashBytes(bytes)
            when {
                current == hash -> origins[path] = shippedOrigin
                origin == null -> origins[path] = shippedOrigin
                current == origin.hash -> {
                    changes[path] = shipped
                    origins[path] = shippedOrigin
                }
                origin.hash != hash -> merge(projectDir, path, origin.hash, bytes, shipped)?.let { (content, conflicts) ->
                    if (conflicts.isEmpty()) origins[path] = shippedOrigin
                    if (content != null) {
                        changes[path] = content
                        merged[path] = conflicts
                    }
                }
            }
        }
        // The shipped content is the base of every file copied from it.
        for (path in template.paths) {
            val hash = template.getHash(path)!!
            if (origins[path]?.hash == hash && !base(projectDir, hash).isFile) changes["$BASES/$hash"] = template.getFile(path)!!
        }
        val named = origins.values.mapTo(HashSet()) { it.hash }
        ProjectPathPolicy.resolve(projectDir, BASES).listFiles()?.forEach { file ->
            if (file.isFile && file.name !in named) changes["$BASES/${file.name}"] = null
        }
        if (changes.isEmpty() && origins == before) return emptyList()
        changes[ProjectOrigins.PATH] = ProjectOrigins.serialize(origins)
        projectDir.mkdirs()
        ProjectPublisher(projectDir).commit(
            "system-${UUID.randomUUID()}", UUID.randomUUID().toString(), changes,
            com.fasterxml.jackson.databind.ObjectMapper().valueToTree(mapOf("ok" to true)),
        )
        merged.forEach { (path, conflicts) -> onMerged(path, conflicts) }
        return changes.keys.filter { it != ProjectOrigins.PATH && !it.startsWith("$BASES/") }
    }

    private fun base(projectDir: File, hash: String): File = ProjectPathPolicy.resolve(projectDir, "$BASES/$hash")

    /**
     * The owner's file [ours] merged with [shipped] from the base [baseHash]: the bytes to write
     * (null when the merge is the owner's file as is) and the conflicts; null when it cannot be
     * merged (not YAML, no base, a document that is not a map).
     */
    private fun merge(projectDir: File, path: String, baseHash: String, ours: ByteArray, shipped: ByteArray): Pair<ByteArray?, List<String>>? {
        if (!path.endsWith(".yaml") && !path.endsWith(".yml")) return null
        val baseFile = base(projectDir, baseHash).takeIf { it.isFile } ?: return null
        val base = baseFile.readBytes().takeIf { ContentHash.hashBytes(it) == baseHash } ?: return null
        val (b, o, t) = runCatching { listOf(base, ours, shipped).map { yaml.readValue(it, Any::class.java) } }.getOrNull() ?: return null
        if (b !is Map<*, *> || o !is Map<*, *> || t !is Map<*, *>) return null
        val result = ThreeWayMerge.merge(b, o, t)
        @Suppress("UNCHECKED_CAST")
        val content = when (val value = result.value as? Map<String, Any?> ?: return null) {
            o -> null
            t -> shipped
            else -> EditorYaml.write(value).toByteArray(Charsets.UTF_8)
        }
        return content to result.conflicts
    }

    /**
     * A file of the same name under a kind folder of the same name elsewhere in the module
     * (`armes/menus/shop.yaml` for `menus/shop.yaml`): the same Document, moved. Writing it
     * again would give the module two Documents with one id, both refused.
     */
    private fun movedElsewhere(projectDir: File, path: String): Boolean {
        val name = path.substringAfterLast('/')
        val kindDir = path.substringBeforeLast('/', "").substringAfterLast('/')
        if (kindDir.isEmpty()) return false
        return projectDir.walkTopDown()
            .onEnter { it == projectDir || !it.name.startsWith(".artisan") }
            .any { it.isFile && it.name == name && it.parentFile.name == kindDir }
    }
}
