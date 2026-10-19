package net.artisanmc.plugin.project

import java.io.File
import java.nio.file.Files
import kotlin.test.*

class ModulesRootMigrationTest {
    private lateinit var data: File

    @BeforeTest fun setup() { data = Files.createTempDirectory("artisan-data").toFile() }
    @AfterTest fun teardown() { data.deleteRecursively() }

    private fun write(path: String, text: String) = File(data, path).apply { parentFile.mkdirs(); writeText(text) }

    @Test fun `a fresh server gets modules and nothing else`() {
        val root = ModulesRootMigration.run(data)
        assertEquals(File(data, "modules"), root)
        assertTrue(root.isDirectory)
        assertFalse(File(data, "projects").exists())
    }

    @Test fun `projects move to modules with their key and the root metadata`() {
        write("projects/boutique/manifest.yaml", "schema: manifest/v1\n")
        write("projects/boutique/.artisan/project-id", "1234\n")
        write("projects/.artisan-seeds.yaml", "seeded: [quests]\n")
        val root = ModulesRootMigration.run(data)
        assertEquals("schema: manifest/v1\n", File(root, "boutique/manifest.yaml").readText())
        assertEquals("1234", ProjectRoots(root).key("boutique"))
        assertTrue(File(root, ".artisan-seeds.yaml").isFile)
        assertFalse(File(data, "projects").exists())
        assertTrue(File(data, "projects.artisan-migrated").isDirectory)
        assertTrue(File(root, ModulesRootMigration.MARKER).readText().contains("\"boutique\""))
        assertEquals(setOf("boutique"), ProjectRoots(root).all().keys)
    }

    @Test fun `the migration runs once`() {
        write("projects/a/manifest.yaml", "x")
        ModulesRootMigration.run(data)
        write("projects/b/manifest.yaml", "y")
        ModulesRootMigration.run(data)
        assertFalse(File(data, "modules/b").exists(), "a projects/ folder made after the migration is not read")
    }

    @Test fun `an entry already in modules stays in the archive and is reported`() {
        write("projects/a/menus/main.yaml", "old")
        write("projects/b/menus/main.yaml", "b")
        write("modules/a/menus/main.yaml", "new")
        val logs = mutableListOf<String>()
        val logger = java.util.logging.Logger.getAnonymousLogger().apply {
            useParentHandlers = false
            addHandler(object : java.util.logging.Handler() {
                override fun publish(record: java.util.logging.LogRecord) { logs += record.message }
                override fun flush() {}
                override fun close() {}
            })
        }
        val root = ModulesRootMigration.run(data, logger)
        assertEquals("new", File(root, "a/menus/main.yaml").readText())
        assertEquals("b", File(root, "b/menus/main.yaml").readText())
        assertEquals("old", File(data, "projects.artisan-migrated/a/menus/main.yaml").readText())
        assertTrue(logs.any { "'a' exists in both" in it })
    }
}
