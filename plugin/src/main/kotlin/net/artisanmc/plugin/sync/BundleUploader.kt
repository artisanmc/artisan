package net.artisanmc.plugin.sync

import com.fasterxml.jackson.databind.ObjectMapper
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File
import java.util.logging.Logger

object ProjectFilesReader {
    /**
     * The single project-dir walk. relPath-keyed map (forward slashes), holding
     * **everything** on disk — `.artisan*` metadata included. Every other reader
     * derives from this one; no second traversal.
     */
    fun readAll(projectDir: File): Map<String, String> {
        val out = mutableMapOf<String, String>()
        projectDir.walkTopDown()
            .filter { it.isFile }
            .forEach { file ->
                val rel = file.relativeTo(projectDir).path.replace('\\', '/')
                out[rel] = file.readText(Charsets.UTF_8)
            }
        return out
    }

    /**
     * relPath-keyed map excluding `.artisan*` sync metadata. Both the hash
     * (`BundleHasher`) and the wire forms (`read`, below) derive from this —
     * a `.artisan*` first segment is out of the hash and never uploaded (the
     * backend preserves its copies).
     */
    fun readRelative(projectDir: File): Map<String, String> =
        readAll(projectDir).filterKeys { !BundleHasher.isArtisanMeta(it) }

    /**
     * Canonical files map keyed by "plugins/Artisan/projects/<projectId>/<relPath>"
     * (the form the backend stores). Thin re-key over [readRelative].
     */
    fun read(projectDir: File, projectId: String): Map<String, String> {
        val prefix = "plugins/Artisan/projects/$projectId/"
        return readRelative(projectDir).mapKeys { (rel, _) -> "$prefix$rel" }
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

    fun upload(projectDir: File, projectId: String) {
        val files = ProjectFilesReader.read(projectDir, projectId)
        if (files.isEmpty()) {
            logger?.fine("BundleUploader: no files in $projectId, skipping upload")
            return
        }

        val body = mapper.writeValueAsString(mapOf("files" to files))
        val request = Request.Builder()
            .url("$apiUrl/api/v1/bundles/$projectId")
            .header("Authorization", "Bearer $serverKey")
            .post(body.toRequestBody(json))
            .build()

        httpClient.newCall(request).execute().use { response ->
            if (response.isSuccessful) {
                logger?.info("Uploaded local project $projectId to backend (${files.size} files)")
            } else {
                logger?.warning("Bundle upload failed for $projectId: HTTP ${response.code}")
            }
        }
    }
}
