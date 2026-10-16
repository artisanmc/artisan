package net.artisanmc.plugin

import be.seeseemelk.mockbukkit.MockBukkit
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory
import com.fasterxml.jackson.module.kotlin.readValue
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import net.artisanmc.modules.api.datasource.DataSourceDeclaration
import net.artisanmc.modules.api.datasource.DataSourceRegistry
import net.artisanmc.modules.api.datasource.Stability
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
            "boutique:items",
            { _, _ -> listOf(
                mapOf("id" to "sword", "name" to "Sword", "material" to "DIAMOND_SWORD"),
                mapOf("id" to "apple", "name" to "Apple", "material" to "APPLE"),
                mapOf("id" to "shield", "name" to "Shield", "material" to "SHIELD"),
            ) },
            emptyList(),
            Stability.STATIC,
            "id",
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
                material: "{item.material}"
                title: "{item.name}"
                lore: ["{item.name}"]
                click:
                  left:
                    steps: 'run_command "buy {item.id}" as player'
        """.trimIndent(),
    )

    @Test fun `places pins specific rows to slots and omits unplaced rows`() {
        val p = player()
        val m = BundleCompiler.compile(menu(
            "[ { key: sword, page: 0, position: 10 }, { key: shield, page: 0, position: 12 } ]"
        ), emptyMap())
        val inv = MenuRenderer.open(p, m, "en", ExecutionContext(p), dataSources = catalog()).slots
        assertEquals(Material.DIAMOND_SWORD, inv[10]?.type)
        assertEquals(Material.SHIELD, inv[12]?.type)
        assertNull(inv[11])            // nothing placed there
        assertNull(inv[13])            // apple never placed → omitted
    }

    @Test fun `placements are windowed by hand-assigned page`() {
        val p = player()
        val m = BundleCompiler.compile(menu(
            "[ { key: sword, page: 0, position: 10 }, { key: shield, page: 1, position: 10 } ]"
        ), emptyMap())

        val slots = MenuRenderer.open(p, m, "en", ExecutionContext(p), dataSources = catalog()).slots
        assertEquals(Material.DIAMOND_SWORD, slots[10]?.type)

        val p2 = player()
        val page1 = MenuRenderer.open(p2, m, "en", ExecutionContext(p2, pagination = mapOf("grid" to 1)), dataSources = catalog()).slots
        assertEquals(Material.SHIELD, page1[10]?.type)
    }

    @Test fun `a placement whose key is absent dangles and leaves the slot empty`() {
        val p = player()
        val m = BundleCompiler.compile(menu(
            "[ { key: ghost, page: 0, position: 10 }, { key: sword, page: 0, position: 11 } ]"
        ), emptyMap())
        val inv = MenuRenderer.open(p, m, "en", ExecutionContext(p), dataSources = catalog()).slots
        assertNull(inv[10])                                  // ghost dangles
        assertEquals(Material.DIAMOND_SWORD, inv[11]?.type)  // sword still fine
    }

    @Test fun `legacy override key in YAML is ignored — template supplies everything`() {
        // Per-placement overrides were dropped (CONTEXT.md "Placement"); old
        // bundles carrying `override:` still load (ignoreUnknown) but render
        // purely from the template.
        val p = player()
        val m = BundleCompiler.compile(menu(
            "[ { key: apple, page: 0, position: 12, override: { title: \"PROMO\", lore: [\"-50%\"] } } ]"
        ), emptyMap())
        val session = MenuRenderer.open(p, m, "en", ExecutionContext(p), dataSources = catalog())
        val item = session.slots[12]
        assertEquals(Material.APPLE, item?.type)                        // material from template
        assertNotEquals("PROMO", legacy(item?.itemMeta?.displayName())) // override NOT applied
        assertTrue(session.activeClicks.containsKey(12))                // click from template kept
        assertEquals(mapOf("id" to "apple", "name" to "Apple", "material" to "APPLE"), session.slotArgs[12]?.get("item"))
    }
}
