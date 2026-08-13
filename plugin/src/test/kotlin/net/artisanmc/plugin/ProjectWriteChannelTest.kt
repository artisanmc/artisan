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
 * `project_write` — l'éditeur écrit les fichiers du serveur (ADR
 * `server-disk-only-storage`, P1). Le plugin est le seul écrivain, donc c'est ici
 * que vivent les deux garde-fous :
 *
 * - **compare-and-swap par fichier** : chaque écriture porte le hash sur lequel
 *   elle se base ; si le fichier a bougé depuis, rien n'est écrit du tout et les
 *   conflits remontent avec le contenu disque (l'éditeur affiche le diff sans
 *   second aller-retour) ;
 * - **corbeille** : l'ancien contenu part dans `.artisan/history/` avant tout
 *   écrasement ou suppression, en anneau des N dernières versions.
 */
class ProjectWriteChannelTest {
    private val mapper = ObjectMapper()

    private class Harness {
        val root: File = Files.createTempDirectory("artisan_pwrite_").toFile()
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
        fun await() = assertTrue(latch.await(5, TimeUnit.SECONDS), "no reply within 5s")
        fun project(id: String): File = File(root, id).also { it.mkdirs() }
        fun write(project: File, rel: String, content: String) {
            val f = File(project, rel)
            f.parentFile.mkdirs()
            f.writeText(content)
        }
        fun read(project: File, rel: String): String? =
            File(project, rel).takeIf { it.isFile }?.readText()
        fun historyOf(project: File, rel: String): List<String> =
            File(project, ".artisan/history/$rel").listFiles()
                ?.sortedBy { it.name }?.map { it.readText() } ?: emptyList()
        fun send(json: String) {
            provider.handleMessageForTesting(json)
            await()
        }
        fun reply(): Map<String, Any?> = sink.single()
    }

    private fun writeMsg(projectId: String, files: String, deletes: String = "[]") =
        """{"type":"project_write","request_id":"w1","project_id":"$projectId","files":$files,"deletes":$deletes}"""

    @Test
    fun `ecrit les fichiers et confirme`() {
        val h = Harness()
        val p = h.project("boutique")
        h.write(p, "manifest.yaml", "id: boutique\n")

        h.send(writeMsg("boutique", """[
            {"path":"menus/shop_main.yaml","content":"title: Boutique\n","base_hash":null}
        ]"""))

        assertEquals("project_write_result", h.reply()["type"])
        assertEquals(true, h.reply()["ok"])
        assertEquals("title: Boutique\n", h.read(p, "menus/shop_main.yaml"))
    }

    @Test
    fun `archive l'ancien contenu avant d'ecraser`() {
        val h = Harness()
        val p = h.project("boutique")
        h.write(p, "menus/shop_main.yaml", "title: Ancien\n")
        val base = BundleHasher.hashContent("title: Ancien\n")

        h.send(writeMsg("boutique", """[
            {"path":"menus/shop_main.yaml","content":"title: Nouveau\n","base_hash":"$base"}
        ]"""))

        assertEquals(true, h.reply()["ok"])
        assertEquals("title: Nouveau\n", h.read(p, "menus/shop_main.yaml"))
        assertEquals(listOf("title: Ancien\n"), h.historyOf(p, "menus/shop_main.yaml"))
    }

    @Test
    fun `refuse tout en bloc si un base_hash a bouge, et rend le contenu disque`() {
        val h = Harness()
        val p = h.project("boutique")
        h.write(p, "menus/a.yaml", "title: A disque\n")
        h.write(p, "menus/b.yaml", "title: B\n")
        val staleHash = BundleHasher.hashContent("title: A que l'editeur croyait\n")
        val freshHash = BundleHasher.hashContent("title: B\n")

        h.send(writeMsg("boutique", """[
            {"path":"menus/a.yaml","content":"title: A edite\n","base_hash":"$staleHash"},
            {"path":"menus/b.yaml","content":"title: B edite\n","base_hash":"$freshHash"}
        ]"""))

        val msg = h.reply()
        assertEquals(false, msg["ok"])
        assertEquals("conflict", msg["error"])
        @Suppress("UNCHECKED_CAST")
        val conflicts = msg["conflicts"] as List<Map<String, String?>>
        assertEquals(listOf("menus/a.yaml"), conflicts.map { it["path"] })
        assertEquals("title: A disque\n", conflicts[0]["disk"])

        // Tout ou rien : b.yaml, pourtant non conflictuel, n'a pas bougé non plus.
        assertEquals("title: A disque\n", h.read(p, "menus/a.yaml"))
        assertEquals("title: B\n", h.read(p, "menus/b.yaml"))
        assertTrue(h.historyOf(p, "menus/a.yaml").isEmpty(), "rien ne doit être archivé sur un refus")
    }

    @Test
    fun `un base_hash nul veut dire fichier neuf, et entre en conflit s'il existe deja`() {
        val h = Harness()
        val p = h.project("boutique")
        h.write(p, "menus/deja.yaml", "title: Existant\n")

        h.send(writeMsg("boutique", """[
            {"path":"menus/deja.yaml","content":"title: Neuf\n","base_hash":null}
        ]"""))

        val msg = h.reply()
        assertEquals(false, msg["ok"])
        assertEquals("conflict", msg["error"])
        @Suppress("UNCHECKED_CAST")
        val conflicts = msg["conflicts"] as List<Map<String, String?>>
        assertEquals("title: Existant\n", conflicts.single()["disk"])
        assertEquals("title: Existant\n", h.read(p, "menus/deja.yaml"))
    }

    @Test
    fun `supprime un fichier sous CAS et l'archive`() {
        val h = Harness()
        val p = h.project("boutique")
        h.write(p, "menus/vieux.yaml", "title: Vieux\n")
        val base = BundleHasher.hashContent("title: Vieux\n")

        h.send(writeMsg("boutique", "[]", """[{"path":"menus/vieux.yaml","base_hash":"$base"}]"""))

        assertEquals(true, h.reply()["ok"])
        assertNull(h.read(p, "menus/vieux.yaml"))
        assertEquals(listOf("title: Vieux\n"), h.historyOf(p, "menus/vieux.yaml"))
    }

    @Test
    fun `la corbeille est un anneau des N dernieres versions`() {
        val h = Harness()
        val p = h.project("boutique")
        val histDir = File(p, ".artisan/history/menus/m.yaml").also { it.mkdirs() }
        repeat(SyncedMenuProvider.MAX_HISTORY_VERSIONS + 5) { i ->
            File(histDir, "%013d".format(1_700_000_000_000L + i)).writeText("v$i\n")
        }
        h.write(p, "menus/m.yaml", "courant\n")
        val base = BundleHasher.hashContent("courant\n")

        h.send(writeMsg("boutique", """[
            {"path":"menus/m.yaml","content":"nouveau\n","base_hash":"$base"}
        ]"""))

        assertEquals(true, h.reply()["ok"])
        val kept = h.historyOf(p, "menus/m.yaml")
        assertEquals(SyncedMenuProvider.MAX_HISTORY_VERSIONS, kept.size)
        // Les plus anciennes sont purgées, la version qu'on vient d'écraser est gardée.
        assertEquals("courant\n", kept.last())
        assertFalse(kept.contains("v0\n"), "la plus vieille version doit être purgée")
    }

    @Test
    fun `l'editeur peut ecrire son propre etat mais pas la corbeille`() {
        val h = Harness()
        val p = h.project("boutique")

        h.send(writeMsg("boutique", """[
            {"path":".artisan/editor.yaml","content":"i18n_mode: inline\n","base_hash":null}
        ]"""))
        assertEquals(true, h.reply()["ok"])
        assertEquals("i18n_mode: inline\n", h.read(p, ".artisan/editor.yaml"))

        val h2 = Harness()
        h2.project("boutique")
        h2.send(writeMsg("boutique", """[
            {"path":".artisan/history/menus/m.yaml/1","content":"forge\n","base_hash":null}
        ]"""))
        assertEquals(false, h2.reply()["ok"])
        assertEquals("invalid_path", h2.reply()["error"])
    }

    @Test
    fun `cree le dossier du project quand l'appelant le demande explicitement`() {
        val h = Harness()
        // Aucun `project()` : le dossier n'existe pas encore, comme après une
        // création ou un import dans l'éditeur.
        h.provider.handleMessageForTesting(
            """{"type":"project_write","request_id":"w1","project_id":"tout_neuf","create":true,"files":[
                {"path":"manifest.yaml","content":"id: tout_neuf\n","base_hash":null}
            ],"deletes":[]}"""
        )
        h.await()

        assertEquals(true, h.reply()["ok"])
        assertEquals("id: tout_neuf\n", h.read(File(h.root, "tout_neuf"), "manifest.yaml"))
    }

    @Test
    fun `project_history rend les versions archivees, la plus recente d'abord`() {
        val h = Harness()
        val p = h.project("boutique")
        val hist = File(p, ".artisan/history/menus/m.yaml").also { it.mkdirs() }
        File(hist, "1755000000000").writeText("v1")
        File(hist, "1755000009999").writeText("v2")

        h.provider.handleMessageForTesting(
            """{"type":"project_history","request_id":"h1","project_id":"boutique","path":"menus/m.yaml"}"""
        )
        h.await()

        val msg = h.reply()
        assertEquals("project_history_result", msg["type"])
        assertEquals(true, msg["ok"])
        @Suppress("UNCHECKED_CAST")
        val versions = msg["versions"] as List<Map<String, Any?>>
        // La plus récente d'abord : c'est celle qu'on veut restaurer neuf fois sur dix.
        assertEquals(listOf("v2", "v1"), versions.map { it["content"] })
        assertEquals(1755000009999L, (versions[0]["at"] as Number).toLong())
    }

    @Test
    fun `project_history sur un fichier sans archive rend une liste vide`() {
        val h = Harness()
        h.project("boutique")
        h.provider.handleMessageForTesting(
            """{"type":"project_history","request_id":"h2","project_id":"boutique","path":"menus/jamais.yaml"}"""
        )
        h.await()

        assertEquals(true, h.reply()["ok"])
        @Suppress("UNCHECKED_CAST")
        assertTrue((h.reply()["versions"] as List<Map<String, Any?>>).isEmpty())
    }

    @Test
    fun `project_history refuse de lire hors de l'arbre du project`() {
        val h = Harness()
        h.project("boutique")
        h.provider.handleMessageForTesting(
            """{"type":"project_history","request_id":"h3","project_id":"boutique","path":"../../secrets"}"""
        )
        h.await()

        assertEquals(false, h.reply()["ok"])
        assertEquals("invalid_path", h.reply()["error"])
    }

    @Test
    fun `refuse une traversee de chemin et un project inconnu`() {
        val h = Harness()
        h.project("boutique")
        h.send(writeMsg("boutique", """[
            {"path":"../../evade.yaml","content":"x\n","base_hash":null}
        ]"""))
        assertEquals("invalid_path", h.reply()["error"])

        val h2 = Harness()
        h2.send(writeMsg("jamais_cree", """[
            {"path":"menus/m.yaml","content":"x\n","base_hash":null}
        ]"""))
        assertEquals("unknown_project", h2.reply()["error"])
    }
}
