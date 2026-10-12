package net.artisanmc.plugin

import net.artisanmc.plugin.sync.ProjectDeleter
import java.io.File
import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class ProjectDeleterTest {

    @Test
    fun `moves project dir into artisan-trash with timestamp suffix`() {
        val packsDir = Files.createTempDirectory("artisan_del_").toFile()
        val projectDir = File(packsDir, "p_test").also { it.mkdirs() }
        File(projectDir, "menus").mkdirs()
        File(projectDir, "menus/m1.yaml").writeText("id: m1\n")

        val deleter = ProjectDeleter(packsDir)
        deleter.delete("p_test")

        assertFalse(projectDir.exists(), "Original projectDir doit disparaître")
        val trash = File(packsDir, ".artisan-trash")
        assertTrue(trash.exists() && trash.isDirectory, "Trash directory créé")
        val trashEntries = trash.listFiles() ?: emptyArray()
        assertEquals(1, trashEntries.size, "Une seule entrée dans le trash")
        val moved = trashEntries[0]
        assertTrue(moved.name.startsWith("p_test-"), "Préfixe préservé : ${moved.name}")
        assertTrue(File(moved, "menus/m1.yaml").exists(), "Contenu déplacé")
    }

    @Test
    fun `noop when project does not exist`() {
        val packsDir = Files.createTempDirectory("artisan_del_").toFile()
        val deleter = ProjectDeleter(packsDir)
        deleter.delete("nonexistent") // ne doit pas lever
        assertFalse(File(packsDir, ".artisan-trash").exists(),
            "Pas de trash créé si rien à déplacer")
    }

    @Test
    fun `unique timestamp suffix when deleting twice with same projectId`() {
        val packsDir = Files.createTempDirectory("artisan_del_").toFile()
        val deleter = ProjectDeleter(packsDir)

        File(packsDir, "p").also { it.mkdirs() }.also { File(it, "a.yaml").writeText("first\n") }
        deleter.delete("p")
        File(packsDir, "p").also { it.mkdirs() }.also { File(it, "a.yaml").writeText("second\n") }
        Thread.sleep(1100)  // distinct timestamp (epoch seconds)
        deleter.delete("p")

        val trash = File(packsDir, ".artisan-trash")
        assertEquals(2, trash.listFiles()?.size, "Deux entrées trash distinctes")
    }
}
