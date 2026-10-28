package net.artisanmc.modules.api

import kotlin.test.Test
import kotlin.test.assertEquals
import net.artisanmc.modules.api.datasource.DataSourceField
import net.artisanmc.modules.api.datasource.FieldKind
import net.artisanmc.modules.api.model.ModelFieldType

/**
 * One field-type vocabulary (CONTEXT.md, API 2.0.0): a data source row field is typed with
 * [ModelFieldType]; the 1.x [FieldKind] maps onto it and still compiles, `@Sunset`.
 */
class DataSourceFieldTypeTest {

    @Test
    fun `every FieldKind maps to the ModelFieldType of the same wire kind`() {
        val expected = mapOf(
            FieldKind.STRING to ModelFieldType.string(),
            FieldKind.NUMBER to ModelFieldType.number(),
            FieldKind.INTEGER to ModelFieldType.integer(),
            FieldKind.BOOLEAN to ModelFieldType.bool(),
            FieldKind.LIST to ModelFieldType.list(ModelFieldType.string()),
            FieldKind.OBJECT to ModelFieldType.`object`(emptyList()),
            FieldKind.ITEM to ModelFieldType.item(),
        )
        assertEquals(FieldKind.values().toSet(), expected.keys)
        for ((kind, type) in expected) {
            assertEquals(type, kind.toModelFieldType(), "$kind")
            // The data_sources wire: the 1.x lowercase name is the ModelFieldType kind.
            assertEquals(kind.name.lowercase(), kind.toModelFieldType().kind)
            assertEquals(kind, FieldKind.closestTo(kind.toModelFieldType()), "$kind round-trips")
        }
    }

    @Test
    fun `richer kinds read as their closest FieldKind`() {
        val closest = mapOf(
            ModelFieldType.ltext() to FieldKind.STRING,
            ModelFieldType.minimessage() to FieldKind.STRING,
            ModelFieldType.enumOf(listOf("a", "b")) to FieldKind.STRING,
            ModelFieldType.documentRef("menu") to FieldKind.STRING,
            ModelFieldType.actions() to FieldKind.LIST,
            ModelFieldType.map(ModelFieldType.integer()) to FieldKind.OBJECT,
            ModelFieldType.model("shop:item") to FieldKind.OBJECT,
        )
        for ((type, kind) in closest) assertEquals(kind, FieldKind.closestTo(type), type.kind)
    }

    @Test
    fun `the FieldKind constructors build the mapped field`() {
        val legacy = DataSourceField("price", FieldKind.NUMBER, "Unit price")
        assertEquals(DataSourceField("price", ModelFieldType.number(), "Unit price"), legacy)
        assertEquals(ModelFieldType.number(), legacy.fieldType)
        assertEquals(FieldKind.NUMBER, legacy.type)
        assertEquals(DataSourceField("id", ModelFieldType.string()), DataSourceField("id", FieldKind.STRING))
    }

    @Test
    fun `a ModelFieldType field keeps its full type`() {
        val f = DataSourceField("lore", ModelFieldType.list(ModelFieldType.ltext()))
        assertEquals("list", f.fieldType.kind)
        assertEquals(ModelFieldType.ltext(), f.fieldType.of)
        assertEquals(FieldKind.LIST, f.type)
    }
}
