package net.artisanmc.plugin

import com.fasterxml.jackson.databind.node.ObjectNode
import net.artisanmc.modules.api.database.DatabaseDialect
import net.artisanmc.plugin.database.ArtisanSchema
import net.artisanmc.plugin.database.ConnectionPools
import net.artisanmc.plugin.database.DatabaseSettings
import net.artisanmc.plugin.database.LateSuiteData
import net.artisanmc.plugin.database.ServerRegistry
import net.artisanmc.plugin.database.SuiteProjectData
import net.artisanmc.plugin.hub.Call
import net.artisanmc.plugin.hub.ProjectDrafts
import net.artisanmc.plugin.project.LoadedState
import net.artisanmc.plugin.project.ProjectListing
import net.artisanmc.plugin.project.ProjectRootInfo
import java.nio.file.Files
import java.time.Instant
import java.util.UUID
import java.util.logging.Logger
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class LateSuiteDataTest {
    private val log = Logger.getAnonymousLogger()
    private val dir = Files.createTempDirectory("artisan_late_data_").toFile()
    private val pools = ConnectionPools({ DatabaseSettings.of("h2", "localhost", "3306", "minecraft", "root", "", DatabaseSettings.DEFAULT_POOL_SIZE, dir) }, log)
    @Volatile private var data: SuiteProjectData? = null
    private val late = LateSuiteData { data }

    @AfterTest fun teardown() = pools.closeAll()

    private fun draft(server: String, action: String, vararg fields: Pair<String, Any?>): Map<String, Any?> {
        var out: Map<String, Any?> = emptyMap()
        val request = Call.mapper.valueToTree<ObjectNode>(mapOf("owner_id" to "alice", "action" to action) + fields)
        ProjectDrafts(late.drafts).handle(server, "shop", request, { _, reply -> reply(mapOf("ok" to true)) }) { out = it }
        return out
    }

    @Test
    fun `before the database opens, reads are absent and drafts are refused with storage_error`() {
        assertNull(late.loaded.list("u-hub"))
        assertNull(late.history.versions("u-hub", "shop"))
        val refused = draft("u-hub", "list")
        assertEquals(false, refused["ok"])
        assertEquals("storage_error", refused["error"])
    }

    @Test
    fun `once the database is open, the same objects serve it`() {
        val ds = pools.dataSource("Artisan").also { ArtisanSchema.migrate(it, DatabaseDialect.H2, log) }
        val registry = ServerRegistry(ds, DatabaseDialect.H2, log)
        val hub = UUID.randomUUID().also { registry.register(it, "hub", Instant.EPOCH) }
        val row = registry.rowId(hub)!!
        val opened = SuiteProjectData(ds, DatabaseDialect.H2, { runCatching { UUID.fromString(it) }.getOrNull()?.let(registry::rowId) }, log)
        opened.recordState(row, LoadedState(ProjectListing(listOf("shop"), listOf(ProjectRootInfo("shop", projectKey = "k-1"))), emptyMap()), Instant.EPOCH)
        data = opened
        assertEquals(listOf("shop"), late.loaded.list(hub.toString())!!["project_ids"])
        assertTrue(late.drafts.knownProject(hub.toString(), "shop"))
        assertEquals(true, draft(hub.toString(), "list")["ok"])
    }
}
