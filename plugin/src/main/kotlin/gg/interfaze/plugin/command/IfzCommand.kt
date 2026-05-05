package gg.interfaze.plugin.command

import gg.interfaze.plugin.InterfazePlugin
import org.bukkit.command.Command
import org.bukkit.command.CommandExecutor
import org.bukkit.command.CommandSender
import org.bukkit.entity.Player

class IfzCommand(private val plugin: InterfazePlugin) : CommandExecutor {
    override fun onCommand(sender: CommandSender, command: Command, label: String, args: Array<out String>): Boolean {
        if (sender !is Player) {
            sender.sendMessage("This command can only be run by a player.")
            return true
        }
        when (args.getOrNull(0)?.lowercase()) {
            "menu" -> {
                val menuId = args.getOrNull(1) ?: run {
                    sender.sendMessage("Usage: /ifz menu <id>")
                    return true
                }
                plugin.menuProvider.openMenu(sender, menuId, "en")
            }
            "reload" -> {
                plugin.menuProvider.load()
                sender.sendMessage("Interfaze reloaded.")
            }
            else -> sender.sendMessage("Usage: /ifz menu <id> | /ifz reload")
        }
        return true
    }
}
