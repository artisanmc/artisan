package net.artisanmc.plugin.database

import net.artisanmc.modules.api.database.DatabaseDialect
import java.nio.file.Files
import java.time.Instant
import java.util.UUID
import java.util.logging.Logger
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class EmbeddedImportTest {
    private val log = Logger.getAnonymousLogger()
    private fun pools(dir: java.io.File) =
        ConnectionPools({ DatabaseSettings.of("h2", "localhost", "3306", "minecraft", "root", "", DatabaseSettings.DEFAULT_POOL_SIZE, dir) }, log)
    private val sourceDir = Files.createTempDirectory("artisan_import_from").toFile()
    private val sourcePools = pools(sourceDir)
    private val targetPools = pools(Files.createTempDirectory("artisan_import_to").toFile())
    private val source = sourcePools.dataSource("Artisan").also { ArtisanSchema.migrate(it, DatabaseDialect.H2, log) }
    private val target = targetPools.dataSource("Artisan").also { ArtisanSchema.migrate(it, DatabaseDialect.H2, log) }
    private val survie = UUID.randomUUID()
    private val t0 = Instant.parse("2026-10-14T10:00:00Z")

    @AfterTest fun teardown() { sourcePools.closeAll(); targetPools.closeAll() }

    private fun seedSource() {
        val registry = ServerRegistry(source, DatabaseDialect.H2, log)
        registry.register(UUID.randomUUID(), "other", t0)
        registry.register(survie, "survie", t0)
        val row = registry.rowId(survie)!!
        val versions = VersionStore(source)
        versions.record(row, "k", "shop", mapOf("a.yml" to SnapshotEntry.text("one")), t0, null, null) { error("no binary") }
        val first = versions.versions(row, "shop")!!.single().id
        versions.record(row, "k", "shop", mapOf("a.yml" to SnapshotEntry.text("two")), t0.plusSeconds(60), VersionAuthor("u", "Iban"), first) { error("no binary") }
        DraftRows(source).commit(row, "k", "d1", "{\"id\":\"d1\"}", "active", "op", "f", "{}")
    }

    @Test
    fun `a server's versions and drafts move to the new database, ids reassigned by server id`() {
        seedSource()
        // The hub registered first on the shared database: same numeric ids, another server.
        val registry = ServerRegistry(target, DatabaseDialect.H2, log)
        registry.register(UUID.randomUUID(), "lobby", t0)
        registry.register(survie, "survie", t0)
        val row = registry.rowId(survie)!!

        assertTrue(EmbeddedImport.run(source, target, DatabaseDialect.H2, survie, log))
        val versions = VersionStore(target).versions(row, "shop")!!
        assertEquals(2, versions.size)
        assertEquals(versions[1].id, versions[0].restoredFrom)
        assertEquals("two", VersionStore(target).latest(row, "shop")!!.files["a.yml"])
        assertEquals("{\"id\":\"d1\"}", DraftRows(target).get(row, "k", "d1"))
        assertEquals(null, VersionStore(target).versions(registry.rowId("lobby")!!, "shop"))
    }

    @Test
    fun `nothing is imported twice, nor over versions already recorded`() {
        seedSource()
        val registry = ServerRegistry(target, DatabaseDialect.H2, log)
        registry.register(survie, "survie", t0)
        assertTrue(EmbeddedImport.run(source, target, DatabaseDialect.H2, survie, log))
        assertFalse(EmbeddedImport.run(source, target, DatabaseDialect.H2, survie, log))
        assertEquals(2, VersionStore(target).versions(registry.rowId(survie)!!, "shop")!!.size)
    }

    @Test
    fun `a failed import leaves no mark and runs again, a done one is marked for good`() {
        seedSource()
        val registry = ServerRegistry(target, DatabaseDialect.H2, log)
        registry.register(survie, "survie", t0)
        val row = registry.rowId(survie)!!
        // A draft already there: the import's insert fails, everything rolls back.
        DraftRows(target).commit(row, "k", "d1", "{\"id\":\"d1\"}", "active", "op-x", "f", "{}")
        assertFailsWith<Exception> { EmbeddedImport.run(source, target, DatabaseDialect.H2, survie, log) }
        assertEquals(null, VersionStore(target).versions(row, "shop"))
        target.connection.use { c -> c.prepareStatement("DELETE FROM artisan_drafts").use { it.executeUpdate() } }
        assertTrue(EmbeddedImport.run(source, target, DatabaseDialect.H2, survie, log))
        assertEquals(2, VersionStore(target).versions(row, "shop")!!.size)
        // Marked: a Version recorded since, or none at all, changes nothing.
        assertFalse(EmbeddedImport.run(source, target, DatabaseDialect.H2, survie, log))
    }

    @Test
    fun `versions recorded before the mark existed count as imported`() {
        seedSource()
        val registry = ServerRegistry(target, DatabaseDialect.H2, log)
        registry.register(survie, "survie", t0)
        val row = registry.rowId(survie)!!
        VersionStore(target).record(row, "k", "shop", mapOf("a.yml" to SnapshotEntry.text("mine")), t0, null, null) { error("no binary") }
        assertFalse(EmbeddedImport.run(source, target, DatabaseDialect.H2, survie, log))
        assertEquals(1, VersionStore(target).versions(row, "shop")!!.size)
        assertFalse(EmbeddedImport.run(source, target, DatabaseDialect.H2, survie, log))
    }

    @Test
    fun `a server unknown to the embedded database imports nothing`() {
        seedSource()
        val other = UUID.randomUUID()
        ServerRegistry(target, DatabaseDialect.H2, log).register(other, "survival", t0)
        assertFalse(EmbeddedImport.run(source, target, DatabaseDialect.H2, other, log))
        assertTrue(sourceDir.resolve("database/${ConnectionPools.H2_FILE}.mv.db").isFile)
    }
}
