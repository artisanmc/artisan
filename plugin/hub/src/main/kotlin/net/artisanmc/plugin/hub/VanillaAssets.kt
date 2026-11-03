package net.artisanmc.plugin.hub

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import java.io.File
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.security.MessageDigest
import java.util.logging.Level
import java.util.logging.Logger
import java.util.zip.ZipFile

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

    private fun digest(algorithm: String, file: File): String {
        val digest = MessageDigest.getInstance(algorithm)
        file.inputStream().use { input ->
            val buffer = ByteArray(1 shl 16)
            while (true) { val n = input.read(buffer); if (n < 0) break; digest.update(buffer, 0, n) }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    companion object {
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
