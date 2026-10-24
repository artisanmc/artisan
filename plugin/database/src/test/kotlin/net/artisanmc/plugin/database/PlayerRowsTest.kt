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
}
