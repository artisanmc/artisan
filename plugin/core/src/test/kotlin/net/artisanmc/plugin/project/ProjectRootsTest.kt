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

    @Test fun `a configuration root reports its role`() {
        roots.registerConfig("dailyrewards", addonDir, "dailyrewards")
        assertEquals(
            mapOf("project_id" to "dailyrewards", "identity" to "addon", "module_id" to "dailyrewards", "role" to "config"),
            roots.descriptor("dailyrewards") - "project_key",
        )
        assertEquals(addonDir, roots.dirFor("dailyrewards"))
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

    @Test fun `all is a listing kept until invalidated`() {
        assertEquals(setOf("user_proj"), roots.all().keys)
        File(coreRoot, "by_hand").mkdirs()
        assertEquals(setOf("user_proj"), roots.all().keys, "a folder made by hand waits for the next reload")
        roots.invalidate()
        assertEquals(setOf("by_hand", "user_proj"), roots.all().keys)
        roots.register("boutique_shop", addonDir)
        assertEquals(setOf("boutique_shop", "by_hand", "user_proj"), roots.all().keys, "a registration lists itself")
    }

    @Test fun `a scan reads each key once and serves it from the listing`() {
        val key = roots.key("user_proj")
        roots.all()
        File(coreRoot, "user_proj/.artisan/project-id").writeText("changed-on-disk\n")
        assertEquals(key, roots.key("user_proj"), "served from the listing, not the disk")
        roots.invalidate()
        assertEquals("changed-on-disk", roots.key("user_proj"))
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

    @Test fun `a module folder is created under the core root and owned by its module`() {
        val dir = roots.moduleFolder("quests", "artisanquests", null)
        assertEquals(File(coreRoot, "quests").canonicalFile, dir.canonicalFile)
        assertTrue(dir.isDirectory)
        assertEquals(
            mapOf("project_id" to "quests", "identity" to "addon", "project_key" to "addon:quests", "module_id" to "artisanquests"),
            roots.descriptor("quests"),
        )
        assertEquals(dir, roots.all()["quests"])
    }

    @Test fun `a module folder keeps its addon key before its module registers it`() {
        roots.moduleFolder("quests", "artisanquests", null)
        // The next start: the editor answers before the module registers its folder.
        val restarted = ProjectRoots(coreRoot)
        assertEquals("addon:quests", restarted.key("quests"))
        // A copy of the folder is not the module: it gets a key of its own.
        File(coreRoot, "quests").copyRecursively(File(coreRoot, "quests_copy"))
        val again = ProjectRoots(coreRoot)
        assertTrue(again.key("quests_copy").let { !it.startsWith("addon:") })
        assertEquals("addon:quests", again.key("quests"))
    }

    @Test fun `a module folder adopts the former add-on root once, with its key`() {
        val legacy = File(addonDir, "project")
        roots.register("boutique", legacy, "boutique")
        val key = roots.key("boutique")
        val dir = ProjectRoots(coreRoot).let { fresh ->
            roots = fresh
            fresh.moduleFolder("boutique", "boutique", legacy)
        }
        assertFalse(legacy.exists())
        assertTrue(File(dir, "boutique/shop.yaml").parentFile.isDirectory)
        assertEquals(key, roots.key("boutique"))
        // Next start: the add-on passes the same former root, now gone.
        assertEquals(dir, ProjectRoots(coreRoot).moduleFolder("boutique", "boutique", legacy))
    }

    @Test fun `a module folder keeps the former root while both hold files`() {
        val legacy = File(addonDir, "project")
        File(coreRoot, "boutique/stale.yaml").apply { parentFile.mkdirs(); writeText("x") }
        assertEquals(legacy, roots.moduleFolder("boutique", "boutique", legacy))
        assertEquals(legacy, roots.dirFor("boutique"))
        assertTrue(File(legacy, "boutique").isDirectory)
    }

    @Test fun `an empty former root is left alone`() {
        val legacy = Files.createTempDirectory("artisan-empty").toFile()
        File(coreRoot, "boutique").mkdirs()
        val dir = roots.moduleFolder("boutique", "boutique", legacy)
        assertEquals(File(coreRoot, "boutique"), dir)
        legacy.deleteRecursively()
    }

    @Test fun `a module folder name is a plain lowercase segment`() {
        assertFailsWith<IllegalArgumentException> { roots.moduleFolder("../escape", "x", null) }
        assertFailsWith<IllegalArgumentException> { roots.moduleFolder("Quests", "x", null) }
        assertFailsWith<IllegalArgumentException> { roots.moduleFolder(".artisan", "x", null) }
    }

    /** `plugins/Artisan/modules/` and `plugins/ArtisanConversations/`, as on a server. */
    private fun pluginsLayout(): Pair<File, File> {
        val plugins = Files.createTempDirectory("artisan-plugins").toFile()
        val modules = File(plugins, "Artisan/modules").apply { mkdirs() }
        return modules to File(plugins, "ArtisanConversations")
    }

    @Test fun `a plugin folder adopts the module folder once, with its key`() {
        val (modules, data) = pluginsLayout()
        val old = ProjectRoots(modules)
        val former = old.moduleFolder("conversations", "conversations", null)
        File(former, "conversations/intro.yml").apply { parentFile.mkdirs(); writeText("x") }
        val key = old.key("conversations")

        val fresh = ProjectRoots(modules)
        val dir = fresh.pluginFolder("conversations", "conversations", File(data, "project"))
        assertEquals(File(data, "project").absoluteFile, dir)
        assertFalse(former.exists())
        assertEquals("x", File(dir, "conversations/intro.yml").readText())
        assertEquals(key, fresh.key("conversations"))
        assertEquals("addon:conversations", fresh.descriptor("conversations")["project_key"])
        assertEquals("conversations", fresh.ownerOf("conversations"))
        assertEquals(dir, fresh.all()["conversations"])
        assertFalse("conversations" in ProjectRoots(modules).all(), "nothing left in Artisan's folder")
        // Next start: nothing to move, same folder.
        assertEquals(dir, ProjectRoots(modules).pluginFolder("conversations", "conversations", File(data, "project")))
        modules.parentFile.parentFile.deleteRecursively()
    }

    @Test fun `a plugin folder moves into an empty dir and creates a missing one`() {
        val (modules, data) = pluginsLayout()
        File(modules, "conversations/a.yml").apply { parentFile.mkdirs(); writeText("a") }
        File(data, "project").mkdirs()
        val dir = ProjectRoots(modules).pluginFolder("conversations", "conversations", File(data, "project"))
        assertEquals("a", File(dir, "a.yml").readText())
        val other = ProjectRoots(modules).pluginFolder("auctions", "auctions", File(data, "other/project"))
        assertTrue(other.isDirectory)
        assertEquals("addon:auctions", File(other, ".artisan/project-id").readText().trim())
        modules.parentFile.parentFile.deleteRecursively()
    }

    @Test fun `a plugin folder keeps the module folder while both hold files`() {
        val (modules, data) = pluginsLayout()
        val former = File(modules, "conversations").apply { mkdirs() }
        File(former, "a.yml").writeText("a")
        File(data, "project/b.yml").apply { parentFile.mkdirs(); writeText("b") }
        val roots = ProjectRoots(modules)
        assertEquals(former, roots.pluginFolder("conversations", "conversations", File(data, "project")))
        assertEquals(former, roots.dirFor("conversations"))
        assertTrue(File(former, "a.yml").isFile)
        assertTrue(File(data, "project/b.yml").isFile)
        assertEquals("addon:conversations", roots.key("conversations"))
        modules.parentFile.parentFile.deleteRecursively()
    }

    @Test fun `a module folder holding only its key file is not moved over a plugin folder`() {
        val (modules, data) = pluginsLayout()
        ProjectRoots(modules).moduleFolder("conversations", "conversations", null)
        File(data, "project/b.yml").apply { parentFile.mkdirs(); writeText("b") }
        val dir = ProjectRoots(modules).pluginFolder("conversations", "conversations", File(data, "project"))
        assertEquals(File(data, "project").absoluteFile, dir)
        modules.parentFile.parentFile.deleteRecursively()
    }

    @Test fun `a plugin folder is a dedicated folder outside Artisan's`() {
        val (modules, data) = pluginsLayout()
        val roots = ProjectRoots(modules)
        assertFailsWith<IllegalArgumentException> { roots.pluginFolder("conversations", "c", data) }
        assertFailsWith<IllegalArgumentException> { roots.pluginFolder("conversations", "c", File(modules, "conversations")) }
        assertFailsWith<IllegalArgumentException> { roots.pluginFolder("conversations", "c", modules.parentFile.parentFile) }
        assertFailsWith<IllegalArgumentException> { roots.pluginFolder("Conversations", "c", File(data, "project")) }
        assertFalse(data.exists())
        modules.parentFile.parentFile.deleteRecursively()
    }
}
