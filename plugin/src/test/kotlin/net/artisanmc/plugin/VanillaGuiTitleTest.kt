package net.artisanmc.plugin

import be.seeseemelk.mockbukkit.MockBukkit
import be.seeseemelk.mockbukkit.entity.PlayerMock
import net.artisanmc.plugin.render.MenuSlots
import net.artisanmc.plugin.render.MenuWindows
import net.artisanmc.plugin.render.VanillaGuiTitle
import net.artisanmc.plugin.resourcepack.PackLoadTracker
import net.kyori.adventure.key.Key
import net.kyori.adventure.text.Component
import net.kyori.adventure.text.TextComponent
import net.kyori.adventure.text.format.NamedTextColor
import org.bukkit.Bukkit
import org.bukkit.event.player.PlayerQuitEvent
import org.bukkit.event.player.PlayerResourcePackStatusEvent
import org.bukkit.event.player.PlayerResourcePackStatusEvent.Status
import java.util.UUID
import kotlin.test.*

class VanillaGuiTitleTest {
    private lateinit var p: PlayerMock

    @BeforeTest fun setup() { MockBukkit.mock(); p = MockBukkit.getMock()!!.addPlayer() }
    @AfterTest fun teardown() { MockBukkit.unmock() }

    @Test fun `only the six generic chest window types have a texture glyph`() {
        assertEquals(listOf(1, 2, 3, 4, 5, 6), (0..5).map { VanillaGuiTitle.rowsForWindowType(it) })
        assertNull(VanillaGuiTitle.rowsForWindowType(6))  // generic_3x3
        assertNull(VanillaGuiTitle.rowsForWindowType(-1))
    }

    @Test fun `the prefix draws the window glyph from x=0 and walks back to the title origin`() {
        val prefix = VanillaGuiTitle.prefix(3) as TextComponent
        assertEquals("", prefix.content())
        assertEquals(Key.key("artisan", "vanilla_gui"), prefix.font())
        assertEquals(NamedTextColor.WHITE, prefix.color())
    }

    @Test fun `decorating keeps the original title after the prefix, with its own style`() {
        val title = Component.text("Chest", NamedTextColor.DARK_GRAY)
        val decorated = VanillaGuiTitle.decorate(title, 6)
        assertEquals(listOf(VanillaGuiTitle.prefix(6), title), decorated.children())
        assertNull(decorated.color())
    }

    private fun tracker(delegated: Boolean = false) = PackLoadTracker().apply { this.delegated = delegated }
    private fun status(id: UUID, s: Status) = PlayerResourcePackStatusEvent(p, id, s)

    @Test fun `a player counts once Artisan's own pack is loaded, not someone else's`() {
        val ours = UUID.randomUUID()
        val t = tracker()
        t.pushed(ours)
        t.onStatus(status(UUID.randomUUID(), Status.SUCCESSFULLY_LOADED))
        assertFalse(t.hasLoaded(p.uniqueId))
        t.onStatus(status(ours, Status.ACCEPTED))
        assertFalse(t.hasLoaded(p.uniqueId))
        t.onStatus(status(ours, Status.SUCCESSFULLY_LOADED))
        assertTrue(t.hasLoaded(p.uniqueId))
        t.onQuit(PlayerQuitEvent(p, Component.empty(), PlayerQuitEvent.QuitReason.DISCONNECTED))
        assertFalse(t.hasLoaded(p.uniqueId))
    }

    @Test fun `when delegated, the host pack carries Artisan's assets`() {
        val t = tracker(delegated = true)
        t.onStatus(status(UUID.randomUUID(), Status.SUCCESSFULLY_LOADED))
        assertTrue(t.hasLoaded(p.uniqueId))
    }

    @Test fun `a chest window is decorated only when transparency is active for that player`() {
        val windows = MenuWindows(RecordingSink())
        var active = true
        val rule = VanillaGuiTitle.Rule(windows) { active }

        assertEquals(3, rule.rowsToDecorate(p.uniqueId, containerId = 4, windowType = 2))
        assertNull(rule.rowsToDecorate(p.uniqueId, containerId = 4, windowType = 15), "hopper")
        active = false
        assertNull(rule.rowsToDecorate(p.uniqueId, containerId = 4, windowType = 2))
    }

    @Test fun `an Artisan menu without its vanilla texture stays transparent`() {
        val windows = MenuWindows(RecordingSink())
        val rule = VanillaGuiTitle.Rule(windows) { true }
        windows.open(p, Bukkit.createInventory(null, 27), MenuSlots(27), vanillaTexture = false)
        windows.onOpenWindow(p.uniqueId, 7)
        assertNull(rule.rowsToDecorate(p.uniqueId, containerId = 7, windowType = 2))

        windows.open(p, Bukkit.createInventory(null, 27), MenuSlots(27), vanillaTexture = true)
        windows.onOpenWindow(p.uniqueId, 8)
        assertEquals(3, rule.rowsToDecorate(p.uniqueId, containerId = 8, windowType = 2))
    }
}
