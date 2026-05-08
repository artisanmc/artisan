package gg.interfaze.plugin.command

import gg.interfaze.plugin.InterfazePlugin
import gg.interfaze.plugin.config.ConfigWriter
import gg.interfaze.plugin.config.PluginConfig
import gg.interfaze.plugin.ws.SetupClient
import net.kyori.adventure.text.Component
import net.kyori.adventure.text.event.ClickEvent
import net.kyori.adventure.text.format.NamedTextColor
import net.kyori.adventure.text.format.TextDecoration
import org.bukkit.Bukkit
import org.bukkit.command.Command
import org.bukkit.command.CommandExecutor
import org.bukkit.command.CommandSender
import org.bukkit.command.ConsoleCommandSender
import org.bukkit.command.TabCompleter
import org.bukkit.entity.Player

class IfzCommand(private val plugin: InterfazePlugin) : CommandExecutor, TabCompleter {

    @Volatile private var setupClient: SetupClient? = null

    fun shutdown() {
        setupClient?.disconnect()
        setupClient = null
    }

    override fun onTabComplete(
        sender: CommandSender, command: Command, label: String, args: Array<out String>
    ): List<String> {
        return when {
            args.size == 1 -> listOf("menu", "reload", "sync", "setup", "editor", "trusteditor")
                .filter { it.startsWith(args[0].lowercase()) }
            args.size == 2 && args[0].equals("menu", ignoreCase = true) ->
                plugin.menuProvider.listMenuIds().filter { it.startsWith(args[1]) }
            args.size == 2 && args[0].equals("sync", ignoreCase = true) ->
                listOf("status", "reject").filter { it.startsWith(args[1].lowercase()) }
            args.size == 2 && args[0].equals("editor", ignoreCase = true) ->
                listOf("revoke").filter { it.startsWith(args[1].lowercase()) }
            else -> emptyList()
        }
    }

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
            "editor" -> {
                when (args.getOrNull(1)?.lowercase()) {
                    "revoke" -> editorRevoke(sender)
                    null     -> editor(sender)
                    else     -> sender.sendMessage("Usage: /ifz editor [revoke]")
                }
            }
            "trusteditor" -> {
                val code = args.getOrNull(1) ?: run {
                    sender.sendMessage("[Interfaze] Usage: /ifz trusteditor <code>")
                    return true
                }
                if (!sender.hasPermission("interfaze.editor")) {
                    sender.sendMessage("[Interfaze] Permission manquante : interfaze.editor")
                    return true
                }
                plugin.menuProvider.sendTrustRequest(code.uppercase())
                sender.sendMessage("[Interfaze] Demande de trust envoyée.")
            }
            else -> sender.sendMessage("Usage: /ifz <menu <id>|reload|sync <status|reject>|setup [CODE]|editor [revoke]|trusteditor <code>>")
        }
        return true
    }

    private fun editor(sender: CommandSender) {
        val cfg = PluginConfig.from(plugin.config)
        if (cfg.editorConsoleOnly && sender !is ConsoleCommandSender) {
            sender.sendMessage("[Interfaze] /ifz editor est réservé à la console (editor.console_only=true).")
            return
        }
        if (!sender.hasPermission("interfaze.editor")) {
            sender.sendMessage("[Interfaze] Permission manquante : interfaze.editor")
            return
        }
        if (cfg.wsUrl.isEmpty() || cfg.serverKey.isEmpty()) {
            sender.sendMessage("[Interfaze] Le serveur n'est pas lié. Lancez /ifz setup.")
            return
        }
        val senderName = if (sender is Player) sender.name else "CONSOLE"
        plugin.menuProvider.requestEditorSession(senderName) { url, expiresAt ->
            plugin.logger.info("Éditeur → $url  (expire $expiresAt)")
            Bukkit.getScheduler().runTask(plugin, Runnable {
                val link = Component.text("[Ouvrir l'éditeur]")
                    .color(NamedTextColor.GREEN)
                    .decorate(TextDecoration.UNDERLINED)
                    .clickEvent(ClickEvent.openUrl(url))
                sender.sendMessage(Component.text("[Interfaze] ").append(link))
                sender.sendMessage(Component.text("[Interfaze] (expire le $expiresAt)").color(NamedTextColor.GRAY))
            })
        }
    }

    private fun editorRevoke(sender: CommandSender) {
        if (!sender.hasPermission("interfaze.editor")) {
            sender.sendMessage("[Interfaze] Permission manquante : interfaze.editor")
            return
        }
        plugin.menuProvider.revokeEditorSessions()
        sender.sendMessage("[Interfaze] Toutes les sessions éditeur ont été révoquées.")
    }

    private fun setup(sender: CommandSender, code: String?) {
        setupClient?.disconnect()
        setupClient = null
        val cfg = PluginConfig.from(plugin.config)
        if (cfg.wsUrl.isEmpty()) {
            sender.sendMessage("[Interfaze] ws_url is not configured in config.yml.")
            return
        }
        sender.sendMessage("[Interfaze] Connexion au backend en cours…")
        val configFile = plugin.dataFolder.resolve("config.yml")
        setupClient = SetupClient(
            url = cfg.wsUrl,
            code = code,
            onCode = { receivedCode, url ->
                plugin.logger.info("Lier ce serveur : $url")
                Bukkit.getScheduler().runTask(plugin, Runnable {
                    val link = Component.text("[Lier ce serveur]")
                        .color(NamedTextColor.AQUA)
                        .decorate(TextDecoration.UNDERLINED)
                        .clickEvent(ClickEvent.openUrl(url))
                    sender.sendMessage(Component.text("[Interfaze] ").append(link))
                })
            },
            onLinked = { serverKey ->
                ConfigWriter.writeServerKey(configFile, serverKey)
                plugin.logger.info("Serveur lié ✓ (server_key écrit dans config.yml)")
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
