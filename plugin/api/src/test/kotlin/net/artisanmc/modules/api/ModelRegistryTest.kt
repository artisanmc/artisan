package net.artisanmc.modules.api

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue
import net.artisanmc.modules.api.model.DuplicateModelException
import net.artisanmc.modules.api.model.ModelRegistry

/**
 * ADR composable-data-models §4: an Add-on declares its Data models as
 * model/v1 documents — a pure passthrough (nothing interpreted plugin-side),
 * namespace-qualified ids, reported verbatim at Presence.
 */
class ModelRegistryTest {

    private fun doc(id: String, version: Int = 1): Map<String, Any?> = mapOf(
        "schema" to "model/v1",
        "id" to id,
        "name" to "Category",
        "key_field" to "id",
        "version" to version,
        "fields" to listOf(mapOf("name" to "id", "type" to mapOf("kind" to "string"))),
    )

    @Test
    fun `declare stores the document verbatim, sorted by id`() {
        val reg = ModelRegistry()
        reg.declare(doc("boutique:item"))
        reg.declare(doc("boutique:category"))
        assertEquals(listOf("boutique:category", "boutique:item"), reg.declared().map { it.id })
        assertEquals(doc("boutique:item"), reg.declared().last().document)
        assertTrue(reg.has("boutique:category"))
    }

    @Test
    fun `duplicate id throws`() {
        val reg = ModelRegistry()
        reg.declare(doc("boutique:category"))
        assertFailsWith<DuplicateModelException> { reg.declare(doc("boutique:category")) }
    }

    @Test
    fun `non-namespaced or id-less documents are rejected`() {
        val reg = ModelRegistry()
        assertFailsWith<IllegalArgumentException> { reg.declare(doc("category")) }
        assertFailsWith<IllegalArgumentException> { reg.declare(mapOf("schema" to "model/v1")) }
    }

    @Test
    fun `owner is captured while a module is being enabled`() {
        val reg = ModelRegistry()
        reg.bindOwner("boutique")
        reg.declare(doc("boutique:category"))
        reg.bindOwner(null)
        reg.declare(doc("quests:action"))
        assertEquals("boutique", reg.declared().first { it.id == "boutique:category" }.moduleId)
        assertEquals(null, reg.declared().first { it.id == "quests:action" }.moduleId)
    }
}
