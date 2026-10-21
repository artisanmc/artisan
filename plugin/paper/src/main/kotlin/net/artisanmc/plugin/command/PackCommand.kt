package net.artisanmc.plugin.command

import net.artisanmc.plugin.engine.ActionExecutor
import net.artisanmc.plugin.engine.ExecutionContext
import net.artisanmc.plugin.lang.LangManager
import org.bukkit.command.Command
import org.bukkit.command.CommandSender
import org.bukkit.entity.Player
import net.artisanmc.plugin.platform.Chat

class PackCommand(
    private val compiled: CompiledCommand,
    private val executor: ActionExecutor,
    private val lang: LangManager,
    /** Project defining the command: its `open_menu` with a bare id resolve there first. */
    private val projectId: String? = null,
) : Command(
    compiled.name,
    compiled.description,
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
        val permission = compiled.permission
        if (permission != null && !sender.hasPermission(permission)) {
            Chat.send(sender, lang.get("cmd.no_permission", sender))
            return true
        }
        val parsedArgs = ArgParser.parse(compiled.argDefs, args, sender, lang) ?: return true
        val ctx = ExecutionContext(
            player = sender,
            args = parsedArgs,
            lang = lang.playerLang(sender),
            projectId = projectId,
        )
        executor.handle(compiled.handler, ctx)
        return true
    }

    override fun tabComplete(sender: CommandSender, alias: String, args: Array<String>): List<String> {
        if (sender !is Player) return emptyList()
        return ArgParser.tabComplete(compiled.argDefs, args)
    }
}
