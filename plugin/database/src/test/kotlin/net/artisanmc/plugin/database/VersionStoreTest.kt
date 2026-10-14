package net.artisanmc.plugin.database

import net.artisanmc.modules.api.DatabaseDialect
import java.nio.file.Files
import java.time.Instant
import java.util.UUID
import java.util.logging.Logger
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
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

    private fun record(
        @Suppress("UNUSED_PARAMETER") label: String, entries: Map<String, SnapshotEntry>, at: Instant,
        author: VersionAuthor? = null, folder: String = "shop", restoredFrom: Int? = null,
    ) = store.record(server, "key-1", folder, entries, at, author, restoredFrom) { path -> read += path; bytes(path) }.recorded

    private fun bytes(path: String) = "png:$path".toByteArray()
    private fun png(path: String, size: Long = 3) = SnapshotEntry.binary(hashOf(bytes(path)), size)
    private fun hashOf(bytes: ByteArray) =
        java.security.MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

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
        val png = png("logo.png")
        record("h1", text("a.yml" to "same") + ("logo.png" to png), t0)
        record("h2", text("a.yml" to "same", "b.yml" to "new") + ("logo.png" to png), t0.plusSeconds(60))
        assertEquals(listOf("logo.png"), read)
        assertEquals(3, store.contentCount())
    }

    @Test
    fun `a binary whose bytes changed since the snapshot is not stored under the snapshot's hash`() {
        val stale = SnapshotEntry.binary("b".repeat(64), 3)
        val result = store.record(server, "key-1", "shop", text("a.yml" to "one") + ("logo.png" to stale), t0, null, null) { bytes(it) }
        assertTrue(result.recorded)
        assertEquals(listOf("logo.png"), result.skipped)
        assertEquals(1, store.contentCount())
        assertNull(store.latestBinary(server, "shop", "logo.png"))
        // The next Snapshot carries the real hash: stored then.
        assertTrue(record("h2", text("a.yml" to "one") + ("logo.png" to png("logo.png")), t0.plusSeconds(60)))
        assertEquals("png:logo.png", String(store.latestBinary(server, "shop", "logo.png")!!))
    }

    @Test
    fun `a failed record leaves neither version nor contents behind`() {
        val entries = text("a.yml" to "one") + ("logo.png" to png("logo.png"))
        assertFailsWith<IllegalStateException> {
            store.record(server, "key-1", "shop", entries, t0, null, null) { error("disk gone") }
        }
        assertEquals(0, store.contentCount())
        assertNull(store.versions(server, "shop"))
        assertTrue(record("h1", entries, t0))
    }

    @Test
    fun `a content already stored by another server is not an error`() {
        val other = UUID.randomUUID().also { servers.register(it, "lobby", Instant.EPOCH) }.let { servers.rowId(it)!! }
        val entries = text("a.yml" to "same") + ("logo.png" to png("logo.png"))
        assertTrue(store.record(other, "key-2", "shop", entries, t0, null, null) { bytes(it) }.recorded)
        assertTrue(record("h1", entries, t0))
        assertEquals(2, store.contentCount())
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
    fun `a restored version says where it comes from, and gives back its binaries`() {
        record("h1", text("a.yml" to "one") + ("logo.png" to png("logo.png", 12)), t0)
        val first = store.versions(server, "shop")!!.single()
        record("h2", text("a.yml" to "one", "b.yml" to "two"), t0.plusSeconds(60))
        record("h3", text("a.yml" to "one") + ("logo.png" to png("logo.png", 12)), t0.plusSeconds(120), iban, restoredFrom = first.id)
        assertEquals(first.id, store.versions(server, "shop")!![0].restoredFrom)
        assertEquals("png:logo.png", String(store.binary(server, "shop", first.id, "logo.png")!!))
        assertNull(store.binary(server, "shop", first.id, "a.yml"))
    }

    @Test
    fun `the latest version is what the editor opens`() {
        record("h1", text("a.yml" to "one"), t0)
        record("h2", text("a.yml" to "two") + ("logo.png" to png("logo.png", 5)), t0.plusSeconds(60))
        val latest = store.latest(server, "shop")!!
        assertEquals(mapOf("a.yml" to "two"), latest.files)
        assertEquals("png:logo.png", String(store.latestBinary(server, "shop", "logo.png")!!))
        assertNull(store.latest(server, "missing"))
    }

    @Test
    fun `the loaded state of a server is kept whole`() {
        val states = ServerStateStore(ds)
        assertNull(states.get(server))
        states.put(server, "{\"a\":1}", t0)
        states.put(server, "{\"a\":2}", t0.plusSeconds(1))
        assertEquals("{\"a\":2}", states.get(server))
    }

    @Test
    fun `a renamed folder keeps its history`() {
        record("h1", text("a.yml" to "one"), t0)
        record("h2", text("a.yml" to "two"), t0.plusSeconds(60), folder = "boutique")
        assertEquals(2, store.versions(server, "boutique")!!.size)
        assertNull(store.versions(server, "shop"))
        assertEquals(mapOf("a.yml" to "two"), store.latest(server, "boutique")!!.files)
        assertNull(store.latest(server, "shop"))
        val (latest, first) = store.versions(server, "boutique")!!
        assertEquals(first.id, store.version(server, "boutique", latest.id)!!.previousId)
        assertNull(store.version(server, "shop", first.id))
    }
}
