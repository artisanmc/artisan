package net.artisanmc.plugin.hub

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.time.Duration
import java.util.logging.Logger

/**
 * Artisan's pack host (`web.pack-cdn`, `deploy/pack-cdn-worker`): the hub uploads each pack once,
 * players download it from there. The hub's port then carries no player download, and a hub reached
 * only through its tunnel can send its pack directly. [secret] is the tunnel's: the host counts this
 * hub's quota with it, and keeps a pack it has not been told about for 30 days ([refresh]).
 */
class PackCdn(
    host: String,
    private val secret: () -> String,
    private val logger: Logger?,
    private val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(Duration.ofSeconds(10))
        // A 100 MB pack on a slow uplink.
        .callTimeout(Duration.ofMinutes(5))
        .build(),
) {
    private val base = baseUrl(host)

    /**
     * The address players download [hash] from, uploading [zip] if the host does not have it yet;
     * null when the host is unreachable or refuses it (logged): players then download from the hub.
     */
    fun publish(hash: String, zip: () -> ByteArray?): String? = try {
        touch(hash) ?: zip()?.let { upload(hash, it) }
    } catch (e: Exception) {
        logger?.warning("[resource-pack] pack host $base unreachable (${e.message}): players download pack $hash from this server")
        null
    }

    /** Tells the host the packs [store] serves are still in use, uploading any it lost. At startup, then daily. */
    fun refresh(store: PackStore) {
        for (hash in store.hashes()) publish(hash) { store.get("$hash.zip") }
    }

    /** 200: the host has it, and keeps it; 404: it does not. */
    private fun touch(hash: String): String? {
        val request = Request.Builder().url(packUrl(hash)).header("Authorization", "Bearer ${secret()}")
            .post(ByteArray(0).toRequestBody()).build()
        client.newCall(request).execute().use { response ->
            return when (response.code) {
                200 -> urlOf(response.body?.string())
                404 -> null
                else -> throw refused(hash, response.code, response.body?.string())
            }
        }
    }

    private fun upload(hash: String, zip: ByteArray): String? {
        val request = Request.Builder().url(packUrl(hash)).header("Authorization", "Bearer ${secret()}")
            .put(zip.toRequestBody(ZIP)).build()
        client.newCall(request).execute().use { response ->
            if (response.code != 200 && response.code != 201) throw refused(hash, response.code, response.body?.string())
            logger?.info("[resource-pack] pack $hash uploaded to $base")
            return urlOf(response.body?.string())
        }
    }

    private fun refused(hash: String, code: Int, body: String?) =
        IllegalStateException("HTTP $code for pack $hash: ${body.orEmpty().take(MAX_REASON)}")

    /** The host's answer names the download address; one that is not http(s) is ignored. */
    private fun urlOf(body: String?): String? =
        body?.let { runCatching { Call.mapper.readTree(it)["url"]?.asText() }.getOrNull() }
            ?.takeIf { it.startsWith("https://") || it.startsWith("http://") }

    private fun packUrl(hash: String) = "$base${PackStore.PATH}/$hash.zip"

    companion object {
        /** `web.pack-cdn` when environment.yml does not set it. */
        const val DEFAULT_HOST = "cdn.artisanmc.net"
        /** Replaces [DEFAULT_HOST] when set: the Gradle tests set it empty, so no test uploads a pack. */
        const val HOST_PROPERTY = "artisan.web.pack-cdn"
        private const val MAX_REASON = 200
        private val ZIP = "application/zip".toMediaType()

        /** `cdn.example.net`, or a full `http(s)://` address. */
        fun baseUrl(host: String): String {
            val trimmed = host.trim().trimEnd('/')
            return if (trimmed.startsWith("https://") || trimmed.startsWith("http://")) trimmed else "https://$trimmed"
        }
    }
}
