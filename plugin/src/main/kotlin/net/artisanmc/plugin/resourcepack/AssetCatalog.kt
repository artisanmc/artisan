package net.artisanmc.plugin.resourcepack

import com.fasterxml.jackson.databind.ObjectMapper
import net.artisanmc.plugin.render.OffsetEncoder
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.atomic.AtomicReference
import java.util.zip.ZipInputStream

/**
 * Single entry in the resource-pack asset index (`assets/artisan/asset-index.json`).
 *
 * @param codepoint Unicode codepoint (for glyph-type assets), or null for non-glyph types.
 * @param ascent    Pixel ascent used by the font glyph (defaults to 0 when absent).
 * @param height    Pixel height used by the font glyph (defaults to 0 when absent).
 * @param width     Pixel width of the source PNG. Used by [net.artisanmc.plugin.render.TitleCompiler]
 *                  to advance the cursor past an image layer. 0 when absent
 *                  (legacy v1 packs) — TitleCompiler falls back to a default.
 * @param namespace Font namespace (e.g. `artisan:my_font`) for font-type assets;
 *                  null for non-font types (glyph, texture, etc.).
 */
data class AssetEntry(
    val name: String,
    val type: String,
    val codepoint: Int?,
    val ascent: Int,
    val height: Int,
    val width: Int = 0,
    val namespace: String? = null,
) {
    /** Codepoint as a [Char] for direct use in MiniMessage / Component text. */
    val codepointChar: Char? get() = codepoint?.let { it.toChar() }
}

/**
 * Maintains an in-memory map of asset id → [AssetEntry] sourced from the pack zip,
 * plus an [OffsetEncoder] derived from the index's `offsets` table (schema v2+).
 *
 * Thread-safe: [update] downloads the zip on the calling thread, parses
 * `assets/artisan/asset-index.json`, and atomically swaps the lookup table
 * via [AtomicReference]s. Readers (via [lookup] / [offsetEncoder]) never block.
 *
 * Robust to HTTP failures: any IO/parse error leaves the previous state intact.
 */
class AssetCatalog(
    private val httpClient: OkHttpClient = OkHttpClient(),
    private val mapper: ObjectMapper = ObjectMapper(),
) {
    private val state = AtomicReference<Map<String, AssetEntry>>(emptyMap())
    private val encoderRef = AtomicReference(OffsetEncoder.EMPTY)

    /** Returns the cached entry for [assetId], or null if unknown. */
    fun lookup(assetId: String): AssetEntry? = state.get()[assetId]

    /** Current size of the in-memory catalog (useful for tests / metrics). */
    fun size(): Int = state.get().size

    /**
     * Returns the [OffsetEncoder] built from the pack's `offsets` field.
     * Returns [OffsetEncoder.EMPTY] before any successful [update].
     */
    fun offsetEncoder(): OffsetEncoder = encoderRef.get()

    /**
     * Downloads the pack at [packUrl], extracts `assets/artisan/asset-index.json`,
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
                        if (entry.name == "assets/artisan/asset-index.json") {
                            val json = zip.readBytes().toString(Charsets.UTF_8)
                            val (assets, encoder) = parse(json)
                            state.set(assets)
                            encoderRef.set(encoder)
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

    private fun parse(json: String): Pair<Map<String, AssetEntry>, OffsetEncoder> {
        val root = mapper.readTree(json)
        val assetsNode = root["assets"] ?: return emptyMap<String, AssetEntry>() to OffsetEncoder.EMPTY
        val out = mutableMapOf<String, AssetEntry>()
        assetsNode.fields().forEach { (id, node) ->
            out[id] = AssetEntry(
                name = node["name"]?.asText() ?: id,
                type = node["type"]?.asText() ?: "unknown",
                codepoint = if (node["codepoint"]?.isNumber == true) node["codepoint"].asInt() else null,
                ascent = node["ascent"]?.asInt() ?: 0,
                height = node["height"]?.asInt() ?: 0,
                width = node["width"]?.asInt() ?: 0,
                namespace = node["namespace"]?.asText(),
            )
        }

        val offsetsNode = root["offsets"]
        val encoder = if (offsetsNode != null && offsetsNode.isObject) {
            val offsetMap = mutableMapOf<Int, Int>()
            offsetsNode.fields().forEach { (cpHex, advNode) ->
                val cp = runCatching { cpHex.toInt(16) }.getOrNull()
                val adv = if (advNode.isNumber) advNode.asInt() else null
                if (cp != null && adv != null) offsetMap[cp] = adv
            }
            OffsetEncoder.from(offsetMap)
        } else {
            OffsetEncoder.EMPTY
        }

        return out to encoder
    }
}
