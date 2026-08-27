package net.artisanmc.plugin

import com.fasterxml.jackson.databind.ObjectMapper
import net.artisanmc.plugin.provider.SyncedMenuProvider
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import java.io.File
import java.nio.file.Files
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * `project_read` sait dire « rien n'a bougé ».
 *
 * L'éditeur garde la dernière version connue d'un Project ; sans ce mot-là, il
 * doit rapatrier l'arbre entier à chaque ouverture pour découvrir qu'il est
 * identique — plusieurs secondes, pour rien. Il renvoie donc l'empreinte qu'on
 * lui a donnée (`if_hash`), et le plugin répond `unchanged` sans rien
 * transporter.
 *
 * L'empreinte est calculée par le PLUGIN seul et lui est simplement rendue :
 * personne d'autre ne la recalcule, donc il n'y a aucune convention
 * inter-langage à tenir.
 */
class ProjectReadIfHashTest {
    private class Harness {
        val root: File = Files.createTempDirectory("artisan_ifhash_").toFile()
        val sink: MutableList<Map<String, Any?>> = java.util.Collections.synchronizedList(mutableListOf())
        var latch = CountDownLatch(1)
        val provider = SyncedMenuProvider(
            roots = net.artisanmc.plugin.project.ProjectRoots(root),
            serverKey = "", wsUrl = "", logger = null,
        )
        init {
            provider.setSendForTesting { raw ->
                @Suppress("UNCHECKED_CAST")
                sink.add(ObjectMapper().readValue(raw, Map::class.java) as Map<String, Any?>)
                latch.countDown()
            }
        }
        fun write(projectId: String, rel: String, content: String) {
            val f = File(File(root, projectId), rel)
            f.parentFile.mkdirs()
            f.writeText(content)
        }
        fun read(projectId: String, ifHash: String? = null): Map<String, Any?> {
            latch = CountDownLatch(1)
            sink.clear()
            val hashField = if (ifHash == null) "" else ""","if_hash":"$ifHash""""
            provider.handleMessageForTesting(
                """{"type":"project_read","request_id":"r","project_id":"$projectId"$hashField}"""
            )
            assertTrue(latch.await(5, TimeUnit.SECONDS), "no reply within 5s")
            return sink.single()
        }
    }

    @Test
    fun `la reponse porte l'empreinte de ce qu'elle contient`() {
        val h = Harness()
        h.write("boutique", "menus/m.yaml", "schema: menu/v1\nsize: 27\n")
        h.provider.load()

        val hash = h.read("boutique")["hash"] as String?
        assertNotNull(hash, "project_read_result doit porter une empreinte")
        assertTrue(hash!!.isNotEmpty())
    }

    @Test
    fun `la meme empreinte rendue vaut 'rien n'a bouge', sans transporter l'arbre`() {
        val h = Harness()
        h.write("boutique", "menus/m.yaml", "schema: menu/v1\nsize: 27\n")
        h.provider.load()
        val hash = h.read("boutique")["hash"] as String

        val again = h.read("boutique", ifHash = hash)
        assertEquals(true, again["ok"])
        assertEquals(true, again["unchanged"])
        assertNull(again["files"], "un arbre inchangé ne se transporte pas")
        assertEquals(hash, again["hash"])
    }

    @Test
    fun `un rechargement qui change le contenu change l'empreinte, et l'arbre revient`() {
        val h = Harness()
        h.write("boutique", "menus/m.yaml", "schema: menu/v1\nsize: 27\n")
        h.provider.load()
        val hash = h.read("boutique")["hash"] as String

        h.write("boutique", "menus/m.yaml", "schema: menu/v1\nsize: 54\n")
        h.provider.load()

        val after = h.read("boutique", ifHash = hash)
        assertNull(after["unchanged"])
        assertNotEquals(hash, after["hash"])
        @Suppress("UNCHECKED_CAST")
        val files = after["files"] as List<Map<String, String>>
        assertEquals("schema: menu/v1\nsize: 54\n", files.single { it["path"] == "menus/m.yaml" }["content"])
    }

    @Test
    fun `une empreinte perimee ne fait pas passer un arbre pour inchange`() {
        val h = Harness()
        h.write("boutique", "menus/m.yaml", "schema: menu/v1\nsize: 27\n")
        h.provider.load()

        val reply = h.read("boutique", ifHash = "empreinte-d-un-autre-monde")
        assertNull(reply["unchanged"])
        assertNotNull(reply["files"])
    }
}
