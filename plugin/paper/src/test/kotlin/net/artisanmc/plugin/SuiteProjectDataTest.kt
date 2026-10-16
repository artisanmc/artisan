package net.artisanmc.plugin

import net.artisanmc.modules.api.DatabaseDialect
import net.artisanmc.plugin.database.ArtisanSchema
import net.artisanmc.plugin.database.ConnectionPools
import net.artisanmc.plugin.database.DatabaseSettings
import net.artisanmc.plugin.database.ServerRegistry
import net.artisanmc.plugin.database.ServerStateStore
import net.artisanmc.plugin.database.SnapshotEntry
import net.artisanmc.plugin.database.SuiteProjectData
import net.artisanmc.plugin.hub.DraftCommit
import net.artisanmc.plugin.hub.DraftReceipt
import net.artisanmc.plugin.hub.DraftStatus
import net.artisanmc.plugin.protocol.LoadedState
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

class SuiteProjectDataTest {
    private val log = Logger.getAnonymousLogger()
    private val dir = Files.createTempDirectory("artisan_suite_data_").toFile()
    private val pools = ConnectionPools({ DatabaseSettings.of("h2", "localhost", "3306", "minecraft", "root", "", DatabaseSettings.DEFAULT_POOL_SIZE, dir) }, log)
    private val ds = pools.dataSource("Artisan").also { ArtisanSchema.migrate(it, DatabaseDialect.H2, log) }
    private val registry = ServerRegistry(ds, DatabaseDialect.H2, log)
    private val hubId = UUID.randomUUID().also { registry.register(it, "hub", Instant.EPOCH) }
    private val hubRow = registry.rowId(hubId)!!
    private val hub = hubId.toString()
    private var now = 0L
    private val data = SuiteProjectData(ds, DatabaseDialect.H2, { server -> runCatching { UUID.fromString(server) }.getOrNull()?.let(registry::rowId) }, log) { now }
    private val t0 = Instant.parse("2026-10-14T10:00:00Z")

    @AfterTest fun teardown() = pools.closeAll()

    private fun state(vararg hashes: Pair<String, String>) = LoadedState.from(mapOf(
        "project_ids" to hashes.map { it.first },
        "project_roots" to hashes.map { (folder, _) -> mapOf("project_id" to folder, "project_key" to "key-$folder", "identity" to "folder") },
        "projects" to hashes.associate { (folder, hash) -> folder to mapOf("hash" to hash, "failed" to emptyList<Any>(), "meta" to mapOf(".artisan/editor.yaml" to "zoom: 1")) },
    ))

    @Test
    fun `the loaded state serves the list, a project's files with its metadata, and its drafts`() {
        data.versions.record(hubRow, "key-shop", "shop", mapOf("a.yml" to SnapshotEntry.text("one")), t0, null, null) { error("no binary") }
        data.recordState(hubRow, state("shop" to "h1"), t0)
        assertEquals(listOf("shop"), data.loaded.list(hub)!!["project_ids"])
        assertNull(data.loaded.list(hub)!!["projects"])
        val read = data.loaded.read(hub, "shop")!!
        assertEquals("h1", read["hash"])
        assertEquals(listOf(mapOf("path" to ".artisan/editor.yaml", "content" to "zoom: 1"), mapOf("path" to "a.yml", "content" to "one")), read["files"])
        assertNull(data.loaded.read(hub, "missing"))
        assertTrue(data.drafts.knownProject(hub, "shop"))
        assertFalse(data.drafts.knownProject(hub, "missing"))
        assertNull(data.drafts.drafts(hub, "missing"))
        assertTrue(data.drafts.commit(hub, "shop", DraftCommit("d1", "{\"id\":\"d1\"}", DraftStatus.ACTIVE, DraftReceipt("op-1", "f", "{}"))))
        assertEquals(listOf("{\"id\":\"d1\"}"), data.drafts.drafts(hub, "shop"))
        assertEquals("{\"id\":\"d1\"}", data.drafts.draft(hub, "shop", "d1"))
        assertEquals(DraftReceipt("op-1", "f", "{}"), data.drafts.receipt("op-1"))
        assertNull(data.loaded.list("nowhere"))
    }

    @Test
    fun `a server's state is read once per window, and again after it records or announces a reload`() {
        data.recordState(hubRow, state("shop" to "h1"), t0)
        assertEquals("h1", data.state(hub)!!.projects.getValue("shop").hash)
        // Written behind the cache's back: the copy holds until the window ends.
        ServerStateStore(ds).put(hubRow, "{\"project_ids\":[],\"project_roots\":[],\"projects\":{}}", t0.plusSeconds(1))
        assertEquals(listOf("shop"), data.state(hub)!!.list.projectIds)
        now += SuiteProjectData.CACHE_MS
        assertEquals(emptyList<Any>(), data.state(hub)!!.list.projectIds)
        // This server's own record drops its copy at once; a remote reload announcement does the same by id.
        data.recordState(hubRow, state("shop" to "h2"), t0.plusSeconds(2))
        assertEquals(listOf("shop"), data.state(hub)!!.list.projectIds)
        ServerStateStore(ds).put(hubRow, "{\"project_ids\":[\"x\"],\"project_roots\":[],\"projects\":{}}", t0.plusSeconds(3))
        data.invalidate(hub)
        assertEquals(listOf("x"), data.state(hub)!!.list.projectIds)
    }

    @Test
    fun `history comes from the versions of the folder's project`() {
        data.versions.record(hubRow, "key-shop", "shop", mapOf("a.yml" to SnapshotEntry.text("one")), t0, null, null) { error("no binary") }
        data.versions.record(hubRow, "key-shop", "shop", mapOf("a.yml" to SnapshotEntry.text("two")), t0.plusSeconds(60), null, null) { error("no binary") }
        val versions = data.history.versions(hub, "shop")!!
        assertEquals(2, versions.size)
        assertEquals(listOf("a.yml"), versions[0]["changed"])
        val latest = data.history.version(hub, "shop", versions[0]["id"] as String)!!
        assertEquals(versions[1]["id"], latest["previousId"])
        assertEquals(listOf("two", "one"), data.history.fileHistory(hub, "shop", "a.yml")!!.map { it["content"] })
        assertNull(data.history.versions(hub, "missing"))
    }
}
