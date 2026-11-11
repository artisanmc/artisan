package net.artisanmc.plugin.database

import net.artisanmc.modules.api.database.DatabaseDialect
import java.sql.Connection
import java.time.Instant
import java.util.UUID
import java.util.logging.Logger
import javax.sql.DataSource

/**
 * A lone server joining a Network moves from its embedded H2 database to the shared MySQL one
 * (ADR `server-identity-and-versions`, decision 11): its Versions, their contents and its drafts
 * follow it, matched by server id, with fresh numeric ids. Runs once: the import and its mark in
 * `artisan_meta` (`imported:<server id>`) are one transaction, so a failed import runs again at
 * the next start, and a done one never does, whatever the server recorded since. The H2 file,
 * shared with the suite's other plugins, is left as it is; they move their own tables.
 */
object EmbeddedImport {
    /** True when something was imported. */
    fun run(
        source: DataSource,
        target: DataSource,
        dialect: DatabaseDialect,
        serverId: UUID,
        logger: Logger,
        t: ArtisanTables = ArtisanTables.DEFAULT,
    ): Boolean = source.connection.use { from -> target.connection.use { to -> run(from, to, dialect, serverId, logger, t) } }

    private fun run(from: Connection, to: Connection, dialect: DatabaseDialect, serverId: UUID, logger: Logger, t: ArtisanTables): Boolean {
        val mark = "imported:$serverId"
        if (ArtisanMeta.get(to, t, mark) != null) return false
        val newRow = rowId(to, serverId, t) ?: return false
        val recorded = to.prepareStatement("SELECT 1 FROM ${t.versions} WHERE server_id = ?").use { s ->
            s.setInt(1, newRow); s.executeQuery().use { it.next() }
        }
        // Imported before this mark existed: recorded as such, never imported again.
        if (recorded) { ArtisanMeta.put(to, t, mark, Instant.now().toString()); return false }
        if (!SchemaMigrator.hasTable(from, t.versions)) return false
        val oldRow = rowId(from, serverId, t) ?: return false

        to.autoCommit = false
        try {
            var contents = 0
            from.prepareStatement("SELECT hash, content FROM ${t.contents}").use { s ->
                s.executeQuery().use { rs ->
                    while (rs.next()) contents += Contents.put(to, dialect, t, rs.getString(1), rs.getBytes(2))
                }
            }
            val ids = HashMap<Int, Int>()
            val restored = ArrayList<Pair<Int, Int>>()
            from.prepareStatement(
                "SELECT id, project_key, folder, hash, manifest, author_id, author_name, created_at, restored_from FROM ${t.versions} WHERE server_id = ? ORDER BY id",
            ).use { s ->
                s.setInt(1, oldRow)
                s.executeQuery().use { rs ->
                    while (rs.next()) {
                        val newId = to.prepareStatement(
                            "INSERT INTO ${t.versions} (server_id, project_key, folder, hash, manifest, author_id, author_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                            arrayOf("id"),
                        ).use {
                            it.setInt(1, newRow)
                            for (column in 2..7) it.setString(column, rs.getString(column))
                            it.setTimestamp(8, rs.getTimestamp(8))
                            it.executeUpdate()
                            it.generatedKeys.use { keys -> keys.next(); keys.getInt(1) }
                        }
                        ids[rs.getInt(1)] = newId
                        rs.getInt(9).takeUnless { rs.wasNull() }?.let { restored += newId to it }
                    }
                }
            }
            for ((version, old) in restored) ids[old]?.let { source ->
                to.prepareStatement("UPDATE ${t.versions} SET restored_from = ? WHERE id = ?").use { it.setInt(1, source); it.setInt(2, version); it.executeUpdate() }
            }
            var drafts = 0
            from.prepareStatement("SELECT project_key, id, draft, status, updated_at FROM ${t.drafts} WHERE server_id = ?").use { s ->
                s.setInt(1, oldRow)
                s.executeQuery().use { rs ->
                    while (rs.next()) to.prepareStatement(
                        "INSERT INTO ${t.drafts} (server_id, project_key, id, draft, status, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
                    ).use {
                        it.setInt(1, newRow); it.setString(2, rs.getString(1)); it.setString(3, rs.getString(2)); it.setString(4, rs.getString(3))
                        it.setString(5, rs.getString(4)); it.setTimestamp(6, rs.getTimestamp(5))
                        it.executeUpdate(); drafts++
                    }
                }
            }
            ArtisanMeta.put(to, t, mark, Instant.now().toString())
            to.commit()
            logger.info("[Artisan] Imported from the embedded database: ${ids.size} versions, $drafts drafts, $contents contents")
            return ids.isNotEmpty() || drafts > 0
        } catch (e: Exception) {
            to.rollback()
            throw e
        } finally {
            to.autoCommit = true
        }
    }

    private fun rowId(c: Connection, serverId: UUID, t: ArtisanTables): Int? =
        c.prepareStatement("SELECT id FROM ${t.servers} WHERE uuid = ?").use { s ->
            s.setString(1, serverId.toString()); s.executeQuery().use { if (it.next()) it.getInt(1) else null }
        }
}
