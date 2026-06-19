package net.artisanmc.plugin.sync

import java.io.File

object LocalPushSender {
    /**
     * Builds a `local_push` message body. Files are read via [ProjectFilesReader.read]
     * (canonical paths `plugins/Artisan/projects/<projectId>/<rel>`) and the hash comes
     * from the single [BundleHasher] — same algorithm as the backend stores, so the
     * pushed `hash` matches what the plugin computes from disk. (Previously this had
     * its own SHA-256 keyed by the full path, which drifted from the backend.)
     */
    fun buildPushMessage(projectId: String, projectDir: File): Map<String, Any> {
        val files = ProjectFilesReader.read(projectDir, projectId)
        return mapOf(
            "type" to "local_push",
            "project_id" to projectId,
            "files" to files,
            "hash" to BundleHasher.hashCanonical(files, projectId),
        )
    }
}
