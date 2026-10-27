package net.artisanmc.plugin.resourcepack

import java.io.File
import java.net.URL
import java.security.MessageDigest
import java.util.logging.Logger

/**
 * The Bedrock pack the editor built for this server (`bedrock/bedrockPack.ts`),
 * downloaded from the hub into `cache/bedrock-pack/<sha1>.mcpack`. Geyser
 * hands the current file to each Bedrock player at connection
 * (`GeyserIntegration`); without Geyser the file only waits on disk.
 *
 * The last pack survives a restart: the newest file of the folder is the
 * current one, even before a leaf reaches its hub.
 */
open class BedrockPackManager(
    private val dir: File,
    private val logger: Logger? = null,
) {
    @Volatile
    var current: File? = null
        private set

    private val listeners = java.util.concurrent.CopyOnWriteArrayList<(File?) -> Unit>()

    /** Called with the new file (or null) after each change; also at once with the current one. */
    fun onChange(listener: (File?) -> Unit) {
        listeners += listener
        listener(current)
    }

    /** Restores [current] from the folder. Call at boot. */
    fun loadFromDisk() {
        current = dir.listFiles { f -> f.name.matches(NAME) }?.maxByOrNull { it.lastModified() }
    }

    /** Downloads the pack at [downloadUrl] (SHA-1 [hash]) on a daemon thread, then switches to it. */
    fun apply(downloadUrl: String, hash: String) {
        require(hash.matches(Regex("[0-9a-f]{40}"))) { "invalid hash: $hash" }
        val target = File(dir, "$hash.mcpack")
        if (target.isFile) {
            switchTo(target)
            return
        }
        runDownload {
            try {
                val bytes = URL(downloadUrl).openStream().use { it.readBytes() }
                val actual = MessageDigest.getInstance("SHA-1").digest(bytes).joinToString("") { "%02x".format(it) }
                check(actual == hash) { "hash mismatch: expected $hash, got $actual" }
                dir.mkdirs()
                val tmp = File(dir, "$hash.mcpack.tmp")
                tmp.writeBytes(bytes)
                if (!tmp.renameTo(target)) { tmp.copyTo(target, overwrite = true); tmp.delete() }
                switchTo(target)
            } catch (t: Throwable) {
                logger?.warning("[bedrock-pack] download of $downloadUrl failed: ${t.message}")
            }
        }
    }

    fun clear() {
        current = null
        dir.listFiles { f -> f.name.matches(NAME) }?.forEach { it.delete() }
        listeners.forEach { it(null) }
    }

    private fun switchTo(file: File) {
        file.setLastModified(System.currentTimeMillis())
        current = file
        dir.listFiles { f -> f.name.matches(NAME) && f != file }?.forEach { it.delete() }
        logger?.info("[bedrock-pack] ${file.path} ready for Bedrock players")
        listeners.forEach { it(file) }
    }

    /** Test seam: production downloads on a daemon thread. */
    protected open fun runDownload(action: () -> Unit) {
        Thread(action, "artisan-bedrock-pack").apply { isDaemon = true; start() }
    }

    companion object {
        private val NAME = Regex("[0-9a-f]{40}\\.mcpack")
    }
}
