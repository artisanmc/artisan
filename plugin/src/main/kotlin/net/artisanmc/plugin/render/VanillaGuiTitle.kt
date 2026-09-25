package net.artisanmc.plugin.render

import net.kyori.adventure.key.Key
import net.kyori.adventure.text.Component
import net.kyori.adventure.text.format.NamedTextColor
import java.util.UUID

/**
 * Vanilla chest texture drawn through the window title.
 *
 * When a menu turns `vanilla_texture` off, the pack makes generic_54.png
 * transparent for every chest window. Each other chest window gets the texture
 * back as a glyph prepended to its OPEN_WINDOW title (font
 * `artisan:vanilla_gui`, built by the backend's vanillaGui.ts): U+E010 moves
 * the pen from the title origin to x=0, U+E000+rows draws the window, and
 * U+E010+rows walks back to the title origin so the real title is unchanged.
 */
object VanillaGuiTitle {
    val FONT: Key = Key.key("artisan", "vanilla_gui")

    /** Protocol menu types `generic_9x1..9x6` are registry ids 0..5. */
    fun rowsForWindowType(windowType: Int): Int? = if (windowType in 0..5) windowType + 1 else null

    fun prefix(rows: Int): Component =
        Component.text("${(0xE000 + rows).toChar()}${(0xE010 + rows).toChar()}")
            .font(FONT)
            .color(NamedTextColor.WHITE)

    fun decorate(title: Component, rows: Int): Component = Component.text().append(prefix(rows), title).build()

    /**
     * Which OPEN_WINDOW titles get the texture: chest windows of players whose
     * loaded pack makes chests transparent ([active]), except Artisan menus
     * that turned their vanilla texture off.
     */
    class Rule(private val windows: MenuWindows, private val active: (UUID) -> Boolean) {
        fun rowsToDecorate(playerId: UUID, containerId: Int, windowType: Int): Int? {
            val rows = rowsForWindowType(windowType) ?: return null
            if (!active(playerId)) return null
            val menu = windows.get(playerId)?.takeIf { it.windowId == containerId }
            return if (menu != null && !menu.vanillaTexture) null else rows
        }
    }
}
