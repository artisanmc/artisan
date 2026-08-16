package net.artisanmc.plugin

import com.fasterxml.jackson.databind.ObjectMapper
import net.artisanmc.plugin.provider.SyncedMenuProvider
import net.artisanmc.plugin.sync.BundleHasher
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import java.io.File
import java.nio.file.Files
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Renommer un Document depuis l'éditeur est un **déplacement**, pas une
 * suppression suivie d'une création.
 *
 * L'arbre seul ne peut pas reconstituer cette intention : un fichier disparaît,
 * un autre apparaît. La corbeille archivait alors une suppression qui n'en était
 * pas une, et l'historique du fichier se retrouvait orphelin de son nouveau nom.
 * L'éditeur, lui, SAIT qu'il a renommé — il le dit.
 *
 * Le sens inverse reste hors de portée : un `mv` fait à la main ne laisse aucune
 * trace d'intention, seulement une disparition et une apparition.
 */
class ProjectRenameTest {
    private class Harness {
        val root: File = Files.createTempDirectory("artisan_rename_").toFile()
        val sink: MutableList<Map<String, Any?>> = java.util.Collections.synchronizedList(mutableListOf())
        val latch = CountDownLatch(1)
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
        fun project(id: String): File = File(root, id).also { it.mkdirs() }
        fun write(project: File, rel: String, content: String) {
            val f = File(project, rel)
            f.parentFile.mkdirs()
            f.writeText(content)
        }
        fun read(project: File, rel: String): String? =
            File(project, rel).takeIf { it.isFile }?.readText()
        fun historyDir(project: File, rel: String): File = File(project, ".artisan/history/$rel")
        fun send(json: String) {
            provider.handleMessageForTesting(json)
            assertTrue(latch.await(5, TimeUnit.SECONDS), "no reply within 5s")
        }
        fun reply(): Map<String, Any?> = sink.single()
    }

    private fun renameMsg(from: String, to: String, baseHash: String) =
        """{"type":"project_write","request_id":"w1","project_id":"boutique","files":[],"deletes":[],""" +
            """"renames":[{"from":"$from","to":"$to","base_hash":"$baseHash"}]}"""

    @Test
    fun `un renommage deplace le fichier au lieu de le supprimer`() {
        val h = Harness()
        val p = h.project("boutique")
        h.write(p, "menus/ancien.yaml", "title: A\n")

        h.send(renameMsg("menus/ancien.yaml", "menus/nouveau.yaml", BundleHasher.hashContent("title: A\n")))

        assertEquals(true, h.reply()["ok"])
        assertNull(h.read(p, "menus/ancien.yaml"))
        assertEquals("title: A\n", h.read(p, "menus/nouveau.yaml"))
        // Rien n'a été « supprimé » : la corbeille n'a pas à enregistrer une
        // suppression qui n'en est pas une.
        assertFalse(h.historyDir(p, "menus/ancien.yaml").exists())
    }

    @Test
    fun `l'historique du fichier suit son nouveau nom`() {
        val h = Harness()
        val p = h.project("boutique")
        h.write(p, "menus/ancien.yaml", "title: A\n")
        val histDir = File(p, ".artisan/history/menus/ancien.yaml").also { it.mkdirs() }
        File(histDir, "1700000000000").writeText("title: Tres ancien\n")

        h.send(renameMsg("menus/ancien.yaml", "menus/nouveau.yaml", BundleHasher.hashContent("title: A\n")))

        assertEquals(true, h.reply()["ok"])
        // Le passé du Document le suit : sinon renommer reviendrait à perdre sa
        // corbeille, exactement ce qu'on cherche à éviter.
        assertEquals(
            listOf("title: Tres ancien\n"),
            h.historyDir(p, "menus/nouveau.yaml").listFiles()?.map { it.readText() },
        )
        assertFalse(h.historyDir(p, "menus/ancien.yaml").exists())
    }

    @Test
    fun `un renommage passe par le compare-and-swap comme le reste`() {
        val h = Harness()
        val p = h.project("boutique")
        h.write(p, "menus/ancien.yaml", "title: Modifie ailleurs\n")

        h.send(renameMsg("menus/ancien.yaml", "menus/nouveau.yaml", BundleHasher.hashContent("title: A\n")))

        assertEquals("conflict", h.reply()["error"])
        // Tout ou rien : le fichier n'a pas bougé.
        assertEquals("title: Modifie ailleurs\n", h.read(p, "menus/ancien.yaml"))
        assertNull(h.read(p, "menus/nouveau.yaml"))
    }

    @Test
    fun `un renommage vers un nom deja pris est refuse`() {
        val h = Harness()
        val p = h.project("boutique")
        h.write(p, "menus/ancien.yaml", "title: A\n")
        h.write(p, "menus/occupe.yaml", "title: Autre menu\n")

        h.send(renameMsg("menus/ancien.yaml", "menus/occupe.yaml", BundleHasher.hashContent("title: A\n")))

        assertEquals("conflict", h.reply()["error"])
        // Écraser un fichier existant par un renommage le ferait disparaître sans
        // passer par la corbeille ni par un choix de l'admin.
        assertEquals("title: Autre menu\n", h.read(p, "menus/occupe.yaml"))
        assertEquals("title: A\n", h.read(p, "menus/ancien.yaml"))
    }
}
