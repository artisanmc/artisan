package net.artisanmc.plugin.database

import net.artisanmc.modules.api.database.DatabaseDialect
import java.nio.file.Files
import java.util.logging.Logger
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals

class VariableRowsTest {
    private val dir = Files.createTempDirectory("artisan_vars_").toFile()
    private val pools = ConnectionPools(
        { DatabaseSettings.of("h2", "localhost", "3306", "minecraft", "root", "", DatabaseSettings.DEFAULT_POOL_SIZE, dir) },
        Logger.getLogger("VariableRowsTest"),
    )
    private val ds = pools.dataSource("Artisan").also { ArtisanSchema.migrate(it, DatabaseDialect.H2, Logger.getAnonymousLogger()) }
    private val rows = VariableRows(ds)

    @AfterTest fun teardown() = pools.closeAll()

    private fun row(owner: String, name: String, value: String?, expiresAt: Long = 0, updatedAt: Long) =
        VariableRows.Row(owner, name, value, expiresAt, updatedAt)

    @Test
    fun `a value is written, replaced by a later write, and read for its owner only`() {
        rows.put(row("p1", "rpg/last_death", "1", updatedAt = 10))
        rows.put(row("p1", "rpg/last_death", "2", updatedAt = 20))
        rows.put(row("p2", "rpg/last_death", "3", updatedAt = 10))
        rows.put(row("*", "rpg/season", "\"winter\"", updatedAt = 10))
        assertEquals(listOf(row("p1", "rpg/last_death", "2", updatedAt = 20)), rows.of("p1", 0))
        assertEquals(listOf(row("*", "rpg/season", "\"winter\"", updatedAt = 10)), rows.of("*", 0))
    }

    @Test
    fun `an older write arriving late does not replace a newer one`() {
        rows.put(row("p1", "rpg/coins", "5", updatedAt = 20))
        rows.put(row("p1", "rpg/coins", "4", updatedAt = 10))
        assertEquals("5", rows.of("p1", 0).single().value)
    }

    @Test
    fun `a clear is kept as a row without value, expired rows are not read, the purge drops both`() {
        rows.put(row("p1", "rpg/a", "1", updatedAt = 10))
        rows.put(row("p1", "rpg/a", null, updatedAt = 20))
        rows.put(row("p1", "rpg/b", "1", expiresAt = 5_000, updatedAt = 10))
        rows.put(row("p1", "rpg/c", "1", updatedAt = 10))
        assertEquals(listOf(row("p1", "rpg/a", null, updatedAt = 20), row("p1", "rpg/c", "1", updatedAt = 10)), rows.of("p1", 10_000).sortedBy { it.name })
        assertEquals(2, rows.purge(10_000, clearedBefore = 30))
        assertEquals(listOf("rpg/c"), rows.of("p1", 0).map { it.name })
    }
}
