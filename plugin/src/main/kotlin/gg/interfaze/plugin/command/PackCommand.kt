package gg.interfaze.plugin.command

import gg.interfaze.plugin.engine.ActionExecutor
import gg.interfaze.plugin.engine.ExecutionContext
import org.bukkit.command.Command
import org.bukkit.command.CommandSender
import org.bukkit.entity.Player

class PackCommand(
    private val compiled: CompiledCommand,
    private val executor: ActionExecutor,
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
            sender.sendMessage("This command can only be used in-game.")
            return true
        }
        if (compiled.permission != null && !sender.hasPermission(compiled.permission)) {
            sender.sendMessage("You don't have permission to use this command.")
            return true
        }
        val parsedArgs = ArgParser.parse(compiled.argDefs, args, sender) ?: return true
        val ctx = ExecutionContext(player = sender, args = parsedArgs)
        executor.handle(compiled.handler, ctx)
        return true
    }

    override fun tabComplete(sender: CommandSender, alias: String, args: Array<String>): List<String> {
        if (sender !is Player) return emptyList()
        return ArgParser.tabComplete(compiled.argDefs, args)
    }
}
