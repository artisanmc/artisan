package net.artisanmc.plugin.database

import net.artisanmc.modules.api.database.DatabaseDialect
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

        assertEquals(listOf(KnownServer("survie", t0.plusSeconds(60), survie.toString())), registry.others(lobby))
        assertEquals(listOf("lobby", "survie"), registry.others(UUID.randomUUID()).map { it.name })
    }

    @Test
    fun `registering again keeps the same row`() {
        val id = UUID.randomUUID()
        registry.register(id, "survie", t0)
        registry.register(id, "survie", t0.plusSeconds(120))
        assertEquals(listOf(KnownServer("survie", t0.plusSeconds(120), id.toString())), registry.others(UUID.randomUUID()))
    }

    @Test
    fun `a new name on the same server id renames its row`() {
        val id = UUID.randomUUID()
        registry.register(id, "data", t0)
        registry.stop(id)
        assertEquals(Registration.Renamed("data"), registry.register(id, "survie", t0.plusSeconds(30)))
        assertEquals(listOf("survie"), registry.others(UUID.randomUUID()).map { it.name })
    }

    @Test
    fun `a crashed server renamed after two minutes is renamed too`() {
        val id = UUID.randomUUID()
        registry.register(id, "data", t0)
        assertEquals(Registration.Renamed("data"), registry.register(id, "survie", t0.plusSeconds(180)))
    }

    @Test
    fun `a copied server id is refused while its original runs`() {
        val id = UUID.randomUUID()
        registry.register(id, "survie", t0)
        assertEquals(Registration.CopiedId("survie"), registry.register(id, "survie2", t0.plusSeconds(30)))
        assertEquals(listOf("survie"), registry.others(UUID.randomUUID()).map { it.name })
    }

    @Test
    fun `a name held by another server id is refused`() {
        registry.register(UUID.randomUUID(), "survie", t0)
        val other = UUID.randomUUID()
        assertEquals(Registration.NameTaken, registry.register(other, "survie", t0.plusSeconds(600)))
        registry.register(other, "lobby", t0)
        assertEquals(Registration.NameTaken, registry.register(other, "survie", t0.plusSeconds(600)))
    }

    @Test
    fun `the database id is generated once and shared`() {
        val ds = pools.dataSource("Artisan")
        val id = ArtisanMeta.databaseId(ds)
        assertEquals(id, ArtisanMeta.databaseId(pools.dataSource("Other")))
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
