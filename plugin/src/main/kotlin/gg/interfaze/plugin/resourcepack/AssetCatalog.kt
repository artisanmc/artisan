package gg.interfaze.plugin.resourcepack

import com.fasterxml.jackson.databind.ObjectMapper
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.atomic.AtomicReference
import java.util.zip.ZipInputStream

/**
 * Single entry in the resource-pack asset index (`assets/interfaze/asset-index.json`).
 *
 * @param codepoint Unicode codepoint (for glyph-type assets), or null for non-glyph types.
 * @param ascent    Pixel ascent used by the font glyph (defaults to 0 when absent).
 * @param height    Pixel height used by the font glyph (defaults to 0 when absent).
 * @param namespace Font namespace (e.g. `interfaze:my_font`) for font-type assets;
 *                  null for non-font types (glyph, texture, etc.).
 */
data class AssetEntry(
    val name: String,
    val type: String,
    val codepoint: Int?,
    val ascent: Int,
    val height: Int,
    val namespace: String? = null,
) {
    /** Codepoint as a [Char] for direct use in MiniMessage / Component text. */
    val codepointChar: Char? get() = codepoint?.let { it.toChar() }
}

/**
 * Maintains an in-memory map of asset id → [AssetEntry] sourced from the pack zip.
 *
 * Thread-safe: [update] downloads the zip on the calling thread, parses
 * `assets/interfaze/asset-index.json`, and atomically swaps the lookup table
 * via an [AtomicReference]. Readers (via [lookup]) never block.
 *
 * Robust to HTTP failures: any IO/parse error leaves the previous state intact.
 */
class AssetCatalog(
    private val httpClient: OkHttpClient = OkHttpClient(),
    private val mapper: ObjectMapper = ObjectMapper(),
) {
    private val state = AtomicReference<Map<String, AssetEntry>>(emptyMap())

    /** Returns the cached entry for [assetId], or null if unknown. */
    fun lookup(assetId: String): AssetEntry? = state.get()[assetId]

    /** Current size of the in-memory catalog (useful for tests / metrics). */
    fun size(): Int = state.get().size

    /**
     * Downloads the pack at [packUrl], extracts `assets/interfaze/asset-index.json`,
     * parses it, and atomically swaps the in-memory map. On any failure (non-2xx,
     * missing entry, parse error, IOException) the previous state is preserved.
     *
     * @param packUrl       URL of the resource-pack .zip
     * @param expectedHash  expected SHA-1 of the pack (currently informational; reserved for future integrity checks)
     */
    @Suppress("UNUSED_PARAMETER")
    fun update(packUrl: String, expectedHash: String) {
        val req = Request.Builder().url(packUrl).build()
        try {
            httpClient.newCall(req).execute().use { resp ->
                if (!resp.isSuccessful) return
                val body = resp.body?.byteStream() ?: return
                ZipInputStream(body).use { zip ->
                    var entry = zip.nextEntry
                    while (entry != null) {
                        if (entry.name == "assets/interfaze/asset-index.json") {
                            val json = zip.readBytes().toString(Charsets.UTF_8)
                            state.set(parse(json))
                            return
                        }
                        entry = zip.nextEntry
                    }
                }
            }
        } catch (_: Throwable) {
            // Swallow: preserve previous state on any failure.
        }
    }

    private fun parse(json: String): Map<String, AssetEntry> {
        val root = mapper.readTree(json)
        val assets = root["assets"] ?: return emptyMap()
        val out = mutableMapOf<String, AssetEntry>()
        assets.fields().forEach { (id, node) ->
            out[id] = AssetEntry(
                name = node["name"]?.asText() ?: id,
                type = node["type"]?.asText() ?: "unknown",
                codepoint = if (node["codepoint"]?.isNumber == true) node["codepoint"].asInt() else null,
                ascent = node["ascent"]?.asInt() ?: 0,
                height = node["height"]?.asInt() ?: 0,
                namespace = node["namespace"]?.asText(),
            )
        }
        return out
    }
}
