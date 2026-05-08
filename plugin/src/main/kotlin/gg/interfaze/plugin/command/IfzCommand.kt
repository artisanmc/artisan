package gg.interfaze.plugin.command

import gg.interfaze.plugin.InterfazePlugin
import gg.interfaze.plugin.config.ConfigWriter
import gg.interfaze.plugin.config.PluginConfig
import gg.interfaze.plugin.lang.LangManager
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

class IfzCommand(
    private val plugin: InterfazePlugin,
    private val lang: LangManager,
) : CommandExecutor, TabCompleter {

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
                if (sender !is Player) { sender.sendMessage(lang.get("ifz.in_game_only", sender)); return true }
                val menuId = args.getOrNull(1) ?: run { sender.sendMessage(lang.get("ifz.usage_menu", sender)); return true }
                plugin.menuProvider.openMenu(sender, menuId, lang.playerLang(sender))
            }
            "reload" -> {
                plugin.menuProvider.unload()
                plugin.menuProvider.load()
                sender.sendMessage(lang.get("ifz.reloaded", sender))
            }
            "sync" -> {
                when (args.getOrNull(1)?.lowercase()) {
                    "status" -> sender.sendMessage(lang.get("ifz.sync_status", sender))
                    "reject" -> {
                        plugin.menuProvider.unload()
                        plugin.menuProvider.load()
                        sender.sendMessage(lang.get("ifz.sync_reconnecting", sender))
                    }
                    else -> sender.sendMessage(lang.get("ifz.usage_sync", sender))
                }
            }
            "setup" -> setup(sender, args.getOrNull(1)?.uppercase())
            "editor" -> {
                when (args.getOrNull(1)?.lowercase()) {
                    "revoke" -> editorRevoke(sender)
                    null     -> editor(sender)
                    else     -> sender.sendMessage(lang.get("ifz.usage_editor", sender))
                }
            }
            "trusteditor" -> {
                val code = args.getOrNull(1) ?: run {
                    sender.sendMessage(lang.get("ifz.usage_trusteditor", sender))
                    return true
                }
                if (!sender.hasPermission("interfaze.editor")) {
                    sender.sendMessage(lang.get("ifz.trust_no_permission", sender))
                    return true
                }
                plugin.menuProvider.sendTrustRequest(code.uppercase())
                sender.sendMessage(lang.get("ifz.trust_sent", sender))
            }
            else -> sender.sendMessage(lang.get("ifz.usage_main", sender))
        }
        return true
    }

    private fun editor(sender: CommandSender) {
        val cfg = PluginConfig.from(plugin.config)
        val senderLang = lang.playerLang(sender)
        if (cfg.editorConsoleOnly && sender !is ConsoleCommandSender) {
            sender.sendMessage(lang.get("ifz.editor_console_only", senderLang))
            return
        }
        if (!sender.hasPermission("interfaze.editor")) {
            sender.sendMessage(lang.get("ifz.editor_no_permission", senderLang))
            return
        }
        if (cfg.wsUrl.isEmpty() || cfg.serverKey.isEmpty()) {
            sender.sendMessage(lang.get("ifz.server_not_linked", senderLang))
            return
        }
        val senderName = if (sender is Player) sender.name else "CONSOLE"
        plugin.menuProvider.requestEditorSession(senderName) { url, expiresAt ->
            plugin.logger.info("Editor → $url  (expires $expiresAt)")
            Bukkit.getScheduler().runTask(plugin, Runnable {
                val link = Component.text(lang.getRaw("ifz.editor_link_label", senderLang))
                    .color(NamedTextColor.GREEN)
                    .decorate(TextDecoration.UNDERLINED)
                    .clickEvent(ClickEvent.openUrl(url))
                sender.sendMessage(lang.get("ifz.prefix", senderLang).append(link))
                sender.sendMessage(lang.get("ifz.editor_expires", senderLang, "expires" to expiresAt))
            })
        }
    }

    private fun editorRevoke(sender: CommandSender) {
        val senderLang = lang.playerLang(sender)
        if (!sender.hasPermission("interfaze.editor")) {
            sender.sendMessage(lang.get("ifz.editor_no_permission", senderLang))
            return
        }
        plugin.menuProvider.revokeEditorSessions()
        sender.sendMessage(lang.get("ifz.editor_revoked", senderLang))
    }

    private fun setup(sender: CommandSender, code: String?) {
        setupClient?.disconnect()
        setupClient = null
        val cfg = PluginConfig.from(plugin.config)
        val senderLang = lang.playerLang(sender)
        if (cfg.wsUrl.isEmpty()) {
            sender.sendMessage(lang.get("ifz.setup_ws_missing", senderLang))
            return
        }
        sender.sendMessage(lang.get("ifz.setup_connecting", senderLang))
        val configFile = plugin.dataFolder.resolve("config.yml")
        setupClient = SetupClient(
            url = cfg.wsUrl,
            code = code,
            onCode = { _, url ->
                plugin.logger.info("Setup link: $url")
                Bukkit.getScheduler().runTask(plugin, Runnable {
                    val link = Component.text(lang.getRaw("ifz.setup_link_label", senderLang))
                        .color(NamedTextColor.AQUA)
                        .decorate(TextDecoration.UNDERLINED)
                        .clickEvent(ClickEvent.openUrl(url))
                    sender.sendMessage(lang.get("ifz.prefix", senderLang).append(link))
                })
            },
            onLinked = { serverKey ->
                ConfigWriter.writeServerKey(configFile, serverKey)
                plugin.logger.info("Server linked (server_key written to config.yml)")
                Bukkit.getScheduler().runTask(plugin, Runnable {
                    sender.sendMessage(lang.get("ifz.setup_linked", senderLang))
                    plugin.reloadConfig()
                    plugin.reinit(PluginConfig.from(plugin.config))
                    sender.sendMessage(lang.get("ifz.setup_ready", senderLang))
                })
            },
        )
        setupClient!!.connect()
    }
}
