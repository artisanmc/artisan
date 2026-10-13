package net.artisanmc.plugin.project

import java.io.File
import java.nio.file.Files
import java.time.Instant
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class ProjectFoldersTest {
    private val coreRoot = Files.createTempDirectory("artisan-folders").toFile()
    private val addonDir = Files.createTempDirectory("artisan-addon").toFile()
    private val roots = ProjectRoots(coreRoot)
    private val folders = ProjectFolders(roots) { Instant.parse("2026-10-13T08:00:00Z") }

    @AfterTest fun teardown() {
        coreRoot.deleteRecursively()
        addonDir.deleteRecursively()
    }

    private fun project(id: String) = File(coreRoot, id).apply { File(this, "menus").mkdirs(); File(this, "menus/main.yml").writeText("a") }

    @Test fun `create makes an empty folder once`() {
        assertNull(folders.create("shop"))
        assertTrue(File(coreRoot, "shop").isDirectory)
        assertEquals("shop", roots.all().keys.single())
        assertEquals("project_exists", folders.create("shop"))
        assertEquals("project_exists", folders.create("SHOP"))
    }

    @Test fun `create refuses names that are not a plain folder`() {
        for (name in listOf("", ".artisan-trash", "../x", "a/b", "a.b", "CON", "x".repeat(129))) {
            assertEquals("invalid_name", folders.create(name), name)
        }
        roots.register("boutique", addonDir)
        assertEquals("project_exists", folders.create("boutique"))
    }

    @Test fun `delete moves the folder to the trash`() {
        project("shop")
        assertNull(folders.delete("shop"))
        assertFalse(File(coreRoot, "shop").exists())
        assertEquals("a", File(coreRoot, ".artisan-trash/shop-20261013080000/menus/main.yml").readText())
        assertTrue(roots.all().isEmpty())

        project("shop")
        assertNull(folders.delete("shop"))
        assertTrue(File(coreRoot, ".artisan-trash/shop-20261013080000-1").isDirectory)
        assertEquals("unknown_project", folders.delete("shop"))
    }

    @Test fun `rename moves the folder with its drafts`() {
        project("shop")
        File(coreRoot, "shop/.artisan/drafts/owner/d1").mkdirs()
        File(coreRoot, "shop/.artisan/drafts/owner/d1/draft.json").writeText("{}")
        assertNull(folders.rename("shop", "store"))
        assertFalse(File(coreRoot, "shop").exists())
        assertEquals("a", File(coreRoot, "store/menus/main.yml").readText())
        assertTrue(File(coreRoot, "store/.artisan/drafts/owner/d1/draft.json").isFile)
    }

    @Test fun `rename never overwrites`() {
        project("shop")
        project("store")
        assertEquals("destination_exists", folders.rename("shop", "store"))
        assertEquals("invalid_path", folders.rename("shop", "a/b"))
        assertEquals("invalid_path", folders.rename("shop", "shop"))
        assertEquals("unknown_project", folders.rename("missing", "other"))
        roots.register("boutique", addonDir)
        assertEquals("destination_exists", folders.rename("shop", "boutique"))
        assertTrue(File(coreRoot, "shop/menus/main.yml").isFile)
    }

    @Test fun `add-on projects stay where their add-on put them`() {
        roots.register("boutique", addonDir)
        assertEquals("addon_immutable", folders.rename("boutique", "other"))
        assertEquals("addon_immutable", folders.delete("boutique"))
        assertTrue(addonDir.isDirectory)
    }
}
