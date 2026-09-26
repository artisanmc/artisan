package net.artisanmc.plugin

import com.fasterxml.jackson.databind.ObjectMapper
import net.artisanmc.plugin.provider.SyncedMenuProvider
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import java.io.File
import java.nio.file.Files

/**
 * Le `hello` porte l'empreinte de chaque Snapshot : c'est ce qui permet au
 * backend de savoir, à la reconnexion, si sa copie est encore celle que le
 * serveur exécute (ADR `snapshot-mirror-and-backend-history`, décision 2).
 */
class SnapshotHashesHelloTest {
    private val root: File = Files.createTempDirectory("artisan_snapshot_hello_").toFile()
    private val sink: MutableList<Map<String, Any?>> = java.util.Collections.synchronizedList(mutableListOf())
    private val provider = SyncedMenuProvider(
        roots = net.artisanmc.plugin.project.ProjectRoots(root),
        serverKey = "", wsUrl = "", logger = null,
    ).also { p ->
        p.setSendForTesting { raw ->
            @Suppress("UNCHECKED_CAST")
            sink.add(ObjectMapper().readValue(raw, Map::class.java) as Map<String, Any?>)
        }
    }

    private fun write(projectId: String, rel: String, content: String) {
        val f = File(File(root, projectId), rel)
        f.parentFile.mkdirs()
        f.writeText(content)
    }

    @Suppress("UNCHECKED_CAST")
    private fun hashes(): Map<String, String> =
        (provider.projectPresenceForTesting()["snapshot_hashes"] as List<Map<String, String>>)
            .associate { it.getValue("id") to it.getValue("hash") }

    @Test
    fun `le hello annonce la capacite`() {
        provider.load()
        @Suppress("UNCHECKED_CAST")
        val capabilities = provider.projectPresenceForTesting()["capabilities"] as List<String>
        assertTrue("snapshot_mirror_v1" in capabilities)
    }

    @Test
    fun `le hello porte l'empreinte que project_read rendra`() {
        write("boutique", "menus/m.yaml", "schema: menu/v1\nsize: 27\n")
        write("warps", "menus/w.yaml", "schema: menu/v1\nsize: 9\n")
        provider.load()

        provider.handleMessageForTesting("""{"type":"project_read","request_id":"r","project_id":"boutique"}""")
        Thread.sleep(300)
        val read = sink.single { it["type"] == "project_read_result" }

        assertEquals(setOf("boutique", "warps"), hashes().keys)
        assertEquals(read["hash"], hashes()["boutique"])
    }

    @Test
    fun `l'empreinte du hello suit le reload`() {
        write("boutique", "menus/m.yaml", "schema: menu/v1\nsize: 27\n")
        provider.load()
        val before = hashes().getValue("boutique")

        write("boutique", "menus/m.yaml", "schema: menu/v1\nsize: 54\n")
        provider.load()

        assertNotEquals(before, hashes().getValue("boutique"))
    }
}
