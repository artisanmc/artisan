package gg.interfaze.plugin

import gg.interfaze.plugin.sync.PackDeleter
import java.io.File
import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class PackDeleterTest {

    @Test
    fun `moves pack dir into interfaze-trash with timestamp suffix`() {
        val packsDir = Files.createTempDirectory("ifz_del_").toFile()
        val packDir = File(packsDir, "p_test").also { it.mkdirs() }
        File(packDir, "menus").mkdirs()
        File(packDir, "menus/m1.yaml").writeText("id: m1\n")

        val deleter = PackDeleter(packsDir)
        deleter.delete("p_test")

        assertFalse(packDir.exists(), "Original packDir doit disparaître")
        val trash = File(packsDir, ".interfaze-trash")
        assertTrue(trash.exists() && trash.isDirectory, "Trash directory créé")
        val trashEntries = trash.listFiles() ?: emptyArray()
        assertEquals(1, trashEntries.size, "Une seule entrée dans le trash")
        val moved = trashEntries[0]
        assertTrue(moved.name.startsWith("p_test-"), "Préfixe préservé : ${moved.name}")
        assertTrue(File(moved, "menus/m1.yaml").exists(), "Contenu déplacé")
    }

    @Test
    fun `noop when pack does not exist`() {
        val packsDir = Files.createTempDirectory("ifz_del_").toFile()
        val deleter = PackDeleter(packsDir)
        deleter.delete("nonexistent") // ne doit pas lever
        assertFalse(File(packsDir, ".interfaze-trash").exists(),
            "Pas de trash créé si rien à déplacer")
    }

    @Test
    fun `unique timestamp suffix when deleting twice with same packId`() {
        val packsDir = Files.createTempDirectory("ifz_del_").toFile()
        val deleter = PackDeleter(packsDir)

        File(packsDir, "p").also { it.mkdirs() }.also { File(it, "a.yaml").writeText("first\n") }
        deleter.delete("p")
        File(packsDir, "p").also { it.mkdirs() }.also { File(it, "a.yaml").writeText("second\n") }
        Thread.sleep(1100)  // distinct timestamp (epoch seconds)
        deleter.delete("p")

        val trash = File(packsDir, ".interfaze-trash")
        assertEquals(2, trash.listFiles()?.size, "Deux entrées trash distinctes")
    }
}
