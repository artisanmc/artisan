package net.artisanmc.plugin

import be.seeseemelk.mockbukkit.MockBukkit
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory
import com.fasterxml.jackson.module.kotlin.readValue
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import net.artisanmc.plugin.engine.*
import net.artisanmc.plugin.model.MenuYaml
import net.artisanmc.plugin.render.MenuRenderer
import org.bukkit.event.inventory.InventoryType
import kotlin.test.*

class MenuRendererInventoryTypeTest {
    @BeforeTest fun setup() { MockBukkit.mock() }
    @AfterTest fun teardown() { MockBukkit.unmock() }

    private val mapper = ObjectMapper(YAMLFactory()).registerKotlinModule()
    private fun player() = MockBukkit.getMock()!!.addPlayer()

    private fun menuYaml(type: String?, size: Int): MenuYaml = mapper.readValue(
        """
        schema: menu/v1
        id: m
        title: []
        ${if (type != null) "inventory_type: $type" else ""}
        size: $size
        layers:
          - id: l
            name: L
            elements:
              - id: e
                positions: "0"
                material: STONE
        """.trimIndent(),
    )

    private fun openType(type: String?, size: Int): InventoryType {
        val p = player()
        val menu = MenuCompiler.compile(menuYaml(type, size), emptyMap())
        val slots = MenuRenderer.open(p, menu, "en", ExecutionContext(p)).slots
        return p.openInventory.topInventory.type
    }

    @Test fun `hopper menu opens a HOPPER inventory`() {
        assertEquals(InventoryType.HOPPER, openType("hopper", 5))
    }

    @Test fun `dropper menu opens a DROPPER inventory`() {
        assertEquals(InventoryType.DROPPER, openType("dropper", 9))
    }

    @Test fun `menu without inventory_type opens a CHEST`() {
        assertEquals(InventoryType.CHEST, openType(null, 27))
    }

    @Test fun `dropper top inventory has 9 slots and slot 0 populated`() {
        val p = player()
        val menu = MenuCompiler.compile(menuYaml("dropper", 9), emptyMap())
        val slots = MenuRenderer.open(p, menu, "en", ExecutionContext(p)).slots
        assertEquals(9, p.openInventory.topInventory.size)
        assertNotNull(slots[0])
    }
}
