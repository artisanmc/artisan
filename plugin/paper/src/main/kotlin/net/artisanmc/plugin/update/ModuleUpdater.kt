package net.artisanmc.plugin.update

import com.fasterxml.jackson.databind.ObjectMapper
import okhttp3.OkHttpClient
import okhttp3.Request
import org.bukkit.configuration.file.YamlConfiguration
import org.bukkit.plugin.Plugin
import java.io.File
import java.io.IOException
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.util.concurrent.TimeUnit
import java.util.zip.ZipFile

/**
 * Updates a plugin of the suite from its own repository's GitHub Releases: checks the latest
 * release, then downloads its jar, verifies it ([SignedRelease]) and puts it in the server's
 * update folder, which Paper applies at the next start. Nothing is loaded or reloaded here.
 *
 * A plugin opts in with `artisan-releases: <owner>/<repo>` in its `plugin.yml` (or
 * `paper-plugin.yml`). Blocking network calls: run off the main thread.
 */
class ModuleUpdater(
    private val updateFolder: File,
    private val trustedKeys: List<String>,
    private val github: String = "https://api.github.com",
    private val http: OkHttpClient = OkHttpClient.Builder().callTimeout(2, TimeUnit.MINUTES).build(),
) {
    /** A plugin that names its releases: its running version and the jar an update replaces. */
    data class Source(val plugin: String, val version: String, val repo: String, val jar: File)

    sealed interface Outcome {
        val plugin: String
        data class UpToDate(override val plugin: String, val version: String) : Outcome
        data class Available(override val plugin: String, val installed: String, val latest: String) : Outcome
        data class Staged(override val plugin: String, val version: String, val file: File) : Outcome
        /** [reason]: `unreachable`, `no_release`, `not_newer`, `no_trusted_key`, `bad_signature`, `mismatch`, `too_large`, `write_failed`. */
        data class Failed(override val plugin: String, val reason: String) : Outcome
    }

    private class Release(val manifest: ReleaseManifest, val jarUrl: String)

    private class Refused(val reason: String) : Exception(reason)

    fun check(source: Source): Outcome = attempt(source.plugin) {
        val latest = latest(source).manifest.version
        if (PluginVersions.isNewer(latest, source.version)) Outcome.Available(source.plugin, source.version, latest)
        else Outcome.UpToDate(source.plugin, source.version)
    }

    /** Downloads, verifies and stages the latest release of [source]; nothing is written unless every check passes. */
    fun stage(source: Source): Outcome = attempt(source.plugin) {
        if (trustedKeys.isEmpty()) throw Refused("no_trusted_key")
        val release = latest(source)
        val manifest = release.manifest
        if (manifest.plugin != source.plugin) throw Refused("mismatch")
        if (!PluginVersions.isNewer(manifest.version, source.version)) throw Refused("not_newer")
        if (!SignedRelease.verify(manifest, trustedKeys)) throw Refused("bad_signature")
        val bytes = download(release.jarUrl)
        if (SignedRelease.sha256(bytes) != manifest.sha256) throw Refused("bad_signature")

        updateFolder.mkdirs()
        val target = File(updateFolder, source.jar.name)
        val part = File(updateFolder, "${source.jar.name}.part")
        try {
            part.writeBytes(bytes)
            // The jar's own descriptor must say what was signed: name and version.
            val descriptor = descriptor(part) ?: throw Refused("mismatch")
            if (descriptor.getString("name") != manifest.plugin || descriptor.getString("version") != manifest.version) throw Refused("mismatch")
            Files.move(part.toPath(), target.toPath(), StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE)
        } catch (e: IOException) {
            throw Refused("write_failed")
        } finally {
            part.delete()
        }
        Outcome.Staged(source.plugin, manifest.version, target)
    }

    private fun attempt(plugin: String, block: () -> Outcome): Outcome =
        try { block() } catch (e: Refused) { Outcome.Failed(plugin, e.reason) } catch (e: Exception) { Outcome.Failed(plugin, "unreachable") }

    /** The latest release of [source]'s repository: its `release.json` and the one jar beside it. */
    private fun latest(source: Source): Release {
        val release = json("$github/repos/${source.repo}/releases/latest") ?: throw Refused("no_release")
        val assets = (release["assets"] as? List<*>).orEmpty().filterIsInstance<Map<*, *>>()
        fun url(asset: Map<*, *>?) = asset?.get("browser_download_url") as? String
        val manifestUrl = url(assets.firstOrNull { it["name"] == "release.json" }) ?: throw Refused("no_release")
        val jarUrl = url(assets.singleOrNull { (it["name"] as? String)?.endsWith(".jar") == true }) ?: throw Refused("no_release")
        val manifest = json(manifestUrl)?.let(ReleaseManifest::parse) ?: throw Refused("no_release")
        return Release(manifest, jarUrl)
    }

    private fun json(url: String): Map<*, *>? = request(url).use { response ->
        if (response.code == 404) return null
        if (!response.isSuccessful) throw IOException("HTTP ${response.code}")
        mapper.readValue(response.body!!.byteStream(), Map::class.java)
    }

    private fun download(url: String): ByteArray = request(url).use { response ->
        if (!response.isSuccessful) throw IOException("HTTP ${response.code}")
        val body = response.body!!
        if (body.contentLength() > MAX_JAR_BYTES) throw Refused("too_large")
        body.byteStream().use { input ->
            val bytes = input.readNBytes(MAX_JAR_BYTES + 1)
            if (bytes.size > MAX_JAR_BYTES) throw Refused("too_large")
            bytes
        }
    }

    private fun request(url: String) = http.newCall(
        Request.Builder().url(url).header("Accept", "application/vnd.github+json").header("User-Agent", "Artisan").build(),
    ).execute()

    companion object {
        /** Artisan with its editor weighs ~35 MB. */
        const val MAX_JAR_BYTES = 100 * 1024 * 1024

        const val RELEASES_KEY = "artisan-releases"

        private val mapper = ObjectMapper()
        private val REPO = Regex("^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")

        /** [plugin]'s update source, or null: no jar file, or no valid `artisan-releases` in its descriptor. */
        fun sourceOf(plugin: Plugin): Source? {
            val jar = runCatching { File(plugin.javaClass.protectionDomain.codeSource.location.toURI()) }.getOrNull()
                ?.takeIf { it.isFile } ?: return null
            val repo = descriptor(jar)?.getString(RELEASES_KEY)?.trim()?.takeIf { REPO.matches(it) } ?: return null
            return Source(plugin.name, plugin.description.version, repo, jar)
        }

        /** `plugin.yml`, else `paper-plugin.yml`, of [jar]; null when it has neither or is not a zip. */
        fun descriptor(jar: File): YamlConfiguration? = runCatching {
            ZipFile(jar).use { zip ->
                val entry = zip.getEntry("plugin.yml") ?: zip.getEntry("paper-plugin.yml") ?: return@use null
                zip.getInputStream(entry).reader().use { YamlConfiguration.loadConfiguration(it) }
            }
        }.getOrNull()
    }
}
