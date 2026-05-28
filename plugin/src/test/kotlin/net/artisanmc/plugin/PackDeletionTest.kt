package net.artisanmc.plugin

import com.fasterxml.jackson.databind.ObjectMapper
import net.artisanmc.plugin.provider.SyncedMenuProvider
import java.io.File
import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class PackDeletionTest {

    private val mapper = ObjectMapper()

    @Test
    fun `pack_deleted runtime message moves pack dir to artisan-trash`() {
        val packsDir = Files.createTempDirectory("artisan_pd_").toFile()
        val packDir = File(packsDir, "p_kill").also { it.mkdirs() }
        File(packDir, "menus").mkdirs()
        File(packDir, "menus/m.yaml").writeText("id: m\n")

        val provider = SyncedMenuProvider(
            packsDir = packsDir,
            serverKey = "",  // skip WsClient.connect
            wsUrl = "ws://unused",
            logger = null,
        )

        // Simuler la réception d'un message pack_deleted via le hook interne
        provider.handleMessageForTesting(
            mapper.writeValueAsString(mapOf("type" to "pack_deleted", "pack_id" to "p_kill"))
        )

        assertFalse(packDir.exists(), "packDir doit avoir été déplacé")
        val trash = File(packsDir, ".artisan-trash")
        assertTrue(trash.exists(), "trash créé")
        assertTrue(trash.listFiles()!!.any { it.name.startsWith("p_kill-") }, "fichier trash présent")
    }
}
