package net.artisanmc.plugin.pack

import java.security.MessageDigest

/**
 * The theme `artisan` in a folder that holds its whole tree (ADR `editable-module-tree`,
 * decision 9): Artisan's images and components sit at their own paths, and `artisan-shipped.yml`
 * says which are still Artisan's drawing (same bytes as shipped). The builder reads them as it
 * reads the former layout: an untouched file is the base (`originals/…`), a redrawn one the
 * server's. Same rule in `kitLayout.ts`, one conformance case.
 */
object KitLayout {
    const val INDEX = "artisan-shipped.yml"
    private const val ORIGINALS = "originals/"

    /** [project] as the builder reads the common images: unchanged unless it is the tree layout. */
    fun asRead(project: PackProject): PackProject {
        val index = project.files.firstOrNull { it.path == INDEX } ?: return project
        if (project.files.any { it.path.startsWith(ORIGINALS) } || project.binaries.any { it.startsWith(ORIGINALS) }) return project
        val hashes = hashes(index.content)
        fun untouched(path: String, bytes: () -> ByteArray?): Boolean =
            hashes[path]?.let { expected -> bytes()?.let(::sha256) == expected } == true
        val files = project.files.filter { it.path != INDEX }.map { f ->
            if (untouched(f.path) { f.content.toByteArray(Charsets.UTF_8) }) PackFile(ORIGINALS + f.path, f.content) else f
        }
        val moved = HashMap<String, String>()
        val binaries = project.binaries.map { path ->
            if (untouched(path) { project.binary(path) }) (ORIGINALS + path).also { moved[it] = path } else path
        }
        return PackProject(
            project.id, files, binaries, { p -> project.binary(moved[p] ?: p) },
            project.overlayImages, project.folder, project.theme,
        )
    }

    /** `files: { <path>: { hash } }` of the index, by path. */
    private fun hashes(text: String): Map<String, String> {
        val root = Yaml.parseOrNull(text) as? Map<*, *> ?: return emptyMap()
        val files = root["files"] as? Map<*, *> ?: return emptyMap()
        return files.entries.mapNotNull { (k, v) ->
            val hash = (v as? Map<*, *>)?.get("hash") as? String
            if (k is String && hash != null) k to hash else null
        }.toMap()
    }

    private fun sha256(bytes: ByteArray): String =
        MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
}
