package net.artisanmc.modules.api

import java.lang.reflect.Proxy
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import net.artisanmc.modules.api.gameevent.DuplicateGameEventException
import net.artisanmc.modules.api.gameevent.GameEventDeclaration
import net.artisanmc.modules.api.gameevent.GameEventFrequency
import net.artisanmc.modules.api.gameevent.GameEventListener
import net.artisanmc.modules.api.gameevent.GameEventRegistry
import net.artisanmc.modules.api.model.ModelField
import net.artisanmc.modules.api.model.ModelFieldType
import org.bukkit.entity.Player

/** ADR `triggers-and-variables` §2 and §3 bis: Game events are declared, fired, and changed only as declared. */
class GameEventRegistryTest {
    private val player = Proxy.newProxyInstance(Player::class.java.classLoader, arrayOf(Player::class.java)) { _, _, _ -> null } as Player

    private fun join() = GameEventDeclaration(
        "player_join", "connection", GameEventFrequency.RARE,
        listOf(ModelField("first_join", ModelFieldType.bool())),
        false, listOf(ModelField("join_message", ModelFieldType.minimessage())),
    )

    private fun breakBlock() = GameEventDeclaration(
        "block_break", "blocks", GameEventFrequency.NORMAL, listOf(ModelField("block", ModelFieldType.string())), true, listOf(),
    )

    @Test
    fun `registers, resolves and refuses a taken name`() {
        val reg = GameEventRegistry()
        reg.register(join())
        reg.register(breakBlock())
        assertEquals(listOf("block_break", "player_join"), reg.declarations().map { it.name })
        assertTrue(reg.has("player_join"))
        assertNull(reg.find("player_quit"))
        assertFailsWith<DuplicateGameEventException> { reg.register(join()) }
    }

    @Test
    fun `names, groups and fields are checked`() {
        assertFailsWith<IllegalArgumentException> { GameEventDeclaration("Player Join", "connection", GameEventFrequency.RARE, listOf()) }
        assertFailsWith<IllegalArgumentException> { GameEventDeclaration("quests:done:twice", "quests", GameEventFrequency.RARE, listOf()) }
        assertFailsWith<IllegalArgumentException> { GameEventDeclaration("x", "Bad Group", GameEventFrequency.RARE, listOf()) }
        val twice = listOf(ModelField("a", ModelFieldType.string()), ModelField("a", ModelFieldType.string()))
        assertFailsWith<IllegalArgumentException> { GameEventDeclaration("x", "g", GameEventFrequency.RARE, twice) }
        // `cancelled` is Artisan's, on a cancellable event.
        assertFailsWith<IllegalArgumentException> {
            GameEventDeclaration("x", "g", GameEventFrequency.RARE, listOf(ModelField("cancelled", ModelFieldType.bool())), true, listOf())
        }
        GameEventDeclaration("quests:completed", "quests", GameEventFrequency.RARE, listOf())
    }

    @Test
    fun `fire runs the observing listeners and hands back what they wrote`() {
        val reg = GameEventRegistry()
        reg.register(join())
        reg.register(breakBlock())
        val seen = mutableListOf<String>()
        reg.addListener { frame ->
            seen += frame.declaration.name
            if (frame.declaration.name != "player_join") return@addListener
            assertEquals(true, frame.context["first_join"])
            assertFalse(frame.cancel(), "player_join is not cancellable")
            assertTrue(frame.setEffect("join_message", "<gold>hi"))
            assertFalse(frame.setEffect("quit_message", "nope"), "undeclared effect")
        }
        reg.addListener { frame -> frame.setEffect("join_message", "<red>last") }
        reg.addListener(object : GameEventListener {
            override fun onGameEvent(frame: net.artisanmc.modules.api.gameevent.GameEventFrame) = error("not observed")
            override fun observes(name: String) = false
        })
        val frame = reg.fire("player_join", player, mapOf("first_join" to true, "ignored" to null))
        assertEquals(listOf("player_join"), seen)
        seen.clear()
        assertFalse(frame.isCancelled)
        assertEquals(mapOf("join_message" to "<red>last"), frame.effects, "the last write wins")
        assertFalse("ignored" in frame.context, "null values are left out")

        val broken = reg.fire("block_break", player, mapOf("block" to "stone"))
        assertEquals(false, broken.context["cancelled"], "`cancelled` is bound on a cancellable event")
        assertFailsWith<IllegalArgumentException> { reg.fire("player_quit", player, emptyMap<String, Any>()) }
    }

    @Test
    fun `a failing listener is reported and the next one runs`() {
        val reg = GameEventRegistry()
        val warnings = mutableListOf<String>()
        reg.bindWarnings { warnings += it }
        reg.register(breakBlock())
        reg.addListener { error("boom") }
        reg.addListener { it.cancel() }
        assertTrue(reg.fire("block_break", player, emptyMap<String, Any>()).isCancelled)
        assertEquals(1, warnings.size)
    }

    @Test
    fun `isObserved asks the listeners`() {
        val reg = GameEventRegistry()
        reg.register(join())
        reg.register(breakBlock())
        assertFalse(reg.isObserved("player_join"), "no listener")
        reg.addListener(object : GameEventListener {
            override fun onGameEvent(frame: net.artisanmc.modules.api.gameevent.GameEventFrame) {}
            override fun observes(name: String) = name == "block_break"
        })
        assertTrue(reg.isObserved("block_break"))
        assertFalse(reg.isObserved("player_join"))
        assertFalse(reg.isObserved("player_quit"), "undeclared")
    }

    @Test
    fun `what a module registered leaves with it`() {
        val reg = GameEventRegistry()
        reg.bindOwner("quests")
        reg.register(GameEventDeclaration("quests:completed", "quests", GameEventFrequency.RARE, listOf()))
        reg.addListener { }
        reg.bindOwner(null)
        reg.register(join())
        assertEquals("quests", reg.registered().first { it.declaration.name == "quests:completed" }.moduleId)
        reg.unregisterOwnedBy("quests")
        assertEquals(listOf("player_join"), reg.declarations().map { it.name })
        reg.register(GameEventDeclaration("quests:completed", "quests", GameEventFrequency.RARE, listOf()))
        assertFalse(reg.isObserved("quests:completed"), "the module's listener left too")
    }

    @Test
    fun `wire shape`() {
        val wire = GameEventRegistry().apply { bindOwner("x"); register(join()) }.registered().single().toWire()
        assertEquals("player_join", wire["name"])
        assertEquals("connection", wire["group"])
        assertEquals("rare", wire["frequency"])
        assertEquals(false, wire["cancellable"])
        assertEquals("x", wire["module_id"])
        assertEquals(listOf("first_join"), (wire["context"] as List<*>).map { (it as Map<*, *>)["name"] })
        assertEquals(listOf("join_message"), (wire["effects"] as List<*>).map { (it as Map<*, *>)["name"] })
    }
}
