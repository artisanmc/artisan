package net.artisanmc.modules.api

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import net.artisanmc.modules.api.screen.DuplicateEditorScreenException
import net.artisanmc.modules.api.screen.EditorScreenRegistry

class EditorScreenRegistryTest {

    private fun registry() = EditorScreenRegistry()

    @Test
    fun `declares and lists screens sorted by id`() {
        val reg = registry()
        reg.declare("boutique:settings", "Réglages", "data/shop_settings", "boutique")
        reg.declare("boutique:catalog", "Catalogue", "data/categories", "boutique")
        assertEquals(listOf("boutique:catalog", "boutique:settings"), reg.declared().map { it.id })
        val catalog = reg.declared().first()
        assertEquals("Catalogue", catalog.label)
        assertEquals("data/categories", catalog.table)
        assertEquals("boutique", catalog.projectId)
    }

    @Test
    fun `duplicate id throws`() {
        val reg = registry()
        reg.declare("boutique:catalog", "Catalogue", "data/categories", "boutique")
        assertFailsWith<DuplicateEditorScreenException> {
            reg.declare("boutique:catalog", "Autre", "data/other", "boutique")
        }
    }

    @Test
    fun `id must be namespaced`() {
        assertFailsWith<IllegalArgumentException> {
            registry().declare("catalog", "Catalogue", "data/categories", "boutique")
        }
    }

    @Test
    fun `blank label or projectId rejected`() {
        assertFailsWith<IllegalArgumentException> {
            registry().declare("boutique:catalog", " ", "data/categories", "boutique")
        }
        assertFailsWith<IllegalArgumentException> {
            registry().declare("boutique:catalog", "Catalogue", "data/categories", "")
        }
    }

    @Test
    fun `unsafe table paths rejected`() {
        val reg = registry()
        assertFailsWith<IllegalArgumentException> {
            reg.declare("boutique:a", "A", "../outside", "boutique")
        }
        assertFailsWith<IllegalArgumentException> {
            reg.declare("boutique:b", "B", "/abs/path", "boutique")
        }
        assertFailsWith<IllegalArgumentException> {
            reg.declare("boutique:c", "C", ".artisan/editor", "boutique")
        }
        assertFailsWith<IllegalArgumentException> {
            reg.declare("boutique:e", "E", ".ARTISAN/history", "boutique")
        }
        assertFailsWith<IllegalArgumentException> {
            reg.declare("boutique:d", "D", "", "boutique")
        }
    }

    @Test
    fun `captures current owner as moduleId`() {
        val reg = registry()
        reg.bindOwner("boutique")
        reg.declare("boutique:catalog", "Catalogue", "data/categories", "boutique")
        reg.bindOwner(null)
        reg.declare("quests:board", "Quêtes", "data/quests", "quests")
        assertEquals("boutique", reg.declared().first { it.id == "boutique:catalog" }.moduleId)
        assertNull(reg.declared().first { it.id == "quests:board" }.moduleId)
    }

    @Test
    fun `toWire serializes snake_case fields`() {
        val reg = registry()
        reg.bindOwner("boutique")
        reg.declare("boutique:catalog", "Catalogue", "data/categories", "boutique")
        val wire = reg.declared().single().toWire()
        assertEquals("boutique:catalog", wire["id"])
        assertEquals("boutique", wire["module_id"])
        assertEquals("Catalogue", wire["label"])
        assertEquals("data/categories", wire["table"])
        assertEquals("boutique", wire["project_id"])
    }
}
