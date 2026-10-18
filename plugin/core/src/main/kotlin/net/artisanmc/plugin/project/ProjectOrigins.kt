package net.artisanmc.plugin.project

import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory
import java.io.File

/**
 * Where the files of a Project that were copied from a module's template came from
 * (`.artisan/origins.yaml`, plugin-owned metadata: out of the hash, invisible to the editor's
 * file view, served by `project_origins_fetch`). One entry per copied file: the module and
 * template, the template's version, and the hash of the file as shipped. A file whose content
 * still has that hash is an untouched copy; any other content is the owner's.
 *
 * Only the copy writes it ([TemplateCopies]). An edit leaves it alone (the hash tells), a
 * delete leaves a stale entry (the file is "removed" from the template's point of view), and
 * a rename in the editor loses the link: the renamed file is the owner's.
 */
data class FileOrigin(val module: String, val template: String, val version: Int, val hash: String) {
    fun toWire(): Map<String, Any> = linkedMapOf("module" to module, "template" to template, "version" to version, "hash" to hash)
}

object ProjectOrigins {
    const val PATH = ".artisan/origins.yaml"

    private val yaml = ObjectMapper(YAMLFactory())

    /** The origins recorded in [projectDir], by project-relative path; empty when none, or unreadable. */
    fun read(projectDir: File): Map<String, FileOrigin> {
        val file = ProjectPathPolicy.resolve(projectDir, PATH)
        if (!file.isFile) return emptyMap()
        val root = runCatching { yaml.readTree(file) }.getOrNull() ?: return emptyMap()
        val files = root.path("files")
        if (!files.isObject) return emptyMap()
        val out = sortedMapOf<String, FileOrigin>()
        files.fields().forEach { (path, entry) ->
            val module = entry.path("module").asText("")
            val template = entry.path("template").asText("")
            val hash = entry.path("hash").asText("")
            val version = entry.path("version").asInt(0)
            if (module.isNotEmpty() && template.isNotEmpty() && hash.isNotEmpty() && version > 0) {
                out[path] = FileOrigin(module, template, version, hash)
            }
        }
        return out
    }

    /** The bytes of an origins file holding [origins]. */
    fun serialize(origins: Map<String, FileOrigin>): ByteArray {
        val files = origins.toSortedMap().mapValues { it.value.toWire() }
        return yaml.writeValueAsBytes(mapOf("files" to files))
    }
}
