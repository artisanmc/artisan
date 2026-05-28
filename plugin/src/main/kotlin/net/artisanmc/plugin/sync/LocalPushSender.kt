package net.artisanmc.plugin.sync

import java.io.File
import java.security.MessageDigest

object LocalPushSender {
    /**
     * Walks the pack dir and produces a `local_push` message body. File paths
     * are normalized to `plugins/Artisan/packs/<packId>/<relative>` to match
     * the canonical form the backend stores. Skips `.artisan*` sync metadata.
     */
    fun buildPushMessage(packId: String, packDir: File): Map<String, Any> {
        val files = sortedMapOf<String, String>()
        packDir.walkTopDown()
            .filter { it.isFile && !it.name.startsWith(".artisan") }
            .forEach { file ->
                val rel = file.relativeTo(packDir).path.replace('\\', '/')
                files["plugins/Artisan/packs/$packId/$rel"] = file.readText(Charsets.UTF_8)
            }
        return mapOf(
            "type" to "local_push",
            "pack_id" to packId,
            "files" to files,
            "hash" to computeHash(files),
        )
    }

    private fun computeHash(files: Map<String, String>): String {
        // Mirror the backend's hashUtils.computeBundleHash logic: sorted keys,
        // concat `path\ncontent\n`, then SHA-256 hex.
        val sb = StringBuilder()
        for ((key, value) in files) {
            sb.append(key).append('\n').append(value).append('\n')
        }
        val digest = MessageDigest.getInstance("SHA-256").digest(sb.toString().toByteArray(Charsets.UTF_8))
        return digest.joinToString("") { "%02x".format(it) }
    }
}
