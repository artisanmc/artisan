package net.artisanmc.modules.huds

import be.seeseemelk.mockbukkit.MockBukkit
import net.artisanmc.modules.api.text.OverlayApi
import org.bukkit.entity.Player
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.BeforeEach
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class HudRuntimeTest {
    private lateinit var player: Player
    private val shown = mutableListOf<String>()
    private var pack = true
    private var passes = true
    private val values = mutableMapOf("money" to "10")
    private val tasks = mutableListOf<Pair<Long, () -> Unit>>()
    private val warnings = mutableListOf<String>()

    private val overlay = object : OverlayApi by OverlayApi.NONE {
        override fun hasPack(player: Player) = pack
        override fun show(player: Player, slot: OverlayApi.Slot, layer: String, priority: Int, miniMessage: String) {
            shown += "show $slot $layer $priority $miniMessage"
        }
        override fun hide(player: Player, slot: OverlayApi.Slot, layer: String) {
            shown += "hide $slot $layer"
        }
    }

    private val runtime = HudRuntime(
        overlay = { overlay },
        passes = { _, hud -> hud.conditions.isEmpty() || passes },
        // A stand-in for the Template engine: {money} from the map above.
        render = { _, _, template -> template.replace("{money}", values.getValue("money")) },
        later = { _, delay, task -> tasks += delay to task },
        warn = { warnings += it },
    )

    private fun hud(id: String, vararg doc: Pair<String, Any?>) = Hud.parse(
        "survie",
        mapOf(
            "id" to id,
            "layout" to listOf(mapOf("text" to "line", "width" to 200, "lines" to 2)),
            "texts" to mapOf("line" to "Money {money}"),
        ) + doc,
    ).getOrThrow()

    @BeforeEach fun setup() {
        player = MockBukkit.mock().addPlayer()
    }

    @AfterEach fun teardown() { MockBukkit.unmock() }

    @Test
    fun `an enabled HUD is shown once, again only when a value changed`() {
        runtime.load(listOf(hud("profile")))
        runtime.update(player)
        runtime.update(player)
        assertEquals(listOf("show BOSS_BAR artisan:hud/survie/profile 100 Money 10"), shown)
        values["money"] = "25"
        runtime.update(player)
        assertEquals("show BOSS_BAR artisan:hud/survie/profile 100 Money 25", shown.last())
        assertEquals(2, shown.size)
    }

    @Test
    fun `without the pack or outside its conditions a HUD is not drawn, and taken away when it was`() {
        runtime.load(listOf(hud("quest", "when" to listOf("has_quest"))))
        runtime.update(player)
        assertEquals(1, shown.size)
        passes = false
        runtime.update(player)
        assertEquals("hide BOSS_BAR artisan:hud/survie/quest", shown.last())
        passes = true
        pack = false
        runtime.update(player)
        assertEquals(2, shown.size)
    }

    @Test
    fun `a disabled HUD shows for show_hud's duration, or until hide_hud`() {
        val timer = hud("timer", "enabled" to false)
        runtime.load(listOf(timer))
        runtime.update(player)
        assertEquals(emptyList(), shown)

        runtime.show(player, timer, 600)
        assertEquals(1, shown.size)
        val (delay, expire) = tasks.single { it.first == 600L }
        assertEquals(600L, delay)
        expire()
        assertEquals("hide BOSS_BAR artisan:hud/survie/timer", shown.last())

        runtime.show(player, timer, 0)
        assertEquals(3, shown.size)
        runtime.hide(player, timer)
        assertEquals("hide BOSS_BAR artisan:hud/survie/timer", shown.last())
    }

    @Test
    fun `a second show_hud replaces the first one's duration`() {
        val timer = hud("timer", "enabled" to false)
        runtime.load(listOf(timer))
        runtime.show(player, timer, 100)
        runtime.show(player, timer, 600)
        tasks.single { it.first == 100L }.second()
        assertTrue(shown.none { it.startsWith("hide") })
    }

    @Test
    fun `each HUD is checked again at its refresh, refresh 0 only on change`() {
        runtime.load(listOf(hud("fast", "refresh" to 5), hud("slow", "refresh" to 20), hud("never", "refresh" to 0)))
        runtime.update(player)
        assertEquals(3, shown.size)
        values["money"] = "99"
        runtime.tick(player)
        assertEquals(listOf("artisan:hud/survie/fast"), shown.drop(3).map { it.split(" ")[2] })
        runtime.tick(player); runtime.tick(player); runtime.tick(player)
        assertEquals(listOf("artisan:hud/survie/fast", "artisan:hud/survie/slow"), shown.drop(3).map { it.split(" ")[2] })
    }

    @Test
    fun `a HUD removed or moved to another slot by a reload is taken away from its old slot`() {
        runtime.load(listOf(hud("a"), hud("b")))
        runtime.update(player)
        runtime.load(listOf(hud("b", "slot" to "action_bar")))
        runtime.update(player)
        assertTrue("hide BOSS_BAR artisan:hud/survie/a" in shown)
        assertTrue("hide BOSS_BAR artisan:hud/survie/b" in shown)
        assertEquals("show ACTION_BAR artisan:hud/survie/b 100 Money 10", shown.last())
    }

    @Test
    fun `a bare id names the HUD of the chain's project first, then the only one by that id`() {
        val a = Hud.parse("survie", mapOf("id" to "timer")).getOrThrow()
        val b = Hud.parse("event", mapOf("id" to "timer")).getOrThrow()
        val c = Hud.parse("event", mapOf("id" to "boss")).getOrThrow()
        runtime.load(listOf(a, b, c))
        assertEquals(b, runtime.resolve("timer", "event"))
        assertEquals(a, runtime.resolve("survie/timer", "event"))
        assertEquals(null, runtime.resolve("timer", null))
        assertEquals(c, runtime.resolve("boss", "survie"))
    }

    @Test
    fun `a text is wrapped to its layer's width and cut to its lines`() {
        assertEquals(listOf("a", "b"), HudRuntime.rows("a\nb\nc", 200, 2))
        assertEquals(listOf("a", "b"), HudRuntime.rows("a<newline>b", 200, 3))
        assertTrue(HudRuntime.rows("word ".repeat(40).trim(), 60, 5).size == 5)
        assertEquals(emptyList(), HudRuntime.rows("", 60, 1))
    }
}
