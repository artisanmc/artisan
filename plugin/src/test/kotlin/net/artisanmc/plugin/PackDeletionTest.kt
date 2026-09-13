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
    fun `project_deleted runtime message moves project dir to artisan-trash`() {
        val packsDir = Files.createTempDirectory("artisan_pd_").toFile()
        val projectDir = File(packsDir, "p_kill").also { it.mkdirs() }
        File(projectDir, "menus").mkdirs()
        File(projectDir, "menus/m.yaml").writeText("id: m\n")

        val deleted = java.util.concurrent.CountDownLatch(1)
        val provider = SyncedMenuProvider(
            roots = net.artisanmc.plugin.project.ProjectRoots(packsDir),
            serverKey = "",  // skip WsClient.connect
            wsUrl = "ws://unused",
            logger = null,
            onReload = { deleted.countDown() },
        )

        // Simuler la réception d'un message project_deleted via le hook interne
        provider.handleMessageForTesting(
            mapper.writeValueAsString(mapOf("type" to "project_deleted", "project_id" to "p_kill"))
        )
        assertTrue(deleted.await(5, java.util.concurrent.TimeUnit.SECONDS), "asynchronous deletion completes")

        assertFalse(projectDir.exists(), "projectDir doit avoir été déplacé")
        val trash = File(packsDir, ".artisan-trash")
        assertTrue(trash.exists(), "trash créé")
        assertTrue(trash.listFiles()!!.any { it.name.startsWith("p_kill-") }, "fichier trash présent")
    }
}
