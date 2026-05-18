package gg.interfaze.plugin.resourcepack

import java.io.File
import java.net.URL
import java.security.MessageDigest
import java.util.logging.Logger
import java.util.zip.ZipInputStream

/**
 * Extracts the `assets/interfaze/` subtree of the Interfaze resource pack into
 * a target directory owned by a host plugin (Oraxen / Nexo / ItemsAdder / etc.).
 *
 * Used when the admin sets `resource-pack.delegate-to-dir` in `config.yml`.
 * In that mode the plugin does NOT push its own RP to players — the host pack
 * plugin is expected to merge our files into its own RP at its next rebuild.
 *
 * Owns the `<targetDir>/assets/interfaze/` namespace entirely:
 *  - Wipes it recursively before each extraction (deleted/renamed files
 *    don't accumulate).
 *  - Refuses to write anything outside that subtree, even if the zip
 *    contains such entries (defense in depth).
 *
 * `pack.mcmeta` at the zip root is silently skipped — the host pack owns
 * its own metadata.
 */
open class ResourcePackDelegator(
    private val targetDir: File,
    private val logger: Logger?,
) {
    /**
     * Download the zip from [downloadUrl], verify its SHA-1 matches
     * [expectedHash], then extract.
     *
     * Use only on a background thread — the HTTP read blocks.
     */
    open fun apply(downloadUrl: String, expectedHash: String) {
        val bytes = URL(downloadUrl).openStream().use { it.readBytes() }
        applyBytes(bytes, expectedHash)
    }

    /**
     * Same as [apply] but takes the bytes directly. Used by tests; production
     * code uses [apply] which downloads.
     */
    open fun applyBytes(zipBytes: ByteArray, expectedHash: String) {
        val actualHash = sha1Hex(zipBytes)
        if (!actualHash.equals(expectedHash, ignoreCase = true)) {
            throw IllegalStateException(
                "[delegate] hash mismatch: expected=$expectedHash actual=$actualHash"
            )
        }
        val ifzRoot = File(targetDir, "assets/interfaze")
        ifzRoot.deleteRecursively()
        ifzRoot.mkdirs()
        val ifzCanonical = ifzRoot.canonicalPath
        ZipInputStream(zipBytes.inputStream()).use { zis ->
            while (true) {
                val entry = zis.nextEntry ?: break
                if (!acceptEntry(entry.name)) {
                    zis.closeEntry()
                    continue
                }
                val outFile = File(targetDir, entry.name)
                // Path traversal defense: canonical path must stay inside
                // our owned subtree.
                if (!outFile.canonicalPath.startsWith(ifzCanonical)) {
                    logger?.warning("[delegate] rejected path-traversal entry: ${entry.name}")
                    zis.closeEntry()
                    continue
                }
                if (entry.isDirectory) {
                    outFile.mkdirs()
                } else {
                    outFile.parentFile?.mkdirs()
                    outFile.outputStream().use { os -> zis.copyTo(os) }
                }
                zis.closeEntry()
            }
        }
        logger?.info("[delegate] extracted Interfaze pack into ${ifzRoot.absolutePath}")
    }

    private fun acceptEntry(name: String): Boolean =
        name.startsWith("assets/interfaze/")

    private fun sha1Hex(bytes: ByteArray): String =
        MessageDigest.getInstance("SHA-1").digest(bytes)
            .joinToString("") { "%02x".format(it) }
}
