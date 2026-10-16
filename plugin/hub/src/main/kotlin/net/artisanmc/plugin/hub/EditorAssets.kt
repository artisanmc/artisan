package net.artisanmc.plugin.hub

import java.io.File

/**
 * The editor's Vite build, bundled under `editor/` in the jar. Any path that is not a
 * file returns `index.html`: the editor's router handles it in the browser.
 *
 * When [overrideDir] holds an `index.html`, the build in that folder is served instead of the
 * jar's, read on each request: dropping a new build there updates the editor without a
 * restart, and removing the folder brings back the jar's.
 */
class EditorAssets(
    private val loader: ClassLoader,
    private val root: String = "editor",
    private val overrideDir: File? = null,
) {
    val embedded: Boolean get() = loader.getResource("$root/index.html") != null

    /** True while [overrideDir] holds a build: the jar's build is not served. */
    val overridden: Boolean get() = overrideDir?.let { File(it, "index.html").isFile } == true

    fun serve(call: Call) {
        val path = call.path.trimStart('/')
        val file = path.takeIf { it.isNotEmpty() }?.let { read(it) }
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

    /** The file at [path] of the build being served, or null when it is not a file of it. */
    internal fun read(path: String): ByteArray? {
        if (".." in path) return null
        if (overridden) {
            val base = overrideDir!!.canonicalFile
            val file = File(base, path).canonicalFile
            if (!file.toPath().startsWith(base.toPath()) || !file.isFile) return null
            return runCatching { file.readBytes() }.getOrNull()
        }
        return loader.getResource("$root/$path")?.takeIf { !it.path.endsWith("/") }?.openStream()?.use { it.readBytes() }
    }

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
