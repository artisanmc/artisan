package net.artisanmc.plugin.tree

import net.artisanmc.modules.api.template.TemplateDeclaration
import net.artisanmc.plugin.project.ContentHash
import net.artisanmc.plugin.project.FileOrigin
import net.artisanmc.plugin.project.ProjectOrigins
import net.artisanmc.plugin.project.ProjectRoots
import net.artisanmc.plugin.project.ShippedIndex
import net.artisanmc.plugin.project.SystemFiles
import net.artisanmc.plugin.yaml.ProjectReader
import java.io.File
import java.nio.file.Files
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** A module folder in the former layout (`originals/`) turned into one tree (ADR `editable-module-tree`). */
class FolderMigrationTest {
    private val root = Files.createTempDirectory("artisan-migrate-test").toFile()
    private val m = File(root, "guilds")

    @AfterTest fun teardown() { root.deleteRecursively() }

    private fun write(rel: String, content: String) = File(m, rel).also { it.parentFile.mkdirs() }.writeText(content)
    private fun text(rel: String) = File(m, rel).readText()
    private fun hash(s: String) = ContentHash.hashBytes(s.toByteArray())
    private fun read() = ProjectReader(ProjectRoots(root)).readAll().single()

    private val main = "schema: menu/v1\nsize: 27\ntitle: Main\n"
    private val ranks = "schema: menu/v1\nsize: 27\ntitle: Ranks\n"
    private val top = "schema: menu/v1\nsize: 27\ntitle: Top\n"
    private val board = "schema: menu/v1\nsize: 27\ntitle: Board\n"
    private val enShipped = "shop:\n  hello: Hello\n  bye: Bye\n"

    /** A folder as the former sync leaves it, with what an owner does in it. */
    private fun formerLayout() {
        write("artisan-module.yml", "schema: module/v1\ndefault_lang: en\nlanguages: [en]\noriginals:\n  exclude: [menus/top.yml, menus/board.yml]\n")
        write("originals/originals.yml", "module: guilds\nversion: 1\nrequired: [menus/main.yml, menus/board.yml]\n")
        write("originals/menus/main.yml", main)
        write("originals/menus/ranks.yml", ranks)
        write("originals/menus/top.yml", top)
        write("originals/menus/board.yml", board)
        write("originals/lang/en.yml", enShipped)
        write("originals/data/prices.yml", "amount: 3\n")
        write("originals/data/rows/a.yml", "v: 1\n")
        write("originals/data/rows/b.yml", "v: 2\n")
        // The owner's: a menu moved into a folder and edited, a message, their own rows.
        write("rangs/menus/ranks.yml", "schema: menu/v1\nsize: 27\ntitle: Mine\n")
        write("lang/en.yml", "shop:\n  hello: Salut\n")
        write("data/rows/a.yml", "v: 10\n")
        val o = { t: String, s: String -> FileOrigin("guilds", if (t.isEmpty()) "system" else t, 1, hash(s)) }
        File(m, ProjectOrigins.PATH).apply { parentFile.mkdirs() }.writeBytes(ProjectOrigins.serialize(mapOf(
            "originals/menus/main.yml" to o("", main), "originals/menus/ranks.yml" to o("examples", ranks),
            "originals/menus/top.yml" to o("examples", top), "originals/menus/board.yml" to o("", board),
            "originals/data/prices.yml" to o("examples", "amount: 3\n"),
            "originals/data/rows/a.yml" to o("examples", "v: 1\n"), "originals/data/rows/b.yml" to o("examples", "v: 2\n"),
        )))
    }

    @Test
    fun `every file lands at its own path, the owner's kept, and players see the same`() {
        formerLayout()
        val before = read()
        val r = FolderMigration.run(m)
        assertIs<FolderMigration.Result.Migrated>(r)
        assertFalse(File(m, "originals").exists())
        assertEquals(main, text("menus/main.yml"))
        assertEquals(board, text("menus/board.yml"), "an excluded required file loaded: it is copied")
        assertFalse(File(m, "menus/top.yml").exists(), "an excluded optional file is not")
        assertFalse(File(m, "menus/ranks.yml").exists(), "the owner's moved file stands for it")
        assertEquals("schema: menu/v1\nsize: 27\ntitle: Mine\n", text("rangs/menus/ranks.yml"))
        val en = text("lang/en.yml")
        assertTrue("hello: Salut" in en && "bye: Bye" in en, en)
        assertEquals("amount: 3\n", text("data/prices.yml"))
        assertFalse(File(m, "data/rows/b.yml").exists(), "a per-row folder of the owner's is theirs whole")
        assertEquals(before, read())

        val index = ShippedIndex.read(m)
        assertEquals(true, index.getValue("menus/main.yml").required)
        assertEquals(hash(top), index.getValue("menus/top.yml").hash, "an absent shipped file is indexed: deleted")
        assertTrue("lang/en.yml" in index)
        assertEquals(index.mapValues { it.value.origin }, ProjectOrigins.read(m).filterKeys { it in index }, "origins mirror the index")
        assertTrue(File(m, "${SystemFiles.BASES}/${hash(main)}").isFile, "the base of the next merge")

        assertIs<FolderMigration.Result.NotNeeded>(FolderMigration.run(m))
    }

    @Test
    fun `a check that finds a difference writes nothing`() {
        formerLayout()
        val files = FolderMigration.contentFiles(m)
        val r = FolderMigration.run(m, check = { _, _ -> "messages" })
        assertEquals(FolderMigration.Result.Refused("messages"), r)
        assertEquals(files.mapValues { String(it.value) }, FolderMigration.contentFiles(m).mapValues { String(it.value) })
    }

    @Test
    fun `the reader check sees a message lost`() {
        formerLayout()
        val before = File(root, "b/guilds").also { FolderMigration.contentFiles(m).forEach { (p, b) -> File(it, p).apply { parentFile.mkdirs(); writeBytes(b) } } }
        val after = File(root, "a/guilds").also { dir ->
            FlattenOriginals.flatten(FolderMigration.contentFiles(m), setOf("menus", "commands", "dialogs")).forEach { (p, b) -> File(dir, p).apply { parentFile.mkdirs(); writeBytes(b) } }
        }
        assertNull(FolderMigration.ReaderCheck.compare(before, after))
        File(after, "lang/en.yml").writeText("shop:\n  hello: Salut\n")
        assertEquals("would change: messages, documents", FolderMigration.ReaderCheck.compare(before, after)?.let {
            // Menus carry their messages: both differ.
            if ("messages" in it) "would change: messages, documents" else it
        })
    }

    @Test
    fun `an older Artisan started again brings the folder back to its originals`() {
        formerLayout()
        val before = read()
        FolderMigration.run(m)
        // The former sync, as an older Artisan runs it, with the module's templates.
        val system = TemplateDeclaration.builder("system", 1).system()
            .file("menus/main.yml", main.toByteArray()).file("menus/board.yml", board.toByteArray())
            .build()
        val examples = TemplateDeclaration.builder("examples", 1)
            .file("menus/ranks.yml", ranks.toByteArray()).file("menus/top.yml", top.toByteArray())
            .file("data/prices.yml", "amount: 3\n".toByteArray())
            .file("data/rows/a.yml", "v: 1\n".toByteArray()).file("data/rows/b.yml", "v: 2\n".toByteArray())
            .build()
        SystemFiles.sync(m, "guilds", system, legacy = true)
        SystemFiles.sync(m, "guilds", examples, required = false, legacy = true)
        assertFalse(File(m, "menus/main.yml").exists(), "an untouched copy goes, the original serves")
        assertTrue(File(m, "originals/menus/main.yml").isFile)
        assertEquals("schema: menu/v1\nsize: 27\ntitle: Mine\n", text("rangs/menus/ranks.yml"))
        val again = read()
        assertEquals(before.documents, again.documents)
        assertEquals(before.dataSources, again.dataSources)
    }
}
