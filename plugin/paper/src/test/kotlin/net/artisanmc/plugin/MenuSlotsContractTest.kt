package net.artisanmc.plugin

import be.seeseemelk.mockbukkit.MockBukkit
import be.seeseemelk.mockbukkit.entity.PlayerMock
import net.artisanmc.plugin.render.ClientSlotSink
import net.artisanmc.plugin.session.MenuSlots
import net.artisanmc.plugin.render.MenuWindows
import net.artisanmc.plugin.session.PlayerInventoryMode
import net.artisanmc.plugin.session.SlotKind
import org.bukkit.Bukkit
import org.bukkit.Material
import org.bukkit.entity.Player
import org.bukkit.inventory.ItemStack
import kotlin.test.*

class RecordingSink : ClientSlotSink {
    val calls = mutableListOf<String>()
    val allSends = mutableListOf<List<ItemStack?>>()
    override fun sendAll(player: Player, windowId: Int, items: List<ItemStack?>) {
        calls += "all:$windowId"
        allSends += items
    }
    override fun sendSlot(player: Player, windowId: Int, rawSlot: Int, item: ItemStack?) {
        calls += "slot:$windowId:$rawSlot:${item?.type}"
    }
}

class MenuSlotsContractTest {
    private lateinit var p: PlayerMock
    private val sink = RecordingSink()
    private val windows = MenuWindows(sink)
    private val top = 27

    @BeforeTest fun setup() { MockBukkit.mock(); p = MockBukkit.getMock()!!.addPlayer() }
    @AfterTest fun teardown() { MockBukkit.unmock() }

    private fun hidden() = MenuSlots(top, PlayerInventoryMode.HIDDEN)

    /** Opens a window and simulates the captured OPEN_WINDOW packet. */
    private fun openWindow(slots: MenuSlots, windowId: Int = 5) {
        windows.open(p, Bukkit.createInventory(null, top), slots)
        windows.onOpenWindow(p.uniqueId, windowId)
    }

    @Test fun `a top slot and a player slot behave the same through set, get, live update and clear`() {
        for (raw in listOf(0, 27)) {
            sink.calls.clear()
            val slots = hidden()
            slots[raw] = ItemStack(Material.STONE)
            assertEquals(Material.STONE, slots[raw]?.type)
            assertTrue(sink.calls.isEmpty(), "nothing is sent before the window is open")

            openWindow(slots)
            slots[raw] = ItemStack(Material.DIAMOND)
            assertEquals(Material.DIAMOND, slots[raw]?.type)
            assertEquals(listOf("slot:5:$raw:DIAMOND"), sink.calls)

            slots.clear()
            assertNull(slots[raw])
            assertEquals("all:5", sink.calls.last())
            assertNull(sink.allSends.last()[raw])
            assertEquals(top + 36, sink.allSends.last().size)
        }
    }

    @Test fun `air is stored as empty`() {
        val slots = hidden()
        slots[3] = ItemStack(Material.AIR)
        assertNull(slots[3])
    }

    @Test fun `visible mode ignores player slots`() {
        val slots = MenuSlots(top, PlayerInventoryMode.VISIBLE)
        slots[27] = ItemStack(Material.STONE)
        assertNull(slots[27])
        assertFalse(slots.addressable(27))
        assertFalse(slots.rewrites(27))
        assertTrue(slots.rewrites(0))
        assertEquals(top, slots.slotLimit)
        assertEquals(top + 36, hidden().slotLimit)
    }

    @Test fun `window content is rewritten from the slots, the real player part kept when visible`() {
        val real = List(top + 36) { "real$it" }
        val visible = MenuSlots(top, PlayerInventoryMode.VISIBLE).apply { this[0] = ItemStack(Material.STONE) }
        val out = MenuSlots.rewriteContent(real, visible) { raw -> visible[raw]?.type?.name ?: "empty" }!!
        assertEquals("STONE", out[0])
        assertEquals("empty", out[1])
        assertEquals(real.drop(top), out.drop(top))

        val h = hidden().apply { this[62] = ItemStack(Material.DIAMOND) }
        val out2 = MenuSlots.rewriteContent(real, h) { raw -> h[raw]?.type?.name ?: "empty" }!!
        assertEquals("DIAMOND", out2[62])
        assertEquals("empty", out2[27])
        assertNull(MenuSlots.rewriteContent(real.drop(1), h) { "x" }, "wrong window size is left alone")
    }

    @Test fun `a slot marked INPUT is never rewritten`() {
        val slots = hidden().apply { setKind(27, SlotKind.INPUT); setKind(4, SlotKind.INPUT) }
        val real = List(top + 36) { "real$it" }
        val out = MenuSlots.rewriteContent(real, slots) { "menu" }!!
        assertEquals("real27", out[27])
        assertEquals("real4", out[4])
        assertEquals("menu", out[28])
        assertNull(MenuSlots.rewriteSlot(27, slots) { "menu" })
        assertNull(MenuSlots.rewriteSlot(4, slots) { "menu" })
        assertEquals("menu", MenuSlots.rewriteSlot(5, slots) { "menu" })
    }

    @Test fun `player inventory indexes map to window raw slots`() {
        assertEquals(top + 27, MenuSlots.playerInventoryToRaw(0, top))
        assertEquals(top + 35, MenuSlots.playerInventoryToRaw(8, top))
        assertEquals(top, MenuSlots.playerInventoryToRaw(9, top))
        assertEquals(top + 26, MenuSlots.playerInventoryToRaw(35, top))
        assertNull(MenuSlots.playerInventoryToRaw(40, top), "armor / offhand are not in the window")
    }

    @Test fun `packets of the open window are rewritten, a foreign window is ignored`() {
        val slots = hidden().apply { this[0] = ItemStack(Material.STONE) }
        openWindow(slots, windowId = 5)
        val real = List(top + 36) { "real" }
        val name: (ItemStack) -> String = { it.type.name }

        assertEquals("STONE", windows.rewriteWindowItems(p.uniqueId, 5, real, name, "empty")!![0])
        assertEquals("STONE", windows.rewriteSetSlot(p.uniqueId, 5, 0, name, "empty"))
        assertEquals("empty", windows.rewriteSetSlot(p.uniqueId, 5, 27, name, "empty"))
        assertNull(windows.rewriteWindowItems(p.uniqueId, 9, real, name, "empty"))
        assertNull(windows.rewriteSetSlot(p.uniqueId, 9, 0, name, "empty"))
        assertNull(windows.rewriteSetSlot(p.uniqueId, 0, 0, name, "empty"))
    }

    @Test fun `set player inventory is rewritten only while a hidden window is open`() {
        val name: (ItemStack) -> String = { it.type.name }
        val slots = hidden().apply { this[top + 27] = ItemStack(Material.DIAMOND) }
        windows.open(p, Bukkit.createInventory(null, top), slots)
        assertNull(windows.rewritePlayerInventory(p.uniqueId, 0, name, "empty"), "window not open yet")
        windows.onOpenWindow(p.uniqueId, 5)
        assertEquals("DIAMOND", windows.rewritePlayerInventory(p.uniqueId, 0, name, "empty"))
        assertEquals("empty", windows.rewritePlayerInventory(p.uniqueId, 9, name, "empty"))
        assertNull(windows.rewritePlayerInventory(p.uniqueId, 40, name, "empty"))

        windows.open(p, Bukkit.createInventory(null, top), MenuSlots(top, PlayerInventoryMode.VISIBLE))
        windows.onOpenWindow(p.uniqueId, 6)
        assertNull(windows.rewritePlayerInventory(p.uniqueId, 0, name, "empty"))
    }

    @Test fun `only the first open window after registration is captured`() {
        openWindow(hidden(), windowId = 5)
        windows.onOpenWindow(p.uniqueId, 8)
        assertEquals(5, windows.get(p.uniqueId)!!.windowId)
    }

    @Test fun `going from menu A to menu B keeps B`() {
        val a = Bukkit.createInventory(null, top)
        val b = Bukkit.createInventory(null, top)
        val slotsA = hidden()
        val slotsB = hidden()
        windows.open(p, a, slotsA)
        windows.onOpenWindow(p.uniqueId, 5)
        windows.open(p, b, slotsB)

        assertFalse(windows.release(p, a))
        assertSame(slotsB, windows.get(p.uniqueId)!!.slots)
        sink.calls.clear()
        slotsA[0] = ItemStack(Material.STONE)
        assertTrue(sink.calls.isEmpty(), "A's slots are detached from the client")
        assertTrue(windows.release(p, b))
        assertNull(windows.get(p.uniqueId))
    }
}
