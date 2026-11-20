package net.artisanmc.plugin.importing

import net.artisanmc.plugin.ArtisanPlugin
import net.artisanmc.plugin.database.ImportRunRow
import java.io.File
import java.util.concurrent.CopyOnWriteArrayList
import java.util.logging.Level

/**
 * The server's [ImportRuns], shared by `/artisan import` and the editor: one lock per module and
 * one history, whichever asks. Files are read from `plugins/Artisan/imports/`.
 */
internal object ImportWiring {
    fun importsDir(plugin: ArtisanPlugin) = File(plugin.dataFolder, "imports")

    fun runs(plugin: ArtisanPlugin): ImportRuns {
        val dir = importsDir(plugin).apply { mkdirs() }
        return ImportRuns(
            plugin.api.getImports(), log(plugin), dir.toPath(),
            runningPlugin = { names ->
                plugin.server.pluginManager.plugins
                    .firstOrNull { p -> p.isEnabled && p != plugin && names.any { p.name.startsWith(it, ignoreCase = true) } }?.name
            },
            onFailure = { what, e -> plugin.logger.log(Level.SEVERE, "[Artisan] import $what failed", e) },
        )
    }

    /**
     * The suite database's log, looked up at each call: it may open after the first import is
     * asked for. Without it, runs are kept in memory until restart.
     */
    private fun log(plugin: ArtisanPlugin) = object : ImportRunLog {
        private val memory = CopyOnWriteArrayList<ImportRun>()

        override fun record(run: ImportRun) {
            val rows = plugin.suite.importRunRows()
            if (rows != null) rows.insert(ImportRunRow(run.batch, run.source, run.module, run.action, run.applied, run.actor, run.at, run.target, run.reportJson))
            else memory += run
        }

        override fun findApplied(batch: String) =
            plugin.suite.importRunRows()?.findApplied(batch)?.let(::toRun) ?: memory.firstOrNull { it.batch == batch && it.action == "apply" && it.applied }

        override fun recent(limit: Int): List<ImportRun> {
            val stored = plugin.suite.importRunRows()?.recent(limit)?.map(::toRun).orEmpty()
            return (memory.reversed() + stored).sortedByDescending { it.at }.take(limit)
        }
    }

    private fun toRun(r: ImportRunRow) = ImportRun(r.batch, r.source, r.module, r.action, r.applied, r.actor, r.at, r.target, r.report)
}
