package net.artisanmc.plugin.command

import net.artisanmc.plugin.ArtisanPlugin
import net.artisanmc.plugin.config.ConfigWriter
import net.artisanmc.plugin.provider.SyncedMenuProvider
import net.artisanmc.plugin.lang.LangManager
import net.artisanmc.plugin.render.TitleCompiler
import net.artisanmc.plugin.ws.LinkClient
import net.artisanmc.plugin.ws.LinkResult
import org.bukkit.Bukkit
import org.bukkit.command.Command
import org.bukkit.command.CommandExecutor
import org.bukkit.command.CommandSender
import org.bukkit.command.ConsoleCommandSender
import org.bukkit.command.RemoteConsoleCommandSender
import org.bukkit.command.TabCompleter
import org.bukkit.entity.Player

class ArtisanCommand(
    private val plugin: ArtisanPlugin,
    private val lang: LangManager,
) : CommandExecutor, TabCompleter {

    fun shutdown() {
        // Nothing to tear down: `/artisan link` is a one-shot blocking REST call.
    }

    override fun onTabComplete(
        sender: CommandSender, command: Command, label: String, args: Array<out String>
    ): List<String> {
        return when {
            args.size == 1 -> (listOf("menu", "reload", "sync", "link", "editor", "dump-title") +
                if (sender is ConsoleCommandSender || sender is RemoteConsoleCommandSender) listOf("member") else emptyList())
                .filter { it.startsWith(args[0].lowercase()) }
            args.size == 2 && args[0].equals("member", ignoreCase = true) && (sender is ConsoleCommandSender || sender is RemoteConsoleCommandSender) ->
                listOf("add").filter { it.startsWith(args[1].lowercase()) }
            args.size == 2 && args[0].equals("menu", ignoreCase = true) ->
                plugin.menuProvider.listMenuIds().filter { it.startsWith(args[1]) }
            args.size == 2 && args[0].equals("dump-title", ignoreCase = true) ->
                plugin.menuProvider.listMenuIds().filter { it.startsWith(args[1]) }
            args.size == 2 && args[0].equals("sync", ignoreCase = true) ->
                listOf("status", "reject").filter { it.startsWith(args[1].lowercase()) }
            else -> emptyList()
        }
    }

    override fun onCommand(sender: CommandSender, command: Command, label: String, args: Array<out String>): Boolean {
        when (args.getOrNull(0)?.lowercase()) {
            "menu" -> {
                if (sender !is Player) { sender.sendMessage(lang.get("artisan.in_game_only", sender)); return true }
                val menuId = args.getOrNull(1) ?: run { sender.sendMessage(lang.get("artisan.usage_menu", sender)); return true }
                plugin.menuProvider.openMenu(sender, menuId, lang.playerLang(sender))
            }
            "reload" -> {
                // Re-read disk config + re-init LangManager so options like
                // `per_player_language` and `language` pick up changes without
                // needing a full server restart. Then reload the menu provider
                // so disk-side YAML edits are picked up too.
                plugin.reinit(plugin.loadPluginConfig())
                plugin.menuProvider.unload()
                plugin.menuProvider.load()
                sender.sendMessage(lang.get("artisan.reloaded", sender))
            }
            "sync" -> {
                when (args.getOrNull(1)?.lowercase()) {
                    "status" -> sender.sendMessage(lang.get("artisan.sync_status", sender))
                    "reject" -> {
                        plugin.menuProvider.unload()
                        plugin.menuProvider.load()
                        sender.sendMessage(lang.get("artisan.sync_reconnecting", sender))
                    }
                    else -> sender.sendMessage(lang.get("artisan.usage_sync", sender))
                }
            }
            "link" -> link(sender, args.getOrNull(1)?.uppercase())
            "editor" -> editor(sender)
            "member" -> member(sender, args)
            "dump-title" -> {
                val menuId = args.getOrNull(1) ?: run {
                    sender.sendMessage("Usage: /artisan dump-title <menu_id> [lang]")
                    return true
                }
                dumpTitle(sender, menuId, args.getOrNull(2))
            }
            else -> sender.sendMessage(lang.get("artisan.usage_main", sender))
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
        val resolvedLang = langOverride ?: plugin.currentConfig().language
        val langMap = menu.langMapWithFallback(resolvedLang)
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
            defaultLang = menu.defaultLang,
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
                is net.artisanmc.plugin.model.MenuTitleLayer.Text,
                is net.artisanmc.plugin.model.MenuTitleLayer.Textarea -> 1
                else -> 0
            }
        })
        var currentX = TitleCompiler.TITLE_LABEL_X
        for ((i, layer) in sorted.withIndex()) {
            val isTextarea = layer is net.artisanmc.plugin.model.MenuTitleLayer.Textarea
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
                lang = resolvedLang, defaultLang = menu.defaultLang,
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

    private fun editor(sender: CommandSender) {
        val cfg = plugin.currentConfig()
        val senderLang = lang.playerLang(sender)
        if (cfg.editorConsoleOnly && sender !is ConsoleCommandSender) {
            sender.sendMessage(lang.get("artisan.editor_console_only", senderLang))
            return
        }
        if (!sender.hasPermission("artisan.editor")) {
            sender.sendMessage(lang.get("artisan.editor_no_permission", senderLang))
            return
        }
        val info = plugin.menuProvider.editorInfo()
        when {
            info != null -> {
                // Linked and connected to backend
                val (url, networkName) = info
                sender.sendMessage(lang.get("artisan.editor_linked", senderLang, "network" to networkName, "url" to url))
            }
            cfg.serverKey.isEmpty() -> {
                // Not linked: point at the editor home so the admin can add the
                // server there, which prints a code for `/artisan link <code>`.
                val home = cfg.editorHomeUrl.ifEmpty { "https://editor.artisanmc.net" }
                sender.sendMessage(lang.get("artisan.editor_not_linked", senderLang, "url" to home))
            }
            else -> {
                // Linked but not yet connected to backend (e.g., backend down at boot).
                sender.sendMessage(lang.get("artisan.editor_connecting", senderLang))
            }
        }
    }

    private fun member(sender: CommandSender, args: Array<out String>) {
        if (sender !is ConsoleCommandSender && sender !is RemoteConsoleCommandSender) {
            sender.sendMessage(lang.get("artisan.member_console_only", sender))
            return
        }
        if (plugin.currentConfig().editorAccessMode != "console") {
            sender.sendMessage(lang.get("artisan.member_console_disabled", sender))
            return
        }
        if (args.size != 3 || !args[1].equals("add", ignoreCase = true)) {
            sender.sendMessage(lang.get("artisan.member_usage", sender))
            return
        }
        val email = args[2]
        if (email.length > 254 || !Regex("[^\\s@]+@[^\\s@]+\\.[^\\s@]+").matches(email)) {
            sender.sendMessage(lang.get("artisan.member_invalid_email", sender))
            return
        }
        val provider = plugin.menuProvider as? SyncedMenuProvider
        if (provider == null) {
            sender.sendMessage(lang.get("artisan.member_offline", sender))
            return
        }
        sender.sendMessage(lang.get("artisan.member_sending", sender))
        provider.addMember(email).whenComplete { result, _ ->
            if (plugin.isEnabled) plugin.scheduler.global {
                val status = result?.takeIf { it in setOf("added", "already_member", "console_disabled", "invalid_email", "account_not_found", "offline", "timeout") } ?: "failed"
                sender.sendMessage(lang.get("artisan.member_$status", sender))
            }
        }
    }

    /**
     * Redeem a link code minted by the editor when the Server was added, writing
     * the returned secret to environment.yml and reconnecting. Running this on an
     * already-linked server **overwrites** the key (rotation / re-link) — the code
     * is explicit intent, so we proceed with a WARN rather than block.
     */
    private fun link(sender: CommandSender, code: String?) {
        val cfg = plugin.currentConfig()
        val senderLang = lang.playerLang(sender)
        if (code.isNullOrBlank()) {
            sender.sendMessage(lang.get("artisan.link_usage", senderLang))
            return
        }
        if (cfg.httpBaseUrl.isEmpty()) {
            sender.sendMessage(lang.get("artisan.link_ws_missing", senderLang))
            return
        }
        if (cfg.serverKey.isNotEmpty()) {
            plugin.logger.warning("[link] Server already linked — /artisan link overwrites the existing key.")
        }
        sender.sendMessage(lang.get("artisan.link_connecting", senderLang))
        val environmentFile = plugin.environmentFile
        val client = LinkClient(cfg.httpBaseUrl)
        // Blocking REST call off the main thread; hop back for config + reinit.
        plugin.scheduler.async {
            val result = client.redeem(code)
            plugin.scheduler.global {
                when (result) {
                    is LinkResult.Success -> {
                        ConfigWriter.writeServerKey(environmentFile, result.serverKey)
                        plugin.logger.info("Server linked (server_key written to environment.yml)")
                        sender.sendMessage(lang.get("artisan.link_linked", senderLang))
                        plugin.reinit(plugin.loadPluginConfig())
                        sender.sendMessage(lang.get("artisan.link_ready", senderLang))
                    }
                    is LinkResult.Failure -> {
                        plugin.logger.warning("[link] redeem failed: ${result.reason}")
                        sender.sendMessage(lang.get("artisan.link_failed", senderLang, "reason" to result.reason))
                    }
                }
            }
        }
    }
}
