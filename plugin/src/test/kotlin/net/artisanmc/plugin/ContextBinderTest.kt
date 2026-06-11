package net.artisanmc.plugin

import net.artisanmc.plugin.engine.ContextBinder
import net.artisanmc.plugin.model.ContextInputYaml
import net.artisanmc.plugin.model.MenuYaml
import kotlin.test.*

class ContextBinderTest {
    private fun menu(vararg inputs: ContextInputYaml) =
        MenuYaml(id = "m", size = 9, contextInputs = inputs.toList())

    @Test fun `caller args win over defaults by name`() {
        val args = ContextBinder.bind(
            menu(ContextInputYaml(name = "category", type = "string", default = "all")),
            mapOf("category" to "tools"),
        )
        assertEquals("tools", args["category"])
    }
    @Test fun `declared default fills a missing input with type coercion`() {
        val args = ContextBinder.bind(
            menu(
                ContextInputYaml(name = "category", type = "string", default = "all"),
                ContextInputYaml(name = "page_size", type = "integer", default = "5"),
                ContextInputYaml(name = "vip", type = "boolean", default = "true"),
            ),
            emptyMap(),
        )
        assertEquals("all", args["category"])
        assertEquals(5L, args["page_size"])
        assertEquals(true, args["vip"])
    }
    @Test fun `input without default and without caller value stays absent`() {
        val args = ContextBinder.bind(menu(ContextInputYaml(name = "q", type = "string")), emptyMap())
        assertFalse(args.containsKey("q"))
    }
    @Test fun `caller args not declared as inputs pass through untouched`() {
        val args = ContextBinder.bind(menu(), mapOf("extra" to 1))
        assertEquals(1, args["extra"])
    }
}
