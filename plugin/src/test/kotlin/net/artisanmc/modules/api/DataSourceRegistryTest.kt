package net.artisanmc.modules.api

import be.seeseemelk.mockbukkit.MockBukkit
import org.bukkit.entity.Player
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test

class DataSourceRegistryTest {

    private lateinit var player: Player

    @BeforeEach fun setup() {
        MockBukkit.mock()
        player = MockBukkit.getMock()!!.addPlayer()
    }

    @AfterEach fun teardown() { MockBukkit.unmock() }

    @Test
    fun `register and fetch returns the declared data`() {
        val registry = DataSourceRegistry()
        registry.register(DataSourceDeclaration(
            ref = "shop:items",
            fetcher = { _, _ -> listOf(mapOf("id" to "diamond", "price" to 100)) }
        ))

        val rows = registry.fetch("shop:items", player, emptyMap())

        assertEquals(1, rows.size)
        assertEquals("diamond", rows[0]["id"])
    }

    @Test
    fun `fetch on unknown ref throws UnknownDataSourceException`() {
        val registry = DataSourceRegistry()

        assertThrows(UnknownDataSourceException::class.java) {
            registry.fetch("ghost:items", player, emptyMap())
        }
    }

    @Test
    fun `registering twice with same ref throws DuplicateDataSourceException`() {
        val registry = DataSourceRegistry()
        registry.register(DataSourceDeclaration(ref = "shop:items", fetcher = { _, _ -> emptyList() }))

        assertThrows(DuplicateDataSourceException::class.java) {
            registry.register(DataSourceDeclaration(ref = "shop:items", fetcher = { _, _ -> emptyList() }))
        }
    }
}
