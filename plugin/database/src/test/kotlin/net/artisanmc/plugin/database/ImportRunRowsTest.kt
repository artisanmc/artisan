package net.artisanmc.plugin.database

import net.artisanmc.modules.api.database.DatabaseDialect
import java.nio.file.Files
import java.util.logging.Logger
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class ImportRunRowsTest {
    private val dir = Files.createTempDirectory("artisan_imports_").toFile()
    private val pools = ConnectionPools(
        { DatabaseSettings.of("h2", "localhost", "3306", "minecraft", "root", "", DatabaseSettings.DEFAULT_POOL_SIZE, dir) },
        Logger.getLogger("ImportRunRowsTest"),
    )
    private val ds = pools.dataSource("Artisan").also { ArtisanSchema.migrate(it, DatabaseDialect.H2, Logger.getAnonymousLogger()) }
    private val rows = ImportRunRows(ds)

    @AfterTest fun teardown() = pools.closeAll()

    private fun run(batch: String, action: String, applied: Boolean, at: Long, target: String? = null) =
        ImportRunRow(batch, "auctions:zauctionhouse", "auctions", action, applied, "console", at, target, "{\"dry_run\":${!applied}}")

    @Test
    fun `runs are logged, an applied import is found by its batch, newest first`() {
        rows.insert(run("p1", "plan", false, 1_000))
        rows.insert(run("a1", "apply", true, 2_000))
        rows.insert(run("a2", "apply", false, 3_000))
        rows.insert(run("r1", "rollback", true, 4_000, target = "a1"))

        assertEquals(run("a1", "apply", true, 2_000), rows.findApplied("a1"))
        assertNull(rows.findApplied("a2"))
        assertNull(rows.findApplied("p1"))
        assertNull(rows.findApplied("r1"))
        assertEquals(listOf("r1", "a2"), rows.recent(2).map { it.batch })
        assertEquals("a1", rows.recent(1).single().target)
    }
}
