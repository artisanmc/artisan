package net.artisanmc.plugin

import net.artisanmc.modules.api.DataSourceDeclaration
import net.artisanmc.modules.api.DataSourceField
import net.artisanmc.modules.api.DataSourceRegistry
import net.artisanmc.modules.api.FieldKind
import net.artisanmc.modules.api.RegisteredDataSource
import net.artisanmc.modules.api.Stability
import net.artisanmc.plugin.ws.DataSourceReport
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class DataSourceReportTest {
    @Test
    fun `build emits ref, module_id, typed schema and legacy schema_hint`() {
        val declaration = DataSourceDeclaration(
            ref = "boutique:items",
            fetcher = { _, _ -> emptyList() },
            schema = listOf(
                DataSourceField("id", FieldKind.STRING),
                DataSourceField("price", FieldKind.NUMBER, "Unit price"),
            ),
            schemaHint = "id, price",
        )

        val report = DataSourceReport.build(listOf(RegisteredDataSource(declaration, "boutique")))
        assertEquals(1, report.size)
        val entry = report[0]
        assertEquals("boutique:items", entry["ref"])
        assertEquals("boutique", entry["module_id"])
        assertEquals("id, price", entry["schema_hint"])
        @Suppress("UNCHECKED_CAST")
        val schema = entry["schema"] as List<Map<String, Any?>>
        assertEquals(mapOf("name" to "id", "type" to "string", "description" to null), schema[0])
        assertEquals(mapOf("name" to "price", "type" to "number", "description" to "Unit price"), schema[1])
    }

    @Test
    fun `build emits stability and key_field`() {
        val registry = DataSourceRegistry()
        registry.register(DataSourceDeclaration(
            ref = "boutique:items",
            fetcher = { _, _ -> emptyList() },
            stability = Stability.STATIC,
            keyField = "id",
        ))
        registry.register(DataSourceDeclaration(
            ref = "auction:listings",
            fetcher = { _, _ -> emptyList() },
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
        registry.register(DataSourceDeclaration(ref = "z:last", fetcher = { _, _ -> emptyList() }))
        registry.register(DataSourceDeclaration(ref = "a:first", fetcher = { _, _ -> emptyList() }))
        val report = DataSourceReport.build(registry)
        assertEquals(listOf("a:first", "z:last"), report.map { it["ref"] })
        assertEquals(emptyList<Any?>(), report[0]["schema"])
        assertNull(report[0]["module_id"])
    }
}
