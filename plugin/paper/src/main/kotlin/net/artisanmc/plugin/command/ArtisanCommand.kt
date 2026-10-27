package net.artisanmc.plugin.command

import net.artisanmc.plugin.ArtisanPlugin
import net.artisanmc.plugin.hub.EditorPermissions
import net.artisanmc.plugin.hub.Sessions
import net.artisanmc.plugin.platform.ServerPlatform
import net.artisanmc.plugin.provider.SyncedMenuProvider
import net.artisanmc.plugin.lang.LangManager
import net.artisanmc.plugin.render.title.TitleCompiler
import org.bukkit.command.Command
import org.bukkit.command.CommandExecutor
import org.bukkit.command.CommandSender
import org.bukkit.command.TabCompleter
import org.bukkit.entity.Player
import java.util.UUID
import net.artisanmc.plugin.platform.Chat

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
                listOf("logout", "sessions", "revoke").filter { it.startsWith(args[1].lowercase()) }
            args.size == 3 && args[0].equals("editor", ignoreCase = true) && args[1].equals("logout", ignoreCase = true) && sender.hasPermission("artisan.admin") ->
                plugin.server.onlinePlayers.map { it.name }.filter { it.startsWith(args[2], ignoreCase = true) }
            else -> emptyList()
        }
    }

    override fun onCommand(sender: CommandSender, command: Command, label: String, args: Array<out String>): Boolean {
        val permission = PERMISSIONS[args.getOrNull(0)?.lowercase()]
        if (permission != null && !sender.hasPermission(permission)) {
            Chat.send(sender, lang.get("cmd.no_permission", sender))
            return true
        }
        when (args.getOrNull(0)?.lowercase()) {
            "menu" -> {
                if (sender !is Player) { Chat.send(sender, lang.get("artisan.in_game_only", sender)); return true }
                val menuId = args.getOrNull(1) ?: run { Chat.send(sender, lang.get("artisan.usage_menu", sender)); return true }
                plugin.menuProvider.openMenu(sender, menuId, lang.playerLang(sender))
            }
            "reload" -> {
                // Re-read disk config + reconfigure the translations so options like
                // `per_player_language` and `language` pick up changes without
                // needing a full server restart. reinit() rebuilds the provider and
                // loads it: the disk-side YAML edits are read there, once.
                plugin.reinit(plugin.loadPluginConfig())
                Chat.send(sender, lang.get("artisan.reloaded", sender))
            }
            "sync" -> {
                when (args.getOrNull(1)?.lowercase()) {
                    "status" -> Chat.send(sender, lang.get("artisan.sync_status", sender))
                    "reject" -> {
                        plugin.menuProvider.unload()
                        plugin.menuProvider.load()
                        Chat.send(sender, lang.get("artisan.sync_reconnecting", sender))
                    }
                    else -> Chat.send(sender, lang.get("artisan.usage_sync", sender))
                }
            }
            "editor" -> when (args.getOrNull(1)?.lowercase()) {
                null -> editor(sender)
                "logout" -> logout(sender, args.getOrNull(2))
                "sessions" -> sessions(sender)
                "revoke" -> args.getOrNull(2)?.let { revoke(sender, it) } ?: Chat.send(sender, lang.get("artisan.usage_editor", sender))
                else -> Chat.send(sender, lang.get("artisan.usage_editor", sender))
            }
            "dump-title" -> {
                val menuId = args.getOrNull(1) ?: run {
                    sender.sendMessage("Usage: /artisan dump-title <menu_id> [lang]")
                    return true
                }
                dumpTitle(sender, menuId, args.getOrNull(2))
            }
            else -> Chat.send(sender, lang.get("artisan.usage_main", sender))
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
        val editor = plugin.editor ?: return Chat.send(sender, lang.get("artisan.editor_disabled", senderLang))
        editorLink(sender, senderLang, editor.port ?: cfg.web.port)
    }

    /** Closes every editor session of a player: oneself, or anyone with `artisan.admin`. */
    private fun logout(sender: CommandSender, name: String?) {
        val senderLang = lang.playerLang(sender)
        if (name != null && !sender.hasPermission("artisan.admin")) return Chat.send(sender, lang.get("cmd.no_permission", sender))
        val (targetId, playerName) = when {
            name.equals(CONSOLE_NAME, ignoreCase = true) -> CONSOLE_ID to CONSOLE_NAME
            name != null -> (plugin.server.getPlayerExact(name) ?: ServerPlatform.cachedOfflinePlayer(plugin.server, name))
                ?.let { it.uniqueId to (it.name ?: name) }
                ?: return Chat.send(sender, lang.get("artisan.editor_unknown_player", senderLang, "player" to name))
            else -> identity(sender)
        }
        fun done(count: Int?) = Chat.send(
            sender,
            if (count == null) lang.get("artisan.editor_hub_offline", senderLang)
            else lang.get("artisan.editor_logged_out", senderLang, "count" to count.toString(), "player" to playerName),
        )
        val cfg = plugin.currentConfig()
        if (!(cfg.web.enabled && cfg.web.leaf)) {
            if (plugin.editor == null) return Chat.send(sender, lang.get("artisan.editor_disabled", senderLang))
            // The stored sessions are deleted and counted in the database: off the main thread.
            plugin.scheduler.async {
                val closed = plugin.editorSessions.closeAll(targetId)
                if (plugin.isEnabled) plugin.scheduler.global { done(closed) }
            }
            return
        }
        val provider = plugin.menuProvider as? SyncedMenuProvider ?: return done(null)
        provider.requestEditorLogout(targetId).whenComplete { reply, _ ->
            if (!plugin.isEnabled) return@whenComplete
            plugin.scheduler.global { done(reply?.takeIf { it.path("ok").asBoolean() }?.path("closed")?.asInt()) }
        }
    }

    /** A session as the command lists it, from this server's [Sessions] or the hub's reply. */
    private data class Listed(val id: String, val player: String, val permissions: Collection<String>, val server: String, val lastActiveAt: java.time.Instant, val online: Boolean)

    /** The open editor sessions of every server of the database, each with a click to close it. */
    private fun sessions(sender: CommandSender) {
        val senderLang = lang.playerLang(sender)
        if (!sender.hasPermission(EditorPermissions.CONFIG)) return Chat.send(sender, lang.get("cmd.no_permission", sender))
        fun show(listed: List<Listed>?) {
            if (listed == null) return Chat.send(sender, lang.get("artisan.editor_hub_offline", senderLang))
            if (listed.isEmpty()) return Chat.send(sender, lang.get("artisan.editor_sessions_empty", senderLang))
            Chat.send(sender, lang.get("artisan.editor_sessions_header", senderLang, "count" to listed.size.toString()))
            val now = java.time.Instant.now()
            for (s in listed) {
                val idle = java.time.Duration.between(s.lastActiveAt, now)
                val active = when {
                    idle.toHours() < 1 -> lang.getRaw("artisan.editor_session_active_recent", sender)
                    idle.toDays() < 1 -> lang.getRaw("artisan.editor_session_active_hours", sender, "hours" to idle.toHours().toString())
                    else -> lang.getRaw("artisan.editor_session_active_days", sender, "days" to idle.toDays().toString())
                }
                Chat.send(sender, lang.get(
                    if (s.online) "artisan.editor_session_line_online" else "artisan.editor_session_line", senderLang,
                    "player" to s.player, "server" to s.server.ifEmpty { "?" }, "active" to active,
                    "rights" to EditorPermissions.ALL.filter { it in s.permissions }.joinToString(", ") { it.removePrefix("artisan.editor.") },
                    "id" to s.id.take(SHOWN_ID),
                ))
            }
        }
        val cfg = plugin.currentConfig()
        if (!(cfg.web.enabled && cfg.web.leaf)) {
            val editor = plugin.editor ?: return Chat.send(sender, lang.get("artisan.editor_disabled", senderLang))
            // The stored sessions are read from the database: off the main thread.
            plugin.scheduler.async {
                val online = plugin.editorHost.editorChannel.online()
                val labels = plugin.editorHost.serverLabels()
                val listed = plugin.editorSessions.list().map {
                    Listed(it.id, it.playerName, it.permissions, labels[it.origin] ?: it.origin, it.lastActiveAt, it.id in online)
                }
                if (plugin.isEnabled && editor === plugin.editor) plugin.scheduler.global { show(listed) }
            }
            return
        }
        val provider = plugin.menuProvider as? SyncedMenuProvider ?: return show(null)
        provider.requestEditorSessions().whenComplete { reply, _ ->
            if (!plugin.isEnabled) return@whenComplete
            val listed = reply?.takeIf { it.path("ok").asBoolean() }?.path("sessions")?.mapNotNull { s ->
                val at = runCatching { java.time.Instant.parse(s.path("last_active_at").asText()) }.getOrNull() ?: return@mapNotNull null
                Listed(s.path("id").asText(), s.path("player_name").asText(), s.path("permissions").map { it.asText() }, s.path("server").asText(), at, s.path("online").asBoolean())
            }
            plugin.scheduler.global { show(listed) }
        }
    }

    /** Closes the one session whose id starts with [id], as `/artisan editor sessions` shows it. */
    private fun revoke(sender: CommandSender, id: String) {
        val senderLang = lang.playerLang(sender)
        if (!sender.hasPermission(EditorPermissions.CONFIG)) return Chat.send(sender, lang.get("cmd.no_permission", sender))
        fun done(revoked: Boolean?) = Chat.send(sender, when (revoked) {
            null -> lang.get("artisan.editor_hub_offline", senderLang)
            true -> lang.get("artisan.editor_session_revoked", senderLang)
            false -> lang.get("artisan.editor_session_not_found", senderLang, "id" to id)
        })
        val cfg = plugin.currentConfig()
        if (!(cfg.web.enabled && cfg.web.leaf)) {
            if (plugin.editor == null) return Chat.send(sender, lang.get("artisan.editor_disabled", senderLang))
            plugin.scheduler.async {
                val revoked = plugin.editorSessions.revoke(id.lowercase())
                if (plugin.isEnabled) plugin.scheduler.global { done(revoked) }
            }
            return
        }
        val provider = plugin.menuProvider as? SyncedMenuProvider ?: return done(null)
        provider.requestEditorRevoke(id.lowercase()).whenComplete { reply, _ ->
            if (!plugin.isEnabled) return@whenComplete
            plugin.scheduler.global { done(reply?.takeIf { it.path("ok").asBoolean() }?.path("revoked")?.asBoolean()) }
        }
    }

    /** Who the editor signs in: the player who asked, or the one shared Console identity. */
    private fun identity(sender: CommandSender): Pair<UUID, String> =
        if (sender is Player) sender.uniqueId to sender.name else CONSOLE_ID to CONSOLE_NAME

    /** A console has no clickable chat: it gets the address itself. */
    private fun sendLink(sender: CommandSender, senderLang: String, url: String) =
        Chat.send(sender, lang.get(if (sender is Player) "artisan.editor_link" else "artisan.editor_link_console", senderLang, "url" to url))

    /** A single-use link for the sender's [identity]. */
    private fun editorLink(sender: CommandSender, senderLang: String, port: Int) {
        val permissions = EditorPermissions.ALL.filter(sender::hasPermission).toSet()
        if (EditorPermissions.VIEW !in permissions) {
            Chat.send(sender, lang.get("artisan.editor_no_permission", senderLang))
            return
        }
        val (id, name) = identity(sender)
        when (val link = plugin.editorSessions.issueLink(id, name, permissions, plugin.serverUuid)) {
            is Sessions.LinkResult.Issued -> {
                val host = (sender as? Player)?.let(ServerPlatform::virtualHost) ?: plugin.server.ip.ifBlank { "localhost" }
                val base = plugin.editorUrl.ifEmpty { "http://$host:$port" }
                sendLink(sender, senderLang, "$base/login/${link.token}")
            }
            is Sessions.LinkResult.TooSoon ->
                Chat.send(sender, lang.get("artisan.editor_link_too_soon", senderLang, "seconds" to link.retryAfter.seconds.coerceAtLeast(1).toString()))
        }
    }

    /** On a leaf, the hub issues the link, with the permissions this server read for the player. */
    private fun hubLink(sender: CommandSender, senderLang: String) {
        val permissions = EditorPermissions.ALL.filter(sender::hasPermission).toSet()
        if (EditorPermissions.VIEW !in permissions) {
            Chat.send(sender, lang.get("artisan.editor_no_permission", senderLang))
            return
        }
        val provider = plugin.menuProvider as? SyncedMenuProvider
            ?: return Chat.send(sender, lang.get("artisan.editor_hub_offline", senderLang))
        val (id, name) = identity(sender)
        provider.requestEditorLink(id, name, permissions, (sender as? Player)?.let(ServerPlatform::virtualHost)).whenComplete { reply, _ ->
            if (!plugin.isEnabled) return@whenComplete
            plugin.scheduler.global {
                val message = when {
                    reply == null -> lang.get("artisan.editor_hub_offline", senderLang)
                    reply.path("ok").asBoolean() -> return@global sendLink(sender, senderLang, reply.path("url").asText())
                    reply.path("error").asText() == "too_soon" ->
                        lang.get("artisan.editor_link_too_soon", senderLang, "seconds" to reply.path("retry_after").asText("60"))
                    else -> lang.get("artisan.editor_hub_offline", senderLang)
                }
                Chat.send(sender, message)
            }
        }
    }

    companion object {
        /** The editor identity of the console, shared by whoever runs it: one set of drafts, one author name. */
        val CONSOLE_ID: UUID = UUID(0L, 0L)
        /** How much of a session id `/artisan editor sessions` shows, and its click types back. */
        private const val SHOWN_ID = 12
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
