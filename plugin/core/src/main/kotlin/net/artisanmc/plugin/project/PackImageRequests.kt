package net.artisanmc.plugin.project

import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory
import net.artisanmc.modules.api.document.PackImagesProvider
import net.artisanmc.modules.api.text.OverlayApi

/**
 * An image a Project's Documents ask the pack for (`PackImagesProvider`, the editor's `pack.images`):
 * at a [rise] above the text's top, or by its [bottom]. Exactly one of the two is set.
 */
data class PackImageRequest(val asset: String, val rise: Int? = null, val bottom: Int? = null) {
    fun toMap(): Map<String, Any> = buildMap {
        put("asset", asset)
        rise?.let { put("rise", it) }
        bottom?.let { put("bottom", it) }
    }

    companion object {
        fun from(value: Any?): PackImageRequest? {
            val map = value as? Map<*, *> ?: return null
            val asset = map["asset"] as? String ?: return null
            val rise = (map["rise"] as? Number)?.toInt()
            val bottom = (map["bottom"] as? Number)?.toInt()
            return if ((rise == null) == (bottom == null)) null else PackImageRequest(asset, rise, bottom)
        }
    }
}

/**
 * The pack images a Project's files ask for, through the kinds that declare a [PackImagesProvider]:
 * computed at load so the hub builds the pack without the modules' editor code
 * (`overlayImagesFromFiles` in the editor, which this mirrors request for request).
 *
 * Order: the files in path order (code units), each asking through the kind of its folder. A file
 * that does not parse, or whose provider throws, adds nothing: a module's bug must not cost the
 * server its pack. [warn] hears about the throws.
 */
object PackImageRequests {
    private val yaml = ObjectMapper(YAMLFactory())
    private val DOCUMENT = Regex("^([^/]+)/([^/]+)\\.ya?ml$")
    private val IN_DIR = Regex("^(.+)/([^/]+)\\.ya?ml$")

    fun of(
        files: Map<String, String>,
        providers: Map<String, PackImagesProvider>,
        warn: (String) -> Unit = {},
    ): List<PackImageRequest> {
        if (providers.isEmpty()) return emptyList()
        val paths = files.keys.sorted()
        val parsed = HashMap<String, Any?>()
        fun parse(path: String): Any? = parsed.getOrPut(path) {
            files[path]?.let { runCatching { yaml.readValue(it, Any::class.java) }.getOrNull() }
        }
        val context = object : PackImagesProvider.Context {
            override fun file(path: String): Any? = parse(path)
            override fun files(dir: String): List<PackImagesProvider.DirFile> = paths.mapNotNull { path ->
                val match = IN_DIR.matchEntire(path) ?: return@mapNotNull null
                if (match.groupValues[1] != dir) null else PackImagesProvider.DirFile(match.groupValues[2], parse(path))
            }
        }
        val out = ArrayList<PackImageRequest>()
        for (path in paths) {
            val match = DOCUMENT.matchEntire(path) ?: continue
            val provider = providers[match.groupValues[1]] ?: continue
            @Suppress("UNCHECKED_CAST")
            val document = parse(path) as? Map<String, Any?> ?: continue
            val images = try {
                provider.images(LinkedHashMap<String, Any?>(document).apply { put("id", match.groupValues[2]) }, context)
            } catch (e: Throwable) {
                warn("$path: its pack images failed (${e.javaClass.simpleName}: ${e.message})")
                continue
            }
            for (image in images.orEmpty()) {
                val asset = image?.asset()?.takeIf { it.isNotEmpty() } ?: continue
                val rise = image.rise()
                val bottom = image.bottom()
                when {
                    bottom != null -> out += PackImageRequest(asset, bottom = bottom)
                    rise != null && rise >= OverlayApi.MIN_RISE && rise <= OverlayApi.MAX_RISE -> out += PackImageRequest(asset, rise = rise)
                }
            }
        }
        return out
    }
}
