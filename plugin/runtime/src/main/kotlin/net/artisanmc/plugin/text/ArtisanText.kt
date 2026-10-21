package net.artisanmc.plugin.text

import net.artisanmc.modules.api.text.TextApi
import net.kyori.adventure.text.Component
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

    override fun send(to: CommandSender, miniMessage: String) = to.sendMessage(LenientText.parse(miniMessage))

    override fun legacy(miniMessage: String): String = legacy(LenientText.parse(miniMessage))

    override fun plain(miniMessage: String): String = plain.serialize(LenientText.parse(miniMessage))

    override fun fromLegacy(legacy: String): String = LenientText.legacyToMini(legacy)

    fun legacy(component: Component): String = legacy.serialize(component)
}
