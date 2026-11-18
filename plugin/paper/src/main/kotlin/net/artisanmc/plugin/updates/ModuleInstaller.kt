package net.artisanmc.plugin.updates

import java.io.InputStream
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.security.MessageDigest
import java.time.Duration
import java.util.HexFormat
import java.util.concurrent.ConcurrentHashMap
import java.util.logging.Level
import java.util.logging.Logger

/**
 * Stages a module's jar for the next restart (ADR `site-account-and-module-updates`). The jar
 * comes from the site alone ([siteUrl], from environment.yml), is checked against the SHA-256 the
 * site announced, and only then takes its place: the update folder under the running jar's own
 * file name for a plugin already installed, the plugins folder for a new one. Nothing is loaded
 * or replaced while the server runs.
 *
 * No Bukkit here: the caller says which jar a plugin runs from.
 */
class ModuleInstaller(
    private val pluginsDir: Path,
    private val updateDir: Path,
    /** The site's address as environment.yml gives it now. */
    private val siteUrl: () -> String,
    private val logger: Logger? = null,
    /** Opens the jar at an address of the site, the token as its bearer. */
    private val fetch: (URI, String) -> InputStream = ::download,
) {
    data class Request(val plugin: String, val version: String, val url: String, val sha256: String, val size: Long, val token: String)

    /** A jar on its way or in place. [state]: `downloading`, `ready` or `failed` (then [error]). */
    data class Staged(val version: String, val state: String, val error: String? = null) {
        fun toWire(): Map<String, Any?> = buildMap {
            put("version", version)
            put("state", state)
            error?.let { put("error", it) }
        }
    }

    private val staged = ConcurrentHashMap<String, Staged>()
    /** The file a new plugin was staged as: a second install of it replaces that file, never adds one. */
    private val placed = ConcurrentHashMap<String, Path>()

    /** What was staged since this server started, by plugin name. A restart empties it: the jars are then running. */
    fun staged(): Map<String, Map<String, Any?>> = staged.mapValues { it.value.toWire() }

    /**
     * Why [request] is refused before anything is downloaded, null when it may go. [currentJar] is
     * the jar the plugin runs from, null when it is not installed.
     */
    fun refusal(request: Request, currentJar: Path?): String? = when {
        !PLUGIN.matches(request.plugin) || !VERSION.matches(request.version) || !SHA256.matches(request.sha256) -> "invalid_input"
        request.size !in 1..MAX_BYTES -> "invalid_input"
        // Only the site named in this server's own environment.yml: the token goes nowhere else.
        !request.url.startsWith("${siteUrl().trimEnd('/')}/") -> "invalid_input"
        // The update folder only replaces a jar that sits in the plugins folder.
        currentJar != null && currentJar.toAbsolutePath().normalize().parent != pluginsDir.toAbsolutePath().normalize() -> "not_updatable"
        staged[request.plugin]?.state == DOWNLOADING -> "install_in_progress"
        else -> null
    }

    /** Marks [request] as downloading; false when its plugin already is. Call before [install]. */
    fun begin(request: Request): Boolean {
        var started = false
        staged.compute(request.plugin) { _, current ->
            if (current?.state == DOWNLOADING) current
            else Staged(request.version, DOWNLOADING).also { started = true }
        }
        return started
    }

    /** Downloads, checks and places the jar. Blocks: never on a game thread. */
    fun install(request: Request, currentJar: Path?) {
        val target = currentJar?.let { updateDir.resolve(it.fileName.toString()) } ?: pluginsDir.resolve("${request.plugin}-${request.version}.jar")
        val part = target.resolveSibling(".${target.fileName}.part")
        try {
            Files.createDirectories(target.parent)
            val digest = MessageDigest.getInstance("SHA-256")
            var written = 0L
            fetch(URI.create(request.url), request.token).use { input ->
                Files.newOutputStream(part).use { output ->
                    val buffer = ByteArray(64 * 1024)
                    while (true) {
                        val read = input.read(buffer)
                        if (read < 0) break
                        written += read
                        if (written > request.size) throw InstallFailure("size_mismatch")
                        digest.update(buffer, 0, read)
                        output.write(buffer, 0, read)
                    }
                }
            }
            if (written != request.size) throw InstallFailure("size_mismatch")
            if (!HexFormat.of().formatHex(digest.digest()).equals(request.sha256, ignoreCase = true)) throw InstallFailure("hash_mismatch")
            if (currentJar == null) {
                // Two jars of one plugin would stop both from loading.
                placed.put(request.plugin, target)?.takeIf { it != target }?.let(Files::deleteIfExists)
            }
            move(part, target)
            staged[request.plugin] = Staged(request.version, READY)
            logger?.info("[Artisan] ${request.plugin} ${request.version} is in ${target.parent.fileName}/: it loads at the next restart")
        } catch (e: Exception) {
            runCatching { Files.deleteIfExists(part) }
            val code = (e as? InstallFailure)?.code ?: "download_failed"
            staged[request.plugin] = Staged(request.version, FAILED, code)
            logger?.log(Level.WARNING, "[Artisan] ${request.plugin} ${request.version} was not installed ($code)", e.takeIf { it !is InstallFailure })
        }
    }

    private fun move(from: Path, to: Path) = try {
        Files.move(from, to, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
    } catch (_: java.nio.file.AtomicMoveNotSupportedException) {
        Files.move(from, to, StandardCopyOption.REPLACE_EXISTING)
    }

    class InstallFailure(val code: String) : Exception(code)

    companion object {
        const val DOWNLOADING = "downloading"
        const val READY = "ready"
        const val FAILED = "failed"
        const val MAX_BYTES = 256L * 1024 * 1024
        private val PLUGIN = Regex("[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}")
        private val VERSION = Regex("""\d+\.\d+\.\d+(?:[-.][0-9A-Za-z.-]+)?""")
        private val SHA256 = Regex("[0-9a-fA-F]{64}")

        private val http by lazy { HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).followRedirects(HttpClient.Redirect.NEVER).build() }

        /** The jar's bytes; anything but a 200 is a failure named after its status. */
        fun download(uri: URI, token: String): InputStream {
            val request = HttpRequest.newBuilder(uri).timeout(Duration.ofMinutes(10))
                .header("Authorization", "Bearer $token").header("User-Agent", "Artisan").GET().build()
            val response = http.send(request, HttpResponse.BodyHandlers.ofInputStream())
            if (response.statusCode() != 200) {
                response.body().close()
                throw InstallFailure(
                    when (response.statusCode()) {
                        401 -> "site_not_linked"
                        403 -> "licence_required"
                        404 -> "no_release"
                        else -> "download_failed"
                    },
                )
            }
            return response.body()
        }
    }
}
