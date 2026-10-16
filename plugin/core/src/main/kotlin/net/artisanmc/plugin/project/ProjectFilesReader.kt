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

    /** relPath → hash + size of the binaries, `.artisan*` excluded. */
    fun binaries(projectDir: File): Map<String, BinaryInfo> {
        val out = mutableMapOf<String, BinaryInfo>()
        projectDir.walkTopDown()
            .onEnter { it == projectDir || !java.nio.file.Files.isSymbolicLink(it.toPath()) && !net.artisanmc.plugin.project.ProjectPathPolicy.isPrivate(it.relativeTo(projectDir).invariantSeparatorsPath) }
            .filter { it.isFile && !java.nio.file.Files.isSymbolicLink(it.toPath()) }
            .forEach { file ->
                val rel = file.relativeTo(projectDir).path.replace('\\', '/')
                if (isBinary(rel) && !ContentHash.isArtisanMeta(rel)) {
                    out[rel] = BinaryInfo(ContentHash.hashBytes(file.readBytes()), file.length())
                }
            }
        return out
    }

    /** Every path actually present, text AND binary. */
    fun allPaths(projectDir: File): List<String> =
        (readAll(projectDir).keys + binaries(projectDir).keys).sorted()

    /**
     * The single project-dir walk. relPath-keyed map (forward slashes), holding
     * every public **text** file plus editor metadata. History, private drafts,
     * transaction journals and filesystem aliases are never exposed. Every other
     * text reader derives from this one; no second traversal.
     */
    fun readAll(projectDir: File): Map<String, String> {
        val out = mutableMapOf<String, String>()
        projectDir.walkTopDown()
            .onEnter { it == projectDir || !java.nio.file.Files.isSymbolicLink(it.toPath()) && !net.artisanmc.plugin.project.ProjectPathPolicy.isPrivate(it.relativeTo(projectDir).invariantSeparatorsPath) }
            .filter { it.isFile && !java.nio.file.Files.isSymbolicLink(it.toPath()) }
            .forEach { file ->
                val rel = file.relativeTo(projectDir).path.replace('\\', '/')
                if (!isBinary(rel) && !net.artisanmc.plugin.project.ProjectMetadataPaths.isHistory(rel) && !net.artisanmc.plugin.project.ProjectPathPolicy.isPrivate(rel)) out[rel] = file.readText(Charsets.UTF_8)
            }
        return out
    }

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
