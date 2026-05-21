package gg.interfaze.plugin.command

import gg.interfaze.plugin.InterfazePlugin
import gg.interfaze.plugin.config.ConfigWriter
import gg.interfaze.plugin.config.PluginConfig
import gg.interfaze.plugin.lang.LangManager
import gg.interfaze.plugin.render.TitleCompiler
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
            args.size == 1 -> listOf("menu", "reload", "sync", "setup", "editor", "trusteditor", "dump-title", "pushLocal")
                .filter { it.startsWith(args[0].lowercase()) }
            args.size == 2 && args[0].equals("menu", ignoreCase = true) ->
                plugin.menuProvider.listMenuIds().filter { it.startsWith(args[1]) }
            args.size == 2 && args[0].equals("dump-title", ignoreCase = true) ->
                plugin.menuProvider.listMenuIds().filter { it.startsWith(args[1]) }
            args.size == 2 && args[0].equals("sync", ignoreCase = true) ->
                listOf("status", "reject").filter { it.startsWith(args[1].lowercase()) }
            args.size == 2 && args[0].equals("editor", ignoreCase = true) ->
                listOf("revoke").filter { it.startsWith(args[1].lowercase()) }
            args.size == 2 && args[0].equals("pushLocal", ignoreCase = true) -> {
                val packsDir = java.io.File(plugin.dataFolder, "packs")
                val packIds = packsDir.listFiles { f -> f.isDirectory && !f.name.startsWith(".") }
                    ?.map { it.name } ?: emptyList()
                (packIds + "--all").filter { it.startsWith(args[1]) }
            }
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
            "dump-title" -> {
                val menuId = args.getOrNull(1) ?: run {
                    sender.sendMessage("Usage: /ifz dump-title <menu_id> [lang]")
                    return true
                }
                dumpTitle(sender, menuId, args.getOrNull(2))
            }
            "pushlocal" -> handlePushLocal(sender, args.drop(1))
            else -> sender.sendMessage(lang.get("ifz.usage_main", sender))
        }
        return true
    }

    /**
     * Diagnostic: compile the title for [menuId] and print every step.
     * Useful when in-game position differs from the editor preview — the
     * dump shows the exact MiniMessage emitted, the offset advances, and
     * the resulting MC cursor X at each layer boundary.
     */
    private fun dumpTitle(sender: CommandSender, menuId: String, langOverride: String?) {
        val menu = plugin.menuProvider.findMenu(menuId)
        if (menu == null) {
            sender.sendMessage("Menu '$menuId' not found. Known: ${plugin.menuProvider.listMenuIds()}")
            return
        }
        val resolvedLang = langOverride ?: PluginConfig.from(plugin.config).language
        val langMap = menu.langMaps[resolvedLang] ?: emptyMap()
        val encoder = plugin.assetCatalog.offsetEncoder()
        val advances: Map<Char, Int> = encoder.advances()

        // Re-decode the offset chars char-by-char so we can show MC's cursor as
        // it advances through the assembled MiniMessage string.
        fun decodeOffsetSum(s: String): Int = s.sumOf { advances[it] ?: 0 }

        // Walk the assembled string and pretty-print each offset run + each
        // <font:text_y{Y}>…</font> body, with the running cursor X.
        val result = TitleCompiler.compileTitle(
            layers = menu.title,
            lang = resolvedLang,
            langMap = langMap,
            lookupAsset = plugin.assetCatalog::lookup,
            offsetEncoder = encoder,
        )
        val raw = result.toString()

        // Helper: both to chat and to server console (logs are easier to grep
        // than a chat scrollback that truncates and filters PUA chars).
        fun out(msg: String) {
            sender.sendMessage(msg)
            plugin.logger.info("[dump-title] $msg")
        }

        out("─── dump-title $menuId (lang=$resolvedLang) ───")
        out("Title layers (input order): ${menu.title.size}")
        for ((i, l) in menu.title.withIndex()) out("  [$i] $l")

        out("─── cursor walk (initial currentX=${TitleCompiler.TITLE_LABEL_X}) ───")
        val sorted = menu.title.sortedWith(compareBy {
            when (it) {
                is gg.interfaze.plugin.model.MenuTitleLayer.Text,
                is gg.interfaze.plugin.model.MenuTitleLayer.Textarea -> 1
                else -> 0
            }
        })
        var currentX = TitleCompiler.TITLE_LABEL_X
        for ((i, layer) in sorted.withIndex()) {
            val isTextarea = layer is gg.interfaze.plugin.model.MenuTitleLayer.Textarea
            val targetX = TitleCompiler.layerX(layer)
            val before = currentX
            val outerOffset: Int
            val startX: Int
            if (isTextarea) {
                outerOffset = 0
                startX = currentX
            } else {
                outerOffset = if (targetX != currentX) targetX - currentX else 0
                startX = targetX
            }
            val (frag, newX) = TitleCompiler.compileLayerBody(
                layer, startX, langMap, plugin.assetCatalog::lookup, encoder,
            )
            currentX = newX
            val kindShort = layer.javaClass.simpleName
            out(
                "  sorted[$i] $kindShort targetX=$targetX  " +
                "before=$before  outer-offset=$outerOffset  startX=$startX  " +
                "newX=$newX  inner-offset-sum=${decodeOffsetSum(frag)}px"
            )
        }
        out("─── final cursor=$currentX ───")

        // Last so chat doesn't truncate the cursor walk.
        plugin.logger.info("[dump-title] full Component.toString (length=${raw.length}):")
        plugin.logger.info("[dump-title] $raw")
    }

    private fun handlePushLocal(sender: CommandSender, args: List<String>) {
        val target = args.getOrNull(0) ?: run {
            sender.sendMessage("Usage: /ifz pushLocal <pack_id|--all>")
            return
        }
        val packsDir = java.io.File(plugin.dataFolder, "packs")
        if (!packsDir.exists()) {
            sender.sendMessage("No packs directory found.")
            return
        }
        val packIds = if (target == "--all") {
            packsDir.listFiles { f -> f.isDirectory && !f.name.startsWith(".") }
                ?.map { it.name } ?: emptyList()
        } else {
            listOf(target)
        }
        if (packIds.isEmpty()) {
            sender.sendMessage("No packs found to push.")
            return
        }
        for (packId in packIds) {
            val dir = java.io.File(packsDir, packId)
            if (!dir.isDirectory) {
                sender.sendMessage("Pack '$packId' not found on disk; skipping.")
                continue
            }
            val hash = plugin.menuProvider.pushLocalPack(packId, dir)
            if (hash != null) {
                sender.sendMessage("Pushed pack '$packId' to backend (hash=${hash.take(8)}…).")
            } else {
                sender.sendMessage("Pack '$packId': not connected to backend — push skipped.")
            }
        }
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
