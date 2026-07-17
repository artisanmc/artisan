package net.artisanmc.plugin

import be.seeseemelk.mockbukkit.MockBukkit
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory
import com.fasterxml.jackson.module.kotlin.readValue
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import net.artisanmc.modules.api.DataSourceDeclaration
import net.artisanmc.modules.api.DataSourceRegistry
import net.artisanmc.modules.api.Stability
import net.artisanmc.plugin.engine.BundleCompiler
import net.artisanmc.plugin.engine.ExecutionContext
import net.artisanmc.plugin.model.MenuYaml
import net.artisanmc.plugin.render.MenuRenderer
import net.kyori.adventure.text.serializer.legacy.LegacyComponentSerializer
import org.bukkit.Material
import kotlin.test.*

class MenuRendererPlacementTest {
    @BeforeTest fun setup() { MockBukkit.mock() }
    @AfterTest fun teardown() { MockBukkit.unmock() }

    private val mapper = ObjectMapper(YAMLFactory()).registerKotlinModule()
    private fun player() = MockBukkit.getMock()!!.addPlayer()
    private fun legacy(c: net.kyori.adventure.text.Component?) =
        c?.let { LegacyComponentSerializer.legacySection().serialize(it) }

    private fun catalog() = DataSourceRegistry().apply {
        register(DataSourceDeclaration(
            ref = "boutique:items",
            fetcher = { _, _ -> listOf(
                mapOf("id" to "sword", "name" to "Sword", "material" to "DIAMOND_SWORD"),
                mapOf("id" to "apple", "name" to "Apple", "material" to "APPLE"),
                mapOf("id" to "shield", "name" to "Shield", "material" to "SHIELD"),
            ) },
            stability = Stability.STATIC,
            keyField = "id",
        ))
    }

    private fun menu(placements: String): MenuYaml = mapper.readValue(
        """
        schema: menu/v1
        id: shop
        title: []
        size: 27
        context_inputs:
          - name: items
            type: list
            source: { ref: "boutique:items" }
        layers:
          - id: main
            name: Main
            elements:
              - id: grid
                places:
                  source: items
                  alias: item
                  key_field: id
                  placements: $placements
                appearances:
                  - material: "{item.material}"
                    title: "{item.name}"
                    lore: ["{item.name}"]
                    click:
                      left:
                        steps:
                          - { kind: action, action: { type: run_command, command: "buy {item.id}" } }
        """.trimIndent(),
    )

    @Test fun `places pins specific rows to slots and omits unplaced rows`() {
        val p = player()
        val m = BundleCompiler.compile(menu(
            "[ { key: sword, page: 0, position: 10 }, { key: shield, page: 0, position: 12 } ]"
        ), emptyMap())
        MenuRenderer.open(p, m, "en", ExecutionContext(p), dataSources = catalog())
        val inv = p.openInventory.topInventory
        assertEquals(Material.DIAMOND_SWORD, inv.getItem(10)?.type)
        assertEquals(Material.SHIELD, inv.getItem(12)?.type)
        assertNull(inv.getItem(11))            // nothing placed there
        assertNull(inv.getItem(13))            // apple never placed → omitted
    }

    @Test fun `placements are windowed by hand-assigned page`() {
        val p = player()
        val m = BundleCompiler.compile(menu(
            "[ { key: sword, page: 0, position: 10 }, { key: shield, page: 1, position: 10 } ]"
        ), emptyMap())

        MenuRenderer.open(p, m, "en", ExecutionContext(p), dataSources = catalog())
        assertEquals(Material.DIAMOND_SWORD, p.openInventory.topInventory.getItem(10)?.type)

        val p2 = player()
        MenuRenderer.open(p2, m, "en", ExecutionContext(p2, pagination = mapOf("grid" to 1)), dataSources = catalog())
        assertEquals(Material.SHIELD, p2.openInventory.topInventory.getItem(10)?.type)
    }

    @Test fun `a placement whose key is absent dangles and leaves the slot empty`() {
        val p = player()
        val m = BundleCompiler.compile(menu(
            "[ { key: ghost, page: 0, position: 10 }, { key: sword, page: 0, position: 11 } ]"
        ), emptyMap())
        MenuRenderer.open(p, m, "en", ExecutionContext(p), dataSources = catalog())
        val inv = p.openInventory.topInventory
        assertNull(inv.getItem(10))                                  // ghost dangles
        assertEquals(Material.DIAMOND_SWORD, inv.getItem(11)?.type)  // sword still fine
    }

    @Test fun `override changes display only, template still supplies material and click`() {
        val p = player()
        val m = BundleCompiler.compile(menu(
            "[ { key: apple, page: 0, position: 12, override: { title: \"PROMO\", lore: [\"-50%\"] } } ]"
        ), emptyMap())
        val session = MenuRenderer.open(p, m, "en", ExecutionContext(p), dataSources = catalog())
        val item = p.openInventory.topInventory.getItem(12)
        assertEquals(Material.APPLE, item?.type)                       // material from template
        assertEquals("PROMO", legacy(item?.itemMeta?.displayName()))   // title overridden
        assertEquals(listOf("-50%"), item?.itemMeta?.lore()?.map { legacy(it) }) // lore overridden
        assertTrue(session.activeClicks.containsKey(12))              // click from template kept
        assertEquals(mapOf("id" to "apple", "name" to "Apple", "material" to "APPLE"), session.slotArgs[12]?.get("item"))
    }
}
