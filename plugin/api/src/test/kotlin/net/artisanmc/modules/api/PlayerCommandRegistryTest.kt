package net.artisanmc.modules.api

import net.artisanmc.modules.api.playercommand.CommandArgument
import net.artisanmc.modules.api.playercommand.DuplicatePlayerCommandException
import net.artisanmc.modules.api.playercommand.PlayerCommandDeclaration
import net.artisanmc.modules.api.playercommand.PlayerCommandRegistry
import kotlin.test.*

class PlayerCommandRegistryTest {
    private fun decl(id: String) = PlayerCommandDeclaration.builder(id).executor {}.build()

    @Test fun `the name defaults to the part of the id after the colon`() {
        assertEquals("open", decl("attribution:open").name)
        assertEquals("attribution", decl("attribution:open").namespace())
    }

    @Test fun `an id without namespace or with capitals is refused`() {
        assertFailsWith<IllegalArgumentException> { PlayerCommandDeclaration.builder("open") }
        assertFailsWith<IllegalArgumentException> { PlayerCommandDeclaration.builder("Attribution:open") }
    }

    @Test fun `a command needs an executor or a child`() {
        assertFailsWith<IllegalArgumentException> { PlayerCommandDeclaration.builder("a:b").build() }
    }

    @Test fun `a child lives in its parent's namespace`() {
        assertFailsWith<IllegalArgumentException> {
            PlayerCommandDeclaration.builder("a:root").child(decl("b:child")).build()
        }
    }

    @Test fun `text is the last argument and optional ones come last`() {
        assertFailsWith<IllegalArgumentException> {
            PlayerCommandDeclaration.builder("a:b").argument(CommandArgument.text("msg")).argument(CommandArgument.string("x")).executor {}.build()
        }
        assertFailsWith<IllegalArgumentException> {
            PlayerCommandDeclaration.builder("a:b").argument(CommandArgument.string("x").optional()).argument(CommandArgument.string("y")).executor {}.build()
        }
    }

    @Test fun `an id taken by a command or a child is refused`() {
        val registry = PlayerCommandRegistry()
        registry.register(PlayerCommandDeclaration.builder("a:root").child(decl("a:stats")).build())
        assertFailsWith<DuplicatePlayerCommandException> { registry.register(decl("a:stats")) }
        assertFailsWith<DuplicatePlayerCommandException> { registry.register(decl("a:root")) }
        assertEquals("a:stats", registry.find("a:stats")?.id)
    }

    @Test fun `every change is signalled, a module's commands leave with it`() {
        val registry = PlayerCommandRegistry()
        var changes = 0
        registry.onChange { changes++ }
        registry.bindOwner("quests")
        registry.register(decl("quests:track"))
        registry.bindOwner(null)
        registry.register(decl("other:x"))
        registry.unregisterOwnedBy("quests")
        assertEquals(listOf("other:x"), registry.declarations().map { it.id })
        assertEquals(3, changes)
    }
}
