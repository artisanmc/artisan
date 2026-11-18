package net.artisanmc.plugin.command

import net.artisanmc.modules.api.importing.ImportReport
import net.artisanmc.plugin.ArtisanPlugin
import net.artisanmc.plugin.database.ImportRunRow
import net.artisanmc.plugin.importing.ImportRun
import net.artisanmc.plugin.importing.ImportRunLog
import net.artisanmc.plugin.importing.ImportRuns
import net.artisanmc.plugin.importing.Outcome
import net.artisanmc.plugin.lang.LangManager
import net.artisanmc.plugin.platform.Chat
import net.kyori.adventure.text.Component
import net.kyori.adventure.text.minimessage.MiniMessage
import org.bukkit.command.CommandSender
import java.io.File
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/**
 * `/artisan import` (ADR `data-imports` §7): `list`, `<source> [file] [confirm]`,
 * `rollback <batch> [confirm]`, `history`. The runs go off the game threads; the answer comes
 * back on the global one. Texts from the source (labels, messages) are escaped.
 */
internal class ImportCommand(private val plugin: ArtisanPlugin, private val lang: LangManager) {
    private val importsDir = File(plugin.dataFolder, "imports")

    private val runs: ImportRuns by lazy {
        importsDir.mkdirs()
        ImportRuns(plugin.api.getImports(), log(), importsDir.toPath(), ::runningPlugin)
    }

    fun complete(args: List<String>): List<String> = when (args.size) {
        1 -> (listOf("list", "history", "rollback") + plugin.api.getImports().registered().map { it.id() })
        2 -> if (args[0] == "rollback") emptyList() else (importsDir.list()?.sorted().orEmpty() + "confirm")
        3 -> listOf("confirm")
        else -> emptyList()
    }.filter { it.startsWith(args.last(), ignoreCase = true) }

    fun run(sender: CommandSender, args: List<String>) {
        val actor = sender.name
        when (args.firstOrNull()?.lowercase()) {
            null -> say(sender, "import.usage")
            "list" -> list(sender)
            "history" -> async(sender) { history(sender) }
            "rollback" -> {
                val batch = args.getOrNull(1) ?: return say(sender, "import.usage")
                val confirm = args.getOrNull(2).equals("confirm", ignoreCase = true)
                async(sender) { render(sender, runs.rollback(batch, confirm, actor), rollback = true, confirm) }
            }
            else -> {
                val rest = args.drop(1)
                val confirm = rest.any { it.equals("confirm", ignoreCase = true) }
                val file = rest.firstOrNull { !it.equals("confirm", ignoreCase = true) }
                val langOf = lang.playerLang(sender)
                say(sender, if (confirm) "import.started" else "import.planning", "source" to esc(args[0]))
                async(sender) { render(sender, runs.run(args[0].lowercase(), file, confirm, actor, langOf), rollback = false, confirm) }
            }
        }
    }

    private fun list(sender: CommandSender) {
        val sources = plugin.api.getImports().registered()
        if (sources.isEmpty()) return say(sender, "import.none")
        say(sender, "import.list_header", "count" to sources.size)
        sources.forEach { say(sender, "import.list_line", "source" to esc(it.id()), "label" to esc(it.label()), "file" to if (it.readsFile()) " <file>" else "") }
        say(sender, "import.folder", "folder" to esc(importsDir.path))
    }

    private fun history(sender: CommandSender): List<Component> {
        val past = runs.history(10)
        if (past.isEmpty()) return listOf(msg(sender, "import.history_empty"))
        val fmt = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm").withZone(ZoneId.systemDefault())
        return listOf(msg(sender, "import.history_header")) + past.map {
            msg(sender, "import.history_line", "at" to fmt.format(Instant.ofEpochMilli(it.at)), "action" to it.action,
                "source" to esc(it.source), "batch" to it.batch, "applied" to if (it.applied) "✔" else "–", "actor" to esc(it.actor))
        }
    }

    private fun render(sender: CommandSender, outcome: Outcome, rollback: Boolean, confirm: Boolean): List<Component> = when (outcome) {
        is Outcome.Refused -> listOf(msg(sender, "import.refused.${outcome.refusal.code}", *outcome.refusal.args.map { (k, v) -> k to esc(v) }.toTypedArray()))
        is Outcome.Done -> report(sender, outcome, rollback, confirm)
    }

    private fun report(sender: CommandSender, done: Outcome.Done, rollback: Boolean, confirm: Boolean): List<Component> {
        val r: ImportReport = done.report
        val id = esc(done.source.id())
        val lines = mutableListOf<Component>()
        lines += msg(sender, when {
            rollback && r.isDryRun -> "import.rollback_dry_header"
            rollback -> "import.rollback_header"
            r.isDryRun -> "import.dry_header"
            else -> "import.applied_header"
        }, "source" to id, "label" to esc(done.source.label()), "batch" to done.batch)
        r.counts.forEach { lines += msg(sender, "import.count_line", "label" to esc(it.label()), "count" to it.count()) }
        if (r.alreadyImported > 0) lines += msg(sender, "import.already", "count" to r.alreadyImported)
        if (r.rejected.isNotEmpty()) {
            lines += msg(sender, "import.rejected_header", "count" to r.rejected.size)
            r.rejected.groupBy { it.code() }.forEach { (code, list) ->
                lines += msg(sender, "import.rejected_line", "code" to esc(code), "count" to list.size,
                    "message" to esc(list.first().message()), "ids" to esc(list.take(5).joinToString { it.sourceId() } + if (list.size > 5) "…" else ""))
            }
        }
        r.blockers.forEach { lines += msg(sender, "import.blocker", "message" to esc(it)) }
        r.notes.take(10).forEach { lines += msg(sender, "import.note", "message" to esc(it)) }
        lines += when {
            r.blockers.isNotEmpty() -> msg(sender, "import.nothing_written")
            rollback && r.isDryRun -> msg(sender, "import.rollback_confirm_hint", "batch" to done.batch)
            r.isDryRun -> msg(sender, "import.confirm_hint", "source" to id)
            rollback -> msg(sender, "import.rollback_done")
            else -> msg(sender, "import.applied_done", "batch" to (r.batch ?: done.batch))
        }
        return lines
    }

    private fun async(sender: CommandSender, block: () -> List<Component>) = plugin.scheduler.async {
        val lines = try {
            block()
        } catch (e: Exception) {
            plugin.logger.log(java.util.logging.Level.SEVERE, "[Artisan] /artisan import failed", e)
            listOf(msg(sender, "import.refused.failed", "error" to esc(e.message ?: e.javaClass.simpleName)))
        }
        plugin.scheduler.global { lines.forEach { Chat.send(sender, it) } }
    }

    private fun runningPlugin(names: List<String>): String? = plugin.server.pluginManager.plugins
        .firstOrNull { p -> p.isEnabled && p != plugin && names.any { p.name.startsWith(it, ignoreCase = true) } }?.name

    /** The suite database's log; without it (no database yet), runs are kept in memory until restart. */
    private fun log(): ImportRunLog {
        val rows = plugin.suite.importRunRows()
        if (rows == null) plugin.logger.warning("[Artisan] the suite database is not open: /artisan import keeps its history in memory until restart")
        return if (rows != null) object : ImportRunLog {
            override fun record(run: ImportRun) { rows.insert(ImportRunRow(run.batch, run.source, run.module, run.action, run.applied, run.actor, run.at, run.target, run.reportJson)) }
            override fun findApplied(batch: String) = rows.findApplied(batch)?.let(::toRun)
            override fun recent(limit: Int) = rows.recent(limit).map(::toRun)
        } else object : ImportRunLog {
            private val runs = java.util.concurrent.CopyOnWriteArrayList<ImportRun>()
            override fun record(run: ImportRun) { runs += run }
            override fun findApplied(batch: String) = runs.firstOrNull { it.batch == batch && it.action == "apply" && it.applied }
            override fun recent(limit: Int) = runs.reversed().take(limit)
        }
    }

    private fun toRun(r: ImportRunRow) = ImportRun(r.batch, r.source, r.module, r.action, r.applied, r.actor, r.at, r.target, r.report)

    private fun msg(sender: CommandSender, key: String, vararg args: Pair<String, Any>) = lang.get(key, sender, *args)
    private fun say(sender: CommandSender, key: String, vararg args: Pair<String, Any>) = Chat.send(sender, msg(sender, key, *args))
    private fun esc(s: String) = MiniMessage.miniMessage().escapeTags(s)
}
