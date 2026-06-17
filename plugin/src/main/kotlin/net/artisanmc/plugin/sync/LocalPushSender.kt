package net.artisanmc.plugin.sync

import java.io.File

object LocalPushSender {
    /**
     * Builds a `local_push` message body. Files are read via [PackFilesReader.read]
     * (canonical paths `plugins/Artisan/packs/<packId>/<rel>`) and the hash comes
     * from the single [BundleHasher] — same algorithm as the backend stores, so the
     * pushed `hash` matches what the plugin computes from disk. (Previously this had
     * its own SHA-256 keyed by the full path, which drifted from the backend.)
     */
    fun buildPushMessage(packId: String, packDir: File): Map<String, Any> {
        val files = PackFilesReader.read(packDir, packId)
        return mapOf(
            "type" to "local_push",
            "pack_id" to packId,
            "files" to files,
            "hash" to BundleHasher.hashCanonical(files, packId),
        )
    }
}
