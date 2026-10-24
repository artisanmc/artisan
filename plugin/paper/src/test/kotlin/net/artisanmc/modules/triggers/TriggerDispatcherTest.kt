package net.artisanmc.modules.triggers

import be.seeseemelk.mockbukkit.MockBukkit
import be.seeseemelk.mockbukkit.ServerMock
import net.artisanmc.modules.api.action.ModuleActionsApi
import net.artisanmc.modules.api.condition.ConditionsApi
import net.artisanmc.modules.api.gameevent.GameEventDeclaration
import net.artisanmc.modules.api.gameevent.GameEventFrequency
import net.artisanmc.modules.api.gameevent.GameEventRegistry
import org.bukkit.entity.Player
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test

class TriggerDispatcherTest {
    private lateinit var server: ServerMock
    private lateinit var player: Player
    private val runs = mutableListOf<Pair<Any?, Map<String, Any>>>()
    private val warnings = mutableListOf<String>()
    private var clock = 0L
    private var conditionsPass = true

    private val actions = object : ModuleActionsApi {
        override fun execute(player: Player, actions: String, args: Map<String, Any>, projectId: String?) {}
        override fun run(player: Player, chain: Any?, args: Map<String, Any>, projectId: String?) {
            runs += chain to args
            onRun(chain)
        }
    }
    private var onRun: (Any?) -> Unit = {}
    private val conditions = object : ConditionsApi {
        override fun test(player: Player, conditions: List<*>, args: Map<String, *>) = conditionsPass
        override fun validate(conditions: List<*>) = emptyList<String>()
    }
    private val registry = GameEventRegistry()
    private val dispatcher = TriggerDispatcher({ actions }, { conditions }, { warnings += it }, { clock })

    @BeforeEach fun setup() {
        server = MockBukkit.mock()
        player = server.addPlayer()
        registry.register(GameEventDeclaration("player_join", "connection", GameEventFrequency.RARE, listOf()))
        registry.addListener(dispatcher)
    }

    @AfterEach fun teardown() { MockBukkit.unmock() }

    private fun trigger(id: String, on: String = "player_join", cooldown: Long = 0, enabled: Boolean = true, conditions: List<Any?> = emptyList()) =
        Trigger("demo", id, on, conditions, cooldown, enabled, id)

    @Test
    fun `runs the triggers of the event in ref order, with the context under event`() {
        dispatcher.load(listOf(trigger("b"), trigger("a"), trigger("off", enabled = false), trigger("other", on = "player_quit")))
        assertTrue(registry.isObserved("player_join"))
        registry.fire("player_join", player, mapOf("first_join" to true))
        assertEquals(listOf<Any?>("a", "b"), runs.map { it.first })
        assertEquals(mapOf("first_join" to true), runs.first().second["event"])
    }

    @Test
    fun `cooldown per player and filters`() {
        dispatcher.load(listOf(trigger("a", cooldown = 10, conditions = listOf(mapOf("has_permission" to "x")))))
        registry.fire("player_join", player, emptyMap<String, Any>())
        clock = 9_000
        registry.fire("player_join", player, emptyMap<String, Any>())
        assertEquals(1, runs.size, "still cooling down")
        clock = 10_000
        registry.fire("player_join", player, emptyMap<String, Any>())
        assertEquals(2, runs.size)

        conditionsPass = false
        clock = 50_000
        registry.fire("player_join", player, emptyMap<String, Any>())
        assertEquals(2, runs.size, "the `if:` failed")
        conditionsPass = true
        registry.fire("player_join", player, emptyMap<String, Any>())
        assertEquals(3, runs.size, "a failed `if:` does not start the cooldown")
    }

    @Test
    fun `one failing trigger does not stop the next`() {
        dispatcher.load(listOf(trigger("a"), trigger("b")))
        onRun = { if (it == "a") error("boom") }
        registry.fire("player_join", player, emptyMap<String, Any>())
        assertEquals(listOf<Any?>("a", "b"), runs.map { it.first })
        assertEquals(1, warnings.size)
    }

    @Test
    fun `nesting stops at the reentrance limit`() {
        dispatcher.load(listOf(trigger("loop")))
        // The chain fires its own event again, like a teleport that changes world.
        onRun = { registry.fire("player_join", player, emptyMap<String, Any>()) }
        registry.fire("player_join", player, emptyMap<String, Any>())
        assertEquals(TriggerDispatcher.MAX_DEPTH, runs.size)
        assertEquals(1, warnings.size)
    }
}
