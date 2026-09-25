package net.artisanmc.plugin

import be.seeseemelk.mockbukkit.MockBukkit
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory
import com.fasterxml.jackson.module.kotlin.readValue
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import net.artisanmc.plugin.engine.*
import net.artisanmc.plugin.model.MenuYaml
import net.artisanmc.plugin.render.MenuRenderer
import net.artisanmc.plugin.render.PlayerSlotOverlayStore
import org.bukkit.Bukkit
import org.bukkit.Material
import kotlin.test.*

class MenuRendererPlayerSlotsTest {
    @BeforeTest fun setup() { MockBukkit.mock() }
    @AfterTest fun teardown() { MockBukkit.unmock() }

    private val mapper = ObjectMapper(YAMLFactory()).registerKotlinModule()
    private fun player() = MockBukkit.getMock()!!.addPlayer()

    /** Slot 0 dans le menu, 27 (1er slot d'inventaire) et 62 (dernier de la barre rapide) côté joueur. */
    private fun menu(): MenuYaml = mapper.readValue(
        """
        schema: menu/v1
        id: bottom
        title: []
        size: 27
        layers:
          - id: main
            name: Main
            elements:
              - id: btn
                positions: "0,27,62,63"
                material: STONE
                click:
                  left:
                    steps: 'run_command "hi" as player'
        """.trimIndent(),
    )

    @Test fun `active store routes positions past the menu to the player slot overlay`() {
        val p = player()
        val store = PlayerSlotOverlayStore().apply { active = true }
        val session = MenuRenderer.open(p, BundleCompiler.compile(menu(), emptyMap()), "en", playerSlots = store)

        assertEquals(Material.STONE, p.openInventory.topInventory.getItem(0)?.type)
        val overlay = assertNotNull(store.get(p.uniqueId))
        assertEquals(27, overlay.topSize)
        assertEquals(setOf(27, 62), overlay.items.keys) // 63 = hors fenêtre
        assertEquals(Material.STONE, overlay.items[27]?.type)
        assertEquals(setOf(0, 27, 62), session.activeClicks.keys)
    }

    @Test fun `inactive store keeps positions inside the menu`() {
        val p = player()
        val store = PlayerSlotOverlayStore()
        val session = MenuRenderer.open(p, BundleCompiler.compile(menu(), emptyMap()), "en", playerSlots = store)

        assertNull(store.get(p.uniqueId))
        assertEquals(setOf(0), session.activeClicks.keys)
    }

    @Test fun `closing another menu does not release the current overlay`() {
        val p = player()
        val store = PlayerSlotOverlayStore().apply { active = true }
        val a = Bukkit.createInventory(null, 27)
        val b = Bukkit.createInventory(null, 27)
        store.set(p, b, emptyMap())

        assertFalse(store.release(p, a))
        assertNotNull(store.get(p.uniqueId))
        assertTrue(store.release(p, b))
        assertNull(store.get(p.uniqueId))
    }
}
