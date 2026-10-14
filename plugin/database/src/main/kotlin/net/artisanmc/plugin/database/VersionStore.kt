package net.artisanmc.plugin.database

import java.security.MessageDigest
import java.sql.Connection
import java.sql.Timestamp
import java.time.Instant
import javax.sql.DataSource

/** One file of a Snapshot: its content hash, size, and the text itself for a text file. */
class SnapshotEntry private constructor(val hash: String, val size: Long, val text: String?) {
    val binary: Boolean get() = text == null

    companion object {
        fun text(content: String): SnapshotEntry =
            content.toByteArray(Charsets.UTF_8).let { SnapshotEntry(sha256(it), it.size.toLong(), content) }

        fun binary(hash: String, size: Long) = SnapshotEntry(hash, size, null)
    }
}

data class VersionAuthor(val id: String, val name: String)
data class VersionSummary(
    val id: Int, val hash: String, val createdAt: Instant, val author: VersionAuthor?, val changed: List<String>, val restoredFrom: Int? = null,
)
data class VersionBinary(val path: String, val hash: String, val size: Long)
data class VersionContent(
    val id: Int, val createdAt: Instant, val previousId: Int?,
    val files: Map<String, String>, val binaries: List<VersionBinary>,
)
data class FileVersion(val at: Instant, val content: String, val author: VersionAuthor?)

/**
 * Versions of server Projects (ADR `server-identity-and-versions`): one per loaded Snapshot that
 * differs from the previous one, its files in `artisan_contents`, each content stored once.
 * A Project is found by the folder its latest Version was loaded from.
 */
class VersionStore(private val dataSource: DataSource) {
    private class Entry(val binary: Boolean, val hash: String, val size: Long, val path: String)
    private class Row(val id: Int, val hash: String, val manifest: List<Entry>, val createdAt: Instant, val author: VersionAuthor?, val restoredFrom: Int?)

    /**
     * Records [entries] unless the latest Version of [projectKey] holds the same files; [readBinary]
     * gives a new binary's bytes. A Version's hash is its manifest's: a reload that changes nothing on
     * disk (an Add-on registering, say) records nothing.
     */
    fun record(
        server: Int, projectKey: String, folder: String, entries: Map<String, SnapshotEntry>,
        at: Instant, author: VersionAuthor?, restoredFrom: Int?, readBinary: (path: String) -> ByteArray,
    ): Boolean = dataSource.connection.use { c ->
        val manifest = entries.toSortedMap().entries.joinToString("\n") { (path, e) ->
            "${if (e.binary) "b" else "t"}\t${e.hash}\t${e.size}\t$path"
        }
        val hash = sha256(manifest.toByteArray(Charsets.UTF_8))
        val latest = c.prepareStatement(
            "SELECT hash FROM artisan_versions WHERE server_id = ? AND project_key = ? ORDER BY id DESC LIMIT 1",
        ).use { s -> s.setInt(1, server); s.setString(2, projectKey); s.executeQuery().use { if (it.next()) it.getString(1) else null } }
        if (latest == hash) return false
        val known = knownHashes(c, entries.values.map { it.hash }.toSet())
        c.prepareStatement("INSERT INTO artisan_contents (hash, content) VALUES (?, ?)").use { insert ->
            entries.entries.filter { it.value.hash !in known }.distinctBy { it.value.hash }.forEach { (path, entry) ->
                insert.setString(1, entry.hash)
                insert.setBytes(2, entry.text?.toByteArray(Charsets.UTF_8) ?: readBinary(path))
                insert.executeUpdate()
            }
        }
        c.prepareStatement(
            "INSERT INTO artisan_versions (server_id, project_key, folder, hash, manifest, author_id, author_name, created_at, restored_from) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ).use {
            it.setInt(1, server); it.setString(2, projectKey); it.setString(3, folder); it.setString(4, hash)
            it.setString(5, manifest); it.setString(6, author?.id); it.setString(7, author?.name)
            it.setTimestamp(8, Timestamp.from(at))
            if (restoredFrom == null) it.setNull(9, java.sql.Types.INTEGER) else it.setInt(9, restoredFrom)
            it.executeUpdate()
        }
        true
    }

    /** Newest first; null when no Project of [server] is loaded from [folder]. */
    fun versions(server: Int, folder: String): List<VersionSummary>? = dataSource.connection.use { c ->
        val rows = rows(c, server, folder) ?: return null
        rows.mapIndexed { i, row ->
            val before = rows.getOrNull(i - 1)?.manifest?.associate { it.path to it.hash }.orEmpty()
            val now = row.manifest.associate { it.path to it.hash }
            val changed = (now.keys + before.keys).filter { now[it] != before[it] }.sorted()
            VersionSummary(row.id, row.hash, row.createdAt, row.author, changed, row.restoredFrom)
        }.reversed()
    }

    fun version(server: Int, folder: String, id: Int): VersionContent? = dataSource.connection.use { c ->
        val rows = rows(c, server, folder) ?: return null
        val index = rows.indexOfFirst { it.id == id }.takeIf { it >= 0 } ?: return null
        val row = rows[index]
        val texts = row.manifest.filter { !it.binary }
        val contents = contents(c, texts.map { it.hash }.toSet())
        VersionContent(
            row.id, row.createdAt, rows.getOrNull(index - 1)?.id,
            texts.associate { it.path to contents[it.hash].orEmpty() },
            row.manifest.filter { it.binary }.map { VersionBinary(it.path, it.hash, it.size) },
        )
    }

    /** The Versions where [path] changed, newest first. */
    fun fileHistory(server: Int, folder: String, path: String): List<FileVersion>? = dataSource.connection.use { c ->
        val rows = rows(c, server, folder) ?: return null
        var previous: String? = null
        val changes = rows.mapNotNull { row ->
            val hash = row.manifest.firstOrNull { it.path == path && !it.binary }?.hash
            if (hash == null || hash == previous) { previous = hash; null } else { previous = hash; row to hash }
        }
        val contents = contents(c, changes.map { it.second }.toSet())
        changes.map { (row, hash) -> FileVersion(row.createdAt, contents[hash].orEmpty(), row.author) }.reversed()
    }

    /** The latest Version of the Project loaded from [folder]: what the server runs, what the editor opens. */
    fun latest(server: Int, folder: String): VersionContent? = dataSource.connection.use { c ->
        val last = rows(c, server, folder)?.lastOrNull() ?: return null
        version(server, folder, last.id)
    }

    fun latestBinary(server: Int, folder: String, path: String): ByteArray? = dataSource.connection.use { c ->
        val last = rows(c, server, folder)?.lastOrNull() ?: return null
        binary(server, folder, last.id, path)
    }

    /** A binary file of a Version, read from the stored contents; null for a text or unknown path. */
    fun binary(server: Int, folder: String, id: Int, path: String): ByteArray? = dataSource.connection.use { c ->
        val entry = rows(c, server, folder)?.firstOrNull { it.id == id }?.manifest?.firstOrNull { it.path == path && it.binary } ?: return null
        c.prepareStatement("SELECT content FROM artisan_contents WHERE hash = ?").use { s ->
            s.setString(1, entry.hash); s.executeQuery().use { if (it.next()) it.getBytes(1) else null }
        }
    }

    fun contentCount(): Int = dataSource.connection.use { c ->
        c.createStatement().use { s -> s.executeQuery("SELECT COUNT(*) FROM artisan_contents").use { it.next(); it.getInt(1) } }
    }

    // ponytail: loads every Version of the Project; page by id once histories run into thousands.
    private fun rows(c: Connection, server: Int, folder: String): List<Row>? {
        val key = c.prepareStatement(
            "SELECT project_key FROM artisan_versions WHERE server_id = ? AND folder = ? ORDER BY id DESC LIMIT 1",
        ).use { s -> s.setInt(1, server); s.setString(2, folder); s.executeQuery().use { if (it.next()) it.getString(1) else null } }
            ?: return null
        val rows = c.prepareStatement(
            "SELECT id, hash, manifest, created_at, author_id, author_name, folder, restored_from FROM artisan_versions WHERE server_id = ? AND project_key = ? ORDER BY id",
        ).use { s ->
            s.setInt(1, server); s.setString(2, key)
            s.executeQuery().use { rs ->
                generateSequence {
                    if (!rs.next()) null
                    else Row(
                        rs.getInt(1), rs.getString(2), parse(rs.getString(3)), rs.getTimestamp(4).toInstant(),
                        rs.getString(5)?.let { VersionAuthor(it, rs.getString(6).orEmpty()) },
                        rs.getInt(8).takeUnless { rs.wasNull() },
                    ) to rs.getString(7)
                }.toList()
            }
        }
        // The folder must still be the Project's: a renamed folder name now belongs to no one.
        if (rows.last().second != folder) return null
        return rows.map { it.first }
    }

    private fun parse(manifest: String): List<Entry> = manifest.lineSequence().filter { it.isNotEmpty() }.map { line ->
        val (kind, hash, size, path) = line.split('\t', limit = 4)
        Entry(kind == "b", hash, size.toLong(), path)
    }.toList()

    private fun knownHashes(c: Connection, hashes: Set<String>): Set<String> =
        if (hashes.isEmpty()) emptySet() else c.prepareStatement(
            "SELECT hash FROM artisan_contents WHERE hash IN (${hashes.joinToString(",") { "?" }})",
        ).use { s ->
            hashes.forEachIndexed { i, h -> s.setString(i + 1, h) }
            s.executeQuery().use { rs -> generateSequence { if (rs.next()) rs.getString(1) else null }.toSet() }
        }

    private fun contents(c: Connection, hashes: Set<String>): Map<String, String> =
        if (hashes.isEmpty()) emptyMap() else c.prepareStatement(
            "SELECT hash, content FROM artisan_contents WHERE hash IN (${hashes.joinToString(",") { "?" }})",
        ).use { s ->
            hashes.forEachIndexed { i, h -> s.setString(i + 1, h) }
            s.executeQuery().use { rs ->
                generateSequence { if (rs.next()) rs.getString(1) to String(rs.getBytes(2), Charsets.UTF_8) else null }.toMap()
            }
        }
}

private fun sha256(bytes: ByteArray): String =
    MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
