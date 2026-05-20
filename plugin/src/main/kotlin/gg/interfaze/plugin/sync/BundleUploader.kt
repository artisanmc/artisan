package gg.interfaze.plugin.sync

import com.fasterxml.jackson.databind.ObjectMapper
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File
import java.util.logging.Logger

object PackFilesReader {
    /**
     * Walk packDir and produce the canonical files map keyed by
     * "plugins/Interfaze/packs/<packId>/<relPath>", excluding `.interfaze*` metadata.
     */
    fun read(packDir: File, packId: String): Map<String, String> {
        val prefix = "plugins/Interfaze/packs/$packId/"
        val out = mutableMapOf<String, String>()
        packDir.walkTopDown()
            .filter { it.isFile && !it.name.startsWith(".interfaze") }
            .forEach { file ->
                val rel = file.relativeTo(packDir).path.replace('\\', '/')
                out["$prefix$rel"] = file.readText(Charsets.UTF_8)
            }
        return out
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
            .url("$apiUrl/api/bundles/$packId")
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
