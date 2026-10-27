package net.artisanmc.plugin.render.packets

import be.seeseemelk.mockbukkit.MockBukkit
import be.seeseemelk.mockbukkit.entity.PlayerMock
import io.netty.channel.ChannelInboundHandlerAdapter
import io.netty.channel.ChannelOutboundHandlerAdapter
import io.netty.channel.embedded.EmbeddedChannel
import net.artisanmc.plugin.RecordingSink
import net.artisanmc.plugin.platform.ServerPlatform
import net.artisanmc.plugin.session.MenuSlots
import net.artisanmc.plugin.session.PlayerInventoryMode
import net.kyori.adventure.text.Component
import org.bukkit.Bukkit
import org.bukkit.Material
import org.bukkit.inventory.ItemStack
import java.util.logging.Logger
import kotlin.test.*

/** Packets are [MenuPacket]s themselves, items their material name: no server classes. */
private class FakeCodec : MenuPacketCodec {
    var failOn: Class<*>? = null
    override fun decode(packet: Any): MenuPacket? {
        if (packet.javaClass == failOn) error("broken codec")
        return packet as? MenuPacket
    }
    override fun encode(packet: MenuPacket): Any = packet
    override fun item(stack: ItemStack): Any = stack.type.name
    override val emptyItem: Any = "EMPTY"
    override fun title(raw: Any): Component = raw as Component
    override fun rawTitle(title: Component): Any = title
}

class MenuPacketInterceptorTest {
    private lateinit var p: PlayerMock
    private val codec = FakeCodec()
    private val windows = MenuWindows(RecordingSink())
    private lateinit var channel: EmbeddedChannel
    private lateinit var interceptor: MenuPacketInterceptor
    private val top = 9

    @BeforeTest fun setup() {
        MockBukkit.mock()
        p = MockBukkit.getMock()!!.addPlayer()
        channel = EmbeddedChannel()
        channel.pipeline().addLast("encoder", ChannelOutboundHandlerAdapter())
        channel.pipeline().addLast("packet_handler", ChannelInboundHandlerAdapter())
        interceptor = MenuPacketInterceptor({ channel }, MenuPacketRewriter(windows, codec), Logger.getAnonymousLogger())
        interceptor.inject(p)
    }

    @AfterTest fun teardown() {
        channel.finishAndReleaseAll()
        MockBukkit.unmock()
    }

    /** What reaches the encoder for [packet] written by the server. */
    private fun sent(packet: Any): Any {
        assertTrue(channel.writeOutbound(packet))
        return channel.readOutbound<Any>()
    }

    private fun menu(title: Component? = null): MenuSlots {
        val slots = MenuSlots(top, PlayerInventoryMode.HIDDEN)
        slots[0] = ItemStack(Material.DIAMOND)
        windows.open(p, Bukkit.createInventory(null, top), slots, title = title)
        return slots
    }

    private val chest = Any()
    private fun open(id: Int = 3) = MenuPacket.OpenScreen(id, chest, 0, Component.text("server"))
    private fun content(id: Int = 3) = MenuPacket.Content(id, 7, List(top + 36) { "STONE" }, "EMPTY")

    @Test fun `the handler sits right after the encoder, once, and leaves on disable`() {
        assertEquals(listOf("encoder", MenuPacketInterceptor.HANDLER, "packet_handler"), channel.pipeline().names().filter { !it.contains('$') })
        interceptor.inject(p)
        assertEquals(1, channel.pipeline().names().count { it == MenuPacketInterceptor.HANDLER })
        interceptor.uninjectAll()
        assertNull(channel.pipeline().get(MenuPacketInterceptor.HANDLER))
    }

    @Test fun `other packets and other players' windows pass untouched`() {
        val other = "chat"
        assertSame(other, sent(other))
        val packet = content()
        assertSame(packet, sent(packet), "no menu open")
    }

    @Test fun `the open packet gives the window its id, then the server's contents are replaced`() {
        menu()
        sent(open(3))
        assertEquals(3, windows.get(p.uniqueId)?.windowId)

        val rewritten = sent(content(3)) as MenuPacket.Content
        assertEquals("DIAMOND", rewritten.items[0])
        assertEquals("EMPTY", rewritten.items[1], "an empty menu slot hides the server's item")
        assertEquals(7, windows.get(p.uniqueId)?.stateId, "the server's stateId is kept for our own sends")

        val slot = sent(MenuPacket.Slot(3, 8, 0, "STONE")) as MenuPacket.Slot
        assertEquals("DIAMOND", slot.item)
        val elsewhere = MenuPacket.Slot(4, 8, 0, "STONE")
        assertSame(elsewhere, sent(elsewhere), "another window id is not the menu's")
    }

    @Test fun `a hidden bottom also replaces the player's inventory slots`() {
        val slots = menu()
        slots[top] = ItemStack(Material.EMERALD)
        sent(open())
        val hidden = (0..35).map { sent(MenuPacket.PlayerInventory(it, "STONE")) as MenuPacket.PlayerInventory }
        assertEquals(1, hidden.count { it.item == "EMERALD" })
        assertTrue(hidden.all { it.item == "EMERALD" || it.item == "EMPTY" })
    }

    @Test fun `the composed title replaces the server's on Spigot`() {
        val title = Component.text("Shop")
        menu(title)
        assertEquals(title, (sent(open()) as MenuPacket.OpenScreen).title)
    }

    @Test fun `our own sends cross the encoder as they are`() {
        val slots = menu()
        sent(open())
        val sink = PacketSlotSink(codec, interceptor) { 9 }
        sink.sendSlot(p, 3, 0, ItemStack(Material.STONE))
        val packet = channel.readOutbound<Any>() as MenuPacket.Slot
        assertEquals("STONE", packet.item, "not rewritten back to the menu's DIAMOND")
        assertEquals(9, packet.stateId)
        assertEquals(Material.DIAMOND, slots[0]?.type)
    }

    @Test fun `a failing rewrite lets the server's packet through`() {
        menu()
        codec.failOn = MenuPacket.Content::class.java
        val packet = content()
        assertSame(packet, sent(packet))
        assertTrue(channel.isActive, "the connection stays up")
    }

    @Test fun `Spigot before 26 is refused, Paper never`() {
        assertTrue(ServerPlatform.obfuscated(paper = false, minecraftVersion = "1.21.11"))
        assertFalse(ServerPlatform.obfuscated(paper = false, minecraftVersion = "26.1"))
        assertFalse(ServerPlatform.obfuscated(paper = false, minecraftVersion = "26.3.1"))
        assertFalse(ServerPlatform.obfuscated(paper = true, minecraftVersion = "1.21.4"))
    }
}
