package net.artisanmc.plugin.command

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class ModuleCommandLineTest {
    private val registered = setOf("boutique:buy", "homes:Teleport")

    @Test
    fun `plain arguments split on spaces`() {
        val line = ModuleCommandLine.parse("boutique:buy diamond  2", registered)!!
        assertEquals("boutique:buy", line.ref)
        assertEquals("diamond  2", line.raw)
        assertEquals(listOf("diamond", "2"), line.argv)
    }

    @Test
    fun `quoted arguments keep their spaces and escapes`() {
        val line = ModuleCommandLine.parse("""boutique:buy "Diamond Sword" 2 "say \"hi\"" "a\\b" """"", registered)!!
        assertEquals(listOf("Diamond Sword", "2", "say \"hi\"", "a\\b", ""), line.argv)
    }

    @Test
    fun `an unbalanced quote falls back to splitting on spaces`() {
        assertEquals(listOf("\"Diamond", "Sword"), ModuleCommandLine.splitArgs("\"Diamond Sword"))
    }

    @Test
    fun `backslashes outside quotes are literal`() {
        assertEquals(listOf("C:\\dir", "x"), ModuleCommandLine.splitArgs("C:\\dir x"))
    }

    @Test
    fun `refs match ignoring case and report the registered spelling`() {
        assertEquals("boutique:buy", ModuleCommandLine.parse("Boutique:BUY", registered)!!.ref)
        assertEquals("homes:Teleport", ModuleCommandLine.parse("homes:teleport base", registered)!!.ref)
        assertEquals(emptyList(), ModuleCommandLine.parse("homes:teleport", registered)!!.argv)
    }

    @Test
    fun `unknown refs and plain commands are not module commands`() {
        assertNull(ModuleCommandLine.parse("spawn", registered))
        assertNull(ModuleCommandLine.parse("essentials:spawn", registered))
        assertNull(ModuleCommandLine.parse("lp user {player}", registered))
    }
}
