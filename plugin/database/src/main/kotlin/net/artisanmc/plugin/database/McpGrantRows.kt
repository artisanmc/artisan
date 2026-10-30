package net.artisanmc.plugin.database

import java.sql.PreparedStatement
import java.sql.ResultSet
import java.sql.Timestamp
import java.sql.Types
import java.time.Instant
import java.util.UUID
import javax.sql.DataSource

data class McpClientRow(val id: String, val name: String, val redirectUris: List<String>, val createdAt: Instant)

/** A player's approval of an MCP client (ADR `mcp-server`), its credentials as hashes. */
data class McpGrantRow(
    val id: String,
    val clientId: String,
    val clientName: String,
    val playerId: UUID,
    val playerName: String,
    val origin: String,
    val permissions: Set<String>,
    val createdAt: Instant,
    val lastUsedAt: Instant,
    val codeHash: String?,
    val codeChallenge: String?,
    val redirectUri: String?,
    val codeExpiresAt: Instant?,
    val accessHash: String?,
    val accessExpiresAt: Instant?,
    val refreshHash: String?,
    val refreshExpiresAt: Instant?,
    /** The player allowed this app to deploy their drafts (ADR `mcp-server`). */
    val allowPublish: Boolean = false,
)

/** `artisan_mcp_clients` and `artisan_mcp_grants`: the MCP endpoint's OAuth, shared by the servers of a database. */
class McpGrantRows(private val dataSource: DataSource, private val t: ArtisanTables = ArtisanTables.DEFAULT) {
    fun putClient(row: McpClientRow) = dataSource.connection.use { c ->
        c.prepareStatement("INSERT INTO ${t.mcpClients} (client_id, name, redirect_uris, created_at) VALUES (?, ?, ?, ?)").use {
            it.setString(1, row.id); it.setString(2, row.name); it.setString(3, row.redirectUris.joinToString("\n"))
            it.setTimestamp(4, Timestamp.from(row.createdAt)); it.executeUpdate()
        }
    }

    fun client(id: String): McpClientRow? = dataSource.connection.use { c ->
        c.prepareStatement("SELECT client_id, name, redirect_uris, created_at FROM ${t.mcpClients} WHERE client_id = ?").use { s ->
            s.setString(1, id)
            s.executeQuery().use { rs ->
                if (!rs.next()) null
                else McpClientRow(rs.getString(1), rs.getString(2), rs.getString(3).split('\n').filter { it.isNotEmpty() }, rs.getTimestamp(4).toInstant())
            }
        }
    }

    fun countClients(): Int = dataSource.connection.use { c ->
        c.prepareStatement("SELECT COUNT(*) FROM ${t.mcpClients}").use { s -> s.executeQuery().use { rs -> rs.next(); rs.getInt(1) } }
    }

    fun purgeClients(before: Instant): Int = dataSource.connection.use { c ->
        c.prepareStatement(
            "DELETE FROM ${t.mcpClients} WHERE created_at < ? AND client_id NOT IN (SELECT client_id FROM ${t.mcpGrants})",
        ).use { it.setTimestamp(1, Timestamp.from(before)); it.executeUpdate() }
    }

    fun insert(row: McpGrantRow) = dataSource.connection.use { c ->
        c.prepareStatement("INSERT INTO ${t.mcpGrants} ($COLUMNS) VALUES (${COLUMNS.split(',').joinToString { "?" }})").use {
            bind(it, row); it.executeUpdate()
        }
    }

    /** Replaces the row of [old] by [new] while its code and refresh hashes are still [old]'s: each is used once. */
    fun replace(old: McpGrantRow, new: McpGrantRow): Boolean = dataSource.connection.use { c ->
        val sets = COLUMNS.split(',').drop(1).joinToString { "${it.trim()} = ?" }
        c.prepareStatement(
            "UPDATE ${t.mcpGrants} SET $sets WHERE id = ? AND COALESCE(code_hash, '') = ? AND COALESCE(refresh_hash, '') = ?",
        ).use {
            var i = bind(it, new, from = 1, skipId = true)
            it.setString(i++, old.id); it.setString(i++, old.codeHash.orEmpty()); it.setString(i, old.refreshHash.orEmpty())
            it.executeUpdate() == 1
        }
    }

    /** The grant whose [column] (`code_hash`, `access_hash`, `refresh_hash`) is [hash]. */
    fun find(column: String, hash: String): McpGrantRow? {
        require(column in setOf("code_hash", "access_hash", "refresh_hash"))
        return select("WHERE $column = ?") { it.setString(1, hash) }.firstOrNull()
    }

    fun grants(playerId: UUID): List<McpGrantRow> = select("WHERE player_id = ? ORDER BY created_at") { it.setString(1, playerId.toString()) }

    fun delete(id: String) = dataSource.connection.use { c ->
        c.prepareStatement("DELETE FROM ${t.mcpGrants} WHERE id = ?").use { it.setString(1, id); it.executeUpdate() }
    }

    fun touch(id: String, at: Instant) = dataSource.connection.use { c ->
        c.prepareStatement("UPDATE ${t.mcpGrants} SET last_used_at = ? WHERE id = ?").use {
            it.setTimestamp(1, Timestamp.from(at)); it.setString(2, id); it.executeUpdate()
        }
    }

    fun setPermissions(playerId: UUID, origin: String, permissions: Set<String>) = dataSource.connection.use { c ->
        c.prepareStatement("UPDATE ${t.mcpGrants} SET permissions = ? WHERE player_id = ? AND origin = ?").use {
            it.setString(1, permissions.sorted().joinToString(",")); it.setString(2, playerId.toString()); it.setString(3, origin); it.executeUpdate()
        }
    }

    /** Whether grant [id] of [playerId] may deploy; false when no such grant. */
    fun setPublish(playerId: UUID, id: String, allow: Boolean): Boolean = dataSource.connection.use { c ->
        c.prepareStatement("UPDATE ${t.mcpGrants} SET allow_publish = ? WHERE id = ? AND player_id = ?").use {
            it.setBoolean(1, allow); it.setString(2, id); it.setString(3, playerId.toString()); it.executeUpdate() == 1
        }
    }

    fun deletePlayer(playerId: UUID, origin: String?): Int = dataSource.connection.use { c ->
        val sql = "DELETE FROM ${t.mcpGrants} WHERE player_id = ?" + if (origin != null) " AND origin = ?" else ""
        c.prepareStatement(sql).use {
            it.setString(1, playerId.toString()); if (origin != null) it.setString(2, origin); it.executeUpdate()
        }
    }

    /** Grants nothing can use any more: code and refresh token both expired, or absent. */
    fun purge(now: Instant) = dataSource.connection.use { c ->
        c.prepareStatement(
            "DELETE FROM ${t.mcpGrants} WHERE (code_expires_at IS NULL OR code_expires_at <= ?) AND (refresh_expires_at IS NULL OR refresh_expires_at <= ?)",
        ).use { it.setTimestamp(1, Timestamp.from(now)); it.setTimestamp(2, Timestamp.from(now)); it.executeUpdate() }
    }

    private fun select(where: String, bind: (PreparedStatement) -> Unit): List<McpGrantRow> = dataSource.connection.use { c ->
        c.prepareStatement("SELECT $COLUMNS FROM ${t.mcpGrants} $where").use { s ->
            bind(s)
            s.executeQuery().use { rs -> generateSequence { if (rs.next()) row(rs) else null }.toList() }
        }
    }

    private fun row(rs: ResultSet) = McpGrantRow(
        id = rs.getString(1), clientId = rs.getString(2), clientName = rs.getString(3),
        playerId = UUID.fromString(rs.getString(4)), playerName = rs.getString(5), origin = rs.getString(6),
        permissions = rs.getString(7).split(',').filter { it.isNotEmpty() }.toSet(),
        createdAt = rs.getTimestamp(8).toInstant(), lastUsedAt = rs.getTimestamp(9).toInstant(),
        codeHash = rs.getString(10), codeChallenge = rs.getString(11), redirectUri = rs.getString(12), codeExpiresAt = rs.getTimestamp(13)?.toInstant(),
        accessHash = rs.getString(14), accessExpiresAt = rs.getTimestamp(15)?.toInstant(),
        refreshHash = rs.getString(16), refreshExpiresAt = rs.getTimestamp(17)?.toInstant(),
        allowPublish = rs.getBoolean(18),
    )

    /** Binds [row]'s columns in [COLUMNS] order from parameter [from]; [skipId] leaves `id` out. Returns the next index. */
    private fun bind(s: PreparedStatement, row: McpGrantRow, from: Int = 1, skipId: Boolean = false): Int {
        var i = from
        fun text(v: String?) = if (v == null) s.setNull(i++, Types.VARCHAR) else s.setString(i++, v)
        fun time(v: Instant?) = if (v == null) s.setNull(i++, Types.TIMESTAMP) else s.setTimestamp(i++, Timestamp.from(v))
        if (!skipId) text(row.id)
        text(row.clientId); text(row.clientName); text(row.playerId.toString()); text(row.playerName); text(row.origin)
        text(row.permissions.sorted().joinToString(",")); time(row.createdAt); time(row.lastUsedAt)
        text(row.codeHash); text(row.codeChallenge); text(row.redirectUri); time(row.codeExpiresAt)
        text(row.accessHash); time(row.accessExpiresAt); text(row.refreshHash); time(row.refreshExpiresAt)
        s.setBoolean(i++, row.allowPublish)
        return i
    }

    private companion object {
        const val COLUMNS = "id, client_id, client_name, player_id, player_name, origin, permissions, created_at, last_used_at, " +
            "code_hash, code_challenge, redirect_uri, code_expires_at, access_hash, access_expires_at, refresh_hash, refresh_expires_at, allow_publish"
    }
}
