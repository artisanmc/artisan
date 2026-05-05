package gg.interfaze.plugin.sync

import com.fasterxml.jackson.core.type.TypeReference
import com.fasterxml.jackson.databind.ObjectMapper
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.util.logging.Logger

class BundleDownloader(
    private val httpClient: OkHttpClient,
    private val packsDir: File,
    private val logger: Logger? = null,
) {
    private val mapper = ObjectMapper()

    fun download(url: String, serverKey: String, packId: String) {
        val request = Request.Builder()
            .url(url)
            .header("Authorization", "Bearer $serverKey")
            .build()

        val responseBody = httpClient.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                logger?.warning("Bundle download failed: HTTP ${response.code} for pack $packId")
                return
            }
            response.body?.string() ?: return
        }

        val parsed = runCatching {
            mapper.readValue(responseBody, object : TypeReference<Map<String, Any>>() {})
        }.getOrNull() ?: run {
            logger?.warning("Bundle download: failed to parse response for pack $packId")
            return
        }

        @Suppress("UNCHECKED_CAST")
        val files = parsed["files"] as? Map<String, String> ?: run {
            logger?.warning("Bundle download: missing 'files' in response for pack $packId")
            return
        }
        val backendHash = parsed["hash"] as? String ?: ""

        val prefix = "plugins/Interfaze/packs/$packId/"
        val packDir = File(packsDir, packId)

        for ((path, content) in files) {
            val relPath = if (path.startsWith(prefix)) path.removePrefix(prefix) else continue
            val target = File(packDir, relPath)
            if (!target.canonicalPath.startsWith(packDir.canonicalPath + File.separator)) continue
            target.parentFile?.mkdirs()
            target.writeText(content, Charsets.UTF_8)
        }

        val diskHash = BundleHasher.hash(packDir)
        SyncMetadata.recordSync(packDir, syncedHash = diskHash, backendHash = backendHash)
        logger?.info("Bundle synced for pack $packId (hash=$diskHash)")
    }
}
