package net.artisanmc.plugin.command

import net.artisanmc.modules.api.importing.ImportReport
import net.artisanmc.plugin.ArtisanPlugin
import net.artisanmc.plugin.importing.ImportRuns
import net.artisanmc.plugin.importing.Outcome
import net.artisanmc.plugin.lang.LangManager
import net.artisanmc.plugin.platform.Chat
import net.kyori.adventure.text.Component
import net.kyori.adventure.text.minimessage.MiniMessage
import org.bukkit.command.CommandSender
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/**
 * `/artisan import` (ADR `data-imports` §7): `list`, `<source> [file] [confirm]`,
 * `rollback <batch> [confirm]`, `history`. The runs go off the game threads; the answer comes
 * back on the global one. Texts from the source (labels, messages) are escaped.
 */
internal class ImportCommand(private val plugin: ArtisanPlugin, private val lang: LangManager) {
    private val importsDir = net.artisanmc.plugin.importing.ImportWiring.importsDir(plugin)
    private val runs: ImportRuns get() = plugin.importRuns

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
        is Outcome.Refused -> buildList {
            add(msg(sender, "import.refused.${outcome.refusal.code}", *outcome.refusal.args.map { (k, v) -> k to esc(v) }.toTypedArray()))
            // An apply that stopped midway: what it wrote can be undone under its batch.
            (outcome.refusal as? net.artisanmc.plugin.importing.Refusal.Failed)?.batch?.let { add(msg(sender, "import.failed_batch", "batch" to it)) }
        }
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
            r.total() == 0 -> msg(sender, if (rollback) "import.rollback_nothing" else "import.nothing_new")
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

    private fun msg(sender: CommandSender, key: String, vararg args: Pair<String, Any>) = lang.get(key, sender, *args)
    private fun say(sender: CommandSender, key: String, vararg args: Pair<String, Any>) = Chat.send(sender, msg(sender, key, *args))
    private fun esc(s: String) = MiniMessage.miniMessage().escapeTags(s)
}
