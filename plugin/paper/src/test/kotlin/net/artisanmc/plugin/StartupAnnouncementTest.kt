package net.artisanmc.plugin

import net.artisanmc.plugin.project.ProjectRoots
import net.artisanmc.plugin.provider.SyncedMenuProvider
import net.artisanmc.plugin.scheduling.Scheduler
import java.io.File
import java.nio.file.Files
import java.util.Collections
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * The load made while Artisan enables is announced once the server ticks, with the Projects the
 * Add-ons registered meanwhile: the hub builds the server's pack on each `projects_reloaded`, and
 * a pack built from the first load alone misses every image of those Projects.
 */
class StartupAnnouncementTest {
    private val root: File = Files.createTempDirectory("artisan_start_").toFile()
    private val events: MutableList<Map<String, Any?>> = Collections.synchronizedList(mutableListOf())

    /** Global tasks wait for [tick], as on a server that has not started yet. */
    private val ticks = object : Scheduler by Scheduler.Direct {
        val queued = ArrayDeque<() -> Unit>()
        override fun global(task: () -> Unit) { queued += task }
        fun tick() { while (queued.isNotEmpty()) queued.removeFirst()() }
    }

    private fun provider(roots: ProjectRoots) = SyncedMenuProvider(
        roots = roots,
        logger = null,
        scheduler = ticks,
        editorEvents = { events += it },
        awaitsStart = true,
    ).also { it.setSendForTesting { } }

    /** As the plugin does: the first tick is asked for right after the load. */
    private fun SyncedMenuProvider.loadAtEnable() {
        load()
        ticks.global { serverStarted() }
    }

    private fun announced() = events.filter { it["type"] == "projects_reloaded" }
        .map { event -> (event["projects"] as List<*>).map { (it as Map<*, *>)["id"] } }

    private fun project(dir: File) {
        dir.mkdirs()
        File(dir, "main.yml").writeText("type: menu\n")
    }

    @Test
    fun `the first load is announced at the first tick, not while the server enables`() {
        project(File(root, "shop"))
        provider(ProjectRoots(root)).loadAtEnable()
        assertTrue(announced().isEmpty(), "announced before the first tick: $events")

        ticks.tick()
        assertEquals(listOf(listOf<Any?>("shop")), announced())
    }

    @Test
    fun `with an add-on's root registered before the first tick, only the whole content is announced`() {
        project(File(root, "shop"))
        val roots = ProjectRoots(root)
        provider(roots).loadAtEnable()
        // An Add-on enables after Artisan and registers its own Project.
        val addon = Files.createTempDirectory("artisan_addon_").toFile()
        project(addon)
        roots.register("guilds", addon)
        assertTrue(announced().isEmpty(), "announced before the first tick: $events")

        ticks.tick()
        assertEquals(listOf(listOf<Any?>("guilds", "shop")), announced().map { it.sortedBy { id -> id.toString() } })
    }

    @Test
    fun `a reload after the start is announced at once`() {
        val provider = provider(ProjectRoots(root))
        provider.loadAtEnable()
        ticks.tick()
        events.clear()

        project(File(root, "shop"))
        provider.load()
        assertEquals(listOf(listOf<Any?>("shop")), announced())
    }
}
