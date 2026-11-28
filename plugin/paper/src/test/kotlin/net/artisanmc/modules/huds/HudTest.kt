package net.artisanmc.modules.huds

import net.artisanmc.modules.api.text.OverlayApi
import net.artisanmc.modules.api.text.OverlayLayout
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class HudTest {
    private fun parse(doc: Map<String, Any?>) = Hud.parse("survie", mapOf("id" to "profile") + doc).getOrThrow()

    @Test
    fun `a HUD without settings is on, in the boss bar, at the defaults`() {
        val hud = parse(emptyMap())
        assertEquals("survie/profile", hud.ref)
        assertEquals("artisan:hud/survie/profile", hud.layer)
        assertTrue(hud.enabled)
        assertEquals(OverlayApi.Slot.BOSS_BAR, hud.slot)
        assertEquals(Hud.DEFAULT_PRIORITY, hud.priority)
        assertEquals(Hud.DEFAULT_REFRESH, hud.refresh)
        assertEquals(emptyList(), hud.problems)
    }

    @Test
    fun `a HUD without an id is refused`() {
        assertTrue(Hud.parse("survie", mapOf("slot" to "boss_bar")).isFailure)
    }

    @Test
    fun `wrong settings take their default and are reported`() {
        val hud = parse(mapOf("slot" to "sidebar", "priority" to "high", "refresh" to "soon"))
        assertEquals(OverlayApi.Slot.BOSS_BAR, hud.slot)
        assertEquals(Hud.DEFAULT_PRIORITY, hud.priority)
        assertEquals(Hud.DEFAULT_REFRESH, hud.refresh)
        assertEquals(3, hud.problems.size, hud.problems.toString())
    }

    @Test
    fun `refresh 0 means on change only, other values are kept within bounds`() {
        assertEquals(0, parse(mapOf("refresh" to 0)).refresh)
        assertEquals(Hud.MIN_REFRESH, parse(mapOf("refresh" to 1)).refresh)
        assertEquals(Hud.MAX_REFRESH, parse(mapOf("refresh" to "99999")).refresh)
        assertEquals(1, parse(mapOf("refresh" to 1)).problems.size)
    }

    @Test
    fun `a disabled HUD is a temporary one, action_bar is read`() {
        val hud = parse(mapOf("enabled" to false, "slot" to "action_bar"))
        assertEquals(false, hud.enabled)
        assertEquals(OverlayApi.Slot.ACTION_BAR, hud.slot)
    }

    @Test
    fun `when takes one condition or a list`() {
        assertEquals(listOf<Any?>("is_op"), parse(mapOf("when" to "is_op")).conditions)
        assertEquals(listOf<Any?>("a", "b"), parse(mapOf("when" to listOf("a", "b"))).conditions)
    }

    @Test
    fun `images and texts are kept, a list layer is left out and reported, each text layer has its template`() {
        val hud = parse(
            mapOf(
                "layout" to listOf(
                    mapOf("image" to "panel", "x" to -60),
                    mapOf("text" to "name", "width" to 100, "lines" to 1),
                    mapOf("list" to "rows", "width" to 100, "lines" to 3),
                    mapOf("text" to "money", "width" to 80, "lines" to 1, "y" to 10),
                ),
                "texts" to mapOf("name" to "<b>{player}</b>", "money" to 25),
            ),
        )
        assertEquals(listOf("panel"), hud.layout.layers.filterIsInstance<OverlayLayout.Image>().map { it.asset })
        assertEquals(listOf("name", "money"), hud.textLayers.map { it.slot })
        assertEquals(mapOf("name" to "<b>{player}</b>", "money" to "25"), hud.texts)
        assertEquals(1, hud.problems.size, hud.problems.toString())
        assertTrue(hud.problems.single().startsWith("layout[2]"))
    }
}
