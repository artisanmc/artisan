package net.artisanmc.plugin.resourcepack

import java.io.File
import java.io.FileOutputStream
import java.net.URL
import java.security.MessageDigest
import java.util.logging.Logger
import java.util.zip.ZipEntry
import java.util.zip.ZipInputStream
import java.util.zip.ZipOutputStream

/**
 * Writes the `assets/artisan/` subtree of the Artisan resource project into a
 * target owned by a host plugin (Oraxen / Nexo / ItemsAdder / etc.). Used when
 * the admin sets `resource-pack.delegate-to-dir` in `config.yml`.
 *
 * Two output modes, selected by the target path's extension:
 *
 *  - `*.zip` → a single zip file at that path. Inside, the layout is the
 *    standard MC resource-pack tree (assets/artisan/...) plus a minimal
 *    `pack.mcmeta`. **Use this with Nexo's `project/external_packs/`**: Nexo's
 *    directory scanner skips `.png` files for non-vanilla namespaces, but
 *    its zip-merger pulls every entry, so wrapping our content in a zip
 *    sidesteps the limitation entirely.
 *
 *  - any other path → a directory. We write under `<targetDir>/assets/artisan/`
 *    and own only that subtree (wipe before each extraction). Works for hosts
 *    whose project-build merges arbitrary directories.
 *
 * In both modes the host plugin still owns its own `pack.mcmeta` (in the
 * directory case we never write at the root; in the zip case our internal
 * pack.mcmeta is only read by the host's zip-merger, not served directly).
 */
open class ResourcePackDelegator(
    private val targetDir: File,
    private val logger: Logger?,
) {
    /** Whether [targetDir] points at a `.zip` file rather than a directory. */
    private val emitZip: Boolean = targetDir.name.endsWith(".zip", ignoreCase = true)

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
        if (emitZip) writeZip(zipBytes) else writeDirectory(zipBytes)
    }

    /**
     * Zip output mode. Writes a fresh `targetDir` file containing the
     * `assets/artisan/` entries from the backend zip plus a minimal
     * `pack.mcmeta` (some hosts skip zips lacking it). Atomic via a temp file
     * + rename so a partial write never gets picked up by a host that's
     * watching the directory.
     */
    private fun writeZip(zipBytes: ByteArray) {
        targetDir.parentFile?.mkdirs()
        val tmp = File(targetDir.parentFile, "${targetDir.name}.tmp")
        ZipOutputStream(FileOutputStream(tmp)).use { zos ->
            // pack.mcmeta first — required by some host project-mergers to
            // recognize the zip as a valid resource project.
            zos.putNextEntry(ZipEntry("pack.mcmeta"))
            zos.write(PACK_MCMETA_JSON.toByteArray(Charsets.UTF_8))
            zos.closeEntry()
            ZipInputStream(zipBytes.inputStream()).use { zis ->
                while (true) {
                    val entry = zis.nextEntry ?: break
                    if (!acceptEntry(entry.name)) {
                        zis.closeEntry()
                        continue
                    }
                    if (entry.isDirectory) {
                        zis.closeEntry()
                        continue
                    }
                    zos.putNextEntry(ZipEntry(entry.name))
                    zis.copyTo(zos)
                    zos.closeEntry()
                    zis.closeEntry()
                }
            }
        }
        // Atomic replace: delete target if it exists, then rename. On Windows
        // a plain rename won't overwrite, so we delete first.
        if (targetDir.exists()) targetDir.delete()
        if (!tmp.renameTo(targetDir)) {
            // Fallback: try a copy + delete if rename fails (cross-device move).
            tmp.copyTo(targetDir, overwrite = true)
            tmp.delete()
        }
        logger?.info("[delegate] wrote Artisan project zip to ${targetDir.absolutePath}")
    }

    /**
     * Directory output mode. Wipes `<targetDir>/assets/artisan/` then
     * extracts the matching entries from the backend zip.
     */
    private fun writeDirectory(zipBytes: ByteArray) {
        val artisanRoot = File(targetDir, "assets/artisan")
        artisanRoot.deleteRecursively()
        artisanRoot.mkdirs()
        val artisanCanonical = artisanRoot.canonicalPath
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
                if (!outFile.canonicalPath.startsWith(artisanCanonical)) {
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
        logger?.info("[delegate] extracted Artisan project into ${artisanRoot.absolutePath}")
    }

    private fun acceptEntry(name: String): Boolean =
        name.startsWith("assets/artisan/")

    private fun sha1Hex(bytes: ByteArray): String =
        MessageDigest.getInstance("SHA-1").digest(bytes)
            .joinToString("") { "%02x".format(it) }

    companion object {
        // Minimal valid pack.mcmeta. pack_format 22 = 1.20.5+ (where the
        // `space` font provider is supported). Host plugins that re-zip
        // external projects need this at the root to recognize the zip.
        private const val PACK_MCMETA_JSON =
            "{\"project\":{\"pack_format\":22,\"description\":\"Artisan (delegated)\"}}"
    }
}
