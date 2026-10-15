package net.artisanmc.plugin

import net.artisanmc.plugin.model.BundleMenu
import net.artisanmc.plugin.model.DocumentKind
import net.artisanmc.plugin.model.DocumentKinds
import net.artisanmc.plugin.project.ProjectRoots
import net.artisanmc.plugin.project.ResourceInventory
import net.artisanmc.plugin.yaml.ProjectReader
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import org.junit.jupiter.api.io.TempDir
import java.io.File
import java.nio.file.Path

/**
 * ADR `extensible-document-kinds`, decision 10: a project's Documents live in
 * one container keyed by kind, read through the kind registry. Nothing below
 * the registry spells `menus` / `commands` / `dialogs`.
 */
class DocumentKindsTest {

    @AfterEach
    fun reset() = DocumentKinds.reset()

    private fun project(tmp: Path): File = tmp.resolve("proj").toFile().also { it.mkdirs() }

    private fun write(dir: File, rel: String, content: String) {
        val f = File(dir, rel)
        f.parentFile.mkdirs()
        f.writeText(content)
    }

    private fun read(dir: File) = ProjectReader(ProjectRoots(dir.parentFile), null).readAll().single()

    @Test
    fun `the core kinds come first and resolve by folder`() {
        assertEquals(listOf("menu", "command", "dialog"), DocumentKinds.all().map { it.kind })
        assertEquals(DocumentKinds.MENU, DocumentKinds.byDir("menus"))
        assertNull(DocumentKinds.byDir("quests"))
    }

    @Test
    fun `a kind may not reuse an id or a folder`() {
        assertThrows<IllegalArgumentException> { DocumentKinds.register(DocumentKind("menu", "other", listOf("x/v1"))) }
        assertThrows<IllegalArgumentException> { DocumentKinds.register(DocumentKind("other", "menus", listOf("x/v1"))) }
        DocumentKinds.register(DocumentKind("quest", "quests", listOf("quest/v1")))
        assertEquals("quest", DocumentKinds.byDir("quests")?.kind)
    }

    @Test
    fun `the bundle stores documents by kind and the typed getters read that store`(@TempDir tmp: Path) {
        val p = project(tmp)
        write(p, "manifest.yaml", "schema: manifest/v1\n")
        write(p, "menus/accueil.yaml", "schema: menu/v1\nsize: 27\n")
        write(p, "commands/menu.yaml", "schema: command/v1\nname: menu\n")
        val bundle = read(p)
        assertEquals(setOf("menu", "command", "dialog"), bundle.documents.keys)
        assertEquals(listOf("accueil"), bundle.documents["menu"]!!.map { it.id })
        assertEquals(listOf("accueil"), bundle.menus.map { it.id })
        assertEquals(listOf("menu"), bundle.commands.map { it.id })
        assertTrue(bundle.dialogs.isEmpty())
        assertEquals(bundle.menus, bundle.documentsOf<BundleMenu>("menu"))
        assertTrue(bundle.documentsOf<BundleMenu>("unknown").isEmpty())
    }

    @Test
    fun `a folder of an unknown kind is left alone`(@TempDir tmp: Path) {
        val p = project(tmp)
        write(p, "manifest.yaml", "schema: manifest/v1\n")
        write(p, "menus/accueil.yaml", "schema: menu/v1\nsize: 27\n")
        write(p, "quests/first.yaml", "schema: quest/v1\nname: First\n")
        val bundle = read(p)
        assertFalse("quest" in bundle.documents)
        assertEquals(listOf("accueil"), bundle.menus.map { it.id })
        // Registered but without a reader on this side: still not read, still not an error.
        DocumentKinds.register(DocumentKind("quest", "quests", listOf("quest/v1")))
        assertFalse("quest" in read(p).documents)
    }

    @Test
    fun `the resource inventory follows the registry`() {
        assertEquals("menu", ResourceInventory.kind("menus/a.yaml"))
        assertNull(ResourceInventory.kind("quests/q.yaml"))
        DocumentKinds.register(DocumentKind("quest", "quests", listOf("quest/v1")))
        assertEquals("quest", ResourceInventory.kind("quests/q.yaml"))
    }
}
