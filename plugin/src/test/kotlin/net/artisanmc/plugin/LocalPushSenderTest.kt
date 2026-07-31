package net.artisanmc.plugin

import net.artisanmc.plugin.sync.LocalPushSender
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Files
import java.nio.file.Path

class LocalPushSenderTest {

    @Test
    fun `buildPushMessage reads all files under a project dir`(@TempDir tmp: Path) {
        val projectDir = tmp.resolve("p_test")
        Files.createDirectories(projectDir.resolve("menus"))
        Files.writeString(projectDir.resolve("manifest.yaml"), "schema: manifest/v1\n")
        Files.writeString(projectDir.resolve("menus/shop.yaml"), "id: shop\n")

        val msg = LocalPushSender.buildPushMessage("p_test", projectDir.toFile())
        assertEquals("local_push", msg["type"])
        assertEquals("p_test", msg["project_id"])
        @Suppress("UNCHECKED_CAST")
        val files = msg["files"] as Map<String, String>
        assertEquals(2, files.size)
        assertTrue(files.containsKey("plugins/Artisan/projects/p_test/manifest.yaml"))
        assertTrue(files["plugins/Artisan/projects/p_test/manifest.yaml"]!!.contains("manifest/v1"))
        assertTrue((msg["hash"] as String).matches(Regex("[0-9a-f]{64}")))
    }

    @Test
    fun `buildPushMessage skips artisan sync metadata files`(@TempDir tmp: Path) {
        val projectDir = tmp.resolve("p_meta")
        Files.createDirectories(projectDir)
        Files.writeString(projectDir.resolve("manifest.yaml"), "schema: manifest/v1\n")
        Files.writeString(projectDir.resolve(".artisan-sync.yaml"), "syncedHash: abc123\n")

        val msg = LocalPushSender.buildPushMessage("p_meta", projectDir.toFile())
        @Suppress("UNCHECKED_CAST")
        val files = msg["files"] as Map<String, String>
        assertEquals(1, files.size)
        assertTrue(files.containsKey("plugins/Artisan/projects/p_meta/manifest.yaml"))
    }

    @Test
    fun `buildPushMessage hash is deterministic`(@TempDir tmp: Path) {
        val projectDir = tmp.resolve("p_det")
        Files.createDirectories(projectDir.resolve("menus"))
        Files.writeString(projectDir.resolve("manifest.yaml"), "schema: manifest/v1\n")
        Files.writeString(projectDir.resolve("menus/a.yaml"), "id: a\n")

        val hash1 = (LocalPushSender.buildPushMessage("p_det", projectDir.toFile())["hash"] as String)
        val hash2 = (LocalPushSender.buildPushMessage("p_det", projectDir.toFile())["hash"] as String)
        assertEquals(hash1, hash2)
    }

    @Test
    fun `buildPushMessage paths use forward slashes`(@TempDir tmp: Path) {
        val projectDir = tmp.resolve("p_slash")
        Files.createDirectories(projectDir.resolve("menus"))
        Files.writeString(projectDir.resolve("menus/shop.yaml"), "id: shop\n")

        val msg = LocalPushSender.buildPushMessage("p_slash", projectDir.toFile())
        @Suppress("UNCHECKED_CAST")
        val files = msg["files"] as Map<String, String>
        assertTrue(files.keys.all { '\\' !in it }, "All paths must use forward slashes")
    }
}
