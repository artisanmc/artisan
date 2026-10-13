package net.artisanmc.plugin

import com.fasterxml.jackson.databind.ObjectMapper
import net.artisanmc.plugin.provider.SyncedMenuProvider
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import java.io.File
import java.nio.file.Files

/**
 * The plugin announces its reloads.
 *
 * A hand edit on disk only counts at reload: the semantics of every Minecraft plugin,
 * and the ones Artisan keeps. But the editor has no way to know that moment came: it
 * would keep its last known version until someone thinks of refreshing. So the reload
 * is pushed, with each Project's fingerprint; an editor that already has it has
 * nothing to redo.
 */
class ProjectsReloadedPushTest {
    private class Harness {
        val root: File = Files.createTempDirectory("artisan_reload_push_").toFile()
        val sink: MutableList<Map<String, Any?>> = java.util.Collections.synchronizedList(mutableListOf())
        val provider = SyncedMenuProvider(
            roots = net.artisanmc.plugin.project.ProjectRoots(root),
            logger = null,
        )
        init {
            provider.setSendForTesting { raw ->
                @Suppress("UNCHECKED_CAST")
                sink.add(ObjectMapper().readValue(raw, Map::class.java) as Map<String, Any?>)
            }
        }
        fun write(projectId: String, rel: String, content: String) {
            val f = File(File(root, projectId), rel)
            f.parentFile.mkdirs()
            f.writeText(content)
        }
        fun pushes(): List<Map<String, Any?>> = sink.filter { it["type"] == "projects_reloaded" }
    }

    @Test
    fun `un chargement annonce les Projects et leur empreinte`() {
        val h = Harness()
        h.write("boutique", "menus/m.yaml", "schema: menu/v1\nsize: 27\n")
        h.provider.load()

        val push = h.pushes().lastOrNull()
        assertNotNull(push, "the reload must be announced")
        @Suppress("UNCHECKED_CAST")
        val projects = push!!["projects"] as List<Map<String, Any?>>
        val boutique = projects.single { it["id"] == "boutique" }
        assertNotNull(boutique["hash"])
        assertTrue((boutique["hash"] as String).isNotEmpty())
    }

    @Test
    fun `l'empreinte annoncee suit le contenu`() {
        val h = Harness()
        h.write("boutique", "menus/m.yaml", "schema: menu/v1\nsize: 27\n")
        h.provider.load()
        @Suppress("UNCHECKED_CAST")
        val first = (h.pushes().last()["projects"] as List<Map<String, Any?>>).single()["hash"] as String

        // Hand edit THEN reload: the moment the server, and so the editor, must
        // take it into account.
        h.write("boutique", "menus/m.yaml", "schema: menu/v1\nsize: 54\n")
        h.provider.load()
        @Suppress("UNCHECKED_CAST")
        val second = (h.pushes().last()["projects"] as List<Map<String, Any?>>).single()["hash"] as String

        assertNotEquals(first, second)
    }

    @Test
    fun `l'empreinte annoncee est celle que project_read rendra`() {
        val h = Harness()
        h.write("boutique", "menus/m.yaml", "schema: menu/v1\nsize: 27\n")
        h.provider.load()
        @Suppress("UNCHECKED_CAST")
        val announced = (h.pushes().last()["projects"] as List<Map<String, Any?>>).single()["hash"] as String

        h.sink.clear()
        h.provider.handleMessageForTesting(
            """{"type":"project_read","request_id":"r","project_id":"boutique"}"""
        )
        Thread.sleep(300)
        val read = h.sink.single { it["type"] == "project_read_result" }
        // Two different fingerprints for the same snapshot would refetch the tree
        // on every reload, exactly what this avoids.
        assertEquals(announced, read["hash"])
    }
}
