package net.artisanmc.plugin.database

import net.artisanmc.modules.api.database.DatabaseDialect
import java.nio.file.Files
import java.time.Instant
import java.util.UUID
import java.util.logging.Logger
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals

class NetworkRowsTest {
    private val dir = Files.createTempDirectory("artisan_network_").toFile()
    private val pools = ConnectionPools(
        { DatabaseSettings.of("h2", "localhost", "3306", "minecraft", "root", "", DatabaseSettings.DEFAULT_POOL_SIZE, dir) },
        Logger.getLogger("NetworkRowsTest"),
    )
    private val data = pools.dataSource("Artisan").also { ArtisanSchema.migrate(it, DatabaseDialect.H2, Logger.getAnonymousLogger()) }
    private val rows = NetworkRows(data)
    private val servers = ServerRegistry(data, DatabaseDialect.H2, Logger.getAnonymousLogger())
    private val t0 = Instant.parse("2026-10-21T10:00:00Z")
    private val alice = UUID.randomUUID()
    private val bob = UUID.randomUUID()

    @AfterTest fun teardown() = pools.closeAll()

    @Test
    fun `messages are read in order after an id, and purged by age`() {
        val start = rows.lastId()
        rows.publish("lobby", "guilds:sync", "a", t0)
        rows.publish("survie", "guilds:sync", "b", t0.plusSeconds(90))

        val read = rows.after(start)
        assertEquals(listOf("lobby" to "a", "survie" to "b"), read.map { it.serverFrom to it.payload })
        assertEquals(listOf("b"), rows.after(read.first().id).map { it.payload })
        assertEquals(read.last().id, rows.lastId())

        assertEquals(1, rows.purge(t0.plusSeconds(60)))
        assertEquals(listOf("b"), rows.after(start).map { it.payload })
    }

    @Test
    fun `a player follows the joins, and a late quit of the old server leaves them where they are`() {
        servers.register(UUID.randomUUID(), "lobby", t0)
        servers.register(UUID.randomUUID(), "survie", t0)
        rows.join(NetworkPlayerRow(alice, "Alice", "lobby"), t0)
        rows.join(NetworkPlayerRow(alice, "Alice", "survie"), t0)
        rows.quit(alice, "lobby")

        assertEquals(listOf(NetworkPlayerRow(alice, "Alice", "survie")), rows.online(t0.minusSeconds(180)))
        rows.quit(alice, "survie")
        assertEquals(emptyList(), rows.online(t0.minusSeconds(180)))
    }

    @Test
    fun `replace leaves exactly the players a server lists`() {
        servers.register(UUID.randomUUID(), "lobby", t0)
        rows.join(NetworkPlayerRow(alice, "Alice", "lobby"), t0)
        rows.replace("lobby", listOf(NetworkPlayerRow(bob, "Bob", "lobby")), t0)

        assertEquals(listOf(bob), rows.online(t0.minusSeconds(180)).map { it.id })
    }

    @Test
    fun `the players of a server not seen recently or stopped are not online`() {
        val lobby = UUID.randomUUID()
        servers.register(lobby, "lobby", t0)
        rows.join(NetworkPlayerRow(alice, "Alice", "lobby"), t0)

        assertEquals(emptyList(), rows.online(t0.plusSeconds(60)))
        assertEquals(listOf("lobby"), rows.servers(t0.minusSeconds(60)))
        servers.stop(lobby)
        assertEquals(emptyList(), rows.online(t0.minusSeconds(60)))
        assertEquals(emptyList(), rows.servers(t0.minusSeconds(60)))
    }
}
