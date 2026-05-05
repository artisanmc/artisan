package gg.interfaze.plugin.command

import gg.interfaze.plugin.InterfazePlugin
import gg.interfaze.plugin.config.ConfigWriter
import gg.interfaze.plugin.config.PluginConfig
import gg.interfaze.plugin.ws.SetupClient
import org.bukkit.Bukkit
import org.bukkit.command.Command
import org.bukkit.command.CommandExecutor
import org.bukkit.command.CommandSender
import org.bukkit.entity.Player

class IfzCommand(private val plugin: InterfazePlugin) : CommandExecutor {

    @Volatile private var setupClient: SetupClient? = null

    override fun onCommand(sender: CommandSender, command: Command, label: String, args: Array<out String>): Boolean {
        when (args.getOrNull(0)?.lowercase()) {
            "menu" -> {
                if (sender !is Player) { sender.sendMessage("In-game only."); return true }
                val menuId = args.getOrNull(1) ?: run { sender.sendMessage("Usage: /ifz menu <id>"); return true }
                plugin.menuProvider.openMenu(sender, menuId, "en")
            }
            "reload" -> {
                plugin.menuProvider.unload()
                plugin.menuProvider.load()
                sender.sendMessage("Interfaze reloaded.")
            }
            "sync" -> {
                when (args.getOrNull(1)?.lowercase()) {
                    "status" -> sender.sendMessage("Check server logs for sync status details.")
                    "reject" -> {
                        plugin.menuProvider.unload()
                        plugin.menuProvider.load()
                        sender.sendMessage("Reconnecting to backend — backend version will be applied if available.")
                    }
                    else -> sender.sendMessage("Usage: /ifz sync <status|reject>")
                }
            }
            "setup" -> setup(sender, args.getOrNull(1)?.uppercase())
            else -> sender.sendMessage("Usage: /ifz <menu <id>|reload|sync <status|reject>|setup [CODE]>")
        }
        return true
    }

    private fun setup(sender: CommandSender, code: String?) {
        setupClient?.disconnect()
        val cfg = PluginConfig.from(plugin.config)
        if (cfg.wsUrl.isEmpty()) {
            sender.sendMessage("[Interfaze] ws_url is not configured in config.yml.")
            return
        }

        sender.sendMessage("[Interfaze] Connexion au backend en cours...")

        val configFile = plugin.dataFolder.resolve("config.yml")

        setupClient = SetupClient(
            url = cfg.wsUrl,
            code = code,
            onCode = { receivedCode, url ->
                val msg = "[Interfaze] Lier ce serveur : $url"
                plugin.logger.info(msg)
                Bukkit.getScheduler().runTask(plugin, Runnable {
                    sender.sendMessage(msg)
                })
            },
            onLinked = { serverKey ->
                ConfigWriter.writeServerKey(configFile, serverKey)
                plugin.logger.info("[Interfaze] Serveur lié ✓ (server_key écrit dans config.yml)")
                Bukkit.getScheduler().runTask(plugin, Runnable {
                    sender.sendMessage("[Interfaze] Serveur lié ✓ Rechargement en cours...")
                    plugin.reloadConfig()
                    plugin.reinit(PluginConfig.from(plugin.config))
                    sender.sendMessage("[Interfaze] Prêt.")
                })
            },
        )
        setupClient!!.connect()
    }
}
