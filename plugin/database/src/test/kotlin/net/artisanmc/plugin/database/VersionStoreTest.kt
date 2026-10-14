package net.artisanmc.plugin.database

import net.artisanmc.modules.api.DatabaseDialect
import java.nio.file.Files
import java.time.Instant
import java.util.UUID
import java.util.logging.Logger
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class VersionStoreTest {
    private val dir = Files.createTempDirectory("artisan_versions_").toFile()
    private val pools = ConnectionPools(
        { DatabaseSettings.of("h2", "localhost", "3306", "minecraft", "root", "", DatabaseSettings.DEFAULT_POOL_SIZE, dir) },
        Logger.getLogger("VersionStoreTest"),
    )
    private val ds = pools.dataSource("Artisan").also { ArtisanSchema.migrate(it, DatabaseDialect.H2, Logger.getAnonymousLogger()) }
    private val store = VersionStore(ds)
    private val servers = ServerRegistry(ds, DatabaseDialect.H2, Logger.getAnonymousLogger())
    private val survie = UUID.randomUUID().also { servers.register(it, "survie", Instant.EPOCH) }
    private val server = servers.rowId(survie)!!
    private val t0 = Instant.parse("2026-10-14T10:00:00Z")
    private val iban = VersionAuthor(UUID.randomUUID().toString(), "Iban")
    private val read = mutableListOf<String>()

    @AfterTest fun teardown() = pools.closeAll()

    private fun text(vararg files: Pair<String, String>) = files.associate { (path, content) ->
        path to SnapshotEntry.text(content)
    }

    private fun record(@Suppress("UNUSED_PARAMETER") label: String, entries: Map<String, SnapshotEntry>, at: Instant, author: VersionAuthor? = null, folder: String = "shop") =
        store.record(server, "key-1", folder, entries, at, author) { path -> read += path; "png:$path".toByteArray() }

    @Test
    fun `a differing snapshot becomes a version, an identical one does not`() {
        assertTrue(record("h1", text("a.yml" to "one"), t0, iban))
        assertFalse(record("h1", text("a.yml" to "one"), t0.plusSeconds(60)))
        assertTrue(record("h2", text("a.yml" to "two"), t0.plusSeconds(120)))

        val versions = store.versions(server, "shop")!!
        assertEquals(2, versions.size)
        assertEquals(64, versions[0].hash.length)
        assertNull(versions[0].author)
        assertEquals(iban, versions[1].author)
        assertEquals(listOf("a.yml"), versions[0].changed)
    }

    @Test
    fun `contents are stored once, binaries read from disk only when new`() {
        val png = SnapshotEntry.binary("b".repeat(64), 3)
        record("h1", text("a.yml" to "same") + ("logo.png" to png), t0)
        record("h2", text("a.yml" to "same", "b.yml" to "new") + ("logo.png" to png), t0.plusSeconds(60))
        assertEquals(listOf("logo.png"), read)
        assertEquals(3, store.contentCount())
    }

    @Test
    fun `a version gives its files, binaries and previous version`() {
        record("h1", text("a.yml" to "one"), t0)
        record("h2", text("a.yml" to "two") + ("logo.png" to SnapshotEntry.binary("c".repeat(64), 7)), t0.plusSeconds(60))
        val (latest, first) = store.versions(server, "shop")!!
        val version = store.version(server, "shop", latest.id)!!
        assertEquals(first.id, version.previousId)
        assertEquals(mapOf("a.yml" to "two"), version.files)
        assertEquals(listOf(VersionBinary("logo.png", "c".repeat(64), 7)), version.binaries)
        assertNull(store.version(server, "shop", 999_999))
    }

    @Test
    fun `file history keeps the versions where that file changed`() {
        record("h1", text("a.yml" to "one", "b.yml" to "x"), t0, iban)
        record("h2", text("a.yml" to "one", "b.yml" to "y"), t0.plusSeconds(60))
        record("h3", text("a.yml" to "two", "b.yml" to "y"), t0.plusSeconds(120))
        val history = store.fileHistory(server, "shop", "a.yml")!!
        assertEquals(listOf("two", "one"), history.map { it.content })
        assertEquals(listOf(null, iban), history.map { it.author })
    }

    @Test
    fun `a renamed folder keeps its history`() {
        record("h1", text("a.yml" to "one"), t0)
        record("h2", text("a.yml" to "two"), t0.plusSeconds(60), folder = "boutique")
        assertEquals(2, store.versions(server, "boutique")!!.size)
        assertNull(store.versions(server, "shop"))
    }
}
