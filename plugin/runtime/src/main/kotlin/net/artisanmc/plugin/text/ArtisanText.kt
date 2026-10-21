package net.artisanmc.plugin.text

import net.artisanmc.modules.api.text.TextApi
import net.artisanmc.plugin.platform.ServerPlatform
import net.kyori.adventure.text.Component
import net.kyori.adventure.text.serializer.gson.GsonComponentSerializer
import net.kyori.adventure.text.serializer.legacy.LegacyComponentSerializer
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer
import org.bukkit.command.CommandSender

/** `api.text`: MiniMessage in, sent or turned into a String for Bukkit's String methods. */
object ArtisanText : TextApi {
    /** `§x§r§r§g§g§b§b` for a hex color: the form Spigot's String methods read. */
    private val legacy = LegacyComponentSerializer.builder()
        .character(LegacyComponentSerializer.SECTION_CHAR)
        .hexColors()
        .useUnusualXRepeatedCharacterHexFormat()
        .build()
    private val plain = PlainTextComponentSerializer.plainText()

    override fun send(to: CommandSender, miniMessage: String) {
        val component = LenientText.parse(miniMessage)
        if (ServerPlatform.paper) to.sendMessage(component) else SpigotChat.send(to, component)
    }

    override fun legacy(miniMessage: String): String = legacy(LenientText.parse(miniMessage))

    override fun plain(miniMessage: String): String = plain.serialize(LenientText.parse(miniMessage))

    override fun fromLegacy(legacy: String): String = LenientText.legacyToMini(legacy)

    fun legacy(component: Component): String = legacy.serialize(component)
}

/**
 * Chat on Spigot, which has no Adventure: the component crosses as JSON into the BungeeCord chat
 * API Spigot ships, so colors, translations, hover and click survive (a `§` string would lose
 * the last three).
 */
@Suppress("DEPRECATION") // BungeeCord chat: deprecated on Paper, the only rich chat API on Spigot
internal object SpigotChat {
    private val gson = GsonComponentSerializer.gson()

    fun send(to: CommandSender, component: Component) {
        val parts = runCatching { net.md_5.bungee.chat.ComponentSerializer.parse(gson.serialize(component)) }.getOrNull()
        if (parts != null) to.spigot().sendMessage(*parts) else to.sendMessage(ArtisanText.legacy(component))
    }
}
