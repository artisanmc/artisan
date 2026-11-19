package net.artisanmc.plugin.hub

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import java.awt.RenderingHints
import java.awt.image.BufferedImage
import java.io.ByteArrayOutputStream
import java.io.File
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.security.MessageDigest
import java.util.logging.Level
import java.util.logging.Logger
import java.util.zip.ZipFile
import javax.imageio.ImageIO

/**
 * Vanilla items and textures.
 *
 * The item catalog is generated once per version in the repository (`tools/minecraft-assets/items`)
 * and ships in the jar. Two downloads happen on the first texture request, so a server that never
 * opens the editor downloads nothing:
 * - textures, from the Mojang client jar into `<cache>/<version>/`;
 * - the 3D icons (`icons/<id>`, from `gen-icons.ts`, ~15 MB a version), from [iconsUrl] into
 *   `<cache>/icons/<catalog version>/`, checked against the SHA-256 the jar carries.
 * A failed download is tried again after [RETRY_MS]; until then an item shows its flat texture.
 */
class VanillaAssets(
    private val cache: File,
    private val version: String,
    private val logger: Logger?,
    private val loader: ClassLoader = VanillaAssets::class.java.classLoader,
    private val manifestUrl: String = MANIFEST,
    /** Where `icons-<version>.zip` is downloaded from (the CDN's `/vanilla`), or null for no icons but the jar's. */
    private val iconsUrl: String? = null,
) {
    private val mapper = ObjectMapper()
    private val textures get() = File(cache, "$version/textures")
    private val done get() = File(cache, "$version/.done")
    private val texturesFetch = Fetch("artisan-vanilla") { download() }
    private val iconsFetch = Fetch("artisan-vanilla-icons") { downloadIcons() }

    /** The bundled catalog closest to the server's version. */
    val catalogVersion: String? by lazy {
        val known = loader.getResourceAsStream("$ROOT/items/versions.txt")?.bufferedReader()?.readLines()
            ?.map { it.trim() }?.filter { it.isNotEmpty() }.orEmpty().sortedWith(VERSIONS)
        known.firstOrNull { it == version }
            ?: known.lastOrNull { minor(it) == minor(version) }
            ?: known.lastOrNull()
    }

    val items: JsonNode? by lazy {
        catalogVersion?.let { v -> loader.getResourceAsStream("$ROOT/items/$v.json")?.use { mapper.readTree(it) } }
    }

    /** `item/diamond_sword`, `icons/acacia_button`, `font/ascii`: a PNG, or null. */
    fun texture(path: String): ByteArray? {
        if (!PATH.matches(path) || ".." in path) return null
        if (path.startsWith(ICONS)) {
            val v = catalogVersion ?: return null
            File(icons(v), "${path.removePrefix(ICONS)}.png").takeIf { it.isFile }?.let { return it.readBytes() }
            if (!File(icons(v), ".done").isFile && iconsUrl != null && iconsHash(v) != null) iconsFetch.start()
            return loader.getResourceAsStream("$ROOT/$v/textures/$path.png")?.use { it.readBytes() }
        }
        File(textures, "$path.png").takeIf { it.isFile }?.let { return it.readBytes() }
        if (!done.isFile) texturesFetch.start()
        return null
    }

    @Volatile private var atlas: ByteArray? = null

    /**
     * Every catalogue item's picture in one PNG, so a grid of items costs the editor one request
     * instead of one per item (about 1,650, too many for the editor tunnel's limits). Item `i` of
     * [items] is the [ATLAS_CELL] px square at column `i % ATLAS_COLUMNS`, row `i / ATLAS_COLUMNS`;
     * an item without a picture leaves its square empty. Null, and the downloads started, until
     * the textures and the icons are here: an atlas is built once, from complete files.
     */
    fun atlas(): ByteArray? {
        atlas?.let { return it }
        val list = items ?: return null
        if (!done.isFile) { texturesFetch.start(); return null }
        val v = catalogVersion
        if (v != null && iconsUrl != null && iconsHash(v) != null && !File(icons(v), ".done").isFile) {
            iconsFetch.start()
            return null
        }
        return synchronized(this) { atlas ?: buildAtlas(list).also { atlas = it } }
    }

    private fun buildAtlas(list: JsonNode): ByteArray {
        val rows = (list.size() + ATLAS_COLUMNS - 1) / ATLAS_COLUMNS
        val sheet = BufferedImage(ATLAS_COLUMNS * ATLAS_CELL, maxOf(rows, 1) * ATLAS_CELL, BufferedImage.TYPE_INT_ARGB)
        val g = sheet.createGraphics()
        try {
            list.forEachIndexed { i, item ->
                val path = item["texture"]?.asText()?.takeIf { it.isNotEmpty() } ?: return@forEachIndexed
                val image = texture(path)?.let { runCatching { ImageIO.read(it.inputStream()) }.getOrNull() } ?: return@forEachIndexed
                g.drawImage(cell(image), (i % ATLAS_COLUMNS) * ATLAS_CELL, (i / ATLAS_COLUMNS) * ATLAS_CELL, null)
            }
        } finally {
            g.dispose()
        }
        return ByteArrayOutputStream().also { ImageIO.write(sheet, "png", it) }.toByteArray()
    }

    private fun icons(v: String) = File(cache, "icons/$v")

    /** The SHA-256 of `icons-<v>.zip`, written into the jar at build time: no hash, no download. */
    private fun iconsHash(v: String): String? =
        loader.getResourceAsStream("$ROOT/icons/$v.sha256")?.use { it.readBytes().decodeToString().trim() }?.takeIf { it.isNotEmpty() }

    /** `icons-<catalog version>.zip` from the CDN, checked, then its PNGs into `<cache>/icons/<v>/`. False when it failed. */
    internal fun downloadIcons(): Boolean {
        val v = catalogVersion ?: return false
        val hash = iconsHash(v) ?: return false
        val base = iconsUrl ?: return false
        val dir = icons(v)
        val part = File(dir.parentFile, "icons-$v.zip.part").apply { parentFile.mkdirs() }
        return try {
            logger?.info("[Artisan] Downloading the Minecraft $v item icons for the editor…")
            val response = HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NORMAL).build()
                .send(HttpRequest.newBuilder(URI("${base.trimEnd('/')}/icons-$v.zip")).build(), HttpResponse.BodyHandlers.ofFile(part.toPath()))
            check(response.statusCode() == 200) { "HTTP ${response.statusCode()}" }
            check(digest("SHA-256", part) == hash) { "icons-$v.zip checksum mismatch" }
            val prefix = "mc-assets/$v/textures/$ICONS"
            ZipFile(part).use { zip ->
                zip.entries().asSequence().filter { !it.isDirectory && it.name.startsWith(prefix) && it.name.endsWith(".png") }.forEach { entry ->
                    val name = entry.name.removePrefix(prefix)
                    if ('/' in name || ".." in name) return@forEach
                    val target = File(dir, name).apply { parentFile.mkdirs() }
                    zip.getInputStream(entry).use { input -> target.outputStream().use { input.copyTo(it) } }
                }
            }
            File(dir, ".done").writeText(hash)
            logger?.info("[Artisan] Minecraft $v item icons ready.")
            true
        } catch (e: Exception) {
            logger?.log(Level.WARNING, "[Artisan] Minecraft item icons unavailable for now (${e.message}); items show their flat texture.")
            false
        } finally {
            part.delete()
        }
    }

    /** False when it failed. */
    internal fun download(): Boolean {
        try {
            logger?.info("[Artisan] Downloading Minecraft $version textures from Mojang for the editor…")
            val http = HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NORMAL).build()
            fun json(url: String) = mapper.readTree(http.send(HttpRequest.newBuilder(URI(url)).build(), HttpResponse.BodyHandlers.ofInputStream()).body())
            val versions = json(manifestUrl)["versions"]
            val entry = versions.firstOrNull { it["id"].asText() == version }
                ?: versions.firstOrNull { minor(it["id"].asText()) == minor(version) }
                ?: error("unknown version $version")
            val client = json(entry["url"].asText())["downloads"]["client"]
            val jar = File(cache, "$version/client.jar.part").apply { parentFile.mkdirs() }
            http.send(HttpRequest.newBuilder(URI(client["url"].asText())).build(), HttpResponse.BodyHandlers.ofFile(jar.toPath()))
            check(digest("SHA-1", jar) == client["sha1"].asText()) { "client jar checksum mismatch" }
            ZipFile(jar).use { zip ->
                zip.entries().asSequence().filter { !it.isDirectory && it.name.startsWith(JAR_TEXTURES) && it.name.endsWith(".png") }.forEach { entry ->
                    val target = File(textures, entry.name.removePrefix(JAR_TEXTURES))
                    target.parentFile.mkdirs()
                    zip.getInputStream(entry).use { input -> target.outputStream().use { input.copyTo(it) } }
                }
            }
            jar.delete()
            done.writeText(version)
            logger?.info("[Artisan] Minecraft $version textures ready.")
            return true
        } catch (e: Exception) {
            logger?.log(Level.WARNING, "[Artisan] Minecraft textures unavailable for the editor; items show without pictures.", e)
            return false
        }
    }

    /** One download at a time, in the background; after a failure, none before [RETRY_MS]. */
    private class Fetch(private val name: String, private val run: () -> Boolean) {
        private val running = java.util.concurrent.atomic.AtomicBoolean()
        @Volatile private var failedAt = 0L

        fun start() {
            if (System.currentTimeMillis() - failedAt < RETRY_MS || !running.compareAndSet(false, true)) return
            Thread({
                try { if (!run()) failedAt = System.currentTimeMillis() } finally { running.set(false) }
            }, name).apply { isDaemon = true }.start()
        }
    }

    /**
     * One picture at [ATLAS_CELL] px: its top square (an animated texture is a strip of frames),
     * pixel art enlarged without smoothing, a rendered icon reduced by halves so it stays sharp.
     */
    private fun cell(image: BufferedImage): BufferedImage {
        var current = image.getSubimage(0, 0, minOf(image.width, image.height), minOf(image.width, image.height))
        val smooth = current.width > ATLAS_CELL
        while (current.width > ATLAS_CELL) {
            val size = maxOf(current.width / 2, ATLAS_CELL)
            current = scaled(current, size, smooth = true)
        }
        return if (current.width == ATLAS_CELL) current else scaled(current, ATLAS_CELL, smooth)
    }

    private fun scaled(image: BufferedImage, size: Int, smooth: Boolean): BufferedImage {
        val out = BufferedImage(size, size, BufferedImage.TYPE_INT_ARGB)
        val g = out.createGraphics()
        try {
            g.setRenderingHint(
                RenderingHints.KEY_INTERPOLATION,
                if (smooth) RenderingHints.VALUE_INTERPOLATION_BILINEAR else RenderingHints.VALUE_INTERPOLATION_NEAREST_NEIGHBOR,
            )
            g.drawImage(image, 0, 0, size, size, null)
        } finally {
            g.dispose()
        }
        return out
    }

    private fun digest(algorithm: String, file: File): String {
        val digest = MessageDigest.getInstance(algorithm)
        file.inputStream().use { input ->
            val buffer = ByteArray(1 shl 16)
            while (true) { val n = input.read(buffer); if (n < 0) break; digest.update(buffer, 0, n) }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    companion object {
        /** Side of one item in [atlas], in px: sharp at the editor's 36 px tiles on a 2x screen. */
        const val ATLAS_CELL = 64
        const val ATLAS_COLUMNS = 32
        const val MANIFEST = "https://launchermeta.mojang.com/mc/game/version_manifest_v2.json"
        private const val ROOT = "vanilla"
        private const val ICONS = "icons/"
        private const val RETRY_MS = 10 * 60 * 1000L
        private const val JAR_TEXTURES = "assets/minecraft/textures/"
        private val PATH = Regex("[a-z0-9_./-]{1,200}")
        private fun minor(version: String) = version.split('.').take(2).joinToString(".")
        private val VERSIONS = Comparator<String> { a, b ->
            val x = a.split('.').map { it.toIntOrNull() ?: 0 }; val y = b.split('.').map { it.toIntOrNull() ?: 0 }
            (0 until maxOf(x.size, y.size)).map { (x.getOrElse(it) { 0 }).compareTo(y.getOrElse(it) { 0 }) }.firstOrNull { it != 0 } ?: 0
        }
    }
}
