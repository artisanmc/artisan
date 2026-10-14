package net.artisanmc.plugin.database

import com.fasterxml.jackson.databind.ObjectMapper
import net.artisanmc.modules.api.DatabaseDialect
import net.artisanmc.plugin.hub.DraftStorage
import net.artisanmc.plugin.hub.LoadedProjects
import net.artisanmc.plugin.hub.ProjectHistory
import java.time.Instant
import java.util.concurrent.ConcurrentHashMap
import java.util.logging.Logger
import javax.sql.DataSource

/**
 * What the hub serves from the suite database, server by server: the loaded state recorded
 * at each reload ([recordState]), the Versions behind it ([loaded], [history]) and the drafts
 * ([drafts]). No Bukkit here: [rowOf] turns a hub server id into its `artisan_servers` row.
 *
 * A server's state is one JSON document, parsed once and kept [CACHE_MS]: every Project read,
 * asset and draft operation starts from it. [recordState] drops this server's copy; a remote
 * server's reload is announced after it recorded, so [invalidate] on that announcement
 * keeps the copy fresh in between.
 */
class SuiteProjectData(
    data: DataSource,
    dialect: DatabaseDialect,
    private val rowOf: (server: String) -> Int?,
    private val logger: Logger,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    val versions = VersionStore(data, dialect)
    private val states = ServerStateStore(data)
    private val draftRows = DraftRows(data)
    private val contents = ContentRows(data, dialect)
    private val mapper = ObjectMapper()

    private class Cached(val at: Long, val row: Int?, val state: Map<String, Any?>?)
    private val cache = ConcurrentHashMap<String, Cached>()

    /** The Project list and, per Project, the Snapshot hash, failed files and editor metadata: what the hub serves. */
    fun recordState(server: Int, state: Map<String, Any?>, now: Instant) {
        states.put(server, mapper.writeValueAsString(state), now)
        cache.entries.removeIf { it.value.row == server }
    }

    /** [server] announced a reload: its next read goes to the database. */
    fun invalidate(server: String) { cache.remove(server) }

    /** Closed drafts and receipts past their keep window; the rows removed. */
    fun purge(now: Instant): Int = draftRows.purge(now)

    private fun cached(server: String): Cached {
        cache[server]?.takeIf { clock() - it.at < CACHE_MS }?.let { return it }
        val row = rowOf(server)
        @Suppress("UNCHECKED_CAST")
        val state = row?.let(states::get)?.let { mapper.readValue(it, Map::class.java) as Map<String, Any?> }
        return Cached(clock(), row, state).also { cache[server] = it }
    }

    private fun row(server: String): Int? = cached(server).row

    /** What [server] recorded at its last load, see [recordState]. */
    fun state(server: String): Map<String, Any?>? = cached(server).state

    /** A Project's row and `project_key`, from its folder in the server's loaded state. */
    @Suppress("UNCHECKED_CAST")
    private fun projectKey(server: String, folder: String): Pair<Int, String>? {
        val cached = cached(server)
        val roots = cached.state?.get("project_roots") as? List<Map<String, Any?>> ?: return null
        val key = roots.firstOrNull { it["project_id"] == folder }?.get("project_key") as? String ?: return null
        return (cached.row ?: return null) to key
    }

    /** Drafts in the suite database, kept and served by the hub. */
    val drafts: DraftStorage = object : DraftStorage {
        override fun knownProject(server: String, folder: String) = projectKey(server, folder) != null

        override fun drafts(server: String, folder: String): List<String>? {
            val (row, key) = projectKey(server, folder) ?: return null
            return draftRows.all(row, key)
        }

        override fun draft(server: String, folder: String, id: String): String? {
            val (row, key) = projectKey(server, folder) ?: return null
            return draftRows.get(row, key, id)
        }

        override fun receipt(operationId: String) = draftRows.receipt(operationId)

        override fun commit(server: String, folder: String, id: String, draft: String, status: String, operationId: String, fingerprint: String, result: String): Boolean {
            val (row, key) = projectKey(server, folder) ?: return false
            draftRows.commit(row, key, id, draft, status, operationId, fingerprint, result)
            return true
        }

        override fun content(hash: String) = contents.get(hash)
        override fun putContent(hash: String, bytes: ByteArray) { contents.put(hash, bytes) }
    }

    /** Projects as their server loaded them, read from the suite database by the editor's routes. */
    val loaded: LoadedProjects = object : LoadedProjects {
        override fun list(server: String): Map<String, Any?>? = state(server)?.minus("projects")

        @Suppress("UNCHECKED_CAST")
        override fun read(server: String, folder: String): Map<String, Any?>? {
            val cached = cached(server)
            val project = (cached.state?.get("projects") as? Map<String, Map<String, Any?>>)?.get(folder) ?: return null
            val version = versions.latest(cached.row ?: return null, folder) ?: return null
            val files = version.files + (project["meta"] as? Map<String, String>).orEmpty()
            return mapOf(
                "hash" to project["hash"],
                "files" to files.toSortedMap().map { (path, content) -> mapOf("path" to path, "content" to content) },
                "failed" to project["failed"],
                "binaries" to version.binaries.map { mapOf("path" to it.path, "hash" to it.hash, "size" to it.size) },
            )
        }

        override fun binary(server: String, folder: String, path: String): ByteArray? {
            val row = row(server) ?: return null
            return versions.latestBinary(row, folder, path)
        }
    }

    /** History routes of the editor, read from `artisan_versions`. */
    val history: ProjectHistory = object : ProjectHistory {
        private fun author(a: VersionAuthor?) = a?.let { mapOf("id" to it.id, "name" to it.name) }

        override fun versions(server: String, folder: String): List<Map<String, Any?>>? {
            val row = row(server) ?: return null
            return this@SuiteProjectData.versions.versions(row, folder)?.map {
                mapOf(
                    "id" to it.id.toString(), "hash" to it.hash, "createdAt" to it.createdAt.toString(), "author" to author(it.author),
                    "changed" to it.changed, "restoredFrom" to it.restoredFrom?.toString(),
                )
            }
        }

        override fun version(server: String, folder: String, id: String): Map<String, Any?>? {
            val v = this@SuiteProjectData.versions.version(row(server) ?: return null, folder, id.toIntOrNull() ?: return null) ?: return null
            return mapOf(
                "id" to v.id.toString(), "createdAt" to v.createdAt.toString(), "previousId" to v.previousId?.toString(),
                "files" to v.files.map { (path, content) -> mapOf("path" to path, "content" to content) },
                "binaries" to v.binaries.map { mapOf("path" to it.path, "hash" to it.hash, "size" to it.size) },
            )
        }

        override fun versionBinary(server: String, folder: String, id: String, path: String): ByteArray? {
            val row = row(server) ?: return null
            return this@SuiteProjectData.versions.binary(row, folder, id.toIntOrNull() ?: return null, path)
        }

        override fun fileHistory(server: String, folder: String, path: String): List<Map<String, Any?>>? {
            val row = row(server) ?: return null
            return this@SuiteProjectData.versions.fileHistory(row, folder, path)?.map {
                mapOf("at" to it.at.toEpochMilli(), "content" to it.content, "author" to author(it.author))
            }
        }
    }

    companion object {
        const val CACHE_MS = 5_000L
    }
}
