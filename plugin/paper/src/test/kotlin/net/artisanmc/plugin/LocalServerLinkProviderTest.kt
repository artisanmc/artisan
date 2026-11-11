package net.artisanmc.plugin

import net.artisanmc.plugin.provider.SyncedMenuProvider
import java.io.File
import java.nio.file.Files
import java.util.Collections
import java.util.concurrent.TimeUnit
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** The editor served by the plugin talks to the same handlers as the WebSocket, without network. */
class LocalServerLinkProviderTest {
    private val root: File = Files.createTempDirectory("artisan_link_").toFile()
    private val sent: MutableList<String> = Collections.synchronizedList(mutableListOf())
    private val events: MutableList<Map<String, Any?>> = Collections.synchronizedList(mutableListOf())
    private val provider = SyncedMenuProvider(
        roots = net.artisanmc.plugin.project.ProjectRoots(root),
        logger = null,
        editorEvents = { events += it },
    ).also { it.setSendForTesting { raw -> sent += raw } }

    @Test
    fun `a local request is answered through the link, never the socket`() {
        File(root, "shop").mkdirs()
        File(root, "shop/main.yml").writeText("type: menu\n")
        provider.load()

        val reply = provider.link.request(mapOf("type" to "project_list")).get(5, TimeUnit.SECONDS)

        assertEquals("project_list_result", reply["type"])
        assertEquals(listOf("shop"), reply["project_ids"])
        assertTrue(sent.none { "project_list_result" in it }, "the reply stays local: $sent")
    }

    @Test
    fun `announcements reach the editor`() {
        provider.load()
        assertTrue(events.any { it["type"] == "projects_reloaded" }, "events: $events")
    }
}
