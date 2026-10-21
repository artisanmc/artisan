package net.artisanmc.plugin.network

import net.artisanmc.modules.api.database.DatabaseDialect
import net.artisanmc.modules.api.network.NetworkLocation
import net.artisanmc.modules.api.network.NetworkMessage
import net.artisanmc.plugin.database.ArtisanSchema
import net.artisanmc.plugin.database.ConnectionPools
import net.artisanmc.plugin.database.DatabaseSettings
import net.artisanmc.plugin.database.NetworkPlayerRow
import net.artisanmc.plugin.database.NetworkRows
import net.artisanmc.plugin.database.ServerRegistry
import java.nio.file.Files
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import java.util.UUID
import java.util.logging.Logger
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull

/** Two servers, `lobby` and `survie`, on one database. */
class NetworkBusTest {
    private class MutableClock(var now: Instant) : Clock() {
        override fun getZone() = ZoneOffset.UTC
        override fun withZone(zone: java.time.ZoneId?) = this
        override fun instant() = now
    }

    private val dir = Files.createTempDirectory("artisan_bus_").toFile()
    private val pools = ConnectionPools(
        { DatabaseSettings.of("h2", "localhost", "3306", "minecraft", "root", "", DatabaseSettings.DEFAULT_POOL_SIZE, dir) },
        Logger.getLogger("NetworkBusTest"),
    )
    private val data = pools.dataSource("Artisan").also { ArtisanSchema.migrate(it, DatabaseDialect.H2, Logger.getAnonymousLogger()) }
    private val clock = MutableClock(Instant.now())
    private var open = true
    private val rows = NetworkRows(data)
    private val lobby = bus("lobby")
    private val survie = bus("survie")

    init {
        val registry = ServerRegistry(data, DatabaseDialect.H2, Logger.getAnonymousLogger())
        registry.register(UUID.randomUUID(), "lobby", clock.now)
        registry.register(UUID.randomUUID(), "survie", clock.now)
    }

    private fun bus(name: String) =
        NetworkBus({ if (open) rows else null }, { true }, { name }, Logger.getAnonymousLogger(), clock)

    @AfterTest fun teardown() = pools.closeAll()

    @Test
    fun `a message reaches the other servers and not its own`() {
        val toLobby = mutableListOf<NetworkMessage>()
        val toSurvie = mutableListOf<NetworkMessage>()
        lobby.subscribe(null, "guilds:sync", { toLobby += it })
        survie.subscribe(null, "guilds:sync", { toSurvie += it })
        lobby.tick(); survie.tick()

        lobby.publish("guilds:sync", "guild-1", deliverHere = false)
        lobby.tick(); survie.tick()

        assertEquals(listOf(NetworkMessage("guilds:sync", "lobby", "guild-1")), toSurvie)
        assertEquals(emptyList(), toLobby)
    }

    @Test
    fun `a server reads only what was written after it started`() {
        lobby.tick()
        lobby.publish("guilds:sync", "before", deliverHere = false)
        lobby.tick()
        val received = mutableListOf<String>()
        survie.subscribe(null, "guilds:sync", { received += it.payload })
        survie.tick()
        lobby.publish("guilds:sync", "after", deliverHere = false)
        lobby.tick(); survie.tick()

        assertEquals(listOf("after"), received)
    }

    @Test
    fun `messages wait in memory until the database opens`() {
        open = false
        val received = mutableListOf<String>()
        survie.subscribe(null, "guilds:sync", { received += it.payload })
        lobby.publish("guilds:sync", "early", deliverHere = false)
        lobby.tick(); survie.tick()
        open = true
        survie.tick()
        lobby.tick(); survie.tick()

        assertEquals(listOf("early"), received)
    }

    @Test
    fun `deliverHere runs this server's subscribers, a failing one does not stop the others`() {
        val received = mutableListOf<String>()
        lobby.subscribe(null, "guilds:sync", { error("boom") })
        lobby.subscribe(null, "guilds:sync", { received += it.payload })

        lobby.publish("guilds:sync", "here", deliverHere = true)

        assertEquals(listOf("here"), received)
    }

    @Test
    fun `cancelled and released subscriptions receive nothing`() {
        val received = mutableListOf<String>()
        val loader = object : ClassLoader() {}
        val cancel = lobby.subscribe(null, "guilds:a", { received += "a" })
        lobby.subscribe(loader, "guilds:b", { received += "b" })
        cancel()
        assertEquals(1, lobby.releaseLoadedBy(loader))

        lobby.deliverHere("guilds:a", "x")
        lobby.deliverHere("guilds:b", "x")
        assertEquals(emptyList(), received)
    }

    @Test
    fun `presence lists the players of the other servers`() {
        lobby.joined(NetworkPlayerRow(UUID.randomUUID(), "Alice", "lobby"))
        val bob = UUID.randomUUID()
        survie.joined(NetworkPlayerRow(bob, "Bob", "survie"))
        lobby.tick()

        assertEquals(listOf("Bob"), lobby.remotePlayers.values.map { it.name })
        assertEquals("survie", lobby.remotePlayers[bob]?.server)
        assertEquals(listOf("lobby", "survie"), lobby.servers)
    }

    @Test
    fun `channels are module colon name in lower case`() {
        assertFailsWith<IllegalArgumentException> { lobby.publish("Guilds:sync", "x", false) }
        assertFailsWith<IllegalArgumentException> { lobby.subscribe(null, "sync", {}) }
        assertFailsWith<IllegalArgumentException> { lobby.publish("guilds:sync", "x".repeat(NetworkBus.MAX_PAYLOAD + 1), false) }
    }

    @Test
    fun `a teleport request survives its encoding`() {
        val id = UUID.randomUUID()
        val location = NetworkLocation("survie", "world_nether", 12.5, 64.0, -3.25, 90f, -10f)
        assertEquals(TeleportCodec.Request(id, location), TeleportCodec.decode(TeleportCodec.encode(id, location)))
        assertNull(TeleportCodec.decode("not\na teleport"))
    }
}
