package net.artisanmc.plugin.resourcepack

import be.seeseemelk.mockbukkit.MockBukkit
import io.netty.channel.ChannelInboundHandlerAdapter
import io.netty.channel.embedded.EmbeddedChannel
import org.bukkit.event.player.PlayerJoinEvent
import java.util.UUID
import java.util.logging.Logger
import kotlin.test.*

/** The server's packet, as read by name: a record with `id()` and `action()`. */

class ServerboundResourcePackPacket(private val id: UUID, private val action: Action) {
    enum class Action { ACCEPTED, DOWNLOADED, SUCCESSFULLY_LOADED, DECLINED }
    fun id() = id
    fun action() = action
}

class PreJoinPackLoadsTest {
    private lateinit var channel: EmbeddedChannel

    @BeforeTest fun setup() {
        MockBukkit.mock()
        channel = EmbeddedChannel()
        channel.pipeline().addLast("packet_handler", ChannelInboundHandlerAdapter())
        PreJoinPackLoads.attach(channel)
    }

    @AfterTest fun teardown() {
        channel.finishAndReleaseAll()
        MockBukkit.unmock()
    }

    @Test fun `a pack loaded before join counts once the player joins, delegated`() {
        val pack = UUID.randomUUID()
        channel.writeInbound(ServerboundResourcePackPacket(pack, ServerboundResourcePackPacket.Action.ACCEPTED))
        assertNull(channel.attr(PreJoinPackLoads.LOADED).get())
        channel.writeInbound(ServerboundResourcePackPacket(pack, ServerboundResourcePackPacket.Action.SUCCESSFULLY_LOADED))
        channel.writeInbound("another packet")
        assertEquals(pack, channel.attr(PreJoinPackLoads.LOADED).get())
        // Every packet goes on to the server's handler.
        assertEquals(3, generateSequence { channel.readInbound<Any>() }.count())

        val tracker = PackLoadTracker().apply { delegated = true }
        val player = MockBukkit.getMock()!!.addPlayer()
        assertFalse(tracker.hasLoaded(player.uniqueId))
        PreJoinPackLoads(tracker, { channel }, Logger.getAnonymousLogger()).onJoin(PlayerJoinEvent(player, "joined"))
        assertTrue(tracker.hasLoaded(player.uniqueId))
    }

    @Test fun `sent by Artisan itself, only its own pack counts`() {
        val other = UUID.randomUUID()
        channel.writeInbound(ServerboundResourcePackPacket(other, ServerboundResourcePackPacket.Action.SUCCESSFULLY_LOADED))
        val tracker = PackLoadTracker().apply { delegated = false }
        val player = MockBukkit.getMock()!!.addPlayer()
        PreJoinPackLoads(tracker, { channel }, Logger.getAnonymousLogger()).onJoin(PlayerJoinEvent(player, "joined"))
        assertFalse(tracker.hasLoaded(player.uniqueId))
    }

    @Test fun `a declined pack or another packet leaves nothing`() {
        channel.writeInbound(ServerboundResourcePackPacket(UUID.randomUUID(), ServerboundResourcePackPacket.Action.DECLINED))
        assertNull(channel.attr(PreJoinPackLoads.LOADED).get())
        assertNull(PreJoinPackLoads.loadedPack("text"))
    }
}
