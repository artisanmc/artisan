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

    /**
     * The same check for the theme `artisan`: the builder reads [after] through [KitLayout] and must
     * find what it found in [before] — each file of `originals/` the owner had not redrawn as the
     * base, the rest as the server's. A redraw of a base image at other measures (the builder took
     * the base for it) keeps the former layout.
     */
    fun compareKit(before: File, after: File, projectId: String): String? {
        val b = tree(before)
        val project = tree(after).let { a ->
            PackProject(projectId, a.filter { YamlPaths.isYaml(it.key) }.map { PackFile(it.key, String(it.value, Charsets.UTF_8)) },
                a.keys.filter { !YamlPaths.isYaml(it) }, { a[it] }, folder = Kit.FOLDER, theme = true)
        }
        val read = KitLayout.asRead(project).let { v ->
            v.files.associate { it.path to sha(it.content.toByteArray(Charsets.UTF_8)) } + v.binaries.associateWith { sha(v.binary(it) ?: ByteArray(0)) }
        }
        val prefix = "originals/"
        val otherSize = b.keys.filter { it.startsWith(prefix) && it.endsWith(".png") && it.removePrefix(prefix) in b }
            .filter { ImageFunctions.pixelSize(b[it]) != ImageFunctions.pixelSize(b[it.removePrefix(prefix)]) }
        if (otherSize.isNotEmpty()) return "redrawn at other measures than Artisan's: ${otherSize.sorted().take(5).joinToString()}"
        val expected = b.filterKeys { it != "originals/originals.yml" && !(it.startsWith(prefix) && it.removePrefix(prefix) in b) }
            .mapValues { sha(it.value) }
        if (expected == read) return null
        val differ = (expected.keys + read.keys).filter { expected[it] != read[it] }
        return "assets read otherwise: ${differ.sorted().take(5).joinToString()}"
    }

    /** The folder's files but Artisan's metadata, by path. */
    private fun tree(dir: File): Map<String, ByteArray> = dir.walkTopDown()
        .onEnter { it == dir || !it.name.startsWith(".artisan") }
        .filter { it.isFile && !it.name.startsWith(".artisan") }
        .associate { it.relativeTo(dir).invariantSeparatorsPath to it.readBytes() }

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
