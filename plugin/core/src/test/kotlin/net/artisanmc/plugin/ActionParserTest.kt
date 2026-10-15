package net.artisanmc.plugin

import net.artisanmc.plugin.engine.ActionParser
import net.artisanmc.plugin.engine.Step
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

/** Pre-DSL legacy wire (`{type: …}`): the tag is the action's name, the other keys its arguments. */
class ActionParserTest {

    @Test
    fun `the type is the name and the other keys are the arguments`() {
        val a = ActionParser.parse(mapOf(
            "type" to "open_menu",
            "menu_id" to "shop",
            "context" to mapOf("tab" to "weapons"),
            "clear_context" to true,
        ))
        assertEquals(
            Step.ActionStep("open_menu", mapOf("menu_id" to "shop", "context" to mapOf("tab" to "weapons"), "clear_context" to true)),
            a,
        )
        assertEquals(
            Step.ActionStep("show_title", mapOf("title" to "x", "fade_in" to 5L, "stay" to 40L, "fade_out" to 15L)),
            ActionParser.parse(mapOf("type" to "show_title", "title" to "x", "fade_in" to 5L, "stay" to 40L, "fade_out" to 15L)),
        )
        assertEquals(
            Step.ActionStep("send_message", mapOf("text" to "<green>Hello")),
            ActionParser.parse(mapOf("type" to "send_message", "text" to "<green>Hello")),
        )
    }

    @Test
    fun `an action without arguments has no value`() {
        assertEquals(Step.ActionStep("close_menu"), ActionParser.parse(mapOf("type" to "close_menu")))
        assertEquals(Step.ActionStep("pagination_next"), ActionParser.parse(mapOf("type" to "pagination_next")))
        assertEquals(Step.ActionStep("show_title"), ActionParser.parse(mapOf("type" to "show_title")))
    }

    @Test
    fun `as_console is the boolean spelling of as console`() {
        assertEquals(
            Step.ActionStep("run_command", mapOf("command" to "/say hi", "as" to "console")),
            ActionParser.parse(mapOf("type" to "run_command", "command" to "/say hi", "as_console" to true)),
        )
        assertEquals(
            Step.ActionStep("run_command", mapOf("command" to "/say hi")),
            ActionParser.parse(mapOf("type" to "run_command", "command" to "/say hi", "as_console" to false)),
        )
    }

    @Test
    fun `an unknown type passes through for the registry to resolve`() {
        assertEquals(
            Step.ActionStep("quests:start", mapOf("quest" to "mq_01")),
            ActionParser.parse(mapOf("type" to "quests:start", "quest" to "mq_01")),
        )
    }

    @Test
    fun `missing type throws IllegalArgumentException`() {
        assertFailsWith<IllegalArgumentException> {
            ActionParser.parse(emptyMap())
        }
    }
}
