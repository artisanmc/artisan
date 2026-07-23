package net.artisanmc.plugin.sync

import com.fasterxml.jackson.core.type.TypeReference
import com.fasterxml.jackson.databind.ObjectMapper
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.util.logging.Logger

class BundleDownloader(
    private val httpClient: OkHttpClient,
    private val roots: net.artisanmc.plugin.project.ProjectRoots,
    private val logger: Logger? = null,
) {
    /** Test convenience — production passes the shared [net.artisanmc.plugin.project.ProjectRoots]. */
    constructor(httpClient: OkHttpClient, projectsDir: File, logger: Logger? = null)
        : this(httpClient, net.artisanmc.plugin.project.ProjectRoots(projectsDir), logger)

    private val mapper = ObjectMapper()

    fun download(url: String, serverKey: String, projectId: String) {
        val request = Request.Builder()
            .url(url)
            .header("Authorization", "Bearer $serverKey")
            .build()

        val responseBody = httpClient.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                logger?.warning("Bundle download failed: HTTP ${response.code} for pack $projectId")
                return
            }
            response.body?.string() ?: return
        }

        val parsed = runCatching {
            mapper.readValue(responseBody, object : TypeReference<Map<String, Any>>() {})
        }.getOrNull() ?: run {
            logger?.warning("Bundle download: failed to parse response for pack $projectId")
            return
        }

        @Suppress("UNCHECKED_CAST")
        val files = parsed["files"] as? Map<String, String> ?: run {
            logger?.warning("Bundle download: missing 'files' in response for pack $projectId")
            return
        }
        val backendHash = parsed["hash"] as? String ?: ""

        val prefix = "plugins/Artisan/projects/$projectId/"
        val projectDir = roots.dirFor(projectId)
        projectDir.mkdirs()

        // 1) Build expected rel-paths and write incoming files
        val expectedRelPaths = mutableSetOf<String>()
        for ((path, content) in files) {
            val relPath = if (path.startsWith(prefix)) path.removePrefix(prefix) else continue
            val target = File(projectDir, relPath)
            if (!target.canonicalPath.startsWith(projectDir.canonicalPath + File.separator)) continue
            target.parentFile?.mkdirs()
            target.writeText(content, Charsets.UTF_8)
            expectedRelPaths.add(relPath.replace('\\', '/'))
        }

        // 2) Sweep: delete local files NOT in the bundle, preserving .artisan* metadata
        projectDir.walkTopDown()
            .filter { it.isFile }
            .forEach { f ->
                val relPath = f.relativeTo(projectDir).path.replace('\\', '/')
                if (BundleHasher.isArtisanMeta(relPath)) return@forEach
                if (relPath !in expectedRelPaths) {
                    if (!f.delete()) {
                        logger?.warning("Sweep: failed to delete $f (locked or permission denied)")
                    }
                }
            }

        // 3) Cleanup empty directories bottom-up (but keep projectDir itself)
        projectDir.walkBottomUp()
            .filter { it.isDirectory && it != projectDir }
            .filter { it.list()?.isEmpty() == true }
            .forEach { dir ->
                if (!dir.delete()) {
                    logger?.warning("Sweep: failed to delete empty dir $dir")
                }
            }

        SyncMetadata.recordSync(projectDir, syncedHash = BundleHasher.hash(projectDir), backendHash = backendHash)
        logger?.info("Bundle synced for pack $projectId (${expectedRelPaths.size} files, swept)")
    }
}
