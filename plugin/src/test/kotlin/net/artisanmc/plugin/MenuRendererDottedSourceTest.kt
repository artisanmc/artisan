package net.artisanmc.plugin

import be.seeseemelk.mockbukkit.MockBukkit
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory
import com.fasterxml.jackson.module.kotlin.readValue
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import net.artisanmc.plugin.engine.BundleCompiler
import net.artisanmc.plugin.engine.ExecutionContext
import net.artisanmc.plugin.model.MenuYaml
import net.artisanmc.plugin.render.MenuRenderer
import org.bukkit.Material
import kotlin.test.*

/**
 * Iteration/placement sources support DOTTED paths into a context object:
 * `iterates.source: category.items` walks the `category` arg (a whole row
 * passed via whole-model context) down to its `items` list. Complements the
 * flat sourceRef+filter idiom — both work.
 */
class MenuRendererDottedSourceTest {
    @BeforeTest fun setup() { MockBukkit.mock() }
    @AfterTest fun teardown() { MockBukkit.unmock() }

    private val mapper = ObjectMapper(YAMLFactory()).registerKotlinModule()
    private fun player() = MockBukkit.getMock()!!.addPlayer()

    private fun menu(): MenuYaml = mapper.readValue(
        """
        schema: menu/v1
        id: shop_category
        title: []
        size: 27
        layers:
          - id: main
            name: Main
            elements:
              - id: grid
                positions: "10-12"
                iterates: { source: category.items, alias: item }
                material: "{item.material}"
        """.trimIndent(),
    )

    @Test fun `iterates over a list field of a context object`() {
        val p = player()
        val m = BundleCompiler.compile(menu(), emptyMap())
        val category = mapOf(
            "id" to "weapons",
            "name" to "Armes",
            "items" to listOf(
                mapOf("id" to "sword", "material" to "DIAMOND_SWORD"),
                mapOf("id" to "shield", "material" to "SHIELD"),
            ),
        )
        MenuRenderer.open(p, m, "en", ExecutionContext(p, args = mapOf("category" to category)))
        val inv = p.openInventory.topInventory
        assertEquals(Material.DIAMOND_SWORD, inv.getItem(10)?.type)
        assertEquals(Material.SHIELD, inv.getItem(11)?.type)
        assertNull(inv.getItem(12))
    }

    @Test fun `missing dotted path renders nothing instead of crashing`() {
        val p = player()
        val m = BundleCompiler.compile(menu(), emptyMap())
        MenuRenderer.open(p, m, "en", ExecutionContext(p))
        assertNull(p.openInventory.topInventory.getItem(10))
    }
}
