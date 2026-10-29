package net.artisanmc.plugin.project

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory

/**
 * The Artisan Pro features a set of project files depends on (docs/architecture/editions.md).
 * Content a module ships must use none: on the free jar nobody can build the resource pack its
 * titles and images need, so they would show missing glyphs. Content a server owner made with Pro
 * is not concerned: it keeps rendering on the free jar with the pack the hub already has.
 *
 * Read-only and lenient: a file that does not parse is skipped, it is not this check's business.
 */
object ProFeatures {
    /** One Pro dependency: which [feature] (`title_composer`, `resource_pack`), in which [path]. */
    data class Usage(val feature: String, val path: String)

    const val TITLE_COMPOSER = "title_composer"
    const val RESOURCE_PACK = "resource_pack"

    private val yaml = ObjectMapper(YAMLFactory())
    private val MENU = Regex("^menus/.+\\.ya?ml$")

    fun scan(files: Map<String, ByteArray>): List<Usage> = files.flatMap { (path, bytes) -> scan(path, bytes) }

    fun scan(path: String, bytes: ByteArray): List<Usage> {
        // Images and fonts go into the pack the editor builds.
        if (path.startsWith("assets/")) return listOf(Usage(RESOURCE_PACK, path))
        if (!MENU.matches(path)) return emptyList()
        val doc = runCatching { yaml.readTree(bytes) }.getOrNull()?.takeIf { it.isObject } ?: return emptyList()
        val out = mutableListOf<Usage>()
        // A plain title (a string, `{i18n: key}` or one `plain` layer) is free; any other layer is placed by the composer.
        val title = doc["title"]
        if (title != null && title.isArray && title.any { it["kind"]?.asText() != "plain" }) out += Usage(TITLE_COMPOSER, path)
        // A transparent window and image buttons are textures of the pack.
        if (doc["vanilla_texture"]?.let { it.isBoolean && !it.booleanValue() } == true || usesImage(doc)) out += Usage(RESOURCE_PACK, path)
        return out
    }

    private fun usesImage(doc: JsonNode): Boolean {
        val elements = doc["elements"]?.toList().orEmpty() + doc["layers"]?.flatMap { it["elements"]?.toList().orEmpty() }.orEmpty()
        return elements.any { el ->
            (listOf(el) + el["states"]?.toList().orEmpty()).any { it["image"]?.get("asset")?.asText().isNullOrEmpty().not() }
        }
    }
}
