package net.artisanmc.plugin

import be.seeseemelk.mockbukkit.MockBukkit
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory
import com.fasterxml.jackson.module.kotlin.readValue
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import net.artisanmc.plugin.engine.*
import net.artisanmc.plugin.model.MenuYaml
import net.artisanmc.plugin.engine.MenuProvider
import net.artisanmc.plugin.render.MenuListener
import net.artisanmc.plugin.render.MenuRenderer
import net.artisanmc.plugin.render.MenuWindows
import org.bukkit.Material
import org.bukkit.entity.Player
import org.bukkit.event.inventory.InventoryCloseEvent
import org.bukkit.event.player.PlayerQuitEvent
import kotlin.test.*

class MenuRendererPlayerSlotsTest {
    @BeforeTest fun setup() { MockBukkit.mock() }
    @AfterTest fun teardown() { MockBukkit.unmock() }

    private val mapper = ObjectMapper(YAMLFactory()).registerKotlinModule()
    private fun player() = MockBukkit.getMock()!!.addPlayer()

    /** Slot 0 in the menu, 27 (1st inventory slot) and 62 (last hotbar slot) on the player side. */
    private fun menu(playerInventory: String? = null): MenuYaml = mapper.readValue(
        """
        schema: menu/v1
        id: bottom
        title: []
        size: 27
        ${playerInventory?.let { "player_inventory: $it" } ?: ""}
        elements:
          - id: btn
            positions: "0,27,62,63"
            material: STONE
            click:
              left:
                steps: 'run_command "hi" as player'
        """.trimIndent(),
    )

    @Test fun `hidden menu addresses the player slots and leaves the anchor empty`() {
        val p = player()
        val windows = MenuWindows(RecordingSink())
        val session = MenuRenderer.open(p, MenuCompiler.compile(menu("hidden"), emptyMap()), "en", windows = windows)

        assertTrue(p.openInventory.topInventory.isEmpty, "the anchor holds nothing")
        assertEquals(Material.STONE, session.slots[0]?.type)
        assertEquals(Material.STONE, session.slots[27]?.type)
        assertEquals(Material.STONE, session.slots[62]?.type)
        assertEquals(setOf(0, 27, 62), session.activeClicks.keys) // 63 = outside the window
        assertSame(session.slots, windows.get(p.uniqueId)!!.slots)
        assertSame(p.openInventory.topInventory, windows.get(p.uniqueId)!!.anchor)
    }

    @Test fun `visible is the default and ignores positions past the menu`() {
        val p = player()
        val session = MenuRenderer.open(p, MenuCompiler.compile(menu(), emptyMap()), "en")

        assertTrue(p.openInventory.topInventory.isEmpty)
        assertEquals(Material.STONE, session.slots[0]?.type)
        assertNull(session.slots[27])
        assertEquals(setOf(0), session.activeClicks.keys)
    }

    private fun listener(sessions: MenuSessionStore, windows: MenuWindows, resynced: MutableList<Player>): MenuListener {
        val plugin = MockBukkit.createMockPlugin()
        val provider = object : MenuProvider {
            override fun load() {}
            override fun unload() {}
            override fun findMenu(menuId: String) = null
            override fun listMenuIds() = emptyList<String>()
            override fun openMenu(player: Player, menuId: String, lang: String, ctx: ExecutionContext) {}
        }
        val executor = ActionExecutor(plugin, provider, sessions, SoftDepRegistry.EMPTY, CooldownStore(), ConditionEvaluator.EMPTY)
        return MenuListener(plugin, sessions, executor, windows) { resynced += it }
    }

    @Test fun `closing the menu releases its window and resyncs the real inventory next tick`() {
        val p = player()
        val windows = MenuWindows(RecordingSink())
        val resynced = mutableListOf<Player>()
        val sessions = MenuSessionStore()
        val l = listener(sessions, windows, resynced)
        MenuRenderer.open(p, MenuCompiler.compile(menu("hidden"), emptyMap()), "en", windows = windows)

        l.onClose(InventoryCloseEvent(p.openInventory))
        assertNull(windows.get(p.uniqueId))
        assertTrue(resynced.isEmpty())
        MockBukkit.getMock()!!.scheduler.performOneTick()
        assertEquals(listOf<Player>(p), resynced)
    }

    @Test fun `going from menu A to menu B keeps B's window`() {
        val p = player()
        val windows = MenuWindows(RecordingSink())
        val resynced = mutableListOf<Player>()
        val l = listener(MenuSessionStore(), windows, resynced)
        MenuRenderer.open(p, MenuCompiler.compile(menu("hidden"), emptyMap()), "en", windows = windows)
        val viewA = p.openInventory
        val b = MenuRenderer.open(p, MenuCompiler.compile(menu("hidden"), emptyMap()), "en", windows = windows)

        l.onClose(InventoryCloseEvent(viewA))
        assertSame(b.slots, windows.get(p.uniqueId)?.slots)
        MockBukkit.getMock()!!.scheduler.performOneTick()
        assertTrue(resynced.isEmpty())
    }

    @Test fun `a click in the menu resends the whole window next tick, the client's prediction is undone`() {
        val p = player()
        val sink = RecordingSink()
        val windows = MenuWindows(sink)
        val l = listener(MenuSessionStore(), windows, mutableListOf())
        MenuRenderer.open(p, MenuCompiler.compile(menu("hidden"), emptyMap()), "en", windows = windows)
        windows.onOpenWindow(p.uniqueId, 5)

        l.onClick(org.bukkit.event.inventory.InventoryClickEvent(
            p.openInventory, org.bukkit.event.inventory.InventoryType.SlotType.QUICKBAR, 62,
            org.bukkit.event.inventory.ClickType.LEFT, org.bukkit.event.inventory.InventoryAction.PICKUP_ALL,
        ))
        assertTrue(sink.calls.isEmpty())
        MockBukkit.getMock()!!.scheduler.performOneTick()
        assertEquals(listOf("all:5"), sink.calls)
        assertEquals(Material.STONE, sink.allSends.last()[62]?.type)
    }

    @Test fun `quitting forgets the window and the session`() {
        val p = player()
        val windows = MenuWindows(RecordingSink())
        val sessions = MenuSessionStore()
        val l = listener(sessions, windows, mutableListOf())
        sessions.set(p, MenuRenderer.open(p, MenuCompiler.compile(menu("hidden"), emptyMap()), "en", windows = windows))

        l.onQuit(PlayerQuitEvent(p, net.kyori.adventure.text.Component.empty(), PlayerQuitEvent.QuitReason.DISCONNECTED))
        assertNull(windows.get(p.uniqueId))
        assertNull(sessions.get(p))
    }
}
