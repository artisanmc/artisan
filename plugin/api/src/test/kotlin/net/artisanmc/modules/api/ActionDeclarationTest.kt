package net.artisanmc.modules.api

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** The three wire forms of an action fold into one argument map, and back (ADR extensible-document-kinds, R1 b). */
class ActionDeclarationTest {
    private val noop = ActionHandler { ctx, _, _ -> ctx }

    private val openMenu = ActionDeclaration(
        "open_menu",
        listOf(
            ModelField("menu_id", ModelFieldType.documentRef("menu"), true),
            ModelField("context", ModelFieldType.map(ModelFieldType.string())),
            ModelField("clear_context", ModelFieldType.bool()),
        ),
        "menu_id",
        noop,
    )
    private val sendMessage = ActionDeclaration("send_message", listOf(ModelField("text", ModelFieldType.ltext(), true)), noop)
    private val closeMenu = ActionDeclaration("close_menu", noop)

    @Test fun `a bare name is no argument`() {
        assertEquals(emptyMap(), closeMenu.normalize(null))
        assertEquals(emptyMap(), openMenu.normalize(null))
    }

    @Test fun `a scalar binds the primary argument`() {
        assertEquals(mapOf("menu_id" to "shop"), openMenu.normalize("shop"))
        assertEquals(mapOf("text" to "Hi"), sendMessage.normalize("Hi"))
    }

    @Test fun `a map of declared arguments is the argument map`() {
        val wire = mapOf("menu_id" to "shop", "context" to mapOf("cat" to "{cat.id}"), "clear_context" to true)
        assertEquals(wire, openMenu.normalize(wire))
    }

    @Test fun `a map that is not made of arguments is the primary's value`() {
        val lang = mapOf("en" to "Hi", "fr" to "Salut")
        assertEquals(mapOf("text" to lang), sendMessage.normalize(lang))
    }

    @Test fun `a single argument is the primary by default`() {
        assertEquals("text", sendMessage.primary)
        assertNull(closeMenu.primary)
        assertNull(ActionDeclaration("teleport", listOf(ModelField("x", ModelFieldType.number()), ModelField("y", ModelFieldType.number())), noop).primary)
    }

    @Test fun `canonical is the inverse`() {
        assertNull(closeMenu.canonical(emptyMap()))
        assertEquals("shop", openMenu.canonical(mapOf("menu_id" to "shop")))
        assertEquals("shop", openMenu.canonical(mapOf("menu_id" to "shop", "context" to null)))
        val full = mapOf("menu_id" to "shop", "clear_context" to true)
        assertEquals(full, openMenu.canonical(full))
        assertEquals(mapOf("text" to lang()), sendMessage.normalize(sendMessage.canonical(mapOf("text" to lang()))))
    }

    private fun lang() = mapOf("en" to "Hi", "fr" to "Salut")

    @Test fun `names are checked`() {
        ActionDeclaration("quests:start", noop)
        assertFailsWith<IllegalArgumentException> { ActionDeclaration("Quests", noop) }
        assertFailsWith<IllegalArgumentException> { ActionDeclaration("a:b:c", noop) }
        assertFailsWith<IllegalArgumentException> {
            ActionDeclaration("x", listOf(ModelField("a", ModelFieldType.string())), "b", noop)
        }
        assertFailsWith<IllegalArgumentException> {
            ActionDeclaration("x", listOf(ModelField("a", ModelFieldType.string()), ModelField("a", ModelFieldType.string())), noop)
        }
    }

    @Test fun `the wire shape is the editor's`() {
        val wire = openMenu.toWire()
        assertEquals("open_menu", wire["name"])
        assertEquals("menu_id", wire["primary"])
        @Suppress("UNCHECKED_CAST")
        val args = wire["args"] as List<Map<String, Any?>>
        assertEquals(mapOf("name" to "menu_id", "type" to mapOf("kind" to "document_ref", "document" to "menu"), "required" to true), args[0])
        assertEquals(mapOf("kind" to "map", "of" to mapOf("kind" to "string")), args[1]["type"])
        assertTrue("primary" !in closeMenu.toWire())
    }

    @Test fun `the registry owns a module's actions`() {
        val registry = ActionRegistry()
        registry.register(closeMenu)
        registry.currentOwner = "quests"
        registry.register(ActionDeclaration("quests:start", noop))
        registry.currentOwner = null
        assertFailsWith<DuplicateActionException> { registry.register(ActionDeclaration("close_menu", noop)) }
        assertEquals(setOf("close_menu", "quests:start"), registry.names())
        assertEquals("quests", registry.registered().first { it.declaration.name == "quests:start" }.moduleId)
        assertEquals("quests", registry.registered().first { it.declaration.name == "quests:start" }.toWire()["module_id"])
        registry.unregisterOwnedBy("quests")
        assertEquals(setOf("close_menu"), registry.names())
    }
}
