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

    @Test
    fun `declarations returns registered declarations`() {
        val reg = DataSourceRegistry()
        val decl = DataSourceDeclaration(ref = "shop:items", fetcher = { _, _ -> emptyList() }, schemaHint = "id, name, price")
        reg.register(decl)
        assertEquals(listOf(decl), reg.declarations())
    }

    @Test
    fun `declarations are sorted by ref`() {
        val reg = DataSourceRegistry()
        reg.register(DataSourceDeclaration(ref = "shop:items", fetcher = { _, _ -> emptyList() }))
        reg.register(DataSourceDeclaration(ref = "auction:listings", fetcher = { _, _ -> emptyList() }))
        assertEquals(listOf("auction:listings", "shop:items"), reg.declarations().map { it.ref })
    }

    @Test
    fun `fetch accepts a null player (preview mode)`() {
        val registry = DataSourceRegistry()
        registry.register(DataSourceDeclaration(
            ref = "shop:items",
            fetcher = { p, _ -> listOf(mapOf("player" to (p?.name ?: "none"))) },
        ))
        val rows = registry.fetch("shop:items", null, emptyMap())
        assertEquals("none", rows[0]["player"])
    }

    @Test
    fun `declaration carries a typed schema (empty by default)`() {
        val decl = DataSourceDeclaration(
            ref = "shop:items",
            fetcher = { _, _ -> emptyList() },
            schema = listOf(DataSourceField("price", FieldKind.NUMBER, "Unit price")),
        )
        assertEquals("price", decl.schema[0].name)
        assertEquals(FieldKind.NUMBER, decl.schema[0].type)
        assertTrue(DataSourceDeclaration(ref = "a:b", fetcher = { _, _ -> emptyList() }).schema.isEmpty())
    }

    @Test
    fun `register captures currentOwner as moduleId, null otherwise`() {
        val registry = DataSourceRegistry()
        registry.register(DataSourceDeclaration(ref = "core:free", fetcher = { _, _ -> emptyList() }))
        registry.currentOwner = "boutique"
        registry.register(DataSourceDeclaration(ref = "boutique:items", fetcher = { _, _ -> emptyList() }))
        registry.currentOwner = null

        val byRef = registry.registered().associateBy { it.declaration.ref }
        assertNull(byRef["core:free"]!!.moduleId)
        assertEquals("boutique", byRef["boutique:items"]!!.moduleId)
    }

    @Test
    fun `ModuleRegistry register scopes currentOwner around onEnable`() {
        val server = MockBukkit.getMock()!!
        val plugin = MockBukkit.load(net.artisanmc.plugin.ArtisanPlugin::class.java)
        val module = object : ArtisanModule {
            override val id = "boutique"
            override val schemaVersion = "menu/v1"
            override fun onEnable(api: ArtisanAPI) {
                api.dataSources.register(DataSourceDeclaration(ref = "boutique:owned", fetcher = { _, _ -> emptyList() }))
            }
            override fun onDisable() {}
            override fun onReload() {}
        }
        plugin.api.modules.register(module)
        val entry = plugin.api.dataSources.registered().first { it.declaration.ref == "boutique:owned" }
        assertEquals("boutique", entry.moduleId)
        assertNull(plugin.api.dataSources.currentOwner)
    }
}
