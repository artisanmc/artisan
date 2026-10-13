package net.artisanmc.plugin.render

import net.kyori.adventure.key.Key
import net.kyori.adventure.text.Component
import net.kyori.adventure.text.format.NamedTextColor
import org.bukkit.event.EventHandler
import org.bukkit.event.EventPriority
import org.bukkit.event.Listener
import org.bukkit.event.inventory.InventoryOpenEvent
import org.bukkit.event.inventory.InventoryType
import org.bukkit.event.player.PlayerQuitEvent
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/** Vanilla container texture a pack can make transparent (cf. editor/src/lib/pack/vanillaGui.ts). */
enum class ContainerTexture { CHEST, HOPPER, DISPENSER }

/**
 * Vanilla container textures drawn through the window title.
 *
 * When a menu turns `vanilla_texture` off, the pack makes that container's
 * texture transparent for every window of its kind. Each other such window
 * gets the texture back as a glyph prepended to its OPEN_WINDOW title (font
 * `artisan:vanilla_gui`): U+E010 moves the pen from the title origin to x=0,
 * U+E000+glyph draws the window (1..6 chest rows, 7 hopper, 8 dispenser), and
 * U+E010+glyph walks back to the title origin so the real title is unchanged.
 */
object VanillaGuiTitle {
    val FONT: Key = Key.key("artisan", "vanilla_gui")

    /**
     * Texture and glyph of a window. Chests are recognised by their protocol
     * menu type (`generic_9x1..9x6` = 0..5, stable ids, other plugins' menus
     * included); hoppers and dispensers/droppers by the Bukkit type of the
     * inventory just opened, since their protocol ids move between versions.
     */
    fun glyphFor(windowType: Int, openedType: InventoryType?): Pair<ContainerTexture, Int>? = when {
        windowType in 0..5 -> ContainerTexture.CHEST to windowType + 1
        openedType == InventoryType.HOPPER -> ContainerTexture.HOPPER to 7
        openedType == InventoryType.DROPPER || openedType == InventoryType.DISPENSER -> ContainerTexture.DISPENSER to 8
        else -> null
    }

    fun prefix(glyph: Int): Component =
        Component.text("${(0xE000 + glyph).toChar()}${(0xE010 + glyph).toChar()}")
            .font(FONT)
            .color(NamedTextColor.WHITE)

    fun decorate(title: Component, glyph: Int): Component = Component.text().append(prefix(glyph), title).build()

    /**
     * Which OPEN_WINDOW titles get a texture: windows whose texture the
     * player's loaded pack makes transparent ([active]), except Artisan menus
     * that turned their vanilla texture off.
     */
    class Rule(
        private val windows: MenuWindows,
        private val active: (UUID, ContainerTexture) -> Boolean,
        private val openedType: (UUID) -> InventoryType?,
    ) {
        fun glyphToDecorate(playerId: UUID, containerId: Int, windowType: Int): Int? {
            val (texture, glyph) = glyphFor(windowType, openedType(playerId)) ?: return null
            if (!active(playerId, texture)) return null
            val menu = windows.get(playerId)?.takeIf { it.windowId == containerId }
            return if (menu != null && !menu.vanillaTexture) null else glyph
        }
    }
}

/**
 * Bukkit type of the last inventory each player opened. InventoryOpenEvent
 * fires just before the OPEN_WINDOW packet, which is read on a network thread.
 */
class OpenedContainers : Listener {
    private val types = ConcurrentHashMap<UUID, InventoryType>()

    fun typeOf(playerId: UUID): InventoryType? = types[playerId]

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    fun onOpen(event: InventoryOpenEvent) {
        types[event.player.uniqueId] = event.inventory.type
    }

    @EventHandler
    fun onQuit(event: PlayerQuitEvent) {
        types.remove(event.player.uniqueId)
    }
}
