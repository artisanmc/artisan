package net.artisanmc.plugin

import be.seeseemelk.mockbukkit.MockBukkit
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory
import com.fasterxml.jackson.module.kotlin.readValue
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import net.artisanmc.modules.api.DataSourceDeclaration
import net.artisanmc.modules.api.DataSourceRegistry
import net.artisanmc.plugin.engine.BundleCompiler
import net.artisanmc.plugin.engine.ExecutionContext
import net.artisanmc.plugin.model.MenuYaml
import net.artisanmc.plugin.render.MenuRenderer
import org.bukkit.Material
import kotlin.test.*

class MenuRendererDataSourceTest {
    @BeforeTest fun setup() { MockBukkit.mock() }
    @AfterTest fun teardown() { MockBukkit.unmock() }

    private val mapper = ObjectMapper(YAMLFactory()).registerKotlinModule()
    private fun player() = MockBukkit.getMock()!!.addPlayer()

    private fun shopMenu(): MenuYaml = mapper.readValue(
        """
        schema: menu/v1
        id: shop
        title: []
        size: 27
        context_inputs:
          - name: items
            type: list
            source:
              ref: "boutique:items"
              filter: { category: "weapons" }
        layers:
          - id: main
            name: Main
            elements:
              - id: grid
                positions: "10-12"
                iterates: { source: items, alias: item }
                material: "{item.material}"
                title: "{item.name}"
        """.trimIndent(),
    )

    @Test fun `iterating element renders rows fetched from a registered data source`() {
        val p = player()
        val registry = DataSourceRegistry()
        registry.register(DataSourceDeclaration(
            "boutique:items",
            { _, _ -> listOf(
                mapOf("id" to "sword", "name" to "Sword", "material" to "DIAMOND_SWORD", "category" to "weapons"),
                mapOf("id" to "apple", "name" to "Apple", "material" to "APPLE", "category" to "food"),
            ) },
        ))
        val menu = BundleCompiler.compile(shopMenu(), emptyMap())
        val inv = MenuRenderer.open(p, menu, "en", ExecutionContext(p), dataSources = registry).slots
        assertEquals(Material.DIAMOND_SWORD, inv[10]?.type)
        assertNull(inv[11]) // apple filtered out (category != weapons)
    }

    private fun directRefMenu(): MenuYaml = mapper.readValue(
        """
        schema: menu/v1
        id: shop
        title: []
        size: 27
        elements:
          - id: grid
            positions: 10-12
            iterates: { source: "boutique:items", alias: item }
            material: "{item.material}"
            title: "{item.name}"
        """.trimIndent(),
    )

    @Test fun `iterates source accepts a direct data source ref (no declared input)`() {
        val p = player()
        val registry = DataSourceRegistry()
        registry.register(DataSourceDeclaration(
            "boutique:items",
            { _, _ -> listOf(
                mapOf("id" to "sword", "name" to "Sword", "material" to "DIAMOND_SWORD"),
            ) },
        ))
        val menu = BundleCompiler.compile(directRefMenu(), emptyMap())
        val slots = MenuRenderer.open(p, menu, "en", ExecutionContext(p), dataSources = registry).slots
        assertEquals(Material.DIAMOND_SWORD, slots[10]?.type)
    }

    @Test fun `direct ref that resolves nothing renders empty (non-hermetic)`() {
        val p = player()
        val menu = BundleCompiler.compile(directRefMenu(), emptyMap())
        val slots = MenuRenderer.open(p, menu, "en", ExecutionContext(p), dataSources = DataSourceRegistry()).slots
        assertNull(slots[10])
    }

    @Test fun `unknown ref renders an empty grid without throwing`() {
        val p = player()
        val menu = BundleCompiler.compile(shopMenu(), emptyMap())
        val slots = MenuRenderer.open(p, menu, "en", ExecutionContext(p), dataSources = DataSourceRegistry()).slots
        assertNull(slots[10])
    }

    @Test fun `no registry keeps the legacy behavior`() {
        val p = player()
        val menu = BundleCompiler.compile(shopMenu(), emptyMap())
        val slots = MenuRenderer.open(p, menu, "en", ExecutionContext(p)).slots
        assertNull(slots[10])
    }
}
