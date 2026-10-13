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
 * Items et textures vanilla, sans le backend.
 *
 * Le catalogue d'items et les icônes 3D sont générés une fois par version côté dépôt
 * (`tools/minecraft-assets/items`, `tools/minecraft-assets/icons`) et voyagent dans le jar. Les textures
 * viennent du jar client Mojang, téléchargé une seule fois dans `<cache>/<version>/`, à la
 * première texture demandée : un serveur qui n'ouvre jamais l'éditeur ne télécharge rien.
 */
class VanillaAssets(
    private val cache: File,
    private val version: String,
    private val logger: Logger?,
    private val loader: ClassLoader = VanillaAssets::class.java.classLoader,
    private val manifestUrl: String = MANIFEST,
) {
    private val mapper = ObjectMapper()
    private val textures get() = File(cache, "$version/textures")
    private val done get() = File(cache, "$version/.done")
    private val started = java.util.concurrent.atomic.AtomicBoolean()

    /** Le catalogue embarqué le plus proche de la version du serveur. */
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

    /** `item/diamond_sword`, `icons/acacia_button`, `font/ascii` : un PNG, ou null. */
    fun texture(path: String): ByteArray? {
        if (!PATH.matches(path) || ".." in path) return null
        File(textures, "$path.png").takeIf { it.isFile }?.let { return it.readBytes() }
        if (!done.isFile && started.compareAndSet(false, true)) Thread({ download() }, "artisan-vanilla").apply { isDaemon = true }.start()
        return catalogVersion?.let { v -> loader.getResourceAsStream("$ROOT/$v/textures/$path.png")?.use { it.readBytes() } }
    }

    internal fun download() {
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
            check(sha1(jar) == client["sha1"].asText()) { "client jar checksum mismatch" }
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
        } catch (e: Exception) {
            logger?.log(Level.WARNING, "[Artisan] Minecraft textures unavailable for the editor; items show without pictures.", e)
        }
    }

    private fun sha1(file: File): String {
        val digest = MessageDigest.getInstance("SHA-1")
        file.inputStream().use { input ->
            val buffer = ByteArray(1 shl 16)
            while (true) { val n = input.read(buffer); if (n < 0) break; digest.update(buffer, 0, n) }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    companion object {
        const val MANIFEST = "https://launchermeta.mojang.com/mc/game/version_manifest_v2.json"
        private const val ROOT = "vanilla"
        private const val JAR_TEXTURES = "assets/minecraft/textures/"
        private val PATH = Regex("[a-z0-9_./-]{1,200}")
        private fun minor(version: String) = version.split('.').take(2).joinToString(".")
        private val VERSIONS = Comparator<String> { a, b ->
            val x = a.split('.').map { it.toIntOrNull() ?: 0 }; val y = b.split('.').map { it.toIntOrNull() ?: 0 }
            (0 until maxOf(x.size, y.size)).map { (x.getOrElse(it) { 0 }).compareTo(y.getOrElse(it) { 0 }) }.firstOrNull { it != 0 } ?: 0
        }
    }
}
