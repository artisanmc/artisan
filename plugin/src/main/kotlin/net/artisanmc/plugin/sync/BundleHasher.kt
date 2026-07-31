package net.artisanmc.plugin.sync

import java.io.File
import java.security.MessageDigest

/**
 * THE canonical project hash — one algorithm, one home. Computed over a relPath-keyed
 * file map: keys sorted by native byte order (Kotlin `String` compare, NEVER
 * locale-aware), each entry emitted as `<relPath>\n<content>\n`, concatenated,
 * SHA-256 lowercase hex. Empty map => "" (universal "no content" sentinel).
 *
 * This MUST stay byte-identical to the backend's `hashUtils.computeBundleHash`.
 * The two implementations live in different languages, so the invariant is guarded
 * by a shared vector: `testdata/project-hash-conformance.json`, asserted by
 * `BundleHashConformanceTest` (plugin) AND `hashUtils.test.ts` (backend). Disk sync,
 * `local_push`, and bundle upload all route through here — no second copy. See
 * CLAUDE.md § Invariants critiques.
 */
object BundleHasher {

    /** Core: hash a relPath-keyed file map. */
    fun hashFiles(relFiles: Map<String, String>): String {
        if (relFiles.isEmpty()) return ""
        val sb = StringBuilder()
        for (key in relFiles.keys.sorted()) {
            sb.append(key).append('\n').append(relFiles.getValue(key)).append('\n')
        }
        return sha256(sb.toString())
    }

    /** Hash a relPath-keyed map, skipping `.artisan*` metadata entries. */
    fun hashRelative(relFiles: Map<String, String>): String =
        hashFiles(relFiles.filterKeys { !isArtisanMeta(it) })

    /** Hash a project directory (relPath-keyed, skips `.artisan*` metadata). */
    fun hash(projectDir: File): String = hashFiles(ProjectFilesReader.readRelative(projectDir))

    /**
     * Hash a canonical-path-keyed map (`plugins/Artisan/projects/<projectId>/<rel>`),
     * mirroring the backend: strip the prefix to relPath, then hash. Keys outside
     * the prefix are ignored (same filter as the backend).
     */
    fun hashCanonical(files: Map<String, String>, projectId: String): String {
        val prefix = "plugins/Artisan/projects/$projectId/"
        val rel = files.entries
            .filter { it.key.startsWith(prefix) }
            .associate { it.key.removePrefix(prefix) to it.value }
            .filterKeys { !isArtisanMeta(it) }
        return hashFiles(rel)
    }

    /** relPaths whose first segment starts with `.artisan` are sync/editor
     *  metadata — excluded from the hash and from uploads (mirrored in the
     *  backend's hashUtils; locked by project-hash-conformance.json). */
    fun isArtisanMeta(relPath: String): Boolean =
        relPath.substringBefore('/').startsWith(".artisan")

    fun hashAll(roots: net.artisanmc.plugin.project.ProjectRoots): String {
        val projects = roots.all()
        if (projects.isEmpty()) return ""
        val sb = StringBuilder()
        projects.forEach { (projectId, projectDir) ->
            sb.append(projectId).append(':').append(hash(projectDir)).append('\n')
        }
        return sha256(sb.toString())
    }

    /** Test convenience — production passes the shared [net.artisanmc.plugin.project.ProjectRoots]. */
    fun hashAll(projectsDir: File): String =
        hashAll(net.artisanmc.plugin.project.ProjectRoots(projectsDir))

    private fun sha256(input: String): String {
        val bytes = MessageDigest.getInstance("SHA-256").digest(input.toByteArray(Charsets.UTF_8))
        return bytes.joinToString("") { "%02x".format(it) }
    }
}
