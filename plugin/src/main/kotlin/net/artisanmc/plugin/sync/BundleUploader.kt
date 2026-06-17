package net.artisanmc.plugin.sync

import com.fasterxml.jackson.databind.ObjectMapper
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File
import java.util.logging.Logger

object PackFilesReader {
    /**
     * The single pack-dir walk. relPath-keyed map (forward slashes), excluding
     * `.artisan*` sync metadata. Both the hash (`BundleHasher`) and the wire forms
     * (`read`, below) derive from this — no second traversal.
     */
    fun readRelative(packDir: File): Map<String, String> {
        val out = mutableMapOf<String, String>()
        packDir.walkTopDown()
            .filter { it.isFile && !it.name.startsWith(".artisan") }
            .forEach { file ->
                val rel = file.relativeTo(packDir).path.replace('\\', '/')
                out[rel] = file.readText(Charsets.UTF_8)
            }
        return out
    }

    /**
     * Canonical files map keyed by "plugins/Artisan/packs/<packId>/<relPath>"
     * (the form the backend stores). Thin re-key over [readRelative].
     */
    fun read(packDir: File, packId: String): Map<String, String> {
        val prefix = "plugins/Artisan/packs/$packId/"
        return readRelative(packDir).mapKeys { (rel, _) -> "$prefix$rel" }
    }
}

class BundleUploader(
    private val httpClient: OkHttpClient,
    private val apiUrl: String,
    private val serverKey: String,
    private val logger: Logger? = null,
) {
    private val mapper = ObjectMapper()
    private val json = "application/json; charset=utf-8".toMediaType()

    fun upload(packDir: File, packId: String) {
        val files = PackFilesReader.read(packDir, packId)
        if (files.isEmpty()) {
            logger?.fine("BundleUploader: no files in $packId, skipping upload")
            return
        }

        val body = mapper.writeValueAsString(mapOf("files" to files))
        val request = Request.Builder()
            .url("$apiUrl/api/v1/bundles/$packId")
            .header("Authorization", "Bearer $serverKey")
            .post(body.toRequestBody(json))
            .build()

        httpClient.newCall(request).execute().use { response ->
            if (response.isSuccessful) {
                logger?.info("Uploaded local pack $packId to backend (${files.size} files)")
            } else {
                logger?.warning("Bundle upload failed for $packId: HTTP ${response.code}")
            }
        }
    }
}
