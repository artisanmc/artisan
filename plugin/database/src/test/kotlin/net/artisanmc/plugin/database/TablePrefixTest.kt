package net.artisanmc.plugin.database

import net.artisanmc.modules.api.database.DatabaseDialect
import java.io.File
import java.nio.file.Files
import java.time.Instant
import java.util.UUID
import java.util.logging.Logger
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class TablePrefixTest {
    private val dir = Files.createTempDirectory("artisan_prefix_").toFile()
    private val pools = ConnectionPools(
        { DatabaseSettings.of("h2", "localhost", "3306", "minecraft", "root", "", DatabaseSettings.DEFAULT_POOL_SIZE, dir) },
        Logger.getLogger("TablePrefixTest"),
    )
    private val ds = pools.dataSource("Artisan")
    private val file = File(dir, "database/table-prefix")

    @AfterTest fun teardown() = pools.closeAll()

    private fun tables(): Set<String> = ds.connection.use { c ->
        c.metaData.getTables(null, "PUBLIC", "%", arrayOf("TABLE")).use { rs ->
            generateSequence { if (rs.next()) rs.getString("TABLE_NAME").lowercase() else null }.toSet()
        }
    }

    @Test
    fun `the default keeps the names from before the setting`() {
        val t = ArtisanTables.DEFAULT
        assertEquals(
            listOf("artisan_schema_version", "artisan_servers", "artisan_meta", "artisan_contents", "artisan_versions", "artisan_server_state", "artisan_drafts", "artisan_draft_receipts", "artisan_editor_sessions", "artisan_versions_project", "artisan_versions_folder", "artisan_versions_server"),
            listOf(t.schemaVersion, t.servers, t.meta, t.contents, t.versions, t.serverState, t.drafts, t.draftReceipts, t.editorSessions, t.versionsProjectIndex, t.versionsFolderIndex, t.versionsServerKey),
        )
        assertEquals("artisan_quests_", TablePrefix.module(TablePrefix.DEFAULT, "quests"))
    }

    @Test
    fun `invalid prefixes and module names are refused`() {
        for (bad in listOf("", "artisan", "Artisan_", "1x_", "a-b_", "a b_", "x;drop_", "abcdefghijklmnopq_")) {
            assertFailsWith<IllegalArgumentException>(bad) { TablePrefix.validate(bad) }
        }
        assertEquals("srv2_", TablePrefix.validate("srv2_"))
        for (bad in listOf("", "daily_rewards", "Quests", "1x", "servers", "draft", "meta")) {
            assertFailsWith<IllegalArgumentException>(bad) { TablePrefix.module("artisan_", bad) }
        }
    }

    @Test
    fun `two prefixes keep two installations apart in one database`() {
        val a = ArtisanTables("a_")
        val b = ArtisanTables("b_")
        ArtisanSchema.migrate(ds, DatabaseDialect.H2, Logger.getAnonymousLogger(), a)
        ArtisanSchema.migrate(ds, DatabaseDialect.H2, Logger.getAnonymousLogger(), b)
        assertTrue(tables().containsAll(listOf("a_servers", "b_servers", "a_versions", "b_versions")))
        val id = UUID.randomUUID()
        ServerRegistry(ds, DatabaseDialect.H2, Logger.getAnonymousLogger(), a).register(id, "survie", Instant.now())
        assertEquals(1, ServerRegistry(ds, DatabaseDialect.H2, Logger.getAnonymousLogger(), a).others(UUID.randomUUID()).size)
        assertEquals(0, ServerRegistry(ds, DatabaseDialect.H2, Logger.getAnonymousLogger(), b).others(UUID.randomUUID()).size)
    }

    @Test
    fun `a prefix changed under a filled database is refused, a first or unused one is recorded`() {
        TablePrefix.checkUnchanged("artisan_", file, ds)
        assertEquals("artisan_", file.readText().trim())
        ArtisanSchema.migrate(ds, DatabaseDialect.H2, Logger.getAnonymousLogger())

        val e = assertFailsWith<IllegalStateException> { TablePrefix.checkUnchanged("srv2_", file, ds) }
        assertTrue(e.message!!.contains("'artisan_' to 'srv2_'"))
        assertEquals("artisan_", file.readText().trim(), "a refusal keeps the previous prefix")

        // Tables renamed by hand to the new prefix: the change goes through.
        ArtisanSchema.migrate(ds, DatabaseDialect.H2, Logger.getAnonymousLogger(), ArtisanTables("srv2_"))
        TablePrefix.checkUnchanged("srv2_", file, ds)
        assertEquals("srv2_", file.readText().trim())

        // The previous prefix never held tables here: nothing to lose.
        file.writeText("ghost_\n")
        TablePrefix.checkUnchanged("other_", file, ds)
        assertEquals("other_", file.readText().trim())
    }
}
