package net.artisanmc.plugin

import com.fasterxml.jackson.databind.ObjectMapper
import net.artisanmc.plugin.provider.SyncedMenuProvider
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import java.io.File
import java.nio.file.Files
import java.util.Base64
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Transfert des **assets binaires** (ADR `assets-on-server-disk`, P0).
 *
 * Un PNG ne peut pas voyager dans l'arbre de `project_read` : cet arbre part
 * entier à chaque ouverture, en UTF-8. Le base64 l'enflerait d'un tiers pour un
 * contenu dont l'éditeur n'a besoin qu'au moment de l'afficher — et lire un PNG
 * en UTF-8 le détruirait au passage.
 *
 * D'où la règle structurelle : l'arbre **annonce** les binaires (chemin + hash +
 * taille) sans les porter : `asset_read` les lit un par un, par chemin, et
 * `project_write` les écrit dans sa liste `binaries`.
 */
class AssetTransferTest {
    private class Harness {
        val root: File = Files.createTempDirectory("artisan_asset_").toFile()
        val sink: MutableList<Map<String, Any?>> = java.util.Collections.synchronizedList(mutableListOf())
        var latch = CountDownLatch(1)
        val provider = SyncedMenuProvider(
            roots = net.artisanmc.plugin.project.ProjectRoots(root),
            logger = null,
        )
        init {
            provider.setSendForTesting { raw ->
                @Suppress("UNCHECKED_CAST")
                sink.add(ObjectMapper().readValue(raw, Map::class.java) as Map<String, Any?>)
                latch.countDown()
            }
        }
        fun project(id: String): File = File(root, id).also { it.mkdirs() }
        private var operations = 0
        /** `project_write` sans fichier texte : chaque écriture a sa propre opération. */
        fun writeBinaries(vararg paths: String, content: String) = send(
            """{"type":"project_write","request_id":"r","operation_id":"op-${++operations}","project_id":"boutique","binaries":[""" +
                paths.joinToString(",") { """{"path":"$it","content_base64":"$content","base_hash":null}""" } + "]}",
        )
        fun write(project: File, rel: String, bytes: ByteArray) {
            val f = File(project, rel)
            f.parentFile.mkdirs()
            f.writeBytes(bytes)
        }
        fun send(json: String): Map<String, Any?> {
            latch = CountDownLatch(1)
            sink.clear()
            provider.handleMessageForTesting(json)
            // La réponse, pas la première chose qui passe : les annonces de
            // rechargement voyagent sur le même fil et peuvent la précéder.
            val deadline = System.currentTimeMillis() + 5000
            while (System.currentTimeMillis() < deadline) {
                val reply = sink.firstOrNull { it["type"] != "projects_reloaded" }
                if (reply != null) return reply
                Thread.sleep(10)
            }
            throw AssertionError("no reply within 5s")
        }
        fun read(projectId: String): Map<String, Any?> =
            send("""{"type":"project_read","request_id":"r","project_id":"$projectId"}""")
        fun assetRead(projectId: String, path: String): Map<String, Any?> =
            send("""{"type":"asset_read","request_id":"r","project_id":"$projectId","path":"$path"}""")
    }

    /** Un PNG minimal mais réel : en-tête + octets non-UTF-8 (0x89, 0xFF…). */
    private val png = byteArrayOf(
        0x89.toByte(), 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
        0xFF.toByte(), 0x00, 0xC3.toByte(), 0x28,
    )

    @Test
    fun `l'arbre annonce les binaires sans les porter`() {
        val h = Harness()
        val p = h.project("boutique")
        h.write(p, "menus/m.yaml", "schema: menu/v1\nsize: 27\n".toByteArray())
        h.write(p, "assets/glyphs/diamant.png", png)
        h.provider.load()

        val res = h.read("boutique")
        @Suppress("UNCHECKED_CAST")
        val files = res["files"] as List<Map<String, String>>
        @Suppress("UNCHECKED_CAST")
        val binaries = res["binaries"] as List<Map<String, Any?>>

        // Le PNG n'est pas dans l'arbre : le lire en UTF-8 l'aurait mutilé, et le
        // porter en base64 enflerait chaque ouverture de Project.
        assertTrue(files.none { it["path"] == "assets/glyphs/diamant.png" })
        assertEquals(listOf("menus/m.yaml"), files.map { it["path"] })

        // Mais son existence est annoncée : l'éditeur sait quoi proposer sans
        // avoir à tout télécharger.
        val entry = binaries.single()
        assertEquals("assets/glyphs/diamant.png", entry["path"])
        assertEquals(png.size, (entry["size"] as Number).toInt())
        assertTrue((entry["hash"] as String).length == 64, "hash SHA-256 hex attendu")
    }

    @Test
    fun `asset_read rend les octets exacts`() {
        val h = Harness()
        val p = h.project("boutique")
        h.write(p, "assets/glyphs/diamant.png", png)
        h.provider.load()

        val res = h.assetRead("boutique", "assets/glyphs/diamant.png")
        assertEquals(true, res["ok"])
        // Octets EXACTS : un aller-retour base64 qui normaliserait quoi que ce
        // soit rendrait l'image invalide, et le compare-and-swap faux.
        assertArrayEquals(png, Base64.getDecoder().decode(res["content_base64"] as String))
    }

    @Test
    fun `project_write ecrit un binaire et refuse si la base a bouge`() {
        val h = Harness()
        val p = h.project("boutique")
        h.write(p, "menus/m.yaml", "schema: menu/v1\n".toByteArray())
        h.provider.load()

        val b64 = Base64.getEncoder().encodeToString(png)
        // base_hash null = « je m'attends à ce que le fichier n'existe pas ».
        val created = h.writeBinaries("assets/glyphs/diamant.png", content = b64)
        assertEquals(true, created["ok"])
        assertArrayEquals(png, File(p, "assets/glyphs/diamant.png").readBytes())

        // Réécrire en prétendant que le fichier est toujours absent doit être
        // refusé : sinon deux admins qui téléversent le même nom s'écrasent en silence.
        val conflict = h.writeBinaries("assets/glyphs/diamant.png", content = b64)
        assertEquals(false, conflict["ok"])
        assertEquals("conflict", conflict["error"])
    }

    @Test
    fun `un binaire ecrit est visible sans reload manuel`() {
        val h = Harness()
        val p = h.project("boutique")
        h.write(p, "menus/m.yaml", "schema: menu/v1\n".toByteArray())
        h.provider.load()

        val b64 = Base64.getEncoder().encodeToString(png)
        h.writeBinaries("assets/textures/fond.png", content = b64)

        // Écrire, c'est savoir qu'on a écrit : l'instantané reprend, sinon
        // l'éditeur téléverserait une image qu'il ne verrait pas ensuite.
        @Suppress("UNCHECKED_CAST")
        val binaries = h.read("boutique")["binaries"] as List<Map<String, Any?>>
        assertEquals(listOf("assets/textures/fond.png"), binaries.map { it["path"] })
    }

    /**
     * Écriture GROUPÉE (ADR `assets-on-server-disk`, polices dépliées).
     *
     * Une police importée, c'est ~96 fichiers (mesuré sur l'ASCII vanilla :
     * 95 PNG + son descripteur, 26 Ko en tout). Les écrire un par un ferait 96
     * allers-retours et, surtout, laisserait une police à moitié posée si l'un
     * échouait : tout ou rien.
     */
    @Test
    fun `project_write ecrit plusieurs binaires en tout ou rien`() {
        val h = Harness()
        val p = h.project("boutique")
        h.write(p, "menus/m.yaml", "schema: menu/v1\n".toByteArray())
        h.provider.load()

        val b64 = Base64.getEncoder().encodeToString(png)
        val res = h.writeBinaries("assets/fonts/pixelmix/a.png", "assets/fonts/pixelmix/b.png", content = b64)
        assertEquals(true, res["ok"])
        assertArrayEquals(png, File(p, "assets/fonts/pixelmix/a.png").readBytes())
        assertArrayEquals(png, File(p, "assets/fonts/pixelmix/b.png").readBytes())
    }

    @Test
    fun `un seul fichier perime annule tout le groupe`() {
        val h = Harness()
        val p = h.project("boutique")
        h.write(p, "assets/fonts/pixelmix/b.png", png)
        h.provider.load()

        val b64 = Base64.getEncoder().encodeToString(png)
        // Le second prétend que le fichier n'existe pas — il existe.
        val res = h.writeBinaries("assets/fonts/pixelmix/a.png", "assets/fonts/pixelmix/b.png", content = b64)
        assertEquals(false, res["ok"])
        assertEquals("conflict", res["error"])
        // RIEN n'a été écrit : une police à moitié posée serait pire qu'aucune.
        assertFalse(File(p, "assets/fonts/pixelmix/a.png").exists())
    }
}
