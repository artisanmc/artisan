package net.artisanmc.modules.api

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue
import net.artisanmc.modules.api.model.DuplicateModelException
import net.artisanmc.modules.api.model.MigrationStep
import net.artisanmc.modules.api.model.ModelDeclaration
import net.artisanmc.modules.api.model.ModelField
import net.artisanmc.modules.api.model.ModelFieldType
import net.artisanmc.modules.api.model.ModelMigration
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

    @Test
    fun `a typed declaration reports the same model-v1 document as the raw map`() {
        val reg = ModelRegistry()
        reg.declare(
            ModelDeclaration("boutique:category", "id", listOf(ModelField("id", ModelFieldType.string())))
                .withName("Category")
                .withVersion(1),
        )
        assertEquals(doc("boutique:category"), reg.declared().single().document)
    }

    @Test
    fun `a typed declaration carries hints, migrations and master-detail`() {
        val decl = ModelDeclaration(
            "boutique:item", "id",
            listOf(
                ModelField("id", ModelFieldType.string(), true).withLocked(true),
                ModelField("price", ModelFieldType.number()).withRange(0.0, null).withSection("Shop").withLabel("Price"),
                ModelField("tier", ModelFieldType.enumOf(listOf("common", "rare"))).withDefault("common"),
                ModelField("code", ModelFieldType.string()).withPattern("^[A-Z]+$").withHelp("Upper case"),
            ),
        ).withVersion(3, listOf(
            ModelMigration(1, 2, listOf(MigrationStep.renameField("cost", "price"))),
            ModelMigration(2, 3, listOf(
                MigrationStep.renameEnumValue("tier", "basic", "common"),
                MigrationStep.setDefault("tier", "common", listOf("variants")),
                MigrationStep.renameVariant("reward", null, "cash", "money"),
            )),
        )).withMasterDetail(true)

        assertEquals(
            mapOf(
                "schema" to "model/v1",
                "id" to "boutique:item",
                "key_field" to "id",
                "fields" to listOf(
                    mapOf("name" to "id", "type" to mapOf("kind" to "string"), "required" to true, "locked" to true),
                    mapOf("name" to "price", "type" to mapOf("kind" to "number"), "label" to "Price", "section" to "Shop", "min" to 0.0),
                    mapOf("name" to "tier", "type" to mapOf("kind" to "enum", "values" to listOf("common", "rare")), "default" to "common"),
                    mapOf("name" to "code", "type" to mapOf("kind" to "string"), "help" to "Upper case", "pattern" to "^[A-Z]+$"),
                ),
                "version" to 3,
                "master_detail" to true,
                "migrations" to listOf(
                    mapOf("from" to 1, "to" to 2, "steps" to listOf(mapOf("op" to "rename_field", "from" to "cost", "to" to "price"))),
                    mapOf("from" to 2, "to" to 3, "steps" to listOf(
                        mapOf("op" to "rename_enum_value", "field" to "tier", "from" to "basic", "to" to "common"),
                        mapOf("op" to "set_default", "field" to "tier", "value" to "common", "path" to listOf("variants")),
                        mapOf("op" to "rename_variant", "field" to "reward", "from" to "cash", "to" to "money"),
                    )),
                ),
            ),
            decl.toWire(),
        )
        val reg = ModelRegistry()
        reg.declare(decl)
        assertEquals(decl.toWire(), reg.declared().single().document)
    }

    @Test
    fun `typed declarations share the raw rules`() {
        val reg = ModelRegistry()
        assertFailsWith<IllegalArgumentException> { reg.declare("category", "id", emptyList()) }
        reg.declare("boutique:category", "id", emptyList())
        assertFailsWith<DuplicateModelException> { reg.declare(doc("boutique:category")) }
    }

    @Test
    fun `migrations need a version that covers them`() {
        val base = ModelDeclaration("boutique:item", "id", emptyList())
        assertFailsWith<IllegalArgumentException> {
            base.withVersion(2, listOf(ModelMigration(2, 3, emptyList())))
        }
        assertFailsWith<IllegalArgumentException> { ModelMigration(2, 2, emptyList()) }
    }
}
