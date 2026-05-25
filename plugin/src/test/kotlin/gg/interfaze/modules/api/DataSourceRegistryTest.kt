package gg.interfaze.modules.api

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class DataSourceRegistryTest {

    @Test
    fun `register and fetch returns the declared data`() {
        val registry = DataSourceRegistry()
        val dummyPlayer = Any() // Any non-null object; not used in fetcher
        registry.register(DataSourceDeclaration(
            ref = "shop:items",
            fetcher = { _, _ -> listOf(mapOf("id" to "diamond", "price" to 100)) }
        ))

        val rows = registry.fetch("shop:items", dummyPlayer, emptyMap())

        assertEquals(1, rows.size)
        assertEquals("diamond", rows[0]["id"])
    }

    @Test
    fun `fetch on unknown ref throws UnknownDataSourceException`() {
        val registry = DataSourceRegistry()
        val dummyPlayer = Any()

        assertFailsWith<UnknownDataSourceException> {
            registry.fetch("ghost:items", dummyPlayer, emptyMap())
        }
    }

    @Test
    fun `registering twice with same ref throws DuplicateDataSourceException`() {
        val registry = DataSourceRegistry()
        registry.register(DataSourceDeclaration(ref = "shop:items", fetcher = { _, _ -> emptyList() }))

        assertFailsWith<DuplicateDataSourceException> {
            registry.register(DataSourceDeclaration(ref = "shop:items", fetcher = { _, _ -> emptyList() }))
        }
    }
}
