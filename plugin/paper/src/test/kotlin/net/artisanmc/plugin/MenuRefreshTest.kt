package net.artisanmc.plugin

import be.seeseemelk.mockbukkit.MockBukkit
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory
import com.fasterxml.jackson.module.kotlin.readValue
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import net.artisanmc.plugin.engine.*
import net.artisanmc.plugin.integrations.SoftDepRegistry
import net.artisanmc.plugin.model.MenuYaml
import net.artisanmc.plugin.render.menu.MenuRefreshLoop
import net.artisanmc.plugin.render.menu.MenuRenderer
import net.artisanmc.plugin.scheduling.Scheduler
import net.artisanmc.plugin.session.MenuSlots
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer
import org.bukkit.Material
import org.bukkit.inventory.ItemStack
import java.util.UUID
import kotlin.test.*

class MenuRefreshTest {
    @BeforeTest fun setup() { MockBukkit.mock() }
    @AfterTest fun teardown() { MockBukkit.unmock() }

    private fun menu(yaml: String) = MenuCompiler.compile(
        ObjectMapper(YAMLFactory()).registerKotlinModule().readValue<MenuYaml>(yaml.trimIndent()), emptyMap())

    private fun open(yaml: String): MenuSession {
        val player = MockBukkit.getMock()!!.addPlayer()
        val deps = SoftDepRegistry(vault = null, papi = null, worldGuard = null, hdbHeads = null)
        return MenuRenderer.open(player, menu(yaml), "en", ExecutionContext(player), ConditionEvaluator(deps, CooldownStore()))
    }

    private fun name(item: ItemStack?): String =
        item?.itemMeta?.displayName()?.let(PlainTextComponentSerializer.plainText()::serialize) ?: ""

    /** The slots written since the last call, as the client would get them. */
    private class Sent : MenuSlots.Client {
        val slots = mutableListOf<Int>()
        override fun slotChanged(rawSlot: Int) { slots += rawSlot }
        override fun allChanged() { slots += -1 }
    }

    @Test fun `refresh_ticks is read on the element, never below two ticks`() {
        val yaml = ObjectMapper(YAMLFactory()).registerKotlinModule().readValue<MenuYaml>("""
            schema: menu/v1
            id: m
            title: []
            elements:
              - { id: a, positions: 0, material: STONE, refresh_ticks: 20 }
              - { id: b, positions: 1, material: STONE, refresh_ticks: 1 }
              - { id: c, positions: 2, material: STONE, refresh_ticks: 0 }
              - { id: d, positions: 3, material: STONE }
        """.trimIndent())
        assertEquals(listOf(20, 2, null, null), yaml.allElements.map { it.refreshPeriod })
        assertEquals(20, yaml.allElements.first().refreshTicks)
        assertEquals(Material.STONE.name, yaml.allElements.first().display.material)
    }

    @Test fun `a menu without refresh_ticks has nothing to refresh`() {
        val session = open("""
            schema: menu/v1
            id: m
            title: []
            elements:
              - { id: a, positions: 0, material: STONE, title: "A" }
        """)
        assertNull(session.refresh)
    }

    @Test fun `each element redraws at its own period and counts its redraws`() {
        val session = open("""
            schema: menu/v1
            id: m
            title: []
            elements:
              - { id: fast, positions: 0, material: STONE, title: "fast {refresh.n}", refresh_ticks: 4 }
              - { id: slow, positions: "1-2", material: STONE, title: "slow {refresh.n}", refresh_ticks: 10 }
              - { id: still, positions: 3, material: STONE, title: "still {refresh.n}" }
        """)
        val refresh = assertNotNull(session.refresh)
        assertEquals(2L, refresh.periodTicks)
        assertEquals("fast 0", name(session.slots[0]))
        assertEquals("slow 0", name(session.slots[1]))
        repeat(5) { refresh.tick() } // 10 ticks
        assertEquals("fast 2", name(session.slots[0]))
        assertEquals("slow 1", name(session.slots[1]))
        assertEquals("slow 1", name(session.slots[2]))
    }

    @Test fun `a slot whose item did not change is not sent again`() {
        val session = open("""
            schema: menu/v1
            id: m
            title: []
            elements:
              - { id: same, positions: 0, material: STONE, title: "Same", refresh_ticks: 2 }
              - { id: count, positions: 1, material: STONE, title: "{refresh.n}", refresh_ticks: 2 }
        """)
        val sent = Sent()
        session.slots.client = sent
        session.refresh!!.tick()
        session.refresh!!.tick()
        assertEquals(listOf(1, 1), sent.slots)
    }

    @Test fun `a redraw picks the state whose conditions pass now, with its clicks`() {
        val session = open("""
            schema: menu/v1
            id: m
            title: []
            elements:
              - id: claim
                positions: 4
                refresh_ticks: 2
                material: GRAY_DYE
                title: "Wait"
                states:
                  - if: [{ type: expression, expr: "refresh.n >= 2" }]
                    material: LIME_DYE
                    title: "Claim"
                    click: { left: { steps: 'close_menu' } }
        """)
        assertEquals(Material.GRAY_DYE, session.slots[4]?.type)
        assertNull(session.activeClicks[4])
        session.refresh!!.tick()
        assertEquals(Material.GRAY_DYE, session.slots[4]?.type)
        session.refresh!!.tick()
        assertEquals(Material.LIME_DYE, session.slots[4]?.type)
        assertEquals("Claim", name(session.slots[4]))
        assertNotNull(session.activeClicks[4])
        assertEquals("claim", session.slotElements[4])
    }

    @Test fun `each row of an iterating element redraws with its own row`() {
        val player = MockBukkit.getMock()!!.addPlayer()
        val m = menu("""
            schema: menu/v1
            id: m
            title: []
            inputs:
              - { name: offers, type: list }
            elements:
              - id: offer
                positions: "0-1"
                refresh_ticks: 2
                iterates: { source: offers, alias: o }
                material: PAPER
                title: "{o.name} {refresh.n}"
        """)
        val ctx = ExecutionContext(player, args = mapOf("offers" to listOf(mapOf("name" to "a"), mapOf("name" to "b"))))
        val session = MenuRenderer.open(player, m, "en", ctx)
        session.refresh!!.tick()
        assertEquals("a 1", name(session.slots[0]))
        assertEquals("b 1", name(session.slots[1]))
    }

    @Test fun `a refresh never draws over a later element on the same slot`() {
        val session = open("""
            schema: menu/v1
            id: m
            title: []
            elements:
              - { id: under, positions: 0, material: STONE, title: "{refresh.n}", refresh_ticks: 2 }
              - { id: over, positions: 0, material: DIAMOND, title: "Over" }
        """)
        session.refresh!!.tick()
        assertEquals(Material.DIAMOND, session.slots[0]?.type)
    }

    /** Runs nothing by itself: [run] plays the next scheduled task. */
    private class Steps : Scheduler {
        val queue = ArrayDeque<Pair<Long, () -> Unit>>()
        fun run() = queue.removeFirst().second()
        override fun global(task: () -> Unit) = task()
        override fun globalLater(delayTicks: Long, task: () -> Unit) { queue += delayTicks to task }
        override fun player(playerId: UUID, onGone: () -> Unit, task: () -> Unit) = task()
        override fun playerLater(playerId: UUID, delayTicks: Long, task: () -> Unit) { queue += delayTicks to task }
        override fun async(task: () -> Unit) = task()
        override fun asyncLater(delayTicks: Long, task: () -> Unit) { queue += delayTicks to task }
        override fun ownsPlayer(playerId: UUID) = true
        override fun ownsGlobal() = true
    }

    @Test fun `the loop runs while the same opening is the player's session`() {
        val player = MockBukkit.getMock()!!.addPlayer()
        val session = MenuRenderer.open(player, menu("""
            schema: menu/v1
            id: m
            title: []
            elements:
              - { id: n, positions: 0, material: STONE, title: "{refresh.n}", refresh_ticks: 5 }
        """), "en")
        val sessions = MenuSessionStore().apply { set(player, session) }
        val steps = Steps()
        MenuRefreshLoop(steps, sessions, null).start(player, session)
        assertEquals(5L, steps.queue.single().first)
        steps.run()
        assertEquals("1", name(session.slots[0]))
        steps.run()
        assertEquals("2", name(session.slots[0]))
        // Closed, or replaced by another opening: the next run stops and schedules nothing.
        sessions.remove(player)
        steps.run()
        assertEquals("2", name(session.slots[0]))
        assertTrue(steps.queue.isEmpty())
    }
}
