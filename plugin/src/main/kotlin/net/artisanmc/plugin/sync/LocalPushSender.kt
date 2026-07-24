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

    /**
     * Builds a `sync_divergence` message (ADR files-first #6, P3c): disk AND
     * web both moved since the last sync — the plugin reports its disk state
     * (same file payload as a push) so the editor can offer per-file
     * resolution. Nothing is pushed or overwritten until the admin decides.
     */
    fun buildDivergenceMessage(projectId: String, projectDir: File, syncedHash: String): Map<String, Any> {
        val files = ProjectFilesReader.read(projectDir, projectId)
        return mapOf(
            "type" to "sync_divergence",
            "project_id" to projectId,
            "files" to files,
            "disk_hash" to BundleHasher.hashCanonical(files, projectId),
            "synced_hash" to syncedHash,
        )
    }
}
