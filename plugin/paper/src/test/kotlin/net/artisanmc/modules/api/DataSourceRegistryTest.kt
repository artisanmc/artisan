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
            "shop:items",
            { _, _ -> listOf(mapOf("id" to "diamond", "price" to 100)) },
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
        registry.register(DataSourceDeclaration("shop:items", { _, _ -> emptyList() }))

        assertThrows(DuplicateDataSourceException::class.java) {
            registry.register(DataSourceDeclaration("shop:items", { _, _ -> emptyList() }))
        }
    }

    @Test
    fun `declarations returns registered declarations`() {
        val reg = DataSourceRegistry()
        val decl = DataSourceDeclaration("shop:items", { _, _ -> emptyList() })
        reg.register(decl)
        assertEquals(listOf(decl), reg.declarations())
    }

    @Test
    fun `declarations are sorted by ref`() {
        val reg = DataSourceRegistry()
        reg.register(DataSourceDeclaration("shop:items", { _, _ -> emptyList() }))
        reg.register(DataSourceDeclaration("auction:listings", { _, _ -> emptyList() }))
        assertEquals(listOf("auction:listings", "shop:items"), reg.declarations().map { it.ref })
    }

    @Test
    fun `fetch accepts a null player (preview mode)`() {
        val registry = DataSourceRegistry()
        registry.register(DataSourceDeclaration(
            "shop:items",
            { p, _ -> listOf(mapOf("player" to (p?.name ?: "none"))) },
        ))
        val rows = registry.fetch("shop:items", null, emptyMap())
        assertEquals("none", rows[0]["player"])
    }

    @Test
    fun `declaration carries a typed schema (empty by default)`() {
        val decl = DataSourceDeclaration(
            "shop:items",
            { _, _ -> emptyList() },
            listOf(DataSourceField("price", FieldKind.NUMBER, "Unit price")),
        )
        assertEquals("price", decl.schema[0].name)
        assertEquals(FieldKind.NUMBER, decl.schema[0].type)
        assertTrue(DataSourceDeclaration("a:b", { _, _ -> emptyList() }).schema.isEmpty())
    }

    @Test
    fun `declaration defaults to dynamic stability and null keyField`() {
        val decl = DataSourceDeclaration("a:b", { _, _ -> emptyList() })
        assertEquals(Stability.DYNAMIC, decl.stability)
        assertNull(decl.keyField)
    }

    @Test
    fun `static declaration carries stability and keyField`() {
        val decl = DataSourceDeclaration(
            "boutique:items",
            { _, _ -> emptyList() },
            emptyList(),
            Stability.STATIC,
            "id",
        )
        assertEquals(Stability.STATIC, decl.stability)
        assertEquals("id", decl.keyField)
    }

    @Test
    fun `static declaration without a keyField is rejected`() {
        assertThrows(IllegalArgumentException::class.java) {
            DataSourceDeclaration(
                "boutique:items",
                { _, _ -> emptyList() },
                emptyList(),
                Stability.STATIC,
                null,
            )
        }
        assertThrows(IllegalArgumentException::class.java) {
            DataSourceDeclaration(
                "boutique:items",
                { _, _ -> emptyList() },
                emptyList(),
                Stability.STATIC,
                "  ",
            )
        }
    }

    @Test
    fun `ModuleRegistry register scopes currentOwner around onEnable`() {
        val server = MockBukkit.getMock()!!
        val plugin = MockBukkit.load(net.artisanmc.plugin.ArtisanPlugin::class.java)
        val module = object : ArtisanModule {
            override fun getId() = "boutique"
            override fun getSchemaVersion() = "menu/v1"
            override fun onEnable(api: ArtisanAPI) {
                api.dataSources.register(DataSourceDeclaration("boutique:owned", { _, _ -> emptyList() }))
            }
            override fun onDisable() {}
            override fun onReload() {}
        }
        plugin.api.modules.register(module)
        val entry = plugin.api.dataSources.registered().first { it.declaration.ref == "boutique:owned" }
        assertEquals("boutique", entry.moduleId)
        plugin.api.dataSources.register(DataSourceDeclaration("core:after", { _, _ -> emptyList() }))
        assertNull(plugin.api.dataSources.registered().first { it.declaration.ref == "core:after" }.moduleId)
    }
}
