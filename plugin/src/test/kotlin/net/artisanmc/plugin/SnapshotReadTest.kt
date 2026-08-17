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
 * `project_read` sert l'**instantané** : les octets bruts que le plugin a lus au
 * dernier chargement, pas l'état courant du disque.
 *
 * C'est la sémantique de reload, celle de tous les autres plugins Minecraft :
 * une édition à la main ne s'applique nulle part avant `/artisan reload`.
 * L'éditeur montre donc ce qui tourne réellement, au lieu d'afficher un disque
 * que le serveur n'a pas encore lu.
 *
 * L'instantané est fait d'**octets bruts**, pas du modèle parsé : c'est ce que le
 * compare-and-swap compare. Un modèle re-sérialisé donnerait d'autres octets,
 * donc des `base_hash` faux — conflits partout, ou écrasements silencieux.
 * Conséquence gratuite : un fichier illisible y figure aussi, donc reste
 * réparable depuis l'éditeur.
 */
class SnapshotReadTest {
    private class Harness {
        val root: File = Files.createTempDirectory("artisan_snap_").toFile()
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
        fun project(id: String): File = File(root, id).also { it.mkdirs() }
        fun write(project: File, rel: String, content: String) {
            val f = File(project, rel)
            f.parentFile.mkdirs()
            f.writeText(content)
        }
        fun read(projectId: String): Map<String, String> {
            latch = CountDownLatch(1)
            sink.clear()
            provider.handleMessageForTesting(
                """{"type":"project_read","request_id":"r","project_id":"$projectId"}"""
            )
            assertTrue(latch.await(5, TimeUnit.SECONDS), "no reply within 5s")
            @Suppress("UNCHECKED_CAST")
            val files = sink.single()["files"] as List<Map<String, String>>
            return files.associate { it["path"]!! to it["content"]!! }
        }
    }

    @Test
    fun `une edition disque n'apparait pas avant un reload`() {
        val h = Harness()
        val p = h.project("boutique")
        h.write(p, "menus/m.yaml", "schema: menu/v1\nsize: 27\n")
        h.provider.load()
        assertEquals("schema: menu/v1\nsize: 27\n", h.read("boutique")["menus/m.yaml"])

        // Quelqu'un édite le fichier à la main pendant que le serveur tourne.
        h.write(p, "menus/m.yaml", "schema: menu/v1\nsize: 54\n")

        // Le serveur n'a pas relu : l'éditeur voit ce qui tourne, pas le disque.
        assertEquals("schema: menu/v1\nsize: 27\n", h.read("boutique")["menus/m.yaml"])

        h.provider.load()
        assertEquals("schema: menu/v1\nsize: 54\n", h.read("boutique")["menus/m.yaml"])
    }

    @Test
    fun `une racine enregistree par un Add-on APRES le chargement devient lisible`() {
        val h = Harness()
        h.provider.load()

        // Un Add-on s'active APRÈS le core — 9 s plus tard en conditions réelles —
        // et enregistre alors sa racine (ADR `addon-owned-project-roots`).
        // L'instantané pris au chargement d'Artisan ne peut pas la contenir :
        // sans rafraîchissement, son Project répond `unknown_project` à jamais.
        val addonRoot = File(h.root, "../boutique_editor").also { it.mkdirs() }
        File(addonRoot, "menus/m.yaml").also { it.parentFile.mkdirs() }
            .writeText("schema: menu/v1\nsize: 27\n")
        h.provider.registerProjectRoot("boutique_shop", addonRoot)

        assertEquals("schema: menu/v1\nsize: 27\n", h.read("boutique_shop")["menus/m.yaml"])
    }

    @Test
    fun `un Add-on qui ecrit son propre disque peut faire reprendre l'instantane`() {
        val h = Harness()
        val p = h.project("boutique")
        h.write(p, "menus/m.yaml", "schema: menu/v1\nsize: 27\n")
        h.provider.load()

        // Un Add-on écrit dans SA racine — `/boutiqueadmin additem` capture un
        // article et l'ajoute au catalogue (ADR `addon-owned-project-roots`).
        // Sans annonce, cette écriture reste invisible au serveur qui tourne ET
        // à l'éditeur jusqu'à ce que QUELQU'UN tape `/artisan reload` : l'admin
        // capture un item, ne le voit nulle part, et croit la commande cassée.
        h.write(p, "items/ci_abc.yml", "type: DIAMOND_SWORD\n")
        assertNull(h.read("boutique")["items/ci_abc.yml"])

        // Le module le déclare, et l'instantané reprend : c'est le même chemin
        // que `/artisan reload`, déclenché par celui qui sait qu'il a écrit.
        h.provider.refreshFromDisk()
        assertEquals("type: DIAMOND_SWORD\n", h.read("boutique")["items/ci_abc.yml"])
    }

    @Test
    fun `l'instantane garde les octets exacts, commentaires compris`() {
        val h = Harness()
        val p = h.project("boutique")
        val exact = "# portage zMenu\nschema: menu/v1\n\nsize:   27\n"
        h.write(p, "menus/m.yaml", exact)
        h.provider.load()

        // Octets exacts : c'est ce que le compare-and-swap compare.
        assertEquals(exact, h.read("boutique")["menus/m.yaml"])
    }

    @Test
    fun `un fichier illisible figure dans l'instantane et reste reparable`() {
        val h = Harness()
        val p = h.project("boutique")
        h.write(p, "menus/ok.yaml", "schema: menu/v1\nsize: 27\n")
        h.write(p, "menus/casse.yaml", "schema: menu/v1\n  : : indentation cassée\n")
        h.provider.load()

        val files = h.read("boutique")
        // Le plugin l'a sauté au parsing, mais l'éditeur doit pouvoir l'ouvrir
        // pour le réparer : sinon la faute de frappe t'enferme dehors.
        assertTrue(files.containsKey("menus/casse.yaml"))
        assertTrue(files.containsKey("menus/ok.yaml"))
    }
}
