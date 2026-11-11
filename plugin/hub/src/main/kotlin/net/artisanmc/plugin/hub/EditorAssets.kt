package net.artisanmc.plugin.hub

/**
 * The editor's Vite build, bundled under `editor/` in the jar. Any path that is not a
 * file returns `index.html`: the editor's router handles it in the browser.
 */
class EditorAssets(private val loader: ClassLoader, private val root: String = "editor") {
    val embedded: Boolean get() = loader.getResource("$root/index.html") != null

    fun serve(call: Call) {
        val path = call.path.trimStart('/')
        val file = path.takeIf { it.isNotEmpty() && ".." !in it }?.let { read(it) }
        if (file != null) {
            // Vite names its files by hash: a file under assets/ never changes.
            val cache = if (path.startsWith("assets/")) "public, max-age=31536000, immutable" else "no-cache"
            return call.send(200, contentType(path), file, cache)
        }
        val index = read("index.html") ?: return call.send(
            503, "text/plain; charset=utf-8", "This Artisan build does not embed the editor.".toByteArray(),
        )
        call.send(200, "text/html; charset=utf-8", index, "no-cache")
    }

    private fun read(path: String): ByteArray? =
        loader.getResource("$root/$path")?.takeIf { !it.path.endsWith("/") }?.openStream()?.use { it.readBytes() }

    private fun contentType(path: String): String = when (path.substringAfterLast('.', "").lowercase()) {
        "html" -> "text/html; charset=utf-8"
        "js", "mjs" -> "text/javascript; charset=utf-8"
        "css" -> "text/css; charset=utf-8"
        "json", "map" -> "application/json"
        "svg" -> "image/svg+xml"
        "png" -> "image/png"
        "jpg", "jpeg" -> "image/jpeg"
        "webp" -> "image/webp"
        "ico" -> "image/x-icon"
        "woff2" -> "font/woff2"
        "woff" -> "font/woff"
        "ttf" -> "font/ttf"
        "wasm" -> "application/wasm"
        "txt" -> "text/plain; charset=utf-8"
        else -> "application/octet-stream"
    }
}
