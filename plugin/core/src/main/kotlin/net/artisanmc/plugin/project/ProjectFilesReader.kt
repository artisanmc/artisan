package net.artisanmc.plugin.project

import java.io.File

object ProjectFilesReader {

    /** What is known about a binary without carrying it: its hash and size. */
    data class BinaryInfo(val hash: String, val size: Long)

    /**
     * Extensions carried as **bytes**, never as text.
     *
     * Reading them as UTF-8 would mangle them (a PNG starts with 0x89, which is not
     * valid UTF-8), and shipping them in the `project_read` tree would bloat every
     * Project open (ADR `assets-on-server-disk`).
     */
    private val BINARY_EXTENSIONS = setOf("png", "zip", "jpg", "jpeg", "ogg", "ttf", "otf")

    fun isBinary(relPath: String): Boolean =
        relPath.substringAfterLast('.', "").lowercase() in BINARY_EXTENSIONS

    /** What one walk of a project dir yields: its texts ([readAll]) and its binaries ([binaries]). */
    class Scanned(val texts: Map<String, String>, val binaries: Map<String, BinaryInfo>)

    /**
     * The hash of each binary, kept with the size and mtime it was computed for: a
     * reload re-hashes a png, ogg or zip only when the file changed. Keyed by absolute
     * path; [prune] drops the files a full scan no longer saw.
     */
    class BinaryHashCache {
        private class Entry(val size: Long, val modified: Long, val hash: String)
        private val entries = java.util.concurrent.ConcurrentHashMap<String, Entry>()

        fun hashOf(file: File): String {
            val size = file.length()
            val modified = file.lastModified()
            val key = file.absolutePath
            entries[key]?.takeIf { it.size == size && it.modified == modified }?.let { return it.hash }
            return ContentHash.hashBytes(file.readBytes()).also { entries[key] = Entry(size, modified, it) }
        }

        fun prune(keep: Set<String>) = entries.keys.retainAll(keep)
        val size: Int get() = entries.size
    }

    /**
     * The single project-dir walk: every public **text** file plus editor metadata as
     * [Scanned.texts], the hash and size of the binaries (`.artisan*` excluded) as
     * [Scanned.binaries]. History, private drafts, transaction journals and filesystem
     * aliases are never exposed. [readAll] and [binaries] derive from this one.
     */
    fun scan(projectDir: File, cache: BinaryHashCache? = null): Scanned {
        val texts = mutableMapOf<String, String>()
        val binaries = mutableMapOf<String, BinaryInfo>()
        projectDir.walkTopDown()
            .onEnter { it == projectDir || !java.nio.file.Files.isSymbolicLink(it.toPath()) && !net.artisanmc.plugin.project.ProjectPathPolicy.isPrivate(it.relativeTo(projectDir).invariantSeparatorsPath) }
            .filter { it.isFile && !java.nio.file.Files.isSymbolicLink(it.toPath()) }
            .forEach { file ->
                val rel = file.relativeTo(projectDir).path.replace('\\', '/')
                if (isBinary(rel)) {
                    if (!ContentHash.isArtisanMeta(rel)) {
                        binaries[rel] = BinaryInfo(cache?.hashOf(file) ?: ContentHash.hashBytes(file.readBytes()), file.length())
                    }
                } else if (!net.artisanmc.plugin.project.ProjectMetadataPaths.isHistory(rel) && !net.artisanmc.plugin.project.ProjectPathPolicy.isPrivate(rel)) {
                    texts[rel] = file.readText(Charsets.UTF_8)
                }
            }
        return Scanned(texts, binaries)
    }

    /** relPath → hash + size of the binaries, `.artisan*` excluded. */
    fun binaries(projectDir: File): Map<String, BinaryInfo> = scan(projectDir).binaries

    /** Every path actually present, text AND binary. */
    fun allPaths(projectDir: File): List<String> = scan(projectDir).let { (it.texts.keys + it.binaries.keys).sorted() }

    /** The texts of [scan]: relPath-keyed map (forward slashes). Every other text reader derives from it. */
    fun readAll(projectDir: File): Map<String, String> = scan(projectDir).texts

    /**
     * relPath-keyed map excluding `.artisan*` metadata. Both the hash
     * (`ContentHash`) and [read] derive from this.
     */
    fun readRelative(projectDir: File): Map<String, String> =
        readAll(projectDir).filterKeys { !ContentHash.isArtisanMeta(it) }

    /**
     * Files map keyed by "plugins/Artisan/projects/<projectId>/<relPath>".
     * Thin re-key over [readRelative].
     */
    fun read(projectDir: File, projectId: String): Map<String, String> {
        val prefix = "plugins/Artisan/projects/$projectId/"
        return readRelative(projectDir).mapKeys { (rel, _) -> "$prefix$rel" }
    }
}
