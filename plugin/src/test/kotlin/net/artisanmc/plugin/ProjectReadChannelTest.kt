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
 * `project_read` — l'éditeur lit l'arbre complet d'un Project depuis le disque du
 * serveur (ADR `server-disk-only-storage`, P0). Généralise `config_read`, qui ne
 * portait qu'une Table d'écran de config.
 *
 * Différence avec le scan de sync (`ProjectFilesReader.readRelative`) : celui-ci
 * exclut tout `.artisan*`, alors que l'éditeur a besoin de `.artisan/editor.yaml`
 * (layout du board, `i18n_mode`). Seules la corbeille et les métadonnées de sync
 * restent hors champ.
 */
class ProjectReadChannelTest {
    private class Harness {
        val root: File = Files.createTempDirectory("artisan_pread_").toFile()
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
        /** Attend LA RÉPONSE : les annonces de rechargement voyagent sur le
         *  même fil et peuvent arriver avant elle. */
        fun await() {
            val deadline = System.currentTimeMillis() + 5000
            while (System.currentTimeMillis() < deadline) {
                if (sink.any { it["type"] != "projects_reloaded" }) return
                Thread.sleep(10)
            }
            throw AssertionError("no reply within 5s")
        }
        /** La réponse attendue, en ignorant les annonces de rechargement qui
         *  voyagent sur le même fil. */
        fun awaitReply(): Map<String, Any?> {
            val deadline = System.currentTimeMillis() + 5000
            while (System.currentTimeMillis() < deadline) {
                val reply = sink.firstOrNull { it["type"] != "projects_reloaded" }
                if (reply != null) return reply
                Thread.sleep(10)
            }
            throw AssertionError("no reply within 5s")
        }

        fun project(id: String): File = File(root, id).also { it.mkdirs() }
        fun write(project: File, rel: String, content: String) {
            val f = File(project, rel)
            f.parentFile.mkdirs()
            f.writeText(content)
        }
        fun read(projectId: String, requestId: String = "r1") {
            // L'éditeur voit ce que le serveur a CHARGÉ (instantané) : il faut
            // donc un chargement, comme en vrai au démarrage ou à /artisan reload.
            provider.load()
            provider.handleMessageForTesting(
                """{"type":"project_read","request_id":"$requestId","project_id":"$projectId"}"""
            )
            await()
        }
        @Suppress("UNCHECKED_CAST")
        fun files(): List<Map<String, String>> = awaitReply()["files"] as List<Map<String, String>>
    }

    @Test
    fun `project_read renvoie l'arbre complet, chemins relatifs tries`() {
        val h = Harness()
        val p = h.project("boutique")
        h.write(p, "manifest.yaml", "id: boutique\n")
        h.write(p, "menus/shop_main.yaml", "title: Boutique\n")
        h.write(p, "lang/fr.yaml", "shop:\n  title: Boutique\n")

        h.read("boutique")

        val msg = h.awaitReply()
        assertEquals("project_read_result", msg["type"])
        assertEquals("r1", msg["request_id"])
        assertEquals(true, msg["ok"])
        assertEquals(
            listOf("lang/fr.yaml", "manifest.yaml", "menus/shop_main.yaml"),
            h.files().map { it["path"] },
        )
        assertEquals("title: Boutique\n", h.files().single { it["path"] == "menus/shop_main.yaml" }["content"])
    }

    @Test
    fun `project_read inclut l'etat editeur mais pas la corbeille ni les metadonnees de sync`() {
        val h = Harness()
        val p = h.project("boutique")
        h.write(p, "manifest.yaml", "id: boutique\n")
        h.write(p, ".artisan/editor.yaml", "i18n_mode: inline\n")
        h.write(p, ".artisan/history/menus/shop_main.yaml/1755000000.yaml", "vieille version\n")
        h.write(p, ".artisan-sync.yaml", "synced_hash: abc\n")
        h.write(p, ".artisan-trash/menus/supprime.yaml", "supprimé\n")

        h.read("boutique")

        assertEquals(
            listOf(".artisan/editor.yaml", "manifest.yaml"),
            h.files().map { it["path"] },
        )
    }

    @Test
    fun `project_list rend les projects charges, tries`() {
        val h = Harness()
        h.write(h.project("zeta"), "manifest.yaml", "id: zeta\n")
        h.write(h.project("alpha"), "manifest.yaml", "id: alpha\n")

        h.provider.load()
        h.provider.handleMessageForTesting("""{"type":"project_list","request_id":"l1"}""")
        h.await()

        val msg = h.awaitReply()
        assertEquals("project_list_result", msg["type"])
        assertEquals(true, msg["ok"])
        // Le dossier EST le project : son nom est l'identité, et l'ordre est
        // déterministe pour que la sidebar ne danse pas d'un tick à l'autre.
        assertEquals(listOf("alpha", "zeta"), msg["project_ids"])
    }

    @Test
    fun `project_list rend une liste vide quand le serveur n'a aucun project`() {
        val h = Harness()
        h.provider.load()
        h.provider.handleMessageForTesting("""{"type":"project_list","request_id":"l2"}""")
        h.await()

        assertEquals(true, h.awaitReply()["ok"])
        assertEquals(emptyList<String>(), h.awaitReply()["project_ids"])
    }

    @Test
    fun `project_read sur un project inconnu repond unknown_project`() {
        val h = Harness()
        h.read("jamais_cree")

        val msg = h.awaitReply()
        assertEquals(false, msg["ok"])
        assertEquals("unknown_project", msg["error"])
    }

    @Test
    fun `project_read refuse une traversee de chemin`() {
        val h = Harness()
        h.read("../../etc")

        val msg = h.awaitReply()
        assertEquals(false, msg["ok"])
        assertEquals("invalid_path", msg["error"])
    }

    @Test
    fun `project_read refuse un arbre au dela du plafond`() {
        val h = Harness()
        val p = h.project("gros")
        h.write(p, "manifest.yaml", "id: gros\n")
        h.write(p, "lang/en.yaml", "x".repeat(SyncedMenuProvider.MAX_PROJECT_BYTES + 1))

        h.read("gros")

        val msg = h.awaitReply()
        assertEquals(false, msg["ok"])
        assertEquals("too_large", msg["error"])
    }
}
