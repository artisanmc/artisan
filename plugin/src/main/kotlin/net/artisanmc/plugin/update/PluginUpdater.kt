package net.artisanmc.plugin.update

import com.fasterxml.jackson.databind.ObjectMapper
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.IOException
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.security.KeyFactory
import java.security.MessageDigest
import java.security.Signature
import java.security.spec.X509EncodedKeySpec
import java.util.Base64
import java.util.concurrent.TimeUnit

/**
 * Pose le dernier JAR publié dans `plugins/update/` ; Paper le substitue au
 * prochain démarrage. Rien n'est écrit tant que la signature Ed25519 de la CI
 * (version + sha256) n'est pas vérifiée : un backend compromis ne peut pas
 * pousser de code, ni rejouer une ancienne release.
 */
class PluginUpdater(
    private val httpBaseUrl: String,
    private val serverKey: String,
    private val currentVersion: String,
    private val target: File,
    private val publicKey: String = RELEASE_PUBLIC_KEY,
    private val http: OkHttpClient = OkHttpClient.Builder().readTimeout(60, TimeUnit.SECONDS).build(),
) {
    data class Result(val ok: Boolean, val version: String? = null, val error: String? = null)

    fun install(): Result {
        val meta = try {
            http.newCall(Request.Builder().url("$httpBaseUrl/api/v1/plugin-release").build()).execute().use { res ->
                if (res.code == 404) return Result(false, error = "no_release")
                if (!res.isSuccessful) return Result(false, error = "download_failed")
                ObjectMapper().readTree(res.body!!.string())
            }
        } catch (_: IOException) { return Result(false, error = "download_failed") }
        val version = meta.path("version").asText()
        val sha = meta.path("sha256").asText()
        val channel = channel(currentVersion)
        if (buildNumber(version, channel) <= buildNumber(currentVersion, channel)) return Result(false, error = "not_newer")
        if (!verify(version, sha, meta.path("signature").asText())) return Result(false, error = "invalid_signature")

        val bytes = try {
            val req = Request.Builder().url("$httpBaseUrl/api/v1/plugin-release/artisan.jar").header("Authorization", "Bearer $serverKey").build()
            http.newCall(req).execute().use { res ->
                if (!res.isSuccessful) return Result(false, error = "download_failed")
                res.body!!.bytes()
            }
        } catch (_: IOException) { return Result(false, error = "download_failed") }
        if (sha256(bytes) != sha) return Result(false, error = "invalid_signature")

        return try {
            target.parentFile.mkdirs()
            val tmp = File(target.parentFile, "${target.name}.part")
            tmp.writeBytes(bytes)
            Files.move(tmp.toPath(), target.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
            Result(true, version)
        } catch (_: IOException) { Result(false, error = "write_failed") }
    }

    private fun verify(version: String, sha: String, signature: String): Boolean = try {
        val key = KeyFactory.getInstance("Ed25519").generatePublic(X509EncodedKeySpec(Base64.getDecoder().decode(publicKey)))
        Signature.getInstance("Ed25519").run {
            initVerify(key)
            update(message(version, sha).toByteArray())
            verify(Base64.getDecoder().decode(signature))
        }
    } catch (_: Exception) { false }

    private fun sha256(bytes: ByteArray) = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

    companion object {
        /** Miroir de `backend/src/lib/pluginRelease.ts`. */
        const val RELEASE_PUBLIC_KEY = "MCowBQYDK2VwAyEAszAX3rGRYvjdGI8PnJmuCjsKh0jOA1v6cKbfawbw5ws="

        fun message(version: String, sha256: String) = "artisan-plugin\n$version\n$sha256"

        /** Un plugin ne suit que son canal : `1.0.N-staging` reste sur staging, `1.0.N` (ou un build de dev) sur la prod. */
        fun channel(version: String) = if (version.endsWith("-staging")) "staging" else ""

        /** Les releases sont `1.0.<run CI>` (+ `-<canal>`) ; une version de dev ou d'un autre canal vaut 0. Miroir du backend. */
        fun buildNumber(version: String, channel: String = ""): Int {
            val m = Regex("""^\d+\.\d+\.(\d+)(?:-([a-z]+))?$""").find(version) ?: return 0
            return if (m.groupValues[2] == channel) m.groupValues[1].toInt() else 0
        }
    }
}
