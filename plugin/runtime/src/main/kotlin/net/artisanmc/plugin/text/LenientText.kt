package net.artisanmc.plugin.text

import net.kyori.adventure.text.Component
import net.kyori.adventure.text.format.NamedTextColor
import net.kyori.adventure.text.format.Style
import net.kyori.adventure.text.format.TextDecoration
import net.kyori.adventure.text.minimessage.MiniMessage
import net.kyori.adventure.text.serializer.legacy.LegacyComponentSerializer

/**
 * Lenient user-text parsing. MiniMessage hard-rejects legacy `§` codes
 * (ParsingException), and one `§7` in a title/lore/message used to cancel the
 * whole render or click event. Migrated prod data (and admins' muscle memory)
 * is full of them, so: legacy codes are converted to their MiniMessage
 * equivalent before parsing, and any remaining parse failure degrades to plain text.
 * One WARN-free silent path — rendering something always beats a stacktrace.
 */
object LenientText {
    private val mm = MiniMessage.miniMessage()
    private val legacy = LegacyComponentSerializer.legacySection()
    private val noItalic = Style.style(TextDecoration.ITALIC.withState(false))

    /** Convert `§`-coded text to equivalent MiniMessage tags; identity without `§`. */
    fun legacyToMini(text: String): String =
        if (text.indexOf('§') < 0) text else mm.serialize(legacy.deserialize(text))

    /** Parse user text into a Component. Never throws. */
    fun parse(text: String): Component =
        runCatching { mm.deserialize(legacyToMini(text)) }
            .getOrElse {
                runCatching { legacy.deserialize(text) }.getOrElse { Component.text(text) }
            }

    /** An item's name as Artisan shows it everywhere: not italic unless the text asks for it. */
    fun itemName(text: String): Component = parse(text).applyFallbackStyle(noItalic)

    /**
     * A lore line as Artisan shows it everywhere (menus, given items): white and not
     * italic unless the text says otherwise, where Minecraft would draw it purple and italic.
     */
    fun loreLine(text: String): Component = itemName(text).colorIfAbsent(NamedTextColor.WHITE)
}
