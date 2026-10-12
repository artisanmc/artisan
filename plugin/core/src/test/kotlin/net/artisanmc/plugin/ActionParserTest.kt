package net.artisanmc.plugin

import net.artisanmc.plugin.engine.Action
import net.artisanmc.plugin.engine.ActionParser
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertIs

class ActionParserTest {

    @Test
    fun `parse run_command`() {
        val a = ActionParser.parse(mapOf("type" to "run_command", "command" to "/say hi", "as_console" to true))
        assertEquals(Action.RunCommand("/say hi", asConsole = true), a)
    }

    @Test
    fun `parse run_command defaults as_console to false`() {
        val a = ActionParser.parse(mapOf("type" to "run_command", "command" to "/say hi"))
        assertEquals(Action.RunCommand("/say hi", asConsole = false), a)
    }

    @Test
    fun `parse close_menu`() {
        assertEquals(Action.CloseMenu, ActionParser.parse(mapOf("type" to "close_menu")))
    }

    @Test
    fun `parse open_menu with context`() {
        val a = ActionParser.parse(mapOf(
            "type" to "open_menu",
            "menu_id" to "shop",
            "context" to mapOf("tab" to "weapons"),
            "clear_context" to true,
        ))
        assertEquals(Action.OpenMenu("shop", mapOf("tab" to "weapons"), clearContext = true), a)
    }

    @Test
    fun `parse give_money`() {
        val a = ActionParser.parse(mapOf("type" to "give_money", "amount" to 50.0))
        assertEquals(Action.GiveMoney(50.0), a)
    }

    @Test
    fun `parse take_money with currency`() {
        val a = ActionParser.parse(mapOf("type" to "take_money", "amount" to 10.0, "currency" to "tokens"))
        assertEquals(Action.TakeMoney(10.0, "tokens"), a)
    }

    @Test
    fun `parse give_item`() {
        val a = ActionParser.parse(mapOf("type" to "give_item", "material" to "DIAMOND", "count" to 3))
        assertEquals(Action.GiveItem("DIAMOND", 3), a)
    }

    @Test
    fun `parse take_item`() {
        assertEquals(Action.TakeItem("IRON_SWORD", 1),
            ActionParser.parse(mapOf("type" to "take_item", "material" to "IRON_SWORD")))
    }

    @Test
    fun `parse give_xp`() {
        assertEquals(Action.GiveXp(100), ActionParser.parse(mapOf("type" to "give_xp", "amount" to 100)))
    }

    @Test
    fun `parse give_level`() {
        assertEquals(Action.GiveLevel(5), ActionParser.parse(mapOf("type" to "give_level", "amount" to 5)))
    }

    @Test
    fun `parse send_message`() {
        assertEquals(Action.SendMessage("<green>Hello"),
            ActionParser.parse(mapOf("type" to "send_message", "text" to "<green>Hello")))
    }

    @Test
    fun `parse broadcast`() {
        assertEquals(Action.Broadcast("News!"),
            ActionParser.parse(mapOf("type" to "broadcast", "text" to "News!")))
    }

    @Test
    fun `parse show_title minimal`() {
        val a = ActionParser.parse(mapOf("type" to "show_title", "title" to "<green>Hello"))
        assertEquals(Action.ShowTitle(title = "<green>Hello"), a)
    }

    @Test
    fun `parse show_title with subtitle and timings`() {
        val a = ActionParser.parse(mapOf(
            "type" to "show_title",
            "title" to "<gold>Welcome",
            "subtitle" to "<gray>to the shop",
            "fade_in" to 5,
            "stay" to 40,
            "fade_out" to 15,
        ))
        assertEquals(
            Action.ShowTitle(title = "<gold>Welcome", subtitle = "<gray>to the shop", fadeIn = 5, stay = 40, fadeOut = 15),
            a,
        )
    }

    @Test
    fun `parse show_title accepts numeric ticks as Number`() {
        // YAML deserialization can hand us Long or Int — both must work.
        val a = ActionParser.parse(mapOf(
            "type" to "show_title",
            "title" to "x",
            "fade_in" to 5L,
            "stay" to 40L,
            "fade_out" to 15L,
        ))
        assertEquals(Action.ShowTitle(title = "x", fadeIn = 5, stay = 40, fadeOut = 15), a)
    }

    @Test
    fun `parse show_title missing title throws`() {
        assertFailsWith<IllegalArgumentException> {
            ActionParser.parse(mapOf("type" to "show_title"))
        }
    }

    @Test
    fun `parse play_sound`() {
        val a = ActionParser.parse(mapOf("type" to "play_sound", "sound" to "ENTITY_PLAYER_LEVELUP", "volume" to 1.5f, "pitch" to 0.8f))
        assertEquals(Action.PlaySound("ENTITY_PLAYER_LEVELUP", 1.5f, 0.8f), a)
    }

    @Test
    fun `parse teleport with coordinates`() {
        val a = ActionParser.parse(mapOf("type" to "teleport", "world" to "world", "x" to 10.0, "y" to 64.0, "z" to -5.0))
        assertEquals(Action.Teleport("world", 10.0, 64.0, -5.0), a)
    }

    @Test
    fun `parse pagination_next`() {
        assertIs<Action.PaginationNext>(ActionParser.parse(mapOf("type" to "pagination_next")))
    }

    @Test
    fun `parse pagination_prev`() {
        assertIs<Action.PaginationPrev>(ActionParser.parse(mapOf("type" to "pagination_prev")))
    }

    @Test
    fun `unknown type throws IllegalArgumentException`() {
        assertFailsWith<IllegalArgumentException> {
            ActionParser.parse(mapOf("type" to "explode_server"))
        }
    }

    @Test
    fun `missing type throws IllegalArgumentException`() {
        assertFailsWith<IllegalArgumentException> {
            ActionParser.parse(emptyMap())
        }
    }

    @Test fun `parse open_dialog with context and clear_context`() {
        val a = ActionParser.parse(mapOf(
            "type" to "open_dialog",
            "dialog_id" to "d_confirm",
            "context" to mapOf("tab" to "shop"),
            "clear_context" to true,
        ))
        assertEquals(Action.OpenDialog("d_confirm", mapOf("tab" to "shop"), clearContext = true), a)
    }

    @Test fun `parse open_dialog defaults`() {
        val a = ActionParser.parse(mapOf("type" to "open_dialog", "dialog_id" to "d_simple"))
        assertEquals(Action.OpenDialog("d_simple"), a)
    }

    @Test fun `parse close_dialog`() {
        assertEquals(Action.CloseDialog, ActionParser.parse(mapOf("type" to "close_dialog")))
    }

    @Test fun `parse set_arg`() {
        val a = ActionParser.parse(mapOf("type" to "set_arg", "arg" to "category", "value" to "tools"))
        assertEquals(Action.SetArg("category", "tools"), a)
    }

    @Test fun `parse set_arg_cycle_next`() {
        val a = ActionParser.parse(mapOf("type" to "set_arg_cycle_next", "arg" to "sort", "list" to "price,name"))
        assertEquals(Action.SetArgCycleNext("sort", "price,name"), a)
    }

    @Test fun `parse set_arg_cycle_prev`() {
        val a = ActionParser.parse(mapOf("type" to "set_arg_cycle_prev", "arg" to "sort", "list" to "price,name"))
        assertEquals(Action.SetArgCyclePrev("sort", "price,name"), a)
    }
}
