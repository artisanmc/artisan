package net.artisanmc.modules.api

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import net.artisanmc.modules.api.menu.MenuRef

class MenuRefTest {
    @Test
    fun `parses qualified and bare refs`() {
        assertEquals(MenuRef("shop", "main"), MenuRef.parse("shop:main"))
        assertEquals(MenuRef(null, "main"), MenuRef.parse("main"))
    }

    @Test
    fun `prints the form the Action DSL takes`() {
        assertEquals("shop:main", MenuRef("shop", "main").toString())
        assertEquals("main", MenuRef(null, "main").toString())
        assertEquals("main", MenuRef("", "main").toString())
    }

    @Test
    fun `rejects half refs`() {
        assertFailsWith<IllegalArgumentException> { MenuRef.parse(":main") }
        assertFailsWith<IllegalArgumentException> { MenuRef.parse("shop:") }
        assertFailsWith<IllegalArgumentException> { MenuRef.parse("") }
    }
}
