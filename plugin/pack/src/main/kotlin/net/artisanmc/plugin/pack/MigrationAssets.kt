package net.artisanmc.plugin.pack

import java.io.File
import java.security.MessageDigest

/**
 * The check of a folder's migration to one tree (ADR `editable-module-tree`) on the pack's side:
 * the images, glyphs, fonts and composed images the pack reads from the folder, the former
 * layout read with its `originals/` ([ShippedView]), the new one as it is. Null when they are
 * the same, row for row and byte for byte; else what differs.
 */
object MigrationAssets {
    fun compare(before: File, after: File, projectId: String): String? {
        val b = read(before, projectId, originals = true)
        val a = read(after, projectId, originals = false)
        if (b == a) return null
        val gone = (b.keys - a.keys) + b.keys.filter { it in a && a[it] != b[it] }
        val added = a.keys - b.keys
        return listOfNotNull(
            gone.takeIf { it.isNotEmpty() }?.let { "assets changed or gone: ${it.sorted().take(5).joinToString()}" },
            added.takeIf { it.isNotEmpty() }?.let { "assets added: ${it.sorted().take(5).joinToString()}" },
        ).joinToString("; ")
    }

    /** Each asset the pack reads, by its row, to the hash of what it draws from. */
    private fun read(dir: File, projectId: String, originals: Boolean): Map<String, String> {
        val all = dir.walkTopDown().filter { it.isFile }.map { it.relativeTo(dir).invariantSeparatorsPath to it }.toList()
        val texts = all.filter { YamlPaths.isYaml(it.first) }.map { PackFile(it.first, it.second.readText()) }
        val binaries = all.filter { !YamlPaths.isYaml(it.first) }.map { it.first }
        val bytes = all.toMap()
        return DiskAssets.fromTree(projectId, texts, binaries, originals).associate { asset ->
            val content = bytes[asset.path]?.readBytes() ?: ByteArray(0)
            asset.row.toString() to sha(content) + (if (asset.recipe != null) ":composed" else "")
        }
    }

    private fun sha(bytes: ByteArray): String =
        MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
}
