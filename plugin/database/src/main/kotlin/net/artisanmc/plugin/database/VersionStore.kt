package net.artisanmc.plugin.database

import net.artisanmc.modules.api.DatabaseDialect
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
 * What [VersionStore.record] did: [recorded] when a Version was written; [skipped] names the
 * binaries whose bytes on disk no longer matched the Snapshot's hash (their contents were not
 * stored, the next Version will carry them).
 */
data class Recorded(val recorded: Boolean, val skipped: List<String> = emptyList())

/**
 * Versions of server Projects (ADR `server-identity-and-versions`): one per loaded Snapshot that
 * differs from the previous one, its files in `artisan_contents`, each content stored once.
 * A Project is found by the folder its latest Version was loaded from.
 */
class VersionStore(private val dataSource: DataSource, private val dialect: DatabaseDialect = DatabaseDialect.H2) {
    private class Entry(val binary: Boolean, val hash: String, val size: Long, val path: String)
    private class Row(
        val id: Int, val hash: String, val manifest: List<Entry>, val createdAt: Instant, val author: VersionAuthor?,
        val restoredFrom: Int?, val projectKey: String, val folder: String, val server: Int,
    )

    /**
     * Records [entries] unless the latest Version of [projectKey] holds the same files, in one
     * transaction; [readBinary] gives a new binary's bytes, read now, hashed again: bytes that no
     * longer match the Snapshot (published or edited since) are not stored under its hash.
     * A Version's hash is its manifest's: a reload that changes nothing on disk (an Add-on
     * registering, say) records nothing.
     */
    fun record(
        server: Int, projectKey: String, folder: String, entries: Map<String, SnapshotEntry>,
        at: Instant, author: VersionAuthor?, restoredFrom: Int?, readBinary: (path: String) -> ByteArray,
    ): Recorded = dataSource.connection.use { c ->
        val manifest = entries.toSortedMap().entries.joinToString("\n") { (path, e) ->
            "${if (e.binary) "b" else "t"}\t${e.hash}\t${e.size}\t$path"
        }
        val hash = sha256(manifest.toByteArray(Charsets.UTF_8))
        transaction(c) {
            val latest = c.prepareStatement(
                "SELECT hash FROM artisan_versions WHERE server_id = ? AND project_key = ? ORDER BY id DESC LIMIT 1",
            ).use { s -> s.setInt(1, server); s.setString(2, projectKey); s.executeQuery().use { if (it.next()) it.getString(1) else null } }
            if (latest == hash) return@transaction Recorded(false)
            val known = knownHashes(c, entries.values.map { it.hash }.toSet())
            val skipped = ArrayList<String>()
            Contents.insertIgnore(c, dialect).use { insert ->
                entries.entries.filter { it.value.hash !in known }.distinctBy { it.value.hash }.forEach { (path, entry) ->
                    val bytes = entry.text?.toByteArray(Charsets.UTF_8) ?: readBinary(path)
                    if (entry.binary && sha256(bytes) != entry.hash) { skipped += path; return@forEach }
                    insert.setString(1, entry.hash)
                    insert.setBytes(2, bytes)
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
            Recorded(true, skipped)
        }
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
        content(c, row(c, server, folder, id) ?: return null)
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
        content(c, latestRow(c, server, folder) ?: return null)
    }

    fun latestBinary(server: Int, folder: String, path: String): ByteArray? = dataSource.connection.use { c ->
        binary(c, latestRow(c, server, folder) ?: return null, path)
    }

    /** A binary file of a Version, read from the stored contents; null for a text or unknown path. */
    fun binary(server: Int, folder: String, id: Int, path: String): ByteArray? = dataSource.connection.use { c ->
        binary(c, row(c, server, folder, id) ?: return null, path)
    }

    fun contentCount(): Int = dataSource.connection.use { c ->
        c.createStatement().use { s -> s.executeQuery("SELECT COUNT(*) FROM artisan_contents").use { it.next(); it.getInt(1) } }
    }

    private fun binary(c: Connection, row: Row, path: String): ByteArray? {
        val entry = row.manifest.firstOrNull { it.path == path && it.binary } ?: return null
        return c.prepareStatement("SELECT content FROM artisan_contents WHERE hash = ?").use { s ->
            s.setString(1, entry.hash); s.executeQuery().use { if (it.next()) it.getBytes(1) else null }
        }
    }

    private fun content(c: Connection, row: Row): VersionContent {
        val texts = row.manifest.filter { !it.binary }
        val contents = contents(c, texts.map { it.hash }.toSet())
        val previous = c.prepareStatement(
            "SELECT id FROM artisan_versions WHERE server_id = ? AND project_key = ? AND id < ? ORDER BY id DESC LIMIT 1",
        ).use { s ->
            s.setInt(1, row.server); s.setString(2, row.projectKey); s.setInt(3, row.id)
            s.executeQuery().use { if (it.next()) it.getInt(1) else null }
        }
        return VersionContent(
            row.id, row.createdAt, previous,
            texts.associate { it.path to contents[it.hash].orEmpty() },
            row.manifest.filter { it.binary }.map { VersionBinary(it.path, it.hash, it.size) },
        )
    }

    private val columns = "id, hash, manifest, created_at, author_id, author_name, restored_from, project_key, folder, server_id"

    private fun read(rs: java.sql.ResultSet) = Row(
        rs.getInt(1), rs.getString(2), parse(rs.getString(3)), rs.getTimestamp(4).toInstant(),
        rs.getString(5)?.let { VersionAuthor(it, rs.getString(6).orEmpty()) },
        rs.getInt(7).takeUnless { rs.wasNull() }, rs.getString(8), rs.getString(9), rs.getInt(10),
    )

    /**
     * The latest Version of the Project last loaded from [folder]: two indexed reads. The folder
     * must still be the Project's: a renamed folder name now belongs to no one.
     */
    private fun latestRow(c: Connection, server: Int, folder: String): Row? {
        val byFolder = c.prepareStatement(
            "SELECT $columns FROM artisan_versions WHERE server_id = ? AND folder = ? ORDER BY id DESC LIMIT 1",
        ).use { s -> s.setInt(1, server); s.setString(2, folder); s.executeQuery().use { if (it.next()) read(it) else null } }
            ?: return null
        val byKey = c.prepareStatement(
            "SELECT $columns FROM artisan_versions WHERE server_id = ? AND project_key = ? ORDER BY id DESC LIMIT 1",
        ).use { s -> s.setInt(1, server); s.setString(2, byFolder.projectKey); s.executeQuery().use { if (it.next()) read(it) else null } }
        return byKey?.takeIf { it.id == byFolder.id }
    }

    /** Version [id] of the Project loaded from [folder]; null when it is another Project's. */
    private fun row(c: Connection, server: Int, folder: String, id: Int): Row? {
        val key = latestRow(c, server, folder)?.projectKey ?: return null
        return c.prepareStatement("SELECT $columns FROM artisan_versions WHERE id = ? AND server_id = ? AND project_key = ?").use { s ->
            s.setInt(1, id); s.setInt(2, server); s.setString(3, key)
            s.executeQuery().use { if (it.next()) read(it) else null }
        }
    }

    // History routes only: every Version of the Project. Page by id once histories run into thousands.
    private fun rows(c: Connection, server: Int, folder: String): List<Row>? {
        val key = latestRow(c, server, folder)?.projectKey ?: return null
        return c.prepareStatement("SELECT $columns FROM artisan_versions WHERE server_id = ? AND project_key = ? ORDER BY id").use { s ->
            s.setInt(1, server); s.setString(2, key)
            s.executeQuery().use { rs -> generateSequence { if (rs.next()) read(rs) else null }.toList() }
        }
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

internal fun sha256(bytes: ByteArray): String =
    MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

/** [block] in one transaction on [c]: committed when it returns, rolled back when it throws. */
internal fun <T> transaction(c: Connection, block: () -> T): T {
    c.autoCommit = false
    try {
        return block().also { c.commit() }
    } catch (e: Exception) {
        c.rollback()
        throw e
    } finally {
        c.autoCommit = true
    }
}

/** `artisan_contents` writes: the same hash inserted by two servers at once is one row, not an error. */
internal object Contents {
    fun insertIgnore(c: Connection, dialect: DatabaseDialect): java.sql.PreparedStatement = c.prepareStatement(
        when (dialect) {
            DatabaseDialect.H2 -> "MERGE INTO artisan_contents KEY (hash) VALUES (?, ?)"
            DatabaseDialect.MYSQL, DatabaseDialect.MARIADB -> "INSERT IGNORE INTO artisan_contents (hash, content) VALUES (?, ?)"
        },
    )

    fun put(c: Connection, dialect: DatabaseDialect, hash: String, bytes: ByteArray) =
        insertIgnore(c, dialect).use { it.setString(1, hash); it.setBytes(2, bytes); it.executeUpdate() }
}

/** `artisan_contents` by hash: a draft's images and fonts, before and after publication. */
class ContentRows(private val dataSource: DataSource, private val dialect: DatabaseDialect = DatabaseDialect.H2) {
    fun get(hash: String): ByteArray? = dataSource.connection.use { c ->
        c.prepareStatement("SELECT content FROM artisan_contents WHERE hash = ?").use { s ->
            s.setString(1, hash); s.executeQuery().use { if (it.next()) it.getBytes(1) else null }
        }
    }

    fun put(hash: String, bytes: ByteArray) = dataSource.connection.use { c -> Contents.put(c, dialect, hash, bytes) }
}

/**
 * Private Drafts (ADR `server-identity-and-versions`, decision 12): one JSON envelope per draft of a
 * Project, and the receipt of each operation, written in one transaction so a replayed operation
 * returns the result it already gave. Closed drafts and receipts are purged after [DraftRows.KEEP].
 */
class DraftRows(private val dataSource: DataSource) {
    /** Draft ids are case-sensitive; MySQL's default collation is not: rows are keyed by the id's hash. */
    private fun key(id: String) = sha256(id.toByteArray(Charsets.UTF_8))

    fun all(server: Int, projectKey: String): List<String> = dataSource.connection.use { c ->
        c.prepareStatement("SELECT draft FROM artisan_drafts WHERE server_id = ? AND project_key = ? ORDER BY id").use { s ->
            s.setInt(1, server); s.setString(2, projectKey)
            s.executeQuery().use { rs -> generateSequence { if (rs.next()) rs.getString(1) else null }.toList() }
        }
    }

    fun get(server: Int, projectKey: String, id: String): String? = dataSource.connection.use { c ->
        c.prepareStatement("SELECT draft FROM artisan_drafts WHERE server_id = ? AND project_key = ? AND id = ?").use { s ->
            s.setInt(1, server); s.setString(2, projectKey); s.setString(3, key(id))
            s.executeQuery().use { if (it.next()) it.getString(1) else null }
        }
    }

    /** The fingerprint and result of an operation already applied. */
    fun receipt(operationId: String): Pair<String, String>? = dataSource.connection.use { c ->
        c.prepareStatement("SELECT fingerprint, result FROM artisan_draft_receipts WHERE operation_id = ?").use { s ->
            s.setString(1, operationId); s.executeQuery().use { if (it.next()) it.getString(1) to it.getString(2) else null }
        }
    }

    /**
     * Writes the draft and the operation's receipt together. A receipt already there (the same
     * operation committed by a concurrent request) surfaces as the [java.sql.SQLException] of the
     * duplicate key; the caller answers with that receipt.
     */
    fun commit(
        server: Int, projectKey: String, id: String, draft: String, status: String,
        operationId: String, fingerprint: String, result: String, now: Instant = Instant.now(),
    ) = dataSource.connection.use { c ->
        transaction(c) {
            val updated = c.prepareStatement(
                "UPDATE artisan_drafts SET draft = ?, status = ?, updated_at = ? WHERE server_id = ? AND project_key = ? AND id = ?",
            ).use {
                it.setString(1, draft); it.setString(2, status); it.setTimestamp(3, Timestamp.from(now))
                it.setInt(4, server); it.setString(5, projectKey); it.setString(6, key(id)); it.executeUpdate()
            }
            if (updated == 0) c.prepareStatement(
                "INSERT INTO artisan_drafts (server_id, project_key, id, draft, status, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
            ).use {
                it.setInt(1, server); it.setString(2, projectKey); it.setString(3, key(id)); it.setString(4, draft)
                it.setString(5, status); it.setTimestamp(6, Timestamp.from(now)); it.executeUpdate()
            }
            c.prepareStatement("INSERT INTO artisan_draft_receipts (operation_id, fingerprint, result, created_at) VALUES (?, ?, ?, ?)").use {
                it.setString(1, operationId); it.setString(2, fingerprint); it.setString(3, result); it.setTimestamp(4, Timestamp.from(now)); it.executeUpdate()
            }
        }
    }

    /** Drops the drafts closed (published or discarded) and the receipts older than [KEEP]; the rows removed. */
    fun purge(now: Instant): Int = dataSource.connection.use { c ->
        val before = Timestamp.from(now.minus(KEEP))
        val drafts = c.prepareStatement("DELETE FROM artisan_drafts WHERE status <> 'active' AND updated_at < ?").use {
            it.setTimestamp(1, before); it.executeUpdate()
        }
        val receipts = c.prepareStatement("DELETE FROM artisan_draft_receipts WHERE created_at < ?").use {
            it.setTimestamp(1, before); it.executeUpdate()
        }
        drafts + receipts
    }

    companion object {
        /** A replay or a closed draft older than this is of no use to anyone. */
        val KEEP: java.time.Duration = java.time.Duration.ofDays(30)
    }
}
