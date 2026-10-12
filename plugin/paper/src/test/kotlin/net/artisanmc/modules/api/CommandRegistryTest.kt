package net.artisanmc.modules.api

import be.seeseemelk.mockbukkit.MockBukkit
import org.bukkit.entity.Player
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test

class CommandRegistryTest {

    private lateinit var player: Player

    @BeforeEach fun setup() {
        MockBukkit.mock()
        player = MockBukkit.getMock()!!.addPlayer()
    }

    @AfterEach fun teardown() { MockBukkit.unmock() }

    @Test
    fun `dispatch routes to the registered handler`() {
        val registry = CommandRegistry()
        var calledWith: Map<String, Any?>? = null
        registry.register(CommandDeclaration(
            name = "shop:buy",
            handler = { _, args -> calledWith = args }
        ))

        registry.dispatch("shop:buy", player, mapOf("item" to "diamond"))

        assertEquals("diamond", calledWith?.get("item"))
    }

    @Test
    fun `dispatch on unknown command throws UnknownCommandException`() {
        val registry = CommandRegistry()
        assertThrows(UnknownCommandException::class.java) {
            registry.dispatch("ghost:cmd", player, emptyMap())
        }
    }

    @Test
    fun `register twice on same name throws DuplicateCommandException`() {
        val registry = CommandRegistry()
        registry.register(CommandDeclaration(name = "shop:buy", handler = { _, _ -> }))
        assertThrows(DuplicateCommandException::class.java) {
            registry.register(CommandDeclaration(name = "shop:buy", handler = { _, _ -> }))
        }
    }
}
