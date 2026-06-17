package net.artisanmc.plugin.sync

import java.io.File
import java.security.MessageDigest

/**
 * THE canonical pack hash — one algorithm, one home. Computed over a relPath-keyed
 * file map: keys sorted by native byte order (Kotlin `String` compare, NEVER
 * locale-aware), each entry emitted as `<relPath>\n<content>\n`, concatenated,
 * SHA-256 lowercase hex. Empty map => "" (universal "no content" sentinel).
 *
 * This MUST stay byte-identical to the backend's `hashUtils.computeBundleHash`.
 * The two implementations live in different languages, so the invariant is guarded
 * by a shared vector: `testdata/pack-hash-conformance.json`, asserted by
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

    /** Hash a pack directory (relPath-keyed, skips `.artisan*` metadata). */
    fun hash(packDir: File): String = hashFiles(PackFilesReader.readRelative(packDir))

    /**
     * Hash a canonical-path-keyed map (`plugins/Artisan/packs/<packId>/<rel>`),
     * mirroring the backend: strip the prefix to relPath, then hash. Keys outside
     * the prefix are ignored (same filter as the backend).
     */
    fun hashCanonical(files: Map<String, String>, packId: String): String {
        val prefix = "plugins/Artisan/packs/$packId/"
        val rel = files.entries
            .filter { it.key.startsWith(prefix) }
            .associate { it.key.removePrefix(prefix) to it.value }
        return hashFiles(rel)
    }

    fun hashAll(packsDir: File): String {
        val packDirs = packsDir.listFiles { f -> f.isDirectory && !f.name.startsWith(".") }
            ?.sortedBy { it.name } ?: return ""
        if (packDirs.isEmpty()) return ""
        val sb = StringBuilder()
        packDirs.forEach { packDir ->
            sb.append(packDir.name).append(':').append(hash(packDir)).append('\n')
        }
        return sha256(sb.toString())
    }

    private fun sha256(input: String): String {
        val bytes = MessageDigest.getInstance("SHA-256").digest(input.toByteArray(Charsets.UTF_8))
        return bytes.joinToString("") { "%02x".format(it) }
    }
}
