package net.artisanmc.plugin.platform

import net.artisanmc.plugin.text.ArtisanText
import net.kyori.adventure.text.Component
import net.kyori.adventure.text.serializer.gson.GsonComponentSerializer
import net.kyori.adventure.text.serializer.legacy.LegacyComponentSerializer
import net.kyori.adventure.title.Title
import org.bukkit.Bukkit
import org.bukkit.command.CommandSender
import org.bukkit.entity.Player
import org.bukkit.inventory.meta.ItemMeta

/**
 * Components to players, on Paper and Spigot. Artisan bundles Adventure, so a [Component] exists
 * on both; only Paper has the Bukkit methods that take one. On Paper each call is Paper's own; on
 * Spigot chat crosses as JSON into the BungeeCord chat API Spigot ships (colors, translations,
 * hover and click survive), titles and item texts as `§` strings (fonts, hover and click do not).
 */
@Suppress("DEPRECATION") // the String and BungeeCord methods are deprecated on Paper, the only ones on Spigot
object Chat {
    private val gson = GsonComponentSerializer.gson()

    fun send(to: CommandSender, message: Component) {
        if (ServerPlatform.paper) return to.sendMessage(message)
        val parts = runCatching { net.md_5.bungee.chat.ComponentSerializer.parse(gson.serialize(message)) }.getOrNull()
        if (parts != null) to.spigot().sendMessage(*parts) else to.sendMessage(ArtisanText.legacy(message))
    }

    /** Every online player and the console, as Paper's `Server.broadcast`. */
    fun broadcast(message: Component) {
        if (ServerPlatform.paper) {
            Bukkit.getServer().broadcast(message)
            return
        }
        Bukkit.getOnlinePlayers().forEach { send(it, message) }
        send(Bukkit.getConsoleSender(), message)
    }

    fun title(player: Player, title: Title) {
        if (ServerPlatform.paper) return player.showTitle(title)
        val times = title.times()
        fun ticks(d: java.time.Duration?, default: Int) = d?.let { (it.toMillis() / 50).toInt() } ?: default
        player.sendTitle(
            ArtisanText.legacy(title.title()), ArtisanText.legacy(title.subtitle()),
            ticks(times?.fadeIn(), 10), ticks(times?.stay(), 70), ticks(times?.fadeOut(), 20),
        )
    }
}

/** An item's custom name and lore as components, on Paper and Spigot (see [Chat]). */
@Suppress("DEPRECATION")
object ItemTexts {
    private val legacy = LegacyComponentSerializer.builder()
        .character(LegacyComponentSerializer.SECTION_CHAR).hexColors().useUnusualXRepeatedCharacterHexFormat().build()

    fun name(meta: ItemMeta): Component? = when {
        ServerPlatform.paper -> meta.displayName()
        meta.hasDisplayName() -> legacy.deserialize(meta.displayName)
        else -> null
    }

    fun setName(meta: ItemMeta, name: Component?) {
        if (ServerPlatform.paper) meta.displayName(name) else meta.setDisplayName(name?.let(ArtisanText::legacy))
    }

    fun lore(meta: ItemMeta): List<Component>? = when {
        ServerPlatform.paper -> meta.lore()
        meta.hasLore() -> meta.lore?.map(legacy::deserialize)
        else -> null
    }

    fun setLore(meta: ItemMeta, lore: List<Component>?) {
        if (ServerPlatform.paper) meta.lore(lore) else meta.lore = lore?.map(ArtisanText::legacy)
    }
}
