package net.artisanmc.plugin.database

import net.artisanmc.modules.api.database.DatabaseDialect
import java.nio.file.Files
import java.time.Instant
import java.util.logging.Logger
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class SettingRowsTest {
    private val dir = Files.createTempDirectory("artisan_settings_").toFile()
    private val pools = ConnectionPools(
        { DatabaseSettings.of("h2", "localhost", "3306", "minecraft", "root", "", DatabaseSettings.DEFAULT_POOL_SIZE, dir) },
        Logger.getLogger("SettingRowsTest"),
    )
    private val ds = pools.dataSource("Artisan").also { ArtisanSchema.migrate(it, DatabaseDialect.H2, Logger.getAnonymousLogger()) }
    private val rows = SettingRows(ds)

    @AfterTest fun teardown() = pools.closeAll()

    @Test
    fun `a setting is written, replaced, then deleted`() {
        assertNull(rows.get("ai"))
        rows.put("ai", """{"model":"a"}""", Instant.EPOCH)
        rows.put("ai", """{"model":"b"}""", Instant.EPOCH.plusSeconds(1))
        assertEquals("""{"model":"b"}""", rows.get("ai"))
        rows.delete("ai")
        assertNull(rows.get("ai"))
    }
}
