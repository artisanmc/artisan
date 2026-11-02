package net.artisanmc.plugin.model

import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory

/**
 * A module's originals (design `originaux-modules`): `originals/` holds what the module ships,
 * written by the server only ([net.artisanmc.plugin.project.SystemFiles]); the owner's folder
 * holds what the owner changed or added, and wins id for id ([DocumentLayout]).
 *
 * `originals/originals.yml` ([INDEX]) says what is there: the module, its version, and the
 * [Index.required] files, those the module's code opens by id. A required file cannot be
 * excluded: its exclusion is ignored and reported.
 */
object Originals {
    const val DIR = DocumentLayout.ORIGINALS_DIR

    /** The index, inside [DIR]. */
    const val INDEX = "originals.yml"

    const val INDEX_PATH = "$DIR/$INDEX"

    private val yaml = ObjectMapper(YAMLFactory())

    data class Index(val module: String = "", val version: Int = 0, val required: List<String> = emptyList())

    /** [INDEX]'s text; an empty index when absent or unreadable. */
    fun parseIndex(text: String?): Index {
        if (text.isNullOrBlank()) return Index()
        val root = runCatching { yaml.readTree(text) }.getOrNull() ?: return Index()
        return Index(
            root.path("module").asText(""),
            root.path("version").asInt(0),
            root.path("required").mapNotNull { it.asText(null) },
        )
    }

    fun writeIndex(index: Index): ByteArray = yaml.writeValueAsBytes(
        linkedMapOf("module" to index.module, "version" to index.version, "required" to index.required.sorted()),
    )

    /** The exclusions in effect, and those refused because the file is required. */
    data class Exclusions(val excluded: List<String>, val refused: List<String>)

    fun exclusions(manifest: ManifestYaml?, index: Index): Exclusions {
        val required = index.required.mapTo(HashSet(), DocumentLayout::sameFile)
        val (refused, excluded) = manifest?.originals?.exclude.orEmpty().partition { DocumentLayout.sameFile(it) in required }
        return Exclusions(excluded, refused)
    }

    /** Whether [path] (relative to the module folder) is under [DIR]: written by the server only. */
    fun isOriginal(path: String): Boolean = path.replace('\\', '/').startsWith("$DIR/")
}
