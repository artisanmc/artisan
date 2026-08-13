package net.artisanmc.plugin.sync

import java.io.File

object ProjectFilesReader {
    /**
     * The single project-dir walk. relPath-keyed map (forward slashes), holding
     * **everything** on disk — `.artisan*` metadata included. Every other reader
     * derives from this one; no second traversal.
     */
    fun readAll(projectDir: File): Map<String, String> {
        val out = mutableMapOf<String, String>()
        projectDir.walkTopDown()
            .filter { it.isFile }
            .forEach { file ->
                val rel = file.relativeTo(projectDir).path.replace('\\', '/')
                out[rel] = file.readText(Charsets.UTF_8)
            }
        return out
    }

    /**
     * relPath-keyed map excluding `.artisan*` sync metadata. Both the hash
     * (`BundleHasher`) and the wire forms (`read`, below) derive from this —
     * a `.artisan*` first segment is out of the hash and never uploaded (the
     * backend preserves its copies).
     */
    fun readRelative(projectDir: File): Map<String, String> =
        readAll(projectDir).filterKeys { !BundleHasher.isArtisanMeta(it) }

    /**
     * Canonical files map keyed by "plugins/Artisan/projects/<projectId>/<relPath>"
     * (the form the backend stores). Thin re-key over [readRelative].
     */
    fun read(projectDir: File, projectId: String): Map<String, String> {
        val prefix = "plugins/Artisan/projects/$projectId/"
        return readRelative(projectDir).mapKeys { (rel, _) -> "$prefix$rel" }
    }
}
