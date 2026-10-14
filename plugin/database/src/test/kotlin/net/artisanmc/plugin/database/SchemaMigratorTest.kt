package net.artisanmc.plugin.database

import net.artisanmc.modules.api.DatabaseDialect
import java.nio.file.Files
import java.util.logging.Logger
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class SchemaMigratorTest {
    private val dir = Files.createTempDirectory("artisan_schema_").toFile()
    private val pools = ConnectionPools(
        { DatabaseSettings.of("h2", "localhost", "3306", "minecraft", "root", "", DatabaseSettings.DEFAULT_POOL_SIZE, dir) },
        Logger.getLogger("SchemaMigratorTest"),
    )
    private val ds = pools.dataSource("Artisan")

    @AfterTest fun teardown() = pools.closeAll()

    private fun tables(): List<String> = ds.connection.use { c ->
        c.metaData.getTables(null, "PUBLIC", "%", arrayOf("TABLE")).use { rs ->
            generateSequence { if (rs.next()) rs.getString("TABLE_NAME").lowercase() else null }.toList()
        }
    }

    @Test
    fun `applies pending migrations in order, once`() {
        val migrations = listOf(
            Migration(2, "CREATE TABLE b (id INT)"),
            Migration(1, "CREATE TABLE a (id INT)"),
        )
        SchemaMigrator(ds, DatabaseDialect.H2, "test_schema_version", Logger.getAnonymousLogger()).apply(migrations)
        SchemaMigrator(ds, DatabaseDialect.H2, "test_schema_version", Logger.getAnonymousLogger()).apply(migrations)
        assertEquals(setOf("a", "b", "test_schema_version"), tables().toSet())
        assertEquals(2, SchemaMigrator(ds, DatabaseDialect.H2, "test_schema_version", Logger.getAnonymousLogger()).version())
    }

    @Test
    fun `a failing migration stops there and is not recorded`() {
        val migrator = SchemaMigrator(ds, DatabaseDialect.H2, "test_schema_version", Logger.getAnonymousLogger())
        assertFailsWith<IllegalStateException> {
            migrator.apply(listOf(Migration(1, "CREATE TABLE a (id INT)"), Migration(2, "NOT SQL"), Migration(3, "CREATE TABLE c (id INT)")))
        }
        assertEquals(1, migrator.version())
        assertEquals(setOf("a", "test_schema_version"), tables().toSet())
    }
}
