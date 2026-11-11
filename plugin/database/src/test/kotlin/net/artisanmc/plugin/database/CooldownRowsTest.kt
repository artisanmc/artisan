package net.artisanmc.plugin.database

import net.artisanmc.modules.api.database.DatabaseDialect
import java.nio.file.Files
import java.util.logging.Logger
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals

class CooldownRowsTest {
    private val dir = Files.createTempDirectory("artisan_cooldowns_").toFile()
    private val pools = ConnectionPools(
        { DatabaseSettings.of("h2", "localhost", "3306", "minecraft", "root", "", DatabaseSettings.DEFAULT_POOL_SIZE, dir) },
        Logger.getLogger("CooldownRowsTest"),
    )
    private val ds = pools.dataSource("Artisan").also { ArtisanSchema.migrate(it, DatabaseDialect.H2, Logger.getAnonymousLogger()) }
    private val rows = CooldownRows(ds)

    @AfterTest fun teardown() = pools.closeAll()

    @Test
    fun `a cooldown is written, replaced, and read for its subject only`() {
        rows.put("daily", "p1", 5_000)
        rows.put("daily", "p1", 9_000)
        rows.put("shop", "p1", 7_000)
        rows.put("daily", "p2", 8_000)
        rows.put("event", "*", 6_000)
        assertEquals(mapOf("daily" to 9_000L, "shop" to 7_000L), rows.running("p1", 1_000))
        assertEquals(mapOf("event" to 6_000L), rows.running("*", 1_000))
    }

    @Test
    fun `expired rows are neither read nor kept by the purge`() {
        rows.put("daily", "p1", 5_000)
        rows.put("shop", "p1", 15_000)
        assertEquals(mapOf("shop" to 15_000L), rows.running("p1", 10_000))
        assertEquals(1, rows.purge(10_000))
        assertEquals(mapOf("shop" to 15_000L), rows.running("p1", 0))
    }
}
