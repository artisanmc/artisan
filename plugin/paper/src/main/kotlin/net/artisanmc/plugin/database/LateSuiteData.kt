package net.artisanmc.plugin.database

import net.artisanmc.plugin.hub.DraftCommit
import net.artisanmc.plugin.hub.DraftStorage
import net.artisanmc.plugin.hub.LoadedProjects
import net.artisanmc.plugin.hub.ProjectHistory

/**
 * The hub's view of the suite database while it opens off the main thread (issue #42):
 * the routes are built before [source] has a value. Until then, Versions and loaded states
 * read as absent (the routes relay to the server, as without a database), and a draft
 * operation fails with `storage_error` (503, the editor retries): the database is
 * unavailable, explicitly, never silently empty.
 */
class LateSuiteData(private val source: () -> SuiteProjectData?) {
    val history: ProjectHistory = object : ProjectHistory {
        override fun versions(server: String, folder: String) = source()?.history?.versions(server, folder)
        override fun version(server: String, folder: String, id: String) = source()?.history?.version(server, folder, id)
        override fun versionBinary(server: String, folder: String, id: String, path: String) = source()?.history?.versionBinary(server, folder, id, path)
        override fun fileHistory(server: String, folder: String, path: String) = source()?.history?.fileHistory(server, folder, path)
    }

    val loaded: LoadedProjects = object : LoadedProjects {
        override fun list(server: String) = source()?.loaded?.list(server)
        override fun read(server: String, folder: String) = source()?.loaded?.read(server, folder)
        override fun hash(server: String, folder: String) = source()?.loaded?.hash(server, folder)
        override fun binary(server: String, folder: String, path: String) = source()?.loaded?.binary(server, folder, path)
    }

    val drafts: DraftStorage = object : DraftStorage {
        private fun open() = source()?.drafts ?: throw IllegalStateException("the suite database is not open")
        override fun knownProject(server: String, folder: String) = open().knownProject(server, folder)
        override fun drafts(server: String, folder: String, owner: String) = open().drafts(server, folder, owner)
        override fun draft(server: String, folder: String, id: String) = open().draft(server, folder, id)
        override fun receipt(operationId: String) = open().receipt(operationId)
        override fun commit(server: String, folder: String, commit: DraftCommit) = open().commit(server, folder, commit)
        override fun content(hash: String) = open().content(hash)
        override fun putContent(hash: String, bytes: ByteArray) = open().putContent(hash, bytes)
    }
}
