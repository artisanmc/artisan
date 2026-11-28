package net.artisanmc.plugin.project

import com.fasterxml.jackson.databind.ObjectMapper
import net.artisanmc.plugin.yamlio.Yaml12
import java.io.File

/**
 * What a module (or Artisan, for the theme `artisan`) shipped into a folder that holds its whole
 * tree (ADR `editable-module-tree`, decision 2): `artisan-shipped.yml` at the folder's root, one
 * entry per path, written by the server only ([SystemFiles]) and read by everyone. It is content:
 * in the hash, the Versions and the database, so a file's state (untouched, modified, deleted,
 * added) is known with the server offline, and a restored Version brings back the index of its
 * files.
 *
 * An entry is the shipped content a file was written from or merged against ([hash], of
 * [template]'s [version]) and whether the module's code needs it ([required]).
 */
object ShippedIndex {
    const val PATH = net.artisanmc.plugin.model.Originals.SHIPPED_INDEX

    private const val HEADER =
        "# Written by Artisan: what the module shipped into this folder. Do not edit; edit the files themselves.\n"

    private val yaml = ObjectMapper(Yaml12.factory())

    data class Entry(
        val module: String,
        val template: String,
        val version: Int,
        val hash: String,
        val required: Boolean = false,
    ) {
        val origin: FileOrigin get() = FileOrigin(module, template, version, hash)

        fun toWire(): Map<String, Any> = linkedMapOf<String, Any>("module" to module, "template" to template, "version" to version, "hash" to hash)
            .also { if (required) it["required"] = true }

        companion object {
            fun of(origin: FileOrigin, required: Boolean) = Entry(origin.module, origin.template, origin.version, origin.hash, required)
        }
    }

    fun isIndex(path: String): Boolean = path.replace('\\', '/') == PATH

    /** The entries of [text], by path; empty when absent or unreadable. */
    fun parse(text: String?): Map<String, Entry> {
        if (text.isNullOrBlank()) return emptyMap()
        val root = runCatching { yaml.readTree(text) }.getOrNull() ?: return emptyMap()
        val files = root.path("files")
        if (!files.isObject) return emptyMap()
        val out = sortedMapOf<String, Entry>()
        files.fields().forEach { (path, e) ->
            val module = e.path("module").asText("")
            val template = e.path("template").asText("")
            val hash = e.path("hash").asText("")
            val version = e.path("version").asInt(0)
            if (module.isNotEmpty() && template.isNotEmpty() && hash.isNotEmpty() && version > 0) {
                out[path] = Entry(module, template, version, hash, e.path("required").asBoolean(false))
            }
        }
        return out
    }

    fun read(dir: File): Map<String, Entry> =
        parse(File(dir, PATH).takeIf { it.isFile }?.readText())

    fun exists(dir: File): Boolean = File(dir, PATH).isFile

    fun serialize(entries: Map<String, Entry>): ByteArray {
        val body = yaml.writeValueAsString(mapOf("files" to entries.toSortedMap().mapValues { it.value.toWire() }))
        return (HEADER + body.removePrefix("---\n")).toByteArray(Charsets.UTF_8)
    }
}
