package net.artisanmc.plugin

import net.artisanmc.plugin.render.PlayerSlots
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class PlayerSlotsTest {
    private val top = 27

    @Test
    fun `player slots are the 36 raw slots after the menu`() {
        assertFalse(PlayerSlots.isPlayerSlot(26, top))
        assertTrue(PlayerSlots.isPlayerSlot(27, top))
        assertTrue(PlayerSlots.isPlayerSlot(62, top))
        assertFalse(PlayerSlots.isPlayerSlot(63, top))
    }

    @Test
    fun `window content keeps the menu and replaces the player part`() {
        val real = List(top + 36) { "real$it" }
        val out = PlayerSlots.rewriteContent(real, top, mapOf(27 to "btn", 62 to "hotbar"), "empty")!!
        assertEquals(real.take(top), out.take(top))
        assertEquals("btn", out[27])
        assertEquals("empty", out[28])
        assertEquals("hotbar", out[62])
        assertEquals(top + 36, out.size)
    }

    @Test
    fun `content of another window size is left alone`() {
        assertNull(PlayerSlots.rewriteContent(List(46) { "x" }, top, emptyMap(), "empty"))
    }

    @Test
    fun `single slot is rewritten only in the player part`() {
        assertNull(PlayerSlots.rewriteSlot(3, top, mapOf(3 to "btn"), "empty"))
        assertEquals("btn", PlayerSlots.rewriteSlot(40, top, mapOf(40 to "btn"), "empty"))
        assertEquals("empty", PlayerSlots.rewriteSlot(41, top, mapOf(40 to "btn"), "empty"))
        assertNull(PlayerSlots.rewriteSlot(63, top, emptyMap(), "empty"))
    }

    @Test
    fun `hopper window uses its own top size`() {
        val out = PlayerSlots.rewriteContent(List(5 + 36) { "real" }, 5, mapOf(5 to "btn"), "empty")!!
        assertEquals("real", out[4])
        assertEquals("btn", out[5])
        assertEquals("empty", out[40])
    }
}
