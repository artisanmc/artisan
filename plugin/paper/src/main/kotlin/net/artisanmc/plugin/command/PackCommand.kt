package net.artisanmc.plugin.command

import net.artisanmc.plugin.engine.ActionExecutor
import net.artisanmc.plugin.engine.ExecutionContext
import net.artisanmc.plugin.lang.LangManager
import org.bukkit.command.Command
import org.bukkit.command.CommandSender
import org.bukkit.entity.Player
import net.artisanmc.plugin.platform.Chat

/**
 * A `command/v1` document in the command map. The leading arguments select a sub-command
 * (by name or alias, as deep as they match); the rest are that node's arguments.
 */
class PackCommand(
    private val compiled: CompiledCommand,
    private val executor: ActionExecutor,
    private val lang: LangManager,
    /** Project defining the command: its `open_menu` with a bare id resolve there first. */
    private val projectId: String? = null,
) : Command(
    compiled.name,
    compiled.description?.forLang(lang.defaultLang, lang.defaultLang) ?: "",
    "/${compiled.name}",
    compiled.aliases,
) {
    init {
        if (compiled.permission != null) permission = compiled.permission
    }

    override fun execute(sender: CommandSender, commandLabel: String, args: Array<String>): Boolean {
        if (sender !is Player) {
            Chat.send(sender, lang.get("cmd.in_game_only", sender))
            return true
        }
        val path = walk(args, args.size)
        val node = path.last()
        val depth = path.size - 1
        // Every node on the way down: a sub-command's permission adds to its parent's.
        if (path.any { n -> n.permission?.let { !sender.hasPermission(it) } == true }) {
            Chat.send(sender, lang.get("cmd.no_permission", sender))
            return true
        }
        if (node.isGroup) {
            val subs = node.children.filter { c -> allowed(sender, c) }.map { it.name }
            val typed = (listOf(commandLabel) + args.take(depth)).joinToString(" ")
            Chat.send(sender, lang.get("cmd.usage", sender, "command" to typed, "subcommands" to subs.joinToString("|")))
            return true
        }
        val parsedArgs = ArgParser.parse(node.argDefs, args.copyOfRange(depth, args.size), sender, lang) ?: return true
        val ctx = ExecutionContext(
            player = sender,
            args = parsedArgs,
            lang = lang.playerLang(sender),
            projectId = projectId,
        )
        executor.handle(node.handler, ctx)
        return true
    }

    override fun tabComplete(sender: CommandSender, alias: String, args: Array<String>): List<String> {
        if (sender !is Player) return emptyList()
        // The last argument is being typed: only the ones before it select a node.
        val path = walk(args, args.size - 1)
        val node = path.last()
        val depth = path.size - 1
        if (path.any { !allowed(sender, it) }) return emptyList()
        val prefix = args.lastOrNull() ?: ""
        val subs = if (depth == args.size - 1) {
            node.children.filter { c -> allowed(sender, c) && c.name.startsWith(prefix, ignoreCase = true) }.map { it.name }
        } else emptyList()
        if (node.isGroup) return subs
        return subs + ArgParser.tabComplete(node.argDefs, args.copyOfRange(depth, args.size))
    }

    /** The root, then each sub-command the first [limit] arguments name. */
    private fun walk(args: Array<String>, limit: Int): List<CompiledCommand> {
        val path = mutableListOf(compiled)
        while (path.size - 1 < limit) {
            path += path.last().child(args[path.size - 1]) ?: break
        }
        return path
    }

    private fun allowed(sender: CommandSender, node: CompiledCommand) =
        node.permission?.let(sender::hasPermission) != false
}
