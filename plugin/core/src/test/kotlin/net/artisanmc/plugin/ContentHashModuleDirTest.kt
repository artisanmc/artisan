package net.artisanmc.plugin

import net.artisanmc.plugin.project.ContentHash
import java.io.File
import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals

class ContentHashModuleDirTest {

    @Test
    fun `module-owned dirs participate in the project hash`() {
        val dir = Files.createTempDirectory("artisan-hash").toFile()
        try {
            File(dir, "menus").mkdirs()
            File(dir, "menus/main.yaml").writeText("id: main")
            val base = ContentHash.hash(dir)

            File(dir, "shop").mkdirs()
            File(dir, "shop/items.yaml").writeText("items: []")
            val withModule = ContentHash.hash(dir)
            assertNotEquals(base, withModule)

            File(dir, "shop/items.yaml").writeText("items: [sword]")
            assertNotEquals(withModule, ContentHash.hash(dir))

            // The .artisan namespace stays excluded.
            val beforeSyncFile = ContentHash.hash(dir)
            File(dir, ".artisan-sync.yaml").writeText("x: 1")
            assertEquals(beforeSyncFile, ContentHash.hash(dir))
        } finally {
            dir.deleteRecursively()
        }
    }
}
