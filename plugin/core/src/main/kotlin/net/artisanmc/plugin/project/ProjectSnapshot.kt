package net.artisanmc.plugin.project

import net.artisanmc.plugin.sync.BundleHasher
import net.artisanmc.plugin.sync.ProjectFilesReader

/**
 * The Projects' state as read at the last load, replaced as a whole.
 *
 * [files]: the raw text of each text file, what `project_read` serves and so what
 * the editor shows: the state the server runs, not the current disk. Raw content,
 * not a model: the compare-and-swap compares bytes. An unreadable file is included
 * too, so it stays fixable.
 *
 * [binaries]: hash and size of the binaries, without their content, which is read
 * on demand (`asset_read`, ADR `assets-on-server-disk`).
 *
 * [skipped]: the Documents that failed to compile, and why.
 */
data class ProjectSnapshot(
    val files: Map<String, Map<String, String>>,
    val binaries: Map<String, Map<String, ProjectFilesReader.BinaryInfo>>,
    val skipped: Map<String, Map<String, String>>,
) {
    val projectIds: List<String> get() = files.keys.sorted()

    /** The `project_read` fingerprint, also announced by `projects_reloaded`. */
    fun hash(projectId: String): String = BundleHasher.snapshotHash(
        files[projectId] ?: emptyMap(),
        (binaries[projectId] ?: emptyMap()).mapValues { it.value.hash },
        skipped[projectId] ?: emptyMap(),
    )

    fun hashes(): List<Map<String, String>> = projectIds.map { mapOf("id" to it, "hash" to hash(it)) }

    companion object {
        val EMPTY = ProjectSnapshot(emptyMap(), emptyMap(), emptyMap())
    }
}
