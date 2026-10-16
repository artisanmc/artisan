package net.artisanmc.plugin

import net.artisanmc.modules.api.datasource.DataSourceDeclaration
import net.artisanmc.modules.api.datasource.DataSourceField
import net.artisanmc.modules.api.datasource.DataSourceRegistry
import net.artisanmc.modules.api.datasource.FieldKind
import net.artisanmc.modules.api.datasource.RegisteredDataSource
import net.artisanmc.modules.api.datasource.Stability
import net.artisanmc.modules.api.model.ModelFieldType
import net.artisanmc.plugin.ws.DataSourceReport
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class DataSourceReportTest {
    @Test
    fun `build emits ref, module_id and typed schema`() {
        val declaration = DataSourceDeclaration(
            "boutique:items",
            { _, _ -> emptyList() },
            listOf(
                DataSourceField("id", FieldKind.STRING),
                DataSourceField("price", FieldKind.NUMBER, "Unit price"),
            ),
        )

        val report = DataSourceReport.build(listOf(RegisteredDataSource(declaration, "boutique")))
        assertEquals(1, report.size)
        val entry = report[0]
        assertEquals("boutique:items", entry["ref"])
        assertEquals("boutique", entry["module_id"])
        assertFalse("schema_hint" in entry)
        @Suppress("UNCHECKED_CAST")
        val schema = entry["schema"] as List<Map<String, Any?>>
        assertEquals(mapOf("name" to "id", "type" to "string", "description" to null), schema[0])
        assertEquals(mapOf("name" to "price", "type" to "number", "description" to "Unit price"), schema[1])
    }

    @Test
    fun `a ModelFieldType field reports its kind`() {
        val declaration = DataSourceDeclaration(
            "boutique:items",
            { _, _ -> emptyList() },
            listOf(
                DataSourceField("title", ModelFieldType.ltext()),
                DataSourceField("lore", ModelFieldType.list(ModelFieldType.ltext())),
            ),
        )
        @Suppress("UNCHECKED_CAST")
        val schema = DataSourceReport.build(listOf(RegisteredDataSource(declaration, "boutique")))[0]["schema"] as List<Map<String, Any?>>
        assertEquals(listOf("ltext", "list"), schema.map { it["type"] })
    }

    @Test
    fun `build emits stability and key_field`() {
        val registry = DataSourceRegistry()
        registry.register(DataSourceDeclaration(
            "boutique:items",
            { _, _ -> emptyList() },
            emptyList(),
            Stability.STATIC,
            "id",
        ))
        registry.register(DataSourceDeclaration(
            "auction:listings",
            { _, _ -> emptyList() },
        ))

        val byRef = DataSourceReport.build(registry).associateBy { it["ref"] }
        assertEquals("static", byRef["boutique:items"]!!["stability"])
        assertEquals("id", byRef["boutique:items"]!!["key_field"])
        assertEquals("dynamic", byRef["auction:listings"]!!["stability"])
        assertNull(byRef["auction:listings"]!!["key_field"])
    }

    @Test
    fun `build is sorted by ref and tolerates empty schema`() {
        val registry = DataSourceRegistry()
        registry.register(DataSourceDeclaration("z:last", { _, _ -> emptyList() }))
        registry.register(DataSourceDeclaration("a:first", { _, _ -> emptyList() }))
        val report = DataSourceReport.build(registry)
        assertEquals(listOf("a:first", "z:last"), report.map { it["ref"] })
        assertEquals(emptyList<Any?>(), report[0]["schema"])
        assertNull(report[0]["module_id"])
    }
}
