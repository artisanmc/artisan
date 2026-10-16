package net.artisanmc.plugin.database

import java.sql.Timestamp
import java.time.Instant
import javax.sql.DataSource

/**
 * Private Drafts (ADR `server-identity-and-versions`, decision 12): one JSON envelope per draft of a
 * Project, and the receipt of each operation, written in one transaction so a replayed operation
 * returns the result it already gave. Closed drafts and receipts are purged after [DraftRows.KEEP].
 */
class DraftRows(private val dataSource: DataSource) {
    /** Draft ids are case-sensitive; MySQL's default collation is not: rows are keyed by the id's hash. */
    private fun key(id: String) = sha256(id.toByteArray(Charsets.UTF_8))

    fun all(server: ServerRow, projectKey: String): List<String> = dataSource.connection.use { c ->
        c.prepareStatement("SELECT draft FROM artisan_drafts WHERE server_id = ? AND project_key = ? ORDER BY id").use { s ->
            s.setInt(1, server.value); s.setString(2, projectKey)
            s.executeQuery().use { rs -> generateSequence { if (rs.next()) rs.getString(1) else null }.toList() }
        }
    }

    fun get(server: ServerRow, projectKey: String, id: String): String? = dataSource.connection.use { c ->
        c.prepareStatement("SELECT draft FROM artisan_drafts WHERE server_id = ? AND project_key = ? AND id = ?").use { s ->
            s.setInt(1, server.value); s.setString(2, projectKey); s.setString(3, key(id))
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
        server: ServerRow, projectKey: String, id: String, draft: String, status: String,
        operationId: String, fingerprint: String, result: String, now: Instant = Instant.now(),
    ) = dataSource.connection.use { c ->
        transaction(c) {
            val updated = c.prepareStatement(
                "UPDATE artisan_drafts SET draft = ?, status = ?, updated_at = ? WHERE server_id = ? AND project_key = ? AND id = ?",
            ).use {
                it.setString(1, draft); it.setString(2, status); it.setTimestamp(3, Timestamp.from(now))
                it.setInt(4, server.value); it.setString(5, projectKey); it.setString(6, key(id)); it.executeUpdate()
            }
            if (updated == 0) c.prepareStatement(
                "INSERT INTO artisan_drafts (server_id, project_key, id, draft, status, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
            ).use {
                it.setInt(1, server.value); it.setString(2, projectKey); it.setString(3, key(id)); it.setString(4, draft)
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
