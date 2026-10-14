package net.artisanmc.plugin.database

import net.artisanmc.modules.api.DatabaseDialect
import java.nio.file.Files
import java.time.Instant
import java.util.UUID
import java.util.logging.Logger
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals

class ServerRegistryTest {
    private val dir = Files.createTempDirectory("artisan_servers_").toFile()
    private val pools = ConnectionPools(
        { DatabaseSettings.of("h2", "localhost", "3306", "minecraft", "root", "", DatabaseSettings.DEFAULT_POOL_SIZE, dir) },
        Logger.getLogger("ServerRegistryTest"),
    )
    private val registry = pools.dataSource("Artisan").let {
        ArtisanSchema.migrate(it, DatabaseDialect.H2, Logger.getAnonymousLogger())
        ServerRegistry(it, DatabaseDialect.H2, Logger.getAnonymousLogger())
    }
    private val t0 = Instant.parse("2026-10-14T10:00:00Z")

    @AfterTest fun teardown() = pools.closeAll()

    @Test
    fun `a server registers once and is listed by the others with its last presence`() {
        val lobby = UUID.randomUUID()
        val survie = UUID.randomUUID()
        registry.register(lobby, "lobby", t0)
        registry.register(survie, "survie", t0)
        registry.touch(survie, t0.plusSeconds(60))

        assertEquals(listOf(KnownServer("survie", t0.plusSeconds(60))), registry.others(lobby))
        assertEquals(listOf("lobby", "survie"), registry.others(UUID.randomUUID()).map { it.name })
    }

    @Test
    fun `registering again keeps the same row`() {
        val id = UUID.randomUUID()
        registry.register(id, "survie", t0)
        registry.register(id, "survie", t0.plusSeconds(120))
        assertEquals(listOf(KnownServer("survie", t0.plusSeconds(120))), registry.others(UUID.randomUUID()))
    }

    @Test
    fun `the server id is generated once`() {
        val file = dir.resolve("server-id")
        val first = ServerIdFile.read(file)
        assertEquals(first, ServerIdFile.read(file))
        file.delete()
        assertNotEquals(first, ServerIdFile.read(file))
    }
}
