package net.artisanmc.plugin

import net.artisanmc.modules.api.document.DocumentKindDeclaration
import net.artisanmc.modules.api.document.DuplicateDocumentKindException
import net.artisanmc.plugin.model.BundleMenu
import net.artisanmc.plugin.model.BundleRawDocument
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
        assertThrows<DuplicateDocumentKindException> { DocumentKinds.register(DocumentKind("menu", "other", listOf("x/v1"))) }
        assertThrows<DuplicateDocumentKindException> { DocumentKinds.register(DocumentKind("other", "menus", listOf("x/v1"))) }
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
    fun `a folder of an unknown kind is left alone until its kind is registered`(@TempDir tmp: Path) {
        val p = project(tmp)
        write(p, "manifest.yaml", "schema: manifest/v1\n")
        write(p, "menus/accueil.yaml", "schema: menu/v1\nsize: 27\n")
        write(p, "quests/first.yaml", "schema: quest/v1\nid: ignored\nname: First\nsteps:\n  - kill: 3\n")
        write(p, "quests/second.yaml", "schema: quest/v0\nname: Second\n")
        val bundle = read(p)
        assertFalse("quest" in bundle.documents)
        assertEquals(listOf("accueil"), bundle.menus.map { it.id })

        // Registered (by a module, through the API): read as raw documents, the
        // file name as id, the mapping untouched (W6).
        DocumentKinds.register(DocumentKind("quest", "quests", listOf("quest/v1", "quest/v0")))
        val quests = read(p).documentsOf<BundleRawDocument>("quest")
        assertEquals(listOf("first", "second"), quests.map { it.id })
        assertEquals("quest/v1", quests[0].schema)
        assertEquals("proj", quests[0].projectId)
        assertEquals(mapOf("schema" to "quest/v1", "name" to "First", "steps" to listOf(mapOf("kill" to 3))), quests[0].data)
        assertEquals("first", quests[0].toWire()["id"])
        assertEquals("First", quests[0].toWire()["name"])
    }

    @Test
    fun `a raw document with a schema its kind does not declare is rejected loudly`(@TempDir tmp: Path) {
        val p = project(tmp)
        write(p, "manifest.yaml", "schema: manifest/v1\n")
        write(p, "quests/first.yaml", "schema: quest/v9\nname: First\n")
        DocumentKinds.register(DocumentKind("quest", "quests", listOf("quest/v1")))
        assertThrows<IllegalArgumentException> { read(p) }
    }

    @Test
    fun `the core registry is what the API hands to modules`() {
        val registry = DocumentKinds.coreRegistry()
        assertEquals(listOf("menu", "command", "dialog"), registry.declarations().map { it.kind })
        DocumentKinds.bind(registry)
        registry.register(DocumentKindDeclaration("quest", "quests", "quest/v1"))
        assertEquals("quest", DocumentKinds.byDir("quests")?.kind)
        assertEquals(DocumentKind("quest", "quests", listOf("quest/v1")), DocumentKinds.byKind("quest"))
        assertEquals(listOf("menu", "command", "dialog", "quest"), DocumentKinds.all().map { it.kind })
    }

    @Test
    fun `the resource inventory follows the registry`() {
        assertEquals("menu", ResourceInventory.kind("menus/a.yaml"))
        assertNull(ResourceInventory.kind("quests/q.yaml"))
        DocumentKinds.register(DocumentKind("quest", "quests", listOf("quest/v1")))
        assertEquals("quest", ResourceInventory.kind("quests/q.yaml"))
    }
}
