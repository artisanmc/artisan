package net.artisanmc.plugin.database

import java.sql.ResultSet
import javax.sql.DataSource

/** A row of `artisan_import_runs`. */
data class ImportRunRow(
    val batch: String,
    val source: String,
    val module: String,
    val action: String,
    val applied: Boolean,
    val actor: String,
    val at: Long,
    val target: String?,
    val report: String,
)

/**
 * `artisan_import_runs`: one row per run of `/artisan import` (ADR `data-imports` §7), so an
 * admin and support can tell what was imported, when, by whom, and which batch to roll back.
 * Written once, never updated.
 */
class ImportRunRows(private val dataSource: DataSource, private val t: ArtisanTables = ArtisanTables.DEFAULT) {
    fun insert(r: ImportRunRow) = dataSource.connection.use { c ->
        c.prepareStatement(
            "INSERT INTO ${t.importRuns} (batch, source, module, run_action, applied, actor, run_at, target, report) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ).use {
            it.setString(1, r.batch); it.setString(2, r.source); it.setString(3, r.module); it.setString(4, r.action)
            it.setInt(5, if (r.applied) 1 else 0); it.setString(6, r.actor.take(64)); it.setLong(7, r.at)
            it.setString(8, r.target); it.setString(9, r.report)
            it.executeUpdate()
        }
    }

    /** The applied import of [batch], or null. */
    fun findApplied(batch: String): ImportRunRow? = dataSource.connection.use { c ->
        c.prepareStatement("SELECT $COLUMNS FROM ${t.importRuns} WHERE batch = ? AND run_action = 'apply' AND applied = 1").use { s ->
            s.setString(1, batch)
            s.executeQuery().use { rs -> if (rs.next()) row(rs) else null }
        }
    }

    /** The last [limit] runs, newest first. */
    fun recent(limit: Int): List<ImportRunRow> = dataSource.connection.use { c ->
        c.prepareStatement("SELECT $COLUMNS FROM ${t.importRuns} ORDER BY run_at DESC, batch DESC").use { s ->
            s.maxRows = limit
            s.executeQuery().use { rs -> buildList { while (rs.next()) add(row(rs)) } }
        }
    }

    private fun row(rs: ResultSet) = ImportRunRow(
        rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getInt(5) == 1,
        rs.getString(6), rs.getLong(7), rs.getString(8), rs.getString(9),
    )

    private companion object {
        const val COLUMNS = "batch, source, module, run_action, applied, actor, run_at, target, report"
    }
}
