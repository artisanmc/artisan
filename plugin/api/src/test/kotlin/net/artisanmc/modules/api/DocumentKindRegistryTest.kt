package net.artisanmc.modules.api

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import net.artisanmc.modules.api.document.DocumentKindDeclaration
import net.artisanmc.modules.api.document.DocumentKindRegistry
import net.artisanmc.modules.api.document.DuplicateDocumentKindException

/** ADR `extensible-document-kinds`, W6: a module declares its Document kinds through the API. */
class DocumentKindRegistryTest {

    private fun quest() = DocumentKindDeclaration("quest", "quests", listOf("quest/v1", "quest/v0"), "quest_")

    @Test
    fun `registers in order and resolves by kind and by folder`() {
        val reg = DocumentKindRegistry()
        reg.register(DocumentKindDeclaration("menu", "menus", "menu/v1"))
        reg.register(quest())
        assertEquals(listOf("menu", "quest"), reg.declarations().map { it.kind })
        assertEquals("quests", reg.find("quest")?.dir)
        assertEquals("quest", reg.byDir("quests")?.kind)
        assertTrue(reg.has("quest"))
        assertFalse(reg.has("shop"))
        assertNull(reg.find("shop"))
        assertNull(reg.byDir("shops"))
    }

    @Test
    fun `a kind may not reuse an id or a folder`() {
        val reg = DocumentKindRegistry()
        reg.register(quest())
        assertFailsWith<DuplicateDocumentKindException> { reg.register(DocumentKindDeclaration("quest", "other", "x/v1")) }
        assertFailsWith<DuplicateDocumentKindException> { reg.register(DocumentKindDeclaration("other", "quests", "x/v1")) }
        // Still an IllegalStateException for a caller that only knows the registries' common contract.
        assertFailsWith<IllegalStateException> { reg.register(quest()) }
        assertEquals(listOf("quest"), reg.declarations().map { it.kind })
    }

    @Test
    fun `unregister by kind and by owner`() {
        val reg = DocumentKindRegistry()
        reg.bindOwner("quests")
        reg.register(quest())
        reg.bindOwner(null)
        reg.register(DocumentKindDeclaration("menu", "menus", "menu/v1"))

        assertEquals("quests", reg.registered().first { it.declaration.kind == "quest" }.moduleId)
        assertNull(reg.registered().first { it.declaration.kind == "menu" }.moduleId)

        reg.unregisterOwnedBy("quests")
        assertEquals(listOf("menu"), reg.declarations().map { it.kind })
        assertTrue(reg.unregister("menu"))
        assertFalse(reg.unregister("menu"))
        assertTrue(reg.declarations().isEmpty())
    }

    @Test
    fun `declaration validates its fields and reports the canonical schema`() {
        val q = quest()
        assertEquals("quest/v1", q.canonicalSchema)
        assertTrue(q.acceptsSchema("quest/v0"))
        assertTrue(q.acceptsSchema(""))
        assertFalse(q.acceptsSchema("quest/v2"))
        assertFailsWith<IllegalArgumentException> { DocumentKindDeclaration("Quest", "quests", "quest/v1") }
        assertFailsWith<IllegalArgumentException> { DocumentKindDeclaration("quest", "my quests", "quest/v1") }
        assertFailsWith<IllegalArgumentException> { DocumentKindDeclaration("quest", "quests", emptyList(), null) }
    }

    @Test
    fun `toWire serializes snake_case fields and the owner`() {
        val reg = DocumentKindRegistry()
        reg.bindOwner("quests")
        reg.register(quest())
        val wire = reg.registered().single().toWire()
        assertEquals("quest", wire["kind"])
        assertEquals("quests", wire["dir"])
        assertEquals(listOf("quest/v1", "quest/v0"), wire["schema_versions"])
        assertEquals("quest_", wire["id_prefix"])
        assertEquals("quests", wire["module_id"])
        val bare = DocumentKindDeclaration("menu", "menus", "menu/v1").toWire()
        assertFalse("id_prefix" in bare)
        assertFalse("module_id" in bare)
    }
}
