package gg.interfaze.plugin

import gg.interfaze.plugin.engine.Action
import gg.interfaze.plugin.engine.ActionParser
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
}
