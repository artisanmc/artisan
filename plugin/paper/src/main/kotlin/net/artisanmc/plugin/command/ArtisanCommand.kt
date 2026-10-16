package net.artisanmc.plugin.command

import net.artisanmc.plugin.ArtisanPlugin
import net.artisanmc.plugin.hub.EditorPermissions
import net.artisanmc.plugin.hub.Sessions
import net.artisanmc.plugin.provider.SyncedMenuProvider
import net.artisanmc.plugin.lang.LangManager
import net.artisanmc.plugin.render.title.TitleCompiler
import org.bukkit.command.Command
import org.bukkit.command.CommandExecutor
import org.bukkit.command.CommandSender
import org.bukkit.command.TabCompleter
import org.bukkit.entity.Player
import java.util.UUID

class ArtisanCommand(
    private val plugin: ArtisanPlugin,
    private val lang: LangManager,
) : CommandExecutor, TabCompleter {

    override fun onTabComplete(
        sender: CommandSender, command: Command, label: String, args: Array<out String>
    ): List<String> {
        return when {
            args.size == 1 -> listOf("menu", "reload", "sync", "editor", "dump-title")
                .filter { it.startsWith(args[0].lowercase()) && PERMISSIONS[it]?.let(sender::hasPermission) != false }
            args.size == 2 && args[0].equals("menu", ignoreCase = true) ->
                plugin.menuProvider.listMenuIds().filter { it.startsWith(args[1]) }
            args.size == 2 && args[0].equals("dump-title", ignoreCase = true) ->
                plugin.menuProvider.listMenuIds().filter { it.startsWith(args[1]) }
            args.size == 2 && args[0].equals("sync", ignoreCase = true) ->
                listOf("status", "reject").filter { it.startsWith(args[1].lowercase()) }
            args.size == 2 && args[0].equals("editor", ignoreCase = true) ->
                listOf("logout").filter { it.startsWith(args[1].lowercase()) }
            args.size == 3 && args[0].equals("editor", ignoreCase = true) && sender.hasPermission("artisan.admin") ->
                plugin.server.onlinePlayers.map { it.name }.filter { it.startsWith(args[2], ignoreCase = true) }
            else -> emptyList()
        }
    }

    override fun onCommand(sender: CommandSender, command: Command, label: String, args: Array<out String>): Boolean {
        val permission = PERMISSIONS[args.getOrNull(0)?.lowercase()]
        if (permission != null && !sender.hasPermission(permission)) {
            sender.sendMessage(lang.get("cmd.no_permission", sender))
            return true
        }
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
            "editor" -> when (args.getOrNull(1)?.lowercase()) {
                null -> editor(sender)
                "logout" -> logout(sender, args.getOrNull(2))
                else -> sender.sendMessage(lang.get("artisan.usage_editor", sender))
            }
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
        if (cfg.web.enabled && cfg.web.leaf) return hubLink(sender, senderLang)
        val editor = plugin.editor ?: return sender.sendMessage(lang.get("artisan.editor_disabled", senderLang))
        editorLink(sender, senderLang, editor.port ?: cfg.web.port)
    }

    /** Closes every editor session of a player: oneself, or anyone with `artisan.admin`. */
    private fun logout(sender: CommandSender, name: String?) {
        val senderLang = lang.playerLang(sender)
        if (name != null && !sender.hasPermission("artisan.admin")) return sender.sendMessage(lang.get("cmd.no_permission", sender))
        val (targetId, playerName) = when {
            name.equals(CONSOLE_NAME, ignoreCase = true) -> CONSOLE_ID to CONSOLE_NAME
            name != null -> (plugin.server.getPlayerExact(name) ?: plugin.server.getOfflinePlayerIfCached(name))
                ?.let { it.uniqueId to (it.name ?: name) }
                ?: return sender.sendMessage(lang.get("artisan.editor_unknown_player", senderLang, "player" to name))
            else -> identity(sender)
        }
        fun done(count: Int?) = sender.sendMessage(
            if (count == null) lang.get("artisan.editor_hub_offline", senderLang)
            else lang.get("artisan.editor_logged_out", senderLang, "count" to count.toString(), "player" to playerName),
        )
        val cfg = plugin.currentConfig()
        if (!(cfg.web.enabled && cfg.web.leaf)) {
            if (plugin.editor == null) return sender.sendMessage(lang.get("artisan.editor_disabled", senderLang))
            return done(plugin.editorSessions.closeAll(targetId))
        }
        val provider = plugin.menuProvider as? SyncedMenuProvider ?: return done(null)
        provider.requestEditorLogout(targetId).whenComplete { reply, _ ->
            if (!plugin.isEnabled) return@whenComplete
            plugin.scheduler.global { done(reply?.takeIf { it.path("ok").asBoolean() }?.path("closed")?.asInt()) }
        }
    }

    /** Who the editor signs in: the player who asked, or the one shared Console identity. */
    private fun identity(sender: CommandSender): Pair<UUID, String> =
        if (sender is Player) sender.uniqueId to sender.name else CONSOLE_ID to CONSOLE_NAME

    /** A console has no clickable chat: it gets the address itself. */
    private fun sendLink(sender: CommandSender, senderLang: String, url: String) =
        sender.sendMessage(lang.get(if (sender is Player) "artisan.editor_link" else "artisan.editor_link_console", senderLang, "url" to url))

    /** A single-use link for the sender's [identity]. */
    private fun editorLink(sender: CommandSender, senderLang: String, port: Int) {
        val permissions = EditorPermissions.ALL.filter(sender::hasPermission).toSet()
        if (EditorPermissions.VIEW !in permissions) {
            sender.sendMessage(lang.get("artisan.editor_no_permission", senderLang))
            return
        }
        val (id, name) = identity(sender)
        when (val link = plugin.editorSessions.issueLink(id, name, permissions, plugin.serverUuid)) {
            is Sessions.LinkResult.Issued -> {
                val host = (sender as? Player)?.virtualHost?.hostString ?: plugin.server.ip.ifBlank { "localhost" }
                val base = plugin.editorUrl.ifEmpty { "http://$host:$port" }
                sendLink(sender, senderLang, "$base/login/${link.token}")
            }
            is Sessions.LinkResult.TooSoon ->
                sender.sendMessage(lang.get("artisan.editor_link_too_soon", senderLang, "seconds" to link.retryAfter.seconds.coerceAtLeast(1).toString()))
        }
    }

    /** On a leaf, the hub issues the link, with the permissions this server read for the player. */
    private fun hubLink(sender: CommandSender, senderLang: String) {
        val permissions = EditorPermissions.ALL.filter(sender::hasPermission).toSet()
        if (EditorPermissions.VIEW !in permissions) {
            sender.sendMessage(lang.get("artisan.editor_no_permission", senderLang))
            return
        }
        val provider = plugin.menuProvider as? SyncedMenuProvider
            ?: return sender.sendMessage(lang.get("artisan.editor_hub_offline", senderLang))
        val (id, name) = identity(sender)
        provider.requestEditorLink(id, name, permissions, (sender as? Player)?.virtualHost?.hostString).whenComplete { reply, _ ->
            if (!plugin.isEnabled) return@whenComplete
            plugin.scheduler.global {
                val message = when {
                    reply == null -> lang.get("artisan.editor_hub_offline", senderLang)
                    reply.path("ok").asBoolean() -> return@global sendLink(sender, senderLang, reply.path("url").asText())
                    reply.path("error").asText() == "too_soon" ->
                        lang.get("artisan.editor_link_too_soon", senderLang, "seconds" to reply.path("retry_after").asText("60"))
                    else -> lang.get("artisan.editor_hub_offline", senderLang)
                }
                sender.sendMessage(message)
            }
        }
    }

    companion object {
        /** The editor identity of the console, shared by whoever runs it: one set of drafts, one author name. */
        val CONSOLE_ID: UUID = UUID(0L, 0L)
        const val CONSOLE_NAME = "Console"

        /** `editor` checks its own rights, finer grained. */
        private val PERMISSIONS = mapOf(
            "menu" to "artisan.menu",
            "reload" to "artisan.admin",
            "sync" to "artisan.admin",
            "dump-title" to "artisan.admin",
        )
    }
}
