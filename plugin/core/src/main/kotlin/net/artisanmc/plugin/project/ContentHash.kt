package net.artisanmc.plugin.project

import java.io.File
import java.security.MessageDigest

/**
 * Content hashing.
 *
 * - [hash] / [hashFiles] / [snapshotHash]: fingerprint of a file tree, computed by
 *   the plugin only, so no cross-language convention applies.
 * - [hashContent]: fingerprint of a **file's content**, the compare-and-swap token
 *   of `project_write`. The editor reproduces it in TypeScript
 *   (`lib/contentHash.ts`): SHA-256 of the UTF-8 bytes, lowercase hex.
 */
object ContentHash {

    /**
     * Hash of a relPath → content map: keys sorted in byte order (Kotlin `String`
     * compare, NEVER locale-aware), each entry emitted as `<relPath>` + LF +
     * content + LF, concatenated, SHA-256 lowercase hex. Empty map => "" (the
     * "no content" sentinel).
     */
    fun hashFiles(relFiles: Map<String, String>): String {
        if (relFiles.isEmpty()) return ""
        val sb = StringBuilder()
        for (key in relFiles.keys.sorted()) {
            sb.append(key).append('\n').append(relFiles.getValue(key)).append('\n')
        }
        return sha256(sb.toString())
    }

    /**
     * Fingerprint of what `project_read` is about to answer.
     *
     * It covers the three things the editor receives: the text, the announced
     * binaries (by their own hash, not their bytes) and the documents the server
     * failed to load. A replaced binary or a YAML that became readable again changes
     * the fingerprint; otherwise "nothing changed" would lie about exactly what the
     * editor shows.
     *
     * Computed ONLY by the plugin and handed back verbatim by the editor: no
     * cross-language convention to keep here.
     */
    fun snapshotHash(
        files: Map<String, String>,
        binaryHashes: Map<String, String>,
        failed: Map<String, String>,
    ): String {
        val merged = LinkedHashMap<String, String>(files.size + binaryHashes.size + failed.size)
        for ((rel, content) in files) merged["f/$rel"] = content
        for ((rel, hash) in binaryHashes) merged["b/$rel"] = hash
        for ((rel, reason) in failed) merged["x/$rel"] = reason
        // An empty Project still gets a fingerprint: `hashFiles` returns "" for an
        // empty map, and "" cannot be compared to anything. The seed string is part
        // of the hash value: do not change it.
        return if (merged.isEmpty()) sha256("vide") else hashFiles(merged)
    }

    /** Hash of a project folder (relPath-keyed, `.artisan*` excluded). */
    fun hash(projectDir: File): String = hashFiles(ProjectFilesReader.readRelative(projectDir))

    /** Hash of a single **file content**: the compare-and-swap token of `project_write`. */
    fun hashContent(content: String): String = sha256(content)

    /**
     * Same token for **binary** content (ADR `assets-on-server-disk`). SHA-256 of
     * the raw bytes: going through a String would corrupt them.
     */
    fun hashBytes(bytes: ByteArray): String =
        MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

    /**
     * A first segment starting with `.artisan` (any case) is metadata (editor
     * state, trash): excluded from the hash and invisible to the content scan.
     */
    fun isArtisanMeta(relPath: String): Boolean =
        net.artisanmc.plugin.project.ProjectMetadataPaths.isMeta(relPath)

    private fun sha256(input: String): String {
        val bytes = MessageDigest.getInstance("SHA-256").digest(input.toByteArray(Charsets.UTF_8))
        return bytes.joinToString("") { "%02x".format(it) }
    }
}
