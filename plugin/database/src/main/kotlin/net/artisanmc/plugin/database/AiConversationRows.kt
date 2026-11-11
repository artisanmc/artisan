package net.artisanmc.plugin.database

import java.sql.ResultSet
import java.sql.Timestamp
import java.time.Instant
import java.util.UUID
import javax.sql.DataSource

/**
 * `artisan_ai_conversations`: the editor assistant's conversations (ADR `editor-assistant`), its
 * events and the model's history as the hub serialized them. Every method blocks: call them off
 * the game threads.
 */
class AiConversationRows(private val dataSource: DataSource, private val t: ArtisanTables = ArtisanTables.DEFAULT) {
    data class Row(
        val id: String,
        val ownerId: UUID,
        val project: String?,
        val serverId: String?,
        val title: String?,
        val createdAt: Instant,
        val lastActive: Instant,
        val inputTokens: Long,
        val outputTokens: Long,
        /** Empty in [list]. */
        val events: String,
        val history: String?,
        val historyKey: String?,
    )

    /** Writes [row], replacing the one with its id. */
    fun save(row: Row) = dataSource.connection.use { c ->
        // created_at set on update too: an old MySQL would otherwise move the first TIMESTAMP column.
        val updated = c.prepareStatement(
            "UPDATE ${t.aiConversations} SET title = ?, created_at = ?, last_active = ?, input_tokens = ?, output_tokens = ?, events = ?, history = ?, history_key = ? WHERE id = ?",
        ).use {
            it.setString(1, row.title); it.setTimestamp(2, Timestamp.from(row.createdAt)); it.setTimestamp(3, Timestamp.from(row.lastActive))
            it.setLong(4, row.inputTokens); it.setLong(5, row.outputTokens); it.setString(6, row.events)
            it.setString(7, row.history); it.setString(8, row.historyKey); it.setString(9, row.id)
            it.executeUpdate()
        }
        if (updated == 0) {
            c.prepareStatement(
                "INSERT INTO ${t.aiConversations} (id, owner_id, project, server_id, title, created_at, last_active, input_tokens, output_tokens, events, history, history_key) " +
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            ).use {
                it.setString(1, row.id); it.setString(2, row.ownerId.toString()); it.setString(3, row.project); it.setString(4, row.serverId)
                it.setString(5, row.title); it.setTimestamp(6, Timestamp.from(row.createdAt)); it.setTimestamp(7, Timestamp.from(row.lastActive))
                it.setLong(8, row.inputTokens); it.setLong(9, row.outputTokens); it.setString(10, row.events)
                it.setString(11, row.history); it.setString(12, row.historyKey)
                it.executeUpdate()
            }
        }
    }

    fun load(id: String): Row? = dataSource.connection.use { c ->
        c.prepareStatement("SELECT $SUMMARY, events, history, history_key FROM ${t.aiConversations} WHERE id = ?").use { s ->
            s.setString(1, id)
            s.executeQuery().use { if (it.next()) row(it, full = true) else null }
        }
    }

    /** [ownerId]'s conversations, the last active first, without events nor history. */
    fun list(ownerId: UUID): List<Row> = dataSource.connection.use { c ->
        c.prepareStatement("SELECT $SUMMARY FROM ${t.aiConversations} WHERE owner_id = ? ORDER BY last_active DESC").use { s ->
            s.setString(1, ownerId.toString())
            s.executeQuery().use { rs -> buildList { while (rs.next()) add(row(rs, full = false)) } }
        }
    }

    fun delete(id: String) = dataSource.connection.use { c ->
        c.prepareStatement("DELETE FROM ${t.aiConversations} WHERE id = ?").use { it.setString(1, id); it.executeUpdate() }
    }

    /** Deletes the conversations idle since before [before]. */
    fun deleteIdle(before: Instant) = dataSource.connection.use { c ->
        c.prepareStatement("DELETE FROM ${t.aiConversations} WHERE last_active < ?").use { it.setTimestamp(1, Timestamp.from(before)); it.executeUpdate() }
    }

    private fun row(rs: ResultSet, full: Boolean) = Row(
        id = rs.getString("id"),
        ownerId = UUID.fromString(rs.getString("owner_id")),
        project = rs.getString("project"),
        serverId = rs.getString("server_id"),
        title = rs.getString("title"),
        createdAt = rs.getTimestamp("created_at").toInstant(),
        lastActive = rs.getTimestamp("last_active").toInstant(),
        inputTokens = rs.getLong("input_tokens"),
        outputTokens = rs.getLong("output_tokens"),
        events = if (full) rs.getString("events") else "",
        history = if (full) rs.getString("history") else null,
        historyKey = if (full) rs.getString("history_key") else null,
    )

    private companion object {
        const val SUMMARY = "id, owner_id, project, server_id, title, created_at, last_active, input_tokens, output_tokens"
    }
}
