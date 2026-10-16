package net.artisanmc.plugin.project

import java.io.File
import java.nio.file.Files
import kotlin.test.*

class ProjectRootsTest {
    private lateinit var coreRoot: File
    private lateinit var addonDir: File
    private lateinit var roots: ProjectRoots

    @BeforeTest fun setup() {
        coreRoot = Files.createTempDirectory("artisan-core-root").toFile()
        // Core-scanned projects (dir name = projectId), hidden dirs excluded.
        File(coreRoot, "user_proj/menus").mkdirs()
        File(coreRoot, ".artisan-trash").mkdirs()
        // An Add-on's project lives OUTSIDE the core root, in its own plugin dir.
        addonDir = Files.createTempDirectory("artisan-boutique").toFile()
        File(addonDir, "project/boutique/shop.yaml").parentFile.mkdirs()
        roots = ProjectRoots(coreRoot)
    }

    @AfterTest fun teardown() {
        coreRoot.deleteRecursively()
        addonDir.deleteRecursively()
    }

    @Test fun `a folder project keeps its key across a rename`() {
        val key = roots.key("user_proj")
        assertEquals(key, roots.key("user_proj"))
        assertTrue(File(coreRoot, "user_proj").renameTo(File(coreRoot, "renamed")))
        roots.all()
        assertEquals(key, roots.key("renamed"))
        assertEquals(key, roots.descriptor("renamed")["project_key"])
    }

    @Test fun `a copied folder gets a key of its own`() {
        val key = roots.key("user_proj")
        File(coreRoot, "user_proj").copyRecursively(File(coreRoot, "user_proj_copy"))
        roots.all()
        assertEquals(key, roots.key("user_proj"))
        assertNotEquals(key, roots.key("user_proj_copy"))
    }

    @Test fun `an add-on project is keyed by its manifest identity`() {
        roots.register("boutique_addon", addonDir)
        assertEquals("addon:boutique_addon", roots.key("boutique_addon"))
        assertFalse(File(addonDir, ".artisan/project-id").exists())
    }

    @Test fun `the key is metadata, outside the project hash`() {
        roots.key("user_proj")
        assertTrue(File(coreRoot, "user_proj/.artisan/project-id").isFile)
        assertTrue(net.artisanmc.plugin.project.ContentHash.isArtisanMeta(".artisan/project-id"))
    }

    @Test fun `an add-on root reports the module that owns it`() {
        roots.register("msguilds_addon", addonDir, "msguilds")
        assertEquals(
            mapOf("project_id" to "msguilds_addon", "identity" to "addon", "module_id" to "msguilds"),
            roots.descriptor("msguilds_addon") - "project_key",
        )
        assertEquals(mapOf("project_id" to "user_proj", "identity" to "folder"), roots.descriptor("user_proj") - "project_key")
    }

    @Test fun `an add-on root registered without a module reports none`() {
        roots.register("boutique_addon", addonDir)
        assertEquals(mapOf("project_id" to "boutique_addon", "identity" to "addon"), roots.descriptor("boutique_addon") - "project_key")
    }

    @Test fun `dirFor resolves a core project under the core root`() {
        assertEquals(File(coreRoot, "user_proj"), roots.dirFor("user_proj"))
    }

    @Test fun `dirFor resolves a registered add-on project to its own dir`() {
        val projectDir = File(addonDir, "project")
        roots.register("boutique_shop", projectDir)
        assertEquals(projectDir, roots.dirFor("boutique_shop"))
    }

    @Test fun `dirFor falls back to the core root for an unknown project`() {
        assertEquals(File(coreRoot, "ghost"), roots.dirFor("ghost"))
    }

    @Test fun `all unions core-scanned projects with registered add-on projects`() {
        val projectDir = File(addonDir, "project")
        roots.register("boutique_shop", projectDir)
        val all = roots.all()
        assertEquals(setOf("user_proj", "boutique_shop"), all.keys)
        assertEquals(File(coreRoot, "user_proj"), all["user_proj"])
        assertEquals(projectDir, all["boutique_shop"])
    }

    @Test fun `all excludes hidden dirs in the core root`() {
        assertFalse(roots.all().keys.any { it.startsWith(".") })
    }

    @Test fun `a registered project wins over a same-id core dir`() {
        File(coreRoot, "boutique_shop").mkdirs()
        val projectDir = File(addonDir, "project")
        roots.register("boutique_shop", projectDir)
        assertEquals(projectDir, roots.all()["boutique_shop"])
        assertEquals(projectDir, roots.dirFor("boutique_shop"))
    }
}
