package net.artisanmc.plugin

import be.seeseemelk.mockbukkit.MockBukkit
import be.seeseemelk.mockbukkit.entity.PlayerMock
import net.artisanmc.plugin.render.ContainerTexture
import net.artisanmc.plugin.render.MenuSlots
import net.artisanmc.plugin.render.MenuWindows
import net.artisanmc.plugin.render.OpenedContainers
import net.artisanmc.plugin.render.VanillaGuiTitle
import net.artisanmc.plugin.resourcepack.PackLoadTracker
import net.kyori.adventure.key.Key
import net.kyori.adventure.text.Component
import net.kyori.adventure.text.TextComponent
import net.kyori.adventure.text.format.NamedTextColor
import org.bukkit.Bukkit
import org.bukkit.event.inventory.InventoryOpenEvent
import org.bukkit.event.inventory.InventoryType
import org.bukkit.event.player.PlayerQuitEvent
import org.bukkit.event.player.PlayerResourcePackStatusEvent
import org.bukkit.event.player.PlayerResourcePackStatusEvent.Status
import java.util.UUID
import kotlin.test.*

class VanillaGuiTitleTest {
    private lateinit var p: PlayerMock

    @BeforeTest fun setup() { MockBukkit.mock(); p = MockBukkit.getMock()!!.addPlayer() }
    @AfterTest fun teardown() { MockBukkit.unmock() }

    @Test fun `each container window maps to its texture glyph`() {
        assertEquals((1..6).map { ContainerTexture.CHEST to it }, (0..5).map { VanillaGuiTitle.glyphFor(it, null) })
        assertEquals(ContainerTexture.HOPPER to 7, VanillaGuiTitle.glyphFor(16, InventoryType.HOPPER))
        assertEquals(ContainerTexture.DISPENSER to 8, VanillaGuiTitle.glyphFor(6, InventoryType.DROPPER))
        assertEquals(ContainerTexture.DISPENSER to 8, VanillaGuiTitle.glyphFor(6, InventoryType.DISPENSER))
        assertNull(VanillaGuiTitle.glyphFor(7, InventoryType.CRAFTER))
        assertNull(VanillaGuiTitle.glyphFor(20, InventoryType.SHULKER_BOX))
        assertNull(VanillaGuiTitle.glyphFor(-1, null))
    }

    @Test fun `the prefix draws the window glyph from x=0 and walks back to the title origin`() {
        val prefix = VanillaGuiTitle.prefix(3) as TextComponent
        assertEquals("", prefix.content())
        assertEquals(Key.key("artisan", "vanilla_gui"), prefix.font())
        assertEquals(NamedTextColor.WHITE, prefix.color())
        assertEquals("", (VanillaGuiTitle.prefix(7) as TextComponent).content())
    }

    @Test fun `decorating keeps the original title after the prefix, with its own style`() {
        val title = Component.text("Chest", NamedTextColor.DARK_GRAY)
        val decorated = VanillaGuiTitle.decorate(title, 6)
        assertEquals(listOf(VanillaGuiTitle.prefix(6), title), decorated.children())
        assertNull(decorated.color())
    }

    private fun status(id: UUID, s: Status) = PlayerResourcePackStatusEvent(p, id, s)

    @Test fun `a player counts once the host pack carrying Artisan's assets is loaded, until they leave`() {
        val t = PackLoadTracker()
        t.onStatus(status(UUID.randomUUID(), Status.ACCEPTED))
        assertFalse(t.hasLoaded(p.uniqueId))
        t.onStatus(status(UUID.randomUUID(), Status.SUCCESSFULLY_LOADED))
        assertTrue(t.hasLoaded(p.uniqueId))
        t.onQuit(PlayerQuitEvent(p, Component.empty(), PlayerQuitEvent.QuitReason.DISCONNECTED))
        assertFalse(t.hasLoaded(p.uniqueId))
    }

    @Test fun `the opened container type is remembered until the player leaves`() {
        val opened = OpenedContainers()
        val hopper = Bukkit.createInventory(null, InventoryType.HOPPER)
        opened.onOpen(InventoryOpenEvent(p.openInventory(hopper)!!))
        assertEquals(InventoryType.HOPPER, opened.typeOf(p.uniqueId))
        opened.onQuit(PlayerQuitEvent(p, Component.empty(), PlayerQuitEvent.QuitReason.DISCONNECTED))
        assertNull(opened.typeOf(p.uniqueId))
    }

    @Test fun `a window is decorated only when its texture is transparent for that player`() {
        val windows = MenuWindows(RecordingSink())
        val active = mutableSetOf(ContainerTexture.CHEST)
        var opened: InventoryType? = null
        val rule = VanillaGuiTitle.Rule(windows, { _, texture -> texture in active }, { opened })

        assertEquals(3, rule.glyphToDecorate(p.uniqueId, containerId = 4, windowType = 2))
        opened = InventoryType.HOPPER
        assertNull(rule.glyphToDecorate(p.uniqueId, containerId = 4, windowType = 16), "hoppers not transparent")
        active += ContainerTexture.HOPPER
        assertEquals(7, rule.glyphToDecorate(p.uniqueId, containerId = 4, windowType = 16))
        active.clear()
        assertNull(rule.glyphToDecorate(p.uniqueId, containerId = 4, windowType = 2))
    }

    @Test fun `an Artisan menu without its vanilla texture stays transparent`() {
        val windows = MenuWindows(RecordingSink())
        val rule = VanillaGuiTitle.Rule(windows, { _, _ -> true }, { InventoryType.HOPPER })
        windows.open(p, Bukkit.createInventory(null, InventoryType.HOPPER), MenuSlots(5), vanillaTexture = false)
        windows.onOpenWindow(p.uniqueId, 7)
        assertNull(rule.glyphToDecorate(p.uniqueId, containerId = 7, windowType = 16))

        windows.open(p, Bukkit.createInventory(null, InventoryType.HOPPER), MenuSlots(5), vanillaTexture = true)
        windows.onOpenWindow(p.uniqueId, 8)
        assertEquals(7, rule.glyphToDecorate(p.uniqueId, containerId = 8, windowType = 16))
    }
}
