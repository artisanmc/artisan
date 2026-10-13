package net.artisanmc.plugin

import com.fasterxml.jackson.databind.ObjectMapper
import net.artisanmc.plugin.provider.SyncedMenuProvider
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import java.io.File
import java.nio.file.Files

/**
 * Le plugin annonce ses rechargements.
 *
 * Une édition faite à la main sur le disque ne compte qu'au reload — c'est la
 * sémantique de tous les plugins Minecraft, et celle qu'Artisan tient. Mais
 * l'éditeur, lui, n'a aucun moyen de savoir que ce moment est arrivé : il
 * garderait sa dernière version connue jusqu'à ce que quelqu'un pense à
 * actualiser. Le reload est donc poussé, avec l'empreinte de chaque Project —
 * celui qui l'a déjà n'a rien à refaire.
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
        assertNotNull(push, "le rechargement doit être annoncé")
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

        // Édition à la main PUIS reload : c'est le moment où le serveur, et donc
        // l'éditeur, doit en tenir compte.
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
        // Deux empreintes différentes pour le même instantané feraient rapatrier
        // l'arbre à chaque reload, exactement ce qu'on cherche à éviter.
        assertEquals(announced, read["hash"])
    }
}
