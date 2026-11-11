package net.artisanmc.plugin.database

import net.artisanmc.plugin.project.VersionStorage
import net.artisanmc.plugin.project.PublicationAuthor
import net.artisanmc.plugin.project.ProjectFilesReader
import java.time.Instant

/** [VersionStorage] in the suite database, for this server's [row]. */
class SuiteVersionStorage(private val data: SuiteProjectData, private val row: ServerRow) : VersionStorage {
    override fun recordVersion(
        projectKey: String,
        folder: String,
        files: Map<String, String>,
        binaries: Map<String, ProjectFilesReader.BinaryInfo>,
        at: Instant,
        author: PublicationAuthor?,
        readBinary: (path: String) -> ByteArray,
    ): List<String> {
        val entries = files.mapValues { SnapshotEntry.text(it.value) } +
            binaries.mapValues { SnapshotEntry.binary(it.value.hash, it.value.size) }
        val by = author?.let { VersionAuthor(it.id, it.name, it.via) }
        return data.versions.record(row, projectKey, folder, entries, at, by, author?.restoredFrom?.toIntOrNull(), readBinary).skipped
    }

    override fun recordState(state: net.artisanmc.plugin.project.LoadedState, at: Instant) = data.recordState(row, state, at)
}
