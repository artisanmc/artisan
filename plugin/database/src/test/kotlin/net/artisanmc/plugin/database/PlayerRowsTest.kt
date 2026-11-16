package net.artisanmc.plugin.database

import net.artisanmc.modules.api.database.DatabaseDialect
import java.nio.file.Files
import java.util.UUID
import java.util.logging.Logger
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class PlayerRowsTest {
    @Test
    fun `a name finds the player last seen under it, whatever its case`() {
        val old = UUID.randomUUID()
        val new = UUID.randomUUID()
        rows.seen(old, "Steve", 1_000)
        rows.seen(new, "steve", 2_000)
        assertEquals(new, rows.findByName("STEVE"))
        assertEquals(null, rows.findByName("Alex"))
    }

    private val dir = Files.createTempDirectory("artisan_players_").toFile()
    private val pools = ConnectionPools(
        { DatabaseSettings.of("h2", "localhost", "3306", "minecraft", "root", "", DatabaseSettings.DEFAULT_POOL_SIZE, dir) },
        Logger.getLogger("PlayerRowsTest"),
    )
    private val ds = pools.dataSource("Artisan").also { ArtisanSchema.migrate(it, DatabaseDialect.H2, Logger.getAnonymousLogger()) }
    private val rows = PlayerRows(ds)
    private val steve = UUID.randomUUID()

    @AfterTest fun teardown() = pools.closeAll()

    @Test
    fun `a player is created on their first visit, then follows their name and visits`() {
        assertNull(rows.get(steve))
        rows.seen(steve, "Steve", 1_000)
        assertEquals(PlayerRow(steve, "Steve", 1_000, 1_000, 0), rows.get(steve))
        rows.addPlaytime(steve, 60_000, 61_000)
        rows.seen(steve, "Steve2", 100_000)
        rows.addPlaytime(steve, 30_000, 130_000)
        assertEquals(PlayerRow(steve, "Steve2", 1_000, 130_000, 90_000), rows.get(steve))
    }

    @Test
    fun `play time never goes down`() {
        rows.seen(steve, "Steve", 1_000)
        rows.addPlaytime(steve, -5, 2_000)
        assertEquals(0, rows.get(steve)?.playtimeMs)
    }

    @Test
    fun `a search finds names by their start, the latest seen first, and ids give their names`() {
        val alex = UUID.randomUUID()
        val under = UUID.randomUUID()
        rows.seen(steve, "Steve", 1_000)
        rows.seen(alex, "stella", 2_000)
        rows.seen(under, "s_x", 3_000)
        assertEquals(listOf(alex to "stella", steve to "Steve"), rows.search("ST", 10))
        assertEquals(listOf(under to "s_x"), rows.search("s_", 10))
        assertEquals(listOf(alex to "stella"), rows.search("st", 1))
        assertEquals(setOf(steve to "Steve", under to "s_x"), rows.names(listOf(steve, under, UUID.randomUUID())).toSet())
    }
}
